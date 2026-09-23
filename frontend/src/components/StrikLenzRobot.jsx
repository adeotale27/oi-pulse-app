import { Coffee, Sparkles } from "lucide-react";
import OiPulseLogo from "@/components/OiPulseLogo";

/**
 * Lightweight shared mascot. The variant changes only the activity around the
 * same robot so login and unavailable states remain recognizably connected.
 */
export default function StrikLenzRobot({ variant = "monitoring" }) {
  const maintenance = variant === "maintenance";
  return (
    <div className={`oi-unified-robot ${maintenance ? "is-maintenance" : "is-monitoring"}`} aria-label={maintenance ? "StrikLenz robot investigating the desk" : "StrikLenz robot monitoring the markets"}>
      <span className="oi-unified-antenna" />
      <div className="oi-unified-head"><i /><i /><span /></div>
      <div className="oi-unified-neck" />
      <div className="oi-unified-body"><OiPulseLogo className="oi-unified-chest-logo" pulse={false} /></div>
      <div className="oi-unified-arm arm-left" />
      <div className="oi-unified-arm arm-right" />
      <div className="oi-unified-hand hand-left" />
      <div className="oi-unified-hand hand-right" />
      {maintenance ? (
        <div className="oi-unified-mug"><Coffee /><small>ONE MORE<br />COFFEE</small></div>
      ) : (
        <div className="oi-unified-sparkle"><Sparkles /></div>
      )}
    </div>
  );
}
