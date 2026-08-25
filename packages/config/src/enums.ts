/**
 * Domain enums shared by API, admin and (mirrored) mobile.
 * These match the PostgreSQL enum types created in the initial migration.
 */

export const PROPERTY_TYPES = ['HOUSE', 'APARTMENT', 'SHOP', 'BUILDING', 'LAND', 'COMMERCIAL'] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const LISTING_PURPOSES = ['SALE', 'RENT'] as const;
export type ListingPurpose = (typeof LISTING_PURPOSES)[number];

/**
 * Property lifecycle — Master Plan §6.
 * DRAFT -> (preview) -> AWAITING_PAYMENT -> PENDING_REVIEW -> PUBLISHED
 *                                        \-> REJECTED / CHANGES_REQUESTED -> DRAFT
 * PUBLISHED -> ARCHIVED | SOLD | RENTED
 */
export const PROPERTY_STATUSES = [
  'DRAFT',
  'AWAITING_PAYMENT',
  'PENDING_REVIEW',
  'CHANGES_REQUESTED',
  'REJECTED',
  'PUBLISHED',
  'ARCHIVED',
  'SOLD',
  'RENTED',
] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

export const SELLER_TYPES = ['INDIVIDUAL', 'OFFICE', 'DEVELOPER'] as const;
export type SellerType = (typeof SELLER_TYPES)[number];

export const CONTACT_PREFERENCES = ['CALL', 'WHATSAPP', 'BOTH'] as const;
export type ContactPreference = (typeof CONTACT_PREFERENCES)[number];

/** Master Plan §4 — the seven reportable road conditions. */
export const INCIDENT_TYPES = [
  'ACCIDENT',
  'TRAFFIC_JAM',
  'ROAD_CLOSURE',
  'ROAD_WORKS',
  'FLOODED_ROAD',
  'POTHOLE',
  'HAZARD',
] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const INCIDENT_STATUSES = ['ACTIVE', 'EXPIRED', 'REMOVED', 'PENDING_REVIEW'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/**
 * Payment lifecycle. Only the gateway webhook may move a payment to PAID.
 * Master Plan §6 step 9: "A client-side success screen can never mark a listing paid."
 */
export const PAYMENT_STATUSES = ['PENDING', 'PROCESSING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED', 'CANCELLED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const MEDIA_KINDS = ['ORIGINAL', 'ENHANCED'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const JOB_STATUSES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const VIDEO_STATUSES = [
  'PENDING_UPLOAD',
  'UPLOADED',
  'PROCESSING',
  'VALIDATION_FAILED',
  'READY',
  'REJECTED',
] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export const ADMIN_ROLES = ['SUPER_ADMIN', 'MODERATOR', 'FINANCE', 'SUPPORT'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const VERIFICATION_STATUSES = ['NONE', 'PENDING', 'VERIFIED', 'REJECTED'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const REPORT_STATUSES = ['OPEN', 'REVIEWING', 'ACTIONED', 'DISMISSED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
