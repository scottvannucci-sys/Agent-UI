import { deriveEvents } from "./derive";
import { findHermesHome } from "./paths";
import { fetchHttpSnapshot } from "./sources/http";
import { fetchMockSnapshot } from "./sources/mock";
import { fetchSqliteSnapshot } from "./sources/sqlite";
import type { HermesSnapshot, OfficeEvent } from "./types";

/**
 * Server-side singleton store: polls the best available Hermes source and
 * maintains the latest snapshot + a rolling event log. SSE clients subscribe
 * to changes.
 */

const MAX_EVENTS = 300;

export interface StoreState {
  snapshot: HermesSnapshot | null;
  events: OfficeEvent[];
  error: string | null;
  sourceTried: string[];
}

type Listener = (state: StoreState) => void;

interface Store {
  state: StoreState;
  listeners: Set<Listener>;
  timer: NodeJS.Timeout | null;
  polling: boolean;
  sourceName: string;
  lastSnapshotJson: string | null;
  mockMode: boolean;
}

const g = globalThis as unknown as { __agentUiStore?: Store };

let readyResolve: (() => void) | null = null;
let readyPromise: Promise<void> | null = null;

/** Resolves after the first successful poll (or immediately if data exists). */
export function ensureFirstTick(timeoutMs = 5000): Promise<void> {
  const s = store();
  if (s.state.snapshot) return Promise.resolve();
  if (!readyPromise) {
    readyPromise = new Promise<void>((res) => {
      readyResolve = res;
    });
    // never hang the route: cap the wait
    setTimeout(() => {
      if (readyResolve) {
        readyResolve();
        readyResolve = null;
      }
    }, timeoutMs).unref?.();
  }
  return readyPromise;
}

function store(): Store {
  if (!g.__agentUiStore) {
    g.__agentUiStore = {
      state: { snapshot: null, events: [], error: null, sourceTried: [] },
      listeners: new Set(),
      timer: null,
      polling: false,
      sourceName: "pending",
      lastSnapshotJson: null,
      mockMode: false,
    };
  }
  return g.__agentUiStore;
}

function sourceMode(): "auto" | "sqlite" | "http" | "mock" {
  const m = (process.env.AGENT_UI_SOURCE ?? "auto").toLowerCase();
  return m === "sqlite" || m === "http" || m === "mock" ? m : "auto";
}

function pollMs(): number {
  const n = Number(process.env.AGENT_UI_POLL_MS ?? 2000);
  return Number.isFinite(n) && n >= 500 ? n : 2000;
}

async function fetchOnce(s: Store): Promise<void> {
  const mode = sourceMode();
  const tried: string[] = [];
  let snap: HermesSnapshot | null = null;
  let lastErr: string | null = null;

  const home = findHermesHome();

  if (mode === "mock") {
    snap = await fetchMockSnapshot();
    tried.push("mock");
  } else {
    if (mode === "auto" || mode === "sqlite") {
      if (home) {
        try {
          snap = await fetchSqliteSnapshot(home);
          tried.push(`sqlite:${home}`);
        } catch (e) {
          lastErr = `sqlite: ${String(e).slice(0, 120)}`;
          tried.push("sqlite:failed");
        }
      } else {
        tried.push("sqlite:no-hermes-home");
      }
    }
    if (!snap && (mode === "auto" || mode === "http")) {
      try {
        snap = await fetchHttpSnapshot();
        tried.push("http");
      } catch (e) {
        lastErr = `http: ${String(e).slice(0, 120)}`;
        tried.push("http:failed");
      }
    }
    if (!snap) {
      snap = await fetchMockSnapshot();
      tried.push("mock(fallback)");
      if (lastErr) snap.degradations.unshift(`Live sources unavailable (${lastErr}) — demo mode active`);
      else snap.degradations.unshift("No live Hermes source found — demo mode active");
    }
  }

  const prev = s.state.snapshot;
  const events = deriveEvents(prev, snap);
  s.state = {
    snapshot: snap,
    events: [...s.state.events, ...events].slice(-MAX_EVENTS),
    error: null,
    sourceTried: tried,
  };
  s.sourceName = snap.source;
  s.mockMode = snap.source === "mock";
  if (readyResolve) {
    const res = readyResolve;
    readyResolve = null;
    res();
  }
  notify(s);
}

function notify(s: Store): void {
  for (const l of s.listeners) {
    try {
      l(s.state);
    } catch {
      /* listener died */
    }
  }
}

export function startStore(): Store {
  const s = store();
  if (s.timer || s.polling) return s;
  const tick = async () => {
    if (s.polling) return;
    s.polling = true;
    try {
      await fetchOnce(s);
    } catch (e) {
      s.state = { ...s.state, error: String(e).slice(0, 200) };
      notify(s);
    } finally {
      s.polling = false;
    }
  };
  void tick();
  s.timer = setInterval(tick, pollMs());
  if (s.timer.unref) s.timer.unref();
  return s;
}

export function getStoreState(): StoreState {
  const s = store();
  return s.state;
}

export function subscribeStore(l: Listener): () => void {
  const s = store();
  s.listeners.add(l);
  return () => s.listeners.delete(l);
}

export function storeSourceName(): string {
  return store().sourceName;
}
