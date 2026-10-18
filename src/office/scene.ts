import { C, lerpHex } from "./palette";
import { ITEM_SPRITES } from "./sprites";
import { BOSS_LOOK, CHAR_H, CHAR_W, SEATED_H, botLook, drawBot, drawBotShadow } from "./characters";
import { drawText, drawSpriteGrid, textWidth, wrapText, type PixelTarget } from "./render-core";
import {
  BOSS_SEAT,
  DESKS,
  DESK_SCREEN,
  FURNITURE,
  MAP,
  MAP_H,
  MAP_W,
  TILE,
  ZONES,
  findPath,
  isDoor,
  isTileFloor,
  isWall,
  tileCenter,
  WALKABLE,
  type Furniture,
} from "./floorplan";
import type { BotSpec } from "../lib/hermes/derive";
import type { OfficeEvent } from "../lib/hermes/types";

const SPEED = 46; // px per second
const BUBBLE_MS = 5200;
const AMBIENT_MS = 9000;

/** Original meeting-room small talk for bots seated at the round table. */
const CONFERENCE_TALK = [
  "This meeting could've been a TPS report.",
  "Let's take this offline. Wait — we're all offline.",
  "Circling back is my whole personality.",
  "Synergy is just teamwork with a budget.",
  "I've scheduled the follow-up to the pre-follow-up.",
  "Per my last email… which I just wrote.",
];

/** Couch wisdom for the reception sofa. */
const SOFA_TALK = [
  "Five more minutes, then the inbox. Promise.",
  "The couch has better WiFi. I checked.",
  "This is a load-bearing nap.",
  "Reception is the heart of the company. Ask anyone here.",
];

/** Ceiling light fixtures — warm floor pools + fixture plates. */
const LIGHT_FIXTURES: Array<[number, number]> = [
  [4, 8],
  [9, 8],
  [14, 8],
  [19, 8],
  [4, 12],
  [9, 12],
  [14, 12],
  [19, 12],
  [28, 9],
  [32, 13],
  [27, 2],
  [32, 3],
  [4, 2],
  [7, 5],
  [5, 18],
  [10, 18],
  [16, 18],
  [21, 18],
  [30, 18],
];

function shadeHex(a: string, b: string, f: number): string {
  return lerpHex(a, b, f);
}

type Activity = "stand" | "walk" | "type" | "carry" | "sit";

interface Waypoint {
  x: number;
  y: number;
  onArrive?: "pickupPaper" | "dropPaper" | "sitDown";
}

interface Entity {
  id: string;
  kind: "bot" | "boss";
  spec: BotSpec | null;
  x: number;
  y: number;
  path: Waypoint[];
  activity: Activity;
  deskIdx: number | null;
  spot: string; // "desk" | "deskStand" | "watercooler" | "wander" | "coffee" | "door" | "conference" | "sofa"
  bubble: { text: string; until: number } | null;
  animT: number;
  carry: boolean;
  delivery: null | { phase: "toPrinter" | "toBoss"; taskId: string };
  lastAmbient: number;
  spawnFlash: number;
  lastStatus: string;
}

function nowS(): number {
  return Date.now() / 1000;
}

export class OfficeScene {
  selectedId: string | null = null;
  hoverId: string | null = null;
  /** Pin the time-of-day phase (0-24) for deterministic renders; null = real clock. */
  fixedDayPhase: number | null = null;
  private entities = new Map<string, Entity>();
  private deskOwner = new Map<number, string>(); // deskIdx -> botId
  private activeDesks = new Set<string>();
  private boss: Entity;
  private gatewayRunning = true;
  private gatewayDegraded = false;
  private bossVisible = true;
  private _night = 0;
  private _sky = "#aee0ef";
  private _skyBand = "#8fc4dc";

  constructor() {
    this.boss = {
      id: "__boss",
      kind: "boss",
      spec: null,
      x: 0,
      y: 0,
      path: [],
      activity: "type",
      deskIdx: null,
      spot: "desk",
      bubble: null,
      animT: 0,
      carry: false,
      delivery: null,
      lastAmbient: 0,
      spawnFlash: 0,
      lastStatus: "",
    };
    const seat = tileCenter(BOSS_SEAT.x, BOSS_SEAT.y);
    this.boss.x = seat.x;
    this.boss.y = seat.y;
  }

  /* ---------------- bot lifecycle ---------------- */

  private assignDesk(botId: string): number | null {
    for (const [idx, owner] of this.deskOwner) if (owner === botId) return idx;
    for (let i = 0; i < DESKS.length; i++) {
      if (!this.deskOwner.has(i)) {
        this.deskOwner.set(i, botId);
        return i;
      }
    }
    return null;
  }

  private freeDesk(botId: string): void {
    for (const [idx, owner] of this.deskOwner) {
      if (owner === botId) this.deskOwner.delete(idx);
    }
  }

  private entityFor(spec: BotSpec, now: number): Entity {
    let e = this.entities.get(spec.id);
    if (!e) {
      // Fresh hires (spawned within ±2 min of "now") walk in through the door.
      const age = now - spec.spawnTs * 1000;
      const fromDoor = age > -120_000 && age < 120_000;
      const start = fromDoor ? ZONES.door : this.spotTile(spec, "desk");
      const sc = tileCenter(start.x, start.y);
      e = {
        id: spec.id,
        kind: "bot",
        spec,
        x: sc.x,
        y: sc.y,
        path: [],
        activity: "stand",
        deskIdx: null,
        spot: "desk",
        bubble: null,
        animT: Math.random() * 10,
        carry: false,
        delivery: null,
        lastAmbient: now + Math.random() * AMBIENT_MS,
        spawnFlash: fromDoor ? now + 4000 : 0,
        lastStatus: spec.status,
      };
      this.entities.set(spec.id, e);
    }
    return e;
  }

  /** Where should this status put the bot? Idle bots re-roll every ~45s. */
  private spotFor(spec: BotSpec, now: number): string {
    const seed = spec.paletteSeed;
    switch (spec.status) {
      case "working":
        return "desk";
      case "stuck":
        return "deskStand";
      case "coffee":
        return "coffee";
      case "idle":
      default: {
        const roll = (seed + Math.floor(now / 45_000)) % 10;
        if (roll < 3) return "deskStand";
        if (roll < 6) return "watercooler";
        if (roll < 8) return "wander";
        if (roll < 9) return "conference";
        return "sofa";
      }
    }
  }

  private spotTile(spec: BotSpec, _hint: string): { x: number; y: number } {
    const seed = spec.paletteSeed;
    const deskIdx = this.assignDesk(spec.id);
    if (deskIdx != null) {
      const d = DESKS[deskIdx];
      return { x: d.seatX, y: d.seatY };
    }
    // no desk left: hover near the watercooler
    const w = ZONES.watercooler[seed % 2];
    return { x: w.x, y: w.y };
  }

  private goTo(e: Entity, tx: number, ty: number, onArrive?: Waypoint["onArrive"]): void {
    const sx = Math.floor(e.x / TILE);
    const sy = Math.floor((e.y - 1) / TILE);
    let tiles = findPath(sx, sy, tx, ty);
    if (!tiles.length && (sx !== tx || sy !== ty) && !WALKABLE[sy * MAP_W + sx]) {
      // standing on furniture (e.g. sofa cushions) — step off north and retry
      e.y -= TILE;
      tiles = findPath(sx, sy - 1, tx, ty);
    }
    const pts: Waypoint[] = tiles.map((p) => ({ ...tileCenter(p.x, p.y) }));
    if (onArrive) pts.push({ x: pts[pts.length - 1]?.x ?? e.x, y: pts[pts.length - 1]?.y ?? e.y, onArrive });
    e.path = pts;
    e.activity = pts.length ? "walk" : e.activity;
  }

