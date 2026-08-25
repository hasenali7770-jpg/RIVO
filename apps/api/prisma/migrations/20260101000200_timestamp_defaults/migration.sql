-- Prisma's @updatedAt is applied in the client, not the database, so
-- updated_at had no DEFAULT. Any INSERT that does not go through Prisma —
-- a data-backfill migration, a psql fix-up, an ops script — then fails with
-- a not-null violation. A database-level default makes the column safe to
-- write from anywhere; Prisma still sets it explicitly on every update.
ALTER TABLE "admin_users" ALTER COLUMN "updated_at" SET DEFAULT NOW();
ALTER TABLE "ai_jobs" ALTER COLUMN "updated_at" SET DEFAULT NOW();
ALTER TABLE "feature_flags" ALTER COLUMN "updated_at" SET DEFAULT NOW();
ALTER TABLE "listing_payments" ALTER COLUMN "updated_at" SET DEFAULT NOW();
ALTER TABLE "media_jobs" ALTER COLUMN "updated_at" SET DEFAULT NOW();
ALTER TABLE "properties" ALTER COLUMN "updated_at" SET DEFAULT NOW();
ALTER TABLE "property_locations" ALTER COLUMN "updated_at" SET DEFAULT NOW();
ALTER TABLE "property_media" ALTER COLUMN "updated_at" SET DEFAULT NOW();
ALTER TABLE "property_videos" ALTER COLUMN "updated_at" SET DEFAULT NOW();
ALTER TABLE "road_incidents" ALTER COLUMN "updated_at" SET DEFAULT NOW();
ALTER TABLE "road_speed_aggregates" ALTER COLUMN "updated_at" SET DEFAULT NOW();
ALTER TABLE "saved_places" ALTER COLUMN "updated_at" SET DEFAULT NOW();
ALTER TABLE "seller_profiles" ALTER COLUMN "updated_at" SET DEFAULT NOW();
ALTER TABLE "seller_verifications" ALTER COLUMN "updated_at" SET DEFAULT NOW();
ALTER TABLE "user_devices" ALTER COLUMN "updated_at" SET DEFAULT NOW();
ALTER TABLE "users" ALTER COLUMN "updated_at" SET DEFAULT NOW();
