/**
 * Pixel-art sprites as string grids. Each row string indexes into `palette`
 * by character; '.' is transparent. All character sprites are 16×16 and use
 * the shared body keys so they can be palette-swapped per bot:
 *   D outline · H hair · K skin · W eye · S shirt · P pants · E shoes
 */

export interface Sprite {
  w: number;
  h: number;
  palette: Record<string, string>;
  rows: string[];
}

const BODY: Record<string, string> = {
  D: "#26262e",
  H: "#3a2a1c",
  K: "#f0c8a0",
  W: "#ffffff",
  S: "#4f6d9e",
  P: "#3a3f4a",
  E: "#1c1c22",
};

/* 16×16, facing the camera. Feet on the bottom row. */
const BOT_STAND = [
  "....DDDDDDDD....",
  "...DHHHHHHHHD...",
  "...DHHHHHHHHD...",
  "...DHKKKKKKHD...",
  "...DKWKKKWKKD...",
  "...DKKKKKKKKD...",
  "....DKKKKKKD....",
  "....DSSSSSSD....",
  "...DSSSSSSSSD...",
  "..DKSSSSSSSSKD..",
  "..DKSSSSSSSSKD..",
  "...DPPPPPPPPD...",
  "...DPPPPPPPPD...",
  "...DPPD..DPPD...",
  "...DEED..DEED...",
  "..DEEED..DEEED..",
];

/* Walk A: left leg forward (raised), arms swing. */
const BOT_WALK_A = [
  "....DDDDDDDD....",
  "...DHHHHHHHHD...",
  "...DHHHHHHHHD...",
  "...DHKKKKKKHD...",
  "...DKWKKKWKKD...",
  "...DKKKKKKKKD...",
  "....DKKKKKKD....",
  "....DSSSSSSD....",
  "..DKSSSSSSSSD...",
  "..DKSSSSSSSSKD..",
  "...DSSSSSSSSKD..",
  "...DPPPPPPPPD...",
  "...DPPPPPPPPD...",
  "...DPPD..DPPD...",
  "...DEED..DPPD...",
  "..DEEED...EED...",
];

/* Walk B: mirror stride. */
const BOT_WALK_B = [
  "....DDDDDDDD....",
  "...DHHHHHHHHD...",
  "...DHHHHHHHHD...",
  "...DHKKKKKKHD...",
  "...DKWKKKWKKD...",
  "...DKKKKKKKKD...",
  "....DKKKKKKD....",
  "....DSSSSSSD....",
  "...DSSSSSSSSD...",
  "..DKSSSSSSSSKD..",
  "..DKSSSSSSSSD...",
  "...DPPPPPPPPD...",
  "...DPPPPPPPPD...",
  "...DPPD..DPPD...",
  "...DPPD..DEED...",
  "...EED...DEEED..",
];

/* Sitting at a desk: lower body hidden by the desk, hands forward typing. */
const BOT_SIT_A = [
  "....DDDDDDDD....",
  "...DHHHHHHHHD...",
  "...DHHHHHHHHD...",
  "...DHKKKKKKHD...",
  "...DKWKKKWKKD...",
  "...DKKKKKKKKD...",
  "....DKKKKKKD....",
  "....DSSSSSSD....",
  "...DSSSSSSSSD...",
  "..DSSSSSSSSSSD..",
  "..DKSSSSSSSSKD..",
  "..DKKSSSSSSKKD..",
  "..DDDDDDDDDDDD..",
  "................",
  "................",
  "................",
];

const BOT_SIT_B = [
  "....DDDDDDDD....",
  "...DHHHHHHHHD...",
  "...DHHHHHHHHD...",
  "...DHKKKKKKHD...",
  "...DKWKKKWKKD...",
  "...DKKKKKKKKD...",
  "....DKKKKKKD....",
  "....DSSSSSSD....",
  "..DKSSSSSSSSD...",
  "..DKSSSSSSSSKD..",
  "..DKSSSSSSSSKD..",
  "..DSSSSSSSSSSD..",
  "..DDDDDDDDDDDD..",
  "................",
  "................",
  "................",
];

