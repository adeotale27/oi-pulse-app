import assert from "node:assert/strict";
import { journalSavePayload, resolveJournalSaveDoc } from "./journalSave.js";

const current = {
  date: "2026-08-13",
  went_well: "good day",
  went_wrong: "",
  notes: "",
  tags: ["Expiry", "SENSEX", "Theta", "Plan followed"],
  rating: null,
  followed_plan: false,
};

const clickEvent = { type: "click", target: {}, preventDefault() {}, date: undefined };
assert.equal(
  resolveJournalSaveDoc(clickEvent, current),
  current,
  "Save button click event must not replace the day doc",
);

const rated = { ...current, rating: 4 };
assert.equal(resolveJournalSaveDoc(rated, current).rating, 4);

assert.equal(resolveJournalSaveDoc(null, current), current);
assert.equal(resolveJournalSaveDoc(undefined, current), current);

const payload = journalSavePayload(resolveJournalSaveDoc(clickEvent, current));
assert.equal(payload.day, "2026-08-13");
assert.equal(payload.body.went_well, "good day");
assert.deepEqual(payload.body.tags, ["Expiry", "SENSEX", "Theta", "Plan followed"]);
assert.equal(payload.body.followed_plan, false);

assert.equal(journalSavePayload({ went_well: "x" }), null);
assert.equal(journalSavePayload({ date: "13-08-2026" }), null);

console.log("journalSave.test.js ok");
