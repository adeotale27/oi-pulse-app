import { useId } from "react";

/**
 * OI Pulse logo — crisp geometric mark.
 * Stable gradient id (no Math.random) so the icon never flickers on re-render.
 */
export default function OiPulseLogo({ className = "w-6 h-6" }) {
  const reactId = useId().replace(/:/g, "");
  const gid = `oi-logo-grad-${reactId}`;
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
          <stop offset="55%" stopColor="#059669" />
          <stop offset="100%" stopColor="#0EA5E9" />
        </linearGradient>
      </defs>

      <rect x="2" y="2" width="44" height="44" rx="11" ry="11" fill={`url(#${gid})`} />

      {/* ECG-style pulse: flat → spike up → spike down → flat → live dot */}
      <path
        d="M7 25 H14 L17 25 L20 12 L24 36 L28 20 L31 25 H38"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="39.5" cy="25" r="2.6" fill="#FFFFFF" />
      <circle cx="39.5" cy="25" r="4.2" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1" />
    </svg>
  );
}
