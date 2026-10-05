import { isChunkLoadError, recoverFromChunkLoad } from "@/lib/errorLog";

describe("recoverFromChunkLoad", () => {
  beforeEach(() => {
    sessionStorage.clear();
    jest.useFakeTimers();
    jest.setSystemTime(Date.now() + 61_000);
  });

  afterEach(() => {
    jest.useRealTimers();
    window.history.replaceState({}, "", "/");
  });

  it("schedules only one reload for stale chunks on the public walkthrough", () => {
    window.history.replaceState({}, "", "/sitewalkthrough");

    recoverFromChunkLoad("ChunkLoadError: Loading chunk src_pages_Dashboard_jsx failed.");
    recoverFromChunkLoad("ChunkLoadError: Loading chunk src_pages_Header_jsx failed.");

    expect(Number(sessionStorage.getItem("oi_chunk_reload_once"))).toBeGreaterThan(0);
    expect(jest.getTimerCount()).toBe(1);
  });

  it.each([
    "Loading chunk 374 failed.",
    "Loading CSS chunk 350 failed.",
    "Failed to fetch dynamically imported module",
  ])("recognizes stale asset errors: %s", (message) => {
    expect(isChunkLoadError(message)).toBe(true);
  });

  it("allows a fresh retry after the reload cooldown expires", () => {
    jest.setSystemTime(Date.now() + 61_000);
    recoverFromChunkLoad("Loading chunk 374 failed.");
    jest.setSystemTime(Date.now() + 60_001);

    recoverFromChunkLoad("Loading CSS chunk 350 failed.");

    expect(Number(sessionStorage.getItem("oi_chunk_reload_once"))).toBeGreaterThan(Date.now() - 1000);
    expect(jest.getTimerCount()).toBe(2);
  });

  it("does not reload for unrelated display errors", () => {
    recoverFromChunkLoad("Cannot read properties of undefined");

    expect(sessionStorage.getItem("oi_chunk_reload_once")).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });
});
