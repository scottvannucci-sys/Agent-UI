/**
 * Pixel-art prop sprites as string grids (32×32, 16-bit style). Each row
 * indexes `palette` by character; '.' is transparent. Characters are drawn
 * procedurally — see characters.ts — these grids cover the organic props.
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
  w2: "#c8d3da", // plastic shade
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
  "2": "#7c3a1e", // pot dark
  l: "#c97a4a", // pot light
  L: "#3f7d44", // leaf
  i: "#57a05c", // leaf light
  d: "#2d5c31", // leaf dark
  f: "#6b4a2b", // coffee
};

/* ---------------- water cooler 32×32 ---------------- */
const WATERCOOLER = [
  "................................",
  "..........DDDDDDDDDDDD..........",
  "..........DWWWWWWWWWWD..........",
  "..........DWWWWWWWWWWD..........",
  "..........DWCCCCCCCCWD..........",
  "..........DWCcCCCCCCWD..........",
  "..........DWCCCCCCCCWD..........",
  "..........DWCCCcCCCCWD..........",
  "..........DWCCCCCCCCWD..........",
  "..........DWCcCCCCcCWD..........",
  "..........DWCCCCCCCCWD..........",
  "..........DWCCCcCCCCWD..........",
  "..........DWWWWWWWWWWD..........",
  "..........DDDDDDDDDDDD..........",
  "...........DDDDDDDDDD...........",
  "..........DGGGGGGGGGGD..........",
  "..........DGgggggggggD..........",
  "..........DGrGGGGGGGGD..........",
  "..........DGgggggggggD..........",
  "..........DGGGGGGGGGGD..........",
  "..........DGGGGGGGGGGD..........",
  "..........DGDDDDDDDDGD..........",
  "..........DGGGGGGGGGGD..........",
  "..........DGGGGGGGGGGD..........",
  "..........DGgggggggggD..........",
  "..........DGgggggggggD..........",
  "..........DGGGGGGGGGGD..........",
  "..........DDDDDDDDDDDD..........",
  "...........DDDDDDDDDD...........",
  "............DDDDDDDD............",
  "................................",
  "................................",
];

/* ---------------- potted plant 32×32 ---------------- */
const PLANT = [
  "..............LLiLL.............",
  "..........LLLiLLLlLL............",
  "........LLiLLdLLLlLL............",
  ".......LLdLLLiLLLLLLL...........",
  "......LLLLLdLLLLLdLLLL..........",
  ".....LLLlLLLLLLdLLLLLLL.........",
  "....LLdLLLLLlLLLLLLdLLLL........",
  "....LLLLLdLLLLLLlLLLLLLL........",
  ".....LLLlLLLLLdLLLLLlLLL........",
  "......LLLLLLdLLLLLLLdLL.........",
  ".......LLLlLLLLLlLLLL...........",
  "........LLLLdLLLLdLL............",
  ".........dLLLLLLdLL.............",
  "..........LLdLLLLL..............",
  "...........LLLLdL...............",
  "...........LLLLL................",
  "...........dLLL.................",
  "...........dLL..................",
  ".........DDDDDDDDDDDD...........",
  "..........DppppppppD............",
  "..........DpllllllpD............",
  "..........DppppppppD............",
  "..........DpllllllpD............",
  "..........Dpp2pp2ppD............",
  "..........Dpp2pp2ppD............",
  "..........DppppppppD............",
  "..........DppppppppD............",
  ".........DDDDDDDDDDDD...........",
  "................................",
  "................................",
  "................................",
  "................................",
];

/* ---------------- cardboard box 32×32 ---------------- */
const BOX = [
  "................................",
  "................................",
  "................................",
  "................................",
  "....DDDDDDDDDDDDDDDDDDDDDDDD....",
  "....DBBBBBBBBBBBBBBBBBBBBBD.....",
  "....DBBBBBBBBBBBBBBBBBBBBD......",
  "....DDDDDDDDDDDtDDDDDDDDDDD.....",
  "....DBBBBBBBBBtBBBBBBBBBBBD.....",
  "....DBBBBBBBBBtBBBBBBBBBBBD.....",
  "....DBBBBBBBBBtBBBBBBBBBBBD.....",
  "....DBBBBBBBBBtBBBBBBBBBBBD.....",
  "....DBBBBBBBBBtBBBBBBBBBBBD.....",
  "....DDDDDDDDDDtDDDDDDDDDDDD.....",
  "....DBBBBBBBBBtBBBBBBBBBBBD.....",
  "....DBBBBBBBBBtBBBBBBBBBBBD.....",
  "....DBBBBBBBBBtBBBBBBBBBBBD.....",
  "....DBBBBBBBBBtBBBBBBBBBBBD.....",
  "....DBBBBBBBBBtBBBBBBBBBBBD.....",
  "....DDDDDDDDDDtDDDDDDDDDDDD.....",
  "....DBBBBBBBBBtBBBBBBBBBBBD.....",
  "....DBBBBBBBBBtBBBBBBBBBBBD.....",
  "....DBBBBBBBBBtBBBBBBBBBBBD.....",
  "....DBBBBBBBBBtBBBBBBBBBBBD.....",
  "....DBBBBBBBBBtBBBBBBBBBBBD.....",
  "....DDDDDDDDDDDDDDDDDDDDDDDD....",
  "....DbbbbbbbbbbbbbbbbbbbbdD.....",
  "....DDDDDDDDDDDDDDDDDDDDDDDD....",
  "................................",
  "................................",
  "................................",
  "................................",
];

/* ---------------- coffee maker 32×32 ---------------- */
const COFFEE_MAKER = [
  "................................",
  "................................",
  ".....DDDDDDDDDDDDDDDDDDDD.......",
  ".....DggggggggggggggggggD.......",
  ".....DgDDDDDDDDDDDDDDDDgD.......",
  ".....DgDffffffffffffffffDgD.....",
  ".....DgDffffffffffffffffDgD.....",
  ".....DgDffffffffffffffffDgD.....",
  ".....DgDffffffffffffffffDgD.....",
  ".....DgDDDDDDDDDDDDDDDDDDgD.....",
  ".....DggggggggggggggggggD.......",
  ".....DgGGGGGGGGGGGGGGGGDgD......",
  ".....DgGGrrGGGGGGGGGGGGDgD......",
  ".....DgGGGGGGGGGGGGGGGGDgD......",
  ".....DggggggggggggggggggD.......",
  ".....DgDDDDDDDDDDDDDDDDgD.......",
  ".....DgDffffffffffffffffDgD.....",
  ".....DgDffffffffffffffffDgD.....",
  ".....DgDffffffffffffffffDgD.....",
  ".....DgDffffffffffffffffDgD.....",
  ".....DgDDDDDDDDDDDDDDDDDDgD.....",
  ".....DggggggggggggggggggD.......",
  ".....DgGGGGGGGGGGGGGGGGDgD......",
  ".....DgGGGGGGGGGGkGGGGGDgD......",
  ".....DggggggggggggggggggD.......",
  ".....DggggggggggggggggggD.......",
  ".....DDDDDDDDDDDDDDDDDDDD.......",
  "......DDDDDDDDDDDDDDDDDD........",
  "................................",
  "................................",
  "................................",
  "................................",
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
