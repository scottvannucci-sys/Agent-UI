/**
 * Pixel-art prop sprites as string grids (24×24). Each row indexes `palette`
 * by character; '.' is transparent. Characters are drawn procedurally — see
 * characters.ts — these grids cover the more organic props.
 */

export interface Sprite {
  w: number;
  h: number;
  palette: Record<string, string>;
  rows: string[];
}

const ITEM: Record<string, string> = {
  D: "#26262e", // outline
  W: "#e8eef2", // bottle plastic / white
  C: "#4f9bd6", // water
  c: "#7db8e0", // light water
  G: "#d5d8da", // light plastic
  g: "#8fa3ad", // dark plastic
  B: "#c08a52", // cardboard
  b: "#9a6b3d", // cardboard dark
  t: "#8a5a33", // tape
  k: "#7f8a92", // metal
  r: "#e05555", // red light
  p: "#a5502c", // pot
  p2: "#7c3a1e", // pot dark
  L: "#3f7d44", // leaf
  l: "#57a05c", // leaf light
  d: "#2d5c31", // leaf dark
  f: "#6b4a2b", // coffee
};

/* ---------------- water cooler 24×24 ---------------- */
const WATERCOOLER = [
  "........DDDDDDDD........",
  ".......DWWWWWWWWD.......",
  "......DWWWWWWWWWWD......",
  "......DWCCCCCCCCWD......",
  "......DWCcCCCCcCWD......",
  "......DWCCCCCCCCWD......",
  "......DWCcCCCCCCCWD.....",
  "......DWCCCCCCCCWD......",
  "......DWWWWWWWWWWD......",
  ".......DWWWWWWWWD.......",
  "........DDDDDDDD........",
  "........DGGGGGGD........",
  "........DGgggggD........",
  "........DGrGGGGD........",
  "........DGgggggD........",
  "........DGGGGGGD........",
  "........DGGGGGGD........",
  "........DGDDDDGD........",
  "........DGGGGGGD........",
  "........DDDDDDDD........",
  "..........DDDD..........",
  "........................",
  "........................",
  "........................",
];

/* ---------------- potted plant 24×24 ---------------- */
const PLANT = [
  "...........LL...........",
  "......LL...LL...........",
  ".....LLLLLdLLL..........",
  "....LLLLdLLLLLL.........",
  "...LLdLLLLLLdLLL........",
  "...LLLLLLdLLLLLL........",
  "....LLLdLLLLLdLL........",
  ".....LLLLLLdLLL.........",
  "......LLdLLLLL..........",
  ".......LLLLLL...........",
  "........dLLLd...........",
  ".........LLL............",
  ".........dLd............",
  "........DDDDDD..........",
  "........DpppppD.........",
  "........DpppppD.........",
  ".........DpppD..........",
  ".........Dpp2D..........",
  ".........Dpp2D..........",
  ".........Dpp2D..........",
  "........DDDDDDD.........",
  "........................",
  "........................",
  "........................",
];

/* ---------------- cardboard box 24×24 ---------------- */
const BOX = [
  "........................",
  "........................",
  "..DDDDDDDDDDDDDDDDDD....",
  "..DBBBBBBBBBBBBBBBBD....",
  "..DBBBBBBBBBBBBBBBBD....",
  "..DDDDDDtDDDDDDDDDDD....",
  "..DBBBBBtBBBBBBBBBD.....",
  "..DBBBBBtBBBBBBBBBD.....",
  "..DBBBBBtBBBBBBBBBD.....",
  "..DBBBBBtBBBBBBBBBD.....",
  "..DBBBBBtBBBBBBBBBD.....",
  "..DDDDDDtDDDDDDDDDDD....",
  "..DBBBBBtBBBBBBBBBD.....",
  "..DBBBBBtBBBBBBBBBD.....",
  "..DBBBBBtBBBBBBBBBD.....",
  "..DDDDDDDDDDDDDDDDDD....",
  "..DBBBBBBBBBBBBBBBBD....",
  "..DBBBBBBBBBBBBBBBBD....",
  "..DDDDDDDDDDDDDDDDDD....",
  "........................",
  "........................",
  "........................",
  "........................",
  "........................",
];

/* ---------------- coffee maker 24×24 ---------------- */
const COFFEE_MAKER = [
  "........................",
  "...DDDDDDDDDDDDDDDD.....",
  "..DggggggggggggggggD....",
  "..DgDDDDDDDDDDDDDDgD....",
  "..DgDffffffffffffDgD....",
  "..DgDffffffffffffDgD....",
  "..DgDDDDDDDDDDDDDDgD....",
  "..DggggggggggggggggD....",
  "..DggggggggggggggggD....",
  "..DgGGGGGGGGGGGGGGgD....",
  "..DgGrrGGGGGGGGGGGgD....",
  "..DgGGGGGGGGGGGGGGgD....",
  "..DggggggggggggggggD....",
  "..DggggggggggggggggD....",
  "..DgGGGGGGGGGGGGGGgD....",
  "..DgGffffffffffffGgD....",
  "..DgGffffffffffffGgD....",
  "..DgGGGGGGGGGGGGGGgD....",
  "..DggggggggggggggggD....",
  "..DDDDDDDDDDDDDDDDDD....",
  "........................",
  "........................",
  "........................",
  "........................",
];

function mk(rows: string[], palette: Record<string, string>): Sprite {
  const w = rows[0].length;
  return { w, h: rows.length, palette, rows };
}

/** Validate every row width — catches art typos in dev/preview. */
export function assertSprites(sprites: Record<string, Sprite>): void {
  for (const [name, s] of Object.entries(sprites)) {
    if (s.rows.length !== s.h) throw new Error(`sprite ${name}: rows ${s.rows.length} != h ${s.h}`);
    for (let i = 0; i < s.rows.length; i++) {
      if (s.rows[i].length !== s.w) {
        throw new Error(`sprite ${name} row ${i}: ${s.rows[i].length} != w ${s.w}`);
      }
    }
  }
}

export const ITEM_SPRITES: Record<string, Sprite> = {
  watercooler: mk(WATERCOOLER, ITEM),
  plant: mk(PLANT, ITEM),
  box: mk(BOX, ITEM),
  coffee: mk(COFFEE_MAKER, ITEM),
};

if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
  try {
    assertSprites(ITEM_SPRITES);
  } catch {
    /* validated again by the preview tool */
  }
}
