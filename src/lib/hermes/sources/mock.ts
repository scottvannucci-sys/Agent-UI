import type { HermesSnapshot, HermesSession, HermesTask, HermesTaskRun } from "../types";

/**
 * Demo simulator: a living Dunder Bots office even when Hermes isn't running
 * (or when you want to show the UI around). Emits the same snapshot shape as
 * the live adapters, so every downstream feature behaves identically.
 */

interface MockBot {
  key: string;
  name: string;
  role: string;
  status: "working" | "idle" | "coffee" | "away";
  nextFlip: number;
  tokens: number;
  cost: number;
  msgs: number;
  tools: number;
  cwd: string;
  model: string;
}

const ROSTER: Array<{ name: string; role: string; cwd: string; model: string }> = [
  { name: "michael.bot", role: "Regional Manager", cwd: "C:\\Dunder Bots\\Sales Strategy", model: "glm-5.3" },
  { name: "dwight.bot", role: "Asst. Regional Manager", cwd: "C:\\Dunder Bots\\Schrute Farms Ledger", model: "glm-5.3" },
  { name: "jim.bot", role: "Sales", cwd: "C:\\Dunder Bots\\Pipeline_Factory", model: "gpt-5.6-sol" },
  { name: "pam.bot", role: "Reception", cwd: "C:\\Dunder Bots\\Office Admin", model: "glm-5.3-flash" },
  { name: "kevin.bot", role: "Accounting", cwd: "C:\\Dunder Bots\\Chili Recipes DB", model: "glm-5.3-flash" },
  { name: "angela.bot", role: "Accounting", cwd: "C:\\Dunder Bots\\Audit Trail", model: "gpt-5.6-sol" },
  { name: "oscar.bot", role: "Accounting", cwd: "C:\\Dunder Bots\\Q3 Forecast", model: "glm-5.3" },
  { name: "creed.bot", role: "Quality Assurance", cwd: "C:\\Dunder Bots\\???", model: "hermes-local" },
  { name: "meredith.bot", role: "Supplier Relations", cwd: "C:\\Dunder Bots\\Warehouse Ops", model: "glm-5.3-flash" },
  { name: "toby.bot", role: "Human Resources", cwd: "C:\\Dunder Bots\\HR Complaints", model: "gpt-5.6-sol" },
];

const TOOL_NAMES = ["patch", "terminal", "browser", "search", "edit", "terminal", "patch"];

const QUIPS: Record<string, string[]> = {
  working: [
    "Running the TPS report generator…",
    "Fact: this branch is kept in Scranton.",
    "Merging. Carefully. Like a hedgehog.",
    "The printer may be involved. It's always the printer.",
    "Selling paper. Digitally. To bots.",
    "Refactoring the beet inventory ledger.",
    "I declare… a successful deploy!",
    "Patching LegacyInventory.psm1 again.",
    "95 tests passed. Not a record, but fine.",
    "Bears, beets, binary search.",
    "Updating the Dunder Mifflin Infinity roadmap.",
    "Limitless paper in the cloud. Limitless!",
  ],
  idle: [
    "Waiting on review. Again.",
    "Coffee break. The good stuff, not the break room stuff.",
    "Watching the warehouse. From here.",
    "Filing. Physically. It's a long story.",
  ],
};

const TASK_TITLES = [
  "Refactor the Dunder Mifflin invoice pipeline",
  "TPS report generator v2",
  "Fix the printer (it is always the printer)",
  "Dundie Awards microsite",
  "Migrate beet inventory to SQLite",
  "Sabre cloud cost audit",
  "Update the fire-drill runbook",
  "Scrabble-bot branch protection",
  "Ream inventory re-sync",
  "Michael's 'World's Best Boss' mug restock",
];

const ASSIGNEES = ["dwight.bot", "jim.bot", "kevin.bot", "angela.bot", "oscar.bot", "creed.bot", "pam.bot"];

function makeBots(): MockBot[] {
  const now = Date.now() / 1000;
  return ROSTER.map((r, i) => ({
    key: `mock_${i}`,
    name: r.name,
    role: r.role,
    status: i === 0 ? "idle" : "working",
    nextFlip: now + 15 + i * 7,
    tokens: 40_000 + i * 21_137,
    cost: 0.8 + i * 0.42,
    msgs: 12 + i * 5,
    tools: 4 + i * 3,
    cwd: r.cwd,
    model: r.model,
  }));
}

interface MockState {
  bots: MockBot[];
  tasks: HermesTask[];
  runs: HermesTaskRun[];
  messages: Array<{ id: number; key: string; role: "assistant" | "tool"; text: string; ts: number }>;
  msgId: number;
  taskSeq: number;
  runSeq: number;
}

const g = globalThis as unknown as { __agentUiMock?: MockState };

