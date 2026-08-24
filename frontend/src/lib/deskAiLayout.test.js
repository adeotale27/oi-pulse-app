import assert from "node:assert/strict";
import { firstSentence, parseGuideSections } from "./deskAiLayout.js";

assert.ok(!/^Session focus/i.test(firstSentence("Session focus NIFTY (Mon–Tue).\nNIFTY · call writers · PCR 0.71")));
assert.match(firstSentence("Session focus NIFTY.\nNIFTY · call writers · PCR 0.71"), /call writers/);

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

console.log("deskAiLayout.test.js: ok");