  /** Public sync from derived bots. */
  syncBots(bots: BotSpec[], now: number): void {
    const seen = new Set<string>();
    for (const spec of bots) {
      seen.add(spec.id);
      const e = this.entityFor(spec, now);
      e.spec = spec;
      if (e.lastStatus !== spec.status || !e.path.length) {
        e.lastStatus = spec.status;
        e.spot = this.spotFor(spec, now);
        this.applySpot(e, now);
      }
    }
    for (const [id, e] of this.entities) {
      if (!seen.has(id)) {
        if (e.spec && e.spec.status === "away") continue; // hidden by cap, keep seat
        this.entities.delete(id);
        this.freeDesk(id);
      }
    }
  }

  private applySpot(e: Entity, now: number): void {
    const spec = e.spec!;
    const deskIdx = this.assignDesk(spec.id);
    e.deskIdx = deskIdx;
    const desk = deskIdx != null ? DESKS[deskIdx] : null;
    switch (e.spot) {
      case "desk":
        if (desk) {
          e.activity = "type";
          this.goTo(e, desk.seatX, desk.seatY);
        } else {
          e.spot = "watercooler";
          this.applySpot(e, now);
        }
        break;
      case "deskStand":
        if (desk) {
          e.activity = "stand";
          this.goTo(e, desk.seatX, desk.seatY);
        } else {
          e.spot = "wander";
          this.applySpot(e, now);
        }
        break;
      case "watercooler": {
        const w = ZONES.watercooler[spec.paletteSeed % ZONES.watercooler.length];
        e.activity = "stand";
        this.goTo(e, w.x, w.y);
        break;
      }
      case "coffee":
        e.activity = "stand";
        this.goTo(e, ZONES.coffee.x, ZONES.coffee.y);
        break;
      case "wander": {
        const w = ZONES.wander[spec.paletteSeed % ZONES.wander.length];
        e.activity = "stand";
        this.goTo(e, w.x, w.y);
        break;
      }
      case "conference": {
        // take a seat at the round table (chairs are walkable tiles)
        const c = ZONES.conference[spec.paletteSeed % ZONES.conference.length];
        if (
          e.activity === "sit" &&
          Math.abs(e.x - tileCenter(c.x, c.y).x) < 1 &&
          Math.abs(e.y - tileCenter(c.x, c.y).y) < 1
        )
          break; // already seated here
        this.goTo(e, c.x, c.y);
        break;
      }
      case "sofa": {
        // walk north of the couch, then step onto the cushions and sit
        const s = ZONES.sofa[spec.paletteSeed % ZONES.sofa.length];
        if (
          e.activity === "sit" &&
          Math.abs(e.x - tileCenter(s.x, s.y).x) < 1 &&
          Math.abs(e.y - tileCenter(s.x, s.y).y) < 1
        )
          break; // already seated here
        this.goTo(e, s.x, s.y - 1, "sitDown");
        break;
      }
    }
  }

  /** Align the boss with the actual gateway state (no event required). */
  setGateway(running: boolean, degraded = false): void {
    this.gatewayDegraded = degraded;
    if (running === this.gatewayRunning) return;
    this.gatewayRunning = running;
    this.bossVisible = running;
    if (running) {
      this.goTo(this.boss, BOSS_SEAT.x, BOSS_SEAT.y);
      this.boss.activity = "walk";
    } else {
      this.goTo(this.boss, ZONES.coffee.x, ZONES.coffee.y);
      this.boss.activity = "walk";
    }
  }

  /** Consume office events: bubbles, paper errands, boss reactions. */
  handleEvents(events: OfficeEvent[], now: number): void {
    for (const ev of events) {
      if (ev.type === "tool_call" || ev.type === "bot_message") {
        const e = ev.sessionId ? this.entities.get(ev.sessionId) : null;
        if (e && ev.text) e.bubble = { text: ev.text, until: now + BUBBLE_MS };
      } else if (ev.type === "bot_spawned") {
        const e = ev.sessionId ? this.entities.get(ev.sessionId) : null;
        if (e) {
          e.spawnFlash = now + 5000;
          e.bubble = { text: "Hello. I am new here.", until: now + BUBBLE_MS };
        }
      } else if (ev.type === "gateway") {
        this.gatewayRunning = ev.text.includes("back online");
        this.bossVisible = this.gatewayRunning;
        this.boss.bubble = { text: ev.text, until: now + BUBBLE_MS * 1.5 };
        if (!this.gatewayRunning) {
          // boss heads for the coffee machine while the gateway is down
          this.goTo(this.boss, ZONES.coffee.x, ZONES.coffee.y);
          this.boss.activity = "walk";
        } else {
          this.goTo(this.boss, BOSS_SEAT.x, BOSS_SEAT.y);
          this.boss.activity = "walk";
        }
      } else if (ev.type === "run_update" && ev.text.includes("completed")) {
        const candidates = [...this.entities.values()].filter(
          (e) => e.spec && e.spec.status === "working" && !e.delivery && !e.carry,
        );
        const owner =
          candidates.find((e) => e.spec!.taskIds.includes(ev.taskId ?? "")) ?? candidates[0];
        if (owner) owner.delivery = { phase: "toPrinter", taskId: ev.taskId ?? "" };
      }
    }
  }

  /* ---------------- simulation ---------------- */

  update(dt: number, now: number): void {
    // desk activity glow
    this.activeDesks.clear();
    for (const e of this.entities.values()) {
      if (e.activity === "type" && e.deskIdx != null) {
        const d = DESKS[e.deskIdx];
        this.activeDesks.add(`${d.x},${d.y}`);
      }
    }
    if (this.gatewayRunning && this.bossVisible) this.activeDesks.add(`${BOSS_SEAT.x - 1},${BOSS_SEAT.y - 1}`);

    const all: Entity[] = [...this.entities.values(), this.boss];
    for (const e of all) {
      // movement
      if (e.path.length) {
        const target = e.path[0];
        const dx = target.x - e.x;
        const dy = target.y - e.y;
        const dist = Math.hypot(dx, dy);
        const step = SPEED * dt;
        if (dist <= step) {
          e.x = target.x;
          e.y = target.y;
          e.path.shift();
          if (target.onArrive === "pickupPaper") {
            e.carry = true;
            const bossTile = { x: 3, y: 5 };
            this.goTo(e, bossTile.x, bossTile.y, "dropPaper");
            e.bubble = { text: "Got the TPS report!", until: now + BUBBLE_MS };
          } else if (target.onArrive === "dropPaper") {
            e.carry = false;
            e.delivery = null;
            e.bubble = { text: "Delivered to the boss. Dundie-worthy.", until: now + BUBBLE_MS };
            if (e.spec) this.applySpot(e, now);
          } else if (target.onArrive === "sitDown") {
            // step from the tile north of the sofa onto the cushions
            e.y += TILE;
            e.activity = "sit";
          }
          if (!e.path.length && e.activity === "walk") {
            e.activity =
              e.carry
                ? "carry"
                : e.spot === "desk"
                  ? "type"
                  : e.spot === "conference" || e.spot === "sofa"
                    ? "sit"
                    : "stand";
          }
        } else {
          e.x += (dx / dist) * step;
          e.y += (dy / dist) * step;
          e.activity = e.carry ? "carry" : "walk";
        }
      }

      // delivery kick-off
      if (e.delivery && e.delivery.phase === "toPrinter" && !e.path.length) {
        this.goTo(e, ZONES.printer.x, ZONES.printer.y, "pickupPaper");
        e.delivery.phase = "toBoss";
      }

      // ambient bubbles so the office feels alive
      if (e.spec && now > e.lastAmbient) {
        e.lastAmbient = now + AMBIENT_MS * (0.7 + Math.random() * 0.8);
        if (!e.bubble || e.bubble.until < now) {
          let t = e.spec.statusText;
          if (e.activity === "sit" && Math.random() < 0.5) {
            const pool = e.spot === "conference" ? CONFERENCE_TALK : SOFA_TALK;
            t = pool[Math.floor(Math.random() * pool.length)];
          }
          if (t) e.bubble = { text: t, until: now + BUBBLE_MS };
        }
      }

      if (e.bubble && e.bubble.until < now) e.bubble = null;
      e.animT += dt;
    }
  }

