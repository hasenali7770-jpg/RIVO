import { z } from 'zod';
import {
  CONTACT_PREFERENCES,
  LISTING_PURPOSES,
  PROPERTY_PHOTO_MAX,
  PROPERTY_PHOTO_MIN,
  PROPERTY_STATUSES,
  PROPERTY_TYPES,
  SELLER_TYPES,
} from '@rivo/config';
import { iqdAmountSchema, paginated } from './common';

export const propertyListItemSchema = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  type: z.enum(PROPERTY_TYPES),
  purpose: z.enum(LISTING_PURPOSES),
  title: z.string(),
  priceIqd: iqdAmountSchema,
  rentPeriod: z.string().nullable(),
  areaSqm: z.string(),
  bedrooms: z.number().int().nullable(),
  bathrooms: z.number().int().nullable(),
  governorate: z.string(),
  city: z.string().nullable(),
  district: z.string().nullable(),
  sellerType: z.enum(SELLER_TYPES),
  isVerified: z.boolean(),
  /** True only for seeded sample content. Clients must label it as a demo. */
  isDemo: z.boolean(),
  photoCount: z.number().int(),
  favoriteCount: z.number().int(),
  viewCount: z.number().int(),
  hasReel: z.boolean(),
  isFavorited: z.boolean(),
  lat: z.number(),
  lng: z.number(),
  distanceM: z.number().nullable(),
  coverUrl: z.string().nullable(),
  publishedAt: z.string().nullable(),
});
export type PropertyListItem = z.infer<typeof propertyListItemSchema>;

export const propertySearchResponseSchema = paginated(propertyListItemSchema);
export type PropertySearchResponse = z.infer<typeof propertySearchResponseSchema>;

export const propertyPhotoSchema = z.object({
  id: z.string().uuid(),
  url: z.string().nullable(),
  kind: z.enum(['ORIGINAL', 'ENHANCED']),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  position: z.number().int(),
  isCover: z.boolean(),
});

export const propertyLocationSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  precision: z.enum(['EXACT', 'APPROXIMATE']),
  /** Non-zero when the pin is deliberately approximate; render a circle, not a point. */
  approxRadiusM: z.number().int(),
  placeLabel: z.string().nullable(),
});

export const propertyDetailSchema = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  status: z.enum(PROPERTY_STATUSES),
  type: z.enum(PROPERTY_TYPES),
  purpose: z.enum(LISTING_PURPOSES),
  title: z.string(),
  description: z.string().nullable(),
  priceIqd: iqdAmountSchema,
  rentPeriod: z.string().nullable(),
  areaSqm: z.string(),
  bedrooms: z.number().int().nullable(),
  bathrooms: z.number().int().nullable(),
  floors: z.number().int().nullable(),
  floorNumber: z.number().int().nullable(),
  yearBuilt: z.number().int().nullable(),
  furnished: z.boolean().nullable(),
  governorate: z.string(),
  city: z.string().nullable(),
  district: z.string().nullable(),
  addressLine: z.string().nullable(),
  isDemo: z.boolean(),
  location: propertyLocationSchema.nullable(),
  contact: z.object({
    preference: z.enum(CONTACT_PREFERENCES),
    phone: z.string().nullable(),
  }),
  seller: z.object({
    id: z.string().uuid(),
    displayName: z.string().nullable(),
    sellerType: z.enum(SELLER_TYPES),
    officeName: z.string().nullable(),
    isVerified: z.boolean(),
  }),
  photos: z.array(propertyPhotoSchema),
  reel: z
    .object({
      id: z.string().uuid(),
      hlsUrl: z.string().nullable(),
      dashUrl: z.string().nullable(),
      thumbnailUrl: z.string().nullable(),
      durationSeconds: z.number().nullable(),
      width: z.number().int().nullable(),
      height: z.number().int().nullable(),
      caption: z.string().nullable(),
    })
    .nullable(),
  stats: z.object({ viewCount: z.number().int(), favoriteCount: z.number().int() }),
  isFavorited: z.boolean(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type PropertyDetail = z.infer<typeof propertyDetailSchema>;

/** What the seller still has to do before the listing can be submitted. */
export const propertyRequirementsSchema = z.object({
  photos: z.object({
    current: z.number().int(),
    minimum: z.literal(PROPERTY_PHOTO_MIN),
    maximum: z.literal(PROPERTY_PHOTO_MAX),
    satisfied: z.boolean(),
  }),
  missingFields: z.array(z.string()),
  hasLocation: z.boolean(),
});
export type PropertyRequirements = z.infer<typeof propertyRequirementsSchema>;

export const mapPinSchema = z.object({
  id: z.string().uuid(),
  lat: z.number(),
  lng: z.number(),
  priceIqd: iqdAmountSchema,
  purpose: z.enum(LISTING_PURPOSES),
  type: z.enum(PROPERTY_TYPES),
  isVerified: z.boolean(),
});
export const mapPinsResponseSchema = z.object({
  pins: z.array(mapPinSchema),
  /** True when the viewport held more listings than the response cap. */
  truncated: z.boolean(),
});
export type MapPinsResponse = z.infer<typeof mapPinsResponseSchema>;

export const submitResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(PROPERTY_STATUSES),
  photoCount: z.number().int(),
  /**
   * PAYMENT for a first submission, REVIEW when the listing's fee was already
   * settled — a rejected listing that has been fixed and resubmitted skips the
   * payment step because the fee is charged once per listing.
   */
  nextStep: z.enum(['PAYMENT', 'REVIEW']),
  message: z.string(),
  messageAr: z.string(),
});
export type SubmitResponse = z.infer<typeof submitResponseSchema>;
