# CAS Auto Trade at 15:20 IST

This is the operator and design note for the **15:20 directional ATM buy**. It is **not** the classic CAS expiry tool (15:28 **SELL both** wings).

Read this before turning **Auto-Trade Live** on. Paper first. You still **exit by hand** in Positions.

---

## One-sentence job

Just before the NSE Closing Auction Session print, freeze **live Kite NIFTY**, lock **that ATM** call and put, then buy **one** of them **MARKET** if the **first sane 15:20 indicative** is far enough from the freeze. Direction only. No auto square-off.

---

## Two different CAS arms (do not mix Live)

| | Classic CAS (existing) | Auto Trade 15:20 (this file) |
|--|------------------------|------------------------------|
| **When** | Watch window ~15:27–15:35, fire ~15:28 | Freeze ~15:19:30, signal from 15:20:00, cutoff 15:22:00 |
| **What** | **SELL** CE **and** PE (straddle/strangle) | **BUY** **one** ATM **CE** *or* **PE** |
| **Why** | Expiry cash-settlement / CAS rule book | Indicative NIFTY vs pre-print spot → directional edge |
| **Index** | NIFTY and/or SENSEX (watch list) | **NIFTY only** |
| **Exit** | Engine / your CAS rules | **You**, in **Positions** |
| **Activate** | Needs **Activate** on the CAS page | Needs Auto mode **Paper** or **Live**; classic Activate **not** required |
| **Live together** | **Forbidden** with Auto-Trade Live | **Forbidden** with classic CAS Live |

The UI says this on the CAS page. The API rejects enabling both Live flags at once.

---

## What you are trading (idea)

NSE runs a **Closing Auction Session** for NIFTY 50 cash. Around **15:20 IST** the site publishes an **indicative** NIFTY 50. That number is often **not** the same as the last continuous-session LTP.

On **1 Sep 2026** the live tape was stuck near **23,980.55** (ATM **24000**). The **15:20:01** indicative was **24,007.50** (**+27**). A **+50** threshold would have skipped that day. Default here is **±15 points**. A later **15:20:30** print **24,125.20** must **not** fire a second order.

F&O still trades until **15:30**, so a 15:20 option BUY is inside the session.

**This is not multicast.** Website JSON is **seconds late**. Treat Live as “best effort first print,” not a matching-engine race.

---

## Decisions (why it was built this way)

1. **New arm, not a rewrite of 15:28.** Classic SELL-both stays in `cas_rule_expiry_automation` + `cas_bridge.py`. Auto Trade is `cas_auto_trade.py` + `cas_indicative_nse.py` + the Auto Trade block on `CasPanel.jsx`.

2. **NSE JSON, not CSV, not HTML scrape.** Source is `GET https://www.nseindia.com/api/marketStatus` → `indicativenifty50`. Cookie warmup hits nseindia.com home + the CAS page (same Akamai pattern as FII/DII).

3. **ATM from frozen live NIFTY, never from the indicative.** If you re-rounded ATM from 24,125 you would have bought the wrong strike. Indicative is **direction only**.

4. **First sane print only.** Stay **ARMED** until the print is not the leftover live LTP (`indexLast` often sits on the freeze). Prefer a stamped `closingValue` if `indexLast` is still the freeze. **Never** treat overnight `status: CLOSE` as today’s 15:20. **Never** use `closingValue` with **no clock** (yesterday’s settlement).

5. **Default ±15 pts, not 50.** 1 Sep 2026 was +27. Admin can raise `auto_bullish_pts` / `auto_bearish_pts` (0–200).

6. **One MARKET BUY, `market_protection=-1`, validity DAY.** Same Kite MARKET shape as classic CAS sells. Quantity = **Auto Trade lots** × NIFTY lot size (not 15:28 expiry lots). Product **NRML** or **MIS** from classic CAS settings.

7. **No auto-exit.** Manual in Positions. No second fire after **EXECUTED** or a **failed** live order.

