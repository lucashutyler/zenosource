/**
 * Navigation feedback. There were no `loading.tsx` files anywhere in the app,
 * so clicking a link produced nothing at all for up to a second on a
 * database-backed page — long enough that people click twice.
 *
 * A skeleton in the ledger's own shape, not a spinner: the page you asked for
 * is arriving, and the layout shouldn't jump when it does.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="mb-6 h-7 w-56 animate-pulse bg-rule" />
      <div className="mb-5 flex gap-3">
        <div className="h-11 w-64 animate-pulse bg-rule" />
        <div className="h-11 w-40 animate-pulse bg-rule" />
      </div>
      <div className="border border-rule">
        <div className="h-9 border-b border-rule-strong bg-rule/40" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex h-12 items-center gap-4 border-b border-rule px-3"
            style={{ opacity: 1 - i * 0.1 }}
          >
            <div className="h-3 w-20 animate-pulse bg-rule" />
            <div className="h-3 w-32 animate-pulse bg-rule" />
            <div className="h-3 flex-1 animate-pulse bg-rule" />
            <div className="h-3 w-12 animate-pulse bg-rule" />
          </div>
        ))}
      </div>
    </div>
  );
}
