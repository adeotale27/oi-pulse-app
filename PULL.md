# Pull extension-only code

This tree belongs on **https://github.com/adeotale27/Market_Events** (`main`).

Until that repo is filled, the same files live on **oi-pulse-app** as an **orphan** branch (Pulse app files are not on it):

```bash
git clone --single-branch --branch cursor/market-events-1bf9 \
  https://github.com/adeotale27/oi-pulse-app.git Market_Events
cd Market_Events
```

Copy onto the real product repo (needs push access to Market_Events):

```bash
git remote add product https://github.com/adeotale27/Market_Events.git
git push -u product HEAD:main
```

Or, in a Cloud Agent **opened on Market_Events**, clone the orphan branch into `/tmp` and copy files onto `main`.

**Do not** merge `cursor/market-events-1bf9` into OI Pulse `main`.
