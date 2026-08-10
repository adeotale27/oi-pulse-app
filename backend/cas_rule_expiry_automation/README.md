# CAS Rule package notes

The full user guide (setup, daily login, Kite logout, security, and how the logic works in plain language) is in the **repo root [`README.md`](../README.md)**.

This folder is the runnable app:

```bash
python -m cas_rule_expiry_automation
# → http://127.0.0.1:5030
```

## Module map

| File | Job |
|------|-----|
| `app.py` | Admin UI, credentials, Kite login/logout APIs |
| `engine.py` | Background loop: baselines, activate, WebSocket, fire |
| `kite_client.py` | Token exchange, profile, MARKET sell |
| `strategy_engine.py` | Detect CAS close → sell CE+PE |
| `strike_resolver.py` | ATM ± N cache / resolve |
| `order_engine.py` | Live vs dry-run order path |
| `ws_stream.py` | KiteTicker bus |
| `backtest_ws.py` | Same logic on history |
| `config.py` | `config.ini` load/save (secrets chmod 0600) |
| `state.py` | Activation, fills, kite user id badge |

## Tests

```bash
PYTHONPATH=. python3 -m pytest cas_rule_expiry_automation/tests/ -q
```
