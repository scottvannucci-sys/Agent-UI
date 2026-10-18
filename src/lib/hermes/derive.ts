import type {
  HermesMessage,
  HermesSession,
  HermesSnapshot,
  HermesTask,
  HermesTaskRun,
  OfficeEvent,
} from "./types";

export type Dept =
  | "management"
  | "sales"
  | "accounting"
  | "reception"
  | "qa"
  | "hr"
  | "warehouse"
  | "engineering";

export type BotStatus = "working" | "idle" | "coffee" | "away" | "stuck";

export interface BotSpec {
  id: string;
  name: string;
  role: string;
  dept: Dept;
  status: BotStatus;
  /** Current speech-bubble text (latest activity, ≤ 90 chars). */
  statusText: string;
  paletteSeed: number;
  session?: HermesSession;
  taskIds: string[];
  /** Epoch seconds the bot "joined" — recent joins walk in the door. */
  spawnTs: number;
  lastActivityAt: number;
}

/* ------------------------------------------------------------------ */
/* deterministic hashing → palettes / departments                      */
/* ------------------------------------------------------------------ */

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const DEPTS: Dept[] = [
  "sales",
  "sales",
  "accounting",
  "engineering",
  "qa",
  "reception",
  "hr",
  "warehouse",
  "sales",
  "accounting",
];

const ROLE_BY_DEPT: Record<Dept, string> = {
  management: "Regional Manager",
  sales: "Sales",
  accounting: "Accounting",
  reception: "Reception",
  qa: "Quality Assurance",
  hr: "Human Resources",
  warehouse: "Warehouse",
  engineering: "Engineering",
};

export function deptFor(seed: number): Dept {
  return DEPTS[seed % DEPTS.length];
}

export function roleFor(dept: Dept): string {
  return ROLE_BY_DEPT[dept];
}

export function displayNameForSession(s: HermesSession): string {
  if (s.title && s.title.trim()) return s.title.trim().slice(0, 28);
  if (s.cwd) {
    const base = s.cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
    if (base) return base.slice(0, 28);
  }
  return `Agent-${s.id.slice(-6)}`;
}

/* ------------------------------------------------------------------ */
/* tool message summarization                                          */
/* ------------------------------------------------------------------ */

export function summarizeTool(toolName: string | null, content: string | null): string {
  const tool = toolName || "tool";
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(content ?? "");
  } catch {
    /* not json */
  }
  const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  if (obj) {
    if (tool === "patch" && typeof obj.diff === "string") {
      const files = [...obj.diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]);
      const adds = (obj.diff.match(/^\+[^+]/gm) ?? []).length;
      const dels = (obj.diff.match(/^-[^-]/gm) ?? []).length;
      const f = files.length ? files[files.length - 1].split(/[\\/]/).pop() : "file";
      return `patch: ${f} (+${adds} −${dels})`;
    }
    if (tool === "terminal" && typeof obj.output === "string") {
      const line = obj.output.replace(/[\r\n]+/g, " ").trim().slice(0, 70);
      if (line) return `terminal: ${line}`;
    }
    if (tool === "browser" && (typeof obj.url === "string" || typeof obj.query === "string")) {
      const u = String(obj.url ?? obj.query).slice(0, 60);
      return `browser: ${u}`;
    }
    for (const key of ["command", "path", "file", "pattern", "name", "title"]) {
      if (typeof obj[key] === "string" && obj[key]) {
        return `${tool}: ${String(obj[key]).slice(0, 60)}`;
      }
    }
    if (typeof obj.output === "string" && obj.output.trim()) {
      return `${tool}: ${obj.output.replace(/[\r\n]+/g, " ").trim().slice(0, 60)}`;
    }
  }
  const plain = (content ?? "").replace(/[\r\n]+/g, " ").trim();
  return plain ? `${tool}: ${plain.slice(0, 60)}` : `${tool}: ok`;
}

export function bubbleTextForMessage(m: HermesMessage): string {
  if (m.role === "tool") return summarizeTool(m.toolName, m.content);
  const text = (m.content ?? "").replace(/[\r\n]+/g, " ").trim();
  if (!text) return "";
  return text.length > 90 ? `${text.slice(0, 89)}…` : text;
}

/* ------------------------------------------------------------------ */
/* snapshot diffing → events                                           */
/* ------------------------------------------------------------------ */

/** Cross-board composite key — Hermes task ids are only unique per board. */
function taskKey(board: string | undefined, id: string | number): string {
  return `${board ?? "default"}:${id}`;
}

