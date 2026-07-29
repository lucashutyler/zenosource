"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState } from "react";
import { Search, X } from "lucide-react";

// Filters that apply themselves, and pagination.
//
// The `Apply` button these replace made every filter a two-step interaction
// and — the real damage — left the screen showing results that didn't match
// the controls above them until you remembered to press it. Half the audit's
// filter findings were people reading stale rows under changed dropdowns.
//
// `Sort` is deliberately absent. There is one right order for a chase product
// (waiting longest first) and it is not the user's to choose; SourceDay needs
// saved views because their queue has no opinion about what matters.

export type FilterSpec = {
  name: string;
  label: string;
  value: string;
  allLabel: string;
  options: { value: string; label: string }[];
};

export function ListFilters({
  filters,
  searchPlaceholder,
  searchValue,
}: {
  filters: FilterSpec[];
  searchPlaceholder?: string;
  searchValue?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchValue ?? "");

  // Keep the box in step with a back/forward navigation. Adjusted during
  // render (React's "reset state when a prop changes" pattern) rather than in
  // an effect, which would cost an extra render pass and re-run after every
  // keystroke-driven re-render — see
  // https://react.dev/learn/you-might-not-need-an-effect.
  const [priorSearchValue, setPriorSearchValue] = useState(searchValue);
  if (searchValue !== priorSearchValue) {
    setPriorSearchValue(searchValue);
    setQuery(searchValue ?? "");
  }

  function apply(changes: Record<string, string>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    // Any filter change invalidates the current page offset — page 4 of the
    // old result set is meaningless in the new one.
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
  }

  const active = filters.some((f) => f.value) || Boolean(query);

  return (
    <form
      className="mb-5 flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        apply({ q: query });
      }}
    >
      {searchPlaceholder && (
        <div className="min-w-[16rem] flex-1">
          <label
            htmlFor="q"
            className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-faint"
          >
            Search
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
              aria-hidden
            />
            <input
              id="q"
              name="q"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="min-h-11 w-full border border-rule-strong bg-paper-raised py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint"
            />
          </div>
        </div>
      )}

      {filters.map((filter) => (
        <div key={filter.name}>
          <label
            htmlFor={filter.name}
            className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-faint"
          >
            {filter.label}
          </label>
          <select
            id={filter.name}
            name={filter.name}
            value={filter.value}
            onChange={(e) => apply({ [filter.name]: e.target.value })}
            className="min-h-11 border border-rule-strong bg-paper-raised px-3 py-2 text-sm text-ink"
          >
            <option value="">{filter.allLabel}</option>
            {filter.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ))}

      {/* Submits the search box for keyboard and no-JS users; the selects
          apply on change and never need it. */}
      <button
        type="submit"
        className="min-h-11 border border-rule-strong bg-paper-raised px-3 py-2 text-sm font-medium text-ink hover:bg-rule/40"
      >
        Search
      </button>

      {active && (
        <button
          type="button"
          onClick={() => {
            setQuery("");
            router.push(pathname);
          }}
          className="inline-flex min-h-11 items-center gap-1 px-2 py-2 text-sm text-ink-soft hover:text-ink"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          Clear
        </button>
      )}
    </form>
  );
}

export function Pagination({
  range,
}: {
  range: { page: number; pages: number; from: number; to: number; total: number };
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  if (range.pages <= 1) return null;

  function hrefFor(page: number) {
    const next = new URLSearchParams(searchParams.toString());
    if (page <= 1) next.delete("page");
    else next.set("page", String(page));
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  return (
    <nav
      aria-label="Pagination"
      className="mt-4 flex items-center justify-between gap-4 text-sm text-ink-soft"
    >
      <p className="font-mono tabular-nums">
        {range.from}–{range.to} of {range.total}
      </p>
      <div className="flex gap-2">
        <PageLink href={hrefFor(range.page - 1)} disabled={range.page <= 1}>
          Previous
        </PageLink>
        <PageLink href={hrefFor(range.page + 1)} disabled={range.page >= range.pages}>
          Next
        </PageLink>
      </div>
    </nav>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className="inline-flex min-h-11 items-center border border-rule px-3 py-2 text-ink-faint">
        {children}
      </span>
    );
  }
  return (
    <a
      href={href}
      className="inline-flex min-h-11 items-center border border-rule-strong px-3 py-2 text-ink hover:bg-rule/40"
    >
      {children}
    </a>
  );
}
