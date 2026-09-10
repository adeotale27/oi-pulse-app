# VM Setup Guide for OI‑Pulse App (striklenz.com)

This document records the steps we discussed to get the OI‑Pulse application running on an Oracle Ubuntu VM and accessible via `https://striklenz.com`. It also notes the issues we encountered (e.g., hairpin NAT) and how we resolved them.

---

## 1. Prerequisites on the VM

- Ubuntu 22.04 LTS (or similar) on Oracle Cloud Infrastructure.
- SSH access with a sudo‑enabled user (we used `ubuntu`).
- Basic tools installed: `curl`, `git`, `nginx`, `certbot`, `ufw`, `python3‑venv`, `nodejs`, `yarn`.

```bash
# Update OS
sudo apt update && sudo apt upgrade -y

# Install essential utilities
sudo apt install -y git curl wget gnupg2 lsb-release ca-certificates apt-transport-https software-properties-common

# Node.js (via NodeSource) + Yarn (classic)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install -g yarn@1.22.22

# Python venv & pip
sudo apt install -y python3 python3-venv python3-pip

# Nginx + Certbot + UFW
sudo apt install -y nginx certbot python3-certbot-nginx ufw
```

---

## 2. Find the VM’s Public IP

Run **inside** the VM:

```bash
PUBLIC_IP=$(curl -s http://169.254.169.254/opc/v1/public-ip/)
echo "Public IP: $PUBLIC_IP"
# Example output: 130.210.22.47
```

*(Private IP can be obtained with `.../private-ip/` if needed.)*

---

## 3. DNS Configuration (GoDaddy)

1. Log in to GoDaddy → **My Products** → locate `striklenz.com` → **DNS** → **Manage DNS**.
2. Add / edit two **A** records:

| Host (Name) | Points to (Value) | TTL |
|-------------|-------------------|-----|
| `@`         | `<PUBLIC_IP>`     | Default (1 h) |
| `www`       | `<PUBLIC_IP>`     | Default (1 h) |

3. Save. Propagation usually < 5 min (verify with `dig +short striklenz.com`).

---

## 4. Cloud‑Level Firewall (OCI Security List)

1. OCI Console → **Networking** → **Virtual Cloud Networks** → select your VCN → **Security Lists**.
2. Choose the security list attached to your instance’s subnet.
3. Under **Ingress Rules**, add (if missing):
   - **Source CIDR:** `0.0.0.0/0` (or restrict to your IP)
   - **IP Protocol:** TCP
   - **Destination Port Range:** `80` (and later `443` for HTTPS)
   - **Description:** “Allow HTTP/HTTPS from internet”

4. Save the rule.

> **Note:** The host firewall (`ufw`) must also allow these ports (see step 5).

---

## 5. Host Firewall (ufw)

```bash
sudo ufw allow 'Nginx Full'   # opens 80/tcp and 443/tcp
sudo ufw enable
sudo ufw status verbose       # verify 80 and 443 are ALLOW IN
```

---

## 6. Backend – FastAPI (Uvicorn) as a systemd Service

### 6.1 Prepare the backend environment

```bash
cd /home/ubuntu/apps/oi-pulse-app-1/backend   # adjust path if needed
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
deactivate   # leave venv; service will call venv's uvicorn directly
```

### 6.2 Create the systemd unit

```bash
sudo tee /etc/systemd/system/oi-pulse-backend.service > /dev/null <<'EOF'
[Unit]
Description=OI‑Pulse FastAPI backend
After=network.target

[Service]
User=ubuntu                                 # <-- your Ubuntu username
WorkingDirectory=/home/ubuntu/apps/oi-pulse-app-1/backend
Environment="PATH=/home/ubuntu/apps/oi-pulse-app-1/backend/.venv/bin"
ExecStart=/home/ubuntu/apps/oi-pulse-app-1/backend/.venv/bin/uvicorn server:app --host 127.0.0.1 --port 8000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
```

### 6.3 Enable & start

```bash
sudo systemctl daemon-reload
sudo systemctl enable oi-pulse-backend.service
sudo systemctl start oi-pulse-backend.service
sudo systemctl status oi-pulse-backend.service   # should be active (running)
```

*The backend now listens only on `127.0.0.1:8000`; nginx will proxy to it locally.*

---

## 7. Frontend – React Build

```bash
cd /home/ubuntu/apps/oi-pulse-app-1/frontend
yarn install          # first time or if package.json changed
yarn build            # creates ./build with optimized static files
# Result: /home/ubuntu/apps/oi-pulse-app-1/frontend/build
```

> Re‑run `yarn build` whenever you change frontend code, then reload nginx (see step 9).

---

## 8. Nginx Site Configuration

Create `/etc/nginx/sites-available/striklenz`:

```bash
sudo tee /etc/nginx/sites-available/striklenz > /dev/null <<'EOF'
# -----------------------------------------------------------------
# HTTP → HTTPS redirect (will be replaced by Certbot’s redirect)
# -----------------------------------------------------------------
server {
    listen 80;
    listen [::]:80;
    server_name striklenz.com www.striklenz.com;

    # Temporary redirect – Certbot will overwrite this with its own.
    return 301 https://$host$request_uri;
}

# -----------------------------------------------------------------
# HTTPS server – serves React build and proxies /api/
# -----------------------------------------------------------------
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name striklenz.com www.striklenz.com;

    # SSL will be filled in by Certbot (see step 9)
    ssl_certificate /etc/letsencrypt/live/striklenz.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/striklenz.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # -----------------------------------------------------------------
    # Serve the React frontend (static files)
    # -----------------------------------------------------------------
    root /home/ubuntu/apps/oi-pulse-app-1/frontend/build;
    index index.html;

    # Try files, fallback to index.html for client‑side routing
    location / {
        try_files $uri $uri/ /index.html;
    }

    # -----------------------------------------------------------------
    # Proxy all /api/* requests to the FastAPI backend (127.0.0.1:8000)
    # -----------------------------------------------------------------
    location /api/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Optional: increase timeouts for long‑running requests
        proxy_read_timeout 90s;
        proxy_send_timeout 90s;
    }

    # -----------------------------------------------------------------
    # (Optional) Websocket support – uncomment if you ever add WS endpoints
    # -----------------------------------------------------------------
    # location /ws/ {
    #     proxy_pass http://127.0.0.1:8000;
    #     proxy_http_version 1.1;
    #     proxy_set_header Upgrade $http_upgrade;
    #     proxy_set_header Connection "upgrade";
    # }
}
EOF
```

