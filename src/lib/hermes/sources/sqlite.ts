import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  botRosterPath,
  gatewayStatePath,
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

function readKanban(home: string, deg: string[]): { tasks: HermesTask[]; runs: HermesTaskRun[] } {
  const db = openReadOnly(kanbanDbPath(home));
  if (!db) {
    deg.push("kanban.db not found — work orders unavailable");
    return { tasks: [], runs: [] };
  }
  try {
    const tasks = db
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
    const runs = db
      .prepare(
        `select id, task_id, status, outcome, profile, started_at, ended_at
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
    }>;
    return {
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        assignee: t.assignee,
        priority: t.priority ?? 0,
        createdAt: t.created_at,
        branchName: t.branch_name,
        workspacePath: t.workspace_path,
      })),
      runs: runs.map((r) => ({
        id: r.id,
        taskId: r.task_id,
        status: r.status,
        outcome: r.outcome,
        profile: r.profile,
        startedAt: r.started_at,
        endedAt: r.ended_at,
      })),
    };
  } catch (e) {
    deg.push(`kanban.db unreadable: ${String(e).slice(0, 80)}`);
    return { tasks: [], runs: [] };
  } finally {
    db.close();
  }
}

function readGateway(home: string): GatewayStatus {
  const raw = fs.readFileSync(gatewayStatePath(home), "utf8");
  const j = JSON.parse(raw) as Record<string, unknown>;
  const state = String(j.gateway_state ?? "");
  return {
    running: state === "running",
    pid: typeof j.pid === "number" ? j.pid : undefined,
    version: (j.code_version as string) ?? null,
    startedAt: typeof j.start_time === "number" ? (j.start_time as number) / 1000 : null,
    activeAgents: (j.active_agents as number) ?? 0,
  };
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
  try {
    gateway = readGateway(home);
  } catch {
    degradations.push("gateway_state.json unreadable — gateway shown offline");
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
