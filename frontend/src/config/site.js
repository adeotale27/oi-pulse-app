// Single source of truth for Striklenz public/marketing config.
// Pricing + feature flags are also served by GET /api/public/site-config so an
// admin can override them without a redeploy. This module holds brand copy,
// navigation, FAQ and sensible pricing fallbacks.

export const BRAND = {
  name: "Striklenz",
  tagline: "Read the options market like a pro.",
  domain: "striklenz.com",
};

export const NAV_LINKS = [
  { id: "product", label: "Product", href: "#product" },
  { id: "features", label: "Features", href: "#features" },
  { id: "premium", label: "Premium", href: "#premium" },
  { id: "pricing", label: "Pricing", href: "#pricing" },
  { id: "faq", label: "FAQ", href: "#faq" },
];

export const FREE_FEATURES = [
  "NIFTY, BANK NIFTY & SENSEX live view",
  "Full option chain with OI & OI change",
  "Volume, PCR & put/call build-up",
  "Strike Pressure meter",
  "Market structure: support & resistance",
  "Market intelligence & regime read",
  "No broker connection required",
];

export const PREMIUM_FEATURES = [
  "Connect your broker & import positions",
  "Position-level P&L & risk exposure",
  "Position-specific OI analysis",
  "Long / Short markers on the OI chart",
  "Position Brain — instant position read",
  "Desk AI — ask anything about your book",
  "Advanced, personalised alerts",
];

export const FAQS = [
  {
    q: "Do I need to connect my broker to use Striklenz?",
    a: "No. The core market intelligence — option chain, OI, OI change, PCR, Strike Pressure and market structure for NIFTY, BANK NIFTY and SENSEX — is completely free and needs no broker connection.",
  },
  {
    q: "What does Premium add?",
    a: "Premium makes it personal. Connect your broker to import live positions and unlock position P&L, position-specific OI analysis, Long/Short markers on the OI chart, Position Brain and Desk AI.",
  },
  {
    q: "Is my broker password stored?",
    a: "Never. Striklenz uses official broker OAuth / approved login flows. We never see or store your broker password, and you can disconnect any time.",
  },
  {
    q: "Which brokers are supported?",
    a: "Zerodha is live today. Upstox, Angel One, Dhan, Groww, Fyers and more are being added through a single secure connection layer.",
  },
  {
    q: "Is the data on this page live?",
    a: "The product demos on this page use an interactive simulated feed so you can explore the experience instantly. Inside Striklenz you get real market data.",
  },
  {
    q: "How do I sign in?",
    a: "Tap Get Started and continue with Google, or enter as a guest. It takes seconds.",
  },
];

// Pricing fallback (used until /api/public/site-config responds).
export const PRICING_FALLBACK = {
  currency: "INR",
  free: { price: 0, label: "Free" },
  premium: { monthly: 999, quarterly: 2499, yearly: 7999, label: "Premium", billing_default: "monthly" },
};

export const money = (n, currency = "INR") => {
  const num = Number(n) || 0;
  if (currency === "INR") return "\u20b9" + num.toLocaleString("en-IN");
  return num.toLocaleString();
};
