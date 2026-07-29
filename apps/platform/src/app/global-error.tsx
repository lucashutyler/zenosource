"use client";

/**
 * The last resort: an error thrown in the root layout itself, where no shell,
 * no theme tokens and no shared components are available. It has to render
 * its own `<html>` and carry its own styles inline.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#fbfaf8",
          color: "#1a1817",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: "2rem",
        }}
      >
        <div style={{ maxWidth: "32rem" }}>
          <p
            style={{
              margin: 0,
              fontSize: "0.75rem",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#7d766e",
            }}
          >
            ZenoSource
          </p>
          <h1 style={{ margin: "0.5rem 0 0", fontSize: "1.5rem" }}>The app failed to start.</h1>
          <p style={{ margin: "0.75rem 0 0", color: "#55504b", lineHeight: 1.6 }}>
            This is a fault on our side. Nothing you were doing has been lost — purchase orders,
            quotes and responses are all saved as they happen.
            {error.digest ? (
              <>
                {" "}
                Quote <code>{error.digest}</code> if you report it.
              </>
            ) : null}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              minHeight: "2.75rem",
              padding: "0.5rem 1rem",
              border: "1px solid #1a1817",
              background: "#1a1817",
              color: "#fbfaf8",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
