import { C, shade } from "./palette";
import type { PixelTarget } from "./render-core";

/**
 * 16-bit-style procedural pixel-character composer. Bots are 32×46 with feet
 * on the bottom row; looks (hair, glasses, tie, skirt, colors) derive from a
 * seed so every bot gets a distinct office outfit. All drawing goes through
 * PixelTarget.rect so it works in the browser and the Node preview alike.
 */

export const CHAR_W = 32;
export const CHAR_H = 46;
/** Rows of visible body while seated at a desk (legs hidden). */
export const SEATED_H = 30;

export type BotFrame = "stand" | "walkA" | "walkB" | "sitA" | "sitB" | "carry";

export interface BotLook {
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  shoe: string;
  hairStyle: number; // 0 short · 1 part · 2 long · 3 bald · 4 spiky · 5 receding
  glasses: boolean;
  tie: boolean;
  skirt: boolean;
  tieColor: string;
}

function botPalette(seed: number): { K: string; H: string; S: string; P: string } {
  return {
    K: C.skin[seed % C.skin.length],
    H: C.hair[Math.floor(seed / 2) % C.hair.length],
    S: C.shirt[Math.floor(seed / 3) % C.shirt.length],
    P: C.pants[Math.floor(seed / 5) % C.pants.length],
  };
}

export function botLook(seed: number): BotLook {
  const base = botPalette(seed);
  return {
    skin: base.K,
    hair: base.H,
    shirt: base.S,
    pants: base.P,
    shoe: C.shoe,
    hairStyle: seed % 6,
    glasses: Math.floor(seed / 3) % 4 === 0,
    tie: Math.floor(seed / 5) % 3 === 0,
    skirt: Math.floor(seed / 11) % 4 === 0,
    tieColor: C.tie[Math.floor(seed / 17) % C.tie.length],
  };
}

export const BOSS_LOOK: BotLook = {
  skin: C.skin[1],
  hair: "#8a8f96",
  shirt: "#3a3f4a",
  pants: "#26262e",
  shoe: "#1c1c22",
  hairStyle: 5,
  glasses: true,
  tie: true,
  skirt: false,
  tieColor: "#9e4f5a",
};

const R = (
  t: PixelTarget,
  x: number,
  y: number,
  w: number,
  h: number,
  c: string,
) => t.rect(x, y, w, h, c);

/** Soft contact shadow under a standing/walking bot. */
export function drawBotShadow(t: PixelTarget, cx: number, feetY: number): void {
  R(t, Math.round(cx) - 13, feetY - 2, 26, 2, "rgba(20,25,35,0.18)");
  R(t, Math.round(cx) - 9, feetY, 18, 1, "rgba(20,25,35,0.12)");
}

export interface DrawBotOpts {
  /** wall-clock ms — drives blinking and talking mouths */
  now?: number;
  /** mouth animates while a speech bubble is up */
  talking?: boolean;
  /** -1..1: pupils lean toward walking direction */
  pupilDx?: number;
  /** -1..0..1: body turns toward the walking direction (profile hint) */
  dir?: number;
  /** per-bot phase so the office doesn't blink in sync */
  blinkSeed?: number;
  /** 1px silhouette outline (default on) */
  outline?: boolean;
}

class StampTarget implements PixelTarget {
  constructor(
    private readonly inner: PixelTarget,
    private readonly ox: number,
    private readonly oy: number,
  ) {}
  rect(x: number, y: number, w: number, h: number, color: string): void {
    if (color.startsWith("rgba")) return; // translucent fx are not silhouette
    this.inner.rect(x + this.ox, y + this.oy, w, h, C.outline);
  }
}

/** Feet-center + frame → pixel position helper. */
export function botDrawPos(cx: number, feetY: number, frame: BotFrame): { px: number; py: number } {
  const sitting = frame === "sitA" || frame === "sitB";
  return {
    px: Math.round(cx - CHAR_W / 2),
    py: Math.round(sitting ? feetY - SEATED_H : feetY - CHAR_H),
  };
}

/* ------------------------------------------------------------------ */
/* head — rows headTop..headTop+14, hx leans toward the walk direction */
/* ------------------------------------------------------------------ */

