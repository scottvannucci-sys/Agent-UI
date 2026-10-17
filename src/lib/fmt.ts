export function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function fmtAgo(tsSec: number): string {
  const d = Date.now() / 1000 - tsSec;
  if (d < 0) return "now";
  if (d < 60) return `${Math.floor(d)}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

export function fmtDayTime(tsSec: number): string {
  return new Date(tsSec * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
