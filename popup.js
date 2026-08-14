/* global chrome */
const INDEXES = ["NIFTY", "SENSEX", "BANKNIFTY"];

function fmtPx(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function relLabel(daysAway) {
  if (daysAway === 0) return "TODAY";
  if (daysAway === 1) return "TOMORROW";
  return `in ${daysAway}d`;
}

function setTone(el, tone) {
  el.classList.remove("red", "amber", "blue");
  if (tone) el.classList.add(tone);
}

function render(pack, index) {
  const spots = pack?.spots || {};
  document.getElementById("spots").innerHTML = INDEXES.map((idx) => {
    const s = spots[idx] || {};
    const cls = s.chg > 0 ? "up" : s.chg < 0 ? "down" : "";
    const sign = s.pct == null ? "" : `${s.pct >= 0 ? "+" : ""}${Number(s.pct).toFixed(2)}%`;
    return `<div class="spot"><b>${idx}</b><div class="${cls}">${fmtPx(s.last)}</div><div class="${cls}">${sign || (s.error || "")}</div></div>`;
  }).join("");
  const session = spots.session === "open" ? "Cash session (live Yahoo 1m)" : "Outside 09:15–15:30 IST — last/previous close";
  document.getElementById("sessionHint").textContent = session;

  document.getElementById("indexChips").innerHTML = INDEXES.map(
    (idx) => `<button type="button" data-idx="${idx}" class="${idx === index ? "on" : ""}">${idx === "BANKNIFTY" ? "BANKNIFTY" : idx}</button>`,
  ).join("");

  const h = (pack?.holidays || [])[0];
  const holEl = document.getElementById("holiday");
  const holTile = document.getElementById("tile-holiday");
  if (!h) {
    holEl.textContent = "No upcoming holiday in JSON";
    setTone(holTile, "");
  } else {
    holEl.textContent = `${relLabel(h.daysAway)} · ${h.name} · ${h.date}`;
    setTone(holTile, h.status === "today" || h.status === "tomorrow" ? "red" : h.status === "this-week" ? "amber" : "");
  }

  const f = pack?.fii;
  document.getElementById("fii").textContent = pack?.fiiError
    ? pack.fiiError
    : f
      ? `${f.date || "—"} · FII ${f.fiiNet ?? "—"} · DII ${f.diiNet ?? "—"}`
      : "No pull yet — Refresh (needs NSE cookies in this browser)";

  const ev = pack?.econ || [];
  const econTile = document.getElementById("tile-econ");
  document.getElementById("econ").innerHTML = ev.length
    ? ev.slice(0, 8).map((e) => {
      const urgent = e.daysAway <= 1 ? "urgent" : "";
      return `<div class="row ${urgent}">${relLabel(e.daysAway)} · ${e.name} (${e.impact || ""})</div>`;
    }).join("")
    : "No upcoming macro events in data/econ-events.json";
  const near = ev[0];
  setTone(econTile, !near ? "" : near.daysAway <= 1 ? "red" : near.daysAway <= 3 ? "amber" : "");

  document.getElementById("impactIdx").textContent = index;
  const impactEv = (pack?.impact?.[index]?.events || []).slice(0, 8);
  const impactTile = document.getElementById("tile-impact");
  document.getElementById("impact").innerHTML = impactEv.length
    ? impactEv.map((e) => {
      const w = e.weightage != null ? ` · ${e.weightage}% wt` : "";
      const d = e.days_remaining != null ? relLabel(e.days_remaining) : (e.date || "");
      return `<div class="row">${d} · ${e.event_type || "Event"} · ${e.name || e.symbol || ""}${w}</div>`;
    }).join("")
    : `No ${index} impact rows. Admin: Options → upload ${index}.json (or commit on GitHub).`;
  const thisWeek = impactEv.some((e) => e.days_remaining != null && e.days_remaining <= 7);
  const nextWeek = impactEv.some((e) => e.days_remaining > 7 && e.days_remaining <= 14);
  setTone(impactTile, thisWeek ? "red" : nextWeek ? "blue" : "");
}

function load() {
  chrome.storage.local.get(["radar", "activeIndex"], (s) => {
    const index = INDEXES.includes(s.activeIndex) ? s.activeIndex : "NIFTY";
    render(s.radar || {}, index);
    document.getElementById("indexChips").onclick = (e) => {
      const idx = e.target?.dataset?.idx;
      if (!idx) return;
      chrome.storage.local.set({ activeIndex: idx }, () => render(s.radar || {}, idx));
    };
  });
}

load();
document.getElementById("refresh").onclick = () => {
  chrome.runtime.sendMessage({ type: "refresh" }, () => load());
};
