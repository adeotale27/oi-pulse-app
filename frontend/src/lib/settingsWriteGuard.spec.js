import { settingsAreWritable } from "./settingsWriteGuard";

describe("settingsAreWritable", () => {
  it("allows server settings writes only after a successful settings load", () => {
    expect(settingsAreWritable({ loaded: true, error: "" })).toBe(true);
    expect(settingsAreWritable({ loaded: false, error: "" })).toBe(false);
    expect(settingsAreWritable({ loaded: true, error: "database unavailable" })).toBe(false);
  });
});
