import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, RefreshCw, Settings2 } from "lucide-react";
import "@/styles/riskManagement.css";
import {
  aggregateRiskScenario,
  calculateRiskBook,
  DEFAULT_RISK_SETTINGS,
  normalizeRiskSettings,
  openShortPremiumCapture,
  summarizeOpenShortCapture,
  summarizeSellerDecay,
} from "@/lib/positionsRisk";
import { DAY_LOSS } from "@/lib/capitalGuard";

const SETTINGS_KEY = "oiPositionsRiskSettings_v3";
const RISK_ORDER = { High: 5, Elevated: 4, "Data unavailable": 3, Normal: 1, Hedge: 0 };

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return normalizeRiskSettings(saved);
  } catch {
    return { ...DEFAULT_RISK_SETTINGS };
  }
}

function money(value, digits = 0) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const amount = Number(value);
  const sign = amount < 0 ? "−" : "";
  return `${sign}₹${Math.abs(amount).toLocaleString("en-IN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })}`;
}

function number(value, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("en-IN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function ageLabel(timestamp, now = Date.now()) {
  const ms = Date.parse(timestamp || "");
  if (!Number.isFinite(ms)) return "not available";
  const seconds = Math.max(0, Math.floor((now - ms) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

function rowKey(row) {
  return `${row.exchange || ""}:${row.tradingsymbol || row.display_name || row.index || "position"}:${row.product || ""}`;
}

function statusStyle(status) {
  if (status === "High") return "border-rose-200 bg-rose-50 text-rose-800";
  if (status === "Elevated") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "Normal") return "border-slate-200 bg-slate-50 text-slate-700";
  if (status === "Hedge") return "border-sky-200 bg-sky-50 text-sky-800";
  return "border-slate-200 bg-white text-slate-500";
}

function riskSortValue(row, key) {
  const metrics = row.riskMetrics;
  if (key === "strike") return Number.isFinite(Number(row.strike)) ? Number(row.strike) : null;
  if (key === "pnl") return row.unrealised != null && Number.isFinite(Number(row.unrealised)) ? Number(row.unrealised) : null;
  if (key === "delta") return metrics?.deltaInrPerPct ?? null;
  if (key === "gamma") return metrics?.signedGamma ?? null;
  if (key === "theta") return metrics?.thetaInrPerDay ?? null;
  if (key === "iv") return metrics?.ivPct ?? null;
  return RISK_ORDER[row.packageRiskStatus || row.riskStatus] ?? -1;
}

function rowUrgency(row) {
  const packageRisk = row.packageRiskStatus || row.riskStatus;
  const statusRank = RISK_ORDER[packageRisk] ?? 0;
  if (statusRank >= RISK_ORDER.Elevated) return statusRank;
  if (row.riskStatus === "Data unavailable") return RISK_ORDER["Data unavailable"];
  if (row.breachedAdjust && Number(row.quantity) < 0) return 2;
  return statusRank;
}

function isNearExpiryAndStrike(row) {
  return Number(row?.quantity) < 0
    && row?.isOpt
    && row?.breachedAdjust === true
    && row?.onExpiryDay === true;
}

function sameStrikeHedgeCoverage(row, rows) {
  const strike = Number(row.strike);
  const soldQty = Math.abs(Number(row.quantity));
  const hedgeQty = rows.reduce((sum, candidate) => {
    const candidateStrike = Number(candidate.strike);
    const samePosition = !candidate.exited
      && candidate.isOpt
      && Number(candidate.quantity) > 0
      && String(candidate.index || candidate.underlying || "") === String(row.index || row.underlying || "")
      && String(candidate.expiryIso || candidate.expiry_iso || "") === String(row.expiryIso || row.expiry_iso || "")
      && candidate.side === row.side
      && candidateStrike === strike;
    return sum + (samePosition ? Number(candidate.quantity) : 0);
  }, 0);
  const covered = Math.min(soldQty, hedgeQty);
  return {
    bought: hedgeQty,
    remaining: Math.max(0, soldQty - covered),
  };
}

function packageKey(row) {
  return row.packageKey || `${row.index || row.exchange || "unknown"}:${row.expiryIso || row.expiry_iso || row.tradingsymbol || "unknown"}`;
}

function comparePackageRows(a, b, sort) {
  if (sort.key === "risk") {
    if (packageKey(a) === packageKey(b)) {
      const nearStrikeOrder = Number(!!b.breachedAdjust) - Number(!!a.breachedAdjust);
      if (nearStrikeOrder !== 0) return nearStrikeOrder;
      const strikeOrder = (riskSortValue(a, "strike") ?? Number.MAX_SAFE_INTEGER)
        - (riskSortValue(b, "strike") ?? Number.MAX_SAFE_INTEGER);
      if (strikeOrder !== 0) return strikeOrder;
      const sideOrder = (a.side === "CE" ? 0 : 1) - (b.side === "CE" ? 0 : 1);
      if (sideOrder !== 0) return sideOrder;
      return Number(a.quantity > 0) - Number(b.quantity > 0);
    }
    const urgencyOrder = (rowUrgency(b) - rowUrgency(a))
      * (sort.direction === "desc" ? 1 : -1);
    if (urgencyOrder !== 0) return urgencyOrder;
  }
  // Keep each risk bucket together while allowing the selected metric to order its legs.
  const aIndex = String(a.index || a.underlying || a.exchange || "").localeCompare(String(b.index || b.underlying || b.exchange || ""));
  if (aIndex !== 0) return aIndex;
  const aExpiry = String(a.expiryIso || a.expiry_iso || "");
  const bExpiry = String(b.expiryIso || b.expiry_iso || "");
  const expiryOrder = aExpiry.localeCompare(bExpiry);
  if (expiryOrder !== 0) return expiryOrder;
  if (!aExpiry) return packageKey(a).localeCompare(packageKey(b));

  if (sort.key !== "strike" && sort.key !== "risk") {
    const left = riskSortValue(a, sort.key);
    const right = riskSortValue(b, sort.key);
    if (left == null) return right == null ? 0 : 1;
    if (right == null) return -1;
    if (left !== right) return (left - right) * (sort.direction === "asc" ? 1 : -1);
  }

  const strikeOrder = (riskSortValue(a, "strike") ?? Number.MAX_SAFE_INTEGER)
    - (riskSortValue(b, "strike") ?? Number.MAX_SAFE_INTEGER);
  if (strikeOrder !== 0) return strikeOrder * (sort.key === "strike" && sort.direction === "desc" ? -1 : 1);
  const sideOrder = (a.side === "CE" ? 0 : 1) - (b.side === "CE" ? 0 : 1);
  if (sideOrder !== 0) return sideOrder;
  return String(a.tradingsymbol || "").localeCompare(String(b.tradingsymbol || ""));
}

function packageLabel(row) {
  return `${row.index || row.underlying || row.exchange || "Index unavailable"} · ${row.expiryIso || row.expiry_iso || "expiry unavailable"}`;
}

function positionRiskExplanation(row) {
  const name = row.display_name || row.tradingsymbol || "This position";
  if (isNearExpiryAndStrike(row)) {
    const distance = Number(row.breachInfo?.distancePct);
    const distanceText = Number.isFinite(distance) ? `${number(distance, 2)}%` : "near";
    return `${name}: expiry is today and spot is ${distanceText} from the sold strike. Check this leg and its same-strike hedge.`;
  }
  if (Number(row.quantity) < 0 && row.breachedAdjust) {
    const distance = Number(row.breachInfo?.distancePct);
    const distanceText = Number.isFinite(distance) ? `${number(distance, 2)}%` : "near";
    return `${name}: spot is ${distanceText} from this sold strike. Check this leg and its same-expiry hedge.`;
  }
  if (row.riskStatus === "High" || row.riskStatus === "Elevated") {
    return `${name}: ${row.riskStatus === "High" ? "high alert" : "on watch"} for its index/expiry risk bucket. ${row.riskReason}`;
  }
  if (row.riskStatus === "Data unavailable") {
    return `${name}: risk cannot be checked reliably. ${row.riskReason}`;
  }
  if (row.riskStatus === "Hedge") return `${name}: Bought hedge leg. Package alerts include this leg with sold options.`;
  return `${name}: no configured risk threshold is currently breached; keep monitoring the sold position.`;
}

function strikeCoverage(sold, bought, uncovered, coveragePct) {
  if (sold <= 0) return bought > 0 ? `No sold leg · ${number(bought, 0)} bought` : "—";
  return `${number(uncovered, 0)} still sold · ${number(coveragePct, 0)}% offset`;
}

function CheckNowPanel({ rows, onShowAll }) {
  const attentionRows = rows
    .filter((row) => (
      Number(row.quantity) < 0
      && (
        row.riskStatus === "High"
        || row.riskStatus === "Elevated"
        || row.riskStatus === "Data unavailable"
        || row.breachedAdjust
      )
    ))
    .slice()
    .sort((a, b) => {
      const statusDiff = rowUrgency(b) - rowUrgency(a);
      if (statusDiff !== 0) return statusDiff;
      const expiryDiff = Number(a.dte ?? Number.MAX_SAFE_INTEGER) - Number(b.dte ?? Number.MAX_SAFE_INTEGER);
      if (expiryDiff !== 0) return expiryDiff;
      return Number(a.breachInfo?.distancePct ?? Number.MAX_SAFE_INTEGER)
        - Number(b.breachInfo?.distancePct ?? Number.MAX_SAFE_INTEGER);
    })
    .slice(0, 3);

  return (
    <section className="position-meter-check-now" aria-labelledby="risk-check-now-title" data-testid="risk-check-now">
      <div className="position-meter-check-now-heading">
        <div>
          <h3 id="risk-check-now-title">Check now</h3>
          <p>{attentionRows.length ? "Sold legs that need a closer look. The full book remains below." : "No sold legs currently meet the risk or strike-watch checks."}</p>
          <p className="position-meter-check-now-note">Same-strike bought quantity is a comparison only, not proof of a strategy or guaranteed cover.</p>
        </div>
        <button type="button" onClick={onShowAll} className="text-xs font-semibold text-sky-700 hover:text-sky-900">Show full book</button>
      </div>
      {attentionRows.length > 0 && (
        <ul className="position-meter-check-now-list">
          {attentionRows.map((row) => {
            const hedge = sameStrikeHedgeCoverage(row, rows);
            const nearExpiry = isNearExpiryAndStrike(row);
            const key = rowKey(row);
            return (
              <li key={key} className={row.riskStatus === "High" ? "is-high" : row.riskStatus === "Elevated" || nearExpiry ? "is-watch" : ""}>
                <div className="position-meter-check-now-title">
                  <strong>{row.display_name || row.tradingsymbol}</strong>
                  <span>{nearExpiry ? "Expiry today + near strike" : row.breachedAdjust ? "Near sold strike" : row.riskStatus}</span>
                </div>
                <p>{positionRiskExplanation(row)}</p>
                <small>
                  {row.breachInfo?.distancePct != null ? `Spot ${number(row.breachInfo.distancePct, 2)}% from strike` : "Strike distance unavailable"}
                  {" · "}Same-strike bought units {number(hedge.bought, 0)}
                  {" · "}Still sold {number(hedge.remaining, 0)} units
                </small>
              </li>
            );
          })}
          {rows.filter((row) => (
            Number(row.quantity) < 0
            && (row.riskStatus === "High" || row.riskStatus === "Elevated" || row.riskStatus === "Data unavailable" || row.breachedAdjust)
          )).length > attentionRows.length && (
            <li className="position-meter-check-now-more">
              More sold legs need review; use the full positions list below.
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function DailyCapitalPanel({ dayCapital, bookedPct, leftover, wallet }) {
  const pct = bookedPct != null && Number.isFinite(Number(bookedPct)) ? Number(bookedPct) : null;
  const margin = leftover != null && wallet != null
    && Number.isFinite(Number(leftover)) && Number.isFinite(Number(wallet)) && Number(wallet) > 0
    ? Number(leftover) / Number(wallet) * 100
    : null;
  const lossProgress = pct == null ? null : Math.min(100, Math.max(0, -pct / Math.abs(DAY_LOSS.defend) * 100));
  const lossStopReached = pct != null && pct <= DAY_LOSS.stopAdds;
  const levelByStatus = {
    ok: "No daily-loss threshold reached",
    caution: "Caution",
    stopAdds: dayCapital?.crumbs && lossStopReached
      ? "Stop adding · loss and margin"
      : dayCapital?.crumbs ? "Low available margin" : "Stop adding",
    defend: "Defend capital",
  };
  const levelLabel = pct == null
    ? dayCapital?.crumbs
      ? "Low available margin"
      : margin == null ? "Guard data unavailable" : "Booked-loss data unavailable"
    : levelByStatus[dayCapital?.level] || "Daily limit unavailable";
  const tone = dayCapital?.level === "defend" || dayCapital?.level === "stopAdds"
    ? "is-high"
    : dayCapital?.level === "caution" ? "is-watch" : "";

  return (
    <section className={`position-meter-capital ${tone}`} aria-label="Daily loss and margin guard" data-testid="risk-capital-guard">
      <div className="position-meter-capital-top">
        <div>
          <h3>Daily loss &amp; margin guard</h3>
          <p>Existing Positions guard · booked P&amp;L after charges, not open MTM</p>
        </div>
        <strong>{levelLabel}</strong>
      </div>
      <div className="position-meter-capital-metrics">
        <div className="position-meter-capital-loss">
          <span>Booked today</span>
          <strong>{pct == null ? "Unavailable" : `${pct > 0 ? "+" : ""}${number(pct, 2)}% of wallet`}</strong>
          <div className="position-meter-capital-track" role="img" aria-label={lossProgress == null ? "Daily loss progress unavailable" : `${number(lossProgress, 0)}% of the 8% defend threshold`}>
            <span style={{ width: `${lossProgress ?? 0}%` }} />
            <i className="is-caution" />
            <i className="is-stop" />
            <i className="is-defend" />
          </div>
          <small>Caution {DAY_LOSS.caution}% · stop adds {DAY_LOSS.stopAdds}% · defend {DAY_LOSS.defend}%</small>
        </div>
        <div>
          <span>Kite available margin</span>
          <strong>{margin == null ? "Unavailable" : `${money(leftover)} · ${number(margin, 2)}% of wallet`}</strong>
          <small>{dayCapital?.crumbs ? "Low-margin guard active; avoid treating leftover as new risk capital." : "Existing low-margin stop: available funds below 0.5% of wallet."}</small>
        </div>
      </div>
    </section>
  );
}

function MetricCard({ label, value, note, tone = "neutral", onClick, active = false }) {
  const tones = {
    positive: "text-emerald-700",
    negative: "text-rose-700",
    warning: "text-amber-700",
    neutral: "text-slate-900",
  };
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`position-meter-metric min-w-0 rounded-lg border p-4 text-left ${
        active ? "border-rose-300 bg-rose-50/60" : "border-slate-200 bg-slate-50/70"
      } ${onClick ? "hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500" : ""}`}
      data-testid={onClick ? "risk-card-filter" : undefined}
      aria-pressed={onClick ? active : undefined}
    >
      <div className="text-sm font-medium text-slate-600">{label}</div>
      <div className={`mt-2 text-2xl font-semibold leading-tight tabular-nums ${tones[tone]}`}>
        {value}
      </div>
      <div className="mt-2 text-xs leading-relaxed text-slate-500">{note}</div>
    </Tag>
  );
}

function StatusPill({ status }) {
  const labels = {
    High: "High alert",
    Elevated: "Watch",
    Normal: "Within limits",
    Hedge: "Hedge leg",
    "Data unavailable": "Need data",
  };
  return (
    <span className={`inline-flex whitespace-nowrap items-center rounded-md border px-2.5 py-1 text-xs font-semibold ${statusStyle(status)}`}>
      {labels[status] || status}
    </span>
  );
}

function ScenarioBar({ label, value, scale }) {
  if (value == null) {
    return (
      <div className="position-meter-scenario-row" aria-label={`${label}: unavailable`}>
        <span className="position-meter-scenario-label">{label}</span>
        <span className="position-meter-scenario-track"><span className="position-meter-scenario-zero" /></span>
        <span className="position-meter-scenario-value text-slate-400">No data</span>
      </div>
    );
  }
  const magnitude = scale > 0 ? Math.min(50, Math.abs(value) / scale * 50) : 0;
  const isLoss = value < 0;
  return (
    <div className="position-meter-scenario-row" aria-label={`${label}: estimated ${money(value)}`}>
      <span className="position-meter-scenario-label">{label}</span>
      <span className="position-meter-scenario-track" aria-hidden="true">
        <span className="position-meter-scenario-zero" />
        <span
          className={`position-meter-scenario-bar ${isLoss ? "is-loss" : "is-gain"}`}
          style={{
            width: `${magnitude}%`,
            ...(isLoss ? { right: "50%" } : { left: "50%" }),
          }}
        />
      </span>
      <span className={`position-meter-scenario-value ${isLoss ? "text-rose-700" : value > 0 ? "text-emerald-700" : "text-slate-600"}`}>
        {money(value)}
      </span>
    </div>
  );
}

function RiskDistribution({ book }) {
  const segments = [
    { label: "Within limits", count: Math.max(0, book.totals.openCount - book.totals.atRiskCount - book.totals.missingCount - book.totals.hedgeCount), style: "is-normal" },
    { label: "Watch", count: book.totals.atRiskCount - book.totals.highCount, style: "is-watch" },
    { label: "High alert", count: book.totals.highCount, style: "is-high" },
    { label: "Hedge legs", count: book.totals.hedgeCount, style: "is-hedge" },
    { label: "Need data", count: book.totals.missingCount, style: "is-missing" },
  ];
  const total = book.totals.openCount;

  if (total === 0) return null;
  return (
    <section className="position-meter-distribution" aria-label="Position alert breakdown" data-testid="risk-distribution">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-800">Position overview</h3>
          <p className="mt-1 text-sm text-slate-500">Each segment shows how many open positions are in that group.</p>
        </div>
        <span className="shrink-0 text-sm font-medium text-slate-500">{total} open {total === 1 ? "position" : "positions"}</span>
      </div>
      <div className="position-meter-distribution-bar" role="img" aria-label={segments.map(({ label, count }) => `${count} ${label}`).join(", ")}>
        {segments.filter(({ count }) => count > 0).map(({ label, count, style }) => (
          <span
            key={label}
            className={`position-meter-distribution-segment ${style}`}
            style={{ width: `${count / total * 100}%` }}
            title={`${count} ${label}`}
          />
        ))}
      </div>
      <div className="position-meter-distribution-legend">
        {segments.map(({ label, count, style }) => (
          <span key={label} className="position-meter-legend-item">
            <span className={`position-meter-legend-dot ${style}`} />
            <span>{label}</span>
            <strong>{count}</strong>
          </span>
        ))}
      </div>
    </section>
  );
}

function sellerScenarioLabel(scenario) {
  const direction = scenario.pricePct > 0 ? "up" : "down";
  const ivDirection = scenario.ivPp > 0 ? "up" : "down";
  return `Index ${direction} ${number(Math.abs(scenario.pricePct), 1)}% · IV ${ivDirection} ${number(Math.abs(scenario.ivPp), 1)} points · 1 day`;
}

function SellerPackagePanel({ packages, settings }) {
  const sortedPackages = packages.slice().sort((a, b) => (
    String(a.index || "").localeCompare(String(b.index || ""))
      || String(a.expiry || "").localeCompare(String(b.expiry || ""))
  ));
  return (
    <section className="position-meter-seller-packages" aria-labelledby="risk-seller-packages-title" data-testid="risk-seller-packages">
      <header>
        <div>
          <h3 id="risk-seller-packages-title">Short positions &amp; hedges</h3>
        </div>
      </header>
      {sortedPackages.length === 0 ? (
        <p className="position-meter-seller-empty">No open sold option legs to assess. Bought-only options remain visible in Open positions.</p>
      ) : (
        <div className="position-meter-seller-package-list">
          {sortedPackages.map((optionPackage) => (
            <article className="position-meter-seller-package" key={optionPackage.key}>
              <div className="position-meter-seller-package-title">
                <div>
                  <h4>{optionPackage.index || "Index unavailable"} · {optionPackage.expiry || "expiry unavailable"}</h4>
                  <p>{optionPackage.soldCount} sold · {optionPackage.hedgeCount} bought hedge</p>
                </div>
                <StatusPill status={optionPackage.riskStatus} />
              </div>
              <div className="position-meter-package-quick">
                <div><span>Open P&amp;L</span><strong className={optionPackage.pnl < 0 ? "text-rose-700" : "text-emerald-700"}>{money(optionPackage.pnl)}</strong></div>
                <div><span>Net ₹ if index moves 1%</span><strong>{money(optionPackage.netDeltaInrPerPct)}</strong></div>
                <div><span>Net Theta / day</span><strong>{money(optionPackage.netThetaInrPerDay)}</strong></div>
              </div>
              <details className="position-meter-package-details">
                <summary>Strike breakdown &amp; what-if estimates</summary>
                <div className="position-meter-seller-metrics">
                  <div><span>Net Gamma · ±{number(settings.priceShockPct, 1)}% move</span><strong>{money(optionPackage.netGammaImpactInr)}</strong></div>
                  <div><span>Current sold-option close value</span><strong>{money(optionPackage.soldOptionValue)}</strong></div>
                </div>
                <div className="position-meter-seller-scenarios">
                  <h5>Combined estimates · index + IV move + one day</h5>
                  {optionPackage.scenarios.map((scenario) => (
                    <div key={`${scenario.pricePct}:${scenario.ivPp}`}>
                      <span>{sellerScenarioLabel(scenario)}</span>
                      <strong className={scenario.pnl == null ? "" : scenario.pnl < 0 ? "text-rose-700" : scenario.pnl > 0 ? "text-emerald-700" : ""}>
                        {scenario.pnl == null ? "Unavailable" : money(scenario.pnl)}
                      </strong>
                    </div>
                  ))}
                </div>
                <div className="position-meter-strike-wrap">
                  <h5>Strike breakdown</h5>
                  <div className="overflow-x-auto">
                    <table className="position-meter-strike-table">
                      <thead>
                        <tr>
                          <th>Strike</th>
                          <th>CE sell</th>
                          <th>CE hedge</th>
                          <th>CE still short</th>
                          <th>PE sell</th>
                          <th>PE hedge</th>
                          <th>PE still short</th>
                          <th>Net Delta / 1%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {optionPackage.strikeBuckets.map((strike) => (
                          <tr key={strike.strike ?? "unknown"}>
                            <th scope="row">{strike.strike == null ? "Unavailable" : number(strike.strike, 0)}</th>
                            <td>{number(strike.callSellQuantity, 0)}</td>
                            <td>{number(strike.callBuyQuantity, 0)}</td>
                            <td>{strikeCoverage(
                              strike.callSellQuantity,
                              strike.callBuyQuantity,
                              strike.callUncoveredQuantity,
                              strike.callCoveragePct,
                            )}</td>
                            <td>{number(strike.putSellQuantity, 0)}</td>
                            <td>{number(strike.putBuyQuantity, 0)}</td>
                            <td>{strikeCoverage(
                              strike.putSellQuantity,
                              strike.putBuyQuantity,
                              strike.putUncoveredQuantity,
                              strike.putCoveragePct,
                            )}</td>
                            <td>{money(strike.deltaInrPerPct)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p>Coverage compares only the same index, expiry, strike and option type. It is a quantity comparison, not proof of a broker strategy or a guarantee of protection. Quantities are Kite units; lot size is not multiplied again.</p>
                </div>
              </details>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function MarketImpactPanel({ rows, priceShockPct, ivShockPp, onShowMissing }) {
  if (rows.length === 0) return null;
  const scenarios = [
    {
      label: `Index goes up ${number(priceShockPct, 1)}%`,
      help: "All held indexes are tested with the same percentage move.",
      value: aggregateRiskScenario(rows, { pricePct: priceShockPct }),
    },
    {
      label: `Index goes down ${number(priceShockPct, 1)}%`,
      help: "All held indexes are tested with the same percentage move.",
      value: aggregateRiskScenario(rows, { pricePct: -priceShockPct }),
    },
    {
      label: "Options expect bigger moves",
      help: `Option prices are tested with IV up ${number(ivShockPp, 1)} points.`,
      value: aggregateRiskScenario(rows, { ivPp: ivShockPp }),
    },
    {
      label: "Options expect smaller moves",
      help: `Option prices are tested with IV down ${number(ivShockPp, 1)} points.`,
      value: aggregateRiskScenario(rows, { ivPp: -ivShockPp }),
    },
    {
      label: "One day passes",
      help: "Index and expected movement stay unchanged.",
      value: aggregateRiskScenario(rows, { days: 1 }),
    },
  ];
  const unavailable = scenarios.some(({ value }) => value == null);
  if (unavailable) {
    return (
      <section className="position-meter-impact" aria-labelledby="risk-impact-title" data-testid="risk-impact">
        <h3 id="risk-impact-title">What could change your open-position value?</h3>
        <p className="mt-2 text-sm text-slate-600">
          We can’t estimate the whole book because one or more positions need reliable data. Showing a partial amount could hide risk.
        </p>
        <button type="button" onClick={onShowMissing} className="mt-3 text-sm font-semibold text-sky-700 hover:text-sky-900">
          Show positions needing data
        </button>
      </section>
    );
  }

  const scale = Math.max(0, ...scenarios.map(({ value }) => Math.abs(value)));
  return (
    <section className="position-meter-impact" aria-labelledby="risk-impact-title" data-testid="risk-impact">
      <div className="position-meter-impact-heading">
        <div>
          <h3 id="risk-impact-title">What could change your open-position value?</h3>
          <p>We change one thing at a time. Red means an estimated loss; green means an estimated gain.</p>
        </div>
      </div>
      <div className="position-meter-impact-scale" aria-hidden="true"><span>Estimated loss</span><span>₹0</span><span>Estimated gain</span></div>
      <div className="position-meter-impact-list">
        {scenarios.map((scenario) => {
          const isLoss = scenario.value < 0;
          const width = scale > 0 ? Math.min(50, Math.abs(scenario.value) / scale * 50) : 0;
          return (
            <article className="position-meter-impact-row" key={scenario.label}>
              <div className="position-meter-impact-copy">
                <strong>{scenario.label}</strong>
                <span>{scenario.help}</span>
              </div>
              <div className="position-meter-impact-track" aria-hidden="true">
                <span className="position-meter-impact-zero" />
                <span
                  className={`position-meter-impact-bar ${isLoss ? "is-loss" : "is-gain"}`}
                  style={{
                    width: `${width}%`,
                    ...(isLoss ? { right: "50%" } : { left: "50%" }),
                  }}
                />
              </div>
              <div className="position-meter-impact-value">
                <strong className={isLoss ? "text-rose-700" : scenario.value > 0 ? "text-emerald-700" : "text-slate-700"}>
                  {scenario.value > 0 ? "+" : ""}{money(scenario.value)}
                </strong>
                <span>estimated change</span>
              </div>
            </article>
          );
        })}
      </div>
      <p className="position-meter-impact-footnote">These are model estimates for all open positions together. They are not guaranteed P&amp;L.</p>
    </section>
  );
}

function PositionDetails({ row, ivChangePp }) {
  const metrics = row.riskMetrics;
  const capture = openShortPremiumCapture(row);
  return (
    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-100 pt-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
      <div><span className="text-slate-400">Entry option price</span><div className="font-mono-data text-slate-700">{money(row.average_price, 2)}</div></div>
      <div><span className="text-slate-400">Current option price</span><div className="font-mono-data text-slate-700">{money(row.last_price, 2)}</div></div>
      {Number(row.quantity) < 0 && (
        <div>
          <span className="text-slate-400">Captured vs average entry · mark only</span>
          <div className={`font-mono-data ${capture?.value < 0 ? "text-rose-700" : "text-emerald-700"}`}>
            {capture ? `${money(capture.value)} · ${number(capture.percent, 1)}%` : "Unavailable"}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {capture
              ? `${money(capture.entryPrice, 2)} entry → ${money(capture.buybackPrice, 2)} LTP mark · before charges`
              : "Needs average entry and current option price."}
          </div>
        </div>
      )}
      <div><span className="text-slate-400">Model-implied volatility (IV)</span><div className="font-mono-data text-slate-700">{metrics ? `${number(metrics.ivPct, 1)}%` : "Unavailable"}</div></div>
      <div><span className="text-slate-400">IV change since last read</span><div className="font-mono-data text-slate-700">{ivChangePp == null ? "Not measured yet" : `${ivChangePp > 0 ? "+" : ""}${number(ivChangePp, 2)} IV points`}</div><div className="mt-1 text-xs text-slate-500">Compared only between recent successful reads in this browser session.</div></div>
      <div><span className="text-slate-400">Estimated value change per IV point</span><div className="font-mono-data text-slate-700">{metrics ? money(metrics.vega * metrics.signedQuantity, 2) : "—"}</div></div>
      <div><span className="text-slate-400">Expiry in</span><div className="font-mono-data text-slate-700">{metrics ? `${number(metrics.dte, 1)} days` : "Unavailable"}</div></div>
      <div className="col-span-2 sm:col-span-3 lg:col-span-6 rounded-md bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
        <strong>IV in plain words:</strong> implied volatility is the annualised movement that this option’s price implies; it does not tell you whether the index will go up or down. For example, IV moving from 20% to 21% is an increase of 1 IV point, not 1% of the option price. This is model-implied from the option LTP, spot, strike, and expiry using a 6.5% interest-rate assumption and no dividend input. A stale or wide quote can distort it.
      </div>
      <div className="col-span-2 sm:col-span-3 lg:col-span-6">
        <span className="font-medium text-slate-600">Why this status</span>
        <div className="mt-0.5 break-words text-slate-700">{positionRiskExplanation(row)}</div>
        <div className="mt-1 text-xs text-slate-500">Individual option quote timestamp is not provided by the Positions feed.</div>
      </div>
    </div>
  );
}

function PositionCard({ row, ivChangePp, lastRefresh, now, expanded, onToggle }) {
  const metrics = row.riskMetrics;
  const capture = openShortPremiumCapture(row);
  const quantity = Number(row.quantity);
  const lots = Number(row.lot_size) > 0 ? `${number(Math.abs(quantity) / Number(row.lot_size), 2)} lots` : "lots unavailable";
  return (
    <article className={`rounded-lg border p-3 ${row.riskStatus === "High" ? "border-rose-200 bg-rose-50/30" : row.riskStatus === "Elevated" ? "border-amber-200 bg-amber-50/30" : "border-slate-200 bg-white"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-slate-900">{row.display_name || row.tradingsymbol}</div>
          <div className="mt-1 text-xs text-slate-500">
            {row.index || row.exchange || "—"} · {quantity < 0 ? "Sell" : "Buy"} · {Math.abs(quantity).toLocaleString("en-IN")} qty · {lots}
          </div>
        </div>
        <StatusPill status={row.riskStatus} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div><div className="text-slate-400">Unrealized P&amp;L</div><div className={`mt-0.5 font-semibold font-mono-data ${Number(row.unrealised) < 0 ? "text-rose-700" : "text-emerald-700"}`}>{money(row.unrealised)}</div></div>
        <div><div className="text-slate-400">If index moves 1%</div><div className="mt-0.5 font-semibold font-mono-data text-slate-800">{money(metrics?.deltaInrPerPct)}</div></div>
        <div><div className="text-slate-400">If one day passes</div><div className="mt-0.5 font-semibold font-mono-data text-slate-800">{money(metrics?.thetaInrPerDay)}</div></div>
      </div>
      {quantity < 0 && (
        <div className="mt-2 rounded-md bg-slate-50 px-2 py-1.5 text-xs">
          <span className="text-slate-500">Captured vs entry · mark only · </span>
          <strong className={capture?.value < 0 ? "text-rose-700" : "text-emerald-700"}>
            {capture ? `${money(capture.value)} (${number(capture.percent, 1)}%)` : "Unavailable"}
          </strong>
          {capture && <span className="ml-1 text-slate-500">{money(capture.entryPrice, 2)} → {money(capture.buybackPrice, 2)} LTP</span>}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-2 text-xs">
        <span className="text-slate-600">IV (implied volatility) {metrics ? `${number(metrics.ivPct, 1)}%` : "—"}</span>
        <button type="button" className="inline-flex h-7 items-center gap-1 rounded px-2 text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500" onClick={onToggle} aria-expanded={expanded}>
          {expanded ? "Less" : "Details"} {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-slate-600">{positionRiskExplanation(row)}</p>
      <p className="mt-1 text-[10px] text-slate-400">
        Book updated {ageLabel(lastRefresh, now)} · option quote time unavailable
      </p>
      {expanded && <PositionDetails row={row} ivChangePp={ivChangePp} />}
    </article>
  );
}

export default function RiskManagementPanel({
  rows = [],
  lastRefresh = null,
  pollMs = 30000,
  dataError = null,
  pnlToday = null,
  dayCapital = null,
  dayBookedPct = null,
  fundsLeftover = null,
  wallet = null,
  loading = false,
  onRefresh,
}) {
  const [settings, setSettings] = useState(loadSettings);
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState({ key: "risk", direction: "desc" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [ivChanges, setIvChanges] = useState({});
  const observedRefresh = useRef(null);
  const now = Date.now();
  const refreshMs = Date.parse(lastRefresh || "");
  const staleAfterMs = Math.max(Number(pollMs) * 2, 120000);
  const stale = !Number.isFinite(refreshMs) || now - refreshMs > staleAfterMs || !!dataError;
  const book = useMemo(
    () => calculateRiskBook(rows, settings, { stale, ivChanges }),
    [rows, settings, stale, ivChanges],
  );
  const sellerDecay = useMemo(() => summarizeSellerDecay(rows), [rows]);
  const sellerCapture = useMemo(() => summarizeOpenShortCapture(rows), [rows]);
  const attentionRows = book.positions.filter((row) => (
    row.riskStatus === "Elevated"
    || row.riskStatus === "High"
    || row.riskStatus === "Data unavailable"
    || (row.breachedAdjust && Number(row.quantity) < 0)
  ));
  const nearStrikeOnlyCount = book.positions.filter((row) => (
    row.breachedAdjust
    && Number(row.quantity) < 0
    && row.riskStatus !== "Elevated"
    && row.riskStatus !== "High"
    && row.riskStatus !== "Data unavailable"
  )).length;

  useEffect(() => {
    if (!lastRefresh || lastRefresh === observedRefresh.current || dataError) return;
    observedRefresh.current = lastRefresh;
    const at = Date.parse(lastRefresh);
    const maxGapMs = Math.max(Number(pollMs) * 2, 120000);
    const changes = {};
    book.positions.forEach((row) => {
      const iv = row.riskMetrics?.ivPct;
      if (iv == null) return;
      const key = rowKey(row);
      let previous = null;
      try {
        previous = JSON.parse(sessionStorage.getItem(`oi-risk-iv:${key}`) || "null");
      } catch {
        previous = null;
      }
      const gap = at - Number(previous?.at);
      if (Number.isFinite(previous?.iv) && gap > 0 && gap <= maxGapMs) {
        changes[key] = iv - previous.iv;
      }
      try {
        sessionStorage.setItem(`oi-risk-iv:${key}`, JSON.stringify({ iv, at }));
      } catch {
        // IV history is optional; no historical source is implied when storage is unavailable.
      }
    });
    setIvChanges(changes);
  }, [book.positions, dataError, lastRefresh, pollMs]);

  const openRows = book.positions;
  const visibleRows = useMemo(() => {
    const alertPackageKeys = new Set(openRows
      .filter((row) => row.riskStatus === "Elevated" || row.riskStatus === "High")
      .map(packageKey));
    // Show matching bought hedges with an alert so users can see the full package.
    const selected = openRows.filter((row) => (
      filter === "risk"
        ? row.riskStatus === "Elevated" || row.riskStatus === "High"
          || row.riskStatus === "Data unavailable"
          || (row.breachedAdjust && Number(row.quantity) < 0)
          || (row.riskStatus === "Hedge" && alertPackageKeys.has(packageKey(row)))
        : filter === "missing"
          ? row.riskStatus === "Data unavailable"
          : true
    ));
    return selected.slice().sort((a, b) => comparePackageRows(a, b, sort));
  }, [filter, openRows, sort]);

  const saveSetting = (key, value) => {
    const next = normalizeRiskSettings({ ...settings, [key]: Number(value) });
    setSettings(next);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // Risk thresholds still work for this page view when browser storage is disabled.
    }
  };
  const resetSettings = () => {
    const defaults = { ...DEFAULT_RISK_SETTINGS };
    setSettings(defaults);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(defaults));
    } catch {
      // Defaults remain active for this view even if storage is unavailable.
    }
  };

  const toggleSort = (key) => setSort((current) => ({
    key,
    direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
  }));
  const toggleExpanded = (key) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const deltaValue = book.totals.netDeltaInrPerPct;
  const pAndLValue = book.totals.pnl;
  const dailyPnl = pnlToday?.total != null && Number.isFinite(Number(pnlToday.total))
    ? Number(pnlToday.total)
    : null;
  const bookedPnl = pnlToday?.booked != null && Number.isFinite(Number(pnlToday.booked))
    ? Number(pnlToday.booked)
    : null;
  const unbookedPnl = (pnlToday?.unbooked ?? pnlToday?.open) != null
    && Number.isFinite(Number(pnlToday.unbooked ?? pnlToday.open))
    ? Number(pnlToday.unbooked ?? pnlToday.open)
    : null;
  const dailyPnlNote = bookedPnl != null && unbookedPnl != null
    ? `Booked ${money(bookedPnl)} · open ${money(unbookedPnl)} · updated ${ageLabel(lastRefresh, now)}`
    : `Broker total · updated ${ageLabel(lastRefresh, now)}`;
  const ivShock = settings.ivShockPp;
  const priceShock = settings.priceShockPct;
  const priceScenarios = [
    { label: "Index down 0.5%", pricePct: -0.5 },
    { label: "Index up 0.5%", pricePct: 0.5 },
    { label: "Index down 1%", pricePct: -1 },
    { label: "Index up 1%", pricePct: 1 },
    { label: "Index down 2%", pricePct: -2 },
    { label: "Index up 2%", pricePct: 2 },
  ];
  const scenarioGroups = [
    {
      title: "If the index moves",
      rows: priceScenarios.map(({ label, pricePct }) => ({
        label,
        value: aggregateRiskScenario(openRows, { pricePct }),
      })),
    },
    {
      title: "If IV changes",
      rows: [-ivShock, ivShock].map((ivPp) => ({
        label: `IV ${ivPp > 0 ? "up" : "down"} ${number(Math.abs(ivPp), 1)} points`,
        value: aggregateRiskScenario(openRows, { ivPp }),
      })),
    },
    {
      title: "If one day passes",
      rows: [{
        label: "Time only · no index or IV move",
        value: aggregateRiskScenario(openRows, { days: 1 }),
      }],
    },
    {
      title: "If index and IV both move",
      rows: [
        { pricePct: priceShock, ivPp: ivShock, label: `Index up ${number(priceShock, 1)}% · IV up ${number(ivShock, 1)}` },
        { pricePct: -priceShock, ivPp: -ivShock, label: `Index down ${number(priceShock, 1)}% · IV down ${number(ivShock, 1)}` },
      ].map(({ label, pricePct, ivPp }) => ({
        label,
        value: aggregateRiskScenario(openRows, { pricePct, ivPp, days: 1 }),
      })),
    },
  ];
  const scenarioScale = Math.max(
    0,
    ...scenarioGroups.flatMap((group) => group.rows.map(({ value }) => Math.abs(value || 0))),
  );

  return (
    <section className="risk-management-content space-y-3" data-testid="risk-management-page">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold leading-tight tracking-tight text-slate-900">PositionMeter</h2>
          <p className="mt-1 text-sm text-slate-500">Seller view · sold options and bought hedges by expiry and strike.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium ${stale ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${stale ? "bg-amber-500" : "bg-emerald-500"}`} />
            {stale ? "Data stale / unavailable" : "Book recently updated"}
          </span>
          {onRefresh && (
            <button type="button" onClick={onRefresh} disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50" data-testid="risk-refresh">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          )}
        </div>
      </header>

      {(stale || book.totals.missingCount > 0) && (
        <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900" role="status" data-testid="risk-data-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {dataError
              ? `Latest broker read failed: ${dataError} `
              : stale ? "The latest Positions response is too old to assess reliably. " : ""}
            Last Positions response: {ageLabel(lastRefresh, now)}. Kite’s option quote timestamp is not included in the existing Positions response.
          </span>
        </div>
      )}

      <div className={`position-meter-freshness ${stale ? "is-stale" : ""}`} data-testid="risk-data-freshness">
        <span>{stale ? "P&L and risk inputs may be stale" : `P&L and risk checked ${ageLabel(lastRefresh, now)}`}</span>
        <span>Option quote time is not provided by the Positions feed.</span>
      </div>

      <div className="position-meter-summary">
        <MetricCard
          label="Premium captured"
          value={sellerCapture.value == null ? "Unavailable" : money(sellerCapture.value)}
          tone={sellerCapture.value == null ? "warning" : sellerCapture.value >= 0 ? "positive" : "negative"}
          note={sellerCapture.percent == null
            ? `${sellerCapture.missingCount} sold option(s) need entry / buyback data`
            : `${number(sellerCapture.percent, 1)}% vs entry · LTP mark, not booked; before costs`}
        />
        <MetricCard
          label="Today’s P&L"
          value={dailyPnl == null ? "Unavailable" : money(dailyPnl)}
          tone={dailyPnl == null ? "warning" : dailyPnl >= 0 ? "positive" : "negative"}
          note={dailyPnlNote}
        />
        <MetricCard
          label="Open P&L"
          value={pAndLValue == null ? "Unavailable" : money(pAndLValue)}
          tone={pAndLValue == null ? "warning" : pAndLValue >= 0 ? "positive" : "negative"}
          note="Unrealized · open positions only"
        />
        <MetricCard
          label="Premium left to decay"
          value={sellerDecay.value == null ? "Unavailable" : money(sellerDecay.value)}
          tone={sellerDecay.value == null ? "warning" : "neutral"}
          note={sellerDecay.shortCount === 0
            ? "No open sold options"
            : sellerDecay.value == null
              ? `${sellerDecay.missingCount} sold option(s) need data`
              : "Remaining time value · not profit; before hedge costs"}
        />
        <MetricCard
          label="Net Delta · ₹ / 1%"
          value={deltaValue == null ? "Unavailable" : `${deltaValue > 0 ? "+" : deltaValue < 0 ? "−" : ""}${money(Math.abs(deltaValue))}`}
          tone={deltaValue == null ? "warning" : deltaValue >= 0 ? "positive" : "negative"}
          note={deltaValue == null ? "Need complete option data" : "Across all open positions"}
        />
        <MetricCard
          label="Alerts to check"
          value={String(attentionRows.length)}
          tone={book.totals.highCount > 0 || book.totals.atRiskCount > 0 || nearStrikeOnlyCount > 0
            ? "negative"
            : attentionRows.length > 0 ? "warning" : "neutral"}
          note={`${book.totals.highCount} high · ${book.totals.atRiskCount - book.totals.highCount} watch · ${nearStrikeOnlyCount} near strike · ${book.totals.missingCount} need data`}
          onClick={() => setFilter((current) => current === "risk" ? "all" : "risk")}
          active={filter === "risk"}
        />
      </div>

      <DailyCapitalPanel
        dayCapital={dayCapital}
        bookedPct={dayBookedPct}
        leftover={fundsLeftover}
        wallet={wallet}
      />
      <CheckNowPanel rows={openRows} onShowAll={() => setFilter("all")} />

      <SellerPackagePanel packages={book.sellerPackages} settings={settings} />

      <details className="position-meter-secondary" data-testid="risk-advanced-data">
        <summary>Extra whole-book estimates</summary>
        <p>These combine every open position into one view. Use the expiry package above to see seller and hedge legs together.</p>
        <MarketImpactPanel
          rows={openRows}
          priceShockPct={priceShock}
          ivShockPp={ivShock}
          onShowMissing={() => setFilter("missing")}
        />
        <RiskDistribution book={book} />
      </details>

      <details className="position-meter-secondary" data-testid="risk-method-details">
        <summary>How alerts are calculated</summary>
        <p>
          Sold positions are re-priced with bought options grouped by index and expiry; this grouping is not a broker strategy ID. Watch and High compare the worst estimated combined loss with the current close value of the sold options. Bought options are not alerted solely for premium decay. IV and Greeks are model estimates, not direct Kite quotes. Missing or stale inputs prevent a reliable package alert.
        </p>
      </details>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Open positions <span className="font-normal text-slate-500">({book.totals.openCount})</span></h3>
          <p className="mt-1 text-xs text-slate-500">Last update: {ageLabel(lastRefresh, now)} · bought legs are treated as hedges.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <select aria-label="Filter risk positions" value={filter} onChange={(event) => setFilter(event.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700">
            <option value="all">Show all</option>
            <option value="risk">Show alerts</option>
            <option value="missing">Show missing data</option>
          </select>
          <label className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-500">
            Sort
            <select aria-label="Sort risk positions" value={sort.key} onChange={(event) => toggleSort(event.target.value)} className="max-w-[9rem] bg-transparent text-sm text-slate-700 focus:outline-none">
              <option value="strike">Expiry / strike</option>
              <option value="risk">Urgency / risk</option>
              <option value="pnl">P&amp;L</option>
              <option value="delta">Delta</option>
              <option value="gamma">Gamma</option>
              <option value="theta">Theta</option>
              <option value="iv">IV (implied volatility)</option>
            </select>
            <button type="button" onClick={() => setSort((value) => ({ ...value, direction: value.direction === "desc" ? "asc" : "desc" }))} aria-label={`Sort ${sort.direction === "desc" ? "ascending" : "descending"}`} className="text-slate-500">
              {sort.direction === "desc" ? "↓" : "↑"}
            </button>
          </label>
          <button type="button" onClick={() => setSettingsOpen((value) => !value)} className={`inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium ${settingsOpen ? "border-sky-300 bg-sky-50 text-sky-800" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`} aria-expanded={settingsOpen} data-testid="risk-settings-toggle">
            <Settings2 className="h-3.5 w-3.5" /> Alert settings
          </button>
        </div>
      </div>

      {settingsOpen && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs sm:grid-cols-3 xl:grid-cols-6" data-testid="risk-settings">
          {[
            { key: "priceShockPct", label: "Index move tested (%)", help: "Tested both up and down.", min: 0.1, max: 10, step: 0.1 },
            { key: "ivShockPp", label: "IV move tested (points)", help: "20% to 22% = +2 points.", min: 0.1, max: 30, step: 0.1 },
            { key: "watchLossPct", label: "Watch (% sold-option value)", help: "Combined package loss threshold.", min: 1, max: 99, step: 1 },
            { key: "criticalLossPct", label: "High (% sold-option value)", help: "Critical combined package loss threshold.", min: 1, max: 100, step: 1 },
          ].map(({ key, label, help, min, max, step }) => (
            <label key={key} className="space-y-1 text-slate-600">
              <span className="block text-sm">{label}</span>
              <span className="block min-h-8 text-xs leading-relaxed text-slate-500">{help}</span>
              <input type="number" min={min} max={max} step={step} value={settings[key]} onChange={(event) => saveSetting(key, event.target.value)} className="mt-1 h-10 w-full rounded border border-slate-200 bg-white px-3 font-mono-data text-sm text-slate-800" />
            </label>
          ))}
          <p className="col-span-2 text-xs leading-relaxed text-slate-500 sm:col-span-3 xl:col-span-6">
            Settings stay in this browser. The model re-prices every option in the same index/expiry group after the selected index, IV, and time changes, including bought hedge legs, then compares the combined estimated loss with the sold options’ current value. This is not account equity or the maximum possible loss on a sold option.
          </p>
          <button type="button" onClick={resetSettings} className="col-span-2 justify-self-start text-sm font-medium text-sky-700 hover:text-sky-900 focus:outline-none focus:ring-2 focus:ring-sky-500 sm:col-span-3 xl:col-span-6">Reset to defaults</button>
        </div>
      )}

      {loading && openRows.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-6 text-center text-[12px] text-slate-500" role="status">Loading open positions…</div>
      ) : openRows.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-6 text-center text-[12px] text-slate-600" data-testid="risk-empty">
          No open positions in the current Kite book.
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-6 text-center text-[12px] text-slate-600">No positions match this filter.</div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 lg:block">
            <table className="w-full min-w-[1360px] table-fixed border-collapse text-left text-sm" data-testid="risk-positions-table">
              <colgroup>
                <col className="w-[16%]" />
                <col className="w-[9%]" />
                <col className="w-[9%]" />
                <col className="w-[13%]" />
                <col className="w-[12%]" />
                <col className="w-[12%]" />
                <col className="w-[10%]" />
                <col className="w-[6%]" />
                <col className="w-[13%]" />
              </colgroup>
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  {["Position", "Side / Qty", "Unrealized P&L", "Captured on open short", "Delta · ₹ / 1% move", `Gamma impact · ±${number(priceShock, 1)}%`, "Theta · ₹ / day", "Model IV¹", "Risk / reason"].map((heading) => (
                    <th key={heading} className="whitespace-normal border-b border-slate-200 px-3 py-3 font-semibold leading-snug">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, index) => {
                  const key = rowKey(row);
                  const metrics = row.riskMetrics;
                  const ivChange = ivChanges[key];
                  const showPackageHeading = index === 0
                    || packageKey(visibleRows[index - 1]) !== packageKey(row);
                  return (
                    <Fragment key={key}>
                      {showPackageHeading && (
                        <tr className="position-meter-package-heading">
                          <th colSpan={9} scope="rowgroup">
                            <span>{packageLabel(row)}</span>
                            <span className="ml-2 font-normal text-slate-500">Expiry risk bucket · not a broker strategy · urgent shorts first</span>
                          </th>
                        </tr>
                      )}
                      <FragmentRow
                        row={row}
                        metrics={metrics}
                        ivChange={ivChange}
                        priceShockPct={priceShock}
                        expanded={expanded.has(key)}
                        onToggle={() => toggleExpanded(key)}
                      />
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 lg:hidden" data-testid="risk-position-cards">
            {visibleRows.map((row, index) => {
              const key = rowKey(row);
              return (
                <Fragment key={key}>
                  {(index === 0 || packageKey(visibleRows[index - 1]) !== packageKey(row)) && (
                    <h4 className="position-meter-package-heading position-meter-package-card-heading">
                      {packageLabel(row)}
                      <span>Strikes shown in order</span>
                    </h4>
                  )}
                  <PositionCard
                    row={row}
                    ivChangePp={ivChanges[key]}
                    lastRefresh={lastRefresh}
                    now={now}
                    expanded={expanded.has(key)}
                    onToggle={() => toggleExpanded(key)}
                  />
                </Fragment>
              );
            })}
          </div>
        </>
      )}

    </section>
  );
}

function FragmentRow({ row, metrics, ivChange, priceShockPct, expanded, onToggle }) {
  const qty = Number(row.quantity);
  const capture = openShortPremiumCapture(row);
  const gammaImpact = metrics
    ? 0.5 * metrics.signedGamma * (metrics.spot * priceShockPct / 100) ** 2
    : null;
  return (
    <>
      <tr className={`${row.riskStatus === "High" ? "bg-rose-50/40" : row.riskStatus === "Elevated" ? "bg-amber-50/30" : "bg-white"} border-b border-slate-100`}>
        <td className="break-words px-3 py-3">
          <div className="font-semibold leading-snug text-slate-800">{row.display_name || row.tradingsymbol}</div>
          <div className="mt-1 text-xs text-slate-500">{row.index || row.exchange || "—"} · {row.expiryIso || row.expiry_iso || "expiry unavailable"}</div>
        </td>
        <td className="px-3 py-3 text-slate-700">
          <div>{qty < 0 ? "Sell" : "Buy"} · {Math.abs(qty).toLocaleString("en-IN")}</div>
          <div className="mt-1 text-xs text-slate-500">{Number(row.lot_size) > 0 ? `${number(Math.abs(qty) / Number(row.lot_size), 2)} lots` : "lot size unavailable"}</div>
        </td>
        <td className={`break-words px-3 py-3 font-mono-data font-semibold ${Number(row.unrealised) < 0 ? "text-rose-700" : "text-emerald-700"}`}>
          {money(row.unrealised)}
          <div className="mt-1 text-xs font-sans font-normal text-slate-500">unrealized</div>
        </td>
        <td className="break-words px-3 py-3 font-mono-data text-slate-800">
          {capture
            ? `${money(capture.value)} · ${number(capture.percent, 1)}%`
            : qty < 0 ? "Unavailable" : "—"}
          {qty < 0 && (
            <div className="mt-1 text-xs font-sans font-normal text-slate-500">
              {capture
                ? `${money(capture.entryPrice, 2)} entry → ${money(capture.buybackPrice, 2)} LTP`
                : "Entry / LTP missing"}
            </div>
          )}
        </td>
        <td className="break-words px-3 py-3 font-mono-data text-slate-800">
          {metrics ? money(metrics.deltaInrPerPct) : "Unavailable"}
          <div className="mt-1 text-xs font-sans text-slate-500">per 1% index move</div>
        </td>
        <td className="break-words px-3 py-3 font-mono-data text-slate-800">
          {money(gammaImpact)}
          <div className="mt-1 text-xs font-sans text-slate-500">gamma only · either direction</div>
        </td>
        <td className="break-words px-3 py-3 font-mono-data text-slate-800">
          {metrics ? money(metrics.thetaInrPerDay) : "Unavailable"}
          <div className="mt-1 text-xs font-sans text-slate-500">theoretical decay</div>
        </td>
        <td className="px-3 py-3 font-mono-data text-slate-800">{metrics ? `${number(metrics.ivPct, 1)}%` : "—"}</td>
        <td className="break-words px-3 py-3">
          <StatusPill status={row.riskStatus} />
          {row.breachedAdjust && qty < 0 && (
            <div className="mt-1 inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">Near sold strike</div>
          )}
          <div className="mt-2 line-clamp-2 break-words text-xs leading-snug text-slate-600" title={positionRiskExplanation(row)}>{positionRiskExplanation(row)}</div>
          <button type="button" onClick={onToggle} aria-expanded={expanded} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900 focus:outline-none focus:ring-2 focus:ring-sky-500">
            {expanded ? "Hide details" : "Explain"} {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-slate-100 bg-slate-50/70">
          <td colSpan={9} className="px-3 py-2">
            <PositionDetails row={row} ivChangePp={ivChange} />
            <div className="mt-2 text-[10px] leading-relaxed text-slate-500">
              Delta estimate for a 1% index move: {money(metrics?.deltaInrPerPct)}.
              {metrics ? ` Gamma-only estimate for a ±${number(priceShockPct, 1)}% move: ${money(gammaImpact)}; the total move also depends on Delta, IV and time. This position contributes ${number(row.deltaSharePct, 1)}% of absolute book Delta.` : ""}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
