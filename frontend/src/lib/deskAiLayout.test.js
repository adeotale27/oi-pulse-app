import assert from "node:assert/strict";
import { buildSessionBrief, findEvidenceConflicts, firstSentence, formatEvidenceAsOf, formatSessionDate, parseGuideSections } from "./deskAiLayout.js";

assert.ok(!/^Session focus/i.test(firstSentence("Session focus NIFTY (Mon–Tue).\nNIFTY · call writers · PCR 0.71")));
assert.match(firstSentence("Session focus NIFTY.\nNIFTY · call writers · PCR 0.71"), /call writers/);
assert.match(firstSentence("DO\n  Capital event: booked -11.05% of wallet. Stop the day."), /Capital event/);

const g = parseGuideSections(`TAPE
  NIFTY PCR 0.71
DO
  Hold CE shorts with the call-writer tape
  Theta still paying
DON'T
  Do not add PE shorts
  VIX 19 — size down
`);
assert.equal(g.do[0], "Hold CE shorts with the call-writer tape");
assert.ok(g.dont.some((s) => /PE shorts/i.test(s)));

const scenarios = parseGuideSections(`BASE CASE
- Hold only if the deterministic band remains unchanged
GAP UP
- If the open gaps higher, reassess close call shorts
GAP DOWN
- If the open gaps lower, review put-side short risk
REASSESS IF
- GIFT proxy moves sharply before the open
CONTRARY CASE
- Outside tape contradicts the session OI
WATCH NEXT
- Check live data before the open
DO
- Keep risk defined
DON'T
- Add new overnight shorts
`);
assert.match(scenarios.scenarios.baseCase[0], /deterministic band/);
assert.match(scenarios.scenarios.gapUp[0], /gaps higher/);
assert.match(scenarios.scenarios.gapDown[0], /gaps lower/);
assert.match(scenarios.scenarios.reassessIf[0], /GIFT proxy/);
assert.match(scenarios.scenarios.contraryCase[0], /contradicts/);
assert.match(scenarios.scenarios.watchNext[0], /live data/);
assert.equal(scenarios.do[0], "Keep risk defined");
assert.equal(scenarios.dont[0], "Add new overnight shorts");
assert.equal(formatEvidenceAsOf("not a timestamp"), "time unavailable");
assert.match(formatSessionDate("2026-09-29"), /29.*2026/);
assert.equal(formatSessionDate("2026-99-99"), "2026-99-99");

const openingBrief = buildSessionBrief({
  market: { phase: "pre_market", session_anchor_date: "2026-09-29" },
  extras: {
    gift_nifty: {
      change_pct: -0.42,
      source: "kite",
      ts: "2026-09-29T08:58:00+05:30",
    },
  },
  outside: {
    corporate: [{ symbol: "RELIANCE", event_type: "board meeting", days: 0, weightage: 8.2 }],
    news: [{ title: "Published headline", source: "ET", published: "Tue, 29 Sep 2026 08:30:00 +0530" }],
  },
});
assert.equal(openingBrief.title, "Before-open brief");
assert.match(openingBrief.items[0].text, /-0\.42% vs its previous close/);
assert.equal(openingBrief.items[0].source, "kite");
assert.equal(openingBrief.items[1].source, "NSE corporate calendar");
assert.match(openingBrief.items[2].text, /Published headline/);

const closeout = buildSessionBrief({
  market: { phase: "post_close", session_anchor_date: "2026-09-29" },
  oi: [{ idx: "NIFTY", pcr: 0.94, ceChg: 100000, peChg: -200, asOf: "2026-09-29T15:40:00+05:30", dataStatus: "LIVE" }],
  journal: { day_booked_pct: -1.25 },
});
assert.equal(closeout.title, "Session closeout");
assert.ok(closeout.items.some((item) => item.source === "OI snapshot"));
assert.ok(closeout.items.some((item) => /Put-to-call OI ratio \(PCR\): 0\.94/.test(item.text)));
assert.ok(closeout.items.some((item) => /Call OI change: 1,00,000/.test(item.text)));
assert.ok(closeout.items.some((item) => item.status === "LIVE"));
assert.ok(closeout.items.some((item) => /Put OI change: -200/.test(item.text)));
assert.ok(closeout.items.some((item) => /-1\.25%/.test(item.text)));
assert.ok(closeout.items.some((item) => /records are connected/.test(item.text)));
assert.equal(buildSessionBrief({ market: null }), null);
assert.equal(formatEvidenceAsOf("1790000000"), formatEvidenceAsOf(1_790_000_000));

const disagreement = findEvidenceConflicts({
  extras: { gift_nifty: { change_pct: 0.4, source: "kite", ts: "2026-09-29T08:58:00+05:30" } },
  outside: { at: 1_790_000_000, breadth: { NIFTY: { adv: 12, dec: 30 } } },
});
assert.equal(disagreement.length, 1);
assert.match(disagreement[0].text, /Mixed direction/);
assert.equal(findEvidenceConflicts({
  extras: { gift_nifty: { change_pct: 0.4 } },
  outside: { breadth: { NIFTY: { adv: 30, dec: 12 } } },
}).length, 0);

console.log("deskAiLayout.test.js: ok");
