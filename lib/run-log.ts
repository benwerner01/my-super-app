import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import path from "node:path";

/**
 * One line per automation run, appended to `.local/runs.jsonl`. This is the
 * queryable index of what happened and when; the full stdout/stderr of each run
 * is kept separately in `.local/<automation>/run.log`.
 */
export type RunRecord = {
  automation: string;
  startedAt: string;
  durationMs: number;
  exitCode: number;
  ok: boolean;
  /** null when the automation did not report a machine-readable result. */
  changed: boolean | null;
  /** Message surfaced to the user, or null when the run passed silently. */
  notified: string | null;
  /** Whatever the automation reported as its outcome, truncated. */
  summary: unknown;
  /**
   * The run's asserted failure: what the automation itself reported as `error`,
   * or its stderr when the process actually exited non-zero. A run that exits 0
   * and reports nothing has no error here, however much it wrote to stderr.
   */
  error: string | null;
  /**
   * Everything the run wrote to stderr, kept whether or not it failed. A warning
   * on a successful run lands here and nowhere else, so a real problem an
   * automation only ever mentions on stderr stays visible instead of being
   * dropped — it is just not dressed up as a failure.
   */
  stderr: string | null;
};

const MAX_LOG_BYTES = 2_000_000;
const MAX_SUMMARY_CHARS = 2_000;

export function runLogPath(root: string): string {
  return path.join(root, ".local", "runs.jsonl");
}

/** Rotates a log file once it passes the size cap, keeping one generation. */
export async function rotateIfLarge(file: string, maxBytes = MAX_LOG_BYTES): Promise<void> {
  try {
    const { size } = await stat(file);
    if (size > maxBytes) await rename(file, `${file}.1`);
  } catch {
    // nothing to rotate
  }
}

export async function appendRun(root: string, record: RunRecord): Promise<void> {
  const file = runLogPath(root);
  await mkdir(path.dirname(file), { recursive: true });
  await rotateIfLarge(file);
  await appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
}

export async function readRuns(root: string, limit = 20): Promise<RunRecord[]> {
  let contents: string;
  try {
    contents = await readFile(runLogPath(root), "utf8");
  } catch {
    return [];
  }
  const records: RunRecord[] = [];
  for (const line of contents.split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(normalize(JSON.parse(line) as RunRecord));
    } catch {
      // a torn line should not hide the rest of the history
    }
  }
  return records.slice(-limit);
}

/** Records written before `stderr` existed simply do not carry the field. */
function normalize(record: RunRecord): RunRecord {
  return { ...record, stderr: record.stderr ?? null };
}

function truncate(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return null;
  if (serialized.length <= MAX_SUMMARY_CHARS) return value;
  return `${serialized.slice(0, MAX_SUMMARY_CHARS)}…`;
}

/**
 * Builds a record from what a run produced. Automations that print a JSON
 * object on stdout get their fields picked up; anything else is still recorded,
 * just with less detail.
 */
export function buildRecord(input: {
  automation: string;
  startedAt: string;
  durationMs: number;
  exitCode: number;
  stdout: string;
  stderr: string;
  notified: string;
}): RunRecord {
  let payload: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = JSON.parse(input.stdout);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    }
  } catch {
    payload = undefined;
  }

  const compactStderr = input.stderr.replace(/\s+/gu, " ").trim().slice(0, 500);
  const reportedError = typeof payload?.["error"] === "string" ? payload["error"] : null;

  return {
    automation: input.automation,
    startedAt: input.startedAt,
    durationMs: input.durationMs,
    exitCode: input.exitCode,
    ok: input.exitCode === 0,
    changed: typeof payload?.["changed"] === "boolean" ? payload["changed"] : null,
    notified: input.notified.trim() || null,
    summary: truncate(payload?.["changes"] ?? payload?.["summary"] ?? null),
    error: reportedError ?? (input.exitCode === 0 ? null : compactStderr || null),
    stderr: compactStderr || null,
  };
}

/** Stderr is worth a line of its own so a quiet warning is not swallowed. */
function detailOf(record: RunRecord): string {
  if (record.notified) return record.notified;
  if (record.error) return record.error;
  if (record.stderr) return `stderr: ${record.stderr}`;
  return record.summary ? JSON.stringify(record.summary) : "";
}

export function formatRow(record: RunRecord): string {
  const when = record.startedAt.replace("T", " ").slice(0, 19);
  // A run that exits 0 while reporting an error is not a no-op; saying so here
  // would hide exactly the failure this column exists to show.
  const outcome = !record.ok
    ? `FAILED(${record.exitCode})`
    : record.error
      ? "error"
      : record.changed
        ? "changed"
        : "no-op";
  const seconds = `${(record.durationMs / 1000).toFixed(1)}s`;
  const detail = detailOf(record);
  return `${when}  ${record.automation.padEnd(22)} ${outcome.padEnd(12)} ${seconds.padStart(7)}  ${detail}`;
}

if (import.meta.main) {
  const root = process.cwd();
  const [command = "list"] = process.argv.slice(2);

  if (command === "record") {
    const record = buildRecord({
      automation: process.env["RUN_AUTOMATION"] ?? "unknown",
      startedAt: process.env["RUN_STARTED_AT"] ?? new Date().toISOString(),
      durationMs: Number(process.env["RUN_DURATION_MS"] ?? "0"),
      exitCode: Number(process.env["RUN_EXIT_CODE"] ?? "0"),
      stdout: process.env["RUN_STDOUT"] ?? "",
      stderr: process.env["RUN_STDERR"] ?? "",
      notified: process.env["RUN_NOTIFIED"] ?? "",
    });
    await appendRun(root, record);
  } else if (command === "list") {
    const runs = await readRuns(root, Number(process.argv[3] ?? "20"));
    if (runs.length === 0) console.log("No runs recorded yet.");
    else for (const record of runs) console.log(formatRow(record));
  } else {
    console.error(`Unknown command: ${command}. Use "list" or "record".`);
    process.exitCode = 1;
  }
}