/* Carrying a ream of paper (W block held at chest). */
const BOT_CARRY = [
  "....DDDDDDDD....",
  "...DHHHHHHHHD...",
  "...DHHHHHHHHD...",
  "...DHKKKKKKHD...",
  "...DKWKKKWKKD...",
  "...DKKKKKKKKD...",
  "....DKKKKKKD....",
  "....DSSSSSSD....",
  "..DKSSWWWWSSKD..",
  "..DKSWWWWWSKD...",
  "..DKSWWWWWSKD...",
  "..DKSSWWWWSSKD..",
  "...DPPPPPPPPD...",
  "...DPPD..DPPD...",
  "...DEED..DEED...",
  "..DEEED..DEEED..",
];

/* Water cooler. */
const WATERCOOLER = [
  "....DDDDDD......",
  "...DWWWWWWD.....",
  "..DWWWWWWWWD....",
  "..DWCCCCCCWD....",
  "..DWCCCCCCWD....",
  "..DWWWWWWWWD....",
  "...DWWWWWWD.....",
  "....DDDDDD......",
  "....DGGGGD......",
  "....DGGGGD......",
  "....DGwwGD......",
  "....DGGGGD......",
  "....DGGGGD......",
  "....DGGGGD......",
  "....DDDDDD......",
  "................",
];

/* Potted plant. */
const PLANT = [
  "......GG........",
  ".....GGGG.......",
  "....GGgGGG......",
  "...GGGgGGGG.....",
  "...GgGGGGgG.....",
  "....GGGGGG......",
  ".....GGGG.......",
  "......GG........",
  "....DDDDDD......",
  "....DppppD......",
  "....DppppD......",
  ".....DppD.......",
  ".....DppD.......",
  ".....DppD.......",
  "....DDDDDD......",
  "................",
];

/* Cardboard box. */
const BOX = [
  "................",
  "................",
  "..DDDDDDDDDDD...",
  ".DBBBBBBBBBBD...",
  ".DBBBBBBBBBBD...",
  ".DDDDtDDDDDDD...",
  ".DBBBBtBBBBBD...",
  ".DBBBBtBBBBBD...",
  ".DBBBBtBBBBBD...",
  ".DBBBBtBBBBBD...",
  ".DDDDDDDDDDDD...",
  ".DBBBBBBBBBBD...",
  ".DBBBBBBBBBBD...",
  ".DDDDDDDDDDDD...",
  "................",
  "................",
];

/* Coffee machine. */
const COFFEE_MAKER = [
  "................",
  "..DDDDDDDDDD....",
  ".DkkkkkkkkkkD...",
  ".DkDDDDDDDDkD...",
  ".DkDrrrrrrDkD...",
  ".DkDDDDDDDDkD...",
  ".DkkkkkkkkkkD...",
  ".DkkkkkkkkkkD...",
  ".DkkggggggkkD...",
  ".DkkggggggkkD...",
  ".DkkkkkkkkkkD...",
  ".DkkkkkkkkkkD...",
  ".DDDDDDDDDDDD...",
  "................",
  "................",
  "................",
];

const ITEM: Record<string, string> = {
  D: "#26262e",
  W: "#e8eef2",
  C: "#4f9bd6",
  G: "#d5d8da",
  g: "#8fa3ad",
  w: "#ffffff",
  B: "#c08a52",
  t: "#8a5a33",
  k: "#7f8a92",
  r: "#e05555",
  p: "#a5502c",
  G2: "#3f7d44",
};

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

export const CHAR_SPRITES: Record<string, Sprite> = {
  stand: mk(BOT_STAND, BODY),
  walkA: mk(BOT_WALK_A, BODY),
  walkB: mk(BOT_WALK_B, BODY),
  sitA: mk(BOT_SIT_A, BODY),
  sitB: mk(BOT_SIT_B, BODY),
  carry: mk(BOT_CARRY, BODY),
};

export const ITEM_SPRITES: Record<string, Sprite> = {
  watercooler: mk(WATERCOOLER, ITEM),
  plant: mk(PLANT, ITEM),
  box: mk(BOX, ITEM),
  coffee: mk(COFFEE_MAKER, ITEM),
};

export const ALL_SPRITES = { ...CHAR_SPRITES, ...ITEM_SPRITES };
