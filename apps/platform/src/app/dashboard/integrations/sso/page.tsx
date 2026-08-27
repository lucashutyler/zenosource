import type { Metadata } from "next";
import Link from "next/link";
import { idpConnectionFor } from "@/lib/auth/broker";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { formatDate, formatDwell } from "@/lib/format";
import { Callout, EmptyState, Panel, PageHeader, Section, StatusChip } from "@/components/ui";
import { SimpleAction } from "@/components/simple-action";
import { removeDomain, revokeToken } from "@/app/actions/directory";
import {
  directoryBaseUrl,
  serviceProviderRef,
  ssoCallbackUrl,
  ssoMetadataUrl,
  ssoStartUrl,
} from "@/lib/auth/urls";
import { AddDomainForm, GroupMappingForm, IssueTokenForm } from "./forms";

export const metadata: Metadata = { title: "Single sign-on" };

// Not behind requireFeature(): a DEGRADED connection withdraws the identity
// capabilities, which would hide this repair screen behind the health of the
// thing it repairs. OWNER is the gate.

function Address({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-t border-rule py-3 first:border-t-0 first:pt-0">
      <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">{label}</p>
      <code className="mt-1 block break-all font-mono text-sm text-ink">{value}</code>
      {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

function fieldsFor(name: string, value: string): FormData {
  const formData = new FormData();
  formData.set(name, value);
  return formData;
}

export default async function SsoSettingsPage() {
  const user = await getCurrentInternalUser();

  const [tenant, connection, domains, tokens, groups, locations] = await Promise.all([
    db.tenant.findUnique({ where: { id: user.tenantId }, select: { slug: true, name: true } }),
    idpConnectionFor(user.tenantId),
    db.tenantDomain.findMany({ where: { tenantId: user.tenantId }, orderBy: { domain: "asc" } }),
    db.directoryToken.findMany({
      where: { tenantId: user.tenantId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      include: { createdByUser: { select: { name: true } } },
    }),
    db.directoryGroup.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { displayName: "asc" },
      include: { locations: { select: { locationId: true } }, _count: { select: { members: true } } },
    }),
    db.location.findMany({
      where: { tenantId: user.tenantId, status: "ACTIVE" },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const slug = tenant?.slug ?? "";
  const protocol =
    (connection?.config as { protocol?: string } | null)?.protocol === "SAML" ? "SAML" : "OIDC";

  if (user.role !== "OWNER") {
    return (
      <div>
        <PageHeader title="Single sign-on" />
        <Callout title="Read-only for you">
          A directory token can create and remove people across the whole organization, so only an
          owner can change what&apos;s here.
        </Callout>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Single sign-on"
        meta="What your identity provider needs from us, and what we let it decide. Signing in with a password keeps working throughout — this adds a door, it never takes one away."
        back={{ href: "/dashboard/integrations", label: "Integrations" }}
      />

      {!connection || connection.status === "DISCONNECTED" ? (
        <Callout title="Nothing is connected yet">
          Connect an identity provider on the{" "}
          <Link href="/dashboard/integrations" className="underline underline-offset-2">
            integrations page
          </Link>{" "}
          first. The addresses below are already yours and won&apos;t change, so you can set them up
          at your end in advance.
        </Callout>
      ) : connection.status === "DEGRADED" ? (
        <Callout title="This connection isn't working">
          {connection.healthDetail ?? "The last check failed."} Signing in and directory
          provisioning both keep working while you fix it — nobody is locked out by this.
        </Callout>
      ) : null}

      <Section
        title="What to put into your identity provider"
        description="Three addresses and one identifier, all specific to your organization. They don't change."
      >
        <Panel className="p-5">
          <Address
            label="Sign-in URL"
            value={ssoStartUrl(slug)}
            hint="Point your application's tile here. Starting from a tile that jumps straight in isn't supported — a sign-in has to be one we asked for."
          />
          <Address
            label={protocol === "SAML" ? "Assertion consumer service (ACS) URL" : "Redirect URI"}
            value={ssoCallbackUrl(slug)}
          />
          {protocol === "SAML" && (
            <>
              <Address label="Audience / entity ID" value={serviceProviderRef(slug)} />
              <Address
                label="Our metadata"
                value={ssoMetadataUrl(slug)}
                hint="Import this instead of typing the two above, if your identity provider prefers it."
              />
            </>
          )}
          <Address
            label="Directory (SCIM) base URL"
            value={directoryBaseUrl()}
            hint="Paired with a token below. The token is what identifies your organization, not the URL."
          />
        </Panel>
      </Section>

      <Section
        title="Email domains"
        description="Which addresses get sent to your identity provider when someone uses the organization sign-in."
      >
        {domains.length === 0 ? (
          <EmptyState
            headline="No domains yet."
            body="Until you add one, your team signs in with a password. Adding one doesn't take that away."
          />
        ) : (
          <Panel className="mb-4 p-5">
            <ul className="space-y-2">
              {domains.map((domain) => (
                <li key={domain.id} className="flex items-center justify-between gap-4 text-sm">
                  <span className="font-mono text-ink">@{domain.domain}</span>
                  <span className="flex items-center gap-3">
                    <StatusChip variant={domain.verifiedAt ? "settled" : "unowned"}>
                      {domain.verifiedAt ? `Added ${formatDate(domain.verifiedAt)}` : "Not in use"}
                    </StatusChip>
                    <SimpleAction
                      action={removeDomain.bind(null, fieldsFor("domainId", domain.id))}
                      label="Remove"
                      variant="quiet"
                      confirm={{
                        title: `Stop routing @${domain.domain}?`,
                        body: "People with this address go back to signing in with a password. Nobody loses access, and nothing about their account changes.",
                        confirmLabel: "Remove domain",
                      }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
        <AddDomainForm />
      </Section>

      <Section
        title="Directory tokens"
        description="What your identity provider authenticates with when it creates or removes people here."
      >
        {tokens.length === 0 ? (
          <EmptyState
            headline="No tokens yet."
            body="Create one, paste it into your identity provider's provisioning settings, and it can start managing your team here."
          />
        ) : (
          <Panel className="mb-4 p-5">
            <ul className="space-y-3">
              {tokens.map((token) => (
                <li key={token.id} className="flex flex-wrap items-baseline justify-between gap-3 text-sm">
                  <span>
                    <span className="text-ink">{token.name}</span>{" "}
                    <span className="font-mono text-xs text-ink-faint">{token.tokenHint}</span>
                  </span>
                  <span className="flex items-center gap-3 text-xs text-ink-faint">
                    <span>
                      {token.lastUsedAt
                        ? `last used ${formatDwell(token.lastUsedAt)} ago`
                        : "never used"}
                    </span>
                    <span>
                      added {formatDate(token.createdAt)}
                      {token.createdByUser ? ` by ${token.createdByUser.name}` : ""}
                    </span>
                    <SimpleAction
                      action={revokeToken.bind(null, fieldsFor("tokenId", token.id))}
                      label="Revoke"
                      variant="quiet"
                      confirm={{
                        title: `Revoke ${token.name}?`,
                        body: "Your identity provider stops being able to create or remove people here immediately. Nobody is signed out and nobody loses access — but an offboarding at your end will not reach us until you issue a new token.",
                        confirmLabel: "Revoke token",
                      }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
        <IssueTokenForm />
      </Section>

      <Section
        title="Groups"
        description="Groups your directory has pushed. Each one grants nothing until you say what it means."
      >
        {groups.length === 0 ? (
          <EmptyState
            headline="No groups pushed yet."
            body="Once your identity provider pushes a group, it appears here — inert — and you decide what being in it is worth."
          />
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <Panel key={group.id} className="p-5">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="text-base font-semibold text-ink">{group.displayName}</h3>
                  <span className="text-xs text-ink-faint">
                    {group._count.members} {group._count.members === 1 ? "person" : "people"}
                    {group.mappedRole === null && " · grants nothing"}
                  </span>
                </div>
                <GroupMappingForm
                  group={{
                    id: group.id,
                    displayName: group.displayName,
                    mappedRole: group.mappedRole,
                    locationIds: group.locations.map((l) => l.locationId),
                  }}
                  locations={locations}
                />
              </Panel>
            ))}
          </div>
        )}
        <p className="mt-4 max-w-2xl text-xs text-ink-faint">
          A group can make someone a member and give them locations. It can never make someone an
          owner — that one is granted by a person here, not by a group name somewhere else.
          Locations you assign by hand are never taken away by a group.
        </p>
      </Section>
    </div>
  );
}
