import { NextResponse } from "next/server";
import { ensureFirstTick, getStoreState, startStore } from "@/lib/hermes/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Plain JSON snapshot of the current store state (handy for debugging). */
export async function GET() {
  startStore();
  await ensureFirstTick();
  const st = getStoreState();
  return NextResponse.json(st, {
    headers: { "Cache-Control": "no-store" },
  });
}
