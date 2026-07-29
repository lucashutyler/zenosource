/**
 * The supplier-facing loading state.
 *
 * Held to a higher standard than the internal one: this arrives from an email
 * on a phone, often on a shop floor, and a blank white screen for a second is
 * where a supplier decides the link is broken and gives up.
 */
export default function Loading() {
  return (
    <div className="flex flex-1 justify-center bg-paper px-4 py-8 sm:py-12" aria-busy="true">
      <div className="w-full max-w-2xl">
        <span className="sr-only">Loading</span>
        <div className="border border-rule bg-paper-raised p-5 sm:p-8">
          <div className="mb-5 border-b-2 border-ink pb-3">
            <div className="h-5 w-40 animate-pulse bg-rule" />
          </div>
          <div className="h-4 w-56 animate-pulse bg-rule" />
          <div className="mt-3 h-8 w-48 animate-pulse bg-rule" />
          <div className="mt-6 space-y-3">
            <div className="h-4 w-full animate-pulse bg-rule" />
            <div className="h-4 w-5/6 animate-pulse bg-rule" />
          </div>
          <div className="mt-8 h-12 w-full animate-pulse bg-rule" />
        </div>
      </div>
    </div>
  );
}
