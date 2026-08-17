import assert from "node:assert/strict";
import { optionSide, optionSideLabel } from "./optionSide.js";

assert.equal(optionSide({ side: "CE" }), "CE");
assert.equal(optionSide({ side: "PE" }), "PE");
assert.equal(optionSide({ tradingsymbol: "NIFTY2581424050CE" }), "CE");
assert.equal(optionSide({ display_name: "NIFTY 18TH AUG 24050 PE" }), "PE");
assert.equal(optionSide({ tradingsymbol: "NIFTY25AUGFUT" }), null);
assert.equal(optionSideLabel("CE"), "CALL");
assert.equal(optionSideLabel("PE"), "PUT");
console.log("optionSide.test.js ok");
