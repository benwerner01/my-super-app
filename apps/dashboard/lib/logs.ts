import { open, stat } from "node:fs/promises";
import path from "node:path";

/** Enough to see what happened without shipping a megabyte into the page. */
const MAX_OUTPUT_BYTES = 128 * 1024;
const MAX_TAIL_BYTES = 512 * 1024;

export type LogFile = {
  /** Path relative to the repo root, for display. */
  label: string;
  text: string;
  exists: boolean;
  truncated: boolean;
};

/** Reads at most the last `maxBytes` of a file. Missing files are not errors. */
async function readTail(file: string, maxBytes: number): Promise<{ text: string; truncated: boolean } | null> {
  let size: number;
  try {
    ({ size } = await stat(file));
  } catch {
    return null;
  }
  const length = Math.min(size, maxBytes);
  const handle = await open(file, "r").catch(() => null);
  if (!handle) return null;
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return { text: buffer.toString("utf8"), truncated: size > length };
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => {});
  }
}

function stateDirectory(root: string, name: string): string {
  return path.join(root, ".local", name);
}

async function loadFile(root: string, file: string, maxBytes: number): Promise<LogFile> {
  const label = path.relative(root, file);
  const result = await readTail(file, maxBytes);
  if (!result) return { label, text: "", exists: false, truncated: false };
  return { label, text: result.text, exists: true, truncated: result.truncated };
}

/** The most recent run's stdout and stderr, as the runner left them. */
export async function readLastRunOutput(root: string, name: string): Promise<{ stdout: LogFile; stderr: LogFile }> {
  const directory = stateDirectory(root, name);
  const [stdout, stderr] = await Promise.all([
    loadFile(root, path.join(directory, "last-run.out"), MAX_OUTPUT_BYTES),
    loadFile(root, path.join(directory, "last-run.err"), MAX_OUTPUT_BYTES),
  ]);
  return { stdout, stderr };
}

export type RunLogTail = {
  label: string;
  lines: string[];
  exists: boolean;
  truncated: boolean;
  /** True when only the rotated generation survives. */
  rotated: boolean;
};

/** The runner opens every entry with `=== <timestamp> (exit N, Nms) ===`. */
const RUN_HEADER = /^=== .+ ===$/u;

/**
 * Reverses the log a run at a time rather than a line at a time: the newest run
 * comes first, but the pretty-printed JSON inside each one stays readable.
 */
function newestRunFirst(lines: string[]): string[] {
  const blocks: string[][] = [];
  let block: string[] = [];
  for (const line of lines) {
    if (RUN_HEADER.test(line) && block.length > 0) {
      blocks.push(block);
      block = [];
    }
    block.push(line);
  }
  if (block.length > 0) blocks.push(block);
  return blocks.reverse().flat();
}

/**
 * The tail of the per-automation detail log, newest run first. The runner
 * rotates this file past 2MB, so a missing `run.log` falls back to `run.log.1`.
 */
export async function readRunLogTail(root: string, name: string, maxLines = 200): Promise<RunLogTail> {
  const directory = stateDirectory(root, name);
  const current = path.join(directory, "run.log");
  const rotatedPath = `${current}.1`;

  let rotated = false;
  let file = await loadFile(root, current, MAX_TAIL_BYTES);
  if (!file.exists) {
    file = await loadFile(root, rotatedPath, MAX_TAIL_BYTES);
    rotated = file.exists;
  }
  if (!file.exists) {
    return { label: path.relative(root, current), lines: [], exists: false, truncated: false, rotated: false };
  }

  const all = file.text.split("\n");
  // A byte-bounded read can start mid-line; that fragment is not a real line.
  if (file.truncated) all.shift();
  while (all.length > 0 && all[all.length - 1] === "") all.pop();
  const tail = all.slice(-maxLines);
  return {
    label: file.label,
    lines: newestRunFirst(tail),
    exists: true,
    truncated: file.truncated || all.length > tail.length,
    rotated,
  };
}
