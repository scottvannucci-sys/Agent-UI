"use client";

/**
 * Global error boundary — replaces the root layout when it itself crashes.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#1e2a3a",
          color: "#f4efe2",
          fontFamily: "'Courier New', monospace",
          textAlign: "center",
          padding: 24,
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, letterSpacing: 1 }}>SABRE SYSTEMS ERROR</h1>
          <p style={{ maxWidth: 420 }}>
            The entire office layout failed to load. Please page the regional
            manager.
          </p>
          <pre style={{ fontSize: 13, opacity: 0.8, overflowWrap: "anywhere" }}>
            {error.message}
          </pre>
          <button
            onClick={reset}
            style={{
              marginTop: 12,
              padding: "10px 16px",
              border: "3px solid #f4efe2",
              background: "#d8c34a",
              color: "#1e2a3a",
              cursor: "pointer",
              fontFamily: "inherit",
              fontWeight: 700,
            }}
          >
            RESTART THE OFFICE
          </button>
        </div>
      </body>
    </html>
  );
}
