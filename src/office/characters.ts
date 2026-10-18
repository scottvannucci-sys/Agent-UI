import { botPalette, C } from "./palette";
import type { PixelTarget } from "./render-core";

/**
 * Procedural pixel-character composer. Bots are 24×30 with feet on the
 * bottom row; looks (hair, glasses, tie, skirt, colors) derive from a seed so
 * every bot gets a distinct office outfit. All drawing goes through
 * PixelTarget.rect so it works in the browser and the Node preview alike.
 */

export const CHAR_W = 24;
export const CHAR_H = 30;

export type BotFrame = "stand" | "walkA" | "walkB" | "sitA" | "sitB" | "carry";

export interface DrawBotOpts {
  /** wall-clock ms — drives blinking and talking mouths */
  now?: number;
  /** mouth animates while a speech bubble is up */
  talking?: boolean;
  /** -1..1: pupils lean toward walking direction */
  pupilDx?: number;
  /** per-bot phase so the office doesn't blink in sync */
  blinkSeed?: number;
  /** 1px silhouette outline (default on) */
  outline?: boolean;
}

/** Wraps a target and stamps the whole silhouette in the outline color,
 * offset by (ox, oy) — four stamps give a crisp 1px rim around the sprite. */
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
  R(t, Math.round(cx) - 9, feetY - 2, 18, 2, "rgba(20,25,35,0.18)");
  R(t, Math.round(cx) - 6, feetY, 12, 1, "rgba(20,25,35,0.12)");
}

/** eyes with blink + pupil lean; row = top row of the 2px-tall eye */
function drawEyes(
  t: PixelTarget,
  px: number,
  py: number,
  row: number,
  opts: DrawBotOpts,
): void {
  const dx = Math.max(-1, Math.min(1, opts.pupilDx ?? 0));
  const now = opts.now ?? 0;
  const blinking =
    opts.now !== undefined && (now / 1000 + (opts.blinkSeed ?? 0) * 1.37) % 5.3 < 0.14;
  if (blinking) {
    R(t, px + 9, py + row + 1, 3, 1, C.outline);
    R(t, px + 12, py + row + 1, 3, 1, C.outline);
    return;
  }
  R(t, px + 9, py + row, 3, 2, "#ffffff");
  R(t, px + 12, py + row, 3, 2, "#ffffff");
  R(t, px + 10 + dx, py + row, 1, 2, C.outline);
  R(t, px + 13 + dx, py + row, 1, 2, C.outline);
}

/** mouth with talk animation; row = top row of the mouth */
function drawMouth(t: PixelTarget, px: number, py: number, row: number, opts: DrawBotOpts): void {
  const open = opts.talking && Math.floor((opts.now ?? 0) / 160) % 2 === 0;
  if (open) {
    R(t, px + 11, py + row, 2, 2, "rgba(38,38,46,0.85)");
  } else {
    R(t, px + 11, py + row, 2, 1, "rgba(38,38,46,0.75)");
  }
}

/**
 * Draw a bot with feet at (cx, feetY) — px is the left edge of the 24px cell.
 * `py` is derived by the caller via drawBotAt().
 */
