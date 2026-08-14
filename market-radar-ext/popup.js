/* global chrome */
function todayIST() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function nextHoliday(list) {
  const t = todayIST();
  return (list || []).filter((h) => h.date >= t).sort((a, b) => a.date.localeCompare(b.date))[0] || null;
}

function render(pack) {
  const h = nextHoliday(pack?.holidays);
  document.getElementById("holiday").textContent = h
    ? `${h.date} · ${h.name}`
    : "No upcoming holiday in bundle";
  const f = pack?.fii;
  document.getElementById("fii").textContent = pack?.fiiError
    ? pack.fiiError
    : f
      ? `${f.date || "—"} · FII ${f.fiiNet ?? "—"} · DII ${f.diiNet ?? "—"}`
      : "No pull yet";
  const v = pack?.vix?.last;
  document.getElementById("vix").textContent = pack?.vixError
    ? pack.vixError
    : v != null
      ? Number(v).toFixed(2)
      : "No pull yet";
  const ev = pack?.results?.events || [];
  document.getElementById("results").textContent = pack?.results?.skipped
    ? "Optional: set Pulse API in Options to reuse your existing /api/events (no new server)."
    : ev.length
      ? ev.map((e) => `${e.date || ""} ${e.index} ${e.name}`).join("\n")
      : (pack?.resultsError || "No events");
}

chrome.storage.local.get("radar", (s) => render(s.radar || {}));
document.getElementById("refresh").onclick = () => {
  chrome.runtime.sendMessage({ type: "refresh" }, (pack) => render(pack || {}));
};
