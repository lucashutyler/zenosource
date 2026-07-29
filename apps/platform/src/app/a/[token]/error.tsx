"use client";

/**
 * A supplier hitting an error has no account, no support contact inside the
 * product, and no reason to try twice. The one useful thing this page can do
 * is point them back at the email, where a real person's reply-to address is.
 */
export default function ActionViewError({ reset }: { reset: () => void }) {
  return (
    <div className="flex flex-1 justify-center bg-paper px-4 py-12">
      <div className="w-full max-w-lg border border-rule bg-paper-raised p-6">
        <h1 className="text-xl font-semibold text-ink">Something went wrong at our end.</h1>
        <p className="mt-3 text-sm text-ink-soft">
          Your response hasn&apos;t been recorded, so nothing has been sent by mistake. Try once
          more — if it fails again, reply to the email that brought you here and a person will pick
          it up.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex min-h-12 w-full items-center justify-center border border-ink bg-ink px-4 py-3 text-base font-semibold text-paper"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
