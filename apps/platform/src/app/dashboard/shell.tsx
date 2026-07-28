"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, ChevronLeft, ChevronRight } from "lucide-react";
import { NAV_LINKS } from "./nav-links";
import { UserMenu } from "./user-menu";

function isActive(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}

export function DashboardShell({
  userName,
  openCount,
  children,
}: {
  userName?: string;
  openCount: number;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  // Auto-close the mobile drawer whenever navigation happens. Adjusted
  // during render (React's recommended pattern for "reset state when a
  // prop changes") rather than in an effect, which would cause an extra
  // render pass — see https://react.dev/learn/you-might-not-need-an-effect.
  const [priorPathname, setPriorPathname] = useState(pathname);
  if (pathname !== priorPathname) {
    setPriorPathname(pathname);
    setMobileOpen(false);
  }

  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-black">
      {/* Mobile backdrop — blocks clicks through to content and closes the drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-zinc-200 bg-white transition-[transform,width] duration-200 dark:border-zinc-800 dark:bg-zinc-950 md:sticky md:top-0 md:h-screen md:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "w-16" : "w-60"}`}
      >
        <div className="flex h-14 items-center justify-between border-b border-zinc-100 px-3 dark:border-zinc-900">
          <Link href="/dashboard" className="flex items-center gap-2 overflow-hidden">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-indigo-600 text-sm font-bold text-white">
              Z
            </span>
            {!collapsed && (
              <span className="truncate font-semibold text-zinc-950 dark:text-zinc-50">
                ZenoSource
              </span>
            )}
          </Link>
          <button
            onClick={() => setMobileOpen(false)}
            className="text-zinc-400 hover:text-zinc-600 md:hidden"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {NAV_LINKS.map((link) => {
            const active = isActive(pathname, link.href);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                title={collapsed ? link.label : undefined}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${
                  active
                    ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
                }`}
              >
                <span className="relative shrink-0">
                  <Icon className="h-4 w-4" />
                  {collapsed && link.href === "/dashboard" && openCount > 0 && (
                    <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-600" />
                  )}
                </span>
                {!collapsed && <span className="flex-1 truncate">{link.label}</span>}
                {!collapsed && link.href === "/dashboard" && openCount > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-semibold text-white">
                    {openCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={() => setCollapsed((c) => !c)}
          className="hidden items-center justify-center border-t border-zinc-100 py-2 text-zinc-400 hover:text-zinc-600 dark:border-zinc-900 md:flex"
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950">
          <button
            onClick={() => setMobileOpen(true)}
            className="text-zinc-500 hover:text-zinc-700 md:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="hidden md:block" />
          <UserMenu name={userName} />
        </header>
        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
