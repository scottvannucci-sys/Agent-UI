import { C } from "./palette";

/**
 * The Dunder Bots office floor plan: a 36×22 tile map (16px tiles), furniture
 * placement, walkability grid, BFS pathfinding and zone targets.
 *
 * Layout:
 *   y1-5  : boss office (x1-9) · accounting (x12-19) · kitchen/breakroom (x21-34)
 *   y7-15 : open bullpen (x1-24) · conference room (x26-34)
 *   y17-19: reception + annex desks (x1-24, tile floor) · copier room (x26-34)
 *   y21   : front door (x23-24)
 */

export const TILE = 16;
export const MAP_W = 36;
export const MAP_H = 22;

/*
  Legend: '#' wall · 'w' window wall · '.' carpet · ',' tile floor · 'D' door
*/
const RAW_MAP: string[] = [
  "##wwwwww#####wwwwww#####wwwwwwwww###", // 0 top wall + windows
  "#.........##........#.............w#", // 1
  "#.........##........#.............w#", // 2
  "#.........##........#.............w#", // 3
  "#.........##........#.............w#", // 4
  "#.........##........#.............w#", // 5
  "####.##############..###############", // 6 doors: boss x5, corridor x20-21
  "#........................###########", // 7 bullpen / conference top wall
  "#........................#.........w", // 8
  "#........................#.........w", // 9
  "#........................#.........w", // 10
  "#.........................", // 11 (door gap at x25) — continued below
  "#........................#.........w", // 12
  "#........................#.........w", // 13
  "#........................#.........w", // 14
  "#........................#.........#", // 15
  "#........................######.####", // 16 copier room door x31
  "#,,,,,,,,,,,,,,,,,,,,,,,,#,,,,,,,,,,", // 17
  "#,,,,,,,,,,,,,,,,,,,,,,,,#,,,,,,,,,,", // 18
  "#,,,,,,,,,,,,,,,,,,,,,,,,#,,,,,,,,,,", // 19
  "#,,,,,,,,,,,,,,,,,,,,,,,,###########", // 20
  "#######################DD###########", // 21 front door x23-24
];

// row 11 needs the same shape as rows 8-15 with a door gap at x25
RAW_MAP[11] = "#........................" + "." + ".........w";

function validateMap(): void {
  if (RAW_MAP.length !== MAP_H) {
    throw new Error(`floor plan must have ${MAP_H} rows, got ${RAW_MAP.length}`);
  }
  RAW_MAP.forEach((row, y) => {
    if (row.length !== MAP_W) {
      throw new Error(
        `floor plan row ${y} has ${row.length} chars, expected ${MAP_W}: "${row}"`,
      );
    }
  });
}
validateMap();

export type FurnKind =
  | "desk"
  | "chair"
  | "bossDesk"
  | "bossChair"
  | "confTable"
  | "confChair"
  | "watercooler"
  | "plant"
  | "box"
  | "coffee"
  | "fridge"
  | "counter"
  | "printer"
  | "copier"
  | "receptionDesk"
  | "sofa"
  | "cabinet"
  | "shelf"
  | "bobble"
  | "roundTable"
  | "whiteboard";

export interface Furniture {
  kind: FurnKind;
  x: number; // tile
  y: number;
  /** extra tile width (multi-tile furniture grows right) */
  w?: number;
}

