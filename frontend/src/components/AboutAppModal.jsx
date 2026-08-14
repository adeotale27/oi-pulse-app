import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import OiPulseLogo from "@/components/OiPulseLogo";
import { ABOUT_EVENT, APP_NAME, APP_VERSION_LABEL } from "@/lib/appVersion";
import { RELEASE_NOTES } from "@/lib/releaseNotes";
import { api } from "@/lib/api";

export default function AboutAppModal() {
  const [open, setOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(ABOUT_EVENT, onOpen);
    return () => window.removeEventListener(ABOUT_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    api.get("/auth/state")
      .then((r) => {
        if (!cancelled) setIsAdmin(!!r.data?.is_admin);
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });
    return () => { cancelled = true; };
  }, [open]);

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
            {isAdmin ? " Admin view — full version notes." : " What’s on the desk in this version."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm text-slate-700">
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1">What it is</h3>
            {isAdmin ? (
              <p>
                OI Pulse is an options <b>open-interest desk</b>, not a generic charting app.
                The publisher Kite token polls the chain; Mongo stores every tick; the React desk
                turns that into change, buildup, alerts, straddles, and a positions book.
              </p>
            ) : (
              <p>
                OI Pulse is an options <b>open-interest desk</b> for NIFTY, SENSEX, and BANKNIFTY.
                You see who is adding Calls vs Puts, straddle premium, Index Risk, and (if you connect
                Zerodha) your own positions — not a generic LTP chart.
              </p>
            )}
          </section>

          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1">
              {isAdmin ? "What it does for you" : "What you can do"}
            </h3>
            {isAdmin ? (
              <ul className="list-disc pl-4 space-y-1">
                <li>Reads Call vs Put OI vs a lookback you pick — so you see who is adding, not only LTP.</li>
                <li>Flags huge ATM± shifts, writer defense, gamma walls, and institutional prints.</li>
                <li>Keeps sell candidates, straddle premium, Index Risk, CAS expiry, and session replay on one board.</li>
                <li>Admin journal stores booked P&amp;L in Mongo (frozen after the cash close catch-up).</li>
              </ul>
            ) : (
              <ul className="list-disc pl-4 space-y-1">
                <li>Watch Call vs Put open interest change, not only last price.</li>
                <li>Open Interest, Strike Table, Straddle, Positions, and Index Risk from the tabs / phone dock.</li>
                <li>Connect Zerodha on Positions for your own book; the OI charts stay on the house feed.</li>
              </ul>
            )}
          </section>

          <section data-testid="about-release-notes">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-2">
              {isAdmin ? "Version notes (admin)" : "What’s new"}
            </h3>
            <div className="space-y-3">
              {RELEASE_NOTES.map((rel) => (
                <div key={rel.version} className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold text-slate-900">V{rel.version}</span>
                    <span className="text-[11px] text-slate-400">{rel.date}</span>
                  </div>
                  <ul className="mt-1.5 list-disc pl-4 space-y-0.5 text-[13px]">
                    {rel.user.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  {isAdmin && rel.admin?.length ? (
                    <div className="mt-2 pt-2 border-t border-slate-200">
                      <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">Ops / internals</div>
                      <ul className="list-disc pl-4 space-y-0.5 text-[12px] text-slate-600">
                        {rel.admin.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          {isAdmin ? (
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1">How it is configured</h3>
              <ul className="list-disc pl-4 space-y-1">
                <li><b>Admin configuration</b> — indices, alert focus, poll seconds, market hours, Public/Admin page ticks.</li>
                <li><b>Public switch</b> — guests on/off; Access Control approves names and blocked IPs.</li>
                <li><b>Kite API</b> — publisher key + daily token for OI. Guests use Positions → Connect Zerodha.</li>
                <li><b>Uploads</b> — constituents / events CSVs; last-upload stamps stay admin-only.</li>
              </ul>
              <p className="text-[11px] text-slate-500 mt-2">
                Versioning starts at V5. Fixes ship as V5.01, V5.02. A whole new feature area becomes V6.
              </p>
            </section>
          ) : (
            <p className="text-[11px] text-slate-500">
              Tap the logo anytime for this list. You are on <b>{APP_VERSION_LABEL}</b>.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
