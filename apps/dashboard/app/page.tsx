import Link from "next/link";
import { loadAutomations, outcomeOf, unclaimedStderr, type Automation } from "../lib/automations.ts";
import { formatDuration, formatRelative, formatSummary, formatTimestamp } from "../lib/format.ts";
import { Badge, Empty, HealthDot, OutcomeBadge, StderrNote } from "../components/ui.tsx";

// Reads `.local/runs.jsonl` and `~/Library/LaunchAgents` on every request. Without
// this the production build would prerender the page and serve run history frozen
// at build time.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Last few runs, oldest to newest, as a compact timeline. */
function RunStrip({ automation }: { automation: Automation }) {
  const recent = automation.runs.slice(0, 14).reverse();
  if (recent.length === 0) return null;
  return (
    <div className="flex items-end gap-0.5" title={`${automation.runs.length} recorded runs`}>
      {recent.map((run) => (
        <span
          key={`${run.startedAt}-${run.durationMs}`}
          title={`${formatTimestamp(run.startedAt)} — ${outcomeOf(run)}${
            unclaimedStderr(run) ? " · wrote to stderr" : ""
          }`}
          className={`h-4 w-1.5 rounded-xs ${
            !run.ok
              ? "bg-bad"
              : run.error
                ? "bg-warn"
                : unclaimedStderr(run)
                  ? "bg-faint"
                  : run.changed
                    ? "bg-info"
                    : "bg-ok/70"
          }`}
        />
      ))}
    </div>
  );
}

function ScheduleLine({ automation, now }: { automation: Automation; now: Date }) {
  const { agent } = automation;
  if (!agent.installed) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <Badge tone="warn">not scheduled</Badge>
        <span className="text-xs text-faint">no launchd agent {agent.label}</span>
      </span>
    );
  }
  const { schedule } = agent;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge tone="ok">scheduled</Badge>
      <span className="font-mono text-xs text-dim">{schedule.kind === "none" ? "—" : schedule.description}</span>
      {schedule.kind !== "none" && schedule.nextRunAt ? (
        <span className="text-xs text-faint">
          next {formatRelative(schedule.nextRunAt, now)} · {formatTimestamp(schedule.nextRunAt)}
        </span>
      ) : null}
    </span>
  );
}

function LastRunLine({ automation, now }: { automation: Automation; now: Date }) {
  const run = automation.lastRun;
  if (!run) return <span className="text-xs text-faint">no recorded runs</span>;
  const detail = run.error ?? run.notified ?? formatSummary(run.summary);
  const stderr = unclaimedStderr(run);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <OutcomeBadge outcome={outcomeOf(run)} />
      <span className="font-mono text-xs text-dim">
        {formatRelative(run.startedAt, now)} · {formatDuration(run.durationMs)}
      </span>
      {detail ? (
        <span className={`truncate text-xs ${!run.ok ? "text-bad" : run.error ? "text-warn" : "text-faint"}`}>
          {detail}
        </span>
      ) : null}
      {stderr ? <StderrNote text={stderr} /> : null}
    </span>
  );
}

export default async function AutomationsPage() {
  const automations = await loadAutomations();
  const now = new Date();
  const failing = automations.filter((automation) => automation.health === "failing").length;
  const degraded = automations.filter((automation) => automation.health === "degraded").length;
  const unscheduled = automations.filter((automation) => !automation.agent.installed).length;
  // Not a fault, so it gets its own quiet count rather than inflating the others.
  const noisy = automations.filter((automation) => unclaimedStderr(automation.lastRun)).length;

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Automations</h1>
          <p className="mt-1 text-xs text-faint">
            One per directory in <code className="font-mono">automations/</code>, joined with{" "}
            <code className="font-mono">.local/runs.jsonl</code> and the installed launchd agents.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {failing > 0 ? <Badge tone="bad">{failing} failing</Badge> : null}
          {degraded > 0 ? <Badge tone="warn">{degraded} reporting errors</Badge> : null}
          {unscheduled > 0 ? <Badge tone="warn">{unscheduled} not scheduled</Badge> : null}
          {noisy > 0 ? <Badge tone="muted">{noisy} wrote to stderr</Badge> : null}
          {failing === 0 && degraded === 0 && unscheduled === 0 && automations.length > 0 ? (
            <Badge tone="ok">all healthy</Badge>
          ) : null}
        </div>
      </header>

      {automations.length === 0 ? (
        <div className="rounded-md border border-line bg-panel">
          <Empty>
            No automations yet. Create <code className="font-mono">automations/&lt;name&gt;/index.ts</code> to add one.
          </Empty>
        </div>
      ) : (
        <ul className="space-y-2">
          {automations.map((automation) => (
            <li key={automation.name}>
              <Link
                href={`/automations/${automation.name}`}
                className="block rounded-md border border-line bg-panel px-4 py-3 transition-colors hover:border-line hover:bg-raised"
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="font-mono text-sm text-ink">{automation.name}</span>
                  <span className="flex items-center gap-3">
                    <RunStrip automation={automation} />
                    <HealthDot health={automation.health} />
                  </span>
                </div>
                <dl className="mt-2.5 grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                  <dt className="text-xs text-faint">schedule</dt>
                  <dd className="min-w-0">
                    <ScheduleLine automation={automation} now={now} />
                  </dd>
                  <dt className="text-xs text-faint">last run</dt>
                  <dd className="min-w-0">
                    <LastRunLine automation={automation} now={now} />
                  </dd>
                </dl>
                {automation.consecutiveFailures > 1 ? (
                  <p className="mt-2 text-xs text-bad">{automation.consecutiveFailures} consecutive failures</p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
