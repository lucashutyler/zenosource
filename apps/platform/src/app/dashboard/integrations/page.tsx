import type { Metadata } from "next";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { formatDate, formatDwell, plural } from "@/lib/format";
import { Callout, EmptyState, LinkButton, Panel, PageHeader, StatusChip } from "@/components/ui";
import { SimpleAction } from "@/components/simple-action";
import { INTEGRATIONS } from "@/lib/integrations/registry";
import { FEATURES, FEATURE_IDS, featureIsUnlocked } from "@/lib/integrations/capabilities";
import type { Capability } from "@/lib/integrations/capabilities";
import { capabilitiesForTenant, credentialExpiryOf } from "@/lib/integrations/connections";
import { isImplemented } from "@/lib/integrations/connectors";
import { disconnectIntegration, recheckIntegration, syncIntegration } from "@/app/actions/integrations";
import { EpicorConnectForm } from "./epicor-form";
import { OktaConnectForm } from "./okta-form";

export const metadata: Metadata = { title: "Integrations" };

const CAPABILITY_LABEL: Record<Capability, string> = {
  po_sync: "Purchase orders",
  po_suggestions: "PO suggestions",
  supplier_sync: "Suppliers",
  price_list_sync: "Vendor pricing",
  sso_oidc: "Sign-in (OIDC)",
  sso_saml: "Sign-in (SAML)",
  scim_provisioning: "Directory provisioning",
};

