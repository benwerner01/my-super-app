import Link from "next/link";
import { notFound } from "next/navigation";
import { loadAutomation, outcomeOf, unclaimedStderr } from "../../../lib/automations.ts";
import { formatDuration, formatRelative, formatSummary, formatTimestamp } from "../../../lib/format.ts";
import { readLastRunOutput, readRunLogTail } from "../../../lib/logs.ts";
import { repoRoot } from "../../../lib/repo-root.ts";
import { Badge, Empty, HealthDot, OutcomeBadge, Output, Panel, StderrNote } from "../../../components/ui.tsx";

// Same reason as the list page: this reads the filesystem per request, so it
// must never be prerendered into the production build.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TAIL_LINES = 200;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line px-3 py-2 last:border-b-0">
      <dt className="text-[10px] uppercase tracking-widest text-faint">{label}</dt>
      <dd className="mt-1 break-words font-mono text-xs text-dim">{children}</dd>
    </div>
  );
}

export default async function AutomationDetailPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const automation = await loadAutomation(name);
  if (!automation) notFound();

  const root = repoRoot();
  const [{ stdout, stderr }, tail] = await Promise.all([
    readLastRunOutput(root, name),
    readRunLogTail(root, name, TAIL_LINES),
  ]);
  const now = new Date();
  const { agent } = automation;

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <header className="mb-6">
        <Link href="/" className="text-xs text-faint transition-colors hover:text-dim">
          ← Automations
        </Link>
        <div className="mt-2 flex items-center justify-between gap-4">
          <h1 className="font-mono text-lg font-semibold tracking-tight">{automation.name}</h1>
          <span className="flex items-center gap-3">
            {agent.installed ? <Badge tone="ok">scheduled</Badge> : <Badge tone="warn">not scheduled</Badge>}
            <HealthDot health={automation.health} />
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="order-2 space-y-3 lg:order-1">
          <Panel title="Run history" note={`${automation.runs.length} recorded`}>
            {automation.runs.length === 0 ? (
              <Empty>
                Nothing in <code className="font-mono">.local/runs.jsonl</code> for this automation yet.
              </Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left font-mono text-xs">
                  <thead>
                    <tr className="border-b border-line text-[10px] uppercase tracking-widest text-faint">
                      <th className="px-3 py-2 font-medium">started</th>
                      <th className="px-3 py-2 font-medium">outcome</th>
                      <th className="px-3 py-2 text-right font-medium">took</th>
                      <th className="px-3 py-2 text-right font-medium">exit</th>
                      <th className="px-3 py-2 font-medium">detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {automation.runs.map((run) => {
                      const detail = run.error ?? run.notified ?? formatSummary(run.summary);
                      const stderr = unclaimedStderr(run);
                      return (
                        <tr key={`${run.startedAt}-${run.durationMs}`} className="border-b border-line/60 last:border-b-0 align-top">
                          <td className="whitespace-nowrap px-3 py-2 text-dim">
                            {formatTimestamp(run.startedAt)}
                            <span className="ml-2 text-faint">{formatRelative(run.startedAt, now)}</span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2">
                            <OutcomeBadge outcome={outcomeOf(run)} />
                            {run.notified ? <span className="ml-1.5 text-[11px] text-warn">notified</span> : null}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right text-dim">{formatDuration(run.durationMs)}</td>
                          <td className={`whitespace-nowrap px-3 py-2 text-right ${run.ok ? "text-faint" : "text-bad"}`}>
                            {run.exitCode}
                          </td>
                          <td className={`px-3 py-2 ${run.error ? (run.ok ? "text-warn" : "text-bad") : "text-faint"}`}>
                            {detail || (stderr ? "" : "—")}
                            {stderr ? <StderrNote text={stderr} block /> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Last run · stdout" note={`${stdout.label}${stdout.truncated ? " (tail)" : ""}`}>
            <Output
              text={stdout.text}
              empty={stdout.exists ? "Empty — the last run printed nothing." : "No stdout file on disk yet."}
            />
          </Panel>

          <Panel title="Last run · stderr" note={`${stderr.label}${stderr.truncated ? " (tail)" : ""}`}>
            <Output
              text={stderr.text}
              empty={stderr.exists ? "Empty — the last run wrote nothing to stderr." : "No stderr file on disk yet."}
            />
          </Panel>

          <Panel
            title="run.log"
            note={`${tail.label}${tail.rotated ? " (rotated)" : ""} · newest run first, last ${TAIL_LINES} lines${
              tail.truncated ? ", truncated" : ""
            }`}
          >
            <Output text={tail.lines.join("\n")} empty="No detail log on disk yet." height="max-h-[32rem]" />
          </Panel>
        </div>

        <aside className="order-1 lg:order-2">
          <div className="overflow-hidden rounded-md border border-line bg-panel">
            <dl>
              <Fact label="launchd label">{agent.label}</Fact>
              <Fact label="agent">
                {agent.installed ? (
                  agent.plistPath
                ) : (
                  <span className="text-warn">not installed — nothing will run this automatically</span>
                )}
              </Fact>
              <Fact label="schedule">{agent.schedule.kind === "none" ? "—" : agent.schedule.description}</Fact>
              <Fact label="next run">
                {agent.schedule.kind !== "none" && agent.schedule.nextRunAt ? (
                  <>
                    {formatTimestamp(agent.schedule.nextRunAt)}
                    <span className="ml-2 text-faint">{formatRelative(agent.schedule.nextRunAt, now)}</span>
                  </>
                ) : (
                  "—"
                )}
              </Fact>
              {agent.program.length > 0 ? (
                <Fact label="command">{agent.program.join(" ")}</Fact>
              ) : null}
              <Fact label="last run">
                {automation.lastRun ? (
                  <>
                    {formatTimestamp(automation.lastRun.startedAt)}
                    <span className="ml-2 text-faint">{formatRelative(automation.lastRun.startedAt, now)}</span>
                  </>
                ) : (
                  "never"
                )}
              </Fact>
              <Fact label="consecutive failures">
                <span className={automation.consecutiveFailures > 0 ? "text-bad" : ""}>
                  {automation.consecutiveFailures}
                </span>
              </Fact>
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}
