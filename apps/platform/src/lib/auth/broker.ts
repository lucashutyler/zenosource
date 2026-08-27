import "server-only";
import { db } from "@/lib/db";
import { getIdpConnector } from "@/lib/integrations/connectors";
import { INTEGRATIONS } from "@/lib/integrations/registry";
import { recordHealth, sessionFor } from "@/lib/integrations/connections";
import { resolveFederatedUser } from "./identity";
import { beginRequest, consumeRequest, newHandle } from "./sso-request";
import { ssoCallbackUrl, serviceProviderRef } from "./urls";
import type { ResolvedTenant } from "./tenant-resolution";
import type { SignInCallback } from "@/lib/integrations/idp-contract";
import type { IntegrationConnection } from "@/generated/prisma/client";

// Deliberately reads the IntegrationConnection row rather than the capability
// model: DEGRADED withdraws `sso_oidc`/`sso_saml`, and gating sign-in on that
// would lock out the owner who is the only person able to repair it.

export type BeginResult =
  | { ok: true; url: string; handle: string; cookieValue: string }
  | { ok: false; reason: string };

const IDP_INTEGRATION_IDS = INTEGRATIONS.filter((i) => i.type === "idp").map((i) => i.id);

/** The tenant's identity-provider connection in any state, DISCONNECTED included. */
export async function idpConnectionFor(tenantId: string): Promise<IntegrationConnection | null> {
  return db.integrationConnection.findFirst({
    where: { tenantId, integrationId: { in: IDP_INTEGRATION_IDS } },
    orderBy: { integrationId: "asc" },
  });
}

export async function signInConnectionFor(
  tenantId: string
): Promise<IntegrationConnection | null> {
  const connection = await db.integrationConnection.findFirst({
    where: {
      tenantId,
      // Deliberately not `status: "CONNECTED"` — a DEGRADED connection must
      // still be able to sign people in.
      status: { in: ["CONNECTED", "DEGRADED"] },
      integrationId: { in: IDP_INTEGRATION_IDS },
    },
    orderBy: { integrationId: "asc" },
  });
  if (!connection?.secretsSealed) return null;
  return connection;
}

function protocolOf(connection: IntegrationConnection): "OIDC" | "SAML" {
  const config = (connection.config ?? {}) as { protocol?: unknown };
  return config.protocol === "SAML" ? "SAML" : "OIDC";
}

export async function beginSignIn(params: {
  tenant: ResolvedTenant;
  connection: IntegrationConnection;
  redirectTo?: string | null;
  /** What the person typed on the way in. Advisory; authorizes nothing. */
  loginHint?: string | null;
}): Promise<BeginResult> {
  const { tenant, connection } = params;
  const connector = getIdpConnector(connection.integrationId);
  if (!connector) return { ok: false, reason: "That sign-in method isn't available in this build." };

  // Minted first, so the connector puts it in the protocol's own round-trip
  // slot. The platform never names that slot.
  const handle = newHandle();

  let started;
  try {
    started = await connector.beginSignIn(sessionFor(connection), {
      callbackUrl: ssoCallbackUrl(tenant.slug),
      serviceProviderRef: serviceProviderRef(tenant.slug),
      handle,
      loginHint: params.loginHint ?? null,
    });
  } catch (thrown) {
    await recordHealth(connection.id, {
      healthy: false,
      failure: "UNREACHABLE",
      detail: thrown instanceof Error ? thrown.message : String(thrown),
    });
    return {
      ok: false,
      reason: "We couldn't reach your organization's sign-in service. Try again in a minute.",
    };
  }

  const request = await beginRequest({
    handle,
    tenantId: tenant.id,
    integrationId: connection.integrationId,
    protocol: protocolOf(connection),
    requestId: started.requestId,
    nonce: started.nonce ?? null,
    codeVerifier: started.codeVerifier ?? null,
    redirectTo: params.redirectTo ?? null,
  });

  return { ok: true, url: started.url, handle: request.handle, cookieValue: request.cookieValue };
}

export type CompleteResult =
  | { ok: true; userId: string; tenantId: string; redirectTo: string }
  | { ok: false; reason: string };

export async function completeSignIn(params: {
  tenant: ResolvedTenant;
  callback: SignInCallback;
  cookieValue: string | undefined;
}): Promise<CompleteResult> {
  const { tenant, callback, cookieValue } = params;

  // Which parameter a protocol round-trips the handle in is the connector's
  // business, so the connector is asked — after the tenant is settled from the
  // URL, never from anything untrusted.
  const tenantConnection = await signInConnectionFor(tenant.id);
  const reader = tenantConnection ? getIdpConnector(tenantConnection.integrationId) : undefined;
  const handle = reader?.readHandle(callback) ?? "";

  const request = await consumeRequest(handle, cookieValue);
  if (!request) {
    // One message for a missing handle, a replayed one, an expired one and a
    // wrong browser: distinguishing them tells a prober which they achieved.
    return {
      ok: false,
      reason: "That sign-in link has expired or was already used. Start again from the sign-in page.",
    };
  }
  if (request.tenantId !== tenant.id) {
    // Honouring a handle from another organization's sign-in would mint a
    // session in the wrong tenant.
    return { ok: false, reason: "That sign-in didn't match this organization." };
  }

  const connection = await db.integrationConnection.findUnique({
    where: {
      tenantId_integrationId: { tenantId: tenant.id, integrationId: request.integrationId },
    },
  });
  if (!connection?.secretsSealed || connection.status === "DISCONNECTED") {
    return { ok: false, reason: "Single sign-on isn't set up for this organization." };
  }

  const connector = getIdpConnector(connection.integrationId);
  if (!connector) return { ok: false, reason: "That sign-in method isn't available in this build." };

  const result = await connector.completeSignIn(sessionFor(connection), callback, {
    callbackUrl: ssoCallbackUrl(tenant.slug),
    serviceProviderRef: serviceProviderRef(tenant.slug),
    expectedRequestId: request.requestId,
    expectedNonce: request.nonce,
    codeVerifier: request.codeVerifier,
    handle: request.handle,
  });

  if (!result.ok) {
    // REJECTED is excluded deliberately: one person's expired tab must not
    // withdraw sign-in for their whole organization.
    if (result.kind !== "REJECTED") {
      await recordHealth(connection.id, {
        healthy: false,
        failure: result.kind === "UNREACHABLE" ? "UNREACHABLE" : "CONFIGURATION",
        detail: result.detail,
      });
    }
    return { ok: false, reason: result.detail };
  }

  const resolved = await resolveFederatedUser({
    tenantId: tenant.id,
    integrationId: connection.integrationId,
    connectionId: connection.id,
    identity: result.identity,
  });
  if (!resolved.ok) return { ok: false, reason: resolved.reason };

  if (connection.status === "DEGRADED") {
    await recordHealth(connection.id, { healthy: true, failure: "NONE" });
  }

  return {
    ok: true,
    userId: resolved.userId,
    tenantId: tenant.id,
    redirectTo: request.redirectTo,
  };
}
