import { botPalette, C } from "./palette";
import { CHAR_SPRITES, ITEM_SPRITES } from "./sprites";
import { drawText, drawSpriteGrid, textWidth, wrapText, type PixelTarget } from "./render-core";
import {
  BOSS_SEAT,
  DESKS,
  DESK_SCREEN,
  FURNITURE,
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

  private drawFloor(t: PixelTarget): void {
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const px = x * TILE;
        const py = y * TILE;
        if (isWall(x, y)) {
          t.rect(px, py, TILE, TILE, C.wall);
          t.rect(px, py, TILE, 2, C.wallTop);
          t.rect(px, py + TILE - 2, TILE, 2, C.wallShade);
          if (x % 4 === 0 || (x + y) % 7 === 0) {
            t.rect(px + 2, py + 5, 1, 6, C.wallShade);
            t.rect(px + TILE - 3, py + 5, 1, 6, C.wallShade);
          }
        } else if (isTileFloor(x, y)) {
          const alt = (x + y) % 2 === 0;
          t.rect(px, py, TILE, TILE, alt ? C.tile : C.tileAlt);
        } else {
          const alt = (x + y) % 2 === 0;
          t.rect(px, py, TILE, TILE, alt ? C.carpet : C.carpetAlt);
          if ((x * 13 + y * 7) % 11 === 0) t.rect(px + 7, py + 7, 2, 2, C.carpetDot);
        }
        // boss office glass wall (south wall of the office, skip door x5)
        if (y === 6 && x >= 1 && x <= 9 && x !== 5) {
          t.rect(px, py, TILE, TILE, C.wall);
          t.rect(px + 1, py + 2, TILE - 2, TILE - 6, C.window);
          t.rect(px + 1, py + 2, TILE - 2, 1, C.windowFrame);
          t.rect(px + TILE / 2, py + 2, 1, TILE - 6, C.windowFrame);
        }
        if (isDoor(x, y)) {
          t.rect(px, py, TILE, TILE, C.tile);
          t.rect(px, py, TILE, 3, C.door);
          t.rect(px, py + TILE - 3, TILE, 3, C.doorDark);
        }
      }
    }
  }

  private drawFurniture(t: PixelTarget, f: Furniture, now: number): void {
    const px = f.x * TILE;
    const py = f.y * TILE;
    const W = (f.w ?? 1) * TILE;
    const blink = Math.floor(now / 700) % 2 === 0;
    switch (f.kind) {
      case "desk": {
        t.rect(px + 2, py + 8, 2, 7, C.woodDark);
        t.rect(px + W - 4, py + 8, 2, 7, C.woodDark);
        t.rect(px + 1, py + 6, W - 2, 3, C.wood);
        t.rect(px + 1, py + 6, W - 2, 1, C.woodLight);
        // monitor
        t.rect(px + 3, py, 10, 7, C.metalDark);
        const on = this.activeDesks.has(`${f.x},${f.y}`);
        t.rect(px + DESK_SCREEN.dx, py + DESK_SCREEN.dy, DESK_SCREEN.w, DESK_SCREEN.h, on ? C.screenOn : C.screenOff);
        if (on) {
          t.rect(px + DESK_SCREEN.dx + 1, py + DESK_SCREEN.dy + 1 + (blink ? 1 : 2), DESK_SCREEN.w - 2, 1, "#e8f6fa");
          t.rect(px + DESK_SCREEN.dx - 1, py + DESK_SCREEN.dy - 1, DESK_SCREEN.w + 2, DESK_SCREEN.h + 2, "rgba(159,216,232,0.25)");
        }
        t.rect(px + 6, py + 10, 5, 1, C.metalDark); // keyboard
        t.rect(px + 12, py + 9, 3, 2, C.paper); // paper
        break;
      }
      case "chair":
        t.rect(px + 3, py + 2, 10, 8, C.plastic);
        t.rect(px + 3, py + 2, 10, 1, C.metalDark);
        t.rect(px + 2, py + 10, 12, 3, C.metal);
        t.rect(px + 7, py + 13, 2, 2, C.metalDark);
        break;
      case "bossDesk": {
        t.rect(px + 2, py + 8, W - 4, 6, C.woodDark);
        t.rect(px + 1, py + 4, W - 2, 4, C.wood);
        t.rect(px + 1, py + 4, W - 2, 1, C.woodLight);
        t.rect(px + 4, py + 5, 5, 2, C.paper);
        t.rect(px + 10, py + 5, 3, 2, C.paperShade);
        // "World's Best Boss" mug
        t.rect(px + 18, py + 4, 3, 3, C.paper);
        t.rect(px + 21, py + 5, 1, 1, C.paper);
        t.rect(px + 18, py + 4, 3, 1, C.coffee);
        // desk lamp
        t.rect(px + W - 6, py + 1, 1, 3, C.metalDark);
        t.rect(px + W - 7, py, 3, 2, this.gatewayRunning ? C.amber : C.metalDark);
        break;
      }
      case "bossChair":
        t.rect(px + 2, py, 12, 10, "#3a3f4a");
        t.rect(px + 2, py, 12, 1, C.outline);
        t.rect(px + 1, py + 10, 14, 3, C.metalDark);
        t.rect(px + 7, py + 13, 2, 2, C.metalDark);
        break;
      case "confTable": {
        t.rect(px, py + 4, W, 8, C.woodLight);
        t.rect(px, py + 4, W, 1, C.wood);
        t.rect(px, py + 11, W, 1, C.woodDark);
        t.rect(px + 3, py + 12, 2, 3, C.woodDark);
        t.rect(px + W - 5, py + 12, 2, 3, C.woodDark);
        // papers on the table
        for (let i = 0; i < (f.w ?? 1); i++) {
          if (i % 2 === 0) t.rect(px + i * TILE + 5, py + 7, 4, 2, C.paper);
        }
        break;
      }
      case "confChair":
        t.rect(px + 4, py + 3, 8, 6, C.plastic);
        t.rect(px + 3, py + 9, 10, 3, C.metal);
        t.rect(px + 7, py + 12, 2, 2, C.metalDark);
        break;
      case "watercooler":
        drawSpriteGrid(t, ITEM_SPRITES.watercooler, px, py);
        break;
      case "plant":
        drawSpriteGrid(t, ITEM_SPRITES.plant, px, py);
        break;
      case "box":
        drawSpriteGrid(t, ITEM_SPRITES.box, px, py);
        break;
      case "coffee":
        drawSpriteGrid(t, ITEM_SPRITES.coffee, px, py);
        break;
      case "fridge":
        t.rect(px + 3, py + 1, 10, 14, C.metal);
        t.rect(px + 3, py + 1, 10, 1, C.metalDark);
        t.rect(px + 3, py + 6, 10, 1, C.metalDark);
        t.rect(px + 11, py + 3, 1, 2, C.metalDark);
        t.rect(px + 11, py + 8, 1, 2, C.metalDark);
        break;
      case "counter":
        t.rect(px, py + 4, TILE, 3, C.metal);
        t.rect(px + 1, py + 7, TILE - 2, 8, C.woodDark);
        t.rect(px + 3, py + 9, TILE - 6, 1, C.wood);
        break;
      case "printer":
        t.rect(px + 2, py + 6, 12, 7, C.plastic);
        t.rect(px + 3, py + 4, 10, 2, C.metal);
        t.rect(px + 5, py + 5, 6, 1, C.paper);
        t.rect(px + 5, py + 12, 6, 2, C.metalDark);
        t.rect(px + 11, py + 7, 1, 1, blink ? C.greenLight : C.metalDark);
        break;
      case "copier":
        t.rect(px + 1, py + 3, 14, 10, C.plastic);
        t.rect(px + 2, py + 4, 12, 2, C.metalDark);
        t.rect(px + 3, py + 7, 8, 3, C.metal);
        t.rect(px + 12, py + 7, 2, 1, blink ? C.greenLight : C.metalDark);
        t.rect(px + 3, py + 12, 10, 1, C.metalDark);
        break;
      case "receptionDesk": {
        t.rect(px + 1, py + 3, W - 2, 4, C.plastic);
        t.rect(px + 1, py + 3, W - 2, 1, "#ffffff");
        t.rect(px + 2, py + 7, W - 4, 7, "#b8bec4");
        t.rect(px + 3, py + 9, 4, 3, C.paper);
        t.rect(px + W - 8, py + 9, 4, 3, C.paperShade);
        break;
      }
      case "sofa": {
        t.rect(px + 1, py + 2, W - 2, 6, "#8a6b52");
        t.rect(px + 1, py + 8, W - 2, 5, "#77593f");
        t.rect(px + 0, py + 3, 3, 11, "#6b4f37");
        t.rect(px + W - 3, py + 3, 3, 11, "#6b4f37");
        t.rect(px + 4, py + 9, 5, 1, C.paperShade);
        break;
      }
      case "cabinet":
        t.rect(px + 2, py + 2, 12, 13, C.woodDark);
        t.rect(px + 3, py + 4, 10, 1, C.wood);
        t.rect(px + 3, py + 8, 10, 1, C.wood);
        t.rect(px + 3, py + 12, 10, 1, C.wood);
        t.rect(px + 7, py + 5, 2, 1, C.metal);
        t.rect(px + 7, py + 9, 2, 1, C.metal);
        break;
      case "shelf":
        t.rect(px + 1, py + 6, 14, 2, C.wood);
        t.rect(px + 2, py + 3, 2, 3, C.red);
        t.rect(px + 4, py + 3, 2, 3, "#4f6d9e");
        t.rect(px + 6, py + 3, 2, 3, C.greenLight);
        t.rect(px + 9, py + 2, 4, 4, C.paper); // small stack of reams
        t.rect(px + 9, py + 2, 4, 1, C.paperShade);
        break;
      case "bobble":
        t.rect(px + 1, py + 8, 14, 2, C.wood);
        // bobblehead: spring + big head
        t.rect(px + 7, py + 6, 2, 2, C.metal);
        t.rect(px + 5, py + 2, 6, 4, C.skin[0]);
        t.rect(px + 5, py + 1, 6, 2, "#3a2a1c");
        t.rect(px + 6, py + 3, 1, 1, C.outline);
        t.rect(px + 9, py + 3, 1, 1, C.outline);
        break;
      case "roundTable":
        t.rect(px + 3, py + 5, 10, 7, C.woodLight);
        t.rect(px + 4, py + 4, 8, 1, C.woodLight);
        t.rect(px + 4, py + 12, 8, 1, C.woodDark);
        t.rect(px + 7, py + 13, 2, 2, C.woodDark);
        t.rect(px + 6, py + 7, 4, 1, C.paper);
        break;
      case "whiteboard":
        t.rect(px, py + 1, TILE, 12, C.metalDark);
        t.rect(px + 1, py + 2, TILE - 2, 10, "#ffffff");
        t.rect(px + 3, py + 4, 6, 1, "#4f6d9e");
        t.rect(px + 3, py + 6, 9, 1, C.red);
        t.rect(px + 3, py + 8, 5, 1, "#4f9e6b");
        t.rect(px + 7, py + 12, 2, 3, C.metalDark);
        break;
    }
  }

  private drawEntity(t: PixelTarget, e: Entity, now: number): void {
    const spec = e.spec;
    const seed = spec?.paletteSeed ?? 9;
    const overrides = e.kind === "boss"
      ? { H: "#8a8f96", S: "#3a3f4a", P: "#26262e", K: C.skin[1] }
      : botPalette(seed);

    let spriteName = "stand";
    if (e.activity === "walk" || e.activity === "carry") {
      spriteName = Math.floor(e.animT * 6) % 2 === 0 ? "walkA" : "walkB";
    } else if (e.activity === "type") {
      spriteName = Math.floor(e.animT * 3) % 2 === 0 ? "sitA" : "sitB";
    }
    if (e.carry && e.activity !== "type") spriteName = "carry";

    const seated = e.activity === "type";
    const px = Math.round(e.x - 8);
    const py = Math.round(seated ? e.y - 12 : e.y - 15);
    drawSpriteGrid(t, CHAR_SPRITES[spriteName], px, py, overrides);

    if (this.selectedId && this.selectedId === e.id) {
      const b = Math.floor(now / 250) % 2 === 0 ? "#ffffff" : C.amber;
      t.rect(px - 3, py - 3, 4, 1, b);
      t.rect(px - 3, py - 3, 1, 4, b);
      t.rect(px + 17, py - 3, 4, 1, b);
      t.rect(px + 20, py - 3, 1, 4, b);
      t.rect(px - 3, py + 17, 4, 1, b);
      t.rect(px - 3, py + 14, 1, 4, b);
      t.rect(px + 17, py + 17, 4, 1, b);
      t.rect(px + 20, py + 14, 1, 4, b);
    }

    if (e.spawnFlash > now) {
      const blink = Math.floor(now / 200) % 2 === 0;
      if (blink) {
        t.rect(px - 1, py - 1, 18, 1, C.amber);
        t.rect(px - 1, py + 16, 18, 1, C.amber);
        t.rect(px - 1, py, 1, 16, C.amber);
        t.rect(px + 17, py, 1, 16, C.amber);
      }
    }

    // name tag (The Office style) below feet
    const name = e.kind === "boss" ? "THE BOSS" : spec!.name;
    const tagW = textWidth(name) + 8;
    const tagX = Math.round(e.x - tagW / 2);
    const tagY = Math.round(e.y) + 2;
    t.rect(tagX, tagY, tagW, 9, C.navy);
    t.rect(tagX, tagY, tagW, 1, "#3d5570");
    t.rect(tagX, tagY + 8, tagW, 1, "#101822");
    drawText(t, name, tagX + 4, tagY + 2, "#f5f0e2");
    const dotColor =
      spec?.status === "working"
        ? C.greenLight
        : spec?.status === "stuck"
          ? C.red
          : spec?.status === "coffee"
            ? "#b06f2f"
            : C.amber;
    t.rect(tagX + 1, tagY + 3, 2, 2, dotColor);
  }

  private drawBubble(t: PixelTarget, e: Entity): void {
    const lines = wrapText(e.bubble!.text, 26);
    const maxLen = Math.max(...lines.map((l) => l.length));
    const w = maxLen * 4 + 8;
    const h = lines.length * 6 + 6;
    let bx = Math.round(e.x - w / 2);
    let by = Math.round(e.y) - (e.activity === "type" ? 34 : 38) - h + 24;
    bx = Math.max(2, Math.min(MAP_W * TILE - w - 2, bx));
    by = Math.max(2, by);
    t.rect(bx, by, w, h, C.outline);
    t.rect(bx + 1, by + 1, w - 2, h - 2, C.bubble);
    // tail
    t.rect(Math.round(e.x) - 1, by + h, 3, 2, C.outline);
    lines.forEach((line, i) => {
      drawText(t, line, bx + 4, by + 3 + i * 6, C.bubbleInk);
    });
  }

  /** Hit-test a bot by world px (for click/hover). */
  pick(wx: number, wy: number): string | null {
    for (const e of this.entities.values()) {
      if (e.spec && e.spec.status === "away") continue;
      if (Math.abs(wx - e.x) <= 10 && wy >= e.y - 28 && wy <= e.y + 12) return e.id;
    }
    return null;
  }
}

/* end of scene */
