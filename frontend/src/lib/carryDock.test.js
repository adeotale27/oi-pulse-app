import assert from "node:assert/strict";
import { clampCarryLeft, snapCarryLeft, snapDockFromClientX, normalizeCarryDockSide } from "./carryDock.js";

assert.equal(normalizeCarryDockSide(undefined), "left");
assert.equal(snapDockFromClientX(40, 900), "left");
assert.equal(snapDockFromClientX(450, 900), "center");
assert.equal(snapDockFromClientX(800, 900), "right");
assert.equal(clampCarryLeft(0, 800, 400), 8);
assert.equal(snapCarryLeft("left", 800, 400), 12);
assert.ok(snapCarryLeft("center", 800, 400) > 100);
assert.ok(snapCarryLeft("right", 800, 400) > 300);

console.log("carryDock.test.js ok");
