import assert from "node:assert/strict";
import { normalizeCarryDockSide, snapDockFromClientX } from "./carryDock.js";

assert.equal(normalizeCarryDockSide(undefined), "left");
assert.equal(normalizeCarryDockSide("left"), "left");
assert.equal(normalizeCarryDockSide("right"), "right");
assert.equal(normalizeCarryDockSide("bogus"), "left");

assert.equal(snapDockFromClientX(40, 800), "left");
assert.equal(snapDockFromClientX(700, 800), "right");
assert.equal(snapDockFromClientX(400, 800), "right");
assert.equal(snapDockFromClientX(399, 800), "left");

console.log("carryDock.test.js ok");
