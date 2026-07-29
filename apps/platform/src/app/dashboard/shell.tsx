"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NAV_LINKS, MAILBOX_NAV_LINK } from "./nav-links";
import { UserMenu } from "./user-menu";

function isActive(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}

export function DashboardShell({
  userName,
  userEmail,
  role,
  organization,
  locationScope,
  openCount,
  showMailbox,
  children,
}: {
  userName?: string;
  userEmail?: string;
  role?: string;
  organization?: string;
  /** Names of the locations this user can see, or null for unrestricted. */
  locationScope: string[] | null;
  openCount: number;
  showMailbox?: boolean;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const navLinks = showMailbox ? [...NAV_LINKS, MAILBOX_NAV_LINK] : NAV_LINKS;

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
    <div className="flex min-h-screen bg-paper">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-ink/40 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-rule bg-paper-raised transition-[transform,width] duration-200 md:sticky md:top-0 md:h-screen md:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "w-16" : "w-60"}`}
      >
        <div className="flex h-14 items-center justify-between border-b border-rule px-3">
          <Link href="/dashboard" className="flex items-center gap-2 overflow-hidden">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center border border-ink font-mono text-sm font-bold text-ink">
              Z
            </span>
            {!collapsed && (
              <span className="truncate font-semibold tracking-tight text-ink">ZenoSource</span>
            )}
          </Link>
          <button
            onClick={() => setMobileOpen(false)}
            className="flex h-11 w-11 items-center justify-center text-ink-faint hover:text-ink md:hidden"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <nav aria-label="Primary" className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {navLinks.map((link) => {
            const active = isActive(pathname, link.href);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                title={collapsed ? link.label : undefined}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center gap-3 px-3 py-2 text-sm ${
                  active
                    ? "border-l-2 border-ink bg-rule/40 font-semibold text-ink"
                    : "border-l-2 border-transparent font-medium text-ink-soft hover:bg-rule/30 hover:text-ink"
                }`}
              >
                <span className="relative shrink-0">
                  <Icon className="h-4 w-4" aria-hidden />
                  {collapsed && link.href === "/dashboard" && openCount > 0 && (
                    <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-age-4" />
                  )}
                </span>
                {!collapsed && <span className="flex-1 truncate">{link.label}</span>}
                {!collapsed && link.href === "/dashboard" && openCount > 0 && (
                  <span className="font-mono text-xs font-semibold tabular-nums text-age-4">
                    {openCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Scope, always visible. "Why is this list empty" should never be a
            question a MEMBER has to ask support. */}
        {!collapsed && (
          <div className="border-t border-rule px-3 py-2.5">
            <p className="truncate text-xs font-medium text-ink-soft">{organization}</p>
            <p className="mt-0.5 text-xs text-ink-faint">
              {locationScope === null
                ? "All locations"
                : locationScope.length === 0
                  ? "No locations assigned"
                  : locationScope.length === 1
                    ? locationScope[0]
                    : `${locationScope.length} locations`}
            </p>
          </div>
        )}

        <button
          onClick={() => setCollapsed((c) => !c)}
          className="hidden min-h-11 items-center justify-center border-t border-rule py-2 text-ink-faint hover:text-ink md:flex"
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" aria-hidden />
          ) : (
            <PanelLeftClose className="h-4 w-4" aria-hidden />
          )}
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="app-header flex h-14 items-center justify-between border-b border-rule bg-paper-raised px-4">
          <button
            onClick={() => setMobileOpen(true)}
            className="flex h-11 w-11 items-center justify-center text-ink-soft hover:text-ink md:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          <span className="hidden md:block" />
          <UserMenu
            name={userName}
            email={userEmail}
            role={role}
            organization={organization}
          />
        </header>
        <main id="main" className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