export default async function IntegrationsPage() {
  const user = await getCurrentInternalUser();
  const [connections, capabilities] = await Promise.all([
    db.integrationConnection.findMany({
      where: { tenantId: user.tenantId },
      include: {
        connectedByUser: { select: { name: true } },
        syncRuns: { orderBy: { startedAt: "desc" }, take: 4 },
      },
    }),
    capabilitiesForTenant(user.tenantId),
  ]);

  const byId = new Map(connections.map((c) => [c.integrationId, c]));
  const unlocked = FEATURE_IDS.filter((f) => featureIsUnlocked(f, capabilities));

  return (
    <div>
      <PageHeader
        title="Integrations"
        meta="What you connect here decides what the rest of the product can do. A feature appears when something supplies it and disappears when that connection stops working — nothing is switched on by hand."
      />

      {user.role !== "OWNER" && (
        <div className="mb-6">
          <Callout title="Read-only for you">
            Connecting an integration means storing credentials that can read and write orders
            across the whole company, or decide who is allowed to sign in, so only an owner can
            change what&apos;s here.
          </Callout>
        </div>
      )}

      <div className="space-y-4">
        {INTEGRATIONS.map((integration) => {
          const connection = byId.get(integration.id);
          const buildable = isImplemented(integration.id);
          const status = connection?.status ?? "DISCONNECTED";
          const credentialExpiresAt = connection ? credentialExpiryOf(connection) : null;

          return (
            <Panel key={integration.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-ink">{integration.name}</h2>
                    <StatusChip
                      variant={
                        status === "CONNECTED" ? "settled" : status === "DEGRADED" ? "live" : "unowned"
                      }
                    >
                      {integration.status === "planned"
                        ? `${integration.plannedIn}`
                        : status === "CONNECTED"
                          ? "Connected"
                          : status === "DEGRADED"
                            ? "Not working"
                            : "Not connected"}
                    </StatusChip>
                  </div>
                  <p className="mt-1.5 max-w-2xl text-sm text-ink-soft">{integration.summary}</p>
                  <p className="mt-2 text-xs text-ink-faint">
                    Supplies{" "}
                    {integration.capabilities
                      .map((c) => CAPABILITY_LABEL[c as Capability] ?? c)
                      .join(" · ")}
                  </p>
                </div>

                {user.role === "OWNER" && buildable && connection?.status !== "DISCONNECTED" && connection && (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <SimpleAction
                      action={recheckIntegration.bind(null, formDataFor(integration.id))}
                      label="Test connection"
                      pendingLabel="Testing…"
                    />
                    {status === "CONNECTED" && integration.type === "erp" && (
                      <SimpleAction
                        action={syncIntegration.bind(null, formDataFor(integration.id))}
                        label="Sync now"
                        variant="primary"
                        pendingLabel="Syncing…"
                      />
                    )}
                    {integration.type === "idp" && (
                      <LinkButton href="/dashboard/integrations/sso" variant="secondary">
                        Single sign-on settings
                      </LinkButton>
                    )}
                    <SimpleAction
                      action={disconnectIntegration.bind(null, formDataFor(integration.id))}
                      label="Disconnect"
                      variant="quiet"
                      confirm={{
                        title: `Disconnect ${integration.name}?`,
                        body:
                          integration.type === "idp" ? (
                            <>
                              <p>
                                Nobody is signed out — existing sessions run until they expire. What
                                stops is signing in through {integration.name}, and your directory
                                creating or removing people here.
                              </p>
                              <p className="mt-2">
                                Everyone keeps their account, their role and their locations, and
                                anyone without a password will need one set before they can get back
                                in. Every directory token is revoked, and the stored credentials are
                                erased — reconnecting asks for them again.
                              </p>
                            </>
                          ) : (
                            <>
                              <p>
                                The features it supplies —{" "}
                                {integration.capabilities
                                  .map((c) => CAPABILITY_LABEL[c as Capability] ?? c)
                                  .join(", ")}{" "}
                                — turn off for everyone in your organization until it&apos;s
                                reconnected.
                              </p>
                              <p className="mt-2">
                                Orders and suppliers already mirrored here stay exactly as they are.
                                They just stop being updated, and the stored credentials are erased —
                                reconnecting asks for them again.
                              </p>
                            </>
                          ),
                        confirmLabel: "Disconnect",
                      }}
                    />
                  </div>
                )}
              </div>

              {connection && status === "DEGRADED" && (
                <div className="mt-4">
                  <Callout title="This connection isn't working">
                    <p>
                      {connection.healthDetail ?? `${integration.name} rejected the connection.`}
                    </p>
                    <p className="mt-2 text-ink-faint">
                      {connection.lastHealthyAt
                        ? `Last worked ${formatDwell(connection.lastHealthyAt)} ago, on ${formatDate(connection.lastHealthyAt)}.`
                        : "It has never completed a successful check."}{" "}
                      {integration.type === "idp"
                        ? "Signing in and directory provisioning both keep working while you fix it — an assertion is verified when it arrives, so there is nothing here that can go stale, and locking your team out of the product to signal our own broken check would be the wrong trade."
                        : "Everything it supplies is switched off until it does — a feature reading data that stopped updating is worse than one that isn't there."}
                    </p>
                  </Callout>
                </div>
              )}

              {credentialExpiresAt && status !== "DISCONNECTED" && (
                <p className="mt-4 border-t border-rule pt-3 text-sm text-ink-soft">
                  The signing certificate this connection trusts runs out on{" "}
                  {formatDate(credentialExpiresAt)}. Upload the replacement before then — nothing
                  here will chase you about it, and sign-in stops the day it expires.
                </p>
              )}

              {connection && status === "CONNECTED" && (
                <div className="mt-4 border-t border-rule pt-4">
                  <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                    <div className="flex justify-between gap-4 sm:block">
                      <dt className="text-ink-faint">Connected</dt>
                      <dd className="text-ink">
                        {connection.connectedAt ? formatDate(connection.connectedAt) : "—"}
                        {connection.connectedByUser ? ` by ${connection.connectedByUser.name}` : ""}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4 sm:block">
                      <dt className="text-ink-faint">Last checked</dt>
                      <dd className="text-ink">
                        {connection.lastCheckedAt
                          ? `${formatDwell(connection.lastCheckedAt)} ago`
                          : "Never"}
                      </dd>
                    </div>
                  </dl>

                  {connection.healthDetail && (
                    <p className="mt-3 text-xs text-ink-faint">{connection.healthDetail}</p>
                  )}

                  {connection.syncRuns.length > 0 && (
                    <div className="mt-4">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-faint">
                        Recent syncs
                      </p>
                      <ul className="space-y-1 text-sm">
                        {connection.syncRuns.map((run) => (
                          <li key={run.id} className="flex flex-wrap items-baseline gap-x-3 text-ink-soft">
                            <span className="font-mono text-xs">{run.resource}</span>
                            <span className="text-ink">
                              {run.created > 0 && `${run.created} new`}
                              {run.created > 0 && run.updated > 0 && ", "}
                              {run.updated > 0 && `${run.updated} updated`}
                              {run.created === 0 && run.updated === 0 && "no changes"}
                            </span>
                            {run.skipped > 0 && (
                              <span className="text-ink-faint">{run.skipped} skipped</span>
                            )}
                            {run.failed > 0 && <span className="text-ink">{run.failed} failed</span>}
                            <span className="text-ink-faint">{formatDwell(run.startedAt)} ago</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {integration.status === "planned" && (
                <p className="mt-4 border-t border-rule pt-4 text-sm text-ink-faint">
                  Listed because the model that gates features is the same one an identity provider
                  plugs into — it isn&apos;t built yet. {integration.plannedIn} builds it, in{" "}
                  <span className="font-mono text-xs">{integration.subproject}</span>.
                </p>
              )}

              {user.role === "OWNER" && buildable && status !== "CONNECTED" && (
                <div className="mt-4 border-t border-rule pt-4">
                  {/* Dispatched on the integration's own type. Rendering one
                      form for every integration worked while there was one;
                      with two it would put an ERP's server URL and company id
                      in front of somebody connecting an identity provider. */}
                  {integration.type === "idp" ? (
                    <OktaConnectForm integrationId={integration.id} />
                  ) : (
                    <EpicorConnectForm integrationId={integration.id} />
                  )}
                </div>
              )}
            </Panel>
          );
        })}
      </div>

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-ink-faint">
          What&apos;s switched on
        </h2>
        {unlocked.length === 0 ? (
          <EmptyState
            headline="Nothing is unlocked yet."
            body="Every feature here needs something connected to supply it. Purchase orders, RFQs and price lists you enter by hand work without any of it."
          />
        ) : (
          <Panel className="p-5">
            <ul className="space-y-2 text-sm">
              {unlocked.map((feature) => (
                <li key={feature} className="text-ink">
                  {FEATURES[feature].label}
                </li>
              ))}
            </ul>
            <p className="mt-4 border-t border-rule pt-3 text-xs text-ink-faint">
              {plural(unlocked.length, "feature")} available because of what you&apos;ve connected.
              Disconnecting takes them away again.
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}

/**
 * The server actions here take a FormData because they're also reachable from
 * a plain form post; binding one for a button keeps a single implementation
 * rather than a second overload per action.
 */
function formDataFor(integrationId: string): FormData {
  const formData = new FormData();
  formData.set("integrationId", integrationId);
  return formData;
}
