"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { deriveBots, type BotSpec } from "@/lib/hermes/derive";
import type { FeedItem, HermesSnapshot, OfficeClientState, OfficeEvent } from "@/lib/hermes/types";

const MAX_EVENTS = 300;
const MAX_FEED = 120;

function eventToFeedItem(ev: OfficeEvent, bots: BotSpec[]): FeedItem {
  const bot = bots.find((b) => b.id === ev.sessionId);
  return {
    id: ev.id,
    ts: ev.ts,
    botId: ev.sessionId ?? "office",
    botName: bot?.name ?? (ev.sessionId ? ev.sessionId.slice(0, 12) : "The Office"),
    kind: ev.type,
    text: ev.text,
  };
}

/**
 * Subscribes to /api/stream (SSE) and maintains snapshot + rolling events,
 * deriving bots with the same pure logic the server would use.
 */
export function useOfficeStream(): OfficeClientState & { bots: BotSpec[] } {
  const [snapshot, setSnapshot] = useState<HermesSnapshot | null>(null);
  const [events, setEvents] = useState<OfficeEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/stream");
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("snapshot", (e) => {
      try {
        setSnapshot(JSON.parse((e as MessageEvent).data) as HermesSnapshot);
        setConnected(true);
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("events", (e) => {
      try {
        const fresh = JSON.parse((e as MessageEvent).data) as OfficeEvent[];
        setEvents((prev) => {
          const merged = [...prev, ...fresh].slice(-MAX_EVENTS);
          // de-dupe by id (snapshots can replay events after reconnect)
          const seen = new Set<number>();
          return merged.filter((ev) => (seen.has(ev.id) ? false : seen.add(ev.id)));
        });
      } catch {
        /* ignore */
      }
    });
    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  const bots = useMemo(() => (snapshot ? deriveBots(snapshot) : []), [snapshot]);

  const feed = useMemo(() => {
    const items = events
      .slice()
      .reverse()
      .map((ev) => eventToFeedItem(ev, bots))
      .filter(Boolean);
    return items.slice(0, MAX_FEED);
  }, [events, bots]);

  const sourceLabel = snapshot
    ? snapshot.source === "mock"
      ? "DEMO OFFICE"
      : snapshot.source === "http"
        ? "LIVE · hermes serve"
        : "LIVE · hermes desktop"
    : "CONNECTING…";

  return { snapshot, events, feed, connected, sourceLabel, bots };
}
