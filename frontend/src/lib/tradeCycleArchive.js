function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function numeric(value, label, lineNumber) {
  const result = Number(value ?? 0);
  if (!Number.isFinite(result)) {
    throw new Error(`Archive line ${lineNumber} has an invalid ${label}.`);
  }
  return result;
}

function addCycle(byDate, cycle, lineNumber, archiveScope) {
  if (!cycle || typeof cycle !== "object" || Array.isArray(cycle)) {
    throw new Error(`Archive line ${lineNumber} is not a trade-cycle record.`);
  }
  const date = cycle.exit_date;
  const validExitDate = validDate(date);
  const inRange = validExitDate && (archiveScope.fromDate
    ? date >= archiveScope.fromDate && date <= archiveScope.toDate
    : date.slice(0, 7) === archiveScope.month);
  if (!inRange) {
    throw new Error(`Archive line ${lineNumber} has an invalid or out-of-range exit date.`);
  }
  if (cycle.status !== "closed") {
    throw new Error(`Archive line ${lineNumber} is not a closed trade cycle.`);
  }
  const pnl = numeric(cycle.booked_pnl ?? cycle.realised, "booked P&L", lineNumber);
  const day = byDate[date] || {
    date,
    booked_pnl: 0,
    pnl_exited: 0,
    exited_count: 0,
    trade_count: 0,
    cycles: [],
  };
  day.booked_pnl += pnl;
  day.pnl_exited += pnl;
  day.exited_count += 1;
  day.trade_count += numeric(cycle.closed_quantity, "closed quantity", lineNumber);
  day.cycles.push(cycle);
  byDate[date] = day;
}

function createArchiveParser(name) {
  const archiveName = String(name || "");
  const nameRange = archiveName.match(
    /cycle-archive-(\d{4}-\d{2}-\d{2})-to-(\d{4}-\d{2}-\d{2})\.jsonl\.gz$/i,
  );
  const nameMonth = archiveName.match(/cycle-archive-(\d{4}-(?:0[1-9]|1[0-2]))\.jsonl\.gz$/i);
  const archiveScope = nameRange
    ? { fromDate: nameRange[1], toDate: nameRange[2] }
    : { month: nameMonth?.[1] };
  if (!nameRange && !nameMonth) {
    throw new Error("Choose a StrikLenz .jsonl.gz archive with its date range or YYYY-MM month in the filename.");
  }
  if (nameRange && (!validDate(nameRange[1]) || !validDate(nameRange[2]) || nameRange[1] > nameRange[2])) {
    throw new Error("Choose an archive with a valid inclusive date range in its filename.");
  }
  const byDate = {};
  let lineNumber = 0;
  return {
    addLine(line) {
      lineNumber += 1;
      if (!line.trim()) return;
      let cycle;
      try {
        cycle = JSON.parse(line);
      } catch {
        throw new Error(`Archive line ${lineNumber} is not valid JSON.`);
      }
      addCycle(byDate, cycle, lineNumber, archiveScope);
    },
    finish() {
      const count = Object.values(byDate).reduce((total, day) => total + day.cycles.length, 0);
      if (!count) throw new Error("The archive contains no trade-cycle records.");
      Object.values(byDate).forEach((day) => {
        day.booked_pnl = Number(day.booked_pnl.toFixed(2));
        day.pnl_exited = day.booked_pnl;
      });
      return {
        name,
        month: archiveScope.month || null,
        fromDate: archiveScope.fromDate || null,
        toDate: archiveScope.toDate || null,
        count,
        byDate,
      };
    },
  };
}

export function parseTradeCycleArchiveText(text, name) {
  const parser = createArchiveParser(name);
  String(text || "").split(/\r?\n/).forEach((line) => {
    parser.addLine(line);
  });
  return parser.finish();
}

export async function parseTradeCycleArchive(file) {
  if (!file || !/\.jsonl\.gz$/i.test(file.name || "")) {
    throw new Error("Choose a StrikLenz .jsonl.gz trade-cycle archive.");
  }
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser does not support local gzip archive viewing.");
  }

  const parser = createArchiveParser(file.name);
  const reader = file.stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";
    lines.forEach((line) => parser.addLine(line));
    if (done) break;
  }
  if (pending) parser.addLine(pending);
  return parser.finish();
}
