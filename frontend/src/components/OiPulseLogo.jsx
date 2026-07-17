/**
 * OI-Pulse logo — minimalist, geometric, high-contrast.
 * A single continuous pulse/heart-beat wave over a soft gradient tile,
 * flanked by a small upward tick — reading as "live signal + market pulse".
 * SVG only. No filters. Crisp at every size.
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
          <stop offset="0%" stopColor="#10B981" />
          <stop offset="60%" stopColor="#059669" />
          <stop offset="100%" stopColor="#0284C7" />
        </linearGradient>
      </defs>

      {/* Rounded-square backdrop */}
      <rect x="2" y="2" width="44" height="44" rx="12" ry="12" fill={`url(#${gid})`} />

      {/* Subtle inner highlight */}
      <rect
        x="2.5"
        y="2.5"
        width="43"
        height="43"
        rx="11.5"
        ry="11.5"
        fill="none"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="1"
      />

      {/* Single clean pulse wave — ─┘¯└─ */}
      <path
        d="M8 26 L17 26 L20 18 L24 34 L28 22 L31 26 L40 26"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Live dot at end of wave */}
      <circle cx="40" cy="26" r="2.4" fill="#FFFFFF" />
      <circle cx="40" cy="26" r="4" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1" />
    </svg>
  );
}
