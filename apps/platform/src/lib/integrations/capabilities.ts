// The capability vocabulary, and the features each one unlocks.
//
// docs/architecture.md#extensibility--capability-model calls this "the actual
// extensibility point of the platform": an integration declares what it can
// do, a feature declares what it needs, and a tenant gets the feature only
// once it has connected something that supplies the need. The point is that
// adding an integration never edits an unrelated feature, and adding a
// feature never edits an integration.
//
// This file is declarations only — no database, no I/O — so both server and
// client components can read it, and so the whole model is auditable by
// reading one screen of code. The per-tenant half (who has connected what,
// and whether it still works) lives in src/lib/integrations/connections.ts.

/**
 * Everything an integration can claim to provide. snake_case, and distinct
 * from feature ids below (which are kebab-case) so that a capability and the
 * feature it unlocks never read as the same string in logs or config —
 * `po_suggestions` the capability is supplied by Epicor, `po-suggestions` the
 * feature is what a buyer sees.
 */
export const CAPABILITIES = [
  // --- ERP ---
  /** Mirror purchase orders from the ERP, and write acknowledgment/date/qty changes back. */
  "po_sync",
  /** Read MRP-generated PO suggestions. Read-only by nature — see the note in registry.ts. */
  "po_suggestions",
  /** Mirror supplier master data. */
  "supplier_sync",
  /** Mirror vendor/part pricing into PriceList/PriceBreak. */
  "price_list_sync",
  // --- IdP ---
  "sso_oidc",
  "sso_saml",
  "scim_provisioning",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export type FeatureDefinition = {
  /** Shown wherever the feature is offered or explained as locked. */
  label: string;
  /**
   * Every capability that must be present. All of them, not any — a feature
   * needing either of two capabilities is two features, because they are
   * separately connected and separately explained. (This is why `sso-oidc`
   * and `sso-saml` are listed apart rather than as one `sso` with an
   * any-of rule: an admin configures exactly one, and the locked-state copy
   * differs.)
   */
  requires: Capability[];
  /**
   * Why it's locked, in the buyer's words, shown on the locked surface.
   * Never "missing capability po_suggestions" — that's our vocabulary, not
   * theirs.
   */
  lockedBecause: string;
};

export const FEATURES = {
  "po-suggestions": {
    label: "PO suggestions",
    requires: ["po_suggestions"],
    lockedBecause:
      "PO suggestions come out of your ERP's MRP run. Connect Epicor and they appear here — ZenoSource doesn't invent them.",
  },
  "erp-po-sync": {
    label: "ERP purchase-order sync",
    requires: ["po_sync"],
    lockedBecause:
      "Connect your ERP to mirror its purchase orders here and push acknowledgments, dates and quantities back.",
  },
  "erp-supplier-sync": {
    label: "ERP supplier sync",
    requires: ["supplier_sync"],
    lockedBecause: "Connect your ERP to keep supplier records in step with it.",
  },
  "erp-price-list-sync": {
    label: "ERP price-list sync",
    requires: ["price_list_sync"],
    lockedBecause:
      "Connect your ERP to pull negotiated vendor pricing in as price lists.",
  },
  // The three below gate exactly one thing: the "What's switched on" list on
  // /dashboard/integrations. They are deliberately NOT what the sign-in path
  // or the directory endpoint read.
  //
  // Do not "fix" that into consistency. `capabilitiesForTenant` grants only on
  // CONNECTED, so a DEGRADED connection withdraws these — which is right for
  // an ERP feature, where the harm is confidently stale data, and inverts
  // completely here. Gating sign-in on `sso_oidc` would mean a failed health
  // check at 2am locks every user of that tenant out by morning, including the
  // owner who is the only person who could repair it and whose reconnect email
  // would link them to a dashboard behind the door that just closed. Gating
  // provisioning on `scim_provisioning` would mean our own probe failing stops
  // a customer deprovisioning somebody who has left, whose session is live for
  // up to seven days.
  //
  // So src/lib/auth/broker.ts and the directory endpoint read the connection
  // row directly, and this stays exactly as it is.
  "sso-oidc": {
    label: "Single sign-on (OIDC)",
    requires: ["sso_oidc"],
    lockedBecause: "Connect your identity provider to let your team sign in with it.",
  },
  "sso-saml": {
    label: "Single sign-on (SAML)",
    requires: ["sso_saml"],
    lockedBecause: "Connect your identity provider to let your team sign in with it.",
  },
  "scim-provisioning": {
    label: "Directory provisioning (SCIM)",
    requires: ["scim_provisioning"],
    lockedBecause:
      "Connect your identity provider to create and deactivate ZenoSource users from your directory.",
  },
} as const satisfies Record<string, FeatureDefinition>;

export type FeatureId = keyof typeof FEATURES;

export const FEATURE_IDS = Object.keys(FEATURES) as FeatureId[];

/**
 * Pure resolution: does this capability set satisfy this feature? Separated
 * from anything that reads the database so it can be tested exhaustively
 * without one, and so the rule exists in exactly one place — the alternative
 * is every gated surface re-deriving "do I have po_suggestions" slightly
 * differently.
 */
export function featureIsUnlocked(
  feature: FeatureId,
  capabilities: ReadonlySet<Capability> | readonly Capability[]
): boolean {
  const have = capabilities instanceof Set ? capabilities : new Set(capabilities);
  return FEATURES[feature].requires.every((c) => have.has(c));
}

/** The features a given capability set unlocks. */
export function unlockedFeatures(
  capabilities: ReadonlySet<Capability> | readonly Capability[]
): FeatureId[] {
  return FEATURE_IDS.filter((f) => featureIsUnlocked(f, capabilities));
}
