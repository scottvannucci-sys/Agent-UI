"use client";

import { useEffect, useRef, useState } from "react";
import { OfficeScene } from "@/office/scene";
import { MAP_H, MAP_W, TILE } from "@/office/floorplan";
import type { BotSpec } from "@/lib/hermes/derive";
import type { OfficeEvent } from "@/lib/hermes/types";

interface Props {
  bots: BotSpec[];
  events: OfficeEvent[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  gatewayRunning: boolean;
  gatewayDegraded: boolean;
}

const WORLD_W = MAP_W * TILE;
const WORLD_H = MAP_H * TILE;

export default function OfficeCanvas({
  bots,
  events,
  selectedId,
  onSelect,
  gatewayRunning,
  gatewayDegraded,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const seenEvents = useRef<Set<number>>(new Set());
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [crt, setCrt] = useState(false);

  useEffect(() => {
    if (sceneRef.current) sceneRef.current.scanlines = crt;
  }, [crt]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    const scene = new OfficeScene();
    sceneRef.current = scene;
    const target = {
      rect: (x: number, y: number, w: number, h: number, color: string) => {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, w, h);
      },
    };

    let raf = 0;
    let last = performance.now();
    const loop = (rafNow: number) => {
      const dt = Math.min(0.05, (rafNow - last) / 1000);
      last = rafNow;
      // wall-clock ms everywhere so bubbles/flashes/day-night agree
      const nowMs = Date.now();
      scene.update(dt, nowMs);
      scene.draw(target, nowMs);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    sceneRef.current?.syncBots(bots, Date.now());
  }, [bots]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const fresh = events.filter((e) => !seenEvents.current.has(e.id));
    if (!fresh.length) return;
    for (const e of fresh) seenEvents.current.add(e.id);
    scene.handleEvents(fresh, Date.now());
  }, [events]);

  useEffect(() => {
    if (sceneRef.current) sceneRef.current.selectedId = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (sceneRef.current) sceneRef.current.hoverId = hoverId;
  }, [hoverId]);

  useEffect(() => {
    sceneRef.current?.setGateway(gatewayRunning, gatewayDegraded);
  }, [gatewayRunning, gatewayDegraded]);

  const pickAt = (clientX: number, clientY: number): string | null => {
    const canvas = canvasRef.current;
    const scene = sceneRef.current;
    if (!canvas || !scene) return null;
    const r = canvas.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * WORLD_W;
    const y = ((clientY - r.top) / r.height) * WORLD_H;
    return scene.pick(x, y);
  };

  return (
    <div className="canvas-frame">
      <button
        className={`crt-toggle${crt ? " on" : ""}`}
        onClick={() => setCrt((v) => !v)}
        title="Toggle CRT scanlines"
        aria-pressed={crt}
      >
        CRT
      </button>
      <canvas
        ref={canvasRef}
        width={WORLD_W}
        height={WORLD_H}
        onClick={(e) => onSelect(pickAt(e.clientX, e.clientY))}
        onMouseMove={(e) => setHoverId(pickAt(e.clientX, e.clientY))}
        onMouseLeave={() => setHoverId(null)}
        style={{ cursor: "pointer" }}
        aria-label="Dunder Bots office floor plan"
      />
    </div>
  );
}
