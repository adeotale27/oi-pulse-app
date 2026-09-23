import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight, Check, Menu, X, Layers, Gauge, Activity,
  Brain, Bot, ShieldCheck, Zap, LineChart, PlugZap,
} from "lucide-react";
import "@/styles/landing.css";
import useLiveDemo from "@/hooks/useLiveDemo";
import OiPulseLogo from "@/components/OiPulseLogo";
import ShotFrame from "@/components/landing/ShotFrame";
import ShotTour from "@/components/landing/ShotTour";
import ProductScreen from "@/components/landing/ProductScreen";
import { BRAND, NAV_LINKS, FREE_FEATURES, PREMIUM_FEATURES, FAQS, PRICING_FALLBACK, money } from "@/config/site";
import { api } from "@/lib/api";

const reveal = {
  initial: { opacity: 0, y: 26 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.2 },
  transition: { duration: 0.6 },
};

function Logo({ className = "" }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <OiPulseLogo className="h-9 w-9" pulse={false} />
      <span className="text-xl font-bold tracking-tight text-slate-900">
        Strik<span className="text-emerald-600">lenz</span>
      </span>
    </div>
  );
}

function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={`fixed inset-x-0 top-0 z-50 transition ${scrolled ? "slz-glass shadow-sm" : "bg-transparent"}`}>
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5">
        <Logo />
        <nav className="hidden items-center gap-7 md:flex">
          {NAV_LINKS.map((l) => (
            <a key={l.id} href={l.href} className="text-sm font-medium text-slate-600 transition hover:text-slate-900">{l.label}</a>
          ))}
        </nav>
        <div className="hidden items-center gap-3 md:flex">
          <Link to="/login" className="text-sm font-semibold text-slate-700 hover:text-slate-900">Login</Link>
          <Link to="/login" className="slz-btn-primary inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition">
            Get Started <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <button className="md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu">
          {open ? <X className="h-6 w-6 text-slate-800" /> : <Menu className="h-6 w-6 text-slate-800" />}
        </button>
      </div>
      {open && (
        <div className="slz-glass border-t border-slate-200 px-5 py-4 md:hidden">
          <div className="flex flex-col gap-3">
            {NAV_LINKS.map((l) => (
              <a key={l.id} href={l.href} onClick={() => setOpen(false)} className="text-sm font-medium text-slate-700">{l.label}</a>
            ))}
            <Link to="/login" className="slz-btn-primary mt-2 rounded-full px-4 py-2.5 text-center text-sm font-semibold">Get Started</Link>
          </div>
        </div>
      )}
    </header>
  );
}