function state(): MockState {
  if (!g.__agentUiMock) {
    const now = Date.now() / 1000;
    g.__agentUiMock = {
      bots: makeBots(),
      tasks: TASK_TITLES.slice(0, 5).map((t, i) => ({
        id: `mock-task-${i}`,
        title: t,
        status: i === 0 ? "in_progress" : i === 1 ? "in_progress" : i === 2 ? "blocked" : "todo",
        assignee: ASSIGNEES[i % ASSIGNEES.length],
        priority: i,
        createdAt: now - (i + 1) * 3600,
        branchName: `wt/dunder-${i}`,
        workspacePath: `C:\\Hermes\\wt\\dunder-${i}`,
      })),
      runs: [
        {
          id: 1,
          taskId: "mock-task-0",
          status: "running",
          outcome: null,
          profile: "default",
          startedAt: now - 600,
          endedAt: null,
        },
      ],
      messages: [],
      msgId: 1,
      taskSeq: 5,
      runSeq: 2,
    };
  }
  return g.__agentUiMock;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function advance(st: MockState): void {
  const now = Date.now() / 1000;
  for (const b of st.bots) {
    if (now < b.nextFlip) continue;
    // flip status and say something
    const roll = Math.random();
    if (b.status === "working") {
      b.status = roll < 0.55 ? "idle" : "working";
    } else {
      b.status = roll < 0.8 ? "working" : "coffee";
    }
    if (b.status === "working") {
      const tool = pick(TOOL_NAMES);
      const text = tool === "patch" ? "patch: LegacyInventory.psm1 (+42 −7)" : `${tool}: ${pick(QUIPS.working)}`;
      st.messages.push({ id: st.msgId++, key: b.key, role: tool === "patch" ? "tool" : "assistant", text, ts: now });
      b.tools += 1;
      b.tokens += Math.floor(2000 + Math.random() * 30_000);
      b.cost += Math.random() * 0.12;
    } else {
      st.messages.push({ id: st.msgId++, key: b.key, role: "assistant", text: pick(QUIPS.idle), ts: now });
    }
    b.nextFlip = now + 8 + Math.random() * 25;
  }
  // occasionally create a task
  if (Math.random() < 0.06 && st.tasks.length < 12) {
    const title = pick(TASK_TITLES);
    st.tasks.push({
      id: `mock-task-${st.taskSeq++}`,
      title,
      status: "todo",
      assignee: pick(ASSIGNEES),
      priority: Math.floor(Math.random() * 5),
      createdAt: now,
      branchName: null,
      workspacePath: null,
    });
  }
  // occasionally complete a run / flip task status
  if (Math.random() < 0.1) {
    const running = st.runs.find((r) => r.status === "running");
    if (running) {
      running.status = "done";
      running.outcome = "completed";
      running.endedAt = now;
      const t = st.tasks.find((x) => x.id === running.taskId);
      if (t) t.status = "done";
    } else {
      const candidate = st.tasks.find((t) => t.status === "todo");
      if (candidate) {
        candidate.status = "in_progress";
        st.runs.push({
          id: st.runSeq++,
          taskId: candidate.id,
          status: "running",
          outcome: null,
          profile: "default",
          startedAt: now,
          endedAt: null,
        });
      }
    }
  }
  if (st.messages.length > 60) st.messages = st.messages.slice(-60);
  if (st.runs.length > 20) st.runs = st.runs.slice(-20);
}

function toSession(b: MockBot, idx: number): HermesSession {
  return {
    id: b.key,
    source: idx === 4 ? "cron" : "desktop",
    model: b.model,
    startedAt: Date.now() / 1000 - 3600 * (2 + idx),
    endedAt: null,
    lastActivityAt: Date.now() / 1000,
    messageCount: b.msgs,
    toolCallCount: b.tools,
    inputTokens: Math.floor(b.tokens * 0.85),
    outputTokens: Math.floor(b.tokens * 0.15),
    costUsd: b.cost,
    cwd: b.cwd,
    gitBranch: idx % 2 ? "main" : "feature/paper",
    title: `${b.name} — ${b.role}`,
    lastActivityDescription: null,
    archived: false,
    hidden: false,
  };
}

export async function fetchMockSnapshot(): Promise<HermesSnapshot> {
  const st = state();
  advance(st);
  const sessions = st.bots.map(toSession);
  const messages = st.messages.map((m) => ({
    id: m.id,
    sessionId: m.key,
    role: m.role,
    content: m.text,
    toolName: m.role === "tool" ? m.text.split(":")[0] : null,
    timestamp: m.ts,
    displayKind: null,
  }));
  return {
    fetchedAt: Date.now(),
    source: "mock",
    sessions,
    recentMessages: messages,
    tasks: st.tasks.slice(-12),
    runs: st.runs.slice(-12),
    gateway: { running: true, pid: 28584, version: "0.21.5-demo", activeAgents: st.runs.filter((r) => r.status === "running").length },
    roster: { agents: st.bots.map((b) => b.name), updatedAt: Date.now() / 1000 },
    degradations: ["Demo mode — showing simulated Dunder Bots staff (no live Hermes connection)"],
  };
}
