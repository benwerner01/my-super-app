const stdout = process.env.MR_GREEN_STDOUT ?? "";
const stderr = process.env.MR_GREEN_STDERR ?? "";
const status = Number(process.env.MR_GREEN_STATUS ?? "0");

const compact = (value) => value.replace(/\s+/g, " ").trim().slice(0, 180);

let payload;
try {
  payload = JSON.parse(stdout);
} catch {
  payload = undefined;
}

if (!payload) {
  if (status !== 0) console.log(`Sync failed: ${compact(stderr) || compact(stdout) || "no output"}`);
} else if (payload.scrapeFailure) {
  if (payload.notify) {
    console.log(`Source unreachable ${payload.scrapeFailure} runs in a row: ${compact(payload.error ?? "")}`);
  }
} else if (payload.changed) {
  const { inserted = 0, updated = 0, deleted = 0 } = payload.changes ?? {};
  console.log(`Pickup dates changed: ${inserted} added, ${updated} moved, ${deleted} removed`);
} else if (status !== 0) {
  console.log(`Sync exited with code ${status}: ${compact(stderr) || "no error output"}`);
}