  /* ---------------- drawing ---------------- */

  /** Time of day 0-24 (real clock, or the pinned preview phase). */
  private dayPhase(now: number): number {
    if (this.fixedDayPhase != null) return this.fixedDayPhase;
    const d = new Date(now);
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  }

  private computeDaylight(now: number): void {
    const phase = this.dayPhase(now);
    let nf: number;
    if (phase >= 8 && phase < 17) nf = 0;
    else if (phase >= 20 || phase < 5) nf = 1;
    else if (phase < 8) nf = 1 - (phase - 5) / 3;
    else nf = (phase - 17) / 3;
    this._night = Math.max(0, Math.min(1, nf));
    // warm amber push at dawn/dusk only (zero at full day and full night)
    const duskMix = Math.max(0, 1 - 2 * Math.abs(this._night - 0.5)) * 0.55;
    this._sky = lerpHex(lerpHex("#aee0ef", "#16233f", this._night), "#f2a65e", duskMix);
    this._skyBand = lerpHex(lerpHex("#8fc4dc", "#0d1526", this._night), "#f7c37a", duskMix * 0.5);
  }

  draw(t: PixelTarget, now: number): void {
    this.computeDaylight(now);
    this.drawFloor(t);
    this.drawWallDecor(t, now);
    this.drawLightPools(t, now);
    // furniture back-to-front
    const sorted = [...FURNITURE].sort((a, b) => a.y - b.y || a.x - b.x);
    for (const f of sorted) this.drawFurniture(t, f, now);
    this.drawWetFloorSign(t, 18 * TILE, 9 * TILE);

    // entities back-to-front
    const ents = [...this.entities.values()].filter(
      (e) => !(e.spec && e.spec.status === "away"),
    );
    if (this.gatewayRunning && this.bossVisible) ents.push(this.boss);
    ents.sort((a, b) => a.y - b.y);
    for (const e of ents) this.drawEntity(t, e, now);

    // after-hours tint over everything but the bubbles
    const na = this._night * 0.16;
    if (na > 0.01) t.rect(0, 0, MAP_W * TILE, MAP_H * TILE, `rgba(14,20,44,${na.toFixed(3)})`);

    // bubbles last
    for (const e of ents) if (e.bubble) this.drawBubble(t, e);
  }

  /* ---------------- floor ---------------- */