/** Furniture layout (tile coords). */
export const FURNITURE: Furniture[] = [
  // Boss office (x1-9, y1-5)
  { kind: "shelf", x: 1, y: 1 },
  { kind: "bobble", x: 2, y: 1 },
  { kind: "plant", x: 8, y: 1 },
  { kind: "bossDesk", x: 3, y: 3, w: 2 },
  { kind: "bossChair", x: 4, y: 4 },
  { kind: "plant", x: 1, y: 5 },
  // Accounting (x12-19, y1-5)
  { kind: "cabinet", x: 12, y: 1 },
  { kind: "plant", x: 19, y: 1 },
  { kind: "desk", x: 14, y: 2 },
  { kind: "desk", x: 16, y: 2 },
  { kind: "desk", x: 14, y: 4 },
  { kind: "desk", x: 16, y: 4 },
  // Kitchen / breakroom (x21-34, y1-5)
  { kind: "coffee", x: 28, y: 1 },
  { kind: "counter", x: 30, y: 1 },
  { kind: "counter", x: 31, y: 1 },
  { kind: "counter", x: 32, y: 1 },
  { kind: "fridge", x: 34, y: 1 },
  { kind: "roundTable", x: 31, y: 3 },
  { kind: "plant", x: 24, y: 4 },
  { kind: "plant", x: 21, y: 5 },
  // Watercooler hub
  { kind: "watercooler", x: 20, y: 7 },
  { kind: "plant", x: 22, y: 7 },
  // Conference room (x26-34, y8-15)
  { kind: "whiteboard", x: 33, y: 8 },
  { kind: "confTable", x: 28, y: 11, w: 4 },
  { kind: "confChair", x: 28, y: 10 },
  { kind: "confChair", x: 29, y: 10 },
  { kind: "confChair", x: 30, y: 10 },
  { kind: "confChair", x: 31, y: 10 },
  { kind: "confChair", x: 28, y: 12 },
  { kind: "confChair", x: 29, y: 12 },
  { kind: "confChair", x: 30, y: 12 },
  { kind: "confChair", x: 31, y: 12 },
  // Bullpen desks (8)
  { kind: "desk", x: 4, y: 9 },
  { kind: "desk", x: 7, y: 9 },
  { kind: "desk", x: 10, y: 9 },
  { kind: "desk", x: 13, y: 9 },
  { kind: "desk", x: 4, y: 13 },
  { kind: "desk", x: 7, y: 13 },
  { kind: "desk", x: 10, y: 13 },
  { kind: "desk", x: 13, y: 13 },
  // Annex desks (4) — bottom band
  { kind: "desk", x: 11, y: 18 },
  { kind: "desk", x: 14, y: 18 },
  { kind: "desk", x: 17, y: 18 },
  { kind: "desk", x: 20, y: 18 },
  { kind: "plant", x: 9, y: 17 },
  { kind: "plant", x: 22, y: 19 },
  // Reception (x1-8, y17-20)
  { kind: "receptionDesk", x: 3, y: 18, w: 2 },
  { kind: "sofa", x: 5, y: 20, w: 2 },
  { kind: "plant", x: 1, y: 20 },
  // Copier room (x26-34, y17-19)
  { kind: "printer", x: 27, y: 18 },
  { kind: "copier", x: 29, y: 18 },
  { kind: "box", x: 32, y: 18 },
  { kind: "box", x: 33, y: 18 },
  { kind: "cabinet", x: 26, y: 19 },
  { kind: "plant", x: 34, y: 19 },
];

const SOLID_KINDS = new Set<FurnKind>([
  "desk",
  "bossDesk",
  "confTable",
  "watercooler",
  "plant",
  "box",
  "coffee",
  "fridge",
  "counter",
  "printer",
  "copier",
  "receptionDesk",
  "sofa",
  "cabinet",
  "shelf",
  "bobble",
  "roundTable",
  "whiteboard",
]);

export const MAP: string[] = RAW_MAP;

function tileAt(x: number, y: number): string {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return "#";
  return MAP[y][x] ?? "#";
}

export function isWall(x: number, y: number): boolean {
  const t = tileAt(x, y);
  return t === "#" || t === "w";
}

export function isDoor(x: number, y: number): boolean {
  return tileAt(x, y) === "D";
}

export function isTileFloor(x: number, y: number): boolean {
  return tileAt(x, y) === ",";
}

export const WALKABLE: boolean[] = (() => {
  const grid = new Array<boolean>(MAP_W * MAP_H).fill(false);
  const solid = new Set<number>();
  for (const f of FURNITURE) {
    if (!SOLID_KINDS.has(f.kind)) continue;
    const w = f.w ?? 1;
    for (let i = 0; i < w; i++) solid.add(f.y * MAP_W + f.x + i);
  }
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      grid[y * MAP_W + x] = !isWall(x, y) && !solid.has(y * MAP_W + x);
    }
  }
  // sanity: door tiles must be walkable
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (isDoor(x, y) && !grid[y * MAP_W + x]) {
        throw new Error(`door at ${x},${y} is blocked`);
      }
    }
  }
  return grid;
})();

