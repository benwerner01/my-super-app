import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Everything the dashboard reads lives in the repo, not in this app: run
 * records in `.local/`, automation directories in `automations/`. Under
 * `next start` the cwd is `apps/dashboard`, and under `next dev` it is the same
 * — but under launchd it is whatever the agent was given, so the root is found
 * by looking for the file that defines the repo rather than assumed.
 */
const MARKER = path.join("lib", "run-log.ts");

function findUpwards(from: string): string | null {
  let current = path.resolve(from);
  for (;;) {
    if (existsSync(path.join(current, MARKER))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

let cached: string | null = null;

export function repoRoot(): string {
  if (cached) return cached;
  const override = process.env["MY_SUPER_APP_ROOT"];
  if (override && existsSync(path.join(override, MARKER))) {
    cached = path.resolve(override);
    return cached;
  }
  // `import.meta.dirname` survives bundling less reliably than the cwd, so the
  // cwd is tried first and this app's own location is the fallback.
  cached = findUpwards(process.cwd()) ?? findUpwards(import.meta.dirname) ?? process.cwd();
  return cached;
}
