import { isOiPolling } from "./marketTimes";

describe("isOiPolling", () => {
  it("allows OI requests only when the server explicitly enables polling", () => {
    expect(isOiPolling({ is_oi_polling: true })).toBe(true);
    expect(isOiPolling({ is_oi_polling: false })).toBe(false);
    expect(isOiPolling({})).toBe(false);
    expect(isOiPolling(null)).toBe(false);
  });

  it("accepts the nested dashboard status shape", () => {
    expect(isOiPolling({ market: { is_oi_polling: true } })).toBe(true);
  });
});
