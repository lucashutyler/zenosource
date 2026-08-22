"use server";

import { revalidatePath } from "next/cache";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { type FormState, fail, failWith } from "@/lib/form-state";
import { getIntegration } from "@/lib/integrations/registry";
import { getAnyConnector, getErpConnector } from "@/lib/integrations/connectors";
import { connect, disconnect, recordHealth, sessionFor } from "@/lib/integrations/connections";
import { sealingIsConfigured } from "@/lib/integrations/secrets";
import { runSync } from "@/lib/integrations/sync";
import { resolveOpenActionItemsFor } from "@/lib/action-items";

export type FormActionState = FormState;

// Connecting an ERP is OWNER-only, everywhere in this file.
//
// It is a strictly larger permission than anything else in the product: the
// credentials entered here can read and write purchase orders across the
// buyer's whole company, and the connection decides which features exist for
// every user in the tenant. Consistent with locations — the other thing a
// MEMBER cannot manage because it defines what other people can see — and
// with the "consistent reference-data governance" item Phase 1b Wave 5 landed
// after the audit found a MEMBER could create suppliers but not locations.
async function requireOwner(formData: FormData) {
  const user = await getCurrentInternalUser();
  if (user.role !== "OWNER") {
    return { user: null, error: failWith(formData, "Only owners can manage integrations.") };
  }
  return { user, error: null };
}

export async function connectIntegration(
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const { user, error } = await requireOwner(formData);
  if (!user) return error;

  const integrationId = String(formData.get("integrationId") ?? "");
  const definition = getIntegration(integrationId);
  const connector = getAnyConnector(integrationId);
  if (!definition || !connector) {
    return failWith(formData, "That integration isn't available in this build.");
  }
  if (!sealingIsConfigured()) {
    // Refusing beats storing an ERP service account in plaintext because a
    // key wasn't set. See src/lib/integrations/secrets.ts.
    return failWith(
      formData,
      "This deployment has no INTEGRATION_SECRET_KEY configured, so credentials can't be stored securely. Set one before connecting an integration."
    );
  }

  const raw = Object.fromEntries(formData) as Record<string, unknown>;
  const parsed = connector.parseConfig(raw);
  if (!parsed.ok) return fail(formData, parsed.errors);

  // Health is checked *before* the connection is stored as working, so a
  // typo'd credential never gets a CONNECTED row that then grants
  // capabilities it can't serve.
  let health;
  try {
    health = await connector.checkHealth({ config: parsed.config, secrets: parsed.secrets });
  } catch (thrown) {
    return failWith(
      formData,
      thrown instanceof Error ? thrown.message : "Could not reach that Epicor instance."
    );
  }

  await connect({
    tenantId: user.tenantId,
    integrationId,
    config: parsed.config,
    secrets: parsed.secrets,
    connectedByUserId: user.id,
    health,
  });

  revalidatePath("/dashboard/integrations");
  revalidatePath("/dashboard", "layout");

  if (!health.healthy) {
    // Stored, but degraded — and the detail names which credential and which
    // Epicor screen. Kept on the form rather than redirecting, so the admin
    // can correct the field they got wrong without re-entering the rest.
    return { error: health.detail ?? "Epicor rejected the connection.", values: {} };
  }
  return { ok: "Connected." };
}

export async function recheckIntegration(formData: FormData): Promise<void> {
  const user = await getCurrentInternalUser();
  if (user.role !== "OWNER") return;

  const integrationId = String(formData.get("integrationId") ?? "");
  const connector = getAnyConnector(integrationId);
  const connection = await db.integrationConnection.findUnique({
    where: { tenantId_integrationId: { tenantId: user.tenantId, integrationId } },
  });
  if (!connector || !connection?.secretsSealed) return;

  try {
    const health = await connector.checkHealth(sessionFor(connection));
    await recordHealth(connection.id, health);
  } catch (thrown) {
    await recordHealth(connection.id, {
      healthy: false,
      failure: "UNREACHABLE",
      detail: thrown instanceof Error ? thrown.message : String(thrown),
    });
  }

  revalidatePath("/dashboard/integrations");
  revalidatePath("/dashboard", "layout");
}

