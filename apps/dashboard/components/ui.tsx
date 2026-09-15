import type { Health, Outcome } from "../lib/automations.ts";

const HEALTH_STYLES: Record<Health, { dot: string; label: string }> = {
  healthy: { dot: "bg-ok", label: "healthy" },
  degraded: { dot: "bg-warn", label: "last run reported an error" },
  failing: { dot: "bg-bad", label: "failing" },
  "never-run": { dot: "bg-faint", label: "never run" },
};

export function HealthDot({ health }: { health: Health }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`inline-block size-2 rounded-full ${HEALTH_STYLES[health].dot}`} />
      <span className="text-xs text-dim">{HEALTH_STYLES[health].label}</span>
    </span>
  );
}

const OUTCOME_STYLES: Record<Outcome, string> = {
  changed: "border-info/40 bg-info/10 text-info",
  "no-op": "border-line bg-raised text-dim",
  error: "border-warn/40 bg-warn/10 text-warn",
  failed: "border-bad/40 bg-bad/10 text-bad",
};

export function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[11px] leading-none ${OUTCOME_STYLES[outcome]}`}>
      {outcome}
    </span>
  );
}

/**
 * A run that exits 0 but wrote to stderr is not a failure, so it gets no error
 * styling — but stderr is the one place a real problem can hide without anyone
 * asserting it, so it is always rendered rather than folded away.
 */
export function StderrNote({ text, block = false }: { text: string; block?: boolean }) {
  return (
    <span className={`${block ? "mt-1 flex" : "inline-flex"} min-w-0 items-center gap-1.5 text-dim`} title={text}>
      <span className="shrink-0 rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[11px] leading-none text-faint">
        stderr
      </span>
      <span className="truncate text-xs">{text}</span>
    </span>
  );
}

export function Badge({ tone, children }: { tone: "ok" | "warn" | "bad" | "muted"; children: React.ReactNode }) {
  const styles = {
    ok: "border-ok/40 bg-ok/10 text-ok",
    warn: "border-warn/40 bg-warn/10 text-warn",
    bad: "border-bad/40 bg-bad/10 text-bad",
    muted: "border-line bg-raised text-dim",
  }[tone];
  return <span className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[11px] leading-none ${styles}`}>{children}</span>;
}

export function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-line bg-panel">
      <header className="flex items-baseline justify-between gap-3 border-b border-line px-3 py-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-dim">{title}</h2>
        {note ? <span className="truncate font-mono text-[11px] text-faint">{note}</span> : null}
      </header>
      {children}
    </section>
  );
}

/** Fixed-height scrolling block for raw command output. */
export function Output({ text, empty, height = "max-h-80" }: { text: string; empty: string; height?: string }) {
  if (!text.trim()) return <p className="px-3 py-3 text-xs text-faint">{empty}</p>;
  return (
    <pre className={`${height} overflow-auto whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-xs leading-relaxed text-dim`}>
      {text}
    </pre>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-6 text-center text-xs text-faint">{children}</p>;
}
