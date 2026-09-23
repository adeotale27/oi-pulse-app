import React from "react";
import ProductScreen from "@/components/landing/ProductScreen";

export default function BrowserMock({ id = "dashboard", snap, title = "Striklenz Terminal", className = "", bodyClassName = "" }) {
  return (
    <div className={`slz-browser ${className}`}>
      <div className="slz-browser-bar">
        <span className="slz-dot" style={{ background: "#ff5f57" }} />
        <span className="slz-dot" style={{ background: "#febc2e" }} />
        <span className="slz-dot" style={{ background: "#28c840" }} />
        <span className="slz-url slz-mono">🔒 striklenz.com/terminal</span>
        <span className="text-[10px] font-semibold text-emerald-400">LIVE DEMO</span>
      </div>
      <div className={`slz-screen-body ${bodyClassName}`}>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-300">{title}</span>
          <span className="slz-chip" style={{ background: "rgba(16,185,129,0.14)", color: "#6ee7b7" }}><span className="slz-live-dot" /> LIVE</span>
        </div>
        <ProductScreen id={id} snap={snap} />
      </div>
    </div>
  );
}
