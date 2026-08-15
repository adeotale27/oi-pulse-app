# ADR-002 — Admin index registry

## Context

Desk ids were still effectively NIFTY / SENSEX / BANKNIFTY even after the static universe catalog. Adding FINNIFTY required code.

## Decision

Mongo `index_registry` is the live enable list. Kite instruments dump is synced to `kite_underlyings` for search. Inspect builds a capability profile from CE/PE/FUT rows. Enable merges into `INDEX_CONFIG` and `settings.enabled_indices`. The existing `KiteService.get_snapshot` / OITracker path is reused.

Disable sets `enabled: false` and removes from the poll list. Snapshots are never deleted.

## Alternatives

- Enable by editing `universe.py` only — still a deploy.
- Separate OI service per index — duplicates the working pipeline.

## Consequences

MCX majors can be enabled (nearest FUT + evening hours). See [ADR-003](./ADR-003-mcx-majors.md).
