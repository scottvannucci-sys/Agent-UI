import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  botRosterPath,
  discoverServeEndpoint,
  gatewayStatePath,
  kanbanBoardDbPath,
  kanbanBoardsDir,
  kanbanDbPath,
  stateDbPath,
} from "../paths";
import type {
  GatewayStatus,
  HermesMessage,
  HermesRoster,
  HermesSession,
  HermesSnapshot,
  HermesTask,
  HermesTaskRun,
} from "../types";

/**
 * Reads Hermes Desktop's SQLite stores read-only. This works whether or not
 * the desktop app / gateway is currently running, and never writes to
 * Hermes' files (WAL readers are safe alongside the live writer).
 */

const MESSAGE_WINDOW_SECONDS = 60 * 60 * 48; // keep 48h of traffic for bubbles
const MAX_MESSAGES = 400;

interface SqliteSessionRow {
  id: string;
  source: string | null;
  model: string | null;
  started_at: number;
  ended_at: number | null;
  last_activity_at: number | null;
  message_count: number | null;
  tool_call_count: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  cwd: string | null;
  git_branch: string | null;
  title: string | null;
  last_activity_description: string | null;
  archived: number | null;
  hidden: number | null;
}

interface SqliteMessageRow {
  id: number;
  session_id: string;
  role: string;
  content: string | null;
  tool_name: string | null;
  timestamp: number;
  display_kind: string | null;
}

function mapMessage(r: SqliteMessageRow): HermesMessage {
  return {
    id: r.id,
    sessionId: r.session_id,
    role: (r.role as HermesMessage["role"]) ?? "system",
    content: r.content,
    toolName: r.tool_name,
    timestamp: r.timestamp,
    displayKind: r.display_kind,
  };
}

function openReadOnly(file: string): DatabaseSync | null {
  if (!fs.existsSync(file)) return null;
  try {
    return new DatabaseSync(file, { readOnly: true });
  } catch {
    try {
      // Older node builds may lack the readOnly option — open normally but
      // only ever run SELECTs.
      return new DatabaseSync(file);
    } catch {
      return null;
    }
  }
}

function mapSession(r: SqliteSessionRow): HermesSession {
  return {
    id: r.id,
    source: r.source ?? "unknown",
    model: r.model,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    lastActivityAt: r.last_activity_at ?? r.started_at,
    messageCount: r.message_count ?? 0,
    toolCallCount: r.tool_call_count ?? 0,
    inputTokens: r.input_tokens ?? 0,
    outputTokens: r.output_tokens ?? 0,
    costUsd: r.actual_cost_usd ?? r.estimated_cost_usd,
    cwd: r.cwd,
    gitBranch: r.git_branch,
    title: r.title,
    lastActivityDescription: r.last_activity_description,
    archived: !!r.archived,
    hidden: !!r.hidden,
  };
}

function readSessions(db: DatabaseSync): HermesSession[] {
  const rows = db
    .prepare(
      `select id, source, model, started_at, ended_at, last_activity_at,
              message_count, tool_call_count, input_tokens, output_tokens,
              estimated_cost_usd, actual_cost_usd, cwd, git_branch, title,
              last_activity_description, archived, hidden
       from sessions
       where coalesce(hidden,0) = 0 and coalesce(archived,0) = 0
       order by coalesce(last_activity_at, started_at) desc
       limit 60`,
    )
    .all() as unknown as SqliteSessionRow[];
  return rows.map(mapSession);
}