  private drawFloor(t: PixelTarget): void {
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const px = x * TILE;
        const py = y * TILE;
        if (isWall(x, y)) {
          this.drawWall(t, x, y, px, py);
          if (MAP[y][x] === "w") this.drawWindow(t, px, py);
        } else if (isTileFloor(x, y)) {
          const alt = (x + y) % 2 === 0;
          t.rect(px, py, TILE, TILE, alt ? C.tile : C.tileAlt);
          // grout lines
          t.rect(px + TILE - 1, py, 1, TILE, C.grout);
          t.rect(px, py + TILE - 1, TILE, 1, C.grout);
        } else {
          const alt = (x + y) % 2 === 0;
          t.rect(px, py, TILE, TILE, alt ? C.carpet : C.carpetAlt);
          // sparse carpet speckle for texture
          const sx = ((x * 13 + y * 7) % 17) + 3;
          const sy = ((x * 7 + y * 11) % 17) + 3;
          t.rect(px + sx, py + sy, 2, 1, C.carpetDot);
          if ((x * 5 + y * 3) % 9 === 0) t.rect(px + ((sx + 8) % 19), py + ((sy + 9) % 19), 1, 1, C.carpetDot);
        }
        // boss office glass wall (south wall of the office, skip door x5)
        if (y === 6 && x >= 1 && x <= 9 && x !== 5) {
          this.drawGlassWall(t, px, py);
        }
        if (isDoor(x, y)) {
          t.rect(px, py, TILE, TILE, C.tile);
          t.rect(px, py, TILE, 4, C.door);
          t.rect(px, py + TILE - 4, TILE, 4, C.doorDark);
          // welcome mat
          t.rect(px + 4, py + TILE - 7, TILE - 8, 3, "#8a6b52");
          t.rect(px + 5, py + TILE - 6, TILE - 10, 1, "#9a7b62");
        }
      }
    }
  }

  private drawWall(t: PixelTarget, x: number, y: number, px: number, py: number): void {
    t.rect(px, py, TILE, TILE, C.wall);
    t.rect(px, py, TILE, 4, C.wallTop);
    const floorBelow = y + 1 < MAP_H && !isWall(x, y + 1);
    if (floorBelow) {
      // baseboard at the bottom of south-facing walls
      t.rect(px, py + TILE - 5, TILE, 4, C.wallShade);
      t.rect(px, py + TILE - 1, TILE, 1, C.outline);
    } else {
      t.rect(px, py + TILE - 3, TILE, 2, C.wallShade);
    }
    if (x % 4 === 0 || (x + y) % 7 === 0) {
      t.rect(px + 4, py + 8, 3, 14, C.wallShade);
      t.rect(px + TILE - 7, py + 8, 3, 14, C.wallShade);
    }
  }

  private drawWindow(t: PixelTarget, px: number, py: number): void {
    const wx = px + 4;
    const wy = py + 6;
    const ww = TILE - 8;
    const wh = TILE - 12;
    // sky with two-tone band
    t.rect(wx, wy, ww, wh, this._sky);
    t.rect(wx, wy, ww, Math.max(3, Math.floor(wh / 3)), this._skyBand);
    // stars after dark — placed inside the panes, never on the frame cross
    if (this._night > 0.55) {
      const a = Math.min(1, (this._night - 0.55) / 0.45);
      for (let i = 0; i < 4; i++) {
        const col = 1 + ((px * 7 + py * 3 + i * 5) % (ww - 3));
        const sxx = wx + (col >= Math.floor(ww / 2) ? col + 1 : col);
        const row = 1 + ((px * 3 + py * 11 + i * 7) % (wh - 3));
        const syy = wy + (row >= Math.floor(wh / 2) ? row + 1 : row);
        t.rect(sxx, syy, 1, 1, `rgba(255,255,255,${(0.85 * a).toFixed(2)})`);
      }
    }
    // frame + cross
    t.rect(wx - 1, wy - 1, ww + 2, 1, C.windowFrame);
    t.rect(wx - 1, wy + wh, ww + 2, 1, C.windowFrame);
    t.rect(wx - 1, wy, 1, wh, C.windowFrame);
    t.rect(wx + ww, wy, 1, wh, C.windowFrame);
    t.rect(wx + Math.floor(ww / 2), wy, 1, wh, C.windowFrame);
    t.rect(wx, wy + Math.floor(wh / 2), ww, 1, C.windowFrame);
    // reflection
    t.rect(wx + 3, wy + 2, 3, 1, "rgba(255,255,255,0.4)");
    t.rect(wx + 6, wy + 3, 3, 1, "rgba(255,255,255,0.25)");
    // sill
    t.rect(px + 3, wy + wh + 1, TILE - 6, 2, C.wallShade);
  }

  private drawGlassWall(t: PixelTarget, px: number, py: number): void {
    const gx = px + 1;
    const gy = py + 3;
    const gw = TILE - 2;
    const gh = TILE - 8;
    t.rect(gx - 1, gy - 1, gw + 2, 1, C.windowFrame);
    t.rect(gx - 1, gy + gh, gw + 2, 1, C.windowFrame);
    t.rect(gx - 1, gy, 1, gh, C.windowFrame);
    t.rect(gx + gw, gy, 1, gh, C.windowFrame);
    t.rect(gx, gy, gw, gh, this._sky);
    t.rect(gx, gy, gw, 4, this._skyBand);
    if (this._night > 0.55) {
      const a = Math.min(1, (this._night - 0.55) / 0.45);
      t.rect(gx + 5, gy + 3, 1, 1, `rgba(255,255,255,${(0.8 * a).toFixed(2)})`);
      t.rect(gx + gw - 7, gy + 6, 1, 1, `rgba(255,255,255,${(0.7 * a).toFixed(2)})`);
      t.rect(gx + 12, gy + gh - 8, 1, 1, `rgba(255,255,255,${(0.75 * a).toFixed(2)})`);
    }
    // reflection diagonal
    t.rect(gx + 4, gy + 3, 3, 1, "rgba(255,255,255,0.35)");
    t.rect(gx + 7, gy + 5, 3, 1, "rgba(255,255,255,0.2)");
    t.rect(gx + gw - 9, gy + gh - 6, 3, 1, "rgba(255,255,255,0.25)");
    t.rect(gx + Math.floor(gw / 2), gy, 1, gh, C.windowFrame);
  }

  /* ---------------- lighting & wall decor ---------------- */

  private drawLightPools(t: PixelTarget, now: number): void {
    void now;
    for (const [lx, ly] of LIGHT_FIXTURES) {
      const px = lx * TILE;
      const py = ly * TILE;
      const warm = 0.06 + this._night * 0.16;
      t.rect(px + 3, py + 4, TILE - 6, TILE - 8, `rgba(255,238,190,${(warm * 0.5).toFixed(3)})`);
      t.rect(px + 8, py + 8, TILE - 16, TILE - 16, `rgba(255,238,190,${warm.toFixed(3)})`);
      // fixture plate
      t.rect(px + 9, py + 9, 14, 14, C.metalDark);
      t.rect(
        px + 11,
        py + 11,
        10,
        10,
        this._night > 0.3
          ? `rgba(255,240,200,${(0.5 + this._night * 0.4).toFixed(2)})`
          : "#e8eef2",
      );
    }
  }

  /** Framed portraits, wall clock, motivational poster, reception sign. */
  private drawWallDecor(t: PixelTarget, now: number): void {
    this.drawPortrait(t, 6 * TILE, 6 * TILE);
    this.drawPortrait(t, 15 * TILE, 6 * TILE);
    this.drawWallClock(t, 9 * TILE, 6 * TILE, now);
    this.drawPoster(t, 12 * TILE, 6 * TILE);
    // DUNDER BOTS, INC. over reception
    const sx = 8 * TILE;
    const sy = 21 * TILE;
    const sw = 3 * TILE;
    t.rect(sx, sy + 5, sw, 22, C.navy);
    t.rect(sx + 3, sy + 8, sw - 6, 16, "#31435e");
    const label = "DUNDER BOTS, INC.";
    const w = textWidth(label);
    drawText(t, label, sx + Math.round((sw - w) / 2), sy + 13, "#f5f0e2");
    t.rect(sx + 5, sy + 10, 2, 2, C.metal);
    t.rect(sx + sw - 7, sy + 10, 2, 2, C.metal);
  }

  /** Employee-of-the-month style portrait: frame, mat, tiny face, plaque. */
  private drawPortrait(t: PixelTarget, px: number, py: number): void {
    t.rect(px + 6, py + 7, 20, 18, "#6b4f37");
    t.rect(px + 7, py + 8, 18, 16, "#e8eef2");
    t.rect(px + 12, py + 10, 8, 3, "#3a2a1c"); // hair
    t.rect(px + 12, py + 13, 8, 6, C.skin[0]); // face
    t.rect(px + 14, py + 15, 1, 1, C.outline);
    t.rect(px + 18, py + 15, 1, 1, C.outline);
    t.rect(px + 15, py + 16, 2, 3, C.navy); // tie
    t.rect(px + 12, py + 19, 8, 4, C.navy); // shoulders
    t.rect(px + 11, py + 22, 10, 1, C.amber); // plaque
  }

  private drawWallClock(t: PixelTarget, px: number, py: number, now: number): void {
    const cx = px + 16;
    const cy = py + 15;
    t.rect(px + 7, py + 6, 18, 18, "#e8eef2");
    t.rect(px + 7, py + 6, 18, 1, C.windowFrame);
    t.rect(px + 7, py + 23, 18, 1, C.windowFrame);
    t.rect(px + 7, py + 6, 1, 18, C.windowFrame);
    t.rect(px + 24, py + 6, 1, 18, C.windowFrame);
    const phase = this.dayPhase(now);
    const mins = Math.floor((phase % 1) * 60);
    const hAng = ((phase % 12) / 12) * Math.PI * 2 - Math.PI / 2;
    const mAng = (mins / 60) * Math.PI * 2 - Math.PI / 2;
    this.clockHand(t, cx, cy, hAng, 4);
    this.clockHand(t, cx, cy, mAng, 7);
    t.rect(cx, cy, 1, 1, C.red);
  }

  private clockHand(t: PixelTarget, cx: number, cy: number, ang: number, len: number): void {
    for (let i = 1; i <= len; i++) {
      t.rect(Math.round(cx + Math.cos(ang) * i), Math.round(cy + Math.sin(ang) * i), 1, 1, C.outline);
    }
  }

  /** "HANG IN THERE"-flavored motivational poster: mountain + sun. */
  private drawPoster(t: PixelTarget, px: number, py: number): void {
    t.rect(px + 5, py + 5, 22, 24, "#6b4f37");
    t.rect(px + 6, py + 6, 20, 22, "#cfe4ee");
    t.rect(px + 6, py + 18, 20, 10, "#7a9e6b");
    t.rect(px + 14, py + 10, 4, 2, "#8a8f96");
    t.rect(px + 12, py + 12, 8, 1, "#8a8f96");
    t.rect(px + 10, py + 13, 10, 1, "#8a8f96");
    t.rect(px + 9, py + 14, 12, 2, "#8a8f96");
    t.rect(px + 9, py + 16, 12, 2, "#8a8f96");
    t.rect(px + 16, py + 11, 1, 1, "#ffffff");
    t.rect(px + 15, py + 10, 1, 1, "#ffffff");
    t.rect(px + 8, py + 8, 3, 3, "#f7d97a");
  }

  private drawWetFloorSign(t: PixelTarget, px: number, py: number): void {
    t.rect(px + 14, py + 10, 4, 3, C.amber);
    t.rect(px + 12, py + 13, 8, 3, C.amber);
    t.rect(px + 9, py + 16, 14, 3, C.amber);
    t.rect(px + 15, py + 11, 1, 6, C.outline);
    t.rect(px + 15, py + 19, 1, 1, C.outline);
  }

  /* ---------------- furniture ---------------- */

  private drawFurniture(t: PixelTarget, f: Furniture, now: number): void {
    const px = f.x * TILE;
    const py = f.y * TILE;
    const W = (f.w ?? 1) * TILE;
    const on = this.activeDesks.has(`${f.x},${f.y}`);
    const blink = Math.floor(now / 700) % 2 === 0;
    switch (f.kind) {
      case "desk":
        this.drawDesk(t, px, py, W, on, now, (f.x * 7 + f.y * 13) % 4);
        break;
      case "chair":
        this.drawChair(t, px, py);
        break;
      case "bossDesk":
        this.drawBossDesk(t, px, py, W, now);
        break;
      case "bossChair":
        this.drawBossChair(t, px, py);
        break;
      case "confTable":
        this.drawConfTable(t, px, py, W);
        break;
      case "confChair":
        this.drawConfChair(t, px, py);
        break;
      case "watercooler":
        t.rect(px + 7, py + TILE - 1, 18, 1, C.shadow);
        drawSpriteGrid(t, ITEM_SPRITES.watercooler, px, py);
        // rising bubble in the bottle
        {
          const phase = Math.floor(now / 900) % 6;
          if (phase < 4) t.rect(px + 14 + (phase % 2), py + 12 - phase, 1, 1, "rgba(255,255,255,0.7)");
        }
        break;
      case "plant":
        t.rect(px + 6, py + TILE - 1, 20, 1, C.shadow);
        drawSpriteGrid(t, ITEM_SPRITES.plant, px, py);
        break;
      case "box":
        t.rect(px + 4, py + TILE - 1, 24, 1, C.shadow);
        drawSpriteGrid(t, ITEM_SPRITES.box, px, py);
        break;
      case "coffee":
        t.rect(px + 4, py + TILE - 1, 24, 1, C.shadow);
        drawSpriteGrid(t, ITEM_SPRITES.coffee, px, py);
        // steam
        for (let i = 0; i < 3; i++) {
          const phase = Math.floor(now / 420 + i * 5) % 12;
          if (phase < 10) {
            const a = 0.45 * (1 - phase / 10);
            t.rect(px + 7 + ((i * 4 + Math.floor(now / 600)) % 9), py - 2 - phase, 2, 2, `rgba(235,235,235,${a.toFixed(2)})`);
          }
        }
        break;
      case "fridge":
        this.drawFridge(t, px, py);
        break;
      case "counter":
        this.drawCounter(t, px, py, f.x % 3 === 0, now);
        break;
      case "printer":
        this.drawPrinter(t, px, py, now);
        break;
      case "copier":
        this.drawCopier(t, px, py, now);
        break;
      case "receptionDesk":
        this.drawReception(t, px, py, W);
        break;
      case "sofa":
        this.drawSofa(t, px, py, W);
        break;
      case "cabinet":
        this.drawCabinet(t, px, py);
        break;
      case "shelf":
        this.drawShelf(t, px, py);
        break;
      case "bobble":
        this.drawBobble(t, px, py);
        break;
      case "roundTable":
        this.drawRoundTable(t, px, py);
        break;
      case "whiteboard":
        this.drawWhiteboard(t, px, py);
        break;
    }
  }

  private drawDesk(
    t: PixelTarget,
    px: number,
    py: number,
    W: number,
    on: boolean,
    now: number,
    variant = 0,
  ): void {
    // contact shadow
    t.rect(px + 4, py + TILE - 1, W - 8, 1, C.shadow);
    // legs
    t.rect(px + 4, py + 22, 3, 9, C.woodDark);
    t.rect(px + W - 7, py + 22, 3, 9, C.woodDark);
    // front panel + drawer
    t.rect(px + 4, py + 17, W - 8, 9, C.wood);
    t.rect(px + 4, py + 21, W - 8, 1, C.woodDark);
    t.rect(px + 13, py + 22, 6, 1, C.metal);
    // desktop
    t.rect(px + 3, py + 13, W - 6, 4, C.wood);
    t.rect(px + 3, py + 13, W - 6, 1, C.woodLight);
    // monitor
    t.rect(px + 6, py + 1, 20, 14, C.metalDark);
    const sx = px + DESK_SCREEN.dx;
    const sy = py + DESK_SCREEN.dy;
    const sw = DESK_SCREEN.w;
    const sh = DESK_SCREEN.h;
    t.rect(sx, sy, sw, sh, on ? C.screenOn : C.screenOff);
    if (on) {
      // scrolling "terminal" lines
      const phase = Math.floor(now / 450) % 5;
      for (let i = 0; i < 3; i++) {
        const ly = sy + 1 + ((phase + i * 2) % (sh - 1));
        t.rect(sx + 1, ly, sw - 2 - (i % 2) * 4, 1, "#cfeef7");
      }
      if (Math.floor(now / 500) % 2 === 0) t.rect(sx + sw - 3, sy + sh - 2, 2, 1, "#ffffff");
      // glow
      t.rect(sx - 1, sy - 1, sw + 2, sh + 2, "rgba(159,216,232,0.22)");
    }
    // keyboard, mouse, mug, paper
    t.rect(px + 8, py + 15, 10, 1, C.metalDark);
    t.rect(px + 20, py + 15, 3, 2, C.metalDark);
    t.rect(px + 3, py + 15, 2, 2, "#e8eef2");
    t.rect(px + 23, py + 14, 5, 2, C.paper);
    t.rect(px + 23, py + 14, 5, 1, C.paperShade);
    // deterministic desk dressing
    if (variant === 1) {
      // sticky notes on the monitor bezel
      t.rect(px + 21, py + 1, 3, 3, C.amber);
      t.rect(px + 21, py + 5, 3, 3, "#e8eef2");
      t.rect(px + 20, py + 8, 3, 3, C.amber);
    } else if (variant === 2) {
      // tiny desk plant
      t.rect(px + 1, py + 12, 4, 4, "#a3562e");
      t.rect(px + 1, py + 8, 1, 4, C.greenLight);
      t.rect(px + 2, py + 7, 1, 5, C.greenLight);
      t.rect(px + 3, py + 8, 1, 4, "#4f7a3a");
    } else if (variant === 3) {
      // photo frame
      t.rect(px + 1, py + 3, 5, 7, C.metalDark);
      t.rect(px + 2, py + 4, 3, 5, "#c9a86b");
      t.rect(px + 3, py + 5, 1, 2, C.skin[0]);
    }
  }

  private drawChair(t: PixelTarget, px: number, py: number): void {
    t.rect(px + 9, py + 2, 14, 13, C.plastic);
    t.rect(px + 9, py + 2, 14, 1, C.metalDark);
    t.rect(px + 8, py + 15, 16, 4, C.metal);
    t.rect(px + 8, py + 15, 16, 1, C.metalHi);
    t.rect(px + 14, py + 19, 3, 6, C.metalDark);
    t.rect(px + 8, py + 25, 16, 3, C.metalDark);
    t.rect(px + 8, py + 28, 3, 3, C.outline);
    t.rect(px + 21, py + 28, 3, 3, C.outline);
  }

  private drawBossDesk(t: PixelTarget, px: number, py: number, W: number, now: number): void {
    t.rect(px + 4, py + TILE - 1, W - 8, 1, C.shadow);
    // front panel + drawers
    t.rect(px + 3, py + 18, W - 6, 10, C.woodDark);
    t.rect(px + 3, py + 18, W - 6, 1, C.wood);
    t.rect(px + 7, py + 22, 22, 4, C.wood);
    t.rect(px + 16, py + 23, 4, 1, C.metal);
    t.rect(px + W - 29, py + 22, 22, 4, C.wood);
    t.rect(px + W - 20, py + 23, 4, 1, C.metal);
    // desktop
    t.rect(px + 2, py + 13, W - 4, 5, C.wood);
    t.rect(px + 2, py + 13, W - 4, 1, C.woodLight);
    // papers
    t.rect(px + 8, py + 14, 8, 4, C.paper);
    t.rect(px + 8, py + 14, 8, 1, C.paperShade);
    t.rect(px + 18, py + 14, 7, 4, C.paperShade);
    // "World's Best Boss" mug
    t.rect(px + 27, py + 13, 5, 5, "#e8eef2");
    t.rect(px + 32, py + 14, 1, 3, "#e8eef2");
    t.rect(px + 27, py + 13, 5, 1, C.coffee);
    // nameplate
    t.rect(px + 37, py + 14, 11, 3, C.navy);
    t.rect(px + 38, py + 14, 9, 1, C.amber);
    // phone
    t.rect(px + W - 24, py + 14, 8, 3, C.metalDark);
    t.rect(px + W - 22, py + 14, 4, 1, C.metal);
    // lamp: pole + head + warm glow; blinks red while degraded
    t.rect(px + W - 8, py + 5, 1, 8, C.metalDark);
    const lampBlink = Math.floor(now / 600) % 2 === 0;
    const lampColor = !this.gatewayRunning
      ? C.metalDark
      : this.gatewayDegraded
        ? lampBlink
          ? C.red
          : C.amber
        : C.amber;
    t.rect(px + W - 11, py + 2, 5, 4, lampColor);
    if (this.gatewayRunning && !this.gatewayDegraded) {
      t.rect(px + W - 14, py + 6, 10, 8, "rgba(216,195,74,0.14)");
      t.rect(px + W - 15, py + 10, 12, 4, "rgba(216,195,74,0.09)");
    } else if (this.gatewayRunning && this.gatewayDegraded && lampBlink) {
      t.rect(px + W - 14, py + 6, 10, 8, "rgba(224,85,85,0.12)");
    }
  }

  private drawBossChair(t: PixelTarget, px: number, py: number): void {
    t.rect(px + 8, py + 2, 16, 15, "#3a3f4a");
    t.rect(px + 8, py + 2, 16, 1, C.outline);
    t.rect(px + 5, py + 10, 4, 7, "#2e323c");
    t.rect(px + 23, py + 10, 4, 7, "#2e323c");
    t.rect(px + 8, py + 17, 16, 4, "#3a3f4a");
    t.rect(px + 8, py + 17, 16, 1, "#4a505e");
    t.rect(px + 14, py + 21, 3, 5, C.metalDark);
    t.rect(px + 8, py + 26, 16, 3, C.metalDark);
    t.rect(px + 8, py + 29, 3, 2, C.outline);
    t.rect(px + 21, py + 29, 3, 2, C.outline);
  }

  private drawConfTable(t: PixelTarget, px: number, py: number, W: number): void {
    t.rect(px + 6, py + TILE - 1, W - 12, 1, C.shadow);
    // rounded slab
    t.rect(px + 3, py + 9, W - 6, 12, C.woodLight);
    t.rect(px, py + 12, W, 7, C.woodLight);
    t.rect(px + 3, py + 9, W - 6, 1, C.wood);
    t.rect(px + 3, py + 19, W - 6, 1, C.woodDark);
    // legs
    t.rect(px + 8, py + 21, 4, 9, C.woodDark);
    t.rect(px + W - 12, py + 21, 4, 9, C.woodDark);
    // scattered papers + mugs
    for (let i = 0; i < Math.floor(W / TILE); i++) {
      if (i % 2 === 0) {
        t.rect(px + i * TILE + 8, py + 13, 7, 4, C.paper);
        t.rect(px + i * TILE + 8, py + 13, 7, 1, C.paperShade);
      } else {
        t.rect(px + i * TILE + 12, py + 12, 4, 4, "#e8eef2");
        t.rect(px + i * TILE + 12, py + 12, 4, 1, C.coffee);
      }
    }
  }

  private drawConfChair(t: PixelTarget, px: number, py: number): void {
    // back/seat 1px wider than the sitter's torso so the chair reads behind them
    t.rect(px + 8, py + 4, 16, 11, C.plastic);
    t.rect(px + 8, py + 4, 16, 1, C.metalDark);
    t.rect(px + 7, py + 15, 18, 4, C.metal);
    t.rect(px + 7, py + 15, 18, 1, C.metalHi);
    t.rect(px + 14, py + 19, 3, 6, C.metalDark);
    t.rect(px + 9, py + 25, 14, 2, C.metalDark);
  }

  private drawFridge(t: PixelTarget, px: number, py: number): void {
    t.rect(px + 4, py + TILE - 1, 24, 1, C.shadow);
    t.rect(px + 5, py + 1, 22, 30, C.metal);
    t.rect(px + 5, py + 1, 22, 1, "#e8edf1");
    t.rect(px + 5, py + 13, 22, 1, C.metalDark);
    t.rect(px + 23, py + 5, 1, 4, C.metalDark);
    t.rect(px + 23, py + 16, 1, 4, C.metalDark);
    // magnets
    t.rect(px + 9, py + 5, 3, 3, C.red);
    t.rect(px + 14, py + 7, 3, 3, C.greenLight);
    t.rect(px + 10, py + 17, 3, 3, C.amber);
    t.rect(px + 15, py + 20, 3, 3, "#4f6d9e");
  }

  private drawCounter(t: PixelTarget, px: number, py: number, withMicro = false, now = 0): void {
    t.rect(px, py + TILE - 1, TILE, 1, C.shadow);
    t.rect(px, py + 8, TILE, 4, C.metal);
    t.rect(px, py + 8, TILE, 1, "#e8edf1");
    t.rect(px + 1, py + 12, TILE - 2, 19, C.woodDark);
    t.rect(px + 4, py + 19, TILE - 8, 1, C.wood);
    t.rect(px + 12, py + 15, 4, 1, C.metal);
    if (withMicro) {
      // microwave on the countertop
      t.rect(px + 6, py + 1, 17, 7, C.metalDark);
      t.rect(px + 8, py + 2, 11, 5, "#1a1d24");
      t.rect(px + 20, py + 4, 2, 1, Math.floor(now / 800) % 3 === 0 ? C.greenLight : C.metal);
      t.rect(px + 19, py + 2, 1, 5, C.metal);
    }
  }

  private drawPrinter(t: PixelTarget, px: number, py: number, now: number): void {
    t.rect(px + 4, py + TILE - 1, 24, 1, C.shadow);
    t.rect(px + 4, py + 10, 24, 18, C.plastic);
    t.rect(px + 4, py + 10, 24, 1, C.metalHi);
    t.rect(px + 5, py + 7, 22, 4, C.metalDark);
    t.rect(px + 9, py + 5, 11, 3, C.paper); // paper in the feed
    t.rect(px + 8, py + 21, 13, 3, C.metalDark);
    t.rect(px + 6, py + 13, 11, 4, C.metal);
    t.rect(px + 23, py + 13, 3, 3, Math.floor(now / 900) % 4 === 0 ? C.greenLight : C.metalDark);
  }

  private drawCopier(t: PixelTarget, px: number, py: number, now: number): void {
    t.rect(px + 3, py + TILE - 1, 26, 1, C.shadow);
    t.rect(px + 3, py + 8, 26, 22, C.plastic);
    t.rect(px + 3, py + 8, 26, 1, C.metalHi);
    t.rect(px + 4, py + 5, 24, 4, C.metalDark);
    t.rect(px + 5, py + 13, 8, 5, C.metal);
    t.rect(px + 7, py + 14, 3, 1, C.greenLight);
    // scanning light sweep
    const phase = Math.floor(now / 260) % 22;
    if (phase < 17) t.rect(px + 5 + phase, py + 19, 3, 8, "rgba(159,216,232,0.5)");
    t.rect(px + 8, py + 28, 12, 2, C.metalDark);
  }

  private drawReception(t: PixelTarget, px: number, py: number, W: number): void {
    t.rect(px + 3, py + TILE - 1, W - 6, 1, C.shadow);
    t.rect(px + 2, py + 12, W - 4, 19, "#b8bec4");
    t.rect(px + 2, py + 12, W - 4, 1, "#d3d7db");
    for (let i = 10; i < W - 8; i += 13) t.rect(px + i, py + 16, 1, 11, "#9aa1a8");
    t.rect(px, py + 8, W, 4, C.plastic);
    t.rect(px, py + 8, W, 1, "#ffffff");
    t.rect(px + 8, py + 9, 7, 3, C.paper);
    t.rect(px + W - 16, py + 9, 7, 3, C.paperShade);
  }

  private drawSofa(t: PixelTarget, px: number, py: number, W: number): void {
    t.rect(px + 3, py + TILE - 1, W - 6, 1, C.shadow);
    t.rect(px + 3, py + 5, W - 6, 9, "#8a6b52");
    t.rect(px + 3, py + 5, W - 6, 1, "#9a7b62");
    t.rect(px + 3, py + 14, W - 6, 8, "#77593f");
    const cushions = Math.max(2, Math.floor(W / TILE));
    for (let i = 1; i < cushions; i++)
      t.rect(px + Math.floor((W / cushions) * i), py + 14, 1, 8, "#5f4530");
    t.rect(px, py + 8, 5, 16, "#6b4f37");
    t.rect(px, py + 8, 5, 1, "#7d5d42");
    t.rect(px + W - 5, py + 8, 5, 16, "#6b4f37");
    t.rect(px + 8, py + 11, 7, 4, C.paperShade); // throw pillow
    t.rect(px + 4, py + 28, 3, 3, C.woodDark);
    t.rect(px + W - 7, py + 28, 3, 3, C.woodDark);
  }

  private drawCabinet(t: PixelTarget, px: number, py: number): void {
    t.rect(px + 4, py + TILE - 1, 24, 1, C.shadow);
    t.rect(px + 4, py + 2, 24, 29, C.woodDark);
    t.rect(px + 5, py + 3, 22, 1, C.wood);
    for (const dy of [9, 16, 23]) {
      t.rect(px + 5, py + dy, 22, 5, C.woodDark);
      t.rect(px + 5, py + dy, 22, 1, C.wood);
      t.rect(px + 13, py + dy + 2, 6, 1, C.metal);
    }
  }

  private drawShelf(t: PixelTarget, px: number, py: number): void {
    t.rect(px + 1, py + 12, 30, 4, C.wood);
    t.rect(px + 1, py + 12, 30, 1, C.woodLight);
    const books: Array<[number, string, number]> = [
      [3, C.red, 10],
      [6, "#4f6d9e", 9],
      [9, C.greenLight, 10],
      [12, "#7a5f9e", 8],
    ];
    for (const [bx, color, bh] of books) {
      t.rect(px + bx, py + 12 - bh, 2, bh, color);
    }
    // leaning book
    t.rect(px + 14, py + 9, 1, 4, C.red);
    t.rect(px + 15, py + 8, 1, 5, C.red);
    // the Dundie award
    t.rect(px + 16, py + 11, 5, 1, C.woodDark); // base
    t.rect(px + 18, py + 9, 1, 2, C.metal); // stem
    t.rect(px + 17, py + 6, 3, 3, C.amber); // cup
    // ream stack
    t.rect(px + 21, py + 7, 8, 5, C.paper);
    t.rect(px + 21, py + 7, 8, 1, C.paperShade);
    t.rect(px + 22, py + 9, 6, 1, "rgba(38,38,46,0.25)");
  }

  private drawBobble(t: PixelTarget, px: number, py: number): void {
    t.rect(px + 1, py + 15, 30, 4, C.wood);
    t.rect(px + 1, py + 15, 30, 1, C.woodLight);
    // spring
    t.rect(px + 15, py + 11, 2, 4, C.metal);
    // oversized head
    t.rect(px + 11, py + 4, 10, 7, C.skin[0]);
    t.rect(px + 12, py + 3, 8, 1, C.skin[0]);
    t.rect(px + 11, py + 1, 10, 2, "#3a2a1c");
    t.rect(px + 12, py + 7, 1, 1, C.outline);
    t.rect(px + 17, py + 7, 1, 1, C.outline);
    t.rect(px + 14, py + 8, 4, 1, "rgba(38,38,46,0.6)");
  }

  private drawRoundTable(t: PixelTarget, px: number, py: number): void {
    t.rect(px + 7, py + TILE - 1, 18, 1, C.shadow);
    // round-ish slab
    t.rect(px + 7, py + 8, 18, 13, C.woodLight);
    t.rect(px + 10, py + 6, 12, 16, C.woodLight);
    t.rect(px + 13, py + 5, 6, 1, C.woodLight);
    t.rect(px + 13, py + 21, 6, 1, C.woodDark);
    t.rect(px + 14, py + 22, 3, 7, C.woodDark);
    t.rect(px + 10, py + 29, 11, 1, C.woodDark);
    t.rect(px + 9, py + 12, 5, 3, C.paper);
    t.rect(px + 17, py + 11, 4, 4, "#e8eef2");
    t.rect(px + 17, py + 11, 4, 1, C.coffee);
  }

  private drawWhiteboard(t: PixelTarget, px: number, py: number): void {
    t.rect(px + 1, py + 1, 30, 22, C.metalDark);
    t.rect(px + 2, py + 2, 28, 20, "#ffffff");
    // axes
    t.rect(px + 4, py + 5, 1, 14, C.outline);
    t.rect(px + 4, py + 18, 20, 1, C.outline);
    // bars
    t.rect(px + 7, py + 12, 3, 6, "#4f6d9e");
    t.rect(px + 11, py + 9, 3, 9, C.red);
    t.rect(px + 15, py + 7, 3, 11, C.greenLight);
    t.rect(px + 19, py + 10, 3, 8, C.amber);
    // marker tray
    t.rect(px + 7, py + 20, 14, 1, C.metalDark);
    t.rect(px + 7, py + 19, 3, 1, C.red);
    t.rect(px + 12, py + 19, 3, 1, "#4f6d9e");
  }

  /* ---------------- entities ---------------- */

  private drawEntity(t: PixelTarget, e: Entity, now: number): void {
    const spec = e.spec;
    const seed = spec?.paletteSeed ?? 9;
    const look = e.kind === "boss" ? BOSS_LOOK : botLook(seed);

    let frame: "stand" | "walkA" | "walkB" | "sitA" | "sitB" | "carry" = "stand";
    if (e.activity === "walk" || e.activity === "carry") {
      frame = Math.floor(e.animT * 6) % 2 === 0 ? "walkA" : "walkB";
    } else if (e.activity === "type" || e.activity === "sit") {
      frame = Math.floor(e.animT * 3) % 2 === 0 ? "sitA" : "sitB";
    }
    if (e.carry && e.activity !== "type") frame = "carry";

    // pupils lean toward where the bot is headed; blink phase is per-bot
    const dirX = e.path.length > 1 ? Math.sign(e.path[0].x - e.x) : 0;
    drawBotShadow(t, e.x, Math.round(e.y));
    drawBot(t, e.x, Math.round(e.y), look, frame, {
      now,
      talking: !!e.bubble,
      pupilDx: dirX,
      dir: dirX,
      blinkSeed: seed % 7,
    });

    // cupped coffee on the way to/from the machine
    if ((e.spot === "coffee" || e.spot === "watercooler") && e.activity === "stand") {
      const bpx = Math.round(e.x) - CHAR_W / 2;
      const bpy = Math.round(e.y) - CHAR_H;
      t.rect(bpx + 24, bpy + 24, 4, 4, "#e8eef2");
      t.rect(bpx + 24, bpy + 24, 4, 1, C.coffee);
      t.rect(bpx + 28, bpy + 25, 1, 2, "#e8eef2");
    }

    const seated = e.activity === "type" || e.activity === "sit";
    const top = Math.round(e.y) - (seated ? SEATED_H + 2 : CHAR_H + 2);
    const px = Math.round(e.x) - CHAR_W / 2;

    if (this.selectedId && this.selectedId === e.id) {
      const b = Math.floor(now / 250) % 2 === 0 ? "#ffffff" : C.amber;
      const l = px - 4;
      const r = px + CHAR_W + 4;
      const topY = top - 4;
      const botY = Math.round(e.y) + 2;
      t.rect(l, topY, 6, 1, b);
      t.rect(l, topY, 1, 6, b);
      t.rect(r - 5, topY, 6, 1, b);
      t.rect(r, topY, 1, 6, b);
      t.rect(l, botY, 6, 1, b);
      t.rect(l, botY - 5, 1, 6, b);
      t.rect(r - 5, botY, 6, 1, b);
      t.rect(r, botY - 5, 1, 6, b);
    }

    if (this.hoverId && this.hoverId === e.id && this.selectedId !== e.id) {
      const l = px - 4;
      const r = px + CHAR_W + 4;
      const topY = top - 4;
      const botY = Math.round(e.y) + 2;
      t.rect(l, topY, 6, 1, "rgba(255,255,255,0.5)");
      t.rect(l, topY, 1, 6, "rgba(255,255,255,0.5)");
      t.rect(r - 5, topY, 6, 1, "rgba(255,255,255,0.5)");
      t.rect(r, topY, 1, 6, "rgba(255,255,255,0.5)");
      t.rect(l, botY, 6, 1, "rgba(255,255,255,0.5)");
      t.rect(l, botY - 5, 1, 6, "rgba(255,255,255,0.5)");
      t.rect(r - 5, botY, 6, 1, "rgba(255,255,255,0.5)");
      t.rect(r, botY - 5, 1, 6, "rgba(255,255,255,0.5)");
    }

    if (e.spawnFlash > now) {
      if (Math.floor(now / 200) % 2 === 0) {
        const l = px - 1;
        const r = px + CHAR_W + 1;
        const topY = top - 1;
        const botY = Math.round(e.y) + 1;
        t.rect(l, topY, r - l, 1, C.amber);
        t.rect(l, botY, r - l, 1, C.amber);
        t.rect(l, topY, 1, botY - topY, C.amber);
        t.rect(r, topY, 1, botY - topY, C.amber);
      }
    }

    // name tag (The Office style) below feet
    const name = e.kind === "boss" ? "THE BOSS" : spec!.name;
    const tagW = textWidth(name) + 16;
    const tagX = Math.round(e.x - tagW / 2);
    const tagY = Math.round(e.y) + 4;
    t.rect(tagX, tagY, tagW, 13, C.navy);
    t.rect(tagX, tagY, tagW, 1, "#3d5570");
    t.rect(tagX, tagY + 12, tagW, 1, "#101822");
    drawText(t, name, tagX + 8, tagY + 4, "#f5f0e2");
    const dotColor =
      spec?.status === "working"
        ? C.greenLight
        : spec?.status === "stuck"
          ? C.red
          : spec?.status === "coffee"
            ? "#b06f2f"
            : C.amber;
    t.rect(tagX + 3, tagY + 5, 3, 3, dotColor);
  }

  private drawBubble(t: PixelTarget, e: Entity): void {
    const lines = wrapText(e.bubble!.text, 26);
    const maxLen = Math.max(...lines.map((l) => l.length));
    const w = maxLen * 4 + 12;
    const h = lines.length * 6 + 9;
    const seated = e.activity === "type" || e.activity === "sit";
    let bx = Math.round(e.x - w / 2);
    let by = Math.round(e.y) - (seated ? 40 : 52) - h;
    bx = Math.max(2, Math.min(MAP_W * TILE - w - 2, bx));
    by = Math.max(2, by);
    t.rect(bx, by, w, h, C.outline);
    t.rect(bx + 1, by + 1, w - 2, h - 2, C.bubble);
    // tail pointing at the speaker
    const cx = Math.round(e.x);
    t.rect(cx - 2, by + h, 4, 1, C.outline);
    t.rect(cx - 1, by + h + 1, 2, 1, C.outline);
    lines.forEach((line, i) => {
      drawText(t, line, bx + 6, by + 5 + i * 6, C.bubbleInk);
    });
  }

  /** Hit-test a bot by world px (for click/hover). */
  pick(wx: number, wy: number): string | null {
    for (const e of this.entities.values()) {
      if (e.spec && e.spec.status === "away") continue;
      if (Math.abs(wx - e.x) <= 16 && wy >= e.y - 48 && wy <= e.y + 16) return e.id;
    }
    return null;
  }
}

/* end of scene */
