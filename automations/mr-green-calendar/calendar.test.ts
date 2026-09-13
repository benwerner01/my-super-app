import assert from "node:assert/strict";
import test from "node:test";
import { sameGoogleAccount } from "../../lib/google/oauth.ts";
import {
  buildTwelveMonthSchedule,
  googleEventBody,
  parseSwissGermanDate,
  reconcileEvents,
  renderIcs,
  type MrGreenConfig,
} from "./calendar.ts";

const config: MrGreenConfig = {
  zip: "0000",
  plan: "monthly",
  eventSource: "mr-green-test",
  attendeeEmail: "guest@example.com",
};

test("recognizes dotted Gmail addresses as the same personal account", () => {
  assert.equal(sameGoogleAccount("a.b01@gmail.com", "ab01@gmail.com"), true);
  assert.equal(sameGoogleAccount("a.b01@gmail.com", "a.b01@company.example"), false);
});

test("parses numeric and written Swiss German dates", () => {
  assert.equal(parseSwissGermanDate("06.10.2026"), "2026-10-06");
  assert.equal(parseSwissGermanDate("Montag, 6. Oktober 2026"), "2026-10-06");
  assert.equal(parseSwissGermanDate("6. März 2027"), "2027-03-06");
});

test("keeps API dates confirmed and projects a 28-day cadence to the horizon", () => {
  const dates = buildTwelveMonthSchedule(
    ["18. September 2026", "23. Oktober 2026", "20. November 2026", "18. Dezember 2026"],
    "2026-09-13",
    130,
  );
  assert.deepEqual(dates.slice(0, 4).map((item) => item.status), Array(4).fill("confirmed"));
  assert.deepEqual(dates.slice(4), [{ date: "2027-01-15", status: "projected" }]);
});

test("reconciliation preserves exact dates before pairing moves", () => {
  assert.deepEqual(
    reconcileEvents(
      [
        { id: "a", date: "2026-10-01", hasAttendee: true },
        { id: "b", date: "2026-11-20", hasAttendee: true },
        { id: "c", date: "2026-12-01", hasAttendee: true },
      ],
      [{ date: "2026-10-02", status: "confirmed" }, { date: "2026-11-20", status: "confirmed" }],
    ),
    {
      unchanged: [{ eventId: "b", date: "2026-11-20" }],
      updates: [{ eventId: "a", from: "2026-10-01", to: { date: "2026-10-02", status: "confirmed" } }],
      inserts: [],
      deletes: [{ id: "c", date: "2026-12-01", hasAttendee: true }],
    },
  );
});

test("attendee joins confirmed dates only, and drift on a kept date is repaired", () => {
  const projected = { date: "2027-01-15", status: "projected" as const };
  const confirmed = { date: "2026-09-18", status: "confirmed" as const };

  assert.deepEqual(googleEventBody(projected, config).attendees, []);
  assert.deepEqual(googleEventBody(confirmed, config).attendees, [{ email: config.attendeeEmail }]);
  assert.doesNotMatch(renderIcs([projected], config), /ATTENDEE/);
  assert.match(renderIcs([confirmed], config), /ATTENDEE/);

  const plan = reconcileEvents(
    [
      { id: "stale", date: "2027-01-15", hasAttendee: true },
      { id: "promoted", date: "2026-09-18", hasAttendee: false },
      { id: "settled", date: "2026-10-23", hasAttendee: true },
    ],
    [projected, confirmed, { date: "2026-10-23", status: "confirmed" }],
  );

  assert.deepEqual(plan.unchanged, [{ eventId: "settled", date: "2026-10-23" }]);
  assert.deepEqual(plan.updates.map(({ eventId }) => eventId), ["promoted", "stale"]);
  assert.deepEqual(plan.inserts, []);
  assert.deepEqual(plan.deletes, []);
});

test("calendar representations include provenance, exclusive end and reminder", () => {
  const pickup = { date: "2026-09-18", status: "confirmed" as const };
  const body = googleEventBody(pickup, config);
  assert.deepEqual(body.end, { date: "2026-09-19" });
  assert.deepEqual(body.reminders.overrides, [{ method: "popup", minutes: 360 }]);
  assert.equal(body.extendedProperties.private.source, config.eventSource);

  const ics = renderIcs([pickup], config, new Date("2026-09-13T12:00:00Z"));
  assert.match(ics, /DTSTART;VALUE=DATE:20260918/);
  assert.match(ics, /DTEND;VALUE=DATE:20260919/);
  assert.match(ics, /TRIGGER:-PT6H/);
});
