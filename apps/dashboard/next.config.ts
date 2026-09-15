import path from "node:path";
import type { NextConfig } from "next";

// The dashboard reads the repo it lives in — `lib/run-log.ts`, `automations/`
// and `.local/` all sit two levels up — so both the compiler and the file
// tracer need to treat the repo root, not this app, as the boundary.
const repoRoot = path.join(import.meta.dirname, "..", "..");

const config: NextConfig = {
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  // `lib/run-log.ts` lives outside this app; webpack refuses to compile files
  // outside the project directory without this.
  experimental: { externalDir: true },
};

export default config;
