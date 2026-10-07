import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { fetchJournalDay } from "@/lib/api";
import TradeJournalModal from "./TradeJournalModal";

jest.mock("@/lib/api", () => ({
  fetchJournalMonth: async () => ({
    today: "2026-10-07",
    days: [],
    stats: {},
    tags: [],
  }),
  fetchJournalYear: async () => ({ stats: {}, heatmap: null }),
  fetchJournalPeriod: async () => ({ stats: {} }),
  fetchJournalDay: jest.fn(),
  saveJournalDay: jest.fn(),
  addJournalScreenshot: jest.fn(),
  deleteJournalScreenshot: jest.fn(),
}));

jest.mock("@/components/ui/dialog", () => {
  const React = require("react");
  const passthrough = ({ children, ...props }) => {
    delete props.open;
    delete props.onOpenChange;
    return React.createElement("div", props, children);
  };
  return {
    Dialog: passthrough,
    DialogContent: passthrough,
    DialogHeader: passthrough,
    DialogTitle: passthrough,
    DialogDescription: passthrough,
  };
});

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }) => {
    delete props.size;
    delete props.variant;
    return <button {...props}>{children}</button>;
  },
}));

jest.mock("framer-motion", () => ({
  AnimatePresence: ({ children }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }) => <div {...props}>{children}</div>,
  },
}));

jest.mock("lucide-react", () => {
  const Icon = () => null;
  return {
    BookOpen: Icon,
    ChevronLeft: Icon,
    ChevronRight: Icon,
    FileText: Icon,
    ImagePlus: Icon,
    Save: Icon,
    Trash2: Icon,
    Trophy: Icon,
  };
});

jest.mock("@/components/AdminDialogNavigation", () => () => null);
jest.mock("@/components/InfoTip", () => () => null);
jest.mock("@/components/DownloadTradesButton", () => () => null);
jest.mock("@/components/TradeCycleArchiveButton", () => ({ onArchiveLoaded }) => (
  <button
    type="button"
    data-testid="archive-import-fixture"
    onClick={() => onArchiveLoaded({
      name: "striklenz-cycle-archive-2026-06-12-to-2026-07-05.jsonl.gz",
      month: null,
      fromDate: "2026-06-12",
      toDate: "2026-07-05",
      count: 2,
      byDate: {
        "2026-06-12": {
          date: "2026-06-12",
          booked_pnl: 500,
          pnl_exited: 500,
          exited_count: 1,
          trade_count: 25,
          cycles: [{
            cycle_id: "local-cycle",
            status: "closed",
            exit_date: "2026-06-12",
            booked_pnl: 500,
            closed_quantity: 25,
            display_name: "NIFTY 24000 CE",
            index: "NIFTY",
            side: "CE",
            direction: "short",
            entry_time_ist: "09:30",
            exit_time_ist: "10:15",
            events: [{ kind: "exit" }],
            fills: [{ price: 100 }],
          }],
        },
        "2026-07-05": {
          date: "2026-07-05",
          booked_pnl: -80,
          pnl_exited: -80,
          exited_count: 1,
          trade_count: 5,
          cycles: [{
            cycle_id: "local-cycle-july",
            status: "closed",
            exit_date: "2026-07-05",
            booked_pnl: -80,
            closed_quantity: 5,
            display_name: "BANKNIFTY 52000 PE",
            index: "BANKNIFTY",
            side: "PE",
            direction: "short",
            entry_time_ist: "11:10",
            exit_time_ist: "11:40",
            events: [{ kind: "exit" }],
            fills: [{ price: 200 }],
          }],
        },
      },
    })}
  >
    Import test archive
  </button>
));

jest.mock("@/lib/holidays", () => ({
  holidayCellLabel: () => "",
  holidayShortName: () => "",
  isHoliday: () => null,
  isJournalSessionDayIST: () => true,
  isSpecialSessionIST: () => false,
  nextTradingDayIST: (day) => day,
  previousTradingDayIST: (day) => day,
}));

jest.mock("@/lib/journalYearHeat", () => ({
  overlayMonthOnYearHeat: () => ({ month_nets: Array(12).fill(0), months: [] }),
}));

jest.mock("@/lib/universe", () => ({
  HEATMAP_IDS: ["NIFTY"],
  INDEX_SHORT: { NIFTY: "NIFTY" },
  DESK_IDS: ["NIFTY"],
}));

jest.mock("@/lib/journalSave", () => ({
  journalSavePayload: () => null,
  resolveJournalSaveDoc: () => null,
}));

jest.mock("@/lib/journalMoney", () => ({
  compactPnl: (value) => String(value),
  exactPnl: (value) => String(value),
  fmtInr: (value) => String(value),
}));

jest.mock("@/lib/journalPct", () => ({
  bookedPct: () => null,
  fmtBookedPct: (value) => String(value),
  madeAfterCharges: () => 0,
  weekEquity: () => ({ funds_base: null, booked_pct: null }),
}));

jest.mock("sonner", () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

describe("TradeJournalModal local archive calendar", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    global.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows imported cycle P&L in a separate calendar and never opens the saved-day editor", async () => {
    await act(async () => root.render(
      <TradeJournalModal open onOpenChange={() => {}} />,
    ));
    await act(async () => container.querySelector('[data-testid="archive-import-fixture"]').click());

    expect(container.querySelector('[data-testid="journal-local-archive-banner"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="journal-month-label"]').textContent).toBe("June 2026");
    expect(container.querySelector('[data-testid="journal-period-panel"]').textContent).not.toContain("Booked profit");

    await act(async () => container.querySelector('[data-testid="journal-cell-2026-06-12"]').click());
    expect(container.querySelector('[data-testid="journal-local-archive-day"]').textContent).toContain("NIFTY 24000 CE");
    expect(container.querySelector('[data-testid="journal-day-editor"]')).toBeNull();
    expect(fetchJournalDay).not.toHaveBeenCalled();

    await act(async () => container.querySelector('[data-testid="journal-next-month"]').click());
    expect(container.querySelector('[data-testid="journal-month-label"]').textContent).toBe("July 2026");
    await act(async () => container.querySelector('[data-testid="journal-cell-2026-07-05"]').click());
    expect(container.querySelector('[data-testid="journal-local-archive-day"]').textContent).toContain("BANKNIFTY 52000 PE");
    expect(fetchJournalDay).not.toHaveBeenCalled();
  });

  it("clears the imported data and returns to the saved journal calendar", async () => {
    await act(async () => root.render(
      <TradeJournalModal open onOpenChange={() => {}} />,
    ));
    await act(async () => container.querySelector('[data-testid="archive-import-fixture"]').click());
    await act(async () => container.querySelector('[data-testid="journal-clear-local-archive"]').click());

    expect(container.querySelector('[data-testid="journal-local-archive-banner"]')).toBeNull();
    expect(container.querySelector('[data-testid="journal-month-label"]').textContent).toBeTruthy();
  });
});
