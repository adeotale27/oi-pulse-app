import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TimeframePills from "./TimeframePills";

describe("TimeframePills", () => {
  it("marks the selected timeframe accessibly and uses the strike-filter green", () => {
    const markup = renderToStaticMarkup(
      React.createElement(TimeframePills, { value: 15, onChange: () => {} }),
    );
    const selected = markup.match(/<button[^>]*data-testid="tf-15"[^>]*>/)?.[0] || "";
    const inactive = markup.match(/<button[^>]*data-testid="tf-10"[^>]*>/)?.[0] || "";

    expect(selected).toContain('aria-pressed="true"');
    expect(selected).toContain("from-emerald-600");
    expect(selected).toContain("to-teal-600");
    expect(selected).not.toContain("bg-slate-900");
    expect(inactive).toContain('aria-pressed="false"');
    expect(inactive).toContain("bg-white");
  });
});
