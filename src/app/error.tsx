"use client";

/**
 * Route-level error boundary (keeps the root layout).
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        padding: 48,
        fontFamily: "var(--font-terminal), 'Courier New', monospace",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontFamily: "var(--font-pixel), monospace", fontSize: 16, color: "#1e2a3a" }}>
        FIRE DRILL! A PAGE CRASHED
      </h1>
      <p style={{ maxWidth: 460, margin: "12px auto" }}>
        Dwight has been notified. He suggests restarting, which is technically
        what he says about everything.
      </p>
      <pre
        style={{
          background: "#fff",
          border: "2px solid #26262e",
          padding: 10,
          maxWidth: 560,
          margin: "0 auto 16px",
          overflowWrap: "anywhere",
          fontSize: 14,
        }}
      >
        {error.message}
      </pre>
      <button
        onClick={reset}
        style={{
          fontFamily: "var(--font-pixel), monospace",
          fontSize: 12,
          padding: "10px 14px",
          border: "3px solid #1e2a3a",
          background: "#d8c34a",
          cursor: "pointer",
        }}
      >
        RUN IT BACK
      </button>
    </div>
  );
}
