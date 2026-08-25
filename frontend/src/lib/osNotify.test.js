import assert from "node:assert/strict";
import { osNotificationOptions, shouldShowOsNotification } from "./osNotify.js";

assert.equal(shouldShowOsNotification({ hidden: true, hasFocus: () => true }), true);
assert.equal(shouldShowOsNotification({ hidden: false, hasFocus: () => false }), true);
assert.equal(shouldShowOsNotification({ hidden: false, hasFocus: () => true, visibilityState: "hidden" }), true);
assert.equal(shouldShowOsNotification(null), false);

const live = osNotificationOptions("OI reversal on NIFTY");
assert.equal(live.silent, false);
assert.equal(live.requireInteraction, true);
assert.equal(live.renotify, true);
assert.equal(live.icon, "/logo192.png");
assert.equal(live.tag.startsWith("striklenz-alert"), true);
assert.equal(live.body, "OI reversal on NIFTY");

const ping = osNotificationOptions("test", { force: true });
assert.equal(ping.tag, "striklenz-notif-test");
assert.equal(ping.silent, false);

console.log("osNotify.test.js: ok");
