import type { Sprite } from "./sprites";

/**
 * Isomorphic pixel drawing core: everything renders through `PixelTarget.rect`,
 * so the same scene code drives the browser canvas and the Node preview tool.
 */
export interface PixelTarget {
  rect(x: number, y: number, w: number, h: number, color: string): void;
}

/** Draw a string-grid sprite at px,py with optional palette overrides. */
export function drawSpriteGrid(
  t: PixelTarget,
  s: Sprite,
  px: number,
  py: number,
  overrides?: Record<string, string>,
  flip = false,
): void {
  for (let j = 0; j < s.h; j++) {
    const row = s.rows[j];
    let runStart = 0;
    let runColor = "";
    for (let i = 0; i <= s.w; i++) {
      const ch = i < s.w ? (flip ? row[s.w - 1 - i] : row[i]) : ".";
      const c = ch === "." ? "" : overrides?.[ch] ?? s.palette[ch] ?? "";
      if (c !== runColor) {
        if (runColor) t.rect(px + runStart, py + j, i - runStart, 1, runColor);
        runStart = i;
        runColor = c;
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 3×5 pixel font                                                      */
/* ------------------------------------------------------------------ */

const F: Record<string, string[]> = {
  A: ["###", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: ["###", "#..", "#..", "#..", "###"],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: ["###", "#..", "#.#", "#.#", "###"],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  J: ["..#", "..#", "..#", "#.#", "###"],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#.#", "###", "###", "#.#", "#.#"],
  N: ["##.", "#.#", "#.#", "#.#", "#.#"],
  O: ["###", "#.#", "#.#", "#.#", "###"],
  P: ["###", "#.#", "###", "#..", "#.."],
  Q: ["###", "#.#", "###", "..#", "..#"],
  R: ["###", "#.#", "##.", "#.#", "#.#"],
  S: ["###", "#..", "###", "..#", "###"],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", "###"],
  V: ["#.#", "#.#", "#.#", "#.#", ".#."],
  W: ["#.#", "#.#", "###", "###", "#.#"],
  X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", "###", ".#.", ".#."],
  Z: ["###", "..#", ".#.", "#..", "###"],
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["###", "..#", "###", "#..", "###"],
  "3": ["###", "..#", "###", "..#", "###"],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "###", "..#", "###"],
  "6": ["###", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", "..#", "..#", "..#"],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "###"],
  " ": ["...", "...", "...", "...", "..."],
  ".": ["...", "...", "...", "...", ".#."],
  ",": ["...", "...", "...", ".#.", "#.."],
  "!": [".#.", ".#.", ".#.", "...", ".#."],
  "?": ["##.", "..#", ".#.", "...", ".#."],
  "-": ["...", "...", "###", "...", "..."],
  "—": ["...", "...", "###", "...", "..."],
  "…": ["...", "...", "...", "#.#", "#.#"],
  ":": ["...", ".#.", "...", ".#.", "..."],
  "'": [".#.", ".#.", "...", "...", "..."],
  "/": ["..#", "..#", ".#.", "#..", "#.."],
  "(": [".#.", "#..", "#..", "#..", ".#."],
  ")": [".#.", "..#", "..#", "..#", ".#."],
  "+": ["...", ".#.", "###", ".#.", "..."],
  "%": ["#.#", "..#", ".#.", "#..", "#.#"],
  $: ["###", "##.", "###", ".##", "###"],
  _: ["...", "...", "...", "...", "###"],
  "→": ["...", "#..", "###", "#..", "..."],
};

export function textWidth(text: string, scale = 1): number {
  return text.length * 4 * scale;
}

export function drawText(
  t: PixelTarget,
  text: string,
  x: number,
  y: number,
  color: string,
  scale = 1,
): void {
  let cx = x;
  for (const raw of text.toUpperCase()) {
    const glyph = F[raw] ?? F["?"];
    for (let j = 0; j < 5; j++) {
      const row = glyph[j];
      for (let i = 0; i < 3; i++) {
        if (row[i] === "#") t.rect(cx + i * scale, y + j * scale, scale, scale, color);
      }
    }
    cx += 4 * scale;
  }
}

/** Ugly-simple greedy word wrap for bubbles. */
export function wrapText(text: string, maxChars: number, maxLines = 3): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (cand.length <= maxChars) {
      cur = cand;
    } else {
      if (cur) lines.push(cur);
      cur = w.length > maxChars ? w.slice(0, maxChars) : w;
      if (lines.length === maxLines - 1) break;
    }
    if (lines.length === maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    if (last.length === maxChars) lines[maxLines - 1] = `${last.slice(0, maxChars - 1)}…`;
  }
  return lines.slice(0, maxLines);
}
