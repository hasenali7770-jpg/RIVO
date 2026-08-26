#!/usr/bin/env bash
#
# RIVO demonstration stack — one command.
#
#   ./infra/scripts/demo.sh
#
# Brings up a populated RIVO on this machine so the product can be shown before
# any Cloudflare, payment or SMS account exists: a published marketplace with
# sample photos, road incidents on the map, the admin dashboard, and the whole
# listing lifecycle from creation to approval.
#
# Everything it creates is flagged `is_demo` and titled "[عينة]", and it uses a
# database of its own (rivo_demo) so it never touches development or production
# data. It refuses to run with APP_ENV=production.
#
# THE ONE THING WORTH GETTING FIRST: a free Mapbox account. Without a token the
# map, place search and routing show an "unavailable" state — which is honest,
# but it is half the product. Signing up takes five minutes and costs nothing
# (50,000 map loads and 100,000 route requests a month are free). Then:
#
#   export MAPBOX_PUBLIC_TOKEN=pk....
#   export MAPBOX_SECRET_TOKEN=sk....
#   ./infra/scripts/demo.sh
#
# Photos are local samples, so no Cloudflare R2 account is needed to show a
# populated marketplace. Reels need Cloudflare Stream and stay hidden without it.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$HERE"

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
DEMO_DB="${RIVO_DEMO_DB:-rivo_demo}"
DEMO_URL="postgresql://${PGUSER}@${PGHOST}:${PGPORT}/${DEMO_DB}"
API_PORT="${PORT:-3000}"
ADMIN_PORT="${ADMIN_PORT:-3002}"

ADMIN_EMAIL="${ADMIN_BOOTSTRAP_EMAIL:-admin@rivo.local}"
ADMIN_PASSWORD="${ADMIN_BOOTSTRAP_PASSWORD:-RivoDemo-ChangeMe-2026}"

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
note() { printf '  %s\n' "$1"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$1"; exit 1; }

[ "${APP_ENV:-development}" = "production" ] && fail "APP_ENV=production. The demo stack must never run against production."

command -v psql >/dev/null || fail "psql not found — install the PostgreSQL client."
pg_isready -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1 || fail "PostgreSQL is not answering on ${PGHOST}:${PGPORT}."
redis-cli ping >/dev/null 2>&1 || fail "Redis is not answering. Start it with: redis-server --daemonize yes"

step "Preparing the demo database (${DEMO_DB})"
if psql "postgresql://${PGUSER}@${PGHOST}:${PGPORT}/postgres" -tAc \
     "SELECT 1 FROM pg_database WHERE datname='${DEMO_DB}'" | grep -q 1; then
  note "already exists — reusing it"
else
  createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$DEMO_DB"
  note "created"
fi

step "Applying migrations"
DATABASE_URL="${DEMO_URL}?schema=public" \
  npx prisma migrate deploy --schema apps/api/prisma/schema.prisma >/dev/null
note "$(psql "$DEMO_URL" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE '\\_prisma%' AND tablename <> 'spatial_ref_sys'") tables, PostGIS present"

step "Building"
npm run build -w @rivo/config >/dev/null
npm run build -w @rivo/contracts >/dev/null
npm run build -w @rivo/api >/dev/null
note "API built"

# --- environment for the demo processes ------------------------------------
export DATABASE_URL="${DEMO_URL}?schema=public"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
export APP_ENV=development
export PORT="$API_PORT"
export API_BASE_URL="http://localhost:${API_PORT}"
export ADMIN_URL="http://localhost:${ADMIN_PORT}"
export JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:-rivo-demo-access-secret-local-only-not-a-deployment}"
export JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-rivo-demo-refresh-secret-local-only-not-deploy}"
# Sign-in codes are printed by the API instead of sent by SMS, so the demo needs
# no SMS contract. The API refuses to start this way in production.
export OTP_PROVIDER=console
# The fee is created and settled by a finance operator in the dashboard, which
# is the real flow until a gateway contract exists.
export PAYMENT_PROVIDER=manual
export AI_PROVIDER=none
# Sample photos come from the API itself rather than a Cloudflare R2 bucket.
export R2_PUBLIC_BASE_URL="http://localhost:${API_PORT}/demo-media"
export ADMIN_BOOTSTRAP_EMAIL="$ADMIN_EMAIL"
export ADMIN_BOOTSTRAP_PASSWORD="$ADMIN_PASSWORD"
export RIVO_SEED_DEMO_PUBLISHED=true
export LOG_LEVEL="${LOG_LEVEL:-warn}"

