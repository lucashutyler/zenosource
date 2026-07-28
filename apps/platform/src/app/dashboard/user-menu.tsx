"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Info, LogOut } from "lucide-react";
import { logout } from "@/app/actions/auth";

export function UserMenu({ name }: { name?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs font-medium text-white">
          {name?.charAt(0).toUpperCase() ?? "?"}
        </span>
        {name}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-1 w-40 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
          onClick={() => setOpen(false)}
        >
          <Link
            href="/about"
            className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            <Info className="h-4 w-4" />
            About
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