export function walkable(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
  return WALKABLE[y * MAP_W + x];
}

/** BFS path over walkable tiles; returns waypoints in tiles (excluding start). */
export function findPath(
  sx: number,
  sy: number,
  gx: number,
  gy: number,
): Array<{ x: number; y: number }> {
  if (!walkable(gx, gy)) {
    outer: for (let r = 1; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (walkable(gx + dx, gy + dy)) {
            gx += dx;
            gy += dy;
            break outer;
          }
        }
      }
    }
    if (!walkable(gx, gy)) return [];
  }
  const start = sy * MAP_W + sx;
  const goal = gy * MAP_W + gx;
  if (start === goal) return [];
  const prev = new Int32Array(MAP_W * MAP_H).fill(-1);
  const queue: number[] = [start];
  prev[start] = start;
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    if (cur === goal) break;
    const cx = cur % MAP_W;
    const cy = Math.floor(cur / MAP_W);
    const nbrs = [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1],
    ];
    for (const [nx, ny] of nbrs) {
      if (!walkable(nx, ny)) continue;
      const ni = ny * MAP_W + nx;
      if (prev[ni] !== -1) continue;
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  if (prev[goal] === -1) return [];
  const path: Array<{ x: number; y: number }> = [];
  let cur = goal;
  while (cur !== start) {
    path.push({ x: cur % MAP_W, y: Math.floor(cur / MAP_W) });
    cur = prev[cur];
  }
  return path.reverse();
}

/* ------------------------------------------------------------------ */
/* Zones & seats                                                       */
/* ------------------------------------------------------------------ */

export interface Desk {
  x: number; // desk tile
  y: number;
  /** seat tile (bot feet position) */
  seatX: number;
  seatY: number;
  annex: boolean;
}

export const DESKS: Desk[] = (() => {
  const desks: Desk[] = [];
  for (const f of FURNITURE) {
    if (f.kind !== "desk") continue;
    desks.push({
      x: f.x,
      y: f.y,
      seatX: f.x,
      seatY: f.y + 1,
      annex: f.y >= 17,
    });
  }
  // every seat tile must be walkable
  for (const d of desks) {
    if (!walkable(d.seatX, d.seatY)) throw new Error(`desk seat blocked at ${d.seatX},${d.seatY}`);
  }
  return desks;
})();

/** Monitor screen rect (px) inside a desk tile, for the on/off glow. */
export const DESK_SCREEN = { dx: 4, dy: 1, w: 7, h: 5 };

export const ZONES = {
  door: { x: 23, y: 20 },
  watercooler: [
    { x: 19, y: 7 },
    { x: 21, y: 7 },
  ],
  coffee: { x: 28, y: 2 },
  printer: { x: 27, y: 19 },
  boss: { x: 3, y: 5 },
  reception: { x: 4, y: 19 },
  sofa: [
    { x: 5, y: 19 },
    { x: 6, y: 19 },
  ],
  conference: [
    { x: 28, y: 10 },
    { x: 29, y: 10 },
    { x: 30, y: 10 },
    { x: 31, y: 10 },
    { x: 28, y: 12 },
    { x: 29, y: 12 },
  ],
  wander: [
    { x: 17, y: 10 },
    { x: 18, y: 14 },
    { x: 6, y: 16 },
    { x: 21, y: 16 },
    { x: 16, y: 8 },
    { x: 8, y: 11 },
  ],
} as const;

export const BOSS_SEAT = { x: 4, y: 4 }; // boss chair tile
export const BOSS_DESK = { x: 3, y: 3 };

/** Pixel center-bottom of a tile. */
export function tileCenter(x: number, y: number): { x: number; y: number } {
  return { x: x * TILE + TILE / 2, y: y * TILE + TILE };
}

export const PAPER_C = C.paper;
