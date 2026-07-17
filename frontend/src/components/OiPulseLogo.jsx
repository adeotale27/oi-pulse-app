/**
 * OI-Pulse logo — clean, geometric, high-contrast.
 * Composition:
 *   • Rounded emerald-to-sky-blue square backdrop
 *   • Sharp candle-and-wick "market" glyph
 *   • Upward arrow tip in the top-right (pulse indicator)
 * No blur / no filter → renders crisp at every size.
 */
export default function OiPulseLogo({ className = "w-6 h-6" }) {
  const gid = "oi-grad-" + Math.random().toString(36).slice(2, 8);
  return (
    <svg
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="OI Pulse"
      role="img"
      shapeRendering="geometricPrecision"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#059669" />
          <stop offset="55%" stopColor="#047857" />
          <stop offset="100%" stopColor="#0284c7" />
        </linearGradient>
      </defs>

      {/* Rounded-square backdrop */}
      <rect x="2" y="2" width="44" height="44" rx="11" ry="11" fill={`url(#${gid})`} />
      <rect x="2" y="2" width="44" height="44" rx="11" ry="11" fill="none"
            stroke="rgba(255,255,255,0.14)" strokeWidth="1" />

      {/* Baseline */}
      <line x1="9" y1="34" x2="39" y2="34" stroke="rgba(255,255,255,0.32)" strokeWidth="1.2" />

      {/* Candles (bearish red left, bullish green right — using white with opacity for clean look) */}
      {/* Left small candle */}
      <line x1="13" y1="19" x2="13" y2="31" stroke="rgba(255,255,255,0.85)" strokeWidth="1.4" strokeLinecap="round" />
      <rect x="11.4" y="22" width="3.2" height="7" rx="0.6" fill="rgba(255,255,255,0.85)" />

      {/* Middle taller bullish candle */}
      <line x1="20" y1="12" x2="20" y2="32" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="18" y="15" width="4" height="14" rx="0.7" fill="#ffffff" />

      {/* Right growing candle */}
      <line x1="27" y1="16" x2="27" y2="30" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="25.2" y="18" width="3.6" height="9" rx="0.6" fill="rgba(255,255,255,0.9)" />

      {/* Upward arrow (pulse) — from candle top to top-right corner */}
      <path
        d="M31 20 L39 12"
        stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round"
      />
      <path
        d="M39 12 L39 17 M39 12 L34 12"
        stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none"
      />
    </svg>
  );
}
