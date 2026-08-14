/* global chrome */
const NSE_HOME = "https://www.nseindia.com/";
const NSE_PAGE = "https://www.nseindia.com/reports/fii-dii";
const NSE_API = "https://www.nseindia.com/api/fiidiiTradeReact";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36";
const INDEXES = ["NIFTY", "SENSEX", "BANKNIFTY"];
const IMPACT_TYPES = ["Quarterly Results", "Board Meeting"];

const YAHOO = {
  NIFTY: "^NSEI",
  BANKNIFTY: "^NSEBANK",
  SENSEX: "^BSESN",
};

function todayIST() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function daysBetween(fromISO, toISO) {
  const a = new Date(`${fromISO}T00:00:00+05:30`);
  const b = new Date(`${toISO}T00:00:00+05:30`);
  return Math.round((b - a) / 86400000);
}

function istMinutes() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return h * 60 + m;
}

function isCashSessionIST() {
  const mins = istMinutes();
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
}

async function nseJson(url) {
  await fetch(NSE_HOME, { headers: { "User-Agent": UA } });
  await fetch(NSE_PAGE, { headers: { "User-Agent": UA, Referer: NSE_HOME } });
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", Referer: NSE_PAGE },
  });
  if (!r.ok) throw new Error(`NSE ${r.status}`);
  return r.json();
}

function parseNum(v) {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

async function pullFii() {
  const raw = await nseJson(NSE_API);
  const rows = Array.isArray(raw) ? raw : raw?.data || [];
  let fiiNet = null;
  let diiNet = null;
  let date = null;
  for (const row of rows) {
    const cat = String(row.category || row.CAT || "").toUpperCase();
    const net = parseNum(row.netValue || row.net || row.NET);
    date = date || row.date || row.tradedDate;
    if (cat.includes("FII") || cat.includes("FPI")) fiiNet = net;
    if (cat.includes("DII")) diiNet = net;
  }
  return { fiiNet, diiNet, date, at: Date.now() };
}

async function pullYahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`Yahoo ${r.status}`);
  const j = await r.json();
  const meta = j?.chart?.result?.[0]?.meta || {};
  const last = meta.regularMarketPrice ?? meta.previousClose;
  const prev = meta.chartPreviousClose ?? meta.previousClose;
  const chg = last != null && prev ? last - prev : null;
  const pct = chg != null && prev ? (chg / prev) * 100 : null;
  return { last, prev, chg, pct };
}

async function pullSpots() {
  const out = {};
  for (const [idx, sym] of Object.entries(YAHOO)) {
    try {
      out[idx] = await pullYahoo(sym);
    } catch (e) {
      out[idx] = { error: String(e.message || e) };
    }
  }
  out.at = Date.now();
  out.session = isCashSessionIST() ? "open" : "closed";
  return out;
}

async function loadBundled(path) {
  const r = await fetch(chrome.runtime.getURL(path));
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}

async function loadRemote(base, rel) {
  if (!base) return null;
  const url = `${base.replace(/\/$/, "")}/${rel.replace(/^\//, "")}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) return null;
  return r.json();
}

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

async function resolveJson(kind, bundledPath, remoteRel) {
  const s = await storageGet(["adminFiles", "config"]);
  const admin = s.adminFiles || {};
  if (admin[kind]) return { doc: admin[kind], source: "admin-upload" };
  let cfg = s.config;
  if (!cfg) {
    try {
      cfg = await loadBundled("data/config.json");
    } catch {
      cfg = {};
    }
  }
  const remote = await loadRemote(cfg.remoteBase, remoteRel);
  if (remote) return { doc: remote, source: "github" };
  return { doc: await loadBundled(bundledPath), source: "bundled" };
}

function normalizeImpact(doc, index) {
  const events = (doc?.events || [])
    .map((e) => {
      const date = e.date || e.event_date || "";
      const days_remaining = date ? daysBetween(todayIST(), date) : null;
      return {
        name: e.name || e.symbol || "",
        symbol: e.symbol || "",
        date,
        event_type: e.event_type || e.type || "Event",
        weightage: e.weightage != null ? Number(e.weightage) : null,
        days_remaining,
      };
    })
    .filter((e) => e.days_remaining == null || e.days_remaining >= 0)
    .filter((e) => IMPACT_TYPES.includes(e.event_type) || !e.event_type)
    .sort(
      (a, b) =>
        (a.days_remaining ?? 99) - (b.days_remaining ?? 99) ||
        -((a.weightage || 0) - (b.weightage || 0)),
    );
  return { index, events };
}

function holidayStatus(daysAway) {
  if (daysAway === 0) return "today";
  if (daysAway === 1) return "tomorrow";
  if (daysAway <= 6) return "this-week";
  return "upcoming";
}

async function refreshAll() {
  const today = todayIST();
  const holPack = await resolveJson("holidays", "data/holidays.json", "data/holidays.json");
  const econPack = await resolveJson("econ", "data/econ-events.json", "data/econ-events.json");
  const impact = {};
  const impactSource = {};
  for (const idx of INDEXES) {
    const p = await resolveJson(
      `impact-${idx}`,
      `data/index-impact/${idx}.json`,
      `data/index-impact/${idx}.json`,
    );
    impact[idx] = normalizeImpact(p.doc, idx);
    impactSource[idx] = p.source;
  }

  const holidays = (Array.isArray(holPack.doc?.holidays) ? holPack.doc.holidays : [])
    .filter((h) => h.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((h) => {
      const daysAway = daysBetween(today, h.date);
      return { ...h, daysAway, status: holidayStatus(daysAway) };
    });

  const econ = (econPack.doc.events || [])
    .filter((e) => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 20)
    .map((e) => ({ ...e, daysAway: daysBetween(today, e.date) }));

  const pack = {
    today,
    holidays,
    econ,
    impact,
    sources: {
      holidays: holPack.source,
      econ: econPack.source,
      impact: impactSource,
    },
    at: Date.now(),
  };
  try {
    pack.fii = await pullFii();
  } catch (e) {
    pack.fiiError = String(e.message || e);
  }
  try {
    pack.spots = await pullSpots();
  } catch (e) {
    pack.spotsError = String(e.message || e);
  }
  await chrome.storage.local.set({ radar: pack });
  return pack;
}

function armAlarms() {
  chrome.alarms.create("spots", { periodInMinutes: 1 });
  chrome.alarms.create("fii-daily", { periodInMinutes: 180 });
}

chrome.runtime.onInstalled.addListener(() => {
  armAlarms();
  refreshAll().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  armAlarms();
  refreshAll().catch(() => {});
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "fii-daily") {
    refreshAll().catch(() => {});
    return;
  }
  if (a.name === "spots") {
    if (isCashSessionIST()) {
      pullSpots()
        .then(async (spots) => {
          const s = await storageGet(["radar"]);
          const radar = s.radar || {};
          radar.spots = spots;
          await chrome.storage.local.set({ radar });
        })
        .catch(() => {});
    }
  }
});
chrome.runtime.onMessage.addListener((msg, _s, send) => {
  if (msg?.type === "refresh") {
    refreshAll().then(send).catch((e) => send({ error: String(e) }));
    return true;
  }
  return false;
});
