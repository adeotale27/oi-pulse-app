import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause } from "lucide-react";
import BrowserMock from "@/components/landing/BrowserMock";

const SLIDES = [
  { id: "dashboard", label: "Market Dashboard", title: "Market Dashboard" },
  { id: "chain-nifty", label: "NIFTY Chain", title: "NIFTY · Option Chain" },
  { id: "chain-banknifty", label: "BANK NIFTY Chain", title: "BANK NIFTY · Option Chain" },
  { id: "chain-sensex", label: "SENSEX Chain", title: "SENSEX · Option Chain" },
  { id: "pressure", label: "Strike Pressure", title: "Strike Pressure" },
  { id: "structure", label: "Market Structure", title: "Market Structure" },
  { id: "positions", label: "Positions", title: "Positions" },
  { id: "brain", label: "Position Brain", title: "Position Brain" },
  { id: "deskai", label: "Desk AI", title: "Desk AI" },
];

export default function DemoSlides({ snap }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing) return undefined;
    const t = setInterval(() => setI((x) => (x + 1) % SLIDES.length), 3400);
    return () => clearInterval(t);
  }, [playing]);

  const slide = SLIDES[i];
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-center gap-2">
        {SLIDES.map((s, idx) => (
          <button
            key={s.id}
            onClick={() => { setI(idx); setPlaying(false); }}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${idx === i ? "slz-btn-primary" : "border border-slate-200 bg-white text-slate-600 hover:border-emerald-300"}`}
          >
            {s.label}
          </button>
        ))}
        <button
          onClick={() => setPlaying((p) => !p)}
          className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-emerald-300"
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {playing ? "Pause" : "Play"}
        </button>
      </div>

      <div className="mx-auto max-w-2xl">
        <AnimatePresence mode="wait">
          <motion.div
            key={slide.id}
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -14, scale: 0.98 }}
            transition={{ duration: 0.4 }}
          >
            <BrowserMock id={slide.id} snap={snap} title={slide.title} />
          </motion.div>
        </AnimatePresence>
        <div className="mt-3 flex justify-center gap-1.5">
          {SLIDES.map((s, idx) => (
            <span key={s.id} className={`h-1.5 rounded-full transition-all ${idx === i ? "w-6 bg-emerald-500" : "w-1.5 bg-slate-300"}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
