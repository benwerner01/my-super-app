import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { asDict, parsePlist, type PlistValue } from "./plist.ts";

/** Automations in this repo are scheduled as user agents under this label. */
const LABEL_PREFIX = "ch.benwerner.";
const AGENT_DIRECTORY = path.join(homedir(), "Library", "LaunchAgents");

const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export type Schedule =
  | { kind: "none" }
  | { kind: "calendar" | "interval" | "manual"; description: string; nextRunAt: string | null };

export type Agent = {
  label: string;
  plistPath: string;
  /** False when no plist exists — an automation nothing will ever run. */
  installed: boolean;
  schedule: Schedule;
  program: string[];
  runAtLoad: boolean;
  keepAlive: boolean;
};

type CalendarEntry = {
  minute: number | null;
  hour: number | null;
  day: number | null;
  weekday: number | null;
  month: number | null;
};

export function agentLabel(name: string): string {
  return `${LABEL_PREFIX}${name}`;
}

function integer(value: PlistValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function calendarEntries(value: PlistValue | undefined): CalendarEntry[] {
  const dicts = Array.isArray(value) ? value : [value];
  const entries: CalendarEntry[] = [];
  for (const candidate of dicts) {
    const dict = asDict(candidate);
    if (!dict) continue;
    // launchd accepts both 0 and 7 for Sunday.
    const weekday = integer(dict["Weekday"]);
    entries.push({
      minute: integer(dict["Minute"]),
      hour: integer(dict["Hour"]),
      day: integer(dict["Day"]),
      weekday: weekday === null ? null : weekday % 7,
      month: integer(dict["Month"]),
    });
  }
  return entries;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function describeEntry(entry: CalendarEntry): string {
  const days =
    entry.weekday !== null
      ? (WEEKDAYS[entry.weekday] ?? "every day")
      : entry.day !== null
        ? `day ${entry.day} of the month`
        : "daily";
  const month = entry.month !== null ? ` in ${MONTHS[entry.month - 1] ?? entry.month}` : "";
  const time =
    entry.hour !== null && entry.minute !== null
      ? `${pad(entry.hour)}:${pad(entry.minute)}`
      : entry.hour !== null
        ? `every minute of ${pad(entry.hour)}:00`
        : entry.minute !== null
          ? `hourly at :${pad(entry.minute)}`
          : "every minute";
  return `${days}${month} ${time}`;
}

/** The next wall-clock instant matching the entry, searching a year ahead. */
function nextFire(entry: CalendarEntry, from: Date): Date | null {
  const hours = entry.hour !== null ? [entry.hour] : [...Array(24).keys()];
  const minutes = entry.minute !== null ? [entry.minute] : [...Array(60).keys()];
  for (let offset = 0; offset <= 400; offset += 1) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
    if (entry.month !== null && day.getMonth() + 1 !== entry.month) continue;
    if (entry.day !== null && day.getDate() !== entry.day) continue;
    if (entry.weekday !== null && day.getDay() !== entry.weekday) continue;
    for (const hour of hours) {
      for (const minute of minutes) {
        const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
        if (at.getTime() > from.getTime()) return at;
      }
    }
  }
  return null;
}

function describeInterval(seconds: number): string {
  if (seconds % 86_400 === 0) return `every ${seconds / 86_400}d`;
  if (seconds % 3_600 === 0) return `every ${seconds / 3_600}h`;
  if (seconds % 60 === 0) return `every ${seconds / 60}m`;
  return `every ${seconds}s`;
}

function scheduleOf(dict: Record<string, PlistValue>, now: Date): Schedule {
  const entries = calendarEntries(dict["StartCalendarInterval"]);
  if (entries.length > 0) {
    const fires = entries.map((entry) => nextFire(entry, now)).filter((at): at is Date => at !== null);
    fires.sort((a, b) => a.getTime() - b.getTime());
    return {
      kind: "calendar",
      description: entries.map(describeEntry).join("; "),
      nextRunAt: fires[0]?.toISOString() ?? null,
    };
  }
  const interval = integer(dict["StartInterval"]);
  if (interval !== null && interval > 0) {
    // launchd counts the interval from when the agent was loaded, which the
    // plist cannot tell us, so there is no next time to show.
    return { kind: "interval", description: describeInterval(interval), nextRunAt: null };
  }
  if (dict["KeepAlive"] === true) return { kind: "manual", description: "always running", nextRunAt: null };
  if (dict["RunAtLoad"] === true) return { kind: "manual", description: "at login only", nextRunAt: null };
  return { kind: "manual", description: "on demand only", nextRunAt: null };
}

/**
 * Reads the launchd agent for an automation. A missing plist is the answer, not
 * an error: an automation with no agent is a real failure mode worth showing.
 */
export async function readAgent(name: string, now: Date = new Date()): Promise<Agent> {
  const label = agentLabel(name);
  const plistPath = path.join(AGENT_DIRECTORY, `${label}.plist`);
  const missing: Agent = {
    label,
    plistPath,
    installed: false,
    schedule: { kind: "none" },
    program: [],
    runAtLoad: false,
    keepAlive: false,
  };

  let xml: string;
  try {
    xml = await readFile(plistPath, "utf8");
  } catch {
    return missing;
  }

  const dict = asDict(parsePlist(xml));
  if (!dict) return { ...missing, installed: true, schedule: { kind: "manual", description: "unreadable plist", nextRunAt: null } };

  const program = dict["ProgramArguments"];
  return {
    label: typeof dict["Label"] === "string" ? dict["Label"] : label,
    plistPath,
    installed: true,
    schedule: scheduleOf(dict, now),
    program: Array.isArray(program) ? program.filter((value): value is string => typeof value === "string") : [],
    runAtLoad: dict["RunAtLoad"] === true,
    keepAlive: dict["KeepAlive"] === true,
  };
}
