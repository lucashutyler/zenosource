import { LayoutDashboard, ClipboardList, FileQuestion, Tags, Building2, MapPin, type LucideIcon } from "lucide-react";

export type NavLink = { href: string; label: string; icon: LucideIcon };

export const NAV_LINKS: NavLink[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/purchase-orders", label: "Purchase orders", icon: ClipboardList },
  { href: "/dashboard/rfqs", label: "RFQs", icon: FileQuestion },
  { href: "/dashboard/price-lists", label: "Price lists", icon: Tags },
  { href: "/dashboard/suppliers", label: "Suppliers", icon: Building2 },
  { href: "/dashboard/locations", label: "Locations", icon: MapPin },
];
