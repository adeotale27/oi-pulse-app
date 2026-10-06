# Desk AI — market intelligence outside the OI chart

The OI Change chart already shows PCR, CE/PE change, and walls. Desk AI must **not** recap that.

It answers: *what could change an options trade that is not visible from OI alone?*

Deterministic code scores:

- **Heavyweight cash** — uploaded Nifty 50 / Bank Nifty / Sensex constituents (Admin → Upload / Impact Risk) quoted via **Kite**, Yahoo if Kite is down. Weight × move = estimated index impact.
- **Breakouts / VWAP / gaps**, **breadth**, **sector** participation
- **News** — public RSS (Google News + ET markets)
- **Corporate calendar** — `nse_events` joined onto those same constituents
- **India VIX** when the poller has it
- **Day capital** — Positions booked % of wallet (−3% caution, −5% stop adds, −8% defend). At stop/defend, Desk AI **What to do** leads with the capital line, hides sell ideas, and does not chase “prefer CE shorts”. Book score stays path-risk only.

OpenAI is optional. Prefer **Admin configuration → Desk AI keys** (OpenAI, DeepSeek, Grok, Groq, OpenRouter, or a custom OpenAI-compatible base URL). Keys are Fernet-encrypted in Mongo and never returned to the browser. Env `OPENAI_API_KEY` / `DESK_GUIDE_API_KEY` remains a fallback.

## Who sees what

Desk AI is **open for the whole desk** (admin and guests share one switch). It is **off** until someone turns it on from the header **AI** chip.

| Control | Where | Who it applies to |
|---------|--------|-------------------|
| **On / Off** | Header AI chip only | Everyone — one flag |
| **Open in side panel** | Header AI menu (desktop) | Full **cash / news** tape in the right panel |
| **Phone popup** | Tap the AI chip | Same cash tape; close returns to the chart |
| **Carry brief AI** | Toggle on the carry card (desktop) | Overnight **impact** only (gap-risk movers / HIGH events). Hidden on phones |
| **Book radar intelligence** | Radar panel tick | Book risk vs cash; tiles reorder up/down |

There is no chart strip and no Desk AI section in Admin configuration.

The floating Market Intel popup uses the same impact-ranked news candidates as
the Market Intel page. Newly arriving candidates produce an in-app alert; if
the user's existing desk-notification setting and browser permission are on,
they also produce an OS notification while the page is not focused. The first
poll only establishes a baseline, so old queued headlines do not fire a burst
of alerts after opening the desk. These alerts report news; they do not alter
OI signals or trades.

## APIs

- **GET /api/desk-outside** — optional `?index=GOLD` when that MCX name is selected; otherwise cash heavyweight tape. Cached ~45s.
- `GET/POST /api/desk-guide` — POST attaches outside tape server-side
- `GET /api/desk-memory?days=180` — owner-scoped trade-cycle aggregates for the signed-in desk user
- `POST /api/desk-ai` — signed-in desk user: `desk_ai_show` and `desk_ai_carry`. Radar ticks stay admin-only

Desk Guide's LLM cache is isolated by authenticated desk identity and compacted snapshot. A shared provider cooldown prevents guests from forcing extra calls; only admins can bypass it. Snapshot strings are treated as untrusted data by the model prompt.

## Personal strategy memory

Main Desk, Overnight Hold, and Radar use the same read-only `/desk-memory`
summary from the current user's `trade_cycles` owner scope (up to 180 days).
Admins see the admin book; guests see only the book keyed to their own guest /
Kite identity. This memory endpoint is separate from the admin-only journal.
It returns aggregated index/option-side/direction and weekday cohorts, sample
counts, win/loss rate, expectancy (average booked P&L per closed cycle), average
win/loss, and—separately as execution/process evidence—average holding time,
carried/overnight count, and partial-exit count. It never returns fills,
symbols, cycle IDs, notes, or individual trades to Desk AI.

At least three cycles are required before a cohort is described as a recurring
pattern. Smaller samples are labeled limited; fewer than three total closed
cycles are explicitly reported as insufficient history. These summaries are
descriptive only: they do not establish causation or predict a future outcome.
If the database read fails, the API returns an error and Desk AI says the
memory read is unavailable—not that the user has no history. The summary can
inform advice only: it cannot alter settings, journal entries, positions, or
trades, and it can never place or route an order.

## Overnight evidence and scenarios

The carry brief remains rule-scored: Desk AI cannot change its deterministic
band, the OI poll, CAS, app settings, code, or any order. It is a read-only
analyst over the compact evidence submitted by the app—not an autonomous agent
with tools to perform app or broker actions. The server reports timestamp
coverage, OI snapshot age/status, outside-tape snapshot age, and GIFT/VIX fetch
age. A fetch time is retrieval time, not proof of the exchange's last-trade
time. Timestamp coverage is input availability—not model confidence or the
probability of a trade succeeding. GIFT proxy quotes are identified as proxies;
missing outside tape is explicitly marked unavailable.

The optional configured LLM provider may add conditional Base case, Gap up,
Gap down, and Reassess if scenarios for Overnight Hold, plus a base/contrary
case for the main Desk AI and watch-next bullets for Radar. Scenarios are risk
paths, not forecasts. The prompt requires supplied evidence only, calls out
source conflicts or insufficient coverage, and forbids invented prices,
probabilities, or positions; the UI renders these sections and evidence
freshness separately from the authoritative deterministic carry verdict.

## Auditable Desk AI and session brief

Desk AI labels the model/rule read as interpretation and keeps the OI, cash,
news, and calendar tiles under observed data. Its evidence disclosure shows
available source identities, source timestamps, age, and source status; it
also lists expected timestamped families that were not supplied. Timestamp
coverage describes input availability, not model confidence. A directional
disagreement between the GIFT Nifty change and NIFTY constituent breadth is
shown as mixed evidence with both source times, not resolved into a prediction.

The main Desk AI panel uses the server's market phase for a compact pre-open,
session, or closeout brief. The pre-open brief can show GIFT Nifty's reported
change versus its previous close, timestamped headlines, and tracked company
events. It does not claim that a headline happened overnight unless its
publication timestamp supports that interpretation. Session and closeout
summaries use existing OI and cash snapshots with their source times; retained
data is not represented as an exact closing print. A session journal percentage
is shown only when the existing admin-only journal data is available. Desk AI
does not yet have trade-plan follow-up records, so the closeout says so rather
than inventing a review or exposing private journal notes. Brief items are
presented as separate, readable cards with plain-language metric names,
explicit sources and timestamps, and a distinct live/stale status badge where
the source provides one. PCR is described as the put-to-call open-interest
ratio; CE/PE shorthand is avoided in the brief.
