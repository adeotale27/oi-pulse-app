import assert from "node:assert/strict";
import { safeHttpUrl } from "./safeUrl.js";

assert.equal(safeHttpUrl("javascript:alert(1)"), null);
assert.equal(safeHttpUrl("data:text/html,hi"), null);
assert.ok(String(safeHttpUrl("https://zerodha.com/marketintel")).startsWith("https://zerodha.com/"));
assert.ok(String(safeHttpUrl("http://localhost:3000/x")).includes("localhost"));

console.log("safeUrl.test.js: ok");
