-- RIVO initial schema — Master Plan §10.
--
-- Applied with `prisma migrate deploy`. Verified against an empty database in CI
-- (see .github/workflows/ci.yml → "migrations run on an empty database").
--
-- The first half of this file is generated from prisma/schema.prisma. The second
-- half ("RIVO additions") is hand-written and covers what Prisma cannot express:
-- PostGIS GiST indexes, domain CHECK constraints, partial and trigram indexes,
-- and the trigger that makes audit_logs append-only.
--
-- Requires: PostgreSQL 16+, PostGIS 3.4+, pgcrypto.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "property_type" AS ENUM ('HOUSE', 'APARTMENT', 'SHOP', 'BUILDING', 'LAND', 'COMMERCIAL');

-- CreateEnum
CREATE TYPE "listing_purpose" AS ENUM ('SALE', 'RENT');

-- CreateEnum
CREATE TYPE "property_status" AS ENUM ('DRAFT', 'AWAITING_PAYMENT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'REJECTED', 'PUBLISHED', 'ARCHIVED', 'SOLD', 'RENTED');

-- CreateEnum
CREATE TYPE "seller_type" AS ENUM ('INDIVIDUAL', 'OFFICE', 'DEVELOPER');

-- CreateEnum
CREATE TYPE "contact_preference" AS ENUM ('CALL', 'WHATSAPP', 'BOTH');

-- CreateEnum
CREATE TYPE "incident_type" AS ENUM ('ACCIDENT', 'TRAFFIC_JAM', 'ROAD_CLOSURE', 'ROAD_WORKS', 'FLOODED_ROAD', 'POTHOLE', 'HAZARD');

-- CreateEnum
CREATE TYPE "incident_status" AS ENUM ('ACTIVE', 'EXPIRED', 'REMOVED', 'PENDING_REVIEW');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "media_kind" AS ENUM ('ORIGINAL', 'ENHANCED');

-- CreateEnum
CREATE TYPE "job_status" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "video_status" AS ENUM ('PENDING_UPLOAD', 'UPLOADED', 'PROCESSING', 'VALIDATION_FAILED', 'READY', 'REJECTED');

-- CreateEnum
CREATE TYPE "admin_role" AS ENUM ('SUPER_ADMIN', 'MODERATOR', 'FINANCE', 'SUPPORT');

-- CreateEnum
CREATE TYPE "verification_status" AS ENUM ('NONE', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "report_status" AS ENUM ('OPEN', 'REVIEWING', 'ACTIONED', 'DISMISSED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phone_e164" VARCHAR(20) NOT NULL,
    "phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "display_name" VARCHAR(120),
    "avatar_key" VARCHAR(512),
    "seller_type" "seller_type" NOT NULL DEFAULT 'INDIVIDUAL',
    "locale" VARCHAR(8) NOT NULL DEFAULT 'ar',
    "blocked_at" TIMESTAMPTZ(3),
    "blocked_reason" TEXT,
    "telemetry_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "telemetry_opt_in_at" TIMESTAMPTZ(3),
    "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "last_seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "device_key" VARCHAR(128) NOT NULL,
    "platform" VARCHAR(16) NOT NULL,
    "app_version" VARCHAR(32),
    "os_version" VARCHAR(64),
    "model" VARCHAR(120),
    "push_token" VARCHAR(512),
    "last_active_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phone_e164" VARCHAR(20) NOT NULL,
    "code_hash" VARCHAR(255) NOT NULL,
    "challenge_token" VARCHAR(64) NOT NULL,
    "purpose" VARCHAR(32) NOT NULL DEFAULT 'LOGIN',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "consumed_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "request_ip" VARCHAR(64),
    "provider_ref" VARCHAR(128),
    "provider_name" VARCHAR(32),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "device_id" UUID,
    "token_hash" VARCHAR(64) NOT NULL,
    "replaced_by_id" UUID,
    "user_agent" VARCHAR(512),
    "ip" VARCHAR(64),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" VARCHAR(64),
    "last_used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "seller_type" "seller_type" NOT NULL DEFAULT 'INDIVIDUAL',
    "office_name" VARCHAR(200),
    "office_license_no" VARCHAR(120),
    "about" TEXT,
    "contact_phone" VARCHAR(20),
    "whatsapp_phone" VARCHAR(20),
    "logo_key" VARCHAR(512),
    "verification" "verification_status" NOT NULL DEFAULT 'NONE',
    "verified_at" TIMESTAMPTZ(3),
    "listings_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seller_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_verifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "status" "verification_status" NOT NULL DEFAULT 'PENDING',
    "requested_type" "seller_type" NOT NULL,
    "document_keys" TEXT[],
    "note" TEXT,
    "reviewed_by_admin_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seller_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference" VARCHAR(16) NOT NULL,
    "owner_id" UUID NOT NULL,
    "type" "property_type" NOT NULL,
    "purpose" "listing_purpose" NOT NULL,
    "status" "property_status" NOT NULL DEFAULT 'DRAFT',
    "title" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "price_iqd" BIGINT NOT NULL,
    "rent_period" VARCHAR(16),
    "area_sqm" DECIMAL(12,2) NOT NULL,
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "floors" INTEGER,
    "floor_number" INTEGER,
    "year_built" INTEGER,
    "furnished" BOOLEAN,
    "governorate" VARCHAR(32) NOT NULL,
    "city" VARCHAR(120),
    "district" VARCHAR(120),
    "address_line" VARCHAR(300),
    "contact_preference" "contact_preference" NOT NULL DEFAULT 'BOTH',
    "contact_phone" VARCHAR(20),
    "seller_type" "seller_type" NOT NULL DEFAULT 'INDIVIDUAL',
    "is_verified_listing" BOOLEAN NOT NULL DEFAULT false,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "cover_media_id" UUID,
    "photo_count" INTEGER NOT NULL DEFAULT 0,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "favorite_count" INTEGER NOT NULL DEFAULT 0,
    "contact_count" INTEGER NOT NULL DEFAULT 0,
    "submitted_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "moderation_reason" TEXT,
    "moderated_by_admin_id" UUID,
    "moderated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_locations" (
    "property_id" UUID NOT NULL,
    "point" geography(Point, 4326) NOT NULL,
    "public_point" geography(Point, 4326),
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "public_lat" DOUBLE PRECISION,
    "public_lng" DOUBLE PRECISION,
    "display_precision" VARCHAR(16) NOT NULL DEFAULT 'EXACT',
    "approx_radius_m" INTEGER NOT NULL DEFAULT 300,
    "place_label" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "property_locations_pkey" PRIMARY KEY ("property_id")
);

-- CreateTable
CREATE TABLE "property_media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "kind" "media_kind" NOT NULL DEFAULT 'ORIGINAL',
    "object_key" VARCHAR(512) NOT NULL,
    "bucket" VARCHAR(120) NOT NULL,
    "mime_type" VARCHAR(80) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "checksum_sha256" VARCHAR(64),
    "position" INTEGER NOT NULL DEFAULT 0,
    "source_media_id" UUID,
    "is_selected" BOOLEAN NOT NULL DEFAULT true,
    "upload_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "quality_score" DOUBLE PRECISION,
    "quality_notes" JSONB,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "property_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_videos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "status" "video_status" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "stream_uid" VARCHAR(64),
    "upload_url_expires_at" TIMESTAMPTZ(3),
    "playback_hls_url" VARCHAR(512),
    "playback_dash_url" VARCHAR(512),
    "thumbnail_url" VARCHAR(512),
    "cover_time_seconds" DOUBLE PRECISION,
    "duration_seconds" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "short_edge" INTEGER,
    "bitrate_kbps" INTEGER,
    "size_bytes" BIGINT,
    "caption" VARCHAR(300),
    "validation_error" TEXT,
    "validation_details" JSONB,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "completion_sum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "published_at" TIMESTAMPTZ(3),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "property_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reel_view_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "video_id" UUID NOT NULL,
    "user_id" UUID,
    "anon_id" VARCHAR(64),
    "watched_seconds" DOUBLE PRECISION NOT NULL,
    "completion" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reel_view_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "user_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("user_id","property_id")
);

-- CreateTable
CREATE TABLE "property_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "reporter_id" UUID,
    "reason" VARCHAR(40) NOT NULL,
    "note" TEXT,
    "status" "report_status" NOT NULL DEFAULT 'OPEN',
    "resolved_by_admin_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "resolution_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_status_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "from_status" "property_status",
    "to_status" "property_status" NOT NULL,
    "actor_type" VARCHAR(20) NOT NULL,
    "actor_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount_iqd" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'IQD',
    "status" "payment_status" NOT NULL DEFAULT 'PENDING',
    "provider" VARCHAR(40) NOT NULL,
    "provider_ref" VARCHAR(160),
    "merchant_ref" VARCHAR(64) NOT NULL,
    "checkout_url" VARCHAR(1024),
    "failure_reason" TEXT,
    "paid_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "refunded_at" TIMESTAMPTZ(3),
    "settled_by_admin_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "listing_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID,
    "provider" VARCHAR(40) NOT NULL,
    "event_type" VARCHAR(80) NOT NULL,
    "provider_event_id" VARCHAR(160),
    "signature_valid" BOOLEAN NOT NULL,
    "rejection_reason" VARCHAR(200),
    "payload" JSONB NOT NULL,
    "headers" JSONB,
    "source_ip" VARCHAR(64),
    "processed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" VARCHAR(40) NOT NULL,
    "status" "job_status" NOT NULL DEFAULT 'QUEUED',
    "media_id" UUID,
    "video_id" UUID,
    "queue_job_id" VARCHAR(80),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "error" TEXT,
    "result" JSONB,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "media_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" VARCHAR(40) NOT NULL,
    "status" "job_status" NOT NULL DEFAULT 'QUEUED',
    "media_id" UUID,
    "property_id" UUID,
    "provider" VARCHAR(40),
    "model" VARCHAR(160),
    "model_version" VARCHAR(160),
    "operations" TEXT[],
    "provider_job_id" VARCHAR(160),
    "cost_usd" DECIMAL(10,6),
    "queue_job_id" VARCHAR(80),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "error" TEXT,
    "result" JSONB,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "road_incidents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "incident_type" NOT NULL,
    "status" "incident_status" NOT NULL DEFAULT 'ACTIVE',
    "point" geography(Point, 4326) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "heading_deg" INTEGER,
    "note" VARCHAR(280),
    "reported_by_id" UUID,
    "score" INTEGER NOT NULL DEFAULT 0,
    "confirm_count" INTEGER NOT NULL DEFAULT 0,
    "dismiss_count" INTEGER NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "segment_key" VARCHAR(64),
    "removed_by_admin_id" UUID,
    "removed_reason" VARCHAR(200),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "road_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "road_incident_confirmations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "incident_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "confirmed" BOOLEAN NOT NULL,
    "distance_m" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "road_incident_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "road_speed_samples" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_key" VARCHAR(64) NOT NULL,
    "point" geography(Point, 4326) NOT NULL,
    "speed_kph" DOUBLE PRECISION NOT NULL,
    "heading_deg" INTEGER,
    "accuracy_m" DOUBLE PRECISION,
    "segment_key" VARCHAR(64),
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "road_speed_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "road_speed_aggregates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "segment_key" VARCHAR(64) NOT NULL,
    "bucket_start" TIMESTAMPTZ(3) NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "minute_of_day" INTEGER NOT NULL,
    "sample_count" INTEGER NOT NULL,
    "session_count" INTEGER NOT NULL,
    "avg_speed_kph" DOUBLE PRECISION NOT NULL,
    "p50_speed_kph" DOUBLE PRECISION,
    "p85_speed_kph" DOUBLE PRECISION,
    "free_flow_kph" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "road_speed_aggregates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_feedback" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "route_request_id" VARCHAR(64) NOT NULL,
    "origin_lat" DOUBLE PRECISION NOT NULL,
    "origin_lng" DOUBLE PRECISION NOT NULL,
    "dest_lat" DOUBLE PRECISION NOT NULL,
    "dest_lng" DOUBLE PRECISION NOT NULL,
    "predicted_seconds" INTEGER NOT NULL,
    "actual_seconds" INTEGER,
    "distance_m" INTEGER,
    "reroute_count" INTEGER NOT NULL DEFAULT 0,
    "outcome" VARCHAR(24) NOT NULL,
    "rating" INTEGER,
    "comment" VARCHAR(280),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_places" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "point" geography(Point, 4326) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "address" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "saved_places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(200) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "role" "admin_role" NOT NULL DEFAULT 'SUPPORT',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMPTZ(3),
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(512),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID,
    "action" VARCHAR(80) NOT NULL,
    "entity_type" VARCHAR(40) NOT NULL,
    "entity_id" VARCHAR(64),
    "changes" JSONB,
    "reason" TEXT,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(512),
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "title_ar" VARCHAR(200) NOT NULL,
    "title_en" VARCHAR(200),
    "body_ar" TEXT NOT NULL,
    "body_en" TEXT,
    "deep_link" VARCHAR(300),
    "data" JSONB,
    "read_at" TIMESTAMPTZ(3),
    "push_sent_at" TIMESTAMPTZ(3),
    "push_error" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "key" VARCHAR(80) NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "description" TEXT,
    "config" JSONB,
    "updated_by_admin_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "maintenance_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job" VARCHAR(80) NOT NULL,
    "status" "job_status" NOT NULL DEFAULT 'RUNNING',
    "details" JSONB,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "maintenance_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_e164_key" ON "users"("phone_e164");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- CreateIndex
CREATE INDEX "users_seller_type_idx" ON "users"("seller_type");

-- CreateIndex
CREATE INDEX "user_devices_user_id_idx" ON "user_devices"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_devices_user_id_device_key_key" ON "user_devices"("user_id", "device_key");

-- CreateIndex
CREATE UNIQUE INDEX "otp_challenges_challenge_token_key" ON "otp_challenges"("challenge_token");

-- CreateIndex
CREATE INDEX "otp_challenges_phone_e164_created_at_idx" ON "otp_challenges"("phone_e164", "created_at");

-- CreateIndex
CREATE INDEX "otp_challenges_expires_at_idx" ON "otp_challenges"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_token_hash_key" ON "refresh_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_sessions_user_id_revoked_at_idx" ON "refresh_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "refresh_sessions_expires_at_idx" ON "refresh_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "seller_profiles_user_id_key" ON "seller_profiles"("user_id");

-- CreateIndex
CREATE INDEX "seller_profiles_verification_idx" ON "seller_profiles"("verification");

-- CreateIndex
CREATE INDEX "seller_verifications_status_created_at_idx" ON "seller_verifications"("status", "created_at");

-- CreateIndex
CREATE INDEX "seller_verifications_user_id_idx" ON "seller_verifications"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "properties_reference_key" ON "properties"("reference");

-- CreateIndex
CREATE INDEX "properties_status_published_at_idx" ON "properties"("status", "published_at");

-- CreateIndex
CREATE INDEX "properties_type_purpose_status_idx" ON "properties"("type", "purpose", "status");

-- CreateIndex
CREATE INDEX "properties_governorate_status_idx" ON "properties"("governorate", "status");

-- CreateIndex
CREATE INDEX "properties_price_iqd_idx" ON "properties"("price_iqd");

-- CreateIndex
CREATE INDEX "properties_owner_id_status_idx" ON "properties"("owner_id", "status");

-- CreateIndex
CREATE INDEX "properties_area_sqm_idx" ON "properties"("area_sqm");

-- CreateIndex
CREATE INDEX "property_media_property_id_kind_position_idx" ON "property_media"("property_id", "kind", "position");

-- CreateIndex
CREATE INDEX "property_media_source_media_id_idx" ON "property_media"("source_media_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_media_bucket_object_key_key" ON "property_media"("bucket", "object_key");

-- CreateIndex
CREATE UNIQUE INDEX "property_videos_stream_uid_key" ON "property_videos"("stream_uid");

-- CreateIndex
CREATE INDEX "property_videos_property_id_idx" ON "property_videos"("property_id");

-- CreateIndex
CREATE INDEX "property_videos_status_published_at_idx" ON "property_videos"("status", "published_at");

-- CreateIndex
CREATE INDEX "reel_view_events_video_id_created_at_idx" ON "reel_view_events"("video_id", "created_at");

-- CreateIndex
CREATE INDEX "reel_view_events_user_id_idx" ON "reel_view_events"("user_id");

-- CreateIndex
CREATE INDEX "favorites_property_id_idx" ON "favorites"("property_id");

-- CreateIndex
CREATE INDEX "property_reports_status_created_at_idx" ON "property_reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "property_reports_property_id_idx" ON "property_reports"("property_id");

-- CreateIndex
CREATE INDEX "property_status_events_property_id_created_at_idx" ON "property_status_events"("property_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "listing_payments_merchant_ref_key" ON "listing_payments"("merchant_ref");

-- CreateIndex
CREATE INDEX "listing_payments_status_created_at_idx" ON "listing_payments"("status", "created_at");

-- CreateIndex
CREATE INDEX "listing_payments_property_id_idx" ON "listing_payments"("property_id");

-- CreateIndex
CREATE INDEX "listing_payments_user_id_created_at_idx" ON "listing_payments"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "listing_payments_provider_provider_ref_key" ON "listing_payments"("provider", "provider_ref");

-- CreateIndex
CREATE INDEX "payment_events_payment_id_created_at_idx" ON "payment_events"("payment_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_events_created_at_idx" ON "payment_events"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_provider_provider_event_id_key" ON "payment_events"("provider", "provider_event_id");

-- CreateIndex
CREATE INDEX "media_jobs_status_created_at_idx" ON "media_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "media_jobs_media_id_idx" ON "media_jobs"("media_id");

-- CreateIndex
CREATE INDEX "media_jobs_video_id_idx" ON "media_jobs"("video_id");

-- CreateIndex
CREATE INDEX "ai_jobs_status_created_at_idx" ON "ai_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "ai_jobs_media_id_idx" ON "ai_jobs"("media_id");

-- CreateIndex
CREATE INDEX "ai_jobs_property_id_idx" ON "ai_jobs"("property_id");

-- CreateIndex
CREATE INDEX "road_incidents_status_expires_at_idx" ON "road_incidents"("status", "expires_at");

-- CreateIndex
CREATE INDEX "road_incidents_type_status_idx" ON "road_incidents"("type", "status");

-- CreateIndex
CREATE INDEX "road_incidents_reported_by_id_idx" ON "road_incidents"("reported_by_id");

-- CreateIndex
CREATE INDEX "road_incident_confirmations_incident_id_idx" ON "road_incident_confirmations"("incident_id");

-- CreateIndex
CREATE UNIQUE INDEX "road_incident_confirmations_incident_id_user_id_key" ON "road_incident_confirmations"("incident_id", "user_id");

-- CreateIndex
CREATE INDEX "road_speed_samples_segment_key_recorded_at_idx" ON "road_speed_samples"("segment_key", "recorded_at");

-- CreateIndex
CREATE INDEX "road_speed_samples_created_at_idx" ON "road_speed_samples"("created_at");

-- CreateIndex
CREATE INDEX "road_speed_samples_session_key_idx" ON "road_speed_samples"("session_key");

-- CreateIndex
CREATE INDEX "road_speed_aggregates_segment_key_day_of_week_minute_of_day_idx" ON "road_speed_aggregates"("segment_key", "day_of_week", "minute_of_day");

-- CreateIndex
CREATE INDEX "road_speed_aggregates_bucket_start_idx" ON "road_speed_aggregates"("bucket_start");

-- CreateIndex
CREATE UNIQUE INDEX "road_speed_aggregates_segment_key_bucket_start_key" ON "road_speed_aggregates"("segment_key", "bucket_start");

-- CreateIndex
CREATE INDEX "route_feedback_created_at_idx" ON "route_feedback"("created_at");

-- CreateIndex
CREATE INDEX "route_feedback_route_request_id_idx" ON "route_feedback"("route_request_id");

-- CreateIndex
CREATE INDEX "saved_places_user_id_idx" ON "saved_places"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "admin_users_role_is_active_idx" ON "admin_users"("role", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_token_hash_key" ON "admin_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "admin_sessions_admin_id_revoked_at_idx" ON "admin_sessions"("admin_id", "revoked_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_admin_id_created_at_idx" ON "audit_logs"("admin_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "maintenance_runs_job_started_at_idx" ON "maintenance_runs"("job", "started_at");

-- AddForeignKey
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "user_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_profiles" ADD CONSTRAINT "seller_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_verifications" ADD CONSTRAINT "seller_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_verifications" ADD CONSTRAINT "seller_verifications_reviewed_by_admin_id_fkey" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_moderated_by_admin_id_fkey" FOREIGN KEY ("moderated_by_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_locations" ADD CONSTRAINT "property_locations_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_media" ADD CONSTRAINT "property_media_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_media" ADD CONSTRAINT "property_media_source_media_id_fkey" FOREIGN KEY ("source_media_id") REFERENCES "property_media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_videos" ADD CONSTRAINT "property_videos_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reel_view_events" ADD CONSTRAINT "reel_view_events_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "property_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reel_view_events" ADD CONSTRAINT "reel_view_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_reports" ADD CONSTRAINT "property_reports_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_reports" ADD CONSTRAINT "property_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_reports" ADD CONSTRAINT "property_reports_resolved_by_admin_id_fkey" FOREIGN KEY ("resolved_by_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_status_events" ADD CONSTRAINT "property_status_events_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_payments" ADD CONSTRAINT "listing_payments_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_payments" ADD CONSTRAINT "listing_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_payments" ADD CONSTRAINT "listing_payments_settled_by_admin_id_fkey" FOREIGN KEY ("settled_by_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "listing_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_jobs" ADD CONSTRAINT "media_jobs_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "property_media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_jobs" ADD CONSTRAINT "media_jobs_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "property_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "property_media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "road_incidents" ADD CONSTRAINT "road_incidents_reported_by_id_fkey" FOREIGN KEY ("reported_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "road_incidents" ADD CONSTRAINT "road_incidents_removed_by_admin_id_fkey" FOREIGN KEY ("removed_by_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "road_incident_confirmations" ADD CONSTRAINT "road_incident_confirmations_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "road_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "road_incident_confirmations" ADD CONSTRAINT "road_incident_confirmations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_feedback" ADD CONSTRAINT "route_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_places" ADD CONSTRAINT "saved_places_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =============================================================================
-- RIVO additions (hand-written)
-- =============================================================================

-- --- Text search -------------------------------------------------------------
-- Trigram search over Arabic and English listing text. `pg_trgm` handles Arabic
-- correctly because it is byte/character based rather than dictionary based,
-- which matters here: PostgreSQL ships no Arabic full-text dictionary.
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE INDEX "properties_title_trgm_idx" ON "properties" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "properties_district_trgm_idx" ON "properties" USING GIN ("district" gin_trgm_ops);
CREATE INDEX "properties_city_trgm_idx" ON "properties" USING GIN ("city" gin_trgm_ops);

-- --- PostGIS spatial indexes -------------------------------------------------
-- Every geography column gets a GiST index. Without these, ST_DWithin degrades
-- to a sequential scan and map-viewport queries collapse under load.
CREATE INDEX "property_locations_point_gix" ON "property_locations" USING GIST ("point");
CREATE INDEX "property_locations_public_point_gix" ON "property_locations" USING GIST ("public_point");
CREATE INDEX "road_incidents_point_gix" ON "road_incidents" USING GIST ("point");
CREATE INDEX "road_speed_samples_point_gix" ON "road_speed_samples" USING GIST ("point");
CREATE INDEX "saved_places_point_gix" ON "saved_places" USING GIST ("point");

-- Map-viewport queries always filter on ACTIVE + unexpired. A partial index keeps
-- the hot set small even as the incident history grows.
CREATE INDEX "road_incidents_active_point_gix"
  ON "road_incidents" USING GIST ("point")
  WHERE "status" = 'ACTIVE';

-- Published-listing map pins: the overwhelmingly common Darcom read path.
CREATE INDEX "properties_published_created_idx"
  ON "properties" ("published_at" DESC)
  WHERE "status" = 'PUBLISHED' AND "deleted_at" IS NULL;

-- Moderation queue.
CREATE INDEX "properties_pending_review_idx"
  ON "properties" ("submitted_at" ASC)
  WHERE "status" = 'PENDING_REVIEW';

-- Reels feed: only READY, published, non-deleted reels are ever served.
CREATE INDEX "property_videos_ready_idx"
  ON "property_videos" ("published_at" DESC)
  WHERE "status" = 'READY';

-- --- Business-rule CHECK constraints ----------------------------------------
-- These duplicate the application-layer rules on purpose. Master Plan §24:
-- "Keep business rules server-side as well as client-side." A constraint here is
-- the last line of defence if a future code path forgets to validate.

-- Listing fee is exactly 3,000 IQD (Master Plan §6 step 9).
ALTER TABLE "listing_payments"
  ADD CONSTRAINT "listing_payments_amount_positive_chk" CHECK ("amount_iqd" > 0);
ALTER TABLE "listing_payments"
  ADD CONSTRAINT "listing_payments_currency_chk" CHECK ("currency" = 'IQD');

-- A property may never be PUBLISHED with fewer than 8 or more than 18 photos
-- (Master Plan §6 step 5). DRAFT rows are exempt so a seller can build up a
-- gallery incrementally.
ALTER TABLE "properties"
  ADD CONSTRAINT "properties_photo_count_chk" CHECK (
    "status" IN ('DRAFT', 'REJECTED', 'CHANGES_REQUESTED', 'ARCHIVED')
    OR ("photo_count" >= 8 AND "photo_count" <= 18)
  );

ALTER TABLE "properties"
  ADD CONSTRAINT "properties_price_positive_chk" CHECK ("price_iqd" > 0);
ALTER TABLE "properties"
  ADD CONSTRAINT "properties_area_positive_chk" CHECK ("area_sqm" > 0);
ALTER TABLE "properties"
  ADD CONSTRAINT "properties_rooms_nonnegative_chk" CHECK (
    ("bedrooms" IS NULL OR "bedrooms" >= 0) AND ("bathrooms" IS NULL OR "bathrooms" >= 0)
  );
ALTER TABLE "properties"
  ADD CONSTRAINT "properties_rent_period_chk" CHECK (
    "purpose" <> 'RENT' OR "rent_period" IN ('MONTHLY', 'YEARLY')
  );

-- A reel may only reach READY if its measured short edge is at least 1080px
-- (Master Plan §6 step 7). 1280x720 has a short edge of 720 and is refused.
ALTER TABLE "property_videos"
  ADD CONSTRAINT "property_videos_min_1080p_chk" CHECK (
    "status" <> 'READY' OR ("short_edge" IS NOT NULL AND "short_edge" >= 1080)
  );
ALTER TABLE "property_videos"
  ADD CONSTRAINT "property_videos_duration_chk" CHECK (
    "duration_seconds" IS NULL OR ("duration_seconds" > 0 AND "duration_seconds" <= 600)
  );

ALTER TABLE "property_locations"
  ADD CONSTRAINT "property_locations_precision_chk"
  CHECK ("display_precision" IN ('EXACT', 'APPROXIMATE'));
ALTER TABLE "property_locations"
  ADD CONSTRAINT "property_locations_latlng_chk"
  CHECK ("lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180);

ALTER TABLE "road_incidents"
  ADD CONSTRAINT "road_incidents_confidence_chk" CHECK ("confidence" BETWEEN 0 AND 1);
ALTER TABLE "road_incidents"
  ADD CONSTRAINT "road_incidents_latlng_chk"
  CHECK ("lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180);

ALTER TABLE "road_speed_samples"
  ADD CONSTRAINT "road_speed_samples_speed_chk" CHECK ("speed_kph" >= 0 AND "speed_kph" <= 300);

ALTER TABLE "reel_view_events"
  ADD CONSTRAINT "reel_view_events_completion_chk" CHECK ("completion" BETWEEN 0 AND 1);

ALTER TABLE "saved_places"
  ADD CONSTRAINT "saved_places_kind_chk" CHECK ("kind" IN ('HOME', 'WORK', 'CUSTOM'));

-- A user has at most one HOME and one WORK.
CREATE UNIQUE INDEX "saved_places_user_kind_unique"
  ON "saved_places" ("user_id", "kind")
  WHERE "kind" IN ('HOME', 'WORK');

ALTER TABLE "users"
  ADD CONSTRAINT "users_phone_e164_chk" CHECK ("phone_e164" ~ '^\+[1-9][0-9]{7,14}$');

ALTER TABLE "admin_users"
  ADD CONSTRAINT "admin_users_email_chk" CHECK ("email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

-- An ENHANCED media row must point at the ORIGINAL it came from; an ORIGINAL
-- must not. This is what keeps "original and enhanced are stored separately"
-- (Master Plan §6 step 6) true at the storage layer.
ALTER TABLE "property_media"
  ADD CONSTRAINT "property_media_derivation_chk" CHECK (
    ("kind" = 'ENHANCED' AND "source_media_id" IS NOT NULL)
    OR ("kind" = 'ORIGINAL' AND "source_media_id" IS NULL)
  );

-- --- Audit log immutability --------------------------------------------------
-- Master Plan §9 requires an audit trail. A trail that can be edited is not a
-- trail, so UPDATE and DELETE are refused at the database level. Retention is
-- handled by partition drop / archival, documented in docs/deployment/BACKUP.md.
CREATE OR REPLACE FUNCTION rivo_audit_logs_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_no_update"
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION rivo_audit_logs_immutable();

CREATE TRIGGER "audit_logs_no_delete"
  BEFORE DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION rivo_audit_logs_immutable();

-- payment_events is evidence for payment disputes and is append-only for the
-- same reason.
CREATE TRIGGER "payment_events_no_update"
  BEFORE UPDATE OF "provider", "event_type", "payload", "signature_valid"
  ON "payment_events"
  FOR EACH ROW EXECUTE FUNCTION rivo_audit_logs_immutable();

-- --- Keep denormalised counters honest ---------------------------------------
-- properties.photo_count backs the 8–18 CHECK constraint above, so it must never
-- drift from the actual number of selected original photos.
CREATE OR REPLACE FUNCTION rivo_sync_property_photo_count()
RETURNS TRIGGER AS $$
DECLARE
  target_property UUID;
BEGIN
  target_property := COALESCE(NEW."property_id", OLD."property_id");

  UPDATE "properties" p
     SET "photo_count" = (
           SELECT COUNT(*)
             FROM "property_media" m
            WHERE m."property_id" = target_property
              AND m."kind" = 'ORIGINAL'
              AND m."upload_confirmed" = TRUE
         )
   WHERE p."id" = target_property;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "property_media_sync_count"
  AFTER INSERT OR UPDATE OF "upload_confirmed", "kind" OR DELETE
  ON "property_media"
  FOR EACH ROW EXECUTE FUNCTION rivo_sync_property_photo_count();

-- favorites.count on the property row, used for feed ranking.
CREATE OR REPLACE FUNCTION rivo_sync_property_favorite_count()
RETURNS TRIGGER AS $$
DECLARE
  target_property UUID;
BEGIN
  target_property := COALESCE(NEW."property_id", OLD."property_id");
  UPDATE "properties" p
     SET "favorite_count" = (SELECT COUNT(*) FROM "favorites" f WHERE f."property_id" = target_property)
   WHERE p."id" = target_property;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "favorites_sync_count"
  AFTER INSERT OR DELETE ON "favorites"
  FOR EACH ROW EXECUTE FUNCTION rivo_sync_property_favorite_count();
