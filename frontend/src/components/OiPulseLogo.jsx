/**
 * OI Pulse Logo — SVG mark
 * Design: a pulsing heartbeat/candle wave inside a rounded diamond,
 * with a subtle emerald→blue gradient (indices moving up).
 * Scales via className width/height (default 32px in the current app).
 */
export default function OiPulseLogo({ className = "w-6 h-6", withGlow = false }) {
  const gid = "oi-grad-" + Math.random().toString(36).slice(2, 8);
  return (
    <svg
      viewBox="0 0 40 40"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="OI Pulse"
      role="img"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="55%" stopColor="#059669" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
        {withGlow && (
          <filter id={gid + "-glow"} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.4" />
          </filter>
        )}
      </defs>

      {/* Rounded-square backdrop */}
      <rect x="1" y="1" width="38" height="38" rx="10" ry="10" fill={`url(#${gid})`} />

      {/* Pulse wave (candles + heartbeat) */}
      <g stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none"
         filter={withGlow ? `url(#${gid}-glow)` : undefined}>
        <path d="M6 24 L12 24 L14 20 L17 28 L20 14 L23 26 L26 22 L34 22" />
      </g>

      {/* Small up-arrow ping */}
      <g fill="white" opacity="0.9">
        <circle cx="30" cy="12" r="2.4" />
      </g>
    </svg>
  );
}
