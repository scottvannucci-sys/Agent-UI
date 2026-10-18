import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Locates the Hermes home directory (the desktop app's data root).
 *
 * Resolution order:
 *  1. AGENT_UI_HERMES_HOME env var
 *  2. %LOCALAPPDATA%\hermes                          (Windows desktop install)
 *  3. $XDG_DATA_HOME/hermes or ~/.local/share/hermes (Linux)
 *  4. $XDG_CONFIG_HOME/hermes or ~/.config/hermes    (Linux)
 *  5. ~/.hermes
 *  6. ~/Library/Application Support/hermes           (macOS)
 */
/** All locations considered for the Hermes home, in priority order. */
export function hermesHomeCandidates(): string[] {
  const candidates: string[] = [];
  if (process.env.AGENT_UI_HERMES_HOME) candidates.push(process.env.AGENT_UI_HERMES_HOME);
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) candidates.push(path.join(localAppData, "hermes"));
  const xdgData = process.env.XDG_DATA_HOME;
  candidates.push(
    xdgData ? path.join(xdgData, "hermes") : path.join(os.homedir(), ".local", "share", "hermes"),
  );
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  candidates.push(
    xdgConfig ? path.join(xdgConfig, "hermes") : path.join(os.homedir(), ".config", "hermes"),
  );
  candidates.push(path.join(os.homedir(), ".hermes"));
  candidates.push(
    path.join(os.homedir(), "Library", "Application Support", "hermes"),
  );
  return candidates;
}

/** Files that distinguish a real Hermes home from an unrelated directory. */
const HOME_MARKERS = ["state.db", "kanban.db", "gateway_state.json", "spawn-ledger.json"];

function looksLikeHermesHome(dir: string): boolean {
  return HOME_MARKERS.some((m) => fs.existsSync(path.join(dir, m)));
}

export function findHermesHome(): string | null {
  // An explicit override is used as-is (the user knows their setup).
  const override = process.env.AGENT_UI_HERMES_HOME;
  if (override) return override;
  const candidates = hermesHomeCandidates();
  // A directory merely existing isn't enough (e.g. a config-only
  // ~/.config/hermes shadows the real home) — require a marker file first.
  for (const c of candidates) {
    if (fs.existsSync(c) && looksLikeHermesHome(c)) return c;
  }
  return null;
}

export function stateDbPath(home: string): string {
  return path.join(home, "state.db");
}

export function kanbanDbPath(home: string): string {
  return path.join(home, "kanban.db");
}

/** Root of the additional named kanban boards: <home>/kanban/boards. */
export function kanbanBoardsDir(home: string): string {
  return path.join(home, "kanban", "boards");
}

/** kanban.db for a board: the default board lives at <home>/kanban.db (back-compat). */
export function kanbanBoardDbPath(home: string, slug: string): string {
  return slug === "default"
    ? path.join(home, "kanban.db")
    : path.join(kanbanBoardsDir(home), slug, "kanban.db");
}

export function gatewayStatePath(home: string): string {
  return path.join(home, "gateway_state.json");
}

export function spawnLedgerPath(home: string): string {
  return path.join(home, "spawn-ledger.json");
}

export function botRosterPath(home: string): string {
  return path.join(home, "bot_relay", "roster.json");
}

/**
 * Best-effort: read the port of a live `hermes serve` process from the
 * spawn ledger. Returns null when nothing is running.
 */
export function discoverServeEndpoint(home: string): { host: string; port: number } | null {
  try {
    const raw = fs.readFileSync(spawnLedgerPath(home), "utf8");
    const entries = JSON.parse(raw) as Array<{
      pid: number;
      purpose?: string;
      port?: number;
      host?: string;
    }>;
    for (const e of entries) {
      if (/(serve|dashboard|gateway|api)/.test(e.purpose ?? "") && e.port) {
        return { host: e.host || "127.0.0.1", port: e.port };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}
