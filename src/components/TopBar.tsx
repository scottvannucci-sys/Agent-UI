"use client";

import { useEffect, useState } from "react";
import { fmtCost, fmtTokens } from "@/lib/hermes/derive";
import type { HermesSnapshot } from "@/lib/hermes/types";
import type { BotSpec } from "@/lib/hermes/derive";

interface Props {
  snapshot: HermesSnapshot | null;
  connected: boolean;
  sourceLabel: string;
  bots: BotSpec[];
}

export default function TopBar({ snapshot, connected, sourceLabel, bots }: Props) {
  const [clock, setClock] = useState<string>("");

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);

  const sessions = snapshot?.sessions ?? [];
  const totalCost = sessions.reduce((a, s) => a + (s.costUsd ?? 0), 0);
  const totalTokens = sessions.reduce((a, s) => a + s.inputTokens + s.outputTokens, 0);
  const active = bots.filter((b) => b.status === "working").length;
  const gateway = snapshot?.gateway;

  return (
    <header className="topbar">
      <div className="logo">
        <span className="title font-pixel">DUNDER BOTS, INC.</span>
        <span className="subtitle font-pixel">Limitless paper. Limitless bots.</span>
      </div>

      <span className="pill">
        <span
          className={`dot ${snapshot?.source === "mock" ? "demo" : connected ? "on" : "off"}`}
        />
        {sourceLabel}
      </span>

      <span
        className="pill"
        title={
          gateway?.running
            ? gateway?.degraded
              ? `Gateway degraded: ${(gateway.platforms ?? [])
                  .filter((p) => !["connected", "ok", "running", "healthy", "active", "ready", "listening", "up"].includes(p.state.toLowerCase()))
                  .map((p) => `${p.name}: ${p.state}`)
                  .join(", ") || (gateway.rawState ?? "degraded")}`
              : "Hermes gateway running (the boss is in)"
            : "Hermes gateway offline (the boss is out)"
        }
      >
        <span className={`dot ${!gateway?.running ? "off" : gateway?.degraded ? "warn" : "on"}`} />
        GATEWAY {gateway?.running ? (gateway?.degraded ? "DEGRADED" : "ONLINE") : "OFFLINE"}
        {gateway?.version ? ` · v${gateway.version}` : ""}
      </span>

      <div className="stat font-pixel" style={{ fontSize: 11 }}>
        <span className="pill">
          BOTS <b>{active}</b>/{bots.length}
        </span>
        <span className="pill">
          TOKENS SOLD <b>{fmtTokens(totalTokens)}</b>
        </span>
        <span className="pill">
          PAPER SALES <b>{fmtCost(totalCost)}</b>
        </span>
        <span className="pill">
          <b>{clock}</b>
        </span>
      </div>
    </header>
  );
}
