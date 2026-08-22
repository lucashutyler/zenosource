import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { createActionItem, resolveOpenActionItemsFor } from "@/lib/action-items";
import { revokeAllForConnection } from "@/lib/auth/directory-tokens";
import type { Capability, FeatureId } from "./capabilities";
import { CAPABILITIES, FEATURES, featureIsUnlocked, unlockedFeatures } from "./capabilities";
import { getIntegration, INTEGRATIONS } from "./registry";
import { openSecrets, sealSecrets } from "./secrets";
import type { ConnectorSession, HealthReport } from "./contract";
import type { IntegrationConnection } from "@/generated/prisma/client";

// The per-tenant half of the capability model: who has connected what, and
// whether it still works. The declarations are in registry.ts; nothing here
// decides what an integration *can* do, only what this tenant currently gets.

/**
 * Only CONNECTED grants capabilities. DEGRADED deliberately does not.
 *
 * The tempting alternative — keep features on while a connection is broken,
 * since the mirrored data is still sitting there — is worse in the way this
 * product cares about. A PO Suggestions screen fed by a sync that died on
 * Tuesday shows Tuesday's demand as though it were today's, and a buyer
 * raises orders against it. An absent feature with an explanation is a bad
 * afternoon; a confidently stale one is a wrong purchase order. The
 * INTEGRATION_RECONNECT action item is what makes the absence loud.
 */
const GRANTING_STATUS = "CONNECTED" as const;

export const getConnectionsForTenant = cache(async (tenantId: string) => {
  return db.integrationConnection.findMany({
    where: { tenantId },
    orderBy: { integrationId: "asc" },
  });
});

/**
 * Every capability this tenant currently has, intersected with what the
 * connection actually verified. A capability is granted only when the
 * integration declares it *and* the last health check confirmed the instance
 * can serve it. A partial grant is the normal case at a real customer — an
 * ERP credential scoped to some of its services and not others connects
 * perfectly well and still cannot supply everything the integration declares
 * — and unlocking the feature anyway produces a screen that is empty forever
 * with no explanation.
 */
export const capabilitiesForTenant = cache(
  async (tenantId: string): Promise<Set<Capability>> => {
    const connections = await getConnectionsForTenant(tenantId);
    const granted = new Set<Capability>();
    for (const connection of connections) {
      if (connection.status !== GRANTING_STATUS) continue;
      const definition = getIntegration(connection.integrationId);
      if (!definition) continue; // an id no build knows about; ignore rather than crash
      const verified = verifiedCapabilitiesOf(connection);
      for (const capability of definition.capabilities) {
        if (verified && !verified.has(capability)) continue;
        granted.add(capability);
      }
    }
    return granted;
  }
);

/**
 * `null` means the connection never reported a capability list — an older row
 * or a connector that doesn't probe — in which case the declared set stands.
 * Absence of evidence isn't evidence of absence, and failing closed here
 * would silently disable features on upgrade.
 */
function verifiedCapabilitiesOf(connection: IntegrationConnection): Set<Capability> | null {
  const config = connection.config as { verifiedCapabilities?: unknown } | null;
  const list = config?.verifiedCapabilities;
  if (!Array.isArray(list)) return null;
  const known = new Set<string>(CAPABILITIES);
  return new Set(list.filter((c): c is Capability => typeof c === "string" && known.has(c)));
}

export const featuresForTenant = cache(async (tenantId: string): Promise<FeatureId[]> => {
  return unlockedFeatures(await capabilitiesForTenant(tenantId));
});

export async function isFeatureEnabled(tenantId: string, feature: FeatureId): Promise<boolean> {
  return featureIsUnlocked(feature, await capabilitiesForTenant(tenantId));
}

/**
 * Route-level gate. A locked feature is `notFound()`, not a redirect and not
 * a 403: the route genuinely does not exist for this tenant, and Phase 1b
 * already built the designed "Nothing here." boundary that renders it. A
 * feature that is merely hidden in the nav but reachable by typing the URL is
 * the same class of bug as the locations list that was tenant-scoped but not
 * location-scoped.
 */
export async function requireFeature(tenantId: string, feature: FeatureId): Promise<void> {
  if (!(await isFeatureEnabled(tenantId, feature))) notFound();
}

/**
 * When the credential behind a connection stops being valid, if it said.
 *
 * Deliberately read off the stored config rather than being a column: it is
 * one nullable string that only some integrations have, and putting it in the
 * schema would make it look like something the product acts on. It isn't —
 * nothing branches on it, nothing is withdrawn because of it, and no action
 * item is minted from it. It renders as a dated line, and that is all, because
 * a certificate with twelve days left is not a broken connection and nothing
 * runs on a cadence to notice one with twelve hours left. See docs/todo.md for
 * what changes when there is a scheduler.
 */
