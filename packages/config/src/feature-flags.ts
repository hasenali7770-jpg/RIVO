/**
 * Feature flag defaults — Master Plan §9 module 12 and §24
 * ("every button must either work or be clearly feature-flagged/disabled").
 *
 * Runtime values live in the `feature_flags` table and are editable by a Super Admin.
 * These are the fallbacks used when a flag row does not exist.
 */
export const FEATURE_FLAG_DEFAULTS = {
  /** Darcom Reels feed and reel upload. Requires Cloudflare Stream credentials. */
  reels_enabled: true,
  /** AI photo enhancement pipeline. Requires an AI provider credential. */
  ai_photo_enhancement: true,
  /** AI video cover selection / metadata suggestion. */
  ai_video_enhancement: true,
  /** Turn-by-turn voice guidance in the mobile app. */
  voice_guidance: true,
  /** Anonymous traffic telemetry collection (still requires per-user opt-in). */
  traffic_telemetry: true,
  /** Community confirm/dismiss on road incidents. */
  incident_confirmations: true,
  /** Allow a seller to publish an approximate rather than exact pin. */
  approximate_location_option: false,
  /** Featured / pinned listings (deck p.8 — post-MVP upsell). */
  featured_listings: false,
  /** Real-estate office subscription packages (deck p.8 — post-MVP). */
  agency_packages: false,
  /** Seller-facing view/contact analytics (deck p.8 — post-MVP). */
  listing_analytics: false,
  /** Offline map packs (deck p.14 — Scale phase). */
  offline_maps: false,
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAG_DEFAULTS;
export const FEATURE_FLAG_KEYS = Object.keys(FEATURE_FLAG_DEFAULTS) as FeatureFlagKey[];
