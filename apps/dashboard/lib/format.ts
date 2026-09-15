/**
 * Rendering happens on the server on every request, so these are called with a
 * single `now` per render — the client never recomputes them and there is
 * nothing to drift out of sync.
 */

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Local wall-clock time; run records are stored in UTC. */
export function formatTimestamp(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

const UNITS: [limit: number, size: number, suffix: string][] = [
  [60_000, 1_000, "s"],
  [3_600_000, 60_000, "m"],
  [86_400_000, 3_600_000, "h"],
  [Number.POSITIVE_INFINITY, 86_400_000, "d"],
];

export function formatRelative(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const delta = at.getTime() - now.getTime();
  const magnitude = Math.abs(delta);
  if (magnitude < 45_000) return delta >= 0 ? "now" : "just now";
  const unit = UNITS.find(([limit]) => magnitude < limit) ?? UNITS[UNITS.length - 1]!;
  const value = Math.round(magnitude / unit[1]);
  return delta >= 0 ? `in ${value}${unit[2]}` : `${value}${unit[2]} ago`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`;
}

/** Run summaries are free-form JSON; this keeps them to one readable line. */
export function formatSummary(summary: unknown): string {
  if (summary === null || summary === undefined) return "";
  if (typeof summary === "string") return summary;
  if (typeof summary === "object" && !Array.isArray(summary)) {
    const entries = Object.entries(summary as Record<string, unknown>);
    if (entries.length > 0 && entries.every(([, value]) => typeof value !== "object")) {
      return entries.map(([key, value]) => `${key} ${String(value)}`).join(", ");
    }
  }
  return JSON.stringify(summary);
}