export async function syncIntegration(formData: FormData): Promise<void> {
  const user = await getCurrentInternalUser();
  if (user.role !== "OWNER") return;

  const integrationId = String(formData.get("integrationId") ?? "");
  try {
    await runSync({ tenantId: user.tenantId, integrationId });
  } catch {
    // runSync already records the failure on the run row and, when it's a
    // credential problem, on the connection's health — which is what opens
    // the reconnect action item. Rethrowing here would replace a page that
    // explains the failure with an error boundary that doesn't.
  }

  revalidatePath("/dashboard/integrations");
  revalidatePath("/dashboard", "layout");
}

export async function disconnectIntegration(formData: FormData): Promise<void> {
  const user = await getCurrentInternalUser();
  if (user.role !== "OWNER") return;

  const integrationId = String(formData.get("integrationId") ?? "");
  await disconnect(user.tenantId, integrationId);

  revalidatePath("/dashboard/integrations");
  revalidatePath("/dashboard", "layout");
}

// --- PO suggestions --------------------------------------------------------

/**
 * A buyer's decision on an MRP suggestion.
 *
 * The decision is recorded here *and* pushed to Epicor, in that order, and
 * the two are reported separately. docs/integrations.md is explicit that
 * suggestions cannot be written through REST — an accept goes back through
 * the requisition/approval path and becomes a requisition that still has to
 * clear approval in Epicor. Telling a buyer "accepted" without saying that
 * would have them waiting for a PO that nothing is going to raise.
 */
export async function decideSuggestion(
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();

  const suggestionId = String(formData.get("suggestionId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (decision !== "ACCEPT" && decision !== "REJECT") {
    return failWith(formData, "Choose accept or reject.");
  }

  const suggestion = await db.pOSuggestion.findFirst({
    where: { id: suggestionId, tenantId: user.tenantId },
  });
  if (!suggestion) return failWith(formData, "That suggestion no longer exists.");
  if (suggestion.status !== "OPEN") {
    return failWith(formData, "Someone has already decided on this one.");
  }

  const connection = await db.integrationConnection.findUnique({
    where: {
      tenantId_integrationId: {
        tenantId: user.tenantId,
        integrationId: suggestion.sourceIntegrationId,
      },
    },
  });
  const connector = getErpConnector(suggestion.sourceIntegrationId);

  let detail: string | undefined;
  if (decision === "ACCEPT") {
    if (!connection || connection.status !== "CONNECTED" || !connector) {
      // Refuse rather than record a local-only accept. An accepted suggestion
      // that never reached the ERP is a buyer believing an order is on its
      // way when nothing was raised anywhere — worse than being told to try
      // again once the connection is fixed.
      return failWith(
        formData,
        "Accepting sends this to Epicor's requisition path, and that connection isn't working right now. Fix it on the integrations page and try again."
      );
    }
    const result = await connector.pushSuggestionDecision(sessionFor(connection), {
      suggestionExternalRef: suggestion.externalRef,
      decision: "ACCEPT",
      quantity: String(formData.get("quantity") ?? "") || null,
      needByDate: String(formData.get("needByDate") ?? "") || null,
    });
    if (!result.ok) return failWith(formData, result.detail ?? "Epicor rejected that.");
    detail = result.detail;
  } else if (connection?.status === "CONNECTED" && connector) {
    const result = await connector.pushSuggestionDecision(sessionFor(connection), {
      suggestionExternalRef: suggestion.externalRef,
      decision: "REJECT",
      reason: String(formData.get("reason") ?? "") || null,
    });
    detail = result.detail;
  }

  await db.pOSuggestion.update({
    where: { id: suggestion.id },
    data: { status: decision === "ACCEPT" ? "ACCEPTED" : "REJECTED" },
  });
  await resolveOpenActionItemsFor("PO_SUGGESTION", suggestion.id, {
    resolvedBy: { internalUserId: user.id },
  });

  revalidatePath("/dashboard/po-suggestions");
  revalidatePath("/dashboard");
  return { ok: detail ?? (decision === "ACCEPT" ? "Sent to Epicor." : "Dismissed.") };
}