Enable the site and test:

```bash
sudo ln -s /etc/nginx/sites-available/striklenz /etc/nginx/sites-enabled/
sudo nginx -t          # should output “syntax is ok” and “test is successful”
sudo systemctl reload nginx
```

---

## 9. Obtain Let’s Encrypt TLS Certificate

```bash
sudo certbot --nginx -d striklenz.com -d www.striklenz.com
```

During the prompts:
- Provide an email for renewal notices.
- Agree to the Terms of Service.
- When asked about redirecting HTTP to HTTPS, choose **Redirect** (option 2).

Certbot will:
- Place the certificate in `/etc/letsencrypt/live/striklenz.com/`.
- Update the nginx config with the SSL directives and a proper HTTP→HTTPS redirect.

Reload nginx:

```bash
sudo systemctl reload nginx
```

**Test:**

```bash
curl -I https://striklenz.com          # expect 200 OK (or 301 to /)
curl -I https://striklenz.com/api/docs # expect 200 OK (Swagger UI)
```

Open a browser to `https://striklenz.com`; you should see the login page with a valid padlock.

---

## 10. Automatic Certificate Renewal

Certbot installs a systemd timer that runs twice daily. Verify:

```bash
sudo certbot renew --dry-run
```

If the dry‑run succeeds, no further action is needed.

---

## 11. (Optional) Security Headers Snippet

Create `/etc/nginx/snippets/security-headers.conf`:

```bash
sudo tee /etc/nginx/snippets/security-headers.conf > /dev/null <<'EOF'
add_header X-Frame-Options SAMEORIGIN;
add_header X-Content-Type-Options nosniff;
add_header Referrer-Policy "same-origin";
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src * data:; font-src 'self';";
EOF
```

Add `include snippets/security-headers.conf;` inside the HTTPS `server { … }` block (after the `ssl_*` lines) in `/etc/nginx/sites-available/striklenz`, then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## 12. Quick Commands for Future Updates

```bash
# Re‑build frontend and reload nginx
cd /home/ubuntu/apps/oi-pulse-app-1/frontend
yarn build
sudo systemctl reload nginx

# Restart backend if Python code changed
sudo systemctl restart oi-pulse-backend.service
```

---

## 13. Issues Encountered & How We Solved Them

| Issue | Symptoms | Resolution |
|-------|----------|------------|
| **Hairpin NAT not enabled** | `curl -I http://<VM_PUBLIC_IP>` from **inside** the VM failed with “Couldn't connect to server”, while `curl -I http://127.0.0.1` succeeded. | This is expected on most public clouds (including OCI). Verified the service locally and tested from an external machine (laptop) or via the domain after DNS propagation. No fix needed; just test externally. |
| **Missing cloud‑level ingress rule** | External `curl` timed out or was refused despite nginx running and ufw allowing the port. | Added an ingress rule in the OCI security list allowing TCP 80/443 from `0.0.0.0/0` (or restricted source). |
| **Port conflict on 80** | Nginx failed to start (`Address already in use`). | Used `sudo ss -tlnp | grep :80` to identify the conflicting process, stopped it (`sudo systemctl stop <conflicting-service>`), then restarted nginx. |
| **Backend not reachable via /api/** | Nginx returned 502 Bad Gateway or connection refused when proxying to `127.0.0.1:8000`. | Verified the backend systemd service was active (`sudo systemctl status oi-pulse-backend`), ensured it was listening on `127.0.0.1:8000` (`sudo ss -tlnp | grep :8000`), and checked nginx error log for upstream errors. |
| **Certificate not issued** | Certbot failed with unauthorized error. | Confirmed DNS A records pointed to the correct VM IP and that port 80 was reachable externally (needed for HTTP‑01 challenge). After fixing DNS/security, re‑ran certbot. |

---

## 14. Verification Checklist (run after setup)

- [ ] `sudo ss -tlnp | grep ':80\|:443'` shows nginx listening.
- [ ] `sudo systemctl status oi-pulse-backend` → active (running).
- [ ] `curl -I http://striklenz.com` → 301 → https://striklenz.com.
- [ ] `curl -I https://striklenz.com` → 200 OK (or 301 to /).
- [ ] `curl -I https://striklenz.com/api/docs` → 200 OK (Swagger UI).
- [ ] Browser at `https://striklenz.com` loads login page, padlock shows valid cert.
- [ ] `sudo certbot renew --dry-run` succeeds.

---

### 🎉 You’re done!

Your OI‑Pulse app is now publicly accessible at **https://striklenz.com** with a secure HTTPS connection, the React frontend served by nginx, and all API calls proxied to the FastAPI backend.

Keep this guide handy; when you return tomorrow, simply:
1. Pull any new code (`git pull`).
2. Re‑run the frontend build and/or restart the backend as needed.
3. Reload nginx (`sudo systemctl reload nginx`).

Happy coding! 🚀