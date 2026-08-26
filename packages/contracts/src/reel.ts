import { z } from 'zod';
import {
  LISTING_PURPOSES,
  PROPERTY_TYPES,
  REEL_MAX_DURATION_SECONDS,
  REEL_MIN_DURATION_SECONDS,
  REEL_MIN_SHORT_EDGE,
} from '@rivo/config';
import { iqdAmountSchema } from './common';

export const reelRequirementsSchema = z.object({
  minShortEdgePx: z.literal(REEL_MIN_SHORT_EDGE),
  minDurationSeconds: z.literal(REEL_MIN_DURATION_SECONDS),
  maxDurationSeconds: z.literal(REEL_MAX_DURATION_SECONDS),
  preferredResolution: z.string().optional(),
  preferredAspect: z.string().optional(),
  maxBytes: z.number().int().optional(),
  note: z.string().optional(),
  noteAr: z.string().optional(),
});

export const reelUploadSchema = z.object({
  videoId: z.string().uuid(),
  /** Cloudflare Stream direct creator upload URL. POST the file here. */
  uploadUrl: z.string().url(),
  streamUid: z.string(),
  expiresAt: z.string(),
  requirements: reelRequirementsSchema,
});
export type ReelUpload = z.infer<typeof reelUploadSchema>;

export const reelStatusSchema = z.object({
  id: z.string().uuid(),
  propertyId: z.string().uuid(),
  status: z.enum(['PENDING_UPLOAD', 'UPLOADED', 'PROCESSING', 'VALIDATION_FAILED', 'READY', 'REJECTED']),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  /** Server-measured shortest edge. The 1080p rule is enforced against this. */
  shortEdge: z.number().int().nullable(),
  durationSeconds: z.number().nullable(),
  thumbnailUrl: z.string().nullable(),
  playbackHlsUrl: z.string().nullable(),
  caption: z.string().nullable(),
  /** Human-readable rejection reason, shown to the seller verbatim. */
  validationError: z.string().nullable(),
  validationDetails: z.unknown().nullable(),
  requirements: reelRequirementsSchema,
});
export type ReelStatus = z.infer<typeof reelStatusSchema>;

/** Every reel in the feed is bound to a published listing — §7 allows no other content. */
export const reelFeedItemSchema = z.object({
  id: z.string().uuid(),
  hlsUrl: z.string().nullable(),
  dashUrl: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  durationSeconds: z.number().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  caption: z.string().nullable(),
  viewCount: z.number().int(),
  property: z.object({
    id: z.string().uuid(),
    reference: z.string(),
    title: z.string(),
    purpose: z.enum(LISTING_PURPOSES),
    type: z.enum(PROPERTY_TYPES),
    priceIqd: iqdAmountSchema,
    rentPeriod: z.string().nullable(),
    areaSqm: z.string(),
    bedrooms: z.number().int().nullable(),
    bathrooms: z.number().int().nullable(),
    governorate: z.string(),
    district: z.string().nullable(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    isVerified: z.boolean(),
    contactPhone: z.string().nullable(),
    contactPreference: z.string(),
  }),
  seller: z.object({
    displayName: z.string().nullable(),
    sellerType: z.string(),
    isVerified: z.boolean(),
  }),
  isFavorited: z.boolean(),
  distanceM: z.number().nullable(),
  score: z.number().optional(),
});
export type ReelFeedItem = z.infer<typeof reelFeedItemSchema>;

export const reelFeedSchema = z.object({
  items: z.array(reelFeedItemSchema),
  pagination: z.object({ page: z.number().int(), limit: z.number().int(), hasMore: z.boolean() }),
});
export type ReelFeed = z.infer<typeof reelFeedSchema>;
