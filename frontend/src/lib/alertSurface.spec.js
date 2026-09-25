import { beforeEach, describe, expect, test } from "@jest/globals";
import { flushHiddenAlerts, surfaceAlert } from "./alertSurface.js";

describe("alert surfaces", () => {
  let events;
  let toast;
  let toastCalls;

  beforeEach(() => {
    events = [];
    toastCalls = 0;
    toast = () => { toastCalls += 1; };
    window.dispatchEvent = (event) => {
      events.push(event);
      return true;
    };
    document.hidden = false;
    window.matchMedia = () => ({ matches: false });
  });

  test("uses desktop toast when the viewport is not mobile", () => {
    expect(surfaceAlert({ toastFn: toast, title: "Desktop alert" })).toBe("shown");
    expect(toastCalls).toBe(1);
    expect(events).toHaveLength(0);
  });

  test("dispatches a mobile event for mobile viewports", () => {
    window.matchMedia = () => ({ matches: true });

    expect(surfaceAlert({ toastFn: toast, title: "Mobile alert" })).toBe("shown");
    expect(events.at(-1).type).toBe("oi-mobile-alert");
    expect(events.at(-1).detail.title).toBe("Mobile alert");
  });

  test("queues hidden alerts and flushes them when visible", () => {
    document.hidden = true;
    expect(surfaceAlert({ toastFn: toast, title: "Hidden alert" })).toBe("queued");

    document.hidden = false;
    expect(flushHiddenAlerts({ toast })).toBe(1);
    expect(toastCalls).toBe(1);
  });
});
