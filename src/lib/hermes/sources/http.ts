import { discoverServeEndpoint, findHermesHome } from "../paths";
import type {
  GatewayStatus,
  HermesMessage,
  HermesSession,
  HermesSnapshot,
  HermesTask,
  HermesTaskRun,
  HermesRoster,
} from "../types";

/**
 * Talks to a live `hermes serve` / gateway HTTP API (the same backend the
 * Hermes Desktop app uses). Best-effort: any failure throws and the store
 * falls back to the SQLite adapter.
 */

function base(): string | null {
  const env = process.env.AGENT_UI_HERMES_URL;
  if (env) return env.replace(/\/$/, "");
  const home = findHermesHome();
  if (!home) return null;
  const ep = discoverServeEndpoint(home);
  if (!ep) return null;
  return `http://${ep.host}:${ep.port}`;
}

function authHeaders(): HeadersInit {
  const tok = process.env.HERMES_WEB_TOKEN;
  return tok ? { Authorization: `Bearer ${tok}` } : {};
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", ...authHeaders() },
    signal: AbortSignal.timeout(4000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return (await res.json()) as T;
}

const num = (v: unknown, d = 0): number => (typeof v === "number" ? v : d);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapSession(s: any): HermesSession {
  return {
    id: String(s.id),
    source: str(s.source) ?? "unknown",
    model: str(s.model),
    startedAt: num(s.started_at),
    endedAt: s.ended_at ? num(s.ended_at) : null,
    lastActivityAt: num(s.last_activity_at ?? s.started_at),
    messageCount: num(s.message_count),
    toolCallCount: num(s.tool_call_count),
    inputTokens: num(s.input_tokens),
    outputTokens: num(s.output_tokens),
    costUsd: s.actual_cost_usd ?? s.estimated_cost_usd ?? null,
    cwd: str(s.cwd),
    gitBranch: str(s.git_branch),
    title: str(s.title),
    lastActivityDescription: str(s.last_activity_description),
    archived: !!s.archived,
    hidden: !!s.hidden,
  };
}

function mapMessage(m: any): HermesMessage {
  return {
    id: num(m.id, Math.random()),
    sessionId: String(m.session_id ?? m.sessionId ?? ""),
    role: (m.role as HermesMessage["role"]) ?? "system",
    content: typeof m.content === "string" ? m.content.slice(0, 600) : null,
    toolName: str(m.tool_name ?? m.toolName),
    timestamp: num(m.timestamp),
    displayKind: str(m.display_kind ?? m.displayKind),
  };
}

function mapTask(t: any): HermesTask {
  return {
    id: String(t.id),
    title: String(t.title ?? t.id),
    status: String(t.status ?? "todo"),
    assignee: str(t.assignee),
    priority: num(t.priority),
    createdAt: num(t.created_at),
    branchName: str(t.branch_name),
    workspacePath: str(t.workspace_path),
  };
}

function mapRun(r: any): HermesTaskRun {
  return {
    id: num(r.id),
    taskId: String(r.task_id),
    status: String(r.status ?? "done"),
    outcome: str(r.outcome),
    profile: str(r.profile),
    startedAt: num(r.started_at),
    endedAt: r.ended_at ? num(r.ended_at) : null,
  };
}

export async function fetchHttpSnapshot(): Promise<HermesSnapshot> {
  const b = base();
  if (!b) throw new Error("no hermes serve endpoint discovered");
  const degradations: string[] = [];

  const sessionsRaw = await getJson<any>(`${b}/api/sessions`).catch(() => null);
  if (!sessionsRaw) throw new Error(`/api/sessions unavailable at ${b}`);

  const list: any[] = Array.isArray(sessionsRaw)
    ? sessionsRaw
    : Array.isArray(sessionsRaw?.sessions)
      ? sessionsRaw.sessions
      : [];

  const tasksRaw = await getJson<any>(`${b}/api/plugins/kanban/board`).catch(() => null);
  let tasks: HermesTask[] = [];
  let runs: HermesTaskRun[] = [];
  if (tasksRaw) {
    const tl = Array.isArray(tasksRaw) ? tasksRaw : (tasksRaw?.tasks ?? []);
    tasks = tl.map(mapTask).slice(0, 60);
    const rl = Array.isArray(tasksRaw?.runs) ? tasksRaw.runs : [];
    runs = rl.map(mapRun).slice(0, 60);
  } else {
    degradations.push("kanban plugin API unreachable — work orders unavailable");
  }

  const statusRaw = await getJson<any>(`${b}/api/status`).catch(() => null);
  let gateway: GatewayStatus = { running: false };
  if (statusRaw) {
    gateway = {
      running: true,
      pid: num(statusRaw?.pid) || undefined,
      version: str(statusRaw?.version),
      activeAgents: num(statusRaw?.active_agents, 0),
    };
  } else {
    degradations.push("gateway status endpoint unreachable");
  }

  let roster: HermesRoster = { agents: [], updatedAt: null };
  const rosterRaw = await getJson<any>(`${b}/api/bots/roster`).catch(() => null);
  if (rosterRaw) {
    roster = {
      agents: (Array.isArray(rosterRaw) ? rosterRaw : (rosterRaw?.agents ?? [])).map(
        (a: any) => (typeof a === "string" ? a : String(a?.name ?? a?.id ?? "")),
      ).filter(Boolean),
      updatedAt: Date.now() / 1000,
    };
  }

  return {
    fetchedAt: Date.now(),
    source: "http",
    sessions: list.map(mapSession),
    recentMessages: [],
    tasks,
    runs,
    gateway,
    roster,
    degradations,
  };
}
