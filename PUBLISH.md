# Publish & version

## Version lockstep

Keep these identical on every ship:

| File | Example |
|------|---------|
| `VERSION` | `1.0.0` |
| `manifest.json` → `"version"` | `1.0.0` |
| `CHANGELOG.md` | new `## 1.0.0` section |

Chrome Web Store **rejects** an upload if `manifest.version` did not increase.

Suggested bumps:

- Patch `1.0.0` → `1.0.1` — copy, JSON, bugfix
- Minor `1.0.x` → `1.1.0` — new tile / host permission
- Major `2.0.0` — breaking data shape

Git:

```bash
git add VERSION manifest.json CHANGELOG.md
git commit -m "Market Events v1.0.1"
git tag v1.0.1
git push origin main --tags
```

## Sideload (desk)

`chrome://extensions` → Developer mode → Load unpacked → folder with `manifest.json`.

After a code change click **Reload** on the extension card.

## Chrome Web Store

1. Zip **without** `.git`:
   ```bash
   git archive -o market-events.zip HEAD
   ```
2. [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole) (one-time Google developer fee).
3. New item → upload zip → name **Market Events** → screenshots of spots + four tiles + index chips.
4. Privacy: no account, no Kite. Hosts: NSE + Yahoo + (optional) GitHub raw.
5. Submit. Later versions: bump semver → new zip → Upload new package.

## What not to do

- Do not deploy this on Emergent/k8s with OI Pulse.
- Do not put `KITE_*` or `OPENAI_*` here.
- Do not merge this tree into `oi-pulse-app` `main`.
