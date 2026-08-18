import { useId } from "react";
import { APP_NAME } from "@/lib/appVersion";

/**
 * Rounded desk mark (same radius as the in-app tile). Home-screen PNGs
 * bake the same rounded square so the phone icon is not a hard full square.
 */
export default function OiPulseLogo({ className = "w-6 h-6", pulse = true }) {
  const reactId = useId().replace(/:/g, "");
  const gid = `oi-logo-grad-${reactId}`;
  return (
    <svg
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      className={`${pulse ? "oi-brand-pulse" : ""} ${className}`.trim()}
      aria-label={APP_NAME}
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
      <rect x="1" y="1" width="46" height="46" rx="9.5" ry="9.5" fill={`url(#${gid})`} stroke="#FFFFFF" strokeWidth="1" />
      <path
        d="M4 24 H12 L16 24 L20 10 L24 38 L28 18 L32 24 H42"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="43" cy="24" r="2.4" fill="#FFFFFF" />
    </svg>
  );
}
