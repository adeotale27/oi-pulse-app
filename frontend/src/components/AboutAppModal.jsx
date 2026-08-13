import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import OiPulseLogo from "@/components/OiPulseLogo";
import { ABOUT_EVENT, APP_NAME, APP_VERSION_LABEL } from "@/lib/appVersion";

export default function AboutAppModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(ABOUT_EVENT, onOpen);
    return () => window.removeEventListener(ABOUT_EVENT, onOpen);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent data-testid="about-app-modal" className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <OiPulseLogo className="h-9 w-9 rounded-lg" />
            <span>
              {APP_NAME}{" "}
              <span className="text-emerald-700 font-mono-data">{APP_VERSION_LABEL}</span>
            </span>
          </DialogTitle>
          <DialogDescription>
            Live NSE open-interest desk for NIFTY, SENSEX, and BANKNIFTY.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm text-slate-700">
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1">What it is</h3>
            <p>
              OI Pulse is an options <b>open-interest desk</b>, not a generic charting app.
              The publisher Kite token polls the chain; Mongo stores every tick; the React desk
              turns that into change, buildup, alerts, straddles, and a positions book.
            </p>
          </section>

          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1">What it does for you</h3>
            <ul className="list-disc pl-4 space-y-1">
              <li>Reads Call vs Put OI vs a lookback you pick — so you see who is adding, not only LTP.</li>
              <li>Flags huge ATM± shifts, writer defense, gamma walls, and institutional prints.</li>
              <li>Keeps sell candidates, straddle premium, Index Risk, CAS expiry, and session replay on one board.</li>
              <li>Admin journal stores booked P&amp;L in Mongo (frozen after the cash close catch-up).</li>
            </ul>
          </section>

          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1">The edge</h3>
            <p>
              You own the poll cadence and thresholds. Guests can still <b>Connect Zerodha</b> for their own
              book while charts stay on the publisher OI feed — one tape, many books. Public / Admin page
              ticks let you hide noise from guests <em>or</em> from your own desk without rebuilding the app.
            </p>
          </section>

          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1">How it is configured</h3>
            <ul className="list-disc pl-4 space-y-1">
              <li><b>Admin Settings</b> — indices, alert focus, poll seconds, market hours, Public/Admin page ticks.</li>
              <li><b>Public switch</b> — guests on/off; Access Control approves names and blocked IPs.</li>
              <li><b>Kite API</b> — publisher key + daily token for OI. Guests use Positions → Connect Zerodha.</li>
              <li><b>Uploads</b> — constituents / events CSVs; last-upload stamps stay admin-only.</li>
            </ul>
          </section>

          <p className="text-[11px] text-slate-500">
            Versioning starts at V5. Fixes ship as V5.01, V5.02. A whole new feature area becomes V6.
            See README.md and AGENTS.md in the repo.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
