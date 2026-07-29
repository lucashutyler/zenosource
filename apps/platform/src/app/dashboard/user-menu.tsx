"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Info, LogOut } from "lucide-react";
import { logout } from "@/app/actions/auth";

export function UserMenu({
  name,
  email,
  role,
  organization,
}: {
  name?: string;
  email?: string;
  role?: string;
  organization?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex min-h-11 items-center gap-1.5 px-2 py-1.5 text-sm text-ink-soft hover:text-ink"
      >
        <span className="flex h-7 w-7 items-center justify-center border border-rule-strong text-xs font-medium text-ink">
          {name?.charAt(0).toUpperCase() ?? "?"}
        </span>
        <span className="hidden sm:inline">{name}</span>
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </button>

      {open && (
        // No onClick handler on this container.
        //
        // It used to carry `onClick={() => setOpen(false)}`, which read as a
        // harmless "close the menu after any choice" — and silently broke
        // sign-out. React's synthetic click on the container ran first,
        // unmounting the <form> before the browser dispatched the button's
        // submit event, so the server action never fired: the menu closed,
        // nothing else happened, and the session cookie survived. On a shared
        // workstation that is a real exposure, not a cosmetic bug. The About
        // link closes the menu via navigation; the form closes it in its own
        // onSubmit, after submission has already been handed off.
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-60 border border-rule-strong bg-paper-raised py-1 shadow-lg"
        >
          {/* Who you are and what you can see. The audit found no organization
              name, role, or location scope shown anywhere in the app — a
              MEMBER couldn't tell whether an empty list meant "nothing here"
              or "nothing you're allowed to see". */}
          <div className="border-b border-rule px-3 py-2">
            <p className="truncate text-sm font-medium text-ink">{name}</p>
            {email && <p className="truncate text-xs text-ink-faint">{email}</p>}
            {(organization || role) && (
              <p className="mt-1 truncate text-xs text-ink-soft">
                {organization}
                {organization && role ? " · " : ""}
                {role === "OWNER" ? "Owner — all locations" : role === "MEMBER" ? "Member" : role}
              </p>
            )}
          </div>

          <Link
            href="/about"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center gap-2 px-3 py-2 text-sm text-ink-soft hover:bg-rule/40 hover:text-ink"
          >
            <Info className="h-4 w-4" aria-hidden />
            About
          </Link>
          <form action={logout} onSubmit={() => setOpen(false)}>
            <button
              type="submit"
              role="menuitem"
              className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink-soft hover:bg-rule/40 hover:text-ink"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
