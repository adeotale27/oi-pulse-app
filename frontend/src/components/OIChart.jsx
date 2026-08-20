import { useMemo, memo, useState, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";

const PUT_GREEN = "#16A34A";
const PUT_LIGHT = "#86EFAC";
const CALL_RED = "#DC2626";
const CALL_LIGHT = "#FCA5A5";

function formatOI(v) {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e7) return (v / 1e7).toFixed(2) + "Cr";
  if (abs >= 1e5) return (v / 1e5).toFixed(2) + "L";
  if (abs >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toLocaleString();
}

function formatTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "—";
  }
}

export default memo(function OIChart({ current, previous, mode, atm, showOI = true, currentTime, prevTime, signalsMap, compact = false }) {
  const spotPrice = current?.price ?? null;
  const data = useMemo(() => {
    if (!current) return [];
    const prevMap = new Map();
    (previous?.strikes || []).forEach((s) => prevMap.set(s.strike, s));
    return current.strikes.map((s) => {
      const p = prevMap.get(s.strike);
      const peNow = Number(s.pe_oi ?? 0);
      const ceNow = Number(s.ce_oi ?? 0);
      // If previous snapshot exists but this strike is missing, treat prev as 0
      // (new strike = full OI as build). If no previous at all, delta = 0.
      const pePrev = previous
        ? Number(p?.pe_oi ?? 0)
        : peNow;
      const cePrev = previous
        ? Number(p?.ce_oi ?? 0)
        : ceNow;
      const peDelta = peNow - pePrev;
      const ceDelta = ceNow - cePrev;

      // For stacked-change visualization we split each side into three segments:
      //   base    = min(prev, now)                    → solid bar (OI that stayed)
      //   up      = max(0, now - prev)                → striped segment on top (fresh OI written)
      //   down    = max(0, prev - now)                → outlined segment on top (OI unwound)
      // Total stack height equals the LATER-OF (prev, now), matching Sensibull's
      // "start-of-window bar overlayed with change" grouped-bar layout.
      const peBase = Math.min(peNow, pePrev);
      const peUp = peDelta > 0 ? peDelta : 0;
      const peDown = peDelta < 0 ? -peDelta : 0;
      const ceBase = Math.min(ceNow, cePrev);
      const ceUp = ceDelta > 0 ? ceDelta : 0;
      const ceDown = ceDelta < 0 ? -ceDelta : 0;

      return {
        strike: s.strike,
        pe_now: peNow,
        pe_prev: pePrev,
        ce_now: ceNow,
        ce_prev: cePrev,
        pe_delta: peDelta,
        ce_delta: ceDelta,
        pe_base: peBase,
        pe_up: peUp,
        pe_down: peDown,
        ce_base: ceBase,
        ce_up: ceUp,
        ce_down: ceDown,
      };
    });
  }, [current, previous]);

  const [pressHold, setPressHold] = useState(false);
  const [touchTooltip, setTouchTooltip] = useState(false);
  const pressOrigin = useRef({ x: 0, y: 0 });

  if (!current) {
    return (
      <div className={`${compact ? "h-[280px]" : "h-96"} flex items-center justify-center text-slate-400 text-sm`}>
        Loading data…
      </div>
    );
  }

  const ct = currentTime || current?.timestamp;
  const pt = prevTime || previous?.timestamp;
  const tickEvery = compact && data.length > 12 ? 1 : 0;
  const chartH = compact ? "h-[280px]" : "h-[440px]";

  const endPressHold = () => setPressHold(false);
  const onChartPointerDown = (e) => {
    if (!compact) return;
    if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
    setTouchTooltip(true);
    setPressHold(true);
    pressOrigin.current = { x: e.clientX, y: e.clientY };
  };
  const onChartPointerMove = (e) => {
    if (!compact || !pressHold) return;
    const dx = e.clientX - pressOrigin.current.x;
    const dy = e.clientY - pressOrigin.current.y;
    if (dx * dx + dy * dy > 36) setPressHold(false);
  };

  return (
    <div className="w-full" data-testid="oi-chart">
      <div
        className={`w-full ${chartH} touch-manipulation`}
        onPointerDown={onChartPointerDown}
        onPointerMove={onChartPointerMove}
        onPointerUp={endPressHold}
        onPointerCancel={endPressHold}
        onPointerLeave={endPressHold}
        onLostPointerCapture={endPressHold}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={compact ? { top: 10, right: 6, left: 0, bottom: 12 } : { top: 20, right: 20, left: 10, bottom: 20 }}
            barCategoryGap={compact ? "12%" : "18%"}
          >
            {/* SVG patterns for the "increase" striped fills and the "decrease" outlined bars. */}
            <defs>
              <pattern id="pe-stripes" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                <rect width="6" height="6" fill={PUT_LIGHT} />
                <line x1="0" y1="0" x2="0" y2="6" stroke={PUT_GREEN} strokeWidth="3" />
              </pattern>
              <pattern id="ce-stripes" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                <rect width="6" height="6" fill={CALL_LIGHT} />
                <line x1="0" y1="0" x2="0" y2="6" stroke={CALL_RED} strokeWidth="3" />
              </pattern>
            </defs>
            <CartesianGrid stroke="#E2E8F0" vertical={false} />
            <XAxis
              dataKey="strike"
              tick={{ fontSize: compact ? 9 : 11, fill: "#475569" }}
              axisLine={{ stroke: "#CBD5E1" }}
              tickLine={false}
              angle={compact ? -35 : -40}
              textAnchor="end"
              height={compact ? 52 : 60}
              interval={tickEvery}
              tickMargin={compact ? 6 : 4}
            />
            <YAxis
              tick={{ fontSize: compact ? 9 : 11, fill: "#475569" }}
              axisLine={{ stroke: "#CBD5E1" }}
              tickLine={false}
              tickFormatter={formatOI}
              width={compact ? 40 : 64}
              hide={false}
              label={compact ? undefined : {
                value: "Call / Put OI",
                angle: -90,
                position: "insideLeft",
                style: { fill: "#64748B", fontSize: 11, textAnchor: "middle" },
                offset: 10,
              }}
            />
            <Tooltip
              cursor={compact ? false : { fill: "rgba(148,163,184,0.12)" }}
              allowEscapeViewBox={{ x: true, y: true }}
              offset={compact ? 8 : 10}
              wrapperStyle={{ pointerEvents: "none", outline: "none", background: "transparent", border: "none", boxShadow: "none" }}
              isAnimationActive={false}
              active={touchTooltip ? pressHold : undefined}
              content={
                <CustomTooltip
                  mode={mode}
                  atm={atm}
                  currentTime={ct}
                  prevTime={pt}
                  showOI={showOI}
                  compact={compact}
                />
              }
            />
            <Legend
              verticalAlign="bottom"
              content={<CustomLegend showOI={showOI} compact={compact} />}
            />
            {atm && (
              <ReferenceLine
                x={atm}
                stroke="#0F172A"
                strokeDasharray="4 4"
                strokeWidth={1.2}
                label={{
                  value: compact
                    ? `ATM ${atm}`
                    : (spotPrice
                    ? `ATM ${atm}  ·  ₹${Number(spotPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                    : `ATM ${atm}`),
                  position: "top",
                  fill: "#0F172A",
                  fontSize: compact ? 10 : 11,
                  fontWeight: 600,
                  fontFamily: "JetBrains Mono",
                }}
              />
            )}
            {showOI ? (
              <>
                {/* Show OI ON → Sensibull-style stacked bars: solid CURRENT (or PREVIOUS-if-smaller)
                    base + a small "Increase" striped segment OR "Decrease" outlined segment on top.
                    Total height = max(now, prev). Legend has 6 items (Put OI · Increase · Decrease · Call OI · Increase · Decrease). */}
                <Bar dataKey="pe_base" stackId="pe" name="Put OI" fill={PUT_GREEN} isAnimationActive={false} />
                <Bar dataKey="pe_up" stackId="pe" name="Put Increase" fill="url(#pe-stripes)" isAnimationActive={false} />
                <Bar dataKey="pe_down" stackId="pe" name="Put Decrease" fill="rgba(255,255,255,0)" stroke={PUT_GREEN} strokeWidth={1.5} isAnimationActive={false} />
                <Bar dataKey="ce_base" stackId="ce" name="Call OI" fill={CALL_RED} isAnimationActive={false} />
                <Bar dataKey="ce_up" stackId="ce" name="Call Increase" fill="url(#ce-stripes)" isAnimationActive={false} />
                <Bar dataKey="ce_down" stackId="ce" name="Call Decrease" fill="rgba(255,255,255,0)" stroke={CALL_RED} strokeWidth={1.5} isAnimationActive={false} />
              </>
            ) : (
              <>
                {/* Show OI OFF → render ONLY the CHANGE (signed delta) bars. Positive = up = increase,
                    Negative = down = decrease. y=0 baseline for clarity. */}
                <ReferenceLine y={0} stroke="#94A3B8" strokeWidth={1} />
                <Bar dataKey="pe_delta" name="Put OI Change" fill={PUT_GREEN} isAnimationActive={false} />
                <Bar dataKey="ce_delta" name="Call OI Change" fill={CALL_RED} isAnimationActive={false} />
              </>
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {signalsMap && signalsMap.size > 0 && (
        <div className="w-full pl-[70px] pr-[20px] mt-1" data-testid="signal-strip">
          <div className="flex" style={{ gap: 0 }}>
            {data.map((d) => {
              const sig = signalsMap.get(d.strike);
              return (
                <div key={d.strike} className="flex-1 flex flex-col items-center gap-0.5 min-w-0">
                  {sig?.ce?.map((t, i) => (
                    <SignalIcon key={`ce-${i}`} tag={t} side="CE" />
                  ))}
                  {sig?.pe?.map((t, i) => (
                    <SignalIcon key={`pe-${i}`} tag={t} side="PE" />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

function SignalIcon({ tag, side }) {
  const isCall = side === "CE";
  const cfg = {
    institution: { emoji: "🏦", cls: isCall ? "bg-rose-100 text-rose-700 border-rose-300" : "bg-emerald-100 text-emerald-700 border-emerald-300" },
    "gamma-wall": { emoji: "🚧", cls: isCall ? "bg-rose-100 text-rose-700 border-rose-300" : "bg-emerald-100 text-emerald-700 border-emerald-300" },
    velocity:    { emoji: "🔥", cls: isCall ? "bg-rose-100 text-rose-700 border-rose-300" : "bg-emerald-100 text-emerald-700 border-emerald-300" },
  }[tag.type] || { emoji: "•", cls: "bg-slate-100 text-slate-700 border-slate-300" };
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full border text-[9px] leading-none px-1 py-0.5 whitespace-nowrap ${cfg.cls}`}
      title={`${side} · ${tag.tooltip}`}
      data-testid={`chart-signal-${tag.type}-${side}`}
    >
      <span className="text-[10px]">{cfg.emoji}</span>
      <span className="ml-0.5 font-semibold">{side}</span>
    </span>
  );
}

function CustomTooltip({ active, payload, label, atm, currentTime, prevTime, showOI, compact }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const isAtm = atm === d.strike;
  const ctLbl = formatTime(currentTime);
  const ptLbl = formatTime(prevTime);
  const peChg = `${d.pe_delta >= 0 ? "+" : ""}${formatOI(d.pe_delta)}`;
  const ceChg = `${d.ce_delta >= 0 ? "+" : ""}${formatOI(d.ce_delta)}`;
  if (compact) {
    return (
      <div
        className="pointer-events-none rounded-md border border-slate-200/50 bg-white/65 backdrop-blur-[2px] shadow-sm px-2 py-1.5 text-[10px] min-w-0 max-w-[10.5rem]"
        data-testid="oi-tooltip"
      >
        <div className="font-semibold text-slate-900 mb-1 leading-tight">
          Strike {label} {isAtm && <span className="text-[9px] text-amber-700 ml-0.5">ATM</span>}
        </div>
        <div className="space-y-0.5 font-mono-data">
          <TipRow color={PUT_GREEN} label="Put chg" value={peChg} deltaPositive={d.pe_delta >= 0} isDelta compact />
          <TipRow color={CALL_RED} label="Call chg" value={ceChg} deltaPositive={d.ce_delta >= 0} isDelta compact />
        </div>
      </div>
    );
  }
  return (
    <div className="bg-white border border-slate-200 rounded-md shadow-xl px-4 py-3 text-xs min-w-[240px]" data-testid="oi-tooltip">
      <div className="font-semibold text-slate-900 mb-2 text-sm">
        Strike {label} {isAtm && <span className="text-[10px] text-amber-600 ml-1">ATM</span>}
      </div>
      <div className="space-y-1.5 font-mono-data">
        {showOI ? (
          <>
            {/* Show OI ON → sensibull-style detail: previous OI + change + current OI on one row per side */}
            <TipRow color={PUT_GREEN} label={`Put OI at ${ptLbl}`} value={formatOI(d.pe_prev)} />
            <TipRow color={PUT_GREEN} label="Put OI chg" value={peChg} deltaPositive={d.pe_delta >= 0} isDelta />
            <TipRow color={PUT_GREEN} label={`Put OI at ${ctLbl}`} value={formatOI(d.pe_now)} muted />
            <div className="h-px bg-slate-100 my-1" />
            <TipRow color={CALL_RED} label={`Call OI at ${ptLbl}`} value={formatOI(d.ce_prev)} />
            <TipRow color={CALL_RED} label="Call OI chg" value={ceChg} deltaPositive={d.ce_delta >= 0} isDelta />
            <TipRow color={CALL_RED} label={`Call OI at ${ctLbl}`} value={formatOI(d.ce_now)} muted />
          </>
        ) : (
          <>
            {/* Show OI OFF → just the signed delta */}
            <TipRow color={PUT_GREEN} label="Put OI chg" value={peChg} deltaPositive={d.pe_delta >= 0} isDelta />
            <TipRow color={CALL_RED} label="Call OI chg" value={ceChg} deltaPositive={d.ce_delta >= 0} isDelta />
          </>
        )}
      </div>
    </div>
  );
}

function TipRow({ color, label, value, muted, isDelta, deltaPositive, compact }) {
  return (
    <div className={`flex items-center justify-between ${compact ? "gap-2" : "gap-4"}`}>
      <div className="flex items-center gap-2">
        <span className={`${compact ? "w-2 h-2" : "w-2.5 h-2.5"} rounded-sm`} style={{ background: color }} />
        <span className={muted ? "text-slate-500" : "text-slate-700"}>{label}</span>
      </div>
      <span
        className={
          isDelta
            ? deltaPositive
              ? "text-emerald-600 font-semibold"
              : "text-rose-600 font-semibold"
            : "text-slate-900 font-medium"
        }
      >
        {value}
      </span>
    </div>
  );
}

function CustomLegend({ showOI, compact }) {
  const items = showOI
    ? [
        { label: "Put OI", swatch: <span className="w-3 h-3 inline-block rounded-sm" style={{ background: PUT_GREEN }} /> },
        { label: "Increase", swatch: <SwatchStripe color={PUT_GREEN} light={PUT_LIGHT} /> },
        { label: "Decrease", swatch: <SwatchOutline color={PUT_GREEN} /> },
        { label: "Call OI", swatch: <span className="w-3 h-3 inline-block rounded-sm" style={{ background: CALL_RED }} /> },
        { label: "Increase", swatch: <SwatchStripe color={CALL_RED} light={CALL_LIGHT} /> },
        { label: "Decrease", swatch: <SwatchOutline color={CALL_RED} /> },
      ]
    : [
        { label: "Put OI chg", swatch: <span className="w-3 h-3 inline-block rounded-sm" style={{ background: PUT_GREEN }} /> },
        { label: "Call OI chg", swatch: <span className="w-3 h-3 inline-block rounded-sm" style={{ background: CALL_RED }} /> },
      ];
  return (
    <div className={`${compact ? "pt-1 text-[10px]" : "pt-3 text-xs"} text-slate-600`} style={{ fontFamily: "Outfit" }} data-testid="oi-legend">
      <div className="flex items-center justify-center gap-x-5 gap-y-2 flex-wrap">
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-1.5">
            {it.swatch}
            <span>{it.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SwatchStripe({ color, light }) {
  return (
    <span
      className="w-3 h-3 inline-block rounded-sm"
      style={{
        backgroundImage: `repeating-linear-gradient(45deg, ${color} 0 2px, ${light} 2px 4px)`,
      }}
    />
  );
}

function SwatchOutline({ color }) {
  return (
    <span
      className="w-3 h-3 inline-block rounded-sm"
      style={{ background: "transparent", border: `1.5px solid ${color}` }}
    />
  );
}
