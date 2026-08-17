import {
  evaluateUploadFreshness,
  isUploadStale,
  uploadAgeDays,
  UPLOAD_FRESHNESS,
} from "./uploadFreshness.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const now = new Date("2026-08-09T12:00:00+05:30");

assert(UPLOAD_FRESHNESS.events.staleAfterDays === 15, "events threshold");
assert(UPLOAD_FRESHNESS.holidays.staleAfterDays === 365, "holidays threshold");
assert(UPLOAD_FRESHNESS.nifty50.staleAfterDays === 30, "nifty threshold");

assert(uploadAgeDays(null, now) === null, "null age");
assert(uploadAgeDays("2026-08-09T06:00:00+05:30", now) === 0, "same day");
assert(uploadAgeDays("2026-07-25T06:00:00+05:30", now) === 15, "15 days");
assert(uploadAgeDays("2026-07-10T06:00:00+05:30", now) === 30, "30 days");

assert(isUploadStale("events", "2026-07-25T06:00:00+05:30", now) === true, "events stale at 15");
assert(isUploadStale("events", "2026-07-26T06:00:00+05:30", now) === false, "events fresh at 14");
assert(isUploadStale("nifty50", "2026-07-10T06:00:00+05:30", now) === true, "constituents stale at 30");
assert(isUploadStale("nifty50", "2026-07-11T06:00:00+05:30", now) === false, "constituents fresh at 29");
assert(isUploadStale("events", null, now) === true, "never uploaded is stale");

const rows = evaluateUploadFreshness(
  {
    events: { uploaded_at: "2026-07-20T00:00:00Z" },
    nifty50: { uploaded_at: "2026-08-01T00:00:00Z" },
    banknifty: {},
    sensex: { uploaded_at: "2026-08-08T00:00:00Z" },
  },
  now,
);
assert(rows.find((r) => r.key === "events")?.stale === true, "eval events");
assert(rows.find((r) => r.key === "banknifty")?.never === true, "eval never");
assert(rows.filter((r) => r.stale).length >= 2, "multiple stale");

console.log("uploadFreshness tests ok");
