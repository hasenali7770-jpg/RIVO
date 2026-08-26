#!/usr/bin/env bash
#
# RIVO database backup — Master Plan §17.
#
# Runs from cron on the application host. Writes a compressed custom-format dump,
# verifies it is readable, uploads it off-host, and prunes old copies.
#
#   0 2 * * * /opt/rivo/infra/scripts/backup.sh >> /var/log/rivo-backup.log 2>&1
#
# A backup that has never been restored is a guess, not a backup. restore.sh is
# the other half, and docs/deployment/BACKUP_RESTORE.md records when it was last
# exercised.

set -euo pipefail

BACKUP_DIR="${RIVO_BACKUP_DIR:-/var/backups/rivo}"
RETENTION_DAYS="${RIVO_BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="${BACKUP_DIR}/rivo-${TIMESTAMP}.dump"

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { log "ERROR: $*"; exit 1; }

# Prisma's DATABASE_URL carries parameters libpq does not understand — `schema`,
# `connection_limit`, `pgbouncer` and friends. pg_dump and psql reject the whole
# URL when they see one, so they are stripped here. Without this the nightly
# backup fails every night with "invalid URI query parameter".
libpq_url() {
  local url="$1"
  local base="${url%%\?*}"
  local query="${url#*\?}"
  [ "$query" = "$url" ] && { printf '%s' "$base"; return; }

  local kept=""
  local IFS='&'
  for param in $query; do
    case "${param%%=*}" in
      # Only parameters libpq itself recognises are preserved.
      sslmode|sslcert|sslkey|sslrootcert|application_name|connect_timeout|host|hostaddr|options)
        kept="${kept:+$kept&}$param" ;;
    esac
  done
  printf '%s%s' "$base" "${kept:+?$kept}"
}

[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is not set. Source the environment first: set -a; . /opt/rivo/.env; set +a"
command -v pg_dump >/dev/null || fail "pg_dump is not installed"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

log "Starting backup to ${ARCHIVE}"

# Custom format (-Fc): compressed, and restorable selectively with pg_restore,
# which matters when only one table needs recovering.
PGURL="$(libpq_url "$DATABASE_URL")"

pg_dump --format=custom --compress=9 --no-owner --no-privileges \
        --file="$ARCHIVE" "$PGURL" \
  || fail "pg_dump failed"

# Verify the dump is readable before it is trusted. A truncated file that nobody
# opened until the day of an outage is the classic backup failure.
pg_restore --list "$ARCHIVE" > /dev/null || fail "The dump is unreadable — pg_restore could not list it"

TABLE_COUNT="$(pg_restore --list "$ARCHIVE" | grep -c 'TABLE DATA' || true)"
SIZE="$(du -h "$ARCHIVE" | cut -f1)"
log "Backup verified: ${SIZE}, ${TABLE_COUNT} tables with data"

# A dump far smaller than the last one usually means the database was pointed
# somewhere empty, which is worth failing on rather than quietly rotating away a
# good backup.
PREVIOUS="$(find "$BACKUP_DIR" -name 'rivo-*.dump' ! -name "$(basename "$ARCHIVE")" -printf '%s\n' 2>/dev/null | sort -rn | head -1 || echo 0)"
CURRENT="$(stat -c %s "$ARCHIVE")"
if [ "${PREVIOUS:-0}" -gt 0 ] && [ "$CURRENT" -lt "$((PREVIOUS / 2))" ]; then
  fail "This backup (${CURRENT} bytes) is less than half the previous one (${PREVIOUS} bytes). Refusing to continue — check DATABASE_URL."
fi

chmod 600 "$ARCHIVE"

# Off-host copy. A backup on the same droplet does not survive losing the droplet.
if [ -n "${RIVO_BACKUP_S3_BUCKET:-}" ]; then
  if command -v aws >/dev/null; then
    log "Uploading to s3://${RIVO_BACKUP_S3_BUCKET}/"
    aws s3 cp "$ARCHIVE" "s3://${RIVO_BACKUP_S3_BUCKET}/$(basename "$ARCHIVE")" \
      ${RIVO_BACKUP_S3_ENDPOINT:+--endpoint-url "$RIVO_BACKUP_S3_ENDPOINT"} \
      || fail "Off-host upload failed — the backup exists locally but is not safe from host loss"
    log "Upload complete"
  else
    log "WARNING: RIVO_BACKUP_S3_BUCKET is set but the aws CLI is not installed. The backup is LOCAL ONLY."
  fi
else
  log "WARNING: RIVO_BACKUP_S3_BUCKET is not set. The backup is LOCAL ONLY and will not survive losing this host."
fi

DELETED="$(find "$BACKUP_DIR" -name 'rivo-*.dump' -mtime "+${RETENTION_DAYS}" -delete -print | wc -l)"
log "Pruned ${DELETED} backup(s) older than ${RETENTION_DAYS} days"
log "Done."