8. **Paper is the live-session rehearsal.** Auto **Paper** uses **live Kite NIFTY** (freeze/ATM) and **live NSE JSON** (first print), then a **DRY-BUY** id — **no** Zerodha fill. Classic **Activate is not required**. Use this in the cash session before Auto **Live**. Inject before 15:20 is a **rehearsal** and does **not** spend today’s fire; from 15:20 inject *is* today’s paper print.

9. **In-memory settings.** Auto mode **resets to Off** when the API process restarts. You must turn Paper/Live on again after a deploy.

10. **Any weekday the admin leaves it on.** Code does **not** restrict to NIFTY expiry Tuesday. If you only want expiry, turn it **Off** other days.

11. **Engine loop ~200 ms when Auto Trade is on**, even without classic **Activate**. A 1 s sleep would miss the first print. Classic CAS off + Auto Trade off → 1 s idle loop.

---

## Admin: what to do, when

Times are **IST**. Clocks below are defaults; they live in CAS settings (`auto_*`), not Admin configuration OI poll.

### Days before / morning

1. Publisher **Kite API** connected (same token as OI). F&O instruments must resolve NIFTY ATM CE/PE.
2. **Live order readiness** on the CAS page: api_key, access_token, SDK `market_protection`, F&O symbols, **static IP whitelist** = **backend egress** (shown on the page), not your laptop if the API is in the cloud.
3. Classic CAS: keep **Paper** (or Off). Do **not** **Activate Live** if you will use Auto-Trade Live.
4. Set **Auto Trade lots** and **NRML/MIS**. Keep classic expiry lots separate.
5. Leave Auto mode **Off** until you intend to run the 15:20 arm.

### Paper in a live market (check before Live on your account)

This is the same 15:20 path as Live, except the BUY is a dry-run.

1. Publisher **Kite connected** (quotes and ATM symbols). Classic CAS: **do not Activate Live**.
2. CAS page → **15:20 Auto Trade** → Auto mode **Paper** (not Live). Classic Activate **not** needed.
3. **NSE live** is the widget print as it changes. **Fire print** is the one print used for the BUY. After a fire, NSE live still updates; there is no second order.
4. When it fires: same strip shows **when** (IST), **how** (CE/PE, freeze vs indicative, DRY-BUY), and **latency**.
5. Optional before 15:20: **Inject first print** → rehearsal on today’s live freeze (does not spend the 15:20 fire).
6. Leave **Paper** on through **15:19:30–15:22** for the real NSE print. Do **not** Inject at/after 15:20 if you want NSE to be the day’s paper print.
7. If the dry-run looks right, turn Auto **Off**, then next session (or after Reset) use **Live**.

### Rehearsal inject (morning / any time before 15:20)

1. Auto mode **Paper** (not Live, not Off). Kite must quote NIFTY.
2. **Inject first print** with a fake indicative (e.g. freeze+20). You should see **Last rehearsal** **EXECUTED**, paper order id `DRY-…`, **CE** or **PE** on the **locked ATM**. Today’s status is **not** EXECUTED.
3. Inject again before 15:20 → another rehearsal (does not block 15:20).
4. **Reset** the CAS day if you need a clean Auto Trade state (`POST /cas/reset`).

### Live session — 15:19–15:22 (the real run)

