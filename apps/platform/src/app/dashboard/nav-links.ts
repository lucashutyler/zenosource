import {
  LayoutDashboard,
  ClipboardList,
  FileQuestion,
  Tags,
  Building2,
  MapPin,
  Mail,
  BarChart3,
  Lightbulb,
  Plug,
  type LucideIcon,
} from "lucide-react";

export type NavLink = { href: string; label: string; icon: LucideIcon };

// "The chase" is the product's name for the open-work board, not a decorative
// label — docs/todo.md Wave 5's voice pass. The nav previously read as five
// Prisma models plus "Dashboard", which describes the schema rather than the
// job.
export const NAV_LINKS: NavLink[] = [
  { href: "/dashboard", label: "The chase", icon: LayoutDashboard },
  { href: "/dashboard/purchase-orders", label: "Purchase orders", icon: ClipboardList },
  { href: "/dashboard/rfqs", label: "RFQs", icon: FileQuestion },
  { href: "/dashboard/reports", label: "Scorecards", icon: BarChart3 },
  { href: "/dashboard/price-lists", label: "Price lists", icon: Tags },
  { href: "/dashboard/suppliers", label: "Suppliers", icon: Building2 },
  { href: "/dashboard/locations", label: "Locations", icon: MapPin },
  { href: "/dashboard/integrations", label: "Integrations", icon: Plug },
];

// Shown only once a connected integration supplies `po_suggestions`, which
// today means Epicor. Not a hidden link that 404s when typed — the route
// calls requireFeature() and genuinely does not exist for a tenant without
// it; this only keeps the nav honest about what's there.
//
// Deliberately *not* rendered as a locked, greyed-out row. docs/product.md:
// configurability is a cost, and a permanent advertisement for something a
// buyer may never connect is the nav carrying a sales message. The
// integrations page is where the locked features are explained, once.
export const PO_SUGGESTIONS_NAV_LINK: NavLink = {
  href: "/dashboard/po-suggestions",
  label: "PO suggestions",
  icon: Lightbulb,
};

// Shown only while the dev mailbox is active (no EMAIL_PROVIDER configured) —
// the layout decides, since a client component can't read server env vars.
export const MAILBOX_NAV_LINK: NavLink = {
  href: "/dashboard/emails",
  label: "Emails (dev)",
  icon: Mail,
};
