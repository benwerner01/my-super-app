import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildRecord, formatRow, readRuns, runLogPath, type RunRecord } from "./run-log.ts";

const base = {
  automation: "example",
  startedAt: "2026-09-15T06:00:00Z",
  durationMs: 100,
  notified: "",
};

test("stderr on a successful run is kept but is not an error", () => {
  const record = buildRecord({
    ...base,
    exitCode: 0,
    stdout: JSON.stringify({ changed: false }),
    stderr: "(node:123) [DEP0040] DeprecationWarning: punycode is deprecated\n",
  });

  assert.equal(record.error, null, "a warning must not be reported as a failure");
  assert.match(record.stderr ?? "", /DeprecationWarning/u, "but it must not be thrown away either");
  assert.equal(record.ok, true);
});

test("an automation that reports an error while exiting 0 is still an error", () => {
  // mr-green-calendar swallows a transient scrape failure and exits 0.
  const record = buildRecord({
    ...base,
    exitCode: 0,
    stdout: JSON.stringify({ changed: false, scrapeFailure: 1, error: "fetch failed" }),
    stderr: "",
  });

  assert.equal(record.error, "fetch failed");
  assert.equal(record.ok, true);
});

test("a non-zero exit falls back to stderr for its error", () => {
  const record = buildRecord({
    ...base,
    exitCode: 1,
    stdout: "not json",
    stderr: "Missing GOOGLE_ACCOUNT.\n",
  });

  assert.equal(record.error, "Missing GOOGLE_ACCOUNT.");
  assert.equal(record.stderr, "Missing GOOGLE_ACCOUNT.");
  assert.equal(record.ok, false);
});

test("a reported error wins over stderr, and neither is lost", () => {
  const record = buildRecord({
    ...base,
    exitCode: 2,
    stdout: JSON.stringify({ error: "source unreachable 3 runs in a row" }),
    stderr: "warning: slow response\n",
  });

  assert.equal(record.error, "source unreachable 3 runs in a row");
  assert.equal(record.stderr, "warning: slow response");
});

test("a failure with a silent stderr still records the non-zero exit", () => {
  const record = buildRecord({ ...base, exitCode: 137, stdout: "", stderr: "" });

  assert.equal(record.ok, false);
  assert.equal(record.exitCode, 137);
  assert.equal(record.stderr, null);
});

test("records written before stderr existed read back with a null stderr", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "run-log-"));
  await mkdir(path.dirname(runLogPath(root)), { recursive: true });
  const legacy = {
    automation: "example",
    startedAt: "2026-09-14T06:13:01Z",
    durationMs: 529,
    exitCode: 0,
    ok: true,
    changed: false,
    notified: null,
    summary: null,
    error: "fetch failed",
  };
  await writeFile(runLogPath(root), `${JSON.stringify(legacy)}\ntorn{\n`, "utf8");

  const runs = await readRuns(root);
  assert.equal(runs.length, 1, "a torn line must not hide the rest of the history");
  const [record] = runs as [RunRecord];
  assert.equal(record.stderr, null);
  assert.equal(record.error, "fetch failed");
});

test("a run that exits 0 while reporting an error is not listed as a no-op", () => {
  const record = buildRecord({
    ...base,
    exitCode: 0,
    stdout: JSON.stringify({ changed: false, error: "fetch failed" }),
    stderr: "",
  });

  assert.match(formatRow(record), /\berror\b/u);
  assert.doesNotMatch(formatRow(record), /no-op/u);
});
