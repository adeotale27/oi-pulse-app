import assert from "node:assert/strict";
import { BOOT_VISIBLE_PAGES, HOME_PAGE, pageAllowed, sanitizePageList } from "./dashboardPages.js";

assert.equal(HOME_PAGE, "oi-change");
assert.deepEqual(BOOT_VISIBLE_PAGES, ["oi-change"]);

assert.equal(pageAllowed("oi-change", { pagesReady: false, visiblePages: ["straddle", "cas"] }), true);
assert.equal(pageAllowed("straddle", { pagesReady: false, visiblePages: ["straddle", "cas"] }), false);
assert.equal(pageAllowed("adrs", { pagesReady: false, isAdmin: true, adminPages: ["oi-change", "adrs"] }), false);

assert.equal(pageAllowed("adrs", { pagesReady: true, visiblePages: ["oi-change", "adrs"] }), true);
assert.equal(pageAllowed("straddle", { pagesReady: true, visiblePages: ["oi-change"] }), false);
assert.equal(pageAllowed("cas", { pagesReady: true, isAdmin: true, adminPages: ["oi-change", "cas"] }), true);
assert.equal(pageAllowed("cas", { pagesReady: true, isAdmin: false, visiblePages: ["oi-change"] }), false);
assert.equal(pageAllowed("holidays", { pagesReady: false, visiblePages: ["oi-change"] }), false);
assert.equal(pageAllowed("holidays", { pagesReady: true, visiblePages: ["oi-change"] }), false);
assert.equal(pageAllowed("holidays", { pagesReady: true, visiblePages: ["oi-change", "holidays"] }), true);
assert.equal(pageAllowed("holidays", { pagesReady: true, isAdmin: true, adminPages: ["oi-change"] }), false);
assert.equal(pageAllowed("index-events", { pagesReady: true, visiblePages: ["oi-change"] }), false);

assert.deepEqual(sanitizePageList(null), ["oi-change"]);
assert.deepEqual(sanitizePageList([]), ["oi-change"]);
assert.deepEqual(sanitizePageList(["adrs", "oi-change"]), ["adrs", "oi-change"]);

console.log("dashboardPages.test.js ok");