function readRecentMessages(db: DatabaseSync): HermesMessage[] {
  const cutoff = Date.now() / 1000 - MESSAGE_WINDOW_SECONDS;
  const rows = db
    .prepare(
      `select * from (
         select id, session_id, role, substr(coalesce(content,''),1,600) as content,
                tool_name, timestamp, display_kind
         from messages
         where timestamp > ?
         order by timestamp desc
         limit ${MAX_MESSAGES}
       ) order by timestamp asc`,
    )
    .all(cutoff) as unknown as SqliteMessageRow[];

  // Fallback so every bot has a real "latest activity" even when nothing
  // happened recently: the single newest message per session.
  let latest = rows;
  if (rows.length < 40) {
    const perSession = db
      .prepare(
        `select m.id, m.session_id, m.role,
                substr(coalesce(m.content,''),1,600) as content,
                m.tool_name, m.timestamp, m.display_kind
         from messages m
         join (select session_id, max(id) as mid from messages group by session_id) t
           on t.session_id = m.session_id and t.mid = m.id
         order by m.timestamp desc
         limit 40`,
      )
      .all() as unknown as SqliteMessageRow[];
    const seen = new Set(rows.map((r) => r.id));
    latest = [...rows, ...perSession.filter((r) => !seen.has(r.id))].sort(
      (a, b) => a.timestamp - b.timestamp,
    );
  }
  return latest.map(mapMessage);
}

interface BoardInfo {
  slug: string;
  name: string;
  dbPath: string;
}

/**
 * Enumerate kanban boards: the default board's DB lives at <home>/kanban.db
 * (back-compat) and named boards at <home>/kanban/boards/<slug>/kanban.db,
 * with display metadata in board.json (Hermes ≥ boards support).
 */
function listBoards(home: string): BoardInfo[] {
  const boards: BoardInfo[] = [{ slug: "default", name: "Default", dbPath: kanbanDbPath(home) }];
  try {
    const root = kanbanBoardsDir(home);
    if (!fs.existsSync(root)) return boards;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith("_")) continue; // skip _archived
      const dbPath = kanbanBoardDbPath(home, entry.name);
      if (!fs.existsSync(dbPath)) continue; // metadata-only / no tasks yet
      let name = entry.name;
      try {
        const meta = JSON.parse(
          fs.readFileSync(path.join(root, entry.name, "board.json"), "utf8"),
        ) as { name?: string };
        if (meta.name) name = meta.name;
      } catch {
        /* slug as name */
      }
      boards.push({ slug: entry.name, name, dbPath });
    }
  } catch {
    /* best effort — default board still works */
  }
  return boards;
}

