"use client";

import { fmtAgo, fmtDayTime } from "@/lib/fmt";
import { fmtCost, fmtTokens, type BotSpec } from "@/lib/hermes/derive";
import type { HermesSnapshot } from "@/lib/hermes/types";

interface Props {
  bot: BotSpec | null;
  snapshot: HermesSnapshot | null;
  onClose: () => void;
}

export default function Inspector({ bot, snapshot, onClose }: Props) {
  if (!bot) return null;
  const s = bot.session;
  const tasks = (snapshot?.tasks ?? []).filter((t) => bot.taskIds.includes(t.id));

  return (
    <div className="inspector">
      <div className="head">
        <span className="dot" style={{ background: bot.status === "working" ? "var(--green)" : bot.status === "stuck" ? "var(--red)" : "var(--amber)" }} />
        <span className="name font-pixel" style={{ fontSize: 12 }}>
          {bot.name}
        </span>
        <span style={{ fontSize: 16 }}>{bot.role}</span>
        <button className="close" onClick={onClose} aria-label="close">
          ✕
        </button>
      </div>
      <div className="body">
        <div className="bubble">“{bot.statusText}”</div>
        <dl className="kv">
          <dt>Status</dt>
          <dd>
            {bot.status} · active {fmtAgo(bot.lastActivityAt)} ago
          </dd>
          {s ? (
            <>
              <dt>Model</dt>
              <dd>{s.model ?? "—"}</dd>
              <dt>Session</dt>
              <dd>{s.id}</dd>
              <dt>Messages</dt>
              <dd>{s.messageCount.toLocaleString()}</dd>
              <dt>Tool calls</dt>
              <dd>{s.toolCallCount.toLocaleString()}</dd>
              <dt>Tokens</dt>
              <dd>
                {fmtTokens(s.inputTokens)} in / {fmtTokens(s.outputTokens)} out
              </dd>
              <dt>Cost</dt>
              <dd>{fmtCost(s.costUsd)}</dd>
              <dt>Started</dt>
              <dd>
                {fmtDayTime(s.startedAt)} · {s.source}
              </dd>
              {s.cwd && (
                <>
                  <dt>Workspace</dt>
                  <dd>{s.cwd}</dd>
                </>
              )}
              {s.gitBranch && (
                <>
                  <dt>Branch</dt>
                  <dd>{s.gitBranch}</dd>
                </>
              )}
            </>
          ) : (
            <>
              <dt>Source</dt>
              <dd>kanban / bot-mode worker</dd>
            </>
          )}
          {tasks.length > 0 && (
            <>
              <dt>Work orders</dt>
              <dd>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {tasks.map((t) => (
                    <li key={`${t.board ?? "default"}:${t.id}`}>
                      {t.title}
                      {t.board ? <span className="board-tag">{t.boardName ?? t.board}</span> : null}{" "}
                      <span className={`badge ${t.status}`}>{t.status}</span>
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}
        </dl>
      </div>
    </div>
  );
}
