import zlib from "node:zlib";
import { OfficeScene } from "@/office/scene";
import { MAP_H, MAP_W, TILE } from "@/office/floorplan";
import type { PixelTarget } from "@/office/render-core";
import { deriveBots } from "@/lib/hermes/derive";
import { fetchMockSnapshot } from "@/lib/hermes/sources/mock";
import type { OfficeEvent } from "@/lib/hermes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const W = MAP_W * TILE;
const H = MAP_H * TILE;

/** RGBA framebuffer PixelTarget with alpha blending. */
class Raster implements PixelTarget {
  data = new Uint8Array(W * H * 4);

  rect(x: number, y: number, w: number, h: number, color: string): void {
    const [r, g, b, a] = parseColor(color);
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(W, Math.round(x + w));
    const y1 = Math.min(H, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = (yy * W + xx) * 4;
        const d = this.data;
        d[i] = Math.round(r * a + d[i] * (1 - a));
        d[i + 1] = Math.round(g * a + d[i + 1] * (1 - a));
        d[i + 2] = Math.round(b * a + d[i + 2] * (1 - a));
        d[i + 3] = 255;
      }
    }
  }
}

function parseColor(color: string): [number, number, number, number] {
  if (color.startsWith("rgba")) {
    const m = color.match(/rgba?\(([^)]+)\)/)!;
    const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
    return [parts[0], parts[1], parts[2], parts[3] ?? 1];
  }
  const hex = color.replace("#", "");
  const n = parseInt(hex.length === 3 ? hex.replace(/(.)/g, "$1$1") : hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
}

/* ---------------- PNG encoding ---------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(r: Raster): Buffer {
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    Buffer.from(r.data.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** GET /api/preview — a PNG postcard of the office (demo staff), for docs & tests.
 * Optional ?hour=0-24 renders a specific time of day (default noon). */
export async function GET(req: Request) {
  const snap = await fetchMockSnapshot();
  const bots = deriveBots(snap);
  const scene = new OfficeScene();
  const tRaw = new URL(req.url).searchParams.get("t");
  const tNum = tRaw === null ? NaN : Number(tRaw);
  const now = Number.isFinite(tNum) && tNum > 0 ? tNum : 1_800_000; // fixed clock → deterministic frame
  // (idle bots re-roll spots every 45 simulated seconds, so ?t= shifts who sits where)

  const hourRaw = new URL(req.url).searchParams.get("hour");
  const hour = hourRaw === null ? NaN : Number(hourRaw);
  scene.fixedDayPhase = Number.isFinite(hour) && hour >= 0 && hour <= 24 ? hour : 12;
  scene.syncBots(bots, now);
  // let everyone walk to their desks (~90 simulated seconds)
  for (let i = 0; i < 90 * 30; i++) scene.update(1 / 30, now);

  // a few bubbles so the postcard feels alive
  const events: OfficeEvent[] = snap.recentMessages.slice(-5).map((m) => ({
    id: m.id,
    type: m.role === "tool" ? "tool_call" : "bot_message",
    ts: now,
    sessionId: m.sessionId,
    text: m.content ?? "",
  }));
  scene.handleEvents(events, now);

  const raster = new Raster();
  scene.draw(raster, now);
  const png = encodePNG(raster);
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}