function readKanban(home: string, deg: string[]): { tasks: HermesTask[]; runs: HermesTaskRun[] } {
  // Optional filter: comma-separated board slugs (default = all boards).
  const filter = (process.env.AGENT_UI_KANBAN_BOARDS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  let boards = listBoards(home);
  if (filter.length) boards = boards.filter((b) => filter.includes(b.slug));

  const tasks: HermesTask[] = [];
  const runs: HermesTaskRun[] = [];
  let opened = 0;

  for (const b of boards) {
    if (!fs.existsSync(b.dbPath)) continue;
    const db = openReadOnly(b.dbPath);
    if (!db) {
      deg.push(`kanban board "${b.slug}" unreadable`);
      continue;
    }
    opened++;
    try {
      const trows = db
        .prepare(
          `select id, title, status, assignee, priority, created_at, branch_name, workspace_path
           from tasks order by created_at desc limit 60`,
        )
        .all() as unknown as Array<{
        id: string;
        title: string;
        status: string;
        assignee: string | null;
        priority: number | null;
        created_at: number;
        branch_name: string | null;
        workspace_path: string | null;
      }>;
      for (const t of trows) {
        tasks.push({
          id: t.id,
          title: t.title,
          status: t.status,
          assignee: t.assignee,
          priority: t.priority ?? 0,
          createdAt: t.created_at,
          branchName: t.branch_name,
          workspacePath: t.workspace_path,
          board: b.slug === "default" ? undefined : b.slug,
          boardName: b.slug === "default" ? undefined : b.name,
        });
      }
      const rrows = db
        .prepare(
          `select id, task_id, status, outcome, profile, started_at, ended_at, last_heartbeat_at
           from task_runs order by id desc limit 60`,
        )
        .all() as unknown as Array<{
        id: number;
        task_id: string;
        status: string;
        outcome: string | null;
        profile: string | null;
        started_at: number;
        ended_at: number | null;
        last_heartbeat_at: number | null;
      }>;
      for (const r of rrows) {
        runs.push({
          id: r.id,
          taskId: r.task_id,
          status: r.status,
          outcome: r.outcome,
          profile: r.profile,
          startedAt: r.started_at,
          endedAt: r.ended_at,
          board: b.slug === "default" ? undefined : b.slug,
          lastHeartbeatAt: r.last_heartbeat_at,
        });
      }
    } catch (e) {
      deg.push(`kanban board "${b.slug}": ${String(e).slice(0, 60)}`);
    } finally {
      db.close();
    }
  }

  if (!opened) {
    deg.push("kanban.db not found — work orders unavailable");
    return { tasks: [], runs: [] };
  }
  tasks.sort((a, b) => b.createdAt - a.createdAt);
  runs.sort((a, b) => b.id - a.id);
  return { tasks: tasks.slice(0, 120), runs: runs.slice(0, 120) };
}

const GATEWAY_RUNNING_WORDS = new Set([
  "running",
  "online",
  "started",
  "active",
  "healthy",
  "up",
  "ok",
  "ready",
  // the process is alive even if a platform is failing
  "degraded",
  "partial",
  "starting",
  "restarting",
  "recovering",
  "busy",
]);
const GATEWAY_STOPPED_WORDS = new Set([
  "stopped",
  "offline",
  "exited",
  "crashed",
  "down",
  "error",
  "failed",
  "fatal",
  "inactive",
  "disabled",
]);
const GATEWAY_HEALTHY_PLATFORM_STATES = new Set([
  "connected",
  "ok",
  "running",
  "healthy",
  "active",
  "ready",
  "listening",
  "up",
]);

interface GatewayPlatformRaw {
  name: string;
  state: string;
  error?: string | null;
  needsAttention?: boolean;
}

function parseGatewayPlatforms(input: unknown): GatewayPlatformRaw[] {
  const out: GatewayPlatformRaw[] = [];
  if (Array.isArray(input)) {
    for (const v of input) {
      if (v && typeof v === "object") {
        const p = v as Record<string, unknown>;
        const name = String(p.name ?? p.platform ?? p.id ?? "");
        if (name) {
          out.push({
            name,
            state: String(p.state ?? p.status ?? "unknown"),
            error: typeof p.error_message === "string" ? p.error_message : null,
            needsAttention: p.needs_attention === true,
          });
        }
      }
    }
  } else if (input && typeof input === "object") {
    for (const [name, v] of Object.entries(input as Record<string, unknown>)) {
      if (v && typeof v === "object") {
        const p = v as Record<string, unknown>;
        out.push({
          name,
          state: String(p.state ?? p.status ?? "unknown"),
          error: typeof p.error_message === "string" ? p.error_message : null,
          needsAttention: p.needs_attention === true,
        });
      } else if (typeof v === "string") {
        out.push({ name, state: v });
      }
    }
  }
  return out;
}

/**
 * Parse gateway_state.json tolerantly — Hermes builds have shipped a few
 * shapes (flat desktop style, nested objects, status strings, booleans).
 * Returns null when the file is missing or the shape is unrecognized.
 */
function parseGatewayJson(raw: string): GatewayStatus | null {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!j || typeof j !== "object") return null;
  let o = j as Record<string, unknown>;
  for (const key of ["gateway", "hermes", "gateway_state_json"]) {
    const inner = o[key];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      o = inner as Record<string, unknown>;
      break;
    }
  }

  let running: boolean | undefined;
  let rawState: string | null = null;
  for (const k of ["gateway_state", "state", "status", "gateway_status", "health"]) {
    const v = o[k];
    if (typeof v === "string") {
      const s = v.toLowerCase();
      if (GATEWAY_RUNNING_WORDS.has(s) || GATEWAY_STOPPED_WORDS.has(s)) {
        rawState = v;
        running = GATEWAY_RUNNING_WORDS.has(s);
        break;
      }
    }
  }
  if (running === undefined && typeof o.running === "boolean") running = o.running;
  if (running === undefined && typeof o.is_running === "boolean") running = o.is_running;
  if (running === undefined) return null;

  const platforms = parseGatewayPlatforms(o.platforms);
  const degraded =
    (rawState?.toLowerCase() === "degraded") ||
    (running &&
      platforms.length > 0 &&
      platforms.some((p) => !GATEWAY_HEALTHY_PLATFORM_STATES.has(p.state.toLowerCase())));

  const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
  // Epoch seconds, epoch millis, or null — Linux /proc-style start times
  // (seconds since boot) are not dates and become null.
  const ts = (v: unknown): number | null | undefined => {
    if (typeof v !== "number") return undefined;
    if (v > 1.2e12) return v / 1000;
    if (v > 1.1e9) return v;
    return null;
  };
  return {
    running,
    degraded,
    rawState,
    pid: num(o.pid),
    version:
      typeof o.code_version === "string"
        ? o.code_version
        : typeof o.version === "string"
          ? o.version
          : null,
    startedAt: ts(o.start_time) ?? ts(o.started_at) ?? ts(o.start_time_ms) ?? null,
    activeAgents: typeof o.active_agents === "number" ? o.active_agents : null,
    platforms: platforms.length ? platforms : undefined,
  };
}

