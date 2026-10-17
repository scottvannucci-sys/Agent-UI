"use client";

import { useState } from "react";
import OfficeCanvas from "@/components/OfficeCanvas";
import Inspector from "@/components/Inspector";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import { useOfficeStream } from "@/hooks/useOfficeStream";

export default function Page() {
  const { snapshot, events, feed, connected, sourceLabel, bots } = useOfficeStream();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = bots.find((b) => b.id === selectedId) ?? null;

  const degradations = (snapshot?.degradations ?? []).slice(0, 2);

  return (
    <div className="app">
      <TopBar snapshot={snapshot} connected={connected} sourceLabel={sourceLabel} bots={bots} />
      <div className="main">
        <section className="stage">
          <div className="canvas-wrap">
            <OfficeCanvas
              bots={bots}
              events={events}
              selectedId={selectedId}
              onSelect={setSelectedId}
              gatewayRunning={snapshot?.gateway?.running ?? false}
              gatewayDegraded={snapshot?.gateway?.degraded === true}
            />
            <Inspector bot={selected} snapshot={snapshot} onClose={() => setSelectedId(null)} />
          </div>
          <div className="stage-footer">
            <span>🖱️ Click a bot to pull their file. The boss hangs out in the glass office.</span>
            {degradations.map((d) => (
              <span key={d} className="degradation">
                ⚠ {d}
              </span>
            ))}
          </div>
        </section>
        <Sidebar
          snapshot={snapshot}
          feed={feed}
          bots={bots}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
    </div>
  );
}
