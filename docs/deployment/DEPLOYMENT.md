# RIVO — production deployment

> Target architecture from Master Plan §15. Every command here has been written
> against the actual repository layout; where something could not be verified in
> the build environment it is marked.

## Architecture

```text
                    Mobile apps (Android / iOS)
                              │
                     Cloudflare DNS + WAF
                              │
              ┌───────────────┴───────────────┐
              │                               │
     api.<RIVO_DOMAIN>              admin.<RIVO_DOMAIN>
              │                               │
        ┌─────┴───────────────────────────────┴─────┐
        │      DigitalOcean Droplet (Docker)        │
        │  ┌──────────┐ ┌──────────┐ ┌───────────┐  │
        │  │ NestJS   │ │ Worker   │ │ Next.js   │  │
        │  │ API      │ │ (BullMQ) │ │ Admin     │  │
        │  └────┬─────┘ └────┬─────┘ └───────────┘  │
        │       │            │                      │
        │  ┌────┴────────────┴────┐                 │
        │  │  Redis / Valkey      │                 │
        │  └──────────────────────┘                 │
        └───────────────────┬───────────────────────┘
                            │  (private network only)
              DigitalOcean Managed PostgreSQL + PostGIS

  Photos → Cloudflare R2      Reels → Cloudflare Stream
  Maps   → Mapbox             AI    → provider API (worker)
  Errors → Sentry
```

The API and the worker run as **separate containers from the same image**. A long
AI job or a stalled video encode must not occupy a request handler, and the two
scale independently as media load grows.

---

## 1. Provision

### Droplet
- DigitalOcean Basic, **4 GB RAM / 2 vCPU / 80 GB SSD**, Ubuntu 24.04 LTS.
- Region: Frankfurt (`fra1`) or Amsterdam (`ams3`) — lowest latency to Iraq of
  the available regions.
- Enable **backups** on the droplet as well; they are cheap and independent of
  the database backups.

### Managed PostgreSQL
- **2 GB plan**, PostgreSQL 16.
- Enable the **PostGIS extension** in the control panel before first migrate.
- **Restrict inbound access to the droplet only** (Trusted Sources → the droplet).
  Never leave the database open to the internet.

### Firewall
```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp     # SSH — restrict to the client's office IP if it is static
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```
Ports 3000 (API) and 3002 (admin) are **not** opened: Nginx reaches them over
localhost. Compose binds Postgres and Redis to `127.0.0.1` for the same reason.

---

## 2. Install

```bash
# Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker "$USER"

# Nginx and TLS
apt-get update && apt-get install -y nginx certbot python3-certbot-nginx postgresql-client

# RIVO
mkdir -p /opt/rivo && cd /opt/rivo
git clone https://github.com/<ORG>/RIVO.git .
```

---

## 3. Configure

```bash
cp .env.example .env
chmod 600 .env          # it holds live credentials
nano .env
```

Generate the two JWT secrets — they must differ, and the API refuses to boot if
they match:

```bash
echo "JWT_ACCESS_SECRET=$(openssl rand -base64 48)"
echo "JWT_REFRESH_SECRET=$(openssl rand -base64 48)"
```

The API validates the whole environment at startup and **refuses to boot** in
production with a console OTP provider, missing Mapbox or R2 credentials, plain
`http://` URLs, or no Sentry DSN. The error names every offending variable, so a
failed boot tells you exactly what to fix.

---

## 4. Start

```bash
cd /opt/rivo
docker compose up -d --build

# Schema
docker compose exec api npx prisma migrate deploy

# Bootstrap Super Admin (reads ADMIN_BOOTSTRAP_* from .env)
docker compose exec api npm run seed
```

> **Do not** set `RIVO_SEED_DEMO=true` in production. The seed script refuses to
> create demo content when `APP_ENV=production`, but do not rely on that alone.

