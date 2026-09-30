import { bsPrice, dailyThetaRupees, greeks } from "./blackScholes.js";

export const DEFAULT_RISK_SETTINGS = Object.freeze({
  priceShockPct: 1,
  ivShockPp: 2,
  watchLossPct: 25,
  criticalLossPct: 100,
});

const finite = (value) => {
  const n = Number(value);
  return value != null && value !== "" && Number.isFinite(n) ? n : null;
};

// Remaining extrinsic value is seller decay runway, not net package profit or a guarantee.
export function summarizeSellerDecay(rows = []) {
  const openShorts = (Array.isArray(rows) ? rows : []).filter((row) => (
    !row?.exited && row?.isOpt && finite(row?.quantity) < 0
  ));
  if (openShorts.length === 0) {
    return { value: 0, shortCount: 0, missingCount: 0 };
  }

  let total = 0;
  let missingCount = 0;
  for (const row of openShorts) {
    const decay = finite(row.extrinsicLeft);
    if (decay == null || decay < 0) {
      missingCount += 1;
    } else {
      total += decay;
    }
  }
  return {
    value: missingCount === 0 ? total : null,
    shortCount: openShorts.length,
    missingCount,
  };
}

// Use only open short quantity: this is an entry-to-buyback mark, not booked daily P&L.
export function openShortPremiumCapture(row) {
  if (row?.exited || !row?.isOpt) return null;
  const entryPrice = finite(row.average_price);
  const buybackPrice = finite(row.last_price);
  const quantity = finite(row.quantity);
  const multiplier = finite(row.multiplier ?? 1);
  if (
    entryPrice == null || entryPrice <= 0
    || buybackPrice == null || buybackPrice <= 0
    || quantity == null || quantity >= 0
    || multiplier == null || multiplier <= 0
  ) return null;

  const units = Math.abs(quantity) * multiplier;
  return {
    value: (entryPrice - buybackPrice) * units,
    percent: (entryPrice - buybackPrice) / entryPrice * 100,
    entryValue: entryPrice * units,
  };
}

export function summarizeOpenShortCapture(rows = []) {
  const openShorts = (Array.isArray(rows) ? rows : []).filter((row) => (
    !row?.exited && row?.isOpt && finite(row?.quantity) < 0
  ));
  if (openShorts.length === 0) {
    return { value: 0, percent: 0, shortCount: 0, missingCount: 0 };
  }

  let value = 0;
  let entryValue = 0;
  let missingCount = 0;
  for (const row of openShorts) {
    const capture = openShortPremiumCapture(row);
    if (!capture) {
      missingCount += 1;
      continue;
    }
    value += capture.value;
    entryValue += capture.entryValue;
  }
  return {
    value: missingCount === 0 ? value : null,
    percent: missingCount === 0 && entryValue > 0 ? value / entryValue * 100 : null,
    shortCount: openShorts.length,
    missingCount,
  };
}

const rupees = (value) => `₹${Math.round(Math.abs(value)).toLocaleString("en-IN")}`;

export function normalizeRiskSettings(input = {}) {
  const read = (key, min, max) => {
    const n = finite(input[key]);
    return n == null ? DEFAULT_RISK_SETTINGS[key] : Math.min(max, Math.max(min, n));
  };
  const watchLossPct = read("watchLossPct", 1, 99);
  const criticalLossPct = Math.max(watchLossPct, read("criticalLossPct", 1, 100));
  return {
    priceShockPct: read("priceShockPct", 0.1, 10),
    ivShockPp: read("ivShockPp", 0.1, 30),
    watchLossPct,
    criticalLossPct,
  };
}