| Clock | What the machine does | What you do |
|-------|----------------------|-------------|
| **~15:09** | NSE cookie warmup (10 min before prepare) | Desk open, Kite live, Auto **Paper** or **Live** already on |
| **15:19:30** | **PREPARING**: quote live NIFTY, round ATM, cache ATM CE + PE symbols | Confirm Frozen NIFTY and Locked ATM look right |
| **15:19:55** | **ARMED** if both legs exist | Do not change lots/ATM; do not enable classic Live |
| **15:20:00** | Poll NSE JSON every **auto_poll_ms** (default **250 ms**) | Watch Status; do not mash Inject |
| **First sane print** | **CAS_DATA_RECEIVED** → **SIGNAL_DECIDED** → **EXECUTING** | Paper: `DRY-…` id, no fill. Live: one BUY hits Kite |
| **CE if Δ ≥ +15** | BUY ATM **CE** | Open **Positions**; plan your exit |
| **PE if Δ ≤ −15** | BUY ATM **PE** | Same |
| **\|Δ\| inside band** | **NO_TRADE** for the day | Nothing to exit |
| **15:22:00** still ARMED | **NO_TRADE** (`cutoff_passed_no_indicative`) | NSE never gave a usable print |
| **After fill** | **EXECUTED** — no second order | **You exit.** The app will not square |

If **PREPARING** fails (Kite blip), it **retries** until cutoff. If a **Live** MARKET is **rejected**, status **FAILED** + `order_status=failed` — **it will not resend**.

### After 15:22 / after you exit

1. Switch Auto mode **Off** unless you want it tomorrow (remember: process restart already turns it off).
2. Journal is **admin-only** if you record the trade.
3. Do not expect this arm to flatten the book.

### If something looks wrong

| You see | Meaning | What to do |
|---------|---------|------------|
| Status **IDLE**, mode off | Auto Trade not enabled | Paper or Live on the Auto Trade toggle (admin) |
| **kite_not_connected** | No publisher Kite on the engine | Header → Kite API |
| **atm_legs_missing** | Instruments dump thin | Wait for dump / reconnect Kite |
| **nse_error** / skip `same_as_freeze` | Widget still showing live LTP | Wait; should stay ARMED |
| **stale_close** | Overnight CLOSE leftover | Correct; wait for OPEN 15:20 |
| **NO_TRADE** inside ±15 | Print too close to freeze | Intended; or lower thresholds **next** day |
| Nested Live error | Classic Live + Auto Live | Turn one Live off |
| Inject blocked | Mode is Live | Paper only |
| Process restarted at 15:18 | Settings back to Off | Turn Paper/Live on again **before** 15:19:30 |

---

## Trade logic (exact)

All times IST. Spot = Kite NIFTY last price (else OHLC close). Strike gap = NIFTY meta (50).

### 1. Freeze and ATM

```
spot = Kite quote(NIFTY)
atm  = round_atm(spot, 50)
prepare ATM CE and ATM PE tradingsymbols
qty  = lots × lot_size          # same lots for the one buy
```

Do **not** recompute `atm` when the indicative arrives.

### 2. First print (accept / reject)

From `indicativenifty50`, consider **`indexLast` then `closingValue`** (skip duplicate prices).

A hit is **rejected** if:

- value ≤ 0, or outside 15000–40000
- name present and not NIFTY
- `status == CLOSE`
- wall clock **before 15:20**
- stamp another calendar day
- stamp time **before 15:20:00**
- field is `closingValue` and **no parseable stamp**
- `|value − freeze| < 0.51` (**same as freeze** — leftover live LTP)

First hit that passes is **the** print. Later 15:20:30 numbers are ignored once we have decided.

### 3. Signal

```
delta = indicative − freeze

if delta >= auto_bullish_pts:   BULLISH → BUY CE
if delta <= −auto_bearish_pts:  BEARISH → BUY PE
else:                           NO_TRADE
```

Defaults: `auto_bullish_pts = auto_bearish_pts = 15`.

### 4. Order

- `transaction_type=BUY`, `order_type=MARKET`, `validity=DAY`, `market_protection=-1`
- Tag `CASAUTO` (classic sells use `CASRULE`)
- Paper: log only, id `DRY-BUY-…` (no broker)
- Live: `kite.place_order`; needs kiteconnect ≥ 5.2 for `market_protection`

### Worked example (1 Sep 2026)

