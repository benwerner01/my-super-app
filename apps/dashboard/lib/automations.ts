import { readdir } from "node:fs/promises";
import path from "node:path";
import { readRuns, type RunRecord } from "@repo/run-log";
import { readAgent, type Agent } from "./launchd.ts";
import { repoRoot } from "./repo-root.ts";

/** More history than any of these automations will produce in a year. */
const RUN_HISTORY_LIMIT = 1_000;

export type Outcome = "changed" | "no-op" | "error" | "failed";
export type Health = "healthy" | "degraded" | "failing" | "never-run";

export type Automation = {
  name: string;
  agent: Agent;
  /** Newest first. */
  runs: RunRecord[];
  lastRun: RunRecord | null;
  consecutiveFailures: number;
  health: Health;
};

/**
 * An automation can exit 0 and still report a problem — `mr-green-calendar`
 * swallows a transient scrape failure rather than failing the run — so an
 * error on a successful exit is its own outcome, not a no-op.
 *
 * `record.error` is only ever an asserted failure; anything a successful run
 * merely wrote to stderr stays in `record.stderr` and is surfaced separately, so
 * a deprecation warning cannot colour an automation as degraded.
 */
export function outcomeOf(record: RunRecord): Outcome {
  if (!record.ok) return "failed";
  if (record.error) return "error";
  return record.changed ? "changed" : "no-op";
}

/** Stderr nobody claimed as an error: worth showing, not worth alarming over. */
export function unclaimedStderr(record: RunRecord | null): string | null {
  if (!record || record.error) return null;
  return record.stderr;
}

/** One directory per automation; anything else in the tree is not one. */
export async function automationNames(root: string): Promise<string[]> {
  try {
    const entries = await readdir(path.join(root, "automations"), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function summarize(name: string, agent: Agent, runs: RunRecord[]): Automation {
  const newestFirst = [...runs].reverse();
  let consecutiveFailures = 0;
  for (const run of newestFirst) {
    if (run.ok) break;
    consecutiveFailures += 1;
  }
  const lastRun = newestFirst[0] ?? null;
  const health: Health =
    lastRun === null ? "never-run" : !lastRun.ok ? "failing" : lastRun.error ? "degraded" : "healthy";
  return { name, agent, runs: newestFirst, lastRun, consecutiveFailures, health };
}

export async function loadAutomations(): Promise<Automation[]> {
  const root = repoRoot();
  const [names, runs] = await Promise.all([automationNames(root), readRuns(root, RUN_HISTORY_LIMIT)]);
  const agents = await Promise.all(names.map((name) => readAgent(name)));
  return names.map((name, index) =>
    summarize(
      name,
      agents[index] ?? { label: name, plistPath: "", installed: false, schedule: { kind: "none" }, program: [], runAtLoad: false, keepAlive: false },
      runs.filter((run) => run.automation === name),
    ),
  );
}

/** Null when the name is not an automation directory — which also keeps a
 * crafted route parameter from reaching the filesystem. */
export async function loadAutomation(name: string): Promise<Automation | null> {
  const root = repoRoot();
  const names = await automationNames(root);
  if (!names.includes(name)) return null;
  const [runs, agent] = await Promise.all([readRuns(root, RUN_HISTORY_LIMIT), readAgent(name)]);
  return summarize(name, agent, runs.filter((run) => run.automation === name));
}