function drawHead(
  t: PixelTarget,
  px: number,
  py: number,
  headTop: number,
  look: BotLook,
  opts: DrawBotOpts,
): void {
  const dir = Math.sign(opts.dir ?? 0);
  const hx = px + dir * 2;
  const hy = py + headTop; // first head row
  const skinHi = shade(look.skin, 0.18);
  const skinSh = shade(look.skin, -0.16);

  // dome
  R(t, hx + 13, hy, 6, 2, look.skin);
  R(t, hx + 11, hy + 2, 10, 11, look.skin);
  R(t, hx + 12, hy + 13, 8, 1, look.skin);
  // shading ramps
  R(t, hx + 11, hy + 3, 2, 9, skinHi);
  R(t, hx + 19, hy + 5, 2, 8, skinSh);
  // ears
  R(t, hx + 10, hy + 7, 1, 3, look.skin);
  R(t, hx + 21, hy + 7, 1, 3, look.skin);

  /* hair */
  const H = look.hair;
  const HHi = shade(H, 0.25);
  const HSh = shade(H, -0.2);
  switch (look.hairStyle) {
    case 0: // short
      R(t, hx + 11, hy - 2, 10, 4, H);
      R(t, hx + 12, hy - 2, 8, 1, HHi);
      R(t, hx + 11, hy + 2, 2, 4, H);
      R(t, hx + 19, hy + 2, 2, 4, HSh);
      break;
    case 1: // side part
      R(t, hx + 11, hy - 2, 10, 4, H);
      R(t, hx + 12, hy - 2, 5, 1, HHi);
      R(t, hx + 11, hy + 2, 5, 3, H);
      R(t, hx + 19, hy + 2, 2, 2, HSh);
      break;
    case 2: // long
      R(t, hx + 11, hy - 2, 10, 4, H);
      R(t, hx + 12, hy - 2, 8, 1, HHi);
      R(t, hx + 10, hy + 2, 2, 12, H);
      R(t, hx + 20, hy + 2, 2, 12, HSh);
      R(t, hx + 10, hy + 2, 1, 12, HHi);
      break;
    case 3: // bald
      R(t, hx + 14, hy + 1, 4, 1, "rgba(255,255,255,0.4)");
      R(t, hx + 11, hy + 2, 1, 2, HSh);
      R(t, hx + 20, hy + 2, 1, 2, HSh);
      break;
    case 4: // spiky
      R(t, hx + 12, hy - 1, 2, 3, H);
      R(t, hx + 15, hy - 3, 2, 5, H);
      R(t, hx + 18, hy - 1, 2, 3, H);
      R(t, hx + 11, hy + 1, 10, 3, H);
      R(t, hx + 12, hy + 1, 8, 1, HHi);
      break;
    default: // receding
      R(t, hx + 13, hy, 6, 3, H);
      R(t, hx + 11, hy + 2, 2, 3, H);
      R(t, hx + 19, hy + 2, 2, 3, HSh);
      break;
  }

  /* profile turn: shade the back of the head, bump a nose on the leading edge */
  if (dir !== 0) {
    const backX = dir > 0 ? hx + 10 : hx + 19;
    R(t, backX, hy + 3, 2, 6, HSh);
    const noseX = dir > 0 ? hx + 21 : hx + 9;
    R(t, noseX, hy + 9, 1, 2, look.skin);
  }

  /* brows + eyes (the far eye hides when turned) */
  const eyeRow = hy + 7;
  const dx = Math.max(-1, Math.min(1, opts.pupilDx ?? 0));
  const now = opts.now ?? 0;
  const blinking =
    opts.now !== undefined && (now / 1000 + (opts.blinkSeed ?? 0) * 1.37) % 5.3 < 0.16;
  const eye = (ex: number) => {
    if (blinking) {
      R(t, hx + ex, eyeRow + 1, 3, 1, C.outline);
      return;
    }
    R(t, hx + ex, eyeRow, 3, 3, "#ffffff");
    R(t, hx + ex + 1 + dx, eyeRow, 1, 2, C.outline);
    R(t, hx + ex, eyeRow + 3, 3, 1, skinSh);
  };
  const brow = (ex: number) => R(t, hx + ex, eyeRow - 1, 3, 1, HSh);
  if (dir >= 0) {
    eye(18);
    brow(18);
  }
  if (dir <= 0) {
    eye(13);
    brow(13);
  }

  if (look.glasses) {
    for (const ex of dir >= 0 ? [18] : dir <= 0 ? [13] : [13, 18]) {
      R(t, hx + ex - 1, eyeRow - 1, 5, 1, C.outline);
      R(t, hx + ex - 1, eyeRow - 1, 1, 5, C.outline);
      R(t, hx + ex + 3, eyeRow - 1, 1, 5, C.outline);
    }
    if (dir === 0) R(t, hx + 16, eyeRow + 1, 2, 1, C.outline);
  }

  /* nose + mouth */
  if (dir === 0) R(t, hx + 16, hy + 10, 1, 1, skinSh);
  const mx = hx + 15 + dir * 2;
  const open = opts.talking && Math.floor((opts.now ?? 0) / 160) % 2 === 0;
  if (open) {
    R(t, mx, hy + 11, 2, 2, "rgba(38,38,46,0.85)");
  } else {
    R(t, mx, hy + 11, 2, 1, "rgba(38,38,46,0.75)");
  }
}

/* ------------------------------------------------------------------ */
/* torso + limbs                                                       */
/* ------------------------------------------------------------------ */

