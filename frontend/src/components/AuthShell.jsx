import { motion } from "framer-motion";
import { Activity, BellRing, Globe2, Landmark, Lock, Radio } from "lucide-react";
import OiPulseLogo from "@/components/OiPulseLogo";

/**
 * Shared full-bleed atmosphere for admin + guest entry screens.
 * Brand-forward hero on the left; interactive form slot on the right.
 */
export default function AuthShell({
  mode = "admin", // "admin" | "guest"
  children,
}) {
  const isGuest = mode === "guest";

  return (
    <div
      data-testid={isGuest ? "guest-auth-shell" : "admin-auth-shell"}
      className="relative min-h-screen overflow-hidden bg-[#061018] text-white"
      style={{ fontFamily: "Outfit, system-ui, sans-serif" }}
    >
      {/* Atmosphere — dark base with deep forest-green wash (not bright mint) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 15% 20%, rgba(6,95,70,0.28), transparent 55%)," +
            "radial-gradient(ellipse 70% 50% at 90% 80%, rgba(4,47,46,0.35), transparent 50%)," +
            "linear-gradient(160deg, #040d0b 0%, #0a1a16 48%, #061018 100%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(148,163,184,0.35) 1px, transparent 1px)," +
            "linear-gradient(90deg, rgba(148,163,184,0.35) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse at center, black 20%, transparent 75%)",
        }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -left-24 top-1/4 h-72 w-72 rounded-full bg-emerald-900/40 blur-3xl"
        animate={{ x: [0, 28, 0], y: [0, -18, 0], opacity: [0.35, 0.55, 0.35] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -right-16 bottom-1/4 h-80 w-80 rounded-full bg-teal-950/50 blur-3xl"
        animate={{ x: [0, -22, 0], y: [0, 20, 0], opacity: [0.25, 0.4, 0.25] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="relative z-10 mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-5 py-10 sm:px-8 lg:grid-cols-2 lg:gap-14 lg:py-16">
        {/* Brand / hero */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: "easeOut" }}
          className="flex flex-col justify-center"
        >
          <div className="mb-5 inline-flex items-center gap-2 self-start rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-emerald-200">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Live market pulse
          </div>

          <div className="flex items-center gap-4">
            <OiPulseLogo className="h-14 w-14 shrink-0 shadow-lg shadow-emerald-900/40" />
            <div>
              <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">OI Pulse</h1>
              <p className="mt-1 text-base text-slate-300 sm:text-lg">
                {isGuest
                  ? "Spot the OI surge — read bias before the crowd."
                  : "Command the desk. Spot bias. Act on OI."}
              </p>
            </div>
          </div>

          <div className="mt-8 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm">
            <div className="mb-3 flex items-center justify-between text-xs text-slate-300">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <Activity className="h-3.5 w-3.5 text-emerald-400" />
                Open interest signal
              </span>
              <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-semibold uppercase tracking-wider text-emerald-300">
                Live
              </span>
            </div>
            <svg viewBox="0 0 320 90" className="h-28 w-full" aria-hidden>
              <defs>
                <linearGradient id="authPulseFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
                </linearGradient>
              </defs>
              <motion.path
                d="M0 70 C40 68, 55 40, 80 48 C110 58, 130 20, 160 28 C190 36, 210 62, 240 44 C270 28, 290 18, 320 22 L320 90 L0 90 Z"
                fill="url(#authPulseFill)"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 1.1 }}
              />
              <motion.path
                d="M0 70 C40 68, 55 40, 80 48 C110 58, 130 20, 160 28 C190 36, 210 62, 240 44 C270 28, 290 18, 320 22"
                fill="none"
                stroke="#34d399"
                strokeWidth="2.5"
                strokeLinecap="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1.8, ease: "easeInOut" }}
              />
              <motion.circle
                cx="320"
                cy="22"
                r="4"
                fill="#6ee7b7"
                animate={{ opacity: [1, 0.35, 1], scale: [1, 1.35, 1] }}
                transition={{ duration: 1.6, repeat: Infinity }}
              />
            </svg>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px] text-slate-300">
              <div>
                <div className="text-lg font-semibold text-white">Nifty · BN · SX</div>
                <div className="opacity-70">Indices covered</div>
              </div>
              <div>
                <div className="text-lg font-semibold text-white">ATM±</div>
                <div className="opacity-70">Strike focus</div>
              </div>
              <div>
                <div className="text-lg font-semibold text-white">IST</div>
                <div className="opacity-70">Session clock</div>
              </div>
            </div>
          </div>

          <div className="mt-6 hidden gap-4 text-sm text-slate-300 sm:grid sm:grid-cols-3">
            {(isGuest
              ? [
                  { icon: BellRing, title: "Huge OI alerts", body: "Instant notification on a huge OI shift or unwind" },
                  { icon: Globe2, title: "Events & impact", body: "Global events + index constituent moves that swing bias" },
                  { icon: Landmark, title: "FII / DII data", body: "Institutional flow right beside the live OI desk" },
                ]
              : [
                  { icon: Lock, title: "Admin desk", body: "Public access, guests, uploads" },
                  { icon: Radio, title: "Live OI", body: "Snapshots, straddles, alerts" },
                  { icon: Activity, title: "Risk lens", body: "Events, holidays, carry brief" },
                ]
            ).map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
                <Icon className="mb-2 h-4 w-4 text-emerald-400" />
                <div className="font-semibold text-white">{title}</div>
                <div className="mt-0.5 text-xs leading-snug text-slate-400">{body}</div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Form slot */}
        <motion.div
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.12, ease: "easeOut" }}
          className="flex justify-center lg:justify-end"
        >
          {children}
        </motion.div>
      </div>
    </div>
  );
}
