// Declarations only, with no database and no I/O, so a client component can
// read them too.

/**
 * Everything an integration can claim to provide. snake_case, where a feature
 * id is kebab-case, so a capability and the feature it unlocks never read as
 * the same string.
 */
export const CAPABILITIES = [
  // --- ERP ---
  /** Mirror purchase orders from the ERP, and write acknowledgment/date/qty changes back. */
  "po_sync",
  /** Read MRP-generated PO suggestions. Read-only by nature. */
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
   * Every capability that must be present. All of them, not any: a feature
   * needing either of two capabilities is two features, separately connected
   * and separately explained.
   */
  requires: Capability[];
  /** Why it is locked, in the buyer's words rather than ours. */
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
  // The three below gate only the "What's switched on" list. They are granted
  // on CONNECTED alone, so gating sign-in or the directory endpoint on them
  // would let a failed health check lock a whole tenant out.
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

/** Does this capability set satisfy this feature? */
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