Verify:
```bash
curl -fsS http://localhost:3000/api/v1/health
# {"status":"ok", … "postgis":"ok" … "redis":"ok"}

curl -fsS http://localhost:3000/api/v1/health/capabilities
# Confirms which integrations this deployment actually has.
```

---

## 5. Reverse proxy and TLS

```bash
cp infra/nginx/rivo.conf /etc/nginx/sites-available/rivo
cp infra/nginx/rivo-proxy-params.conf /etc/nginx/

# Substitute the real domain
sed -i "s/RIVO_DOMAIN/<your-domain>/g" /etc/nginx/sites-available/rivo

ln -sf /etc/nginx/sites-available/rivo /etc/nginx/sites-enabled/rivo
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

certbot --nginx -d api.<RIVO_DOMAIN> -d admin.<RIVO_DOMAIN>
```

In Cloudflare set SSL/TLS mode to **Full (strict)**. "Flexible" would leave the
hop between Cloudflare and the origin in plaintext, which defeats the certificate
you just installed.

`TRUST_PROXY=true` must be set (it is the default). Without it every caller shares
one rate-limit bucket, because the API sees only Nginx's address.

---

## 6. Scheduled work

```cron
# Nightly database backup
0 2 * * * cd /opt/rivo && set -a && . .env && set +a && ./infra/scripts/backup.sh >> /var/log/rivo-backup.log 2>&1

# TLS renewal
0 3 * * 1 certbot renew --quiet --post-hook "systemctl reload nginx"
```

Telemetry aggregation, raw-sample purging, incident expiry and payment-intent
expiry are **not** cron jobs — the worker schedules them internally through
BullMQ, so they survive a host restart without cron entries.

---

## 7. Deploying an update

Use the **Deploy** GitHub Actions workflow (`workflow_dispatch`), which builds
before stopping anything, runs migrations, restarts, and then verifies `/health`.
Manually:

```bash
cd /opt/rivo
git rev-parse HEAD > .last-deploy     # rollback target
git fetch --all --tags && git checkout <tag-or-sha>
docker compose build api worker admin
docker compose run --rm api npx prisma migrate deploy
docker compose up -d --no-deps api worker admin
curl -fsS https://api.<RIVO_DOMAIN>/api/v1/health
```

### Rolling back

```bash
cd /opt/rivo
git checkout "$(cat .last-deploy)"
docker compose up -d --build --no-deps api worker admin
```

Migrations are written to be **additive**, so rolling the application back does
not require rolling the database back. If a migration itself is the problem, see
[BACKUP_RESTORE.md](./BACKUP_RESTORE.md).

---

## 8. Monitoring

- **Sentry** — set `SENTRY_DSN_API`, `SENTRY_DSN_ADMIN` and `SENTRY_DSN_MOBILE`.
  Required in production; the API will not boot without the API DSN.
- **Uptime** — point any external monitor at `https://api.<RIVO_DOMAIN>/api/v1/health`
  and alert on anything other than `"status":"ok"`. That endpoint reports Postgres,
  PostGIS and Redis separately, so an alert says which one broke.
- **Logs** — structured JSON with a request id on every line:
  ```bash
  docker compose logs -f api | jq 'select(.level >= 40)'
  ```
- **Queues** — visible on the admin dashboard. A growing `failed` count on
  `rivo-ai` usually means the AI provider credential expired; listings still
  publish with their original photos, so it degrades rather than breaks.

---

## 9. Scaling, when the time comes

In rough order of what will bite first:

1. **Worker first.** Media and AI work is the first thing to saturate.
   `docker compose up -d --scale worker=3`.
2. **Redis to a managed instance** once queue depth is routinely non-zero.
3. **Database plan up** when connection count or CPU is sustained high. The
   PostGIS indexes are already in place; the usual cause is plan size, not
   missing indexes.
4. **API replicas behind Nginx** last. The API is stateless — sessions live in
   PostgreSQL and Redis — so this is straightforward when it is needed.

Master Plan §15: do not introduce Kubernetes for the first release.
