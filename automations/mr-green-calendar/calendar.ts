export const SOURCE_PAGE = "https://mr-green.ch/en/pages/abholtermine";
export const PICKUP_ENDPOINT = "https://api-service.mr-green.ch/api/system/pickup-dates";
export const EVENT_TITLE = "Mr. Green Day";

const PROJECTION_CADENCE_DAYS = 28;
const REMINDER_MINUTES_BEFORE = 360;

export type MrGreenConfig = {
  zip: string;
  plan: string;
  eventSource: string;
  attendeeEmail: string;
};

export type PickupDate = {
  date: string;
  status: "confirmed" | "projected";
};

/** Speculative dates move, so only dates the source vouches for get an invite. */
export function shouldInviteAttendee(pickup: PickupDate): boolean {
  return pickup.status === "confirmed";
}

const GERMAN_MONTHS: Readonly<Record<string, number>> = {
  januar: 1,
  februar: 2,
  märz: 3,
  maerz: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  dezember: 12,
};

const NUMERIC_DATE = /^(?<day>\d{1,2})\.(?<month>\d{1,2})\.(?<year>\d{4})$/u;
const WRITTEN_DATE =
  /^(?:(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag),?\s+)?(?<day>\d{1,2})\.?\s+(?<month>[a-zä]+)\s+(?<year>\d{4})$/u;

function isoDate(year: number, month: number, day: number): string {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) {
    throw new Error(`Invalid calendar date: ${day}.${month}.${year}`);
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Accepts both shapes the widget has been seen to emit: `06.10.2026` and
 * `Montag, 6. Oktober 2026`.
 */
export function parseSwissGermanDate(input: string): string {
  const value = input.trim().toLocaleLowerCase("de-CH");

  const numeric = NUMERIC_DATE.exec(value)?.groups;
  if (numeric) {
    return isoDate(Number(numeric["year"]), Number(numeric["month"]), Number(numeric["day"]));
  }

  const written = WRITTEN_DATE.exec(value)?.groups;
  if (!written) throw new Error(`Unsupported pickup date format: ${input}`);

  const month = GERMAN_MONTHS[written["month"] ?? ""];
  if (!month) throw new Error(`Unsupported German month in pickup date: ${input}`);

  return isoDate(Number(written["year"]), month, Number(written["day"]));
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/**
 * Keeps every date the API vouches for, then fills the remaining horizon by
 * repeating the nominal cadence. Observed gaps are not always 28 days, so
 * projections drift and are replaced as the source publishes real dates.
 */
export function buildTwelveMonthSchedule(
  rawConfirmedDates: readonly string[],
  today: string,
  horizonDays = 365,
): PickupDate[] {
  const horizon = addDays(today, horizonDays);
  const confirmed = [...new Set(rawConfirmedDates.map(parseSwissGermanDate))]
    .filter((date) => date >= today && date <= horizon)
    .sort();

  const lastConfirmed = confirmed.at(-1);
  if (lastConfirmed === undefined) throw new Error("Mr. Green returned no future pickup dates");

  const result: PickupDate[] = confirmed.map((date) => ({ date, status: "confirmed" }));
  const seen = new Set(confirmed);

  let projected = lastConfirmed;
  while (true) {
    projected = addDays(projected, PROJECTION_CADENCE_DAYS);
    if (projected > horizon) break;
    if (!seen.has(projected)) result.push({ date: projected, status: "projected" });
  }

  return result.sort((a, b) => a.date.localeCompare(b.date));
}

function escapeIcs(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/\n/gu, "\\n").replace(/,/gu, "\\,").replace(/;/gu, "\\;");
}

export function renderIcs(
  dates: readonly PickupDate[],
  config: MrGreenConfig,
  generatedAt = new Date(),
): string {
  const stamp = generatedAt.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//my-super-app//Mr Green Pickup Sync//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const pickup of dates) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${config.eventSource}-${pickup.date}@my-super-app.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${pickup.date.replace(/-/gu, "")}`,
      `DTEND;VALUE=DATE:${addDays(pickup.date, 1).replace(/-/gu, "")}`,
      `SUMMARY:${EVENT_TITLE}`,
      `DESCRIPTION:${escapeIcs(`${SOURCE_PAGE}\nStatus: ${pickup.status}`)}`,
    );
    if (shouldInviteAttendee(pickup)) {
      lines.push(`ATTENDEE;ROLE=REQ-PARTICIPANT:MAILTO:${config.attendeeEmail}`);
    }
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:Mr. Green recycling pickup tomorrow",
      `TRIGGER:-PT${REMINDER_MINUTES_BEFORE / 60}H`,
      "END:VALARM",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR", "");
  return lines.join("\r\n");
}