export function positionRiskInputs(row) {
  if (!row?.isOpt) return { metrics: null, reason: "Option Greeks are not available for this instrument." };
  if (row.side !== "CE" && row.side !== "PE") {
    return { metrics: null, reason: "Option type is unavailable or unsupported." };
  }

  const quantity = finite(row.quantity);
  const multiplier = finite(row.multiplier ?? 1);
  const spot = finite(row.spotUsed);
  const strike = finite(row.strike);
  const ltp = finite(row.last_price);
  const ivPct = finite(row.iv);
  const dte = finite(row.dte);
  const delta = finite(row.delta);
  const gamma = finite(row.gamma);
  const theta = finite(row.theta);
  if (quantity == null || quantity === 0) return { metrics: null, reason: "Open quantity is unavailable." };
  if (multiplier == null || multiplier <= 0) return { metrics: null, reason: "Contract multiplier is unavailable." };
  if (spot == null || spot <= 0) return { metrics: null, reason: "Underlying price is unavailable." };
  if (strike == null || strike <= 0) return { metrics: null, reason: "Option strike is unavailable." };
  if (ltp == null || ltp <= 0) return { metrics: null, reason: "A current option price is unavailable." };
  if (ivPct == null || ivPct <= 0 || dte == null || dte <= 0) {
    return { metrics: null, reason: "Current IV or a live expiry input is unavailable." };
  }
  if (row.greeksHealth !== "ok" || [delta, gamma, theta].some((value) => value == null)) {
    return { metrics: null, reason: "Reliable Delta, Gamma, and Theta inputs are unavailable." };
  }

  // Kite quantity already contains lot units; only the broker's contract multiplier is additional.
  const signedQuantity = quantity * multiplier;
  const isCall = row.side === "CE";
  const greekSet = greeks(spot, strike, dte / 365, 0.065, ivPct / 100, isCall);
  const thetaInrPerDay = dailyThetaRupees({
    thetaPerUnit: theta,
    quantity: signedQuantity,
    marketPrice: ltp,
    S: spot,
    K: strike,
    isCall,
    T: dte / 365,
  });
  if (!Number.isFinite(greekSet.vega) || !Number.isFinite(thetaInrPerDay)) {
    return { metrics: null, reason: "Greeks could not be converted to position exposure." };
  }

  return {
    metrics: {
      spot,
      strike,
      ltp,
      ivPct,
      dte,
      quantity,
      multiplier,
      signedQuantity,
      delta,
      gamma,
      theta,
      vega: greekSet.vega,
      isCall,
      riskFreeRate: 0.065,
      deltaUnits: delta * signedQuantity,
      deltaInrPerPct: delta * signedQuantity * spot / 100,
      signedGamma: gamma * signedQuantity,
      thetaInrPerDay,
      markValue: Math.abs(ltp * signedQuantity),
    },
    reason: null,
  };
}

export function estimatePositionScenario(metrics, scenario = {}) {
  if (!metrics) return null;
  const pricePct = Number(scenario.pricePct ?? 0);
  const ivPp = Number(scenario.ivPp ?? 0);
  const days = Number(scenario.days ?? 0);
  if (![pricePct, ivPp, days].every(Number.isFinite) || days < 0) return null;
  if (pricePct === 0 && ivPp === 0 && days === 0) return 0;

  const shockedSpot = metrics.spot * (1 + pricePct / 100);
  const shockedIv = Math.max(0, metrics.ivPct + ivPp) / 100;
  const remainingYears = Math.max(0, metrics.dte - days) / 365;
  if (shockedSpot <= 0) return null;

  const shockedModelPrice = bsPrice(
    shockedSpot,
    metrics.strike,
    remainingYears,
    metrics.riskFreeRate,
    shockedIv,
    metrics.isCall,
  );
  if (shockedModelPrice == null) return null;

  // Use the live option quote as the baseline so model-vs-market mispricing
  // cannot appear as an immediate scenario gain or loss.
  const rawImpact = (shockedModelPrice - metrics.ltp) * metrics.signedQuantity;
  if (!Number.isFinite(rawImpact)) return null;
  // Anchor model price changes to the live mark: a long option cannot lose more
  // than its current value, and a short option cannot gain more than its mark.
  return metrics.signedQuantity > 0
    ? Math.max(-metrics.markValue, rawImpact)
    : Math.min(metrics.markValue, rawImpact);
}