| | |
|--|--|
| Freeze live NIFTY | 23,980.55 |
| Locked ATM | **24000** CE + PE |
| 15:20:01 print | 24,007.50 (`closingValue` or `indexLast` once it moves) |
| Δ | **+26.95** ≥ 15 → **BUY 24000 CE** |
| 15:20:30 | 24,125.20 → **ignored** (already decided) |
| If threshold were 50 | **NO_TRADE** |

---

## State machine

`IDLE` → `PREPARING` → `ARMED` → `CAS_DATA_RECEIVED` → `SIGNAL_DECIDED` → `EXECUTING` → `EXECUTED`

Branches: `NO_TRADE`, `FAILED`. New IST date resets to empty state.

---

## Defaults (in `cas_bridge._SETTINGS`)

| Key | Default | Role |
|-----|---------|------|
| `auto_trade_mode` | `off` | `off` / `paper` / `live` |
| `auto_trade_enabled` | false | Forced on with paper/live, off with off |
| `auto_prepare_time` | `15:19:30` | Freeze + ATM |
| `auto_arm_time` | `15:19:55` | ARMED |
| `auto_signal_start` | `15:20:00` | Start NSE polls |
| `auto_cutoff_time` | `15:22:00` | Give up |
| `auto_bullish_pts` | 15 | CE trigger |
| `auto_bearish_pts` | 15 | PE trigger |
| `auto_poll_ms` | 250 | NSE poll (clamped 150–2000) |
| `lots` / `product` | 1 / NRML | Shared with classic CAS |

---

## Code map

| Piece | Path |
|-------|------|
| State + decide + BUY | `backend/cas_auto_trade.py` |
| NSE JSON + first-print rules | `backend/cas_indicative_nse.py` |
| Settings, Live mutex, inject | `backend/cas_bridge.py` |
| 200 ms loop when auto on | `backend/cas_rule_expiry_automation/engine.py` |
| MARKET BUY | `backend/cas_rule_expiry_automation/kite_client.py` `place_market` |
| HTTP | `GET /api/cas/status`, `POST /api/cas/settings`, `POST /api/cas/auto-trade/inject` |
| UI | `frontend/src/components/CasPanel.jsx` (CAS Auto Trade section) |
| Tests | `backend/tests/test_cas_auto_trade.py` |

Engine is attached on API boot so Auto Trade can run **without** opening the CAS tab. You still must set Paper/Live (in-memory).

---

## APIs (admin)

- **GET `/api/cas/status`** — `settings` + `auto_trade` snapshot (frozen NIFTY, ATM, signal, order, NSE error, latency).
- **POST `/api/cas/settings`** — `auto_trade_mode`, times, thresholds, lots, product. Live Auto Trade = admin. Cannot set classic `live_trading` and `auto_trade_mode=live` together.
- **POST `/api/cas/auto-trade/inject`** `{ "indicative": 24007.5 }` — Paper only. Before 15:20: rehearsal (does not spend today’s fire). From 15:20: today’s paper print.
- **POST `/api/cas/reset`** — clears classic day **and** Auto Trade today.

Guests can view a reduced CAS status if the CAS page is Public. They cannot enable Live or inject.

---

## What this will not do

- Will not scrape the CAS HTML table or a CSV you download.
- Will not buy SENSEX / BANKNIFTY.
- Will not sell both wings at 15:20.
- Will not trail, SL, or auto-exit.
- Will not keep Auto Trade on across a backend restart.
- Will not beat co-located CAS participants on the first tick.

---

## Checklist (print this)

- [ ] Kite live; Live readiness IP whitelisted if going Live
- [ ] Classic CAS **not** Live (if Auto Live)
- [ ] Lots / product set
- [ ] Auto **Paper** at least one successful Inject
- [ ] On the session: Auto **Paper** or **Live** **before 15:19:30**
- [ ] At 15:19:55: Frozen NIFTY + ATM look sane
- [ ] After fill: **exit in Positions yourself**
- [ ] Auto **Off** when done
