import { ensureFirstTick, getStoreState, startStore, subscribeStore } from "@/lib/hermes/store";
import type { HermesSnapshot, OfficeEvent } from "@/lib/hermes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-Sent Events stream: `snapshot` (full HermesSnapshot) on connect and
 * whenever the underlying data meaningfully changes, plus incremental
 * `events` frames and keep-alive pings.
 */
export async function GET(req: Request) {
  startStore();
  await ensureFirstTick();

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const send = (event: string, data: unknown) =>
        write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      const st = getStoreState();
      if (st.snapshot) send("snapshot", st.snapshot);
      send("events", st.events.slice(-80));

      let sentCount = st.events.length;
      let lastSnapJson = st.snapshot ? JSON.stringify({ ...st.snapshot, fetchedAt: 0 }) : "";
      unsubscribe = subscribeStore((s) => {
        if (s.events.length > sentCount) {
          const fresh = s.events.slice(sentCount);
          sentCount = s.events.length;
          send("events", fresh);
        }
        if (s.snapshot) {
          // ignore fetchedAt so identical data doesn't re-send every poll
          const j = JSON.stringify({ ...s.snapshot, fetchedAt: 0 });
          if (j !== lastSnapJson) {
            lastSnapJson = j;
            send("snapshot", s.snapshot);
          }
        }
      });

      heartbeat = setInterval(() => write(`: ping ${Date.now()}\n\n`), 15000);

      req.signal.addEventListener("abort", () => {
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export type { HermesSnapshot, OfficeEvent };
