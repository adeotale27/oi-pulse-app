import assert from "node:assert/strict";
import { attachDayCapital, classifyDayCapital, leftoverIsCrumbs } from "./capitalGuard.js";

assert.equal(leftoverIsCrumbs(1610, 3_570_000), true);
assert.equal(leftoverIsCrumbs(50_000, 3_570_000), false);

const ok = classifyDayCapital({ bookedPct: -1.2, leftover: 80_000, wallet: 1_000_000 });
assert.equal(ok.level, "ok");
assert.equal(ok.stopSellIdeas, false);

const caution = classifyDayCapital({ bookedPct: -3.4, leftover: 80_000, wallet: 1_000_000 });
assert.equal(caution.level, "caution");
assert.equal(caution.stopSellIdeas, false);

const stop = classifyDayCapital({ bookedPct: -5.1, leftover: 80_000, wallet: 1_000_000 });
assert.equal(stop.level, "stopAdds");
assert.equal(stop.stopSellIdeas, true);

const defend = classifyDayCapital({ bookedPct: -11.05, leftover: 1610, wallet: 3_570_000 });
assert.equal(defend.level, "defend");
assert.equal(defend.stopSellIdeas, true);
assert.match(defend.doLine, /Capital event/i);

const crumbs = classifyDayCapital({ bookedPct: -1, leftover: 1610, wallet: 3_570_000 });
assert.equal(crumbs.level, "stopAdds");
assert.equal(crumbs.crumbs, true);

const merged = attachDayCapital(
  { booked_pnl: -755159, win_rate: 50, trading_days: 30 },
  {
    pnl_today: { booked: -394791, booked_pct: -11.05, booked_after_charges: -394791 },
    funds: { net: 1610, base: 3_570_000 },
  },
);
assert.equal(merged.booked_pnl, -755159);
assert.equal(merged.day_booked_pct, -11.05);
assert.equal(merged.leftover, 1610);
assert.equal(merged.wallet, 3_570_000);

console.log("capitalGuard.test.js ok");
