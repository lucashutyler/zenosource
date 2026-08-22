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

// The protocol-agnostic half of signing in.
//
// Nothing here knows whether a tenant federates over OIDC or SAML; the
// connector does, and the connector is the only thing that does. That is what
// makes a second identity provider a registry entry and a subproject rather
// than a rewrite of this file.
//
// ── One rule worth stating loudly, because "fixing" it would be an outage ──
//
// This file does not read capabilitiesForTenant(), does not call
// requireFeature(), and must not start. It reads the IntegrationConnection row
// directly and works while the connection is DEGRADED.
//
// The capability model's rule — DEGRADED grants nothing — is right and stays
// exactly as it is (src/lib/integrations/connections.ts). Its stated reason is
// the harm of *stale mirrored data*: "a PO Suggestions screen fed by a sync
// that died on Tuesday shows Tuesday's demand as though it were today's, and a
// buyer raises orders against it."
//
// An assertion has no equivalent harm. It is presented fresh and verified by
// signature on the spot; there is nothing stale about it. Meanwhile the harm
// of withdrawal inverts completely. A DEGRADED connection withdraws
// `sso_oidc`/`sso_saml`, so gating sign-in on the capability would mean: the
// health check fails at 2am, and by morning nobody at the customer can sign in
// — including the owner who is the only person who could repair it, and who
// would be reading an INTEGRATION_RECONNECT email linking them to a dashboard
// behind the door that just locked. `requireFeature` is `notFound()`, so it
// would be a 404 login page with no way forward.
//
// The three IdP features in capabilities.ts still exist and still gate exactly
// one thing: the "What's switched on" list on the integrations page. That is
// deliberate too — see the comment there.

export type BeginResult =
  | { ok: true; url: string; handle: string; cookieValue: string }
  | { ok: false; reason: string };

/** A connection that can still be used to sign in. DISCONNECTED cannot. */
/**
 * Which integration ids could sign somebody in — from the registry, never a
 * literal. A second identity provider is meant to be a subproject and a
 * registry entry; a vendor id written here would make it an edit to the auth
 * path as well, which is the one place this phase promised it would not be.
 */
const IDP_INTEGRATION_IDS = INTEGRATIONS.filter((i) => i.type === "idp").map((i) => i.id);

/**
 * The tenant's identity-provider connection whatever state it is in, for the
 * admin surfaces — which have to render a DISCONNECTED one, and must not be
 * gated on the health of the thing an owner came there to repair.
 */
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
      // Deliberately not `status: "CONNECTED"` — see the note above.
      status: { in: ["CONNECTED", "DEGRADED"] },
      integrationId: { in: IDP_INTEGRATION_IDS },
    },
    // A tenant has at most one per integration (`@@unique([tenantId,
    // integrationId])`), and today at most one identity provider full stop —
    // but ordering makes which one deterministic rather than leaving it to the
    // planner if that ever stops being true.
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
    // Starting a sign-in is the first outbound call this connection makes.
    // A failure here is a real signal about the connection, and it is one of
    // the only two an identity provider ever gives us.
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
  // business, not ours — so the connector is asked. Resolving the connector
  // needs a tenant, which the URL already gave us, so this stays inside the
  // rule that the tenant is settled before anything untrusted is read.
  const tenantConnection = await signInConnectionFor(tenant.id);
  const reader = tenantConnection ? getIdpConnector(tenantConnection.integrationId) : undefined;
  const handle = reader?.readHandle(callback) ?? "";

  const request = await consumeRequest(handle, cookieValue);
  if (!request) {
    // One message for a missing handle, a replayed one, an expired one and a
    // wrong browser. They are all "start again", and distinguishing them tells
    // whoever is probing which of the four they achieved.
    return {
      ok: false,
      reason: "That sign-in link has expired or was already used. Start again from the sign-in page.",
    };
  }
  if (request.tenantId !== tenant.id) {
    // The handle belongs to a different organization's sign-in. Nothing legal
    // produces this, and honouring it would be a session minted in the wrong
    // tenant.
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
    // The one health signal a SAML connection ever gives us: there is no
    // outbound call to probe, so a credential that will not verify is the only
    // evidence that the stored trust material is wrong. REJECTED is excluded
    // deliberately — one person's expired tab must not withdraw sign-in for
    // their whole organization.
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

  // A sign-in that verified is also the strongest evidence available that this
  // connection works, so it clears a DEGRADED state the same way a successful
  // health check would.
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