function assessPosition(row, deltaTotalAbs, ivChangePp) {
  const { metrics, reason } = positionRiskInputs(row);
  if (!metrics) {
    return {
      ...row,
      riskMetrics: null,
      riskStatus: "Data unavailable",
      riskReason: reason,
      deltaSharePct: null,
      stressLossPct: null,
    };
  }

  const observedIvPnl = ivChangePp == null
    ? null
    : estimatePositionScenario(metrics, { ivPp: ivChangePp });
  const observedIvLossPct = observedIvPnl == null || metrics.markValue <= 0
    ? null
    : Math.max(0, -observedIvPnl / metrics.markValue * 100);
  const deltaSharePct = deltaTotalAbs > 0
    ? Math.abs(metrics.deltaInrPerPct) / deltaTotalAbs * 100
    : 0;
  return {
    ...row,
    riskMetrics: metrics,
    riskStatus: "Normal",
    riskReason: "",
    deltaSharePct,
    stressLossPct: null,
    observedIvLossPct,
    observedIvPnl,
    ivChangePp,
  };
}

function hasValidExpiry(row) {
  const expiry = String(row.expiryIso || row.expiry_iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return false;
  const parsed = new Date(`${expiry}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === expiry;
}

function sellerPackageKey(row) {
  const index = String(row.index || row.underlying || row.tradingsymbol || "unknown").trim().toUpperCase();
  const expiry = String(row.expiryIso || row.expiry_iso || "").slice(0, 10);
  return expiry ? `${index}:${expiry}` : `${index}:${row.tradingsymbol || "unknown"}`;
}

function sellerStressScenarios(settings) {
  return [
    { pricePct: -settings.priceShockPct, ivPp: -settings.ivShockPp, days: 1 },
    { pricePct: -settings.priceShockPct, ivPp: settings.ivShockPp, days: 1 },
    { pricePct: settings.priceShockPct, ivPp: -settings.ivShockPp, days: 1 },
    { pricePct: settings.priceShockPct, ivPp: settings.ivShockPp, days: 1 },
  ];
}

function assessSellerPackages(positions, settings) {
  // The feed has no strategy id, so only same-index, same-expiry legs are tested together.
  const packages = new Map();
  positions.forEach((row, index) => {
    if (!row.isOpt) return;
    const key = sellerPackageKey(row);
    const packageRows = packages.get(key) || [];
    packageRows.push({ row, index });
    packages.set(key, packageRows);
  });

  const assessed = positions.slice();
  for (const [packageKey, packageRows] of packages) {
    const unavailable = packageRows.some(({ row }) => !row.riskMetrics || row.riskStatus === "Data unavailable");
    const expiryKnown = packageRows.every(({ row }) => hasValidExpiry(row));
    if (unavailable || !expiryKnown) {
      packageRows.forEach(({ row, index }) => {
        assessed[index] = {
          ...row,
          riskStatus: "Data unavailable",
          riskReason: !expiryKnown
            ? "Option expiry is unavailable, so this position cannot be grouped with its same-expiry hedge legs for a reliable risk check."
            : "This index/expiry package has a position without reliable market data, so its combined risk cannot be assessed.",
          packageKey,
        };
      });
      continue;
    }

    const shortRows = packageRows.filter(({ row }) => row.riskMetrics.signedQuantity < 0);
    if (shortRows.length === 0) {
      packageRows.forEach(({ row, index }) => {
        assessed[index] = {
          ...row,
          riskStatus: "Hedge",
          riskReason: "Bought option shown as a hedge leg. Its premium can decay; alerts are assessed on sold options together with same-index, same-expiry legs.",
          packageKey,
        };
      });
      continue;
    }

    const rows = packageRows.map(({ row }) => row);
    const outcomes = sellerStressScenarios(settings).map((scenario) => {
      const impacts = rows.map((row) => estimatePositionScenario(row.riskMetrics, scenario));
      return {
        ...scenario,
        pnl: impacts.every((impact) => Number.isFinite(impact))
          ? impacts.reduce((sum, impact) => sum + impact, 0)
          : null,
      };
    });
    if (outcomes.some((outcome) => outcome.pnl == null)) {
      packageRows.forEach(({ row, index }) => {
        assessed[index] = {
          ...row,
          riskStatus: "Data unavailable",
          riskReason: "The option-pricing model could not re-price every leg in this index/expiry package, so no combined alert is shown.",
          packageKey,
        };
      });
      continue;
    }
    const worst = outcomes.reduce((current, outcome) => (
      current == null || outcome.pnl < current.pnl ? outcome : current
    ), null);
    const soldMarkValue = shortRows.reduce(
      (sum, { row }) => sum + row.riskMetrics.markValue,
      0,
    );
    const stressLossPct = soldMarkValue > 0 && worst
      ? Math.max(0, -worst.pnl / soldMarkValue * 100)
      : 0;
    const allIvChangesAvailable = rows.every((row) => Number.isFinite(row.ivChangePp));
    const observedIvImpacts = allIvChangesAvailable
      ? rows.map((row) => estimatePositionScenario(row.riskMetrics, { ivPp: row.ivChangePp }))
      : null;
    const observedIvPnl = observedIvImpacts?.every((impact) => Number.isFinite(impact))
      ? observedIvImpacts.reduce((sum, impact) => sum + impact, 0)
      : null;
    const observedIvLossPct = observedIvPnl != null && soldMarkValue > 0
      ? Math.max(0, -observedIvPnl / soldMarkValue * 100)
      : 0;
    const assessedLossPct = Math.max(stressLossPct, observedIvLossPct);
    const netGammaImpact = rows.reduce((sum, row) => {
      const { riskMetrics: metrics } = row;
      const spotMove = metrics.spot * settings.priceShockPct / 100;
      return sum + 0.5 * metrics.signedGamma * spotMove ** 2;
    }, 0);
    const gammaLossPct = soldMarkValue > 0
      ? Math.max(0, -netGammaImpact / soldMarkValue * 100)
      : 0;
    const nearExpiry = rows.some((row) => row.riskMetrics.dte <= 2);

    let packageStatus = "Normal";
    if (assessedLossPct >= settings.criticalLossPct) packageStatus = "High";
    else if (assessedLossPct >= settings.watchLossPct) packageStatus = "Elevated";
    else if (
      nearExpiry
      && netGammaImpact < 0
      && gammaLossPct >= settings.watchLossPct
    ) packageStatus = "Elevated";

    let packageReason = "Combined sold and hedge legs stay below your alert limits in these tests. This does not mean the package has no risk.";
    if (
      observedIvPnl != null
      && observedIvPnl < 0
      && observedIvLossPct >= stressLossPct
    ) {
      packageReason = `The recent IV changes across this index/expiry group estimate a combined ${rupees(observedIvPnl)} loss (${observedIvLossPct.toFixed(0)}% of the current close value of its sold options). This is a model estimate, not a guaranteed result.`;
    } else if (assessedLossPct > 0 && worst?.pnl < 0) {
      const direction = worst.pricePct > 0 ? "up" : "down";
      packageReason = `Together, this index/expiry group estimates ${rupees(worst.pnl)} loss if the index moves ${direction} ${Math.abs(worst.pricePct)}%, IV changes ${worst.ivPp > 0 ? "up" : "down"} ${Math.abs(worst.ivPp)} points, and one day passes. That is ${assessedLossPct.toFixed(0)}% of the current value of its sold options; bought hedge legs are included.`;
    }
    if (
      nearExpiry
      && netGammaImpact < 0
      && gammaLossPct >= settings.watchLossPct
    ) {
      packageReason += " Near expiry, the package also has material net short-Gamma exposure.";
    }

    packageRows.forEach(({ row, index }) => {
      const isBoughtHedge = row.riskMetrics.signedQuantity > 0;
      assessed[index] = {
        ...row,
        riskStatus: isBoughtHedge ? "Hedge" : packageStatus,
        riskReason: isBoughtHedge
          ? `Bought hedge leg. ${packageStatus === "Normal" ? packageReason : `The sold-and-hedge package is ${packageStatus === "High" ? "High alert" : "on Watch"}. ${packageReason}`}`
          : packageReason,
        packageKey,
        packageRiskStatus: packageStatus,
        packageStressLossPct: assessedLossPct,
      };
    });
  }
  return assessed;
}

function summarizeSellerPackages(positions, settings) {
  const grouped = new Map();
  positions.filter((row) => row.isOpt).forEach((row) => {
    const key = row.packageKey || sellerPackageKey(row);
    const packageRows = grouped.get(key) || [];
    packageRows.push(row);
    grouped.set(key, packageRows);
  });

  return Array.from(grouped, ([key, rows]) => {
    const shortRows = rows.filter((row) => {
      const signedQuantity = row.riskMetrics?.signedQuantity ?? finite(row.quantity);
      return signedQuantity != null && signedQuantity < 0;
    });
    if (shortRows.length === 0) return null;

    const complete = rows.every((row) => (
      row.riskMetrics != null && row.riskStatus !== "Data unavailable"
    ));
    const strikeMap = new Map();
    rows.forEach((row) => {
      const strike = finite(row.strike);
      const strikeKey = strike == null ? "unknown" : String(strike);
      const bucket = strikeMap.get(strikeKey) || {
        strike,
        callSellQuantity: 0,
        callBuyQuantity: 0,
        putSellQuantity: 0,
        putBuyQuantity: 0,
        callUncoveredQuantity: 0,
        callCoveragePct: null,
        putUncoveredQuantity: 0,
        putCoveragePct: null,
        deltaInrPerPct: 0,
        gammaImpactInr: 0,
      };
      const quantity = Math.abs(finite(row.quantity) || 0);
      const isCall = row.side === "CE";
      const isSell = finite(row.quantity) < 0;
      const quantityKey = `${isCall ? "call" : "put"}${isSell ? "Sell" : "Buy"}Quantity`;
      bucket[quantityKey] += quantity;
      if (row.riskMetrics) {
        bucket.deltaInrPerPct += row.riskMetrics.deltaInrPerPct;
        const spotMove = row.riskMetrics.spot * settings.priceShockPct / 100;
        bucket.gammaImpactInr += 0.5 * row.riskMetrics.signedGamma * spotMove ** 2;
      }
      const callSold = bucket.callSellQuantity;
      const putSold = bucket.putSellQuantity;
      bucket.callUncoveredQuantity = Math.max(0, callSold - bucket.callBuyQuantity);
      bucket.callCoveragePct = callSold > 0
        ? Math.min(100, bucket.callBuyQuantity / callSold * 100)
        : null;
      bucket.putUncoveredQuantity = Math.max(0, putSold - bucket.putBuyQuantity);
      bucket.putCoveragePct = putSold > 0
        ? Math.min(100, bucket.putBuyQuantity / putSold * 100)
        : null;
      strikeMap.set(strikeKey, {
        ...bucket,
        deltaInrPerPct: complete ? bucket.deltaInrPerPct : null,
        gammaImpactInr: complete ? bucket.gammaImpactInr : null,
      });
    });

    const scenarios = sellerStressScenarios(settings).map((scenario) => {
      const impacts = rows.map((row) => estimatePositionScenario(row.riskMetrics, scenario));
      return {
        ...scenario,
        pnl: complete && impacts.every((impact) => Number.isFinite(impact))
          ? impacts.reduce((sum, impact) => sum + impact, 0)
          : null,
      };
    });
    const worstScenario = scenarios.reduce((worst, scenario) => (
      scenario.pnl != null && (worst == null || scenario.pnl < worst.pnl) ? scenario : worst
    ), null);
    const pnlComplete = rows.every((row) => finite(row.unrealised) != null);
    const statusPriority = { High: 3, Elevated: 2, Normal: 1 };
    const packageRiskStatus = shortRows.reduce((status, row) => (
      (statusPriority[row.riskStatus] || 0) > (statusPriority[status] || 0)
        ? row.riskStatus
        : status
    ), "Normal");

    return {
      key,
      index: rows[0].index || rows[0].underlying || null,
      expiry: rows[0].expiryIso || rows[0].expiry_iso || null,
      positionsCount: rows.length,
      soldCount: shortRows.length,
      hedgeCount: rows.filter((row) => (
        (row.riskMetrics?.signedQuantity ?? finite(row.quantity)) > 0
      )).length,
      riskStatus: complete ? packageRiskStatus : "Data unavailable",
      complete,
      pnl: pnlComplete ? rows.reduce((sum, row) => sum + finite(row.unrealised), 0) : null,
      soldOptionValue: complete
        ? shortRows.reduce((sum, row) => sum + row.riskMetrics.markValue, 0)
        : null,
      netDeltaInrPerPct: complete
        ? rows.reduce((sum, row) => sum + row.riskMetrics.deltaInrPerPct, 0)
        : null,
      netThetaInrPerDay: complete
        ? rows.reduce((sum, row) => sum + row.riskMetrics.thetaInrPerDay, 0)
        : null,
      netGammaImpactInr: complete
        ? rows.reduce((sum, row) => {
          const spotMove = row.riskMetrics.spot * settings.priceShockPct / 100;
          return sum + 0.5 * row.riskMetrics.signedGamma * spotMove ** 2;
        }, 0)
        : null,
      scenarios,
      worstScenario,
      strikeBuckets: Array.from(strikeMap.values()).sort((a, b) => (
        a.strike == null ? 1 : b.strike == null ? -1 : a.strike - b.strike
      )),
    };
  }).filter(Boolean);
}

export function calculateRiskBook(rows = [], inputSettings = {}, { stale = false, ivChanges = {} } = {}) {
  const settings = normalizeRiskSettings(inputSettings);
  const openRows = (Array.isArray(rows) ? rows : []).filter(
    (row) => !row?.exited && finite(row?.quantity) != null && finite(row?.quantity) !== 0,
  );
  const base = openRows.map((row) => ({
    row,
    inputs: positionRiskInputs(row),
  }));
  const deltaTotalAbs = base.reduce((sum, item) => (
    sum + Math.abs(item.inputs.metrics?.deltaInrPerPct || 0)
  ), 0);

  const individualPositions = base.map(({ row }) => {
    if (stale) {
      return {
        ...row,
        riskMetrics: null,
        riskStatus: "Data unavailable",
        riskReason: "Positions data is stale or the latest broker read failed; refresh before relying on risk.",
        deltaSharePct: null,
        stressLossPct: null,
      };
    }
    const ivChange = ivChanges[`${row.exchange || ""}:${row.tradingsymbol || row.display_name || row.index || "position"}:${row.product || ""}`];
    return assessPosition(row, deltaTotalAbs, finite(ivChange));
  });
  const positions = stale
    ? individualPositions
    : assessSellerPackages(individualPositions, settings);

  const complete = positions.length > 0
    && positions.every((row) => row.riskMetrics != null);
  return {
    settings,
    positions,
    sellerPackages: summarizeSellerPackages(positions, settings),
    totals: {
      openCount: positions.length,
      atRiskCount: positions.filter((row) => row.riskStatus === "Elevated" || row.riskStatus === "High").length,
      highCount: positions.filter((row) => row.riskStatus === "High").length,
      missingCount: positions.filter((row) => row.riskStatus === "Data unavailable").length,
      hedgeCount: positions.filter((row) => row.riskStatus === "Hedge").length,
      pnl: positions.length > 0 && positions.every((row) => finite(row.unrealised) != null)
        ? positions.reduce((sum, row) => sum + finite(row.unrealised), 0)
        : positions.length === 0 ? 0 : null,
      netDeltaInrPerPct: complete
        ? positions.reduce((sum, row) => sum + row.riskMetrics.deltaInrPerPct, 0)
        : positions.length === 0 ? 0 : null,
      netThetaInrPerDay: complete
        ? positions.reduce((sum, row) => sum + row.riskMetrics.thetaInrPerDay, 0)
        : positions.length === 0 ? 0 : null,
      complete,
    },
  };
}

export function aggregateRiskScenario(positions, scenario) {
  if (!Array.isArray(positions) || positions.length === 0) return 0;
  if (positions.some((row) => !row.riskMetrics)) return null;
  const impacts = positions.map((row) => estimatePositionScenario(row.riskMetrics, scenario));
  if (impacts.some((impact) => impact == null || !Number.isFinite(impact))) return null;
  return impacts.reduce((sum, impact) => sum + impact, 0);
}