export function credentialExpiryOf(connection: IntegrationConnection): Date | null {
  const config = connection.config as { credentialExpiresAt?: unknown } | null;
  const value = config?.credentialExpiresAt;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Which integrations a tenant could connect to unlock a locked feature. */
export function integrationsUnlocking(feature: FeatureId) {
  const required = FEATURES[feature].requires;
  return INTEGRATIONS.filter((i) => required.every((c) => i.capabilities.includes(c)));
}

// --- Connecting ------------------------------------------------------------

export async function connect(params: {
  tenantId: string;
  integrationId: string;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  connectedByUserId: string;
  health: HealthReport;
}) {
  const { tenantId, integrationId, health } = params;
  const config = {
    ...params.config,
    verifiedCapabilities: health.verifiedCapabilities ?? [],
    credentialExpiresAt: health.credentialExpiresAt ?? null,
  };
  const now = new Date();
  const data = {
    status: health.healthy ? ("CONNECTED" as const) : ("DEGRADED" as const),
    config,
    secretsSealed: sealSecrets(params.secrets),
    connectedAt: now,
    connectedByUserId: params.connectedByUserId,
    lastCheckedAt: now,
    lastHealthyAt: health.healthy ? now : null,
    healthFailure: health.failure,
    healthDetail: health.detail ?? null,
  };
  const connection = await db.integrationConnection.upsert({
    where: { tenantId_integrationId: { tenantId, integrationId } },
    create: { tenantId, integrationId, ...data },
    update: data,
  });
  await reconcileReconnectItem(connection);
  return connection;
}

/**
 * Keeps the config so reconnecting isn't a re-onboarding, wipes the secrets
 * so a disconnected integration stops being a credential at rest. Also
 * resolves any open reconnect item — a connection the tenant turned off on
 * purpose is not work anyone owes.
 */
export async function disconnect(tenantId: string, integrationId: string) {
  const connection = await db.integrationConnection.update({
    where: { tenantId_integrationId: { tenantId, integrationId } },
    data: {
      status: "DISCONNECTED",
      secretsSealed: null,
      healthFailure: "NONE",
      healthDetail: null,
    },
  });
  // Any directory credential this connection issued goes with it. The comment
  // above says disconnecting exists so a disconnected integration stops being
  // a credential at rest; a live token that can still deactivate users is
  // exactly that, in the direction that matters most.
  await revokeAllForConnection(connection.id);
  await resolveOpenActionItemsFor("INTEGRATION_CONNECTION", connection.id, {
    actionType: "INTEGRATION_RECONNECT",
  });
  return connection;
}

/** Decrypt on the way out to a connector. The only place secrets are opened. */
export function sessionFor(connection: IntegrationConnection): ConnectorSession {
  if (!connection.secretsSealed) {
    throw new Error(
      `Integration ${connection.integrationId} has no stored credentials — it is ${connection.status}.`
    );
  }
  return {
    config: (connection.config as Record<string, unknown>) ?? {},
    secrets: openSecrets(connection.secretsSealed),
  };
}

// --- Health ----------------------------------------------------------------

export async function recordHealth(connectionId: string, health: HealthReport) {
  const now = new Date();
  const existing = await db.integrationConnection.findUnique({ where: { id: connectionId } });
  if (!existing) return null;

  // A health check never revives a connection the tenant switched off.
  const status =
    existing.status === "DISCONNECTED"
      ? "DISCONNECTED"
      : health.healthy
        ? ("CONNECTED" as const)
        : ("DEGRADED" as const);

  const connection = await db.integrationConnection.update({
    where: { id: connectionId },
    data: {
      status,
      lastCheckedAt: now,
      lastHealthyAt: health.healthy ? now : existing.lastHealthyAt,
      healthFailure: health.failure,
      healthDetail: health.detail ?? null,
      // Re-probing capabilities on every check matters: an admin narrowing an
      // API key's Access Scope is a silent feature withdrawal otherwise.
      // Spread, never replaced: everything else on this blob is the
      // integration's own connect-form config, and a wholesale write here
      // would erase it on the first health check after connecting.
      config: health.verifiedCapabilities
        ? {
            ...((existing.config as Record<string, unknown>) ?? {}),
            verifiedCapabilities: health.verifiedCapabilities,
            credentialExpiresAt: health.credentialExpiresAt ?? null,
          }
        : (existing.config ?? undefined),
    },
  });
  await reconcileReconnectItem(connection);
  return connection;
}

/**
 * One open INTEGRATION_RECONNECT per broken connection, and none when it's
 * healthy. This is the function that keeps the product's central claim true
 * for integrations: docs/product.md's "a status nobody is being reminded to
 * act on is a modeling bug", applied to the connection itself.
 *
 * Owned by an OWNER, not a MEMBER: repairing an ERP credential means going
 * into Epicor's API Key Maintenance, which is an admin's job, and a MEMBER
 * who cannot fix it would just carry the item forever. If a tenant somehow
 * has no OWNER the item is skipped rather than orphaned — an action item with
 * no resolvable owner is itself the modeling bug.
 */
async function reconcileReconnectItem(connection: IntegrationConnection) {
  if (connection.status === "DEGRADED") {
    const open = await db.actionItem.findFirst({
      where: {
        subjectType: "INTEGRATION_CONNECTION",
        subjectId: connection.id,
        actionType: "INTEGRATION_RECONNECT",
        status: "OPEN",
      },
      select: { id: true },
    });
    if (open) return; // already being chased; don't reset its dwell clock
    const owner = await db.internalUser.findFirst({
      where: { tenantId: connection.tenantId, role: "OWNER", status: "ACTIVE" },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (!owner) return;
    await createActionItem({
      tenantId: connection.tenantId,
      subjectType: "INTEGRATION_CONNECTION",
      subjectId: connection.id,
      actionType: "INTEGRATION_RECONNECT",
      ownerType: "INTERNAL_USER",
      internalOwnerId: owner.id,
    });
    return;
  }

  await resolveOpenActionItemsFor("INTEGRATION_CONNECTION", connection.id, {
    actionType: "INTEGRATION_RECONNECT",
  });
}
