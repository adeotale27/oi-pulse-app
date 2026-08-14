/* global chrome */
const NSE_HOME = "https://www.nseindia.com/";
const NSE_PAGE = "https://www.nseindia.com/reports/fii-dii";
const NSE_API = "https://www.nseindia.com/api/fiidiiTradeReact";
const VIX_URL = "https://query1.finance.yahoo.com/v8/finance/chart/%5EINDIAVIX?interval=1d&range=5d";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36";

async function nseJson(url) {
  await fetch(NSE_HOME, { headers: { "User-Agent": UA } });
  await fetch(NSE_PAGE, { headers: { "User-Agent": UA, Referer: NSE_HOME } });
  const r = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      Referer: NSE_PAGE,
    },
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

async function pullVix() {
  const r = await fetch(VIX_URL, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`VIX ${r.status}`);
  const j = await r.json();
  const meta = j?.chart?.result?.[0]?.meta || {};
  const px = meta.regularMarketPrice ?? meta.previousClose;
  return { last: px != null ? Number(px) : null, at: Date.now() };
}

async function pullPulseResults() {
  const { pulseApi } = await chrome.storage.sync.get("pulseApi");
  const base = String(pulseApi || "").replace(/\/$/, "");
  if (!base) return { skipped: true };
  const idx = ["NIFTY", "SENSEX", "BANKNIFTY"];
  const out = [];
  for (const i of idx) {
    try {
      const r = await fetch(`${base}/api/events/${i}`);
      if (!r.ok) continue;
      const j = await r.json();
      for (const e of (j.events || []).slice(0, 6)) {
        out.push({ index: i, name: e.name, date: e.date, weightage: e.weightage });
      }
    } catch {
      /* ignore */
    }
  }
  return { events: out.slice(0, 12), at: Date.now() };
}

async function refreshAll() {
  const holidaysUrl = chrome.runtime.getURL("data/holidays.json");
  const holidays = await (await fetch(holidaysUrl)).json();
  const pack = { holidays: holidays.holidays || [], error: null, at: Date.now() };
  try {
    pack.fii = await pullFii();
  } catch (e) {
    pack.fiiError = String(e.message || e);
  }
  try {
    pack.vix = await pullVix();
  } catch (e) {
    pack.vixError = String(e.message || e);
  }
  try {
    pack.results = await pullPulseResults();
  } catch (e) {
    pack.resultsError = String(e.message || e);
  }
  await chrome.storage.local.set({ radar: pack });
  return pack;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("radar", { periodInMinutes: 60 });
  refreshAll().catch(() => {});
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "radar") refreshAll().catch(() => {});
});
chrome.runtime.onMessage.addListener((msg, _s, send) => {
  if (msg?.type === "refresh") {
    refreshAll().then(send).catch((e) => send({ error: String(e) }));
    return true;
  }
  return false;
});
