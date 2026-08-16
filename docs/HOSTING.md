# Hosting OI Pulse off Emergent

This is the ops roadmap if you want the desk on **your** machine and **your** GoDaddy domain (`aaisnamkeen.com` or similar), instead of Emergent’s preview / k8s.

**Short answers**

| Question | Answer |
|----------|--------|
| Run on [Oracle Cloud Always Free](https://www.oracle.com/in/cloud/free/)? | **Possible, not the best first move.** A free Ampere VM can host FastAPI + React. Oracle accounts (especially Always Free in IN) get frozen or reclaimed. Treat it as a cheap experiment, not the only copy of production. |
| Switch the database to Oracle Database? | **No.** This app is Mongo-shaped (nested strike snapshots, Motor, journal screenshots). Rewriting to ATP/Autonomous SQL is a product rewrite, not a hosting change. Keep MongoDB. |
| GoDaddy domain? | **Yes, easy.** Point DNS at the new IP (or better: Cloudflare in front of GoDaddy). TLS with Caddy or Let’s Encrypt. Update CORS and Kite redirect URLs. |

Recommended path for *this* stack: **MongoDB Atlas (keep Mongo) + one small Linux VM + Caddy + your domain.** Oracle Cloud can be that VM. Hetzner / DigitalOcean / Lightsail are often less drama.

---

## 1. What you have today

```
Emergent (k8s + their Mongo + preview host)
    FastAPI poller ──► Mongo (oi_snapshots, journal, vault, sessions)
    React desk ──► /api  (same origin or REACT_APP_BACKEND_URL)
```

The desk **polls Kite every 15–60s** during NSE hours and **writes a snapshot per tick**. That is CPU + disk + a long-lived Python process. It is not a sleepy brochure site. Always Free is enough *if* the VM stays up; it is a bad place to be surprised by a reclaimed instance on a Monday open.

Mongo collections that must survive a move: `oi_snapshots`, `straddle_samples`, `alerts`, `credentials`, `settings`, `trade_journal`, guest/admin sessions, uploads (`index_constituents`, `nse_events`). See [DATA.md](./DATA.md).

---

## 2. Should you leave Emergent?

**Stay on Emergent** if you want zero ops, previews, and someone else restarting pods.

**Leave Emergent** when you want:

- A stable public URL on **your** domain
- Control of backups and secrets
- Not paying / depending on a preview platform for a live market desk

You can **run both** during cutover: Emergent stays live until Atlas + VM + DNS are proven.

---

## 3. Database: do not switch to Oracle DB

Oracle Autonomous Database (ATP/ADW) on the Always Free page is **SQL**. OI Pulse uses **Motor (async Mongo)**:

- Strike arrays inside each snapshot
- Time-range queries (`timestamp` windows for `/oi/{index}/change`)
- Journal screenshots as nested docs
- Encrypted Kite vault document

Moving that to Oracle SQL/JSON means rewriting `server.py`, `oi_tracker.py`, journal, auth, uploads, and all indexes. **Do not do that to “use the free Oracle DB.”**

**Keep MongoDB.** Host it as one of:

| Option | When |
|--------|------|
| **MongoDB Atlas** (M0 free / Flex / M10) | Best default. Backups, TLS, no disk babysitting. M0 is tight on RAM/connections; bump if snapshots lag. |
| Mongo in Docker on the same VM | Cheapest, more ops. Snapshot the volume. Fine for one trader. |
| Mongo on a second small VM | Isolates data from the poller. |

Oracle also has **Oracle Database API for MongoDB** on Autonomous JSON. That is still a compatibility layer, not native Motor behaviour. Skip it unless you enjoy debugging drivers during market hours.

---

## 4. Compute: Oracle vs everyone else

### Oracle Cloud Always Free (Ampere A1)

- **Good:** 4 OCPU / 24 GB is more RAM than a typical ₹500 VPS. Enough for Python + Node build + Mongo *or* Atlas.
- **Bad:** Account verification, capacity “out of Ampere in this AD”, idle reclaim, IN region quirks, support tickets for a free tier.
- **Use if:** you already have a paid-looking OCI tenancy that stays in good standing, or you accept a weekend of fighting the console.

### Better “just run the desk” options

| Host | Fit |
|------|-----|
| **Hetzner / DigitalOcean / Lightsail** | Simple VM, predictable. Pair with Atlas. |
| **Railway / Fly / Render** | Easy deploy; watch sleep policies (this poller must **not** sleep at 9:14 IST). |
| **Keep Emergent + Atlas** | Smallest change: only move Mongo, keep k8s for a while. |

**Do not** put the Kite poller on a platform that spins to zero.

---

## 5. Target architecture (recommended)

```
GoDaddy domain  ──DNS──►  (optional Cloudflare proxy)
                              │
                         Caddy :443  (auto HTTPS)
                              │
                    ┌─────────┴─────────┐
                    │  React static     │  /        (yarn build)
                    │  FastAPI :8000    │  /api/*   (uvicorn)
                    └─────────┬─────────┘
                              │
                         MongoDB Atlas  (same as today, new cluster URI)
```

One VM, two processes (or Docker Compose). Poller stays inside FastAPI as it does now.

---

## 6. Roadmap (do in this order)

### Phase 0 — Decide and freeze secrets

1. Keep **Mongo**. Decide Atlas vs Mongo-on-VM.
2. Decide VM: OCI Ampere **or** Hetzner/DO (pick one; don’t start both).
3. Inventory from Emergent:
   - `MONGO_URL` / `DB_NAME`
   - `ADMIN_USERNAME` / password hash in `settings`
   - `CREDENTIALS_FERNET_KEY` (or you will **lose** the Kite vault)
   - Telegram tokens
   - `OPENAI_API_KEY` / `DESK_GUIDE_*` (desk AI; never commit)
   - `CORS_ORIGINS`
   - Kite API key + **redirect URL** in Zerodha console
4. Export Mongo (`mongodump`) from Emergent **before** any DNS cut.

### Phase 1 — New Mongo (no app rewrite)

1. Create Atlas project (Mumbai `ap-south-1` if offered — closer to NSE/Kite).
2. User + password, IP allowlist: VM public IP **and** your home IP for dump/restore.
3. `mongorestore` into `oi_pulse`.
4. Point a **staging** FastAPI at the new URI; confirm `/api/status`, journal, login.

Do **not** point production Emergent at Atlas until restore is verified.

### Phase 2 — VM

1. Ubuntu 22.04/24.04, SSH keys only, firewall: 22 / 80 / 443.
2. Install Docker **or** Python 3.11 + Node 18 + Caddy.
3. `git clone` this repo; `backend/.env` with Atlas URI, Fernet key, `CORS_ORIGINS=https://YOUR_DOMAIN`.
4. `frontend`: `yarn build` with empty `REACT_APP_BACKEND_URL` so the browser uses **same origin** `/api` (see `frontend/src/lib/api.js`).
5. Reverse proxy:

```
# Caddyfile (sketch)
your.domain {
    encode gzip
    reverse_proxy /api* 127.0.0.1:8000
    reverse_proxy /docs* 127.0.0.1:8000
    reverse_proxy /openapi.json 127.0.0.1:8000
    root * /opt/oi-pulse/frontend/build
    file_server
    try_files {path} /index.html
}
```

6. systemd (or compose) for `uvicorn server:app --host 127.0.0.1 --port 8000`.
7. `loginctl enable-linger` / restart on reboot. Confirm poller writes `oi_snapshots` during market hours.

**Oracle-specific:** open ingress 80/443 on the VCN security list **and** iptables; attach a reserved public IP so DNS does not churn.

### Phase 3 — GoDaddy domain

You own DNS at GoDaddy. Two patterns:

**A. Direct (simplest)**

1. GoDaddy → DNS → **A** record `@` → VM public IPv4.
2. **AAAA** if you have IPv6.
3. `www` CNAME → `@` (or A to same IP).
4. Wait TTL (often 600s). Caddy obtains Let’s Encrypt certs.

**B. Cloudflare in front of GoDaddy (recommended)**

1. Add site in Cloudflare; copy their nameservers.
2. GoDaddy → Nameservers → replace with Cloudflare NS (you still **pay/renew** the domain at GoDaddy).
3. Cloudflare A record to VM; proxy orange-cloud for DDoS/cache (API `/api` should be **DNS only** or cache bypass — poller JSON must not be cached).
4. Full (strict) SSL once Caddy has a cert, or Cloudflare origin cert.

Do **not** use GoDaddy’s parked/forwarding page. That breaks `/api`.

After DNS:

1. Set `CORS_ORIGINS=https://aaisnamkeen.com,https://www.aaisnamkeen.com` (real hosts only).
2. Zerodha developer console: add `https://YOUR_DOMAIN` login/redirect URLs (publisher + guest Kite).
3. Open the desk, login, Fresh Pull, journal, Positions.

### Phase 4 — Cutover

1. Weekend or after 15:40 IST.
2. Final `mongodump` from Emergent → restore Atlas (or catch-up).
3. Flip DNS.
4. Keep Emergent running 48h as rollback (old A record).
5. When stable, stop Emergent so two pollers do not **double-write** snapshots.

### Phase 5 — Operate

- Atlas backup on; test restore once.
- VM snapshots weekly.
- Watch disk: snapshots + 96h retention still grow intra-day.
- Uptime: if Oracle reclaims the instance, DNS is dead until you attach a new IP — hence reserved IP + Atlas (data survives the VM).

---

## 7. What not to do

- Do not migrate collections to Oracle SQL “because the free tier includes a database.”
- Do not run two live pollers (Emergent + new VM) against the same Mongo.
- Do not put Kite secrets in GitHub or Caddy logs.
- Do not use a free PaaS that sleeps.
- Do not skip Fernet key copy — new VM + old Mongo without the key = locked vault.

---

## 8. Suggested first experiment (low regret)

1. Atlas M0 + dump from Emergent.  
2. ₹/€ cheap VPS (or OCI if the tenancy already works) + Caddy + this repo.  
3. Subdomain first: `desk.yourdomain.com` A-record.  
4. Use it for a full session. Then move apex/`www`.

If OCI signup fights you for more than an evening, **stop and use Hetzner/DO**. The desk does not care whose logo is on the hypervisor.

---

## 9. Checklist

- [ ] `mongodump` from Emergent stored off-platform  
- [ ] Atlas (or VM Mongo) restored and queried  
- [ ] `CREDENTIALS_FERNET_KEY` on the new host  
- [ ] Uvicorn + Caddy + HTTPS  
- [ ] `CORS_ORIGINS` = production https origins  
- [ ] Zerodha redirect URLs updated  
- [ ] One market session: OI ticks, alerts, Positions, journal  
- [ ] DNS TTL lowered before cutover, raised after  
- [ ] Emergent poller stopped after cutover  
- [ ] Backup restore drill  

---

## 10. Where to put UI, API, and Mongo (decision)

This desk is **not** a brochure site. One FastAPI process polls Kite every 15–60s, writes snapshots, and holds WebSockets. Ranked for *this* product:

| Piece | Use | Do not use |
|-------|-----|------------|
| **Database** | **MongoDB Atlas** (Mumbai if offered). Native Motor, backups, data survives a dead VM. M0 to try; paid if snapshot lag. | Oracle SQL / ATP, Firebase, Vercel KV, “Mongo API on Autonomous JSON” |
| **Backend (FastAPI + poller)** | **Always-on Linux VM** (Hetzner CX22 / DigitalOcean $6–12 / Lightsail). systemd `uvicorn`. Same box can serve the React build. | **Vercel / Netlify / Cloudflare Workers** (sleep, 10s limits, no durable asyncio poll). Railway/Render **free** sleep. Two pollers on one DB. |
| **Frontend (React)** | **Same VM + Caddy** (`/` static, `/api` and `/ws` reverse-proxy). Empty `REACT_APP_BACKEND_URL` → same origin. | Vercel-only *if* you still need the VM for API. Extra CORS + WS pain, no poller. |

**Best default for you:** Atlas + one small Mumbai/Singapore-adjacent VM + your GoDaddy domain on Caddy. Cost is a few dollars for Atlas (or free M0) plus ~₹500–1500/month for the VM.

**Vercel** is a good host for *static* UIs. It is a bad host for *this* backend. Putting only the UI on Vercel still requires that VM for Kite/Mongo/WS.

**Emergent/k8s** is fine until you want your own domain and backups; then move Mongo to Atlas first, then the process.

Full cutover steps: sections 6–9 above.

Local dev is unchanged: [LOCAL_SETUP.md](./LOCAL_SETUP.md).