export function deriveEvents(prev: HermesSnapshot | null, next: HermesSnapshot): OfficeEvent[] {
  const events: OfficeEvent[] = [];
  const ts = next.fetchedAt;
  let idBase = Math.floor(ts);

  if (prev) {
    const prevSessionIds = new Set(prev.sessions.map((s) => s.id));
    const prevMsgIds = new Set(prev.recentMessages.map((m) => m.id));
    const prevTasks = new Map(prev.tasks.map((t) => [taskKey(t.board, t.id), t]));
    const prevRuns = new Map(prev.runs.map((r) => [taskKey(r.board, r.id), r]));

    for (const s of next.sessions) {
      if (!prevSessionIds.has(s.id)) {
        events.push({
          id: idBase++,
          type: "bot_spawned",
          ts,
          sessionId: s.id,
          text: `${displayNameForSession(s)} clocked in`,
        });
      } else {
        const was = prev.sessions.find((x) => x.id === s.id);
        if (was && !was.endedAt && s.endedAt) {
          events.push({
            id: idBase++,
            type: "bot_ended",
            ts,
            sessionId: s.id,
            text: `${displayNameForSession(s)} clocked out`,
          });
        }
      }
    }
    for (const m of next.recentMessages) {
      if (prevMsgIds.has(m.id)) continue;
      const text = bubbleTextForMessage(m);
      if (!text) continue;
      events.push({
        id: idBase++,
        type: m.role === "tool" ? "tool_call" : "bot_message",
        ts: Math.floor(m.timestamp * 1000) || ts,
        sessionId: m.sessionId,
        text,
      });
    }
    for (const t of next.tasks) {
      const was = prevTasks.get(taskKey(t.board, t.id));
      if (!was) {
        events.push({
          id: idBase++,
          type: "task_created",
          ts,
          taskId: taskKey(t.board, t.id),
          text: `New work order: ${t.title}${t.board ? ` (${t.board})` : ""}`,
        });
      } else if (was.status !== t.status) {
        events.push({
          id: idBase++,
          type: "task_status",
          ts,
          taskId: taskKey(t.board, t.id),
          text: `${t.title}: ${was.status} → ${t.status}`,
        });
      }
    }
    for (const r of next.runs) {
      const was = prevRuns.get(taskKey(r.board, r.id));
      if (!was || was.status !== r.status || was.outcome !== r.outcome) {
        events.push({
          id: idBase++,
          type: "run_update",
          ts,
          taskId: taskKey(r.board, r.taskId),
          text: `Run #${r.id} ${r.status}${r.outcome ? ` (${r.outcome})` : ""}${r.board ? ` on ${r.board}` : ""}`,
        });
      }
    }
    if (prev.gateway.running !== next.gateway.running) {
      events.push({
        id: idBase++,
        type: "gateway",
        ts,
        text: next.gateway.running
          ? "Gateway back online — the boss is in."
          : "Gateway offline — the boss stepped out.",
      });
    }
  }
  return events;
}

/* ------------------------------------------------------------------ */
/* snapshot → bots                                                     */
/* ------------------------------------------------------------------ */

const WORKING_WINDOW = 120; // seconds since last activity
const IDLE_WINDOW = 60 * 60; // 1h
const COFFEE_WINDOW = 6 * 60 * 60; // 6h

