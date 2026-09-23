import { Activity, BarChart3, BrainCircuit, CalendarDays, Globe2, Newspaper, ShieldCheck } from "lucide-react";

const features = [
  [Activity, "Live OI Pulse", "Track market flows"],
  [BarChart3, "Market Insights", "Find opportunities"],
  [ShieldCheck, "Risk Lens", "Trade smarter"],
  [BrainCircuit, "Desk AI", "Your trading copilot"],
  [Globe2, "Global Market", "Track world indices"],
  [Newspaper, "World Market News", "Stay market-aware"],
  [BarChart3, "Straddle", "Read premium structure"],
  [CalendarDays, "Events", "Plan around the calendar"],
];

export default function AuthFeatureFooter({ brand = true }) {
  return (
    <footer className="oi-auth-footer">
      <div className="oi-auth-footer-features">
        {features.map(([Icon, title, body]) => <div key={title}><Icon /><span><b>{title}</b><small>{body}</small></span></div>)}
      </div>
      {brand ? <div className="oi-auth-footer-brand"><b>StrikLenz</b><span>Live market intelligence.</span></div> : null}
    </footer>
  );
}