/** Read the gateway state; null when missing/unreadable/unknown shape. */
function readGateway(home: string): GatewayStatus | null {
  try {
    return parseGatewayJson(fs.readFileSync(gatewayStatePath(home), "utf8"));
  } catch {
    return null;
  }
}

function readRoster(home: string): HermesRoster {
  try {
    const raw = fs.readFileSync(botRosterPath(home), "utf8");
    const j = JSON.parse(raw) as { agents?: unknown[]; updated_at?: number };
    const agents = (j.agents ?? [])
      .map((a) => {
        if (typeof a === "string") return a;
        if (a && typeof a === "object") {
          const o = a as Record<string, unknown>;
          return String(o.name ?? o.label ?? o.id ?? "");
        }
        return "";
      })
      .filter(Boolean);
    return { agents, updatedAt: j.updated_at ?? null };
  } catch {
    return { agents: [], updatedAt: null };
  }
}

export async function fetchSqliteSnapshot(home: string): Promise<HermesSnapshot> {
  const degradations: string[] = [];
  const db = openReadOnly(stateDbPath(home));
  if (!db) throw new Error(`state.db not found under ${home}`);
  let sessions: HermesSession[] = [];
  let messages: HermesMessage[] = [];
  try {
    sessions = readSessions(db);
    messages = readRecentMessages(db);
  } finally {
    db.close();
  }
  const { tasks, runs } = readKanban(home, degradations);
  let gateway: GatewayStatus = { running: false };
  const gw = readGateway(home);
  if (gw) {
    gateway = gw;
    if (gw.degraded) {
      const bad = (gw.platforms ?? []).filter(
        (p) => !GATEWAY_HEALTHY_PLATFORM_STATES.has(p.state.toLowerCase()),
      );
      const detail = bad
        .map((p) => `${p.name} ${p.state}${p.error ? ` (${p.error.slice(0, 80)})` : ""}`)
        .join("; ");
      degradations.push(
        detail
          ? `Gateway degraded: ${detail}`
          : `Gateway degraded (${gw.rawState ?? "unknown state"})`,
      );
    }
  } else {
    // No usable gateway file: a headless `hermes serve` writes a spawn ledger
    // instead — if it lists a serve process, treat the gateway as up.
    const ep = discoverServeEndpoint(home);
    if (ep) {
      gateway = { running: true };
      degradations.push(
        `gateway_state.json missing/unrecognized — gateway inferred from spawn-ledger.json (port ${ep.port})`,
      );
    } else {
      degradations.push(
        `gateway_state.json not found under ${home} and no serve process in spawn-ledger.json — gateway shown offline`,
      );
    }
  }
  const roster = readRoster(home);
  return {
    fetchedAt: Date.now(),
    source: "sqlite",
    sessions,
    recentMessages: messages,
    tasks,
    runs,
    gateway,
    roster,
    degradations,
  };
}