function drawBody(
  t: PixelTarget,
  px: number,
  py: number,
  look: BotLook,
  frame: BotFrame,
  opts: DrawBotOpts = {},
): void {
  const sitting = frame === "sitA" || frame === "sitB";
  const bob = frame === "walkA" || frame === "walkB" ? 0 : 0;

  if (!sitting) {
    /* ---------------- head ---------------- */
    // dome: rows 4-13 (rounded via narrower top/bottom rows)
    R(t, px + 8, py + 4, 8, 2, look.skin); // 4-5
    R(t, px + 7, py + 6, 10, 7, look.skin); // 6-12
    R(t, px + 8, py + 13, 8, 1, look.skin); // 13 chin
    // ears
    R(t, px + 6, py + 9, 1, 2, look.skin);
    R(t, px + 17, py + 9, 1, 2, look.skin);

    /* ---------------- hair ---------------- */
    const H = look.hair;
    switch (look.hairStyle) {
      case 0: // short
        R(t, px + 7, py + 2, 10, 3, H);
        R(t, px + 7, py + 5, 2, 3, H);
        R(t, px + 15, py + 5, 2, 3, H);
        break;
      case 1: // side part
        R(t, px + 7, py + 2, 10, 3, H);
        R(t, px + 7, py + 5, 4, 2, H);
        R(t, px + 15, py + 5, 2, 1, H);
        break;
      case 2: // long — drawn behind shoulders too
        R(t, px + 7, py + 2, 10, 3, H);
        R(t, px + 7, py + 5, 2, 4, H);
        R(t, px + 15, py + 5, 2, 4, H);
        R(t, px + 6, py + 8, 2, 8, H);
        R(t, px + 16, py + 8, 2, 8, H);
        break;
      case 3: // bald
        R(t, px + 9, py + 5, 3, 1, "rgba(255,255,255,0.35)"); // shine
        break;
      case 4: // spiky
        R(t, px + 8, py + 3, 2, 2, H);
        R(t, px + 11, py + 2, 2, 3, H);
        R(t, px + 14, py + 3, 2, 2, H);
        R(t, px + 7, py + 4, 10, 2, H);
        break;
      default: // receding
        R(t, px + 9, py + 3, 6, 2, H);
        R(t, px + 7, py + 5, 2, 2, H);
        R(t, px + 15, py + 5, 2, 2, H);
        break;
    }

    /* ---------------- face ---------------- */
    drawEyes(t, px, py, 8, opts);
    drawMouth(t, px, py, 11, opts);
    if (look.glasses) {
      R(t, px + 8, py + 7, 5, 1, C.outline);
      R(t, px + 8, py + 7, 1, 4, C.outline);
      R(t, px + 12, py + 7, 4, 1, C.outline);
      R(t, px + 15, py + 7, 1, 4, C.outline);
      R(t, px + 12, py + 9, 1, 1, C.outline);
    }

    /* ---------------- torso ---------------- */
    const shirtTop = 15;
    R(t, px + 8, py + shirtTop, 8, 2, look.shirt); // shoulders 15-16
    R(t, px + 6, py + shirtTop + 2, 12, 5, look.shirt); // 17-21
    // collar
    R(t, px + 10, py + shirtTop, 4, 1, "rgba(255,255,255,0.55)");
    if (look.tie) {
      R(t, px + 11, py + shirtTop + 1, 2, 1, look.tieColor);
      R(t, px + 11, py + shirtTop + 2, 2, 3, look.tieColor);
    }
  } else {
    /* ---------------- sitting (rows shifted, legs hidden by desk) --------- */
    // head rows 0-9
    R(t, px + 8, py, 8, 2, look.skin);
    R(t, px + 7, py + 2, 10, 6, look.skin);
    R(t, px + 8, py + 8, 8, 1, look.skin);
    R(t, px + 6, py + 5, 1, 2, look.skin);
    R(t, px + 17, py + 5, 1, 2, look.skin);
    const H = look.hair;
    if (look.hairStyle === 2) {
      R(t, px + 6, py + 3, 12, 2, H);
      R(t, px + 6, py + 4, 2, 6, H);
      R(t, px + 16, py + 4, 2, 6, H);
    } else if (look.hairStyle === 3) {
      R(t, px + 9, py + 1, 3, 1, "rgba(255,255,255,0.35)");
    } else {
      R(t, px + 7, py - 2, 10, 3, H);
      R(t, px + 7, py + 1, 2, 2, H);
      R(t, px + 15, py + 1, 2, 2, H);
      if (look.hairStyle === 4) {
        R(t, px + 8, py - 3, 2, 1, H);
        R(t, px + 11, py - 4, 2, 2, H);
        R(t, px + 14, py - 3, 2, 1, H);
      }
    }
    // eyes rows 4-5, mouth row 7
    drawEyes(t, px, py, 4, opts);
    drawMouth(t, px, py, 7, opts);
    if (look.glasses) {
      R(t, px + 8, py + 3, 5, 1, C.outline);
      R(t, px + 8, py + 3, 1, 4, C.outline);
      R(t, px + 12, py + 3, 4, 1, C.outline);
      R(t, px + 15, py + 3, 1, 4, C.outline);
      R(t, px + 12, py + 5, 1, 1, C.outline);
    }
    // torso rows 9-16, arms forward on the desk
    R(t, px + 8, py + 9, 8, 2, look.shirt);
    R(t, px + 6, py + 11, 12, 4, look.shirt);
    R(t, px + 10, py + 9, 4, 1, "rgba(255,255,255,0.55)");
    if (look.tie) {
      R(t, px + 11, py + 10, 2, 1, look.tieColor);
      R(t, px + 11, py + 11, 2, 2, look.tieColor);
    }
    // forward arms + typing hands
    const handUp = frame === "sitA";
    R(t, px + 4, py + 11, 4, 2, look.shirt);
    R(t, px + 16, py + 11, 4, 2, look.shirt);
    R(t, px + 4, py + 13 + (handUp ? 0 : 1), 3, 2, look.skin);
    R(t, px + 17, py + 13 + (handUp ? 1 : 0), 3, 2, look.skin);
    return; // legs hidden
  }

  /* ---------------- arms (standing variants) ---------------- */
  const swing = frame === "walkA" ? 1 : frame === "walkB" ? -1 : 0;
  if (frame === "carry") {
    // both arms forward holding a ream
    R(t, px + 5, py + 18, 3, 3, look.shirt);
    R(t, px + 16, py + 18, 3, 3, look.shirt);
    R(t, px + 6, py + 21, 12, 2, look.skin);
    R(t, px + 8, py + 16, 8, 5, C.paper); // the ream
    R(t, px + 8, py + 16, 8, 1, C.paperShade);
    return;
  }
  // sleeves
  R(t, px + 4, py + 17 + Math.max(0, swing), 3, 3, look.shirt);
  R(t, px + 17, py + 17 + Math.max(0, -swing), 3, 3, look.shirt);
  // hands
  R(t, px + 4, py + 20 + Math.max(0, swing), 3, 2, look.skin);
  R(t, px + 17, py + 20 + Math.max(0, -swing), 3, 2, look.skin);

  /* ---------------- legs & shoes ---------------- */
  const legTop = 22;
  if (look.skirt) {
    R(t, px + 5, py + legTop, 14, 3, look.pants); // skirt
    R(t, px + 8, py + legTop + 3, 3, 2, look.skin);
    R(t, px + 13, py + legTop + 3, 3, 2, look.skin);
  } else {
    R(t, px + 8, py + legTop, 3, 5, look.pants);
    R(t, px + 13, py + legTop, 3, 5, look.pants);
    R(t, px + 10, py + legTop + 1, 3, 4, look.pants); // hip fill
  }
  const lift = frame === "walkA" ? 1 : frame === "walkB" ? -1 : 0;
  // left shoe (lifts on walkA)
  const lShoeY = py + 27 - Math.max(0, lift);
  R(t, px + 7, lShoeY, 5, 3 - Math.max(0, lift), look.shoe);
  R(t, px + 7, lShoeY + 2, 5, 1, "#3d3d47");
  // right shoe (lifts on walkB)
  const rShoeY = py + 27 - Math.max(0, -lift);
  R(t, px + 12, rShoeY, 5, 3 - Math.max(0, -lift), look.shoe);
  R(t, px + 12, rShoeY + 2, 5, 1, "#3d3d47");
}

/** Feet-center + frame → pixel position helper. */
export function botDrawPos(cx: number, feetY: number, frame: BotFrame): { px: number; py: number } {
  const sitting = frame === "sitA" || frame === "sitB";
  return {
    px: Math.round(cx - CHAR_W / 2),
    py: Math.round(sitting ? feetY - 22 : feetY - CHAR_H),
  };
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
