import Link from "next/link";

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#f4efe2",
        color: "#26262e",
        fontFamily: "var(--font-terminal), 'Courier New', monospace",
        textAlign: "center",
        padding: 24,
      }}
    >
      <div>
        <h1
          style={{
            fontFamily: "var(--font-pixel), 'Courier New', monospace",
            fontSize: 18,
            color: "#1e2a3a",
          }}
        >
          404 · FILED IN THE WAREHOUSE
        </h1>
        <p style={{ maxWidth: 420, margin: "12px auto" }}>
          This page has been misplaced somewhere between Accounting and the
          copier room. Creed is “looking into it”.
        </p>
        <Link
          href="/"
          style={{
            color: "#1e2a3a",
            fontWeight: 700,
            borderBottom: "2px solid #d8c34a",
          }}
        >
          ← Back to the office floor
        </Link>
      </div>
    </div>
  );
}
