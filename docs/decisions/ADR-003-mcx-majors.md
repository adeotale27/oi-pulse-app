# ADR-003 — MCX majors on the OI desk

## Context

Kite lists commodity F&O under MCX `name` values **CRUDEOIL**, **GOLD**, **SILVER**, **NATURALGAS** (minis are different names: CRUDEOILM, GOLDM, SILVERM, NATGASMINI). There is no cash index quote. ADR-001 left them `pollable: false`.

## Decision

1. Catalog `pollable: true` for those four majors. They are **not** in `DESK_IDS` and are **not** in default `enabled_indices`.
2. ATM / header LTP = **nearest unexpired MCX FUT** (`EXCHANGE:TRADINGSYMBOL`), re-resolved every snapshot so the contract can roll. Gold tender: dump drops the front month; we take the next listed FUT.
3. OI chain is still `get_snapshot` on `MCX-OPT` CE/PE for that `name`.
4. When any enabled id is MCX, the OI poller uses **09:00–23:30 IST** on NSE trading days. Journal, CAS, and NSE cash hours stay 09:15–15:40.
5. Admin → Index management inspects the live Kite dump, shows the four majors as shortcuts, and Enable merges into `INDEX_CONFIG`. Publisher Kite must have the commodity segment.

## Consequences

- Enabling Crude/Gold/Silver/NG is an admin tick, not a surprise poll of four extra chains.
- NSE `is_market_open()` is unchanged. `is_oi_session_open(mcx=…)` covers evening OI.
- Mini contracts stay searchable by Kite name; they are not auto-wired.
