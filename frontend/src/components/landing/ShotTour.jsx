import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause } from "lucide-react";
import ShotFrame from "@/components/landing/ShotFrame";
import ProductScreen from "@/components/landing/ProductScreen";

// Real product screenshots (from the live terminal) + a couple of live text
// panels where a static crop wouldn't convey the interaction.
const SLIDES = [
  { id: "terminal", type: "shot", src: "/shots/terminal-full.jpg", label: "Full Terminal", title: "Market Dashboard" },
  { id: "oi", type: "shot", src: "/shots/oi-change.png", label: "OI Change", title: "NIFTY / SENSEX · OI Change", chip: "SENSEX" },
  { id: "positions", type: "shot", src: "/shots/positions.png", label: "Positions", title: "Live Positions", chip: "SENSEX", noChip: true },
  { id: "longshort", type: "shot", src: "/shots/longshort-oi.png", label: "Long / Short on OI", title: "Positions on the OI wall", chip: "SENSEX" },
  { id: "brain", type: "panel", screen: "brain", label: "Position Brain", title: "Position Brain" },
  { id: "deskai", type: "panel", screen: "deskai", label: "Desk AI", title: "Desk AI" },
];

export default function ShotTour({ snap }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing) return undefined;
    const t = setInterval(() => setI((x) => (x + 1) % SLIDES.length), 3800);
    return () => clearInterval(t);
  }, [playing]);

  const s = SLIDES[i];
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-center gap-2">
        {SLIDES.map((sl, idx) => (
          <button key={sl.id} onClick={() => { setI(idx); setPlaying(false); }}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${idx === i ? "slz-btn-primary" : "border border-slate-200 bg-white text-slate-600 hover:border-emerald-300"}`}>
            {sl.label}
          </button>
        ))}
        <button onClick={() => setPlaying((p) => !p)} className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-emerald-300">
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} {playing ? "Pause" : "Play"}
        </button>
      </div>
      <div className="mx-auto max-w-3xl">
        <AnimatePresence mode="wait">
          <motion.div key={s.id} initial={{ opacity: 0, y: 16, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -12, scale: 0.985 }} transition={{ duration: 0.4 }}>
            {s.type === "shot" ? (
              <ShotFrame src={s.src} snap={snap} title={s.title} chipIndex={s.chip || "NIFTY"} showChip={!s.noChip} />
            ) : (
              <div className="slz-browser"><div className="slz-screen-body"><ProductScreen id={s.screen} snap={snap} /></div></div>
            )}
          </motion.div>
        </AnimatePresence>
        <div className="mt-3 flex justify-center gap-1.5">
          {SLIDES.map((sl, idx) => (
            <span key={sl.id} className={`h-1.5 rounded-full transition-all ${idx === i ? "w-6 bg-emerald-500" : "w-1.5 bg-slate-300"}`} />
          ))}
        </div>
        <p className="mt-3 text-center text-xs text-slate-400">Real Striklenz screens · live market data inside the app</p>
      </div>
    </div>
  );
}
