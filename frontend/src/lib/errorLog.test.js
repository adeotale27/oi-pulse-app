import assert from "node:assert/strict";
import { reportDeskError } from "./errorLog.js";

assert.equal(typeof reportDeskError, "function");
reportDeskError({ message: "unit-test-skip-if-no-window" });
console.log("errorLog.test.js: ok");
