import { C } from "./palette";
import { ITEM_SPRITES } from "./sprites";
import { BOSS_LOOK, CHAR_H, botLook, drawBot, drawBotShadow } from "./characters";
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
  type Furniture,
} from "./floorplan";
import type { BotSpec } from "../lib/hermes/derive";
import type { OfficeEvent } from "../lib/hermes/types";

const SPEED = 46; // px per second
const BUBBLE_MS = 5200;
const AMBIENT_MS = 9000;

type Activity = "stand" | "walk" | "type" | "carry";

interface Waypoint {
  x: number;
  y: number;
  onArrive?: "pickupPaper" | "dropPaper";
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
  spot: string; // "desk" | "deskStand" | "watercooler" | "wander" | "coffee" | "door" | "conference"
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
  private entities = new Map<string, Entity>();
  private deskOwner = new Map<number, string>(); // deskIdx -> botId
  private activeDesks = new Set<string>();
  private boss: Entity;
  private gatewayRunning = true;
  private bossVisible = true;

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

  /** Where should this status put the bot? */
  private spotFor(spec: BotSpec): string {
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
        const roll = seed % 10;
        if (roll < 5) return "deskStand";
        if (roll < 8) return "watercooler";
        return "wander";
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
    const tiles = findPath(sx, sy, tx, ty);
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
        e.spot = this.spotFor(spec);
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
    }
  }

  /** Align the boss with the actual gateway state (no event required). */
  setGateway(running: boolean): void {
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
          }
          if (!e.path.length && e.activity === "walk") {
            e.activity = e.carry ? "carry" : e.spot === "desk" ? "type" : "stand";
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
          const t = e.spec.statusText;
          if (t) e.bubble = { text: t, until: now + BUBBLE_MS };
        }
      }

      if (e.bubble && e.bubble.until < now) e.bubble = null;
      e.animT += dt;
    }
  }

  /* ---------------- drawing ---------------- */

  draw(t: PixelTarget, now: number): void {
    this.drawFloor(t);
    // furniture back-to-front
    const sorted = [...FURNITURE].sort((a, b) => a.y - b.y || a.x - b.x);
    for (const f of sorted) this.drawFurniture(t, f, now);

    // entities back-to-front
    const ents = [...this.entities.values()].filter(
      (e) => !(e.spec && e.spec.status === "away"),
    );
    if (this.gatewayRunning && this.bossVisible) ents.push(this.boss);
    ents.sort((a, b) => a.y - b.y);
    for (const e of ents) this.drawEntity(t, e, now);

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
    t.rect(px, py, TILE, 3, C.wallTop);
    const floorBelow = y + 1 < MAP_H && !isWall(x, y + 1);
    if (floorBelow) {
      // baseboard at the bottom of south-facing walls
      t.rect(px, py + TILE - 4, TILE, 3, C.wallShade);
      t.rect(px, py + TILE - 1, TILE, 1, C.outline);
    } else {
      t.rect(px, py + TILE - 2, TILE, 2, C.wallShade);
    }
    if (x % 4 === 0 || (x + y) % 7 === 0) {
      t.rect(px + 3, py + 6, 2, 10, C.wallShade);
      t.rect(px + TILE - 5, py + 6, 2, 10, C.wallShade);
    }
  }

  private drawWindow(t: PixelTarget, px: number, py: number): void {
    const wx = px + 3;
    const wy = py + 5;
    const ww = TILE - 6;
    const wh = TILE - 11;
    // sky with two-tone band
    t.rect(wx, wy, ww, wh, C.sky);
    t.rect(wx, wy, ww, Math.max(2, Math.floor(wh / 3)), C.skyDeep);
    // frame + cross
    t.rect(wx - 1, wy - 1, ww + 2, 1, C.windowFrame);
    t.rect(wx - 1, wy + wh, ww + 2, 1, C.windowFrame);
    t.rect(wx - 1, wy, 1, wh, C.windowFrame);
    t.rect(wx + ww, wy, 1, wh, C.windowFrame);
    t.rect(wx + Math.floor(ww / 2), wy, 1, wh, C.windowFrame);
    t.rect(wx, wy + Math.floor(wh / 2), ww, 1, C.windowFrame);
    // reflection
    t.rect(wx + 2, wy + 1, 2, 1, "rgba(255,255,255,0.4)");
    t.rect(wx + 4, wy + 2, 2, 1, "rgba(255,255,255,0.25)");
    // sill
    t.rect(px + 2, wy + wh + 1, TILE - 4, 2, C.wallShade);
  }

  private drawGlassWall(t: PixelTarget, px: number, py: number): void {
    const gx = px + 1;
    const gy = py + 2;
    const gw = TILE - 2;
    const gh = TILE - 6;
    t.rect(gx - 1, gy - 1, gw + 2, 1, C.windowFrame);
    t.rect(gx - 1, gy + gh, gw + 2, 1, C.windowFrame);
    t.rect(gx - 1, gy, 1, gh, C.windowFrame);
    t.rect(gx + gw, gy, 1, gh, C.windowFrame);
    t.rect(gx, gy, gw, gh, C.window);
    t.rect(gx, gy, gw, 3, C.skyDeep);
    // reflection diagonal
    t.rect(gx + 3, gy + 2, 2, 1, "rgba(255,255,255,0.35)");
    t.rect(gx + 5, gy + 3, 2, 1, "rgba(255,255,255,0.2)");
    t.rect(gx + gw - 6, gy + gh - 4, 2, 1, "rgba(255,255,255,0.25)");
    t.rect(gx + Math.floor(gw / 2), gy, 1, gh, C.windowFrame);
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
        this.drawDesk(t, px, py, W, on, now);
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
        t.rect(px + 7, py + TILE - 1, 10, 1, C.shadow);
        drawSpriteGrid(t, ITEM_SPRITES.watercooler, px, py);
        // rising bubble in the bottle
        {
          const phase = Math.floor(now / 900) % 6;
          if (phase < 4) t.rect(px + 11 + (phase % 2), py + 8 - phase, 1, 1, "rgba(255,255,255,0.7)");
        }
        break;
      case "plant":
        t.rect(px + 5, py + TILE - 1, 14, 1, C.shadow);
        drawSpriteGrid(t, ITEM_SPRITES.plant, px, py);
        break;
      case "box":
        t.rect(px + 3, py + TILE - 1, 18, 1, C.shadow);
        drawSpriteGrid(t, ITEM_SPRITES.box, px, py);
        break;
      case "coffee":
        t.rect(px + 3, py + TILE - 1, 18, 1, C.shadow);
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
        this.drawCounter(t, px, py);
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

  private drawDesk(t: PixelTarget, px: number, py: number, W: number, on: boolean, now: number): void {
    // contact shadow
    t.rect(px + 3, py + TILE - 1, W - 6, 1, C.shadow);
    // legs
    t.rect(px + 3, py + 16, 2, 7, C.woodDark);
    t.rect(px + W - 5, py + 16, 2, 7, C.woodDark);
    // front panel + drawer
    t.rect(px + 3, py + 13, W - 6, 6, C.wood);
    t.rect(px + 3, py + 16, W - 6, 1, C.woodDark);
    t.rect(px + 10, py + 17, 4, 1, C.metal);
    // desktop
    t.rect(px + 2, py + 10, W - 4, 3, C.wood);
    t.rect(px + 2, py + 10, W - 4, 1, C.woodLight);
    // monitor
    t.rect(px + 5, py + 1, 14, 10, C.metalDark);
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
        t.rect(sx + 1, ly, sw - 2 - (i % 2) * 3, 1, "#cfeef7");
      }
      if (Math.floor(now / 500) % 2 === 0) t.rect(sx + sw - 3, sy + sh - 2, 2, 1, "#ffffff");
      // glow
      t.rect(sx - 1, sy - 1, sw + 2, sh + 2, "rgba(159,216,232,0.22)");
    }
    // keyboard, mouse, mug, paper
    t.rect(px + 6, py + 11, 7, 1, C.metalDark);
    t.rect(px + 15, py + 11, 2, 2, C.metalDark);
    t.rect(px + 2, py + 11, 2, 2, "#e8eef2");
    t.rect(px + 17, py + 11, 4, 2, C.paper);
    t.rect(px + 17, py + 11, 4, 1, C.paperShade);
  }

  private drawChair(t: PixelTarget, px: number, py: number): void {
    t.rect(px + 7, py + 2, 10, 10, C.plastic);
    t.rect(px + 7, py + 2, 10, 1, C.metalDark);
    t.rect(px + 6, py + 12, 12, 3, C.metal);
    t.rect(px + 11, py + 15, 2, 4, C.metalDark);
    t.rect(px + 6, py + 19, 12, 2, C.metalDark);
    t.rect(px + 6, py + 21, 2, 2, C.outline);
    t.rect(px + 16, py + 21, 2, 2, C.outline);
  }

  private drawBossDesk(t: PixelTarget, px: number, py: number, W: number, now: number): void {
    t.rect(px + 3, py + TILE - 1, W - 6, 1, C.shadow);
    // front panel + drawers
    t.rect(px + 2, py + 14, W - 4, 8, C.woodDark);
    t.rect(px + 2, py + 14, W - 4, 1, C.wood);
    t.rect(px + 5, py + 17, 14, 3, C.wood);
    t.rect(px + 11, py + 18, 2, 1, C.metal);
    t.rect(px + W - 19, py + 17, 14, 3, C.wood);
    t.rect(px + W - 13, py + 18, 2, 1, C.metal);
    // desktop
    t.rect(px + 1, py + 10, W - 2, 4, C.wood);
    t.rect(px + 1, py + 10, W - 2, 1, C.woodLight);
    // papers
    t.rect(px + 6, py + 11, 6, 3, C.paper);
    t.rect(px + 6, py + 11, 6, 1, C.paperShade);
    t.rect(px + 14, py + 11, 5, 3, C.paperShade);
    // "World's Best Boss" mug
    t.rect(px + 20, py + 10, 4, 4, "#e8eef2");
    t.rect(px + 24, py + 11, 1, 2, "#e8eef2");
    t.rect(px + 20, py + 10, 4, 1, C.coffee);
    // nameplate
    t.rect(px + 28, py + 11, 8, 2, C.navy);
    t.rect(px + 29, py + 11, 6, 1, C.amber);
    // phone
    t.rect(px + W - 18, py + 11, 5, 2, C.metalDark);
    t.rect(px + W - 17, py + 11, 3, 1, C.metal);
    // lamp: pole + head + warm glow when the gateway is healthy
    t.rect(px + W - 7, py + 4, 1, 6, C.metalDark);
    t.rect(px + W - 9, py + 2, 4, 3, this.gatewayRunning ? C.amber : C.metalDark);
    if (this.gatewayRunning) {
      t.rect(px + W - 11, py + 5, 8, 6, "rgba(216,195,74,0.14)");
      t.rect(px + W - 12, py + 8, 10, 3, "rgba(216,195,74,0.09)");
    }
  }

  private drawBossChair(t: PixelTarget, px: number, py: number): void {
    t.rect(px + 6, py + 2, 12, 12, "#3a3f4a");
    t.rect(px + 6, py + 2, 12, 1, C.outline);
    t.rect(px + 4, py + 8, 3, 5, "#2e323c");
    t.rect(px + 17, py + 8, 3, 5, "#2e323c");
    t.rect(px + 6, py + 14, 12, 3, "#3a3f4a");
    t.rect(px + 11, py + 17, 2, 4, C.metalDark);
    t.rect(px + 6, py + 21, 12, 2, C.metalDark);
  }

  private drawConfTable(t: PixelTarget, px: number, py: number, W: number): void {
    t.rect(px + 4, py + TILE - 1, W - 8, 1, C.shadow);
    // rounded slab
    t.rect(px + 2, py + 7, W - 4, 9, C.woodLight);
    t.rect(px, py + 9, W, 5, C.woodLight);
    t.rect(px + 2, py + 7, W - 4, 1, C.wood);
    t.rect(px + 2, py + 15, W - 4, 1, C.woodDark);
    // legs
    t.rect(px + 6, py + 16, 3, 6, C.woodDark);
    t.rect(px + W - 9, py + 16, 3, 6, C.woodDark);
    // scattered papers + mugs
    for (let i = 0; i < Math.floor(W / TILE); i++) {
      if (i % 2 === 0) {
        t.rect(px + i * TILE + 6, py + 10, 5, 3, C.paper);
        t.rect(px + i * TILE + 6, py + 10, 5, 1, C.paperShade);
      } else {
        t.rect(px + i * TILE + 9, py + 9, 3, 3, "#e8eef2");
        t.rect(px + i * TILE + 9, py + 9, 3, 1, C.coffee);
      }
    }
  }

  private drawConfChair(t: PixelTarget, px: number, py: number): void {
    t.rect(px + 7, py + 3, 10, 8, C.plastic);
    t.rect(px + 7, py + 3, 10, 1, C.metalDark);
    t.rect(px + 6, py + 11, 12, 3, C.metal);
    t.rect(px + 11, py + 14, 2, 4, C.metalDark);
    t.rect(px + 7, py + 18, 10, 2, C.metalDark);
  }

  private drawFridge(t: PixelTarget, px: number, py: number): void {
    t.rect(px + 3, py + TILE - 1, 18, 1, C.shadow);
    t.rect(px + 4, py + 1, 16, 22, C.metal);
    t.rect(px + 4, py + 1, 16, 1, "#c9ced2");
    t.rect(px + 4, py + 9, 16, 1, C.metalDark);
    t.rect(px + 17, py + 4, 1, 3, C.metalDark);
    t.rect(px + 17, py + 12, 1, 3, C.metalDark);
    // magnets
    t.rect(px + 7, py + 4, 2, 2, C.red);
    t.rect(px + 11, py + 6, 2, 2, C.greenLight);
    t.rect(px + 8, py + 13, 2, 2, C.amber);
    t.rect(px + 12, py + 16, 2, 2, "#4f6d9e");
  }

  private drawCounter(t: PixelTarget, px: number, py: number): void {
    t.rect(px, py + TILE - 1, TILE, 1, C.shadow);
    t.rect(px, py + 6, TILE, 3, C.metal);
    t.rect(px, py + 6, TILE, 1, "#c9ced2");
    t.rect(px + 1, py + 9, TILE - 2, 13, C.woodDark);
    t.rect(px + 3, py + 14, TILE - 6, 1, C.wood);
    t.rect(px + 8, py + 11, 3, 2, C.metal);
  }

  private drawPrinter(t: PixelTarget, px: number, py: number, now: number): void {
    t.rect(px + 3, py + TILE - 1, 18, 1, C.shadow);
    t.rect(px + 3, py + 8, 18, 13, C.plastic);
    t.rect(px + 4, py + 6, 16, 3, C.metalDark);
    t.rect(px + 7, py + 5, 8, 2, C.paper); // paper in the feed
    t.rect(px + 6, py + 16, 10, 2, C.metalDark);
    t.rect(px + 5, py + 10, 8, 3, C.metal);
    t.rect(px + 17, py + 10, 2, 2, Math.floor(now / 900) % 4 === 0 ? C.greenLight : C.metalDark);
  }

  private drawCopier(t: PixelTarget, px: number, py: number, now: number): void {
    t.rect(px + 2, py + TILE - 1, 20, 1, C.shadow);
    t.rect(px + 2, py + 6, 20, 17, C.plastic);
    t.rect(px + 3, py + 4, 18, 3, C.metalDark);
    t.rect(px + 4, py + 10, 6, 3, C.metal);
    t.rect(px + 5, py + 11, 2, 1, C.greenLight);
    // scanning light sweep
    const phase = Math.floor(now / 260) % 16;
    if (phase < 12) t.rect(px + 4 + phase, py + 14, 2, 6, "rgba(159,216,232,0.5)");
    t.rect(px + 6, py + 20, 9, 2, C.metalDark);
  }

  private drawReception(t: PixelTarget, px: number, py: number, W: number): void {
    t.rect(px + 2, py + TILE - 1, W - 4, 1, C.shadow);
    t.rect(px + 1, py + 9, W - 2, 14, "#b8bec4");
    t.rect(px + 1, py + 9, W - 2, 1, "#d3d7db");
    for (let i = 8; i < W - 6; i += 10) t.rect(px + i, py + 12, 1, 8, "#9aa1a8");
    t.rect(px, py + 6, W, 3, C.plastic);
    t.rect(px, py + 6, W, 1, "#ffffff");
    t.rect(px + 6, py + 7, 5, 2, C.paper);
    t.rect(px + W - 12, py + 7, 5, 2, C.paperShade);
  }

  private drawSofa(t: PixelTarget, px: number, py: number, W: number): void {
    t.rect(px + 2, py + TILE - 1, W - 4, 1, C.shadow);
    t.rect(px + 2, py + 4, W - 4, 7, "#8a6b52");
    t.rect(px + 2, py + 4, W - 4, 1, "#9a7b62");
    t.rect(px + 2, py + 11, W - 4, 6, "#77593f");
    const cushions = Math.max(2, Math.floor(W / TILE));
    for (let i = 1; i < cushions; i++) t.rect(px + Math.floor((W / cushions) * i), py + 11, 1, 6, "#5f4530");
    t.rect(px, py + 6, 4, 12, "#6b4f37");
    t.rect(px + W - 4, py + 6, 4, 12, "#6b4f37");
    t.rect(px + 6, py + 8, 5, 3, C.paperShade); // throw pillow
    t.rect(px + 3, py + 21, 2, 2, C.woodDark);
    t.rect(px + W - 5, py + 21, 2, 2, C.woodDark);
  }

  private drawCabinet(t: PixelTarget, px: number, py: number): void {
    t.rect(px + 3, py + TILE - 1, 18, 1, C.shadow);
    t.rect(px + 3, py + 2, 18, 21, C.woodDark);
    t.rect(px + 4, py + 3, 16, 1, C.wood);
    for (const dy of [7, 13, 19]) {
      t.rect(px + 4, py + dy, 16, 4, C.woodDark);
      t.rect(px + 4, py + dy, 16, 1, C.wood);
      t.rect(px + 10, py + dy + 1, 4, 1, C.metal);
    }
  }

  private drawShelf(t: PixelTarget, px: number, py: number): void {
    t.rect(px + 1, py + 9, 22, 3, C.wood);
    t.rect(px + 1, py + 9, 22, 1, C.woodLight);
    const books: Array<[number, string, number]> = [
      [2, C.red, 6],
      [4, "#4f6d9e", 5],
      [6, C.greenLight, 6],
      [8, "#7a5f9e", 4],
    ];
    for (const [bx, color, bh] of books) {
      t.rect(px + bx, py + 9 - bh, 2, bh, color);
    }
    // leaning book
    t.rect(px + 9, py + 6, 1, 3, C.red);
    t.rect(px + 10, py + 5, 1, 4, C.red);
    // ream stack
    t.rect(px + 13, py + 5, 6, 4, C.paper);
    t.rect(px + 13, py + 5, 6, 1, C.paperShade);
    t.rect(px + 14, py + 7, 4, 1, "rgba(38,38,46,0.25)");
  }

  private drawBobble(t: PixelTarget, px: number, py: number): void {
    t.rect(px + 1, py + 11, 22, 3, C.wood);
    t.rect(px + 1, py + 11, 22, 1, C.woodLight);
    // spring
    t.rect(px + 11, py + 8, 2, 3, C.metal);
    // oversized head
    t.rect(px + 8, py + 3, 8, 5, C.skin[0]);
    t.rect(px + 9, py + 2, 6, 1, C.skin[0]);
    t.rect(px + 8, py + 1, 8, 2, "#3a2a1c");
    t.rect(px + 9, py + 5, 1, 1, C.outline);
    t.rect(px + 13, py + 5, 1, 1, C.outline);
    t.rect(px + 10, py + 6, 4, 1, "rgba(38,38,46,0.6)");
  }

  private drawRoundTable(t: PixelTarget, px: number, py: number): void {
    t.rect(px + 5, py + TILE - 1, 14, 1, C.shadow);
    // round-ish slab
    t.rect(px + 5, py + 6, 14, 10, C.woodLight);
    t.rect(px + 7, py + 5, 10, 12, C.woodLight);
    t.rect(px + 9, py + 4, 6, 1, C.woodLight);
    t.rect(px + 9, py + 16, 6, 1, C.woodDark);
    t.rect(px + 11, py + 17, 2, 5, C.woodDark);
    t.rect(px + 8, py + 21, 8, 1, C.woodDark);
    t.rect(px + 7, py + 9, 4, 2, C.paper);
    t.rect(px + 13, py + 8, 3, 3, "#e8eef2");
  }

  private drawWhiteboard(t: PixelTarget, px: number, py: number): void {
    t.rect(px, py + 1, TILE, 16, C.metalDark);
    t.rect(px + 1, py + 2, TILE - 2, 14, "#ffffff");
    // axes
    t.rect(px + 3, py + 4, 1, 10, C.outline);
    t.rect(px + 3, py + 13, 15, 1, C.outline);
    // bars
    t.rect(px + 5, py + 9, 2, 4, "#4f6d9e");
    t.rect(px + 8, py + 7, 2, 6, C.red);
    t.rect(px + 11, py + 5, 2, 8, C.greenLight);
    t.rect(px + 14, py + 8, 2, 5, C.amber);
    // marker tray
    t.rect(px + 5, py + 15, 9, 1, C.metalDark);
    t.rect(px + 5, py + 14, 2, 1, C.red);
    t.rect(px + 9, py + 14, 2, 1, "#4f6d9e");
  }

  /* ---------------- entities ---------------- */

  private drawEntity(t: PixelTarget, e: Entity, now: number): void {
    const spec = e.spec;
    const seed = spec?.paletteSeed ?? 9;
    const look = e.kind === "boss" ? BOSS_LOOK : botLook(seed);

    let frame: "stand" | "walkA" | "walkB" | "sitA" | "sitB" | "carry" = "stand";
    if (e.activity === "walk" || e.activity === "carry") {
      frame = Math.floor(e.animT * 6) % 2 === 0 ? "walkA" : "walkB";
    } else if (e.activity === "type") {
      frame = Math.floor(e.animT * 3) % 2 === 0 ? "sitA" : "sitB";
    }
    if (e.carry && e.activity !== "type") frame = "carry";

    drawBotShadow(t, e.x, Math.round(e.y));
    drawBot(t, e.x, Math.round(e.y), look, frame);

    const seated = e.activity === "type";
    const top = Math.round(e.y) - (seated ? 27 : CHAR_H + 1);
    const px = Math.round(e.x) - 12;

    if (this.selectedId && this.selectedId === e.id) {
      const b = Math.floor(now / 250) % 2 === 0 ? "#ffffff" : C.amber;
      const l = px - 3;
      const r = px + 27;
      const topY = top - 3;
      const botY = Math.round(e.y) + 2;
      t.rect(l, topY, 5, 1, b);
      t.rect(l, topY, 1, 5, b);
      t.rect(r - 4, topY, 5, 1, b);
      t.rect(r, topY, 1, 5, b);
      t.rect(l, botY, 5, 1, b);
      t.rect(l, botY - 4, 1, 5, b);
      t.rect(r - 4, botY, 5, 1, b);
      t.rect(r, botY - 4, 1, 5, b);
    }

    if (e.spawnFlash > now) {
      if (Math.floor(now / 200) % 2 === 0) {
        const l = px - 1;
        const r = px + 25;
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
    const tagW = textWidth(name) + 12;
    const tagX = Math.round(e.x - tagW / 2);
    const tagY = Math.round(e.y) + 3;
    t.rect(tagX, tagY, tagW, 11, C.navy);
    t.rect(tagX, tagY, tagW, 1, "#3d5570");
    t.rect(tagX, tagY + 10, tagW, 1, "#101822");
    drawText(t, name, tagX + 6, tagY + 3, "#f5f0e2");
    const dotColor =
      spec?.status === "working"
        ? C.greenLight
        : spec?.status === "stuck"
          ? C.red
          : spec?.status === "coffee"
            ? "#b06f2f"
            : C.amber;
    t.rect(tagX + 2, tagY + 4, 3, 3, dotColor);
  }

  private drawBubble(t: PixelTarget, e: Entity): void {
    const lines = wrapText(e.bubble!.text, 26);
    const maxLen = Math.max(...lines.map((l) => l.length));
    const w = maxLen * 4 + 10;
    const h = lines.length * 6 + 7;
    const seated = e.activity === "type";
    let bx = Math.round(e.x - w / 2);
    let by = Math.round(e.y) - (seated ? 28 : 36) - h;
    bx = Math.max(2, Math.min(MAP_W * TILE - w - 2, bx));
    by = Math.max(2, by);
    t.rect(bx, by, w, h, C.outline);
    t.rect(bx + 1, by + 1, w - 2, h - 2, C.bubble);
    // tail pointing at the speaker
    const cx = Math.round(e.x);
    t.rect(cx - 2, by + h, 4, 1, C.outline);
    t.rect(cx - 1, by + h + 1, 2, 1, C.outline);
    lines.forEach((line, i) => {
      drawText(t, line, bx + 5, by + 4 + i * 6, C.bubbleInk);
    });
  }

  /** Hit-test a bot by world px (for click/hover). */
  pick(wx: number, wy: number): string | null {
    for (const e of this.entities.values()) {
      if (e.spec && e.spec.status === "away") continue;
      if (Math.abs(wx - e.x) <= 12 && wy >= e.y - 34 && wy <= e.y + 12) return e.id;
    }
    return null;
  }
}

/* end of scene */
