/**
 * Shared Hermes data contract.
 *
 * These types are the boundary between Hermes Desktop's storage (SQLite DBs +
 * JSON state files under the Hermes home directory, or its local HTTP API)
 * and the office visualization. Everything the office scene consumes is
 * derived from a `HermesSnapshot`.
 */

export interface HermesSession {
  id: string;
  source: string; // "desktop" | "cron" | platform name...
  model: string | null;
  startedAt: number; // epoch seconds
  endedAt: number | null;
  lastActivityAt: number | null;
  messageCount: number;
  toolCallCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  cwd: string | null;
  gitBranch: string | null;
  title: string | null;
  lastActivityDescription: string | null;
  archived: boolean;
  hidden: boolean;
}

export interface HermesMessage {
  id: number;
  sessionId: string;
  role: "user" | "assistant" | "tool" | "system";
  /** Truncated display text (server trims long payloads). */
  content: string | null;
  toolName: string | null;
  timestamp: number; // epoch seconds
  displayKind: string | null;
}

export interface HermesTask {
  id: string;
  title: string;
  status: string; // todo | triage | in_progress | blocked | done ...
  assignee: string | null;
  priority: number;
  createdAt: number;
  branchName: string | null;
  workspacePath: string | null;
}

export interface HermesTaskRun {
  id: number;
  taskId: string;
  status: string; // running | done | blocked | crashed | timed_out | failed | released
  outcome: string | null; // completed | blocked | crashed | timed_out | ...
  profile: string | null;
  startedAt: number;
  endedAt: number | null;
}

export interface GatewayStatus {
  running: boolean;
  pid?: number;
  version?: string | null;
  startedAt?: number | null;
  activeAgents?: number | null;
}

export interface HermesRoster {
  agents: string[];
  updatedAt: number | null;
}

export interface HermesSnapshot {
  fetchedAt: number; // epoch ms
  source: "http" | "sqlite" | "mock";
  sessions: HermesSession[];
  /** Newest last, capped ring. */
  recentMessages: HermesMessage[];
  tasks: HermesTask[];
  runs: HermesTaskRun[];
  gateway: GatewayStatus;
  roster: HermesRoster;
  /** Non-fatal problems (missing DB, auth gate, ...) surfaced in the UI. */
  degradations: string[];
}

export type OfficeEventType =
  | "bot_message"
  | "tool_call"
  | "bot_spawned"
  | "bot_ended"
  | "task_created"
  | "task_status"
  | "run_update"
  | "gateway"
  | "ambient";

export interface OfficeEvent {
  id: number;
  type: OfficeEventType;
  ts: number; // epoch ms
  sessionId?: string;
  taskId?: string;
  /** Short text suitable for a speech bubble or feed line. */
  text: string;
  meta?: Record<string, unknown>;
}

export interface FeedItem {
  id: number;
  ts: number;
  botId: string;
  botName: string;
  kind: string;
  text: string;
}

/** Client-side snapshot: snapshot + rolling event/feed state combined. */
export interface OfficeClientState {
  snapshot: HermesSnapshot | null;
  events: OfficeEvent[];
  feed: FeedItem[];
  connected: boolean;
  sourceLabel: string;
}
