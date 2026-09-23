import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause } from "lucide-react";
import BrowserMock from "@/components/landing/BrowserMock";

const SLIDES = [
  { id: "dashboard", label: "Dashboard", title: "Market Dashboard" },
  { id: "oi", label: "OI Change", title: "SENSEX · OI Change" },
  { id: "positions", label: "Positions", title: "Live Positions", chip: false },
  { id: "structure", label: "Market Structure", title: "Market Structure" },
  { id: "pressure", label: "Strike Pressure", title: "Strike Pressure" },
  { id: "brain", label: "Position Brain", title: "Position Brain", chip: false },
  { id: "deskai", label: "Desk AI", title: "Desk AI", chip: false },
];

export default function ShotTour({ snap }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing) return undefined;
    const t = setInterval(() => setI((x) => (x + 1) % SLIDES.length), 3600);
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
      <div className="mx-auto max-w-2xl">
        <AnimatePresence mode="wait">
          <motion.div key={s.id} initial={{ opacity: 0, y: 16, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -12, scale: 0.985 }} transition={{ duration: 0.4 }}>
            <BrowserMock id={s.id} snap={snap} title={s.title} showChip={s.chip !== false} />
          </motion.div>
        </AnimatePresence>
        <div className="mt-3 flex justify-center gap-1.5">
          {SLIDES.map((sl, idx) => (
            <span key={sl.id} className={`h-1.5 rounded-full transition-all ${idx === i ? "w-6 bg-emerald-500" : "w-1.5 bg-slate-300"}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
