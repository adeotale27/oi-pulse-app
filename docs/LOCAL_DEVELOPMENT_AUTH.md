# Local development authentication bypass

## Purpose

The local-only admin bypass lets developers and coding agents open the actual
dashboard and admin surfaces without repeatedly entering credentials. Use it
for local UI development, responsive/render checks, and end-to-end work against
the developer's local backend.

## Enable locally

In `backend/.env`, set:

```env
APP_ENV=development
LOCAL_DEV_ADMIN_BYPASS=true
```

Restart the backend after changing environment values. Open the app through a
loopback URL such as `http://localhost:3000` with its API at
`http://localhost:8000`. The frontend reads the backend's `/auth/state`
response, receives the local admin state, and skips the login screen. A visible
warning in the app identifies this mode.

## Safety contract

- The setting is **off by default** in `.env.example`.
- The backend refuses to start if the setting is enabled unless
  `APP_ENV=development`.
- Every bypassed request must have both a loopback client address and a
  loopback Host (`localhost`, `127.0.0.1`, or `::1`). A LAN or public hostname
  never receives bypass access.
- The backend enforces this at admin authorization and `/auth/state`; hiding a
  frontend login screen alone is not authorization.
- No password, admin token, or persistent session is created by the bypass.
- The bypass does not disable MongoDB, application readiness, Kite/provider
  requirements, or other operational checks.
- Never set `LOCAL_DEV_ADMIN_BYPASS=true` on staging, production, shared
  development servers, or a deployed preview. An attempted non-development
  configuration fails closed at backend startup.

To verify normal authentication locally, set `LOCAL_DEV_ADMIN_BYPASS=false` or
remove it and restart the backend. This feature does **not** provide passwordless
access to a live deployment; use a protected staging account for deployed
testing.

## Guidance for coding agents

Treat this bypass as an authentication boundary, not a convenience UI toggle.
Preserve the environment guard, loopback checks, backend route enforcement,
visible UI warning, and tests. Do not add a client-controlled query parameter,
localStorage switch, build-time frontend flag, or production fallback.
