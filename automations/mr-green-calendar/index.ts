import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { accessToken, authorize } from "../../lib/google/oauth.ts";
import {
  PICKUP_ENDPOINT,
  SOURCE_PAGE,
  buildTwelveMonthSchedule,
  googleEventBody,
  reconcileEvents,
  renderIcs,
  type ExistingEvent,
  type MrGreenConfig,
  type PickupDate,
} from "./calendar.ts";

const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned";
const FAILURE_THRESHOLD = 3;

const root = process.cwd();
const stateDirectory = path.join(root, ".local", "mr-green-calendar");
const paths = {
  clientPath: path.join(stateDirectory, "google-oauth-client.json"),
  tokenPath: path.join(stateDirectory, "google-oauth-token.json"),
};
const failurePath = path.join(stateDirectory, "failure-state.json");

type FailureState = { consecutive: number; notified: boolean };

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Copy .env.example to .env.local and fill it in.`);
  return value;
}

function loadConfig(): { google: { account: string }; mrGreen: MrGreenConfig; icsPath: string } {
  return {
    google: { account: required("GOOGLE_ACCOUNT") },
    mrGreen: {
      zip: required("MR_GREEN_ZIP"),
      plan: required("MR_GREEN_PLAN"),
      eventSource: required("MR_GREEN_EVENT_SOURCE"),
      attendeeEmail: required("MR_GREEN_ATTENDEE"),
    },
    icsPath: path.join(stateDirectory, "pickups.ics"),
  };
}

async function fetchPickupDates(config: MrGreenConfig): Promise<string[]> {
  const url = new URL(PICKUP_ENDPOINT);
  url.search = new URLSearchParams({ zip: config.zip, type: config.plan }).toString();
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ zip: config.zip, type: config.plan }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Pickup API returned HTTP ${response.status}`);

  let payload: { success?: boolean; data?: Array<{ date?: string[]; dates?: string[] }> };
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("Pickup API response was not valid JSON");
  }
  if (!payload.success || !Array.isArray(payload.data)) {
    throw new Error("Pickup API reported failure or changed its response shape");
  }
  const dates = payload.data.flatMap((entry) => entry.dates ?? entry.date ?? []);
  if (dates.length === 0) throw new Error("Pickup API returned an empty date list");
  return dates;
}

async function googleRequest<T>(token: string, pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${CALENDAR_BASE}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Google Calendar API failed (${response.status}): ${text}`);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

async function listTaggedEvents(token: string, config: MrGreenConfig, today: string): Promise<ExistingEvent[]> {
  const events: ExistingEvent[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({
      privateExtendedProperty: `source=${config.eventSource}`,
      singleEvents: "true",
      maxResults: "2500",
      timeMin: `${today}T00:00:00Z`,
    });
    if (pageToken) query.set("pageToken", pageToken);
    const result = await googleRequest<{
      items?: Array<{ id?: string; start?: { date?: string }; attendees?: Array<{ email?: string }> }>;
      nextPageToken?: string;
    }>(token, `/calendars/primary/events?${query}`);
    for (const item of result.items ?? []) {
      if (item.id && item.start?.date) {
        events.push({
          id: item.id,
          date: item.start.date,
          hasAttendee: (item.attendees ?? []).some((attendee) => attendee.email === config.attendeeEmail),
        });
      }
    }
    pageToken = result.nextPageToken;
  } while (pageToken);
  return events;
}

async function applySync(token: string, config: MrGreenConfig, desired: PickupDate[], dryRun: boolean) {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });
  const plan = reconcileEvents(await listTaggedEvents(token, config, today), desired);
  if (!dryRun) {
    for (const update of plan.updates) {
      await googleRequest(token, `/calendars/primary/events/${encodeURIComponent(update.eventId)}?sendUpdates=all`, {
        method: "PUT",
        body: JSON.stringify(googleEventBody(update.to, config)),
      });
    }
    for (const pickup of plan.inserts) {
      await googleRequest(token, "/calendars/primary/events?sendUpdates=all", {
        method: "POST",
        body: JSON.stringify(googleEventBody(pickup, config)),
      });
    }
    for (const event of plan.deletes) {
      await googleRequest(token, `/calendars/primary/events/${encodeURIComponent(event.id)}?sendUpdates=all`, {
        method: "DELETE",
      });
    }
  }
  return plan;
}

async function writePrivateJson(file: string, value: unknown) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function failureState(): Promise<FailureState> {
  try {
    return JSON.parse(await readFile(failurePath, "utf8")) as FailureState;
  } catch {
    return { consecutive: 0, notified: false };
  }
}

async function recordScrapeFailure(error: unknown) {
  const previous = await failureState();
  const current = { consecutive: previous.consecutive + 1, notified: previous.notified };
  const notify = current.consecutive >= FAILURE_THRESHOLD && !current.notified;
  if (notify) current.notified = true;
  await writePrivateJson(failurePath, current);
  console.log(
    JSON.stringify({
      changed: false,
      notify,
      scrapeFailure: current.consecutive,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  if (notify) process.exitCode = 2;
}

async function sync(dryRun: boolean) {
  const config = loadConfig();
  await mkdir(stateDirectory, { recursive: true });
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });

  let desired: PickupDate[];
  try {
    desired = buildTwelveMonthSchedule(await fetchPickupDates(config.mrGreen), today);
  } catch (error) {
    await recordScrapeFailure(error);
    return;
  }

  await writePrivateJson(failurePath, { consecutive: 0, notified: false });
  await writeFile(config.icsPath, renderIcs(desired, config.mrGreen), "utf8");

  const plan = await applySync(await accessToken(paths), config.mrGreen, desired, dryRun);
  const changed = plan.updates.length + plan.inserts.length + plan.deletes.length > 0;
  console.log(
    JSON.stringify(
      {
        changed,
        dryRun,
        source: SOURCE_PAGE,
        endpoint: PICKUP_ENDPOINT,
        icsPath: config.icsPath,
        dates: desired,
        changes: { inserted: plan.inserts.length, updated: plan.updates.length, deleted: plan.deletes.length },
      },
      null,
      2,
    ),
  );
}

async function preview() {
  const config = loadConfig();
  await mkdir(stateDirectory, { recursive: true });
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });
  const desired = buildTwelveMonthSchedule(await fetchPickupDates(config.mrGreen), today);
  await writeFile(config.icsPath, renderIcs(desired, config.mrGreen), "utf8");
  console.log(JSON.stringify({ source: SOURCE_PAGE, endpoint: PICKUP_ENDPOINT, icsPath: config.icsPath, dates: desired }, null, 2));
}

async function main() {
  const [command = "sync", ...args] = process.argv.slice(2);

  if (command === "authorize") {
    const sourcePath = args[0];
    if (!sourcePath) throw new Error("Usage: pnpm mr-green:calendar authorize /path/to/client_secret.json");
    await mkdir(stateDirectory, { recursive: true });
    const { account } = await authorize({
      sourcePath,
      paths,
      scopes: [CALENDAR_SCOPE],
      expectedAccount: loadConfig().google.account,
    });
    console.log(JSON.stringify({ authorized: true, account, tokenPath: paths.tokenPath }));
    return;
  }
  if (command === "preview") return preview();
  if (command !== "sync") throw new Error(`Unknown command: ${command}`);
  await sync(args.includes("--dry-run"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
