import assert from "node:assert/strict";
import { heatmapLabel, openHeatmapRows } from "./positionHeatmap.js";

assert.equal(heatmapLabel({ strike: 24800, side: "PE" }), "24800 PE");
assert.equal(
  heatmapLabel({ display_name: "SENSEX 14 AUG 24800 PE" }),
  "24800 PE",
);
assert.equal(
  heatmapLabel({ tradingsymbol: "NIFTY2581424500CE", strike: 24500, side: "CE" }),
  "24500 CE",
);

const rows = [
  { tradingsymbol: "A", index: "SENSEX", exited: true, quantity: 0, booked_pnl: -20 },
  { tradingsymbol: "B", index: "NIFTY", exited: false, quantity: -75, pnl: 100 },
  { tradingsymbol: "C", index: "SENSEX", exited: false, quantity: -10, pnl: 50 },
];
assert.deepEqual(
  openHeatmapRows(rows, "NIFTY").map((r) => r.tradingsymbol),
  ["B"],
);
assert.equal(openHeatmapRows([{ tradingsymbol: "SENSEX24800PE", index: "", exited: false, quantity: -10 }], "NIFTY").length, 0);
assert.equal(openHeatmapRows([{ tradingsymbol: "SENSEX24800PE", index: "", exited: false, quantity: -10 }], "SENSEX").length, 1);
assert.equal(openHeatmapRows([{ tradingsymbol: "GOLD26AUG76000CE", index: "GOLD", exited: false, quantity: -1 }], "GOLD").length, 1);
assert.equal(openHeatmapRows([{ tradingsymbol: "GOLD26AUG76000CE", index: "GOLD", exited: false, quantity: -1 }], "NIFTY").length, 0);

console.log("positionHeatmap.test.js: ok");
