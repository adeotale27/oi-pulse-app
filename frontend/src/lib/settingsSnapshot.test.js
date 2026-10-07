import assert from "node:assert/strict";
import { countChangedSettings, settingsSnapshot } from "./settingsSnapshot.js";
import { saveOISettings } from "./oiSettings.js";

assert.equal(
  settingsSnapshot({ pages: ["oi-change"], poll: { positions: 2, oi: 15 } }),
  settingsSnapshot({ poll: { oi: 15, positions: 2 }, pages: ["oi-change"] }),
);
assert.notEqual(
  settingsSnapshot({ pages: ["oi-change"] }),
  settingsSnapshot({ pages: ["oi-change", "positions"] }),
);
assert.notEqual(settingsSnapshot({ interval: 2 }), settingsSnapshot({ interval: 5 }));
assert.equal(
  countChangedSettings(
    { pages: ["oi-change", "positions"], poll: 2, untouched: true },
    { pages: ["oi-change"], poll: 2, untouched: true },
  ),
  1,
);
assert.equal(
  countChangedSettings({ thresholds: { gamma: 5 } }, { thresholds: { gamma: 2 } }),
  1,
);
assert.equal(
  countChangedSettings(
    { threshold: 15, cooldown: 120, enabled: ["NIFTY"] },
    { threshold: 10, cooldown: 120, enabled: ["NIFTY", "SENSEX"] },
  ),
  2,
);
assert.equal(countChangedSettings({ threshold: 10 }, { threshold: 10 }), 0);
assert.equal(
  countChangedSettings({ threshold: 10, lotSize: { NIFTY: 65 } }, { threshold: 10, lotSize: { NIFTY: 50 } }, ["lotSize"]),
  0,
);

const originalStorage = globalThis.localStorage;
globalThis.localStorage = { setItem() {} };
assert.equal(saveOISettings({ threshold: 10 }), true);
globalThis.localStorage = {
  setItem() {
    throw new Error("storage unavailable");
  },
};
assert.equal(saveOISettings({ threshold: 10 }), false);
if (originalStorage === undefined) delete globalThis.localStorage;
else globalThis.localStorage = originalStorage;

console.log("settingsSnapshot.test.js ok");
