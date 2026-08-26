# RIVO — backup and restore

> Master Plan §17 requires automated backups **and** a restore procedure that has
> been documented *and tested*. This page covers both.

## Last tested

| Date | Tested by | Archive | Result |
|---|---|---|---|
| 2026-08-25 | Build verification | `rivo-20260825T215332Z.dump` | Restored cleanly: 32 tables, PostGIS 3.4 present, all 6 GiST indexes rebuilt |

**Re-test every quarter, and after any schema change large enough to worry you.**
Update this table each time. A backup nobody has restored is a guess.

---

## What is backed up, and what is not

| Data | Where it lives | Covered by `backup.sh` |
|---|---|---|
| Users, listings, payments, incidents, audit log | PostgreSQL | **Yes** |
| Telemetry aggregates | PostgreSQL | **Yes** |
| Property photos (original and enhanced) | Cloudflare R2 | **No** — see below |
| Reels | Cloudflare Stream | **No** — see below |
| Secrets (`.env`) | The host, and your password manager | **No** — deliberately |

### Media is not backed up by this script

Master Plan §17 is explicit that media is not backed up merely because it exists
in one bucket. R2 and Stream each hold one copy. To make that a real backup:

1. **R2 → enable Object Versioning** on the `rivo-media` bucket. That protects
   against deletion and overwrite, though not against losing the account.
2. **R2 → a scheduled cross-account or cross-provider replication** if the client
   wants protection against account loss. Budget for a second copy of the
   photo storage.
3. **Cloudflare Stream** has no export API for bulk download. Losing the Stream
   account loses the reels. Reels are re-uploadable by sellers and are not the
   listing's primary content — the photos are — so this is an accepted risk,
   recorded here so it is a decision rather than a surprise.

### Secrets are not backed up here on purpose

`.env` holds live credentials. It belongs in the client's password manager, not
in a dump that is copied to object storage. If the host is lost, the `.env` is
rebuilt from `.env.example` plus the password manager.

---

## Taking a backup

Runs nightly from cron on the application host:

```cron
0 2 * * * cd /opt/rivo && set -a && . .env && set +a && ./infra/scripts/backup.sh >> /var/log/rivo-backup.log 2>&1
```

The script:

1. Writes a compressed custom-format dump (`pg_dump -Fc`).
2. **Verifies the dump is readable** with `pg_restore --list` before trusting it.
3. **Refuses to continue if the dump is less than half the size of the previous
   one**, which is what a `DATABASE_URL` accidentally pointing at an empty
   database looks like.
4. Uploads off-host when `RIVO_BACKUP_S3_BUCKET` is set, and **warns loudly when
   it is not** — a backup sitting on the droplet does not survive losing the
   droplet.
5. Prunes copies older than `RIVO_BACKUP_RETENTION_DAYS` (default 14).

### Required environment

```bash
DATABASE_URL=…                       # the same value the API uses
RIVO_BACKUP_DIR=/var/backups/rivo    # optional, this is the default
RIVO_BACKUP_RETENTION_DAYS=14        # optional
RIVO_BACKUP_S3_BUCKET=rivo-backups   # STRONGLY recommended
RIVO_BACKUP_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
```

> **Note on `DATABASE_URL`.** Prisma's URL carries parameters libpq does not
> understand (`schema`, `connection_limit`, `pgbouncer`). Both scripts strip them
> before calling `pg_dump`/`psql`. Without that, every nightly run fails with
> `invalid URI query parameter` — which is exactly what happened the first time
> this script was run, and why the stripping exists.

### Managed PostgreSQL

DigitalOcean's managed PostgreSQL takes its own daily backups with 7-day
point-in-time recovery. **Use both.** The managed backups protect against
infrastructure failure; `backup.sh` protects against a mistake in the RIVO
application or a bad migration, and gives a portable archive that is not locked
to one provider.

---

## Rehearsing a restore (do this quarterly)

```bash
cd /opt/rivo
set -a && . .env && set +a
./infra/scripts/restore.sh /var/backups/rivo/rivo-20260825T020000Z.dump
```

This restores into a **scratch database**, prints row counts and index state, and
drops the scratch database afterwards. It never touches production, so it is safe
to run at any time. Expected output:

```
tables: 32
users: …
properties: …
gist indexes: 6
postgis: 3.4 …
```

If `gist indexes` is below 6, the spatial indexes did not come back and every map
query would fall to a sequential scan. Investigate before relying on that archive.

---

## Restoring for real

**Only after the rehearsal above has passed on the archive you intend to use.**

1. **Stop the application** so nothing writes into a database being rewritten:
   ```bash
   docker compose stop api worker
   ```
2. **Take a dump of the current state first**, even if you believe it is corrupt.
   You may need something from it later:
   ```bash
   ./infra/scripts/backup.sh
   ```
3. **Restore:**
   ```bash
   ./infra/scripts/restore.sh /var/backups/rivo/<archive>.dump --target "$DATABASE_URL"
   ```
   It prints the target and requires you to type `RESTORE` — there is no
   `--force`, on purpose.
4. **Bring the application back and confirm it is healthy:**
   ```bash
   docker compose start api worker
   curl -fsS https://api.<RIVO_DOMAIN>/api/v1/health
   ```
   Expect `"status":"ok"` with `"postgis":"ok"`.
5. **Reconcile payments.** Any gateway webhook that arrived between the backup
   and the restore is lost from the database, but the gateway still has it.
   Compare the gateway's transaction list against `listing_payments` for the
   affected window and settle anything missing through the admin dashboard,
   which records who did it.

---

## Recovery objectives

| Measure | Target | What sets it |
|---|---|---|
| RPO (data loss) | ≤ 24 hours | Nightly backup. Managed PostgreSQL PITR narrows this to minutes if the client keeps that plan. |
| RTO (time to restore) | ≤ 1 hour | Restore of a ~100 MB dump takes minutes; the hour is provisioning and verification. |

These are honest for the launch configuration. If the client needs an RPO under
an hour, that is a plan change (PITR plus WAL archiving), not a script change.
