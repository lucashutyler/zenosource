import {
  LayoutDashboard,
  ClipboardList,
  FileQuestion,
  Tags,
  Building2,
  MapPin,
  Mail,
  BarChart3,
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
];

// Shown only while the dev mailbox is active (no EMAIL_PROVIDER configured) —
// the layout decides, since a client component can't read server env vars.
export const MAILBOX_NAV_LINK: NavLink = {
  href: "/dashboard/emails",
  label: "Emails (dev)",
  icon: Mail,
};
