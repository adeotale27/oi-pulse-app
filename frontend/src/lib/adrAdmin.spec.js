import { getAdrPollFeedback, isPositiveAdrThreshold } from "./adrAdmin";

describe("ADR admin feedback and threshold validation", () => {
  it("reports rejected polls as errors instead of success", () => {
    expect(getAdrPollFeedback({ ok: false, reason: "rate_limited" })).toEqual({
      tone: "error",
      message: "ADR poll failed: rate_limited",
    });
  });

  it("reports a closed market as a skipped poll", () => {
    expect(getAdrPollFeedback({ ok: true, reason: "markets_closed" })).toEqual({
      tone: "message",
      message: "ADR poll skipped: US markets are closed.",
    });
  });

  it("reports completed poll counts", () => {
    expect(getAdrPollFeedback({ ok: true, stored: 4, failed: 1 })).toEqual({
      tone: "success",
      message: "ADR poll completed: 4 stored, 1 failed.",
    });
  });

  it("accepts only finite positive thresholds", () => {
    expect(isPositiveAdrThreshold(0.1)).toBe(true);
    expect(isPositiveAdrThreshold(0)).toBe(false);
    expect(isPositiveAdrThreshold(-0.1)).toBe(false);
    expect(isPositiveAdrThreshold("")).toBe(false);
    expect(isPositiveAdrThreshold(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
