import { useEffect, useRef, useState } from "react";

// Deterministic-ish random walk that FEELS like a live options terminal.
// Clearly a DEMO feed (never presented as real market data).

const INDEX_SEED = {
  NIFTY: { price: 25842.3, step: 6, atmStep: 50, lot: 25 },
  BANKNIFTY: { price: 56374.2, step: 14, atmStep: 100, lot: 15 },
  SENSEX: { price: 84928.6, step: 18, atmStep: 100, lot: 10 },
};

function round(n, d = 2) {
  const p = Math.pow(10, d);
  return Math.round(n * p) / p;
}

function buildChain(price, atmStep) {
  const atm = Math.round(price / atmStep) * atmStep;
  const rows = [];
  for (let i = -4; i <= 4; i++) {
    const strike = atm + i * atmStep;
    // OI shaped like a smile — more OI away from ATM on the writing side.
    const dist = Math.abs(i);
    const ceBase = 40000 + (i >= 0 ? dist * 22000 : dist * 6000) + Math.random() * 9000;
    const peBase = 40000 + (i <= 0 ? dist * 22000 : dist * 6000) + Math.random() * 9000;
    rows.push({
      strike,
      atm: strike === atm,
      ce_oi: Math.round(ceBase),
      pe_oi: Math.round(peBase),
      ce_chg: Math.round((Math.random() - 0.45) * 14000),
      pe_chg: Math.round((Math.random() - 0.45) * 14000),
    });
  }
  return { atm, rows };
}

export function isMarketOpenNow(date = new Date()) {
  const ist = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const day = ist.getDay();
  const minutes = ist.getHours() * 60 + ist.getMinutes();
  return day >= 1 && day <= 5 && minutes >= 555 && minutes <= 940;
}

export default function useLiveDemo(intervalMs = 1500, animate = true) {
  const [snap, setSnap] = useState(() => makeSnapshot(seedState()));
  const stateRef = useRef(seedState());

  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
    if (reduce || !animate) return undefined;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const s = stateRef.current;
      Object.keys(s.indices).forEach((k) => {
        const seed = INDEX_SEED[k];
        const drift = (Math.random() - 0.5) * seed.step * 2;
        s.indices[k].price = round(Math.max(seed.price * 0.9, s.indices[k].price + drift), 2);
        s.indices[k].changePct = round(((s.indices[k].price - seed.price) / seed.price) * 100, 2);
      });
      s.pcr = round(Math.min(1.6, Math.max(0.55, s.pcr + (Math.random() - 0.5) * 0.06)), 2);
      s.pressure = Math.min(96, Math.max(8, Math.round(s.pressure + (Math.random() - 0.5) * 9)));
      s.positions = s.positions.map((p) => {
        const move = (Math.random() - 0.48) * (p.ltp * 0.03);
        const ltp = round(Math.max(1, p.ltp + move), 2);
        const pnl = Math.round((p.side === "SHORT" ? p.entry - ltp : ltp - p.entry) * p.qty);
        return { ...p, ltp, pnl };
      });
      s.oiTick = (s.oiTick + 1) % 6;
      if (s.oiTick === 0) s.chain = buildChain(s.indices.NIFTY.price, INDEX_SEED.NIFTY.atmStep);
      setSnap(makeSnapshot(s));
    };
    const id = setInterval(tick, intervalMs);
    return () => { alive = false; clearInterval(id); };
  }, [intervalMs, animate]);

  return snap;
}

function seedState() {
  const indices = {};
  Object.entries(INDEX_SEED).forEach(([k, v]) => {
    indices[k] = { price: v.price, changePct: 0.4 };
  });
  return {
    indices,
    pcr: 0.92,
    pressure: 62,
    oiTick: 0,
    chain: buildChain(INDEX_SEED.NIFTY.price, INDEX_SEED.NIFTY.atmStep),
    positions: [
      { sym: "NIFTY 25900 CE", side: "SHORT", qty: 50, entry: 142, ltp: 96 },
      { sym: "NIFTY 25800 PE", side: "SHORT", qty: 50, entry: 118, ltp: 104 },
      { sym: "BANKNIFTY 56000 CE", side: "LONG", qty: 15, entry: 210, ltp: 268 },
    ],
  };
}

function makeSnapshot(s) {
  return {
    indices: {
      NIFTY: { ...s.indices.NIFTY },
      BANKNIFTY: { ...s.indices.BANKNIFTY },
      SENSEX: { ...s.indices.SENSEX },
    },
    pcr: s.pcr,
    pressure: s.pressure,
    chain: s.chain,
    positions: s.positions.map((p) => ({ ...p })),
    totalPnl: s.positions.reduce((a, p) => a + (p.pnl || 0), 0),
    oiTick: s.oiTick,
  };
}