function Ticker({ snap }) {
  const items = [
    ["NIFTY 50", snap.indices.NIFTY],
    ["BANK NIFTY", snap.indices.BANKNIFTY],
    ["SENSEX", snap.indices.SENSEX],
  ];
  const row = [...items, ...items, ...items];
  return (
    <div className="overflow-hidden border-y border-slate-200 bg-white/60 py-2">
      <div className="slz-marquee slz-mono text-sm">
        {row.map(([label, d], idx) => {
          const up = d.changePct >= 0;
          return (
            <span key={idx} className="flex items-center gap-2 text-slate-700">
              <b className="font-semibold">{label}</b>
              <span>{Number(d.price).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <em className={`not-italic font-semibold ${up ? "text-emerald-600" : "text-rose-600"}`}>{up ? "▲" : "▼"} {up ? "+" : ""}{d.changePct.toFixed(2)}%</em>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Hero({ snap }) {
  return (
    <section className="relative overflow-hidden pt-28 pb-10 md:pt-36">
      <div className="slz-aurora" />
      <div className="absolute inset-0 slz-grid-dots opacity-60" />
      <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-5 lg:grid-cols-[1.05fr_1fr]">
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
          <span className="slz-chip mb-4" style={{ background: "rgba(16,185,129,0.12)", color: "#047857" }}>
            <span className="slz-live-dot" /> Live options intelligence · NIFTY · BANK NIFTY · SENSEX
          </span>
          <h1 className="text-4xl font-black leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
            Understand the <span className="slz-underline-accent">options market</span> before you trade.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-slate-600 sm:text-lg">
            Striklenz reads open interest, strike pressure and market structure in real time — then makes it personal.
            Connect your broker to see your positions on the OI wall, powered by Position Brain & Desk AI.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link to="/login" className="slz-btn-primary inline-flex items-center gap-2 rounded-full px-6 py-3 text-base font-semibold transition">
              Start free <ArrowRight className="h-5 w-5" />
            </Link>
            <a href="#premium" className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-6 py-3 text-base font-semibold text-slate-800 transition hover:border-emerald-400">
              See Premium
            </a>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-500">
            <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-emerald-600" /> No broker needed to start</span>
            <span className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Official broker OAuth</span>
          </div>
        </motion.div>

        <div className="slz-scene relative">
          <motion.div
            className="slz-tilt"
            animate={{ y: [0, -12, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          >
            <ShotFrame src="/shots/terminal-full.jpg" snap={snap} title="Market Dashboard" chipIndex="SENSEX" />
          </motion.div>
          <motion.div
            className="slz-tilt-soft absolute -bottom-10 -left-6 w-60 md:w-72"
            animate={{ y: [0, 10, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
          >
            <ShotFrame src="/shots/longshort-oi.png" snap={snap} title="Long / Short on OI" showChip={false} />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

const FEATURE_CARDS = [
  { icon: Layers, title: "Full Option Chain", desc: "OI, OI change, volume and PCR for every strike — instantly readable." },
  { icon: Gauge, title: "Strike Pressure", desc: "See which side the writers are defending and where price is drawn." },
  { icon: Activity, title: "Market Structure", desc: "Auto support & resistance from the OI walls that actually matter." },
  { icon: LineChart, title: "OI Distribution", desc: "Visualise the call/put battle across strikes in one glance." },
  { icon: Brain, title: "Position Brain", desc: "An instant, plain-English read on your live book and its risk." },
  { icon: Bot, title: "Desk AI", desc: "Ask anything about the market or your positions — get a trader's answer." },
];

function Features() {
  return (
    <section id="features" className="relative mx-auto max-w-7xl px-5 py-20">
      <motion.div {...reveal} className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Everything the desk needs, in one view</h2>
        <p className="mt-4 text-slate-600">Purpose-built for Indian index options. No clutter, no noise — just the reads that move your decisions.</p>
      </motion.div>
      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURE_CARDS.map((f, i) => (
          <motion.div key={f.title} {...reveal} transition={{ duration: 0.5, delay: i * 0.05 }}
            className="group rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-1 hover:border-emerald-300 hover:shadow-xl hover:shadow-emerald-500/5">
            <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-50 to-indigo-50 text-emerald-600 ring-1 ring-emerald-100">
              <f.icon className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900">{f.title}</h3>
            <p className="mt-1.5 text-sm leading-6 text-slate-600">{f.desc}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function ProductDemo({ snap }) {
  return (
    <section id="product" className="relative overflow-hidden bg-slate-50 py-20">
      <div className="mx-auto max-w-7xl px-5">
        <motion.div {...reveal} className="mx-auto max-w-2xl text-center">
          <span className="slz-chip mb-3" style={{ background: "rgba(79,70,229,0.1)", color: "#4338ca" }}>Interactive demo</span>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Step inside the terminal</h2>
          <p className="mt-4 text-slate-600">Real Striklenz screens — OI change, positions, long/short on the OI wall. Inside the app it's live market data.</p>
        </motion.div>
        <motion.div {...reveal} className="mt-12">
          <ShotTour snap={snap} />
        </motion.div>
      </div>
    </section>
  );
}

function FreeVsPremium() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-20">
      <motion.div {...reveal} className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Start free. Go personal with Premium.</h2>
        <p className="mt-4 text-slate-600">Full market intelligence is free forever. Premium makes it about <em>your</em> book.</p>
      </motion.div>
      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <motion.div {...reveal} className="rounded-3xl border border-slate-200 bg-white p-8">
          <div className="flex items-center gap-2 text-emerald-600"><Zap className="h-5 w-5" /><span className="text-sm font-bold uppercase tracking-wider">Free</span></div>
          <h3 className="mt-3 text-2xl font-bold text-slate-900">Market Intelligence</h3>
          <p className="mt-1 text-sm text-slate-500">No broker connection required.</p>
          <ul className="mt-6 space-y-3">
            {FREE_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-3 text-sm text-slate-700"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> {f}</li>
            ))}
          </ul>
        </motion.div>
        <motion.div {...reveal} transition={{ duration: 0.6, delay: 0.08 }} className="relative overflow-hidden rounded-3xl border border-indigo-200 bg-gradient-to-br from-white to-indigo-50/60 p-8 shadow-xl shadow-indigo-500/5">
          <div className="absolute right-5 top-5 rounded-full bg-indigo-600 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white">Premium</div>
          <div className="flex items-center gap-2 text-indigo-600"><Brain className="h-5 w-5" /><span className="text-sm font-bold uppercase tracking-wider">Premium</span></div>
          <h3 className="mt-3 text-2xl font-bold text-slate-900">Position Intelligence</h3>
          <p className="mt-1 text-sm text-slate-500">Connect your broker. See yourself on the chart.</p>
          <ul className="mt-6 space-y-3">
            {PREMIUM_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-3 text-sm text-slate-700"><Check className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" /> {f}</li>
            ))}
          </ul>
        </motion.div>
      </div>
    </section>
  );
}

function PremiumShowcase({ snap }) {
  return (
    <section id="premium" className="relative overflow-hidden bg-slate-900 py-20 text-white">
      <div className="pointer-events-none absolute inset-0 opacity-40" style={{ background: "radial-gradient(60rem 30rem at 70% -10%, rgba(79,70,229,0.35), transparent), radial-gradient(50rem 30rem at 10% 110%, rgba(16,185,129,0.3), transparent)" }} />
      <div className="relative mx-auto max-w-7xl px-5">
        <motion.div {...reveal} className="mx-auto max-w-2xl text-center">
          <span className="slz-chip mb-3" style={{ background: "rgba(129,140,248,0.18)", color: "#c7d2fe" }}>See what Premium unlocks</span>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Now see <span className="slz-underline-accent">your position</span>.</h2>
          <p className="mt-4 text-slate-300">Explore the Premium experience below — long/short on the OI wall, Position Brain and Desk AI, all on a live demo feed.</p>
        </motion.div>

        <div className="mt-12 grid gap-6 lg:grid-cols-[1.15fr_1fr]">
          <motion.div {...reveal}>
            <div className="mb-3 text-sm font-semibold text-indigo-200">Active Long / Short on the OI chart</div>
            <ShotFrame src="/shots/oi-change.png" snap={snap} title="Positions on the OI wall" chipIndex="SENSEX" />
            <div className="mt-4 text-sm font-semibold text-indigo-200">Live Positions &amp; P&amp;L</div>
            <div className="mt-3"><ShotFrame src="/shots/positions.png" snap={snap} title="Live Positions" showChip={false} /></div>
          </motion.div>
          <div className="grid gap-6">
            <motion.div {...reveal}>
              <div className="mb-3 text-sm font-semibold text-indigo-200">Position Brain</div>
              <div className="slz-browser"><div className="slz-screen-body"><ProductScreen id="brain" snap={snap} /></div></div>
            </motion.div>
            <motion.div {...reveal} transition={{ duration: 0.6, delay: 0.08 }}>
              <div className="mb-3 text-sm font-semibold text-indigo-200">Desk AI</div>
              <div className="slz-browser"><div className="slz-screen-body"><ProductScreen id="deskai" snap={snap} /></div></div>
            </motion.div>
          </div>
        </div>

        <motion.div {...reveal} className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: PlugZap, t: "Connect broker", d: "Zerodha live, more coming" },
            { icon: LineChart, t: "Position P&L", d: "Live, per-leg" },
            { icon: Brain, t: "Position Brain", d: "Instant risk read" },
            { icon: Bot, t: "Desk AI", d: "Ask your book anything" },
          ].map((c) => (
            <div key={c.t} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <c.icon className="h-5 w-5 text-emerald-400" />
              <div className="mt-3 font-semibold">{c.t}</div>
              <div className="text-sm text-slate-400">{c.d}</div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function Brokers({ brokers }) {
  const list = brokers && brokers.length ? brokers : [];
  return (
    <section className="mx-auto max-w-7xl px-5 py-20">
      <motion.div {...reveal} className="mx-auto max-w-2xl text-center">
        <span className="slz-chip mb-3" style={{ background: "rgba(16,185,129,0.12)", color: "#047857" }}>One secure connection layer</span>
        <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Connect your broker</h2>
        <p className="mt-4 text-slate-600">Official OAuth only — we never store your broker password. More brokers are being added continuously.</p>
      </motion.div>
      <motion.div {...reveal} className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {list.map((b) => (
          <div key={b.id} className={`flex items-center justify-between rounded-2xl border p-4 ${b.enabled ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200 bg-white"}`}>
            <span className="font-semibold text-slate-800">{b.name}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${b.enabled ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"}`}>{b.enabled ? "Live" : "Soon"}</span>
          </div>
        ))}
      </motion.div>
    </section>
  );
}

function Pricing({ pricing }) {
  const [cycle, setCycle] = useState("monthly");
  const p = pricing || PRICING_FALLBACK;
  const cur = p.currency || "INR";
  const premiumPrice = p.premium?.[cycle] ?? PRICING_FALLBACK.premium[cycle];
  const per = cycle === "monthly" ? "/mo" : cycle === "quarterly" ? "/qtr" : "/yr";
  return (
    <section id="pricing" className="relative overflow-hidden bg-slate-50 py-20">
      <div className="mx-auto max-w-7xl px-5">
        <motion.div {...reveal} className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Simple, honest pricing</h2>
          <p className="mt-4 text-slate-600">Free forever for market intelligence. Upgrade when you want it personal.</p>
          <div className="mt-6 inline-flex rounded-full border border-slate-200 bg-white p-1">
            {["monthly", "quarterly", "yearly"].map((c) => (
              <button key={c} onClick={() => setCycle(c)} className={`rounded-full px-4 py-1.5 text-sm font-semibold capitalize transition ${cycle === c ? "slz-btn-primary" : "text-slate-600"}`}>{c}</button>
            ))}
          </div>
        </motion.div>
        <div className="mx-auto mt-12 grid max-w-4xl gap-6 md:grid-cols-2">
          <motion.div {...reveal} className="rounded-3xl border border-slate-200 bg-white p-8">
            <h3 className="text-lg font-bold text-slate-900">{p.free?.label || "Free"}</h3>
            <div className="mt-3 text-4xl font-black text-slate-900">{money(0, cur)}<span className="text-base font-medium text-slate-500">/forever</span></div>
            <p className="mt-2 text-sm text-slate-500">Full market intelligence, no broker needed.</p>
            <Link to="/login" className="mt-6 block rounded-full border border-slate-300 bg-white px-5 py-3 text-center text-sm font-semibold text-slate-800 transition hover:border-emerald-400">Start free</Link>
          </motion.div>
          <motion.div {...reveal} transition={{ duration: 0.6, delay: 0.08 }} className="relative rounded-3xl border-2 border-indigo-300 bg-gradient-to-br from-white to-indigo-50 p-8 shadow-xl shadow-indigo-500/10">
            <div className="absolute -top-3 left-8 rounded-full bg-indigo-600 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white">Most popular</div>
            <h3 className="text-lg font-bold text-slate-900">{p.premium?.label || "Premium"}</h3>
            <div className="mt-3 text-4xl font-black text-slate-900">{money(premiumPrice, cur)}<span className="text-base font-medium text-slate-500">{per}</span></div>
            <p className="mt-2 text-sm text-slate-500">Everything in Free, plus your positions.</p>
            <ul className="mt-5 space-y-2.5">
              {PREMIUM_FEATURES.slice(0, 5).map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-sm text-slate-700"><Check className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" /> {f}</li>
              ))}
            </ul>
            <Link to="/login" className="slz-btn-primary mt-6 block rounded-full px-5 py-3 text-center text-sm font-semibold">Go Premium</Link>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function FAQ() {
  const [open, setOpen] = useState(0);
  return (
    <section id="faq" className="mx-auto max-w-3xl px-5 py-20">
      <motion.h2 {...reveal} className="text-center text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Questions, answered</motion.h2>
      <div className="mt-10 space-y-3">
        {FAQS.map((f, i) => (
          <motion.div key={f.q} {...reveal} transition={{ duration: 0.4, delay: i * 0.03 }} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <button onClick={() => setOpen(open === i ? -1 : i)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left">
              <span className="font-semibold text-slate-900">{f.q}</span>
              <span className={`text-2xl leading-none text-emerald-600 transition ${open === i ? "rotate-45" : ""}`}>+</span>
            </button>
            {open === i && <div className="px-5 pb-5 text-sm leading-7 text-slate-600">{f.a}</div>}
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="mx-auto max-w-7xl px-5 pb-20">
      <motion.div {...reveal} className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 to-indigo-700 px-8 py-14 text-center text-white">
        <div className="pointer-events-none absolute inset-0 slz-grid-dots opacity-20" />
        <h2 className="relative text-3xl font-black tracking-tight sm:text-4xl">You're one login from a sharper read.</h2>
        <p className="relative mx-auto mt-3 max-w-xl text-emerald-50">Start free in seconds. Continue with Google — no card, no setup.</p>
        <Link to="/login" className="relative mt-7 inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-base font-bold text-slate-900 transition hover:-translate-y-0.5">
          Get Started <ArrowRight className="h-5 w-5" />
        </Link>
      </motion.div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row">
        <Logo />
        <p className="text-sm text-slate-500">© {new Date().getFullYear()} {BRAND.name}. Markets involve risk. For information only — not investment advice.</p>
        <div className="flex items-center gap-4 text-sm text-slate-500">
          <a href="#faq" className="hover:text-slate-800">FAQ</a>
          <Link to="/login" className="hover:text-slate-800">Login</Link>
        </div>
      </div>
    </footer>
  );
}

export default function Landing() {
  const snap = useLiveDemo(1500);
  const [cfg, setCfg] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get("/public/site-config").then((r) => { if (alive) setCfg(r.data); }).catch(() => {});
    document.title = "Striklenz — NIFTY, BANK NIFTY & SENSEX Options Intelligence";
    return () => { alive = false; };
  }, []);

  const pricing = useMemo(() => cfg?.pricing || PRICING_FALLBACK, [cfg]);
  const brokers = cfg?.brokers;

  return (
    <div className="slz slz-light min-h-screen">
      <Nav />
      <main>
        <Hero snap={snap} />
        <Ticker snap={snap} />
        <Features />
        <ProductDemo snap={snap} />
        <FreeVsPremium />
        <PremiumShowcase snap={snap} />
        <Brokers brokers={brokers} />
        <Pricing pricing={pricing} />
        <FAQ />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