function drawBody(
  t: PixelTarget,
  px: number,
  py: number,
  look: BotLook,
  frame: BotFrame,
  opts: DrawBotOpts = {},
): void {
  const sitting = frame === "sitA" || frame === "sitB";
  const shirtSh = shade(look.shirt, -0.14);
  const shirtHi = shade(look.shirt, 0.16);
  const dir = Math.sign(opts.dir ?? 0);

  if (sitting) {
    drawHead(t, px, py, 0, look, opts);
    /* torso rows 15-24, arms forward on the desk */
    R(t, px + 9, py + 15, 14, 2, look.shirt);
    R(t, px + 8, py + 17, 16, 8, look.shirt);
    R(t, px + 21, py + 15, 3, 10, shirtSh);
    R(t, px + 8, py + 17, 1, 8, shirtHi);
    R(t, px + 14, py + 15, 4, 2, "rgba(255,255,255,0.55)");
    if (look.tie) {
      R(t, px + 15, py + 17, 2, 2, look.tieColor);
      R(t, px + 15, py + 19, 2, 3, look.tieColor);
    } else {
      R(t, px + 16, py + 18, 1, 5, shirtSh);
    }
    // forward arms + typing hands
    const handUp = frame === "sitA";
    R(t, px + 5, py + 16, 4, 4, look.shirt);
    R(t, px + 23, py + 16, 4, 4, look.shirt);
    R(t, px + 5, py + 20 + (handUp ? 0 : 1), 3, 3, look.skin);
    R(t, px + 24, py + 20 + (handUp ? 1 : 0), 3, 3, look.skin);
    return; // legs hidden behind the desk
  }

  drawHead(t, px, py, 5, look, opts);

  /* torso rows 20-29 */
  R(t, px + 9, py + 20, 14, 2, look.shirt);
  R(t, px + 8, py + 22, 16, 8, look.shirt);
  R(t, px + 21, py + 20, 3, 10, shirtSh);
  R(t, px + 8, py + 22, 1, 8, shirtHi);
  R(t, px + 14, py + 20, 4, 2, "rgba(255,255,255,0.55)");
  if (look.tie) {
    R(t, px + 15, py + 22, 2, 2, look.tieColor);
    R(t, px + 15, py + 24, 2, 5, look.tieColor);
  } else {
    R(t, px + 16, py + 23, 1, 7, shirtSh);
  }

  /* arms (standing variants) */
  const swing = frame === "walkA" ? 1 : frame === "walkB" ? -1 : 0;
  if (frame === "carry") {
    // both arms forward holding a ream
    R(t, px + 6, py + 21, 4, 4, look.shirt);
    R(t, px + 22, py + 21, 4, 4, look.shirt);
    R(t, px + 8, py + 25, 16, 2, look.skin);
    R(t, px + 10, py + 19, 12, 7, C.paper); // the ream
    R(t, px + 10, py + 19, 12, 1, C.paperShade);
    R(t, px + 10, py + 22, 12, 1, "rgba(38,38,46,0.25)");
    return;
  }
  R(t, px + 5, py + 21 + Math.max(0, swing), 4, 6, look.shirt);
  R(t, px + 23, py + 21 + Math.max(0, -swing), 4, 6, look.shirt);
  R(t, px + 5, py + 27 + Math.max(0, swing), 3, 3, look.skin);
  R(t, px + 24, py + 27 + Math.max(0, -swing), 3, 3, look.skin);

  /* belt */
  R(t, px + 9, py + 30, 14, 2, shade(look.pants, -0.3));
  R(t, px + 15, py + 30, 2, 2, C.metal);

  /* legs & shoes */
  const legTop = 32;
  if (look.skirt) {
    R(t, px + 8, py + legTop, 16, 5, look.pants); // skirt
    R(t, px + 7, py + legTop + 3, 18, 3, look.pants);
    R(t, px + 7, py + legTop + 5, 18, 1, shade(look.pants, -0.2));
    R(t, px + 11, py + legTop + 5, 3, 4, look.skin);
    R(t, px + 18, py + legTop + 5, 3, 4, look.skin);
  } else {
    R(t, px + 10, py + legTop, 5, 10, look.pants);
    R(t, px + 17, py + legTop, 5, 10, look.pants);
    R(t, px + 14, py + legTop + 1, 4, 5, shade(look.pants, -0.12)); // hip fill
  }
  const lift = frame === "walkA" ? 1 : frame === "walkB" ? -1 : 0;
  const liftL = Math.max(0, lift);
  const liftR = Math.max(0, -lift);
  // left shoe
  const lTop = py + 42 - liftL;
  R(t, px + 9, lTop, 7, 4 - liftL, look.shoe);
  R(t, px + 9, lTop, 7, 1, shade(look.shoe, 0.25));
  // right shoe
  const rTop = py + 42 - liftR;
  R(t, px + 16, rTop, 7, 4 - liftR, look.shoe);
  R(t, px + 16, rTop, 7, 1, shade(look.shoe, 0.25));
  void dir;
}

export function drawBot(
  t: PixelTarget,
  cx: number,
  feetY: number,
  look: BotLook,
  frame: BotFrame,
  opts: DrawBotOpts = {},
): void {
  const { px, py } = botDrawPos(cx, feetY, frame);
  if (opts.outline !== false) {
    // 4-direction silhouette stamps → crisp 1px outline around the sprite
    for (const [ox, oy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const) {
      drawBody(new StampTarget(t, ox, oy), px, py, look, frame, { ...opts, outline: false });
    }
  }
  drawBody(t, px, py, look, frame, opts);
}