export function deriveBots(snapshot: HermesSnapshot): BotSpec[] {
  const now = snapshot.fetchedAt / 1000;

  // latest message per session (for bubble text)
  const latestText = new Map<string, string>();
  for (const m of snapshot.recentMessages) {
    const t = bubbleTextForMessage(m);
    if (t) latestText.set(m.sessionId, t);
  }

  // Running work → per-task composite keys. A "running" run with no heartbeat
  // for 6h is a zombie (worker died mid-task) and doesn't count as working.
  const runningRuns = new Set<string>();
  for (const r of snapshot.runs) {
    if (r.status !== "running" || r.endedAt) continue;
    const lastSign = r.lastHeartbeatAt ?? r.startedAt;
    if (lastSign && now - lastSign > 6 * 3600) continue;
    runningRuns.add(taskKey(r.board, r.taskId));
  }
  // A task whose *status* is running counts even without a fresh run row.
  const tasksWithRunningStatus = new Set(
    snapshot.tasks.filter((t) => t.status === "running").map((t) => taskKey(t.board, t.id)),
  );
  const isTaskWorking = (t: HermesTask): boolean =>
    tasksWithRunningStatus.has(taskKey(t.board, t.id)) || runningRuns.has(taskKey(t.board, t.id));

  const taskByAssignee = new Map<string, string[]>();
  for (const t of snapshot.tasks) {
    if (!t.assignee) continue;
    const arr = taskByAssignee.get(t.assignee.toLowerCase()) ?? [];
    arr.push(taskKey(t.board, t.id));
    taskByAssignee.set(t.assignee.toLowerCase(), arr);
  }

  const bots: BotSpec[] = snapshot.sessions.map((s) => {
    const name = displayNameForSession(s);
    const seed = hashString(s.id + name);
    const dept = deptFor(seed);
    const last = s.lastActivityAt ?? s.startedAt;
    const age = now - last;

    let status: BotStatus;
    if (!s.endedAt && age < WORKING_WINDOW) status = "working";
    else if (age < IDLE_WINDOW) status = "idle";
    else if (age < COFFEE_WINDOW) status = "coffee";
    else status = "away";

    let statusText = latestText.get(s.id) ?? "";
    if (!statusText && s.lastActivityDescription) {
      statusText = s.lastActivityDescription.slice(0, 90);
    }
    if (!statusText) {
      statusText =
        s.toolCallCount > 0
          ? `${s.toolCallCount} tool calls · ${s.outputTokens.toLocaleString()} tok out`
          : "Onboarding paperwork…";
    }

    return {
      id: s.id,
      name,
      role: roleFor(dept),
      dept,
      status,
      statusText,
      paletteSeed: seed,
      session: s,
      taskIds: [],
      spawnTs: s.startedAt,
      lastActivityAt: last,
    };
  });

  // kanban workers with no session become bots too — one bot per assignee,
  // across all boards. Recency follows their newest task so stale queues
  // don't keep zombie employees in the office.
  const knownNames = new Set(bots.map((b) => b.name.toLowerCase()));
  const kanbanByAssignee = new Map<
    string,
    { newest: HermesTask; running: boolean; count: number }
  >();
  for (const t of snapshot.tasks) {
    if (!t.assignee) continue;
    const key = t.assignee.toLowerCase();
    const agg = kanbanByAssignee.get(key) ?? { newest: t, running: false, count: 0 };
    agg.count++;
    if (t.createdAt > agg.newest.createdAt) agg.newest = t;
    if (isTaskWorking(t)) agg.running = true;
    kanbanByAssignee.set(key, agg);
  }
  for (const [key, agg] of kanbanByAssignee) {
    if (knownNames.has(key)) continue;
    const t = agg.newest;
    const seed = hashString(t.assignee!);
    const dept = deptFor(seed);
    bots.push({
      id: `kanban:${key}`,
      name: t.assignee!,
      role: roleFor(dept),
      dept,
      status: agg.running ? "working" : "idle",
      statusText: agg.running
        ? `Working: ${t.title}${agg.count > 1 ? ` (+${agg.count - 1} more)` : ""}`
        : "Awaiting dispatch",
      paletteSeed: seed,
      taskIds: [],
      spawnTs: t.createdAt,
      lastActivityAt: agg.running ? now : t.createdAt,
    });
    knownNames.add(key);
  }
  for (const a of snapshot.roster.agents) {
    const key = a.toLowerCase();
    if (!knownNames.has(key)) {
      const seed = hashString(a);
      const dept = deptFor(seed);
      bots.push({
        id: `roster:${a}`,
        name: a,
        role: roleFor(dept),
        dept,
        status: "idle",
        statusText: "Bot-mode agent standing by",
        paletteSeed: seed,
        taskIds: [],
        spawnTs: now,
        lastActivityAt: now,
      });
      knownNames.add(key);
    }
  }

  // attach task ids to matching bots (assignee name match)
  for (const t of snapshot.tasks) {
    if (!t.assignee) continue;
    const assigneeKey = t.assignee.toLowerCase();
    const b = bots.find((x) => x.name.toLowerCase() === assigneeKey);
    if (b && !b.taskIds.includes(taskKey(t.board, t.id))) {
      b.taskIds.push(taskKey(t.board, t.id));
    }
    if (b && isTaskWorking(t) && b.status !== "working") b.status = "working";
  }

  // crashed runs → stuck status
  const crashCutoff = now - 15 * 60;
  for (const r of snapshot.runs) {
    if ((r.status === "crashed" || r.status === "failed") && (r.endedAt ?? r.startedAt) > crashCutoff) {
      const t = snapshot.tasks.find((x) => x.id === r.taskId);
      const b = t?.assignee
        ? bots.find((x) => x.name.toLowerCase() === t.assignee!.toLowerCase())
        : undefined;
      if (b) {
        b.status = "stuck";
        b.statusText = `Run #${r.id} ${r.status}${r.outcome ? ` (${r.outcome})` : ""} — needs a manager!`;
      }
    }
  }

  // keep the newest 14 in the office; the rest are "away" (roster panel only)
  const sorted = [...bots].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  for (let i = 0; i < sorted.length; i++) {
    if (i >= 14) sorted[i].status = "away";
  }
  return sorted;
}

export function fmtCost(usd: number | null | undefined): string {
  if (usd == null) return "—";
  return `$${usd.toFixed(2)}`;
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