export type ExistingEvent = {
  id: string;
  date: string;
  hasAttendee: boolean;
};

export type Reconciliation = {
  unchanged: Array<{ eventId: string; date: string }>;
  updates: Array<{ eventId: string; from: string; to: PickupDate }>;
  inserts: PickupDate[];
  deletes: ExistingEvent[];
};

/**
 * Pairs existing events to desired dates, preferring exact date matches so a
 * date that survives is never churned. Leftovers on both sides are paired as
 * moves, and any surplus becomes an insert or a delete.
 *
 * Attendee drift on a matched date is repaired, which is what adds the invite
 * when a projected date is later confirmed, and withdraws it if it reverts.
 */
export function reconcileEvents(
  existing: readonly ExistingEvent[],
  desired: readonly PickupDate[],
): Reconciliation {
  const byDate = new Map<string, ExistingEvent>();
  const surplus: ExistingEvent[] = [];
  for (const event of existing) {
    if (byDate.has(event.date)) surplus.push(event);
    else byDate.set(event.date, event);
  }

  const unchanged: Reconciliation["unchanged"] = [];
  const updates: Reconciliation["updates"] = [];
  const unmatchedDesired: PickupDate[] = [];

  for (const pickup of [...desired].sort((a, b) => a.date.localeCompare(b.date))) {
    const event = byDate.get(pickup.date);
    if (!event) {
      unmatchedDesired.push(pickup);
      continue;
    }
    byDate.delete(pickup.date);
    if (event.hasAttendee === shouldInviteAttendee(pickup)) {
      unchanged.push({ eventId: event.id, date: pickup.date });
    } else {
      updates.push({ eventId: event.id, from: event.date, to: pickup });
    }
  }

  const unmatchedExisting = [...byDate.values(), ...surplus].sort((a, b) => a.date.localeCompare(b.date));
  const moveCount = Math.min(unmatchedExisting.length, unmatchedDesired.length);

  for (let index = 0; index < moveCount; index += 1) {
    const event = unmatchedExisting[index];
    const pickup = unmatchedDesired[index];
    if (!event || !pickup) break;
    updates.push({ eventId: event.id, from: event.date, to: pickup });
  }

  return {
    unchanged,
    updates: updates.sort((a, b) => a.to.date.localeCompare(b.to.date)),
    inserts: unmatchedDesired.slice(moveCount),
    deletes: unmatchedExisting.slice(moveCount),
  };
}

export function googleEventBody(pickup: PickupDate, config: MrGreenConfig) {
  const provenance =
    pickup.status === "projected"
      ? "Projected from the latest confirmed date using a 28-day cadence; verify against the source when newer dates are published."
      : "Confirmed by the Mr. Green pickup-date API.";

  return {
    summary: EVENT_TITLE,
    description: `${SOURCE_PAGE}\nStatus: ${pickup.status}. ${provenance}`,
    start: { date: pickup.date },
    end: { date: addDays(pickup.date, 1) },
    attendees: shouldInviteAttendee(pickup) ? [{ email: config.attendeeEmail }] : [],
    reminders: {
      useDefault: false,
      overrides: [{ method: "popup", minutes: REMINDER_MINUTES_BEFORE }],
    },
    extendedProperties: { private: { source: config.eventSource } },
  };
}