step "Seeding sample content"
npm run seed -w @rivo/api 2>&1 | sed 's/^/  /'

step "Starting the API"
node apps/api/dist/main.js > /tmp/rivo-demo-api.log 2>&1 &
API_PID=$!
for _ in $(seq 1 30); do
  curl -sf "http://localhost:${API_PORT}/api/v1/health" >/dev/null && break
  sleep 1
done
curl -sf "http://localhost:${API_PORT}/api/v1/health" >/dev/null \
  || { cat /tmp/rivo-demo-api.log; fail "The API did not start. Log above."; }
note "http://localhost:${API_PORT}  (log: /tmp/rivo-demo-api.log)"

step "Starting the admin dashboard"
# Origin only — the dashboard's client appends /api/v1 itself.
NEXT_PUBLIC_API_BASE_URL="http://localhost:${API_PORT}" \
  npm run dev -w @rivo/admin > /tmp/rivo-demo-admin.log 2>&1 &
ADMIN_PID=$!
for _ in $(seq 1 60); do
  curl -sf "http://localhost:${ADMIN_PORT}" >/dev/null && break
  sleep 1
done
note "http://localhost:${ADMIN_PORT}  (log: /tmp/rivo-demo-admin.log)"

cleanup() {
  printf '\n\033[1mStopping the demo stack…\033[0m\n'
  kill "$API_PID" "$ADMIN_PID" 2>/dev/null || true
  wait "$API_PID" "$ADMIN_PID" 2>/dev/null || true
  printf 'Stopped. The demo database %s was left in place.\n' "$DEMO_DB"
}
trap cleanup EXIT INT TERM

LISTINGS=$(curl -s "http://localhost:${API_PORT}/api/v1/properties" | grep -o '"id"' | wc -l | tr -d ' ')
MAPS_ON=$(curl -s "http://localhost:${API_PORT}/api/v1/health/capabilities" | grep -o '"maps":[a-z]*' | cut -d: -f2)

cat <<INFO

$(printf '\033[1m═══ RIVO demo is running ═══\033[0m')

  Marketplace API   http://localhost:${API_PORT}/api/v1/properties
  API documentation http://localhost:${API_PORT}/api/docs
  Admin dashboard   http://localhost:${ADMIN_PORT}

  Admin sign-in     ${ADMIN_EMAIL}
                    ${ADMIN_PASSWORD}
                    (it will ask you to change this on first sign-in)

  Published sample listings: ${LISTINGS}
  Live map (Mapbox):         ${MAPS_ON:-false}

  Mobile app, on an emulator or a device on this network:
    cd apps/mobile && flutter run \\
      --dart-define=RIVO_API_BASE_URL=http://10.0.2.2:${API_PORT}/api/v1

  Signing in to the app needs no SMS: request a code and the API returns it
  in the response (OTP_PROVIDER=console).

$(printf '\033[1mWhat to show\033[0m')
  1. The marketplace — sample listings with photos, filters for sale/rent and
     property type, price pins on the map.
  2. The dashboard's review queue — two listings are waiting there. Open one,
     approve it, and watch it appear publicly straight away. Reject the other
     instead and the reason you type is what the seller reads.
  3. Create a listing in the app — the wizard refuses at 7 photos and accepts
     at 8. That rule is enforced by the database, not just the screen.
  4. Pay the 3,000 IQD fee, then settle it in the dashboard as finance. The
     listing reaches review only after the money is recorded.
  5. The audit trail — every decision, with the administrator who made it.
     Try to edit a row in the database; it refuses.

$(printf '\033[33mNot in this demo\033[0m')
  Photos are local samples (a Cloudflare R2 account replaces them).
  Reels need Cloudflare Stream. AI enhancement needs a provider key.
  Card payment needs a gateway contract — the fee is settled by hand here.
$( [ "${MAPS_ON:-false}" = "true" ] || printf '  The live map needs a free Mapbox token — see the top of this script.\n' )

  Press Ctrl-C to stop.

INFO

wait
