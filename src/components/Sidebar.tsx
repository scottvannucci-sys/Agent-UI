"use client";

import { useState } from "react";
import { fmtAgo, fmtClock } from "@/lib/fmt";
import type { BotSpec } from "@/lib/hermes/derive";
import type { FeedItem, HermesSnapshot, HermesTaskRun } from "@/lib/hermes/types";

interface Props {
  snapshot: HermesSnapshot | null;
  feed: FeedItem[];
  bots: BotSpec[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const STATUS_COLOR: Record<string, string> = {
  working: "var(--green)",
  idle: "var(--amber)",
  coffee: "#b06f2f",
  stuck: "var(--red)",
  away: "#8a8f96",
};

const ORDER = { working: 0, stuck: 1, idle: 2, coffee: 3, away: 4 } as const;

export default function Sidebar({ snapshot, feed, bots, selectedId, onSelect }: Props) {
  const [tab, setTab] = useState<"feed" | "orders" | "staff">("feed");

  const runsByTask = new Map<string, HermesTaskRun[]>();
  for (const r of snapshot?.runs ?? []) {
    const arr = runsByTask.get(r.taskId) ?? [];
    arr.push(r);
    runsByTask.set(r.taskId, arr);
  }
  const tasks = [...(snapshot?.tasks ?? [])].sort((a, b) => {
    const rank = (s: string) => (s === "in_progress" ? 0 : s === "todo" ? 1 : s === "blocked" ? 2 : 3);
    return rank(a.status) - rank(b.status) || b.createdAt - a.createdAt;
  });

  const staff = [...bots].sort(
    (a, b) => ORDER[a.status] - ORDER[b.status] || b.lastActivityAt - a.lastActivityAt,
  );

  return (
    <aside className="sidebar">
      <nav className="tabs">
        <button className={`tab ${tab === "feed" ? "active" : ""}`} onClick={() => setTab("feed")}>
          NEWSLETTER
        </button>
        <button className={`tab ${tab === "orders" ? "active" : ""}`} onClick={() => setTab("orders")}>
          WORK ORDERS
        </button>
        <button className={`tab ${tab === "staff" ? "active" : ""}`} onClick={() => setTab("staff")}>
          STAFF
        </button>
      </nav>

      <div className="tab-body">
        {tab === "feed" && (
          <>
            {feed.length === 0 && <div className="empty">The office is quiet… too quiet.</div>}
            {feed.map((f) => (
              <div key={f.id} className={`feed-item ${f.kind}`}>
                <div className="meta">
                  <span className="who">{f.botName}</span>
                  <span>{fmtClock(f.ts)}</span>
                </div>
                <div>{f.text}</div>
              </div>
            ))}
          </>
        )}

        {tab === "orders" && (
          <>
            {tasks.length === 0 && (
              <div className="empty">
                No work orders on the board.
                <br />
                (Assign tasks via Hermes kanban or bot mode.)
              </div>
            )}
            {tasks.map((t) => {
              const runs = runsByTask.get(t.id) ?? [];
              const running = runs.find((r) => r.status === "running");
              return (
                <div key={t.id} className="task-card">
                  <div className="row">
                    <span className="who" style={{ color: "var(--navy)" }}>
                      {t.title}
                    </span>
                    <span className={`badge ${t.status}`}>{t.status}</span>
                  </div>
                  <div className="row" style={{ marginTop: 4, fontSize: 15, color: "var(--ink-soft)" }}>
                    <span>{t.assignee ? `→ ${t.assignee}` : "unassigned"}</span>
                    {running && <span className="badge running">run #{running.id} live</span>}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {tab === "staff" && (
          <>
            {staff.map((b) => (
              <div
                key={b.id}
                className={`staff-row ${b.status === "away" ? "dim" : ""} ${
                  selectedId === b.id ? "" : ""
                }`}
                style={selectedId === b.id ? { border: "2px solid var(--navy)", background: "#fff" } : undefined}
                onClick={() => onSelect(b.id)}
              >
                <span className="dot" style={{ background: STATUS_COLOR[b.status] }} />
                <span className="who">{b.name}</span>
                <span className="role">
                  {b.role} · {fmtAgo(b.lastActivityAt)}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
