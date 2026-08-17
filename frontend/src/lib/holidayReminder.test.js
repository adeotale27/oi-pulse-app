import assert from "node:assert/strict";
import {
  holidayYearNeeded,
  shouldRemindHolidayCalendar,
} from "./holidayReminder.js";

assert.equal(holidayYearNeeded("2026-08-17"), 2026);
assert.equal(holidayYearNeeded("2026-12-19"), 2026);
assert.equal(holidayYearNeeded("2026-12-20"), 2027);
assert.equal(holidayYearNeeded("2027-01-05"), 2027);

const builtin = [{ date: "2026-01-26" }, { date: "2026-12-25" }];
assert.equal(shouldRemindHolidayCalendar("2026-08-17", builtin), false);
assert.equal(shouldRemindHolidayCalendar("2026-12-20", builtin), true);
assert.equal(shouldRemindHolidayCalendar("2027-01-10", builtin), true);
assert.equal(
  shouldRemindHolidayCalendar("2026-12-20", [...builtin, { date: "2027-01-26" }]),
  false,
);

console.log("holidayReminder.test.js ok");
