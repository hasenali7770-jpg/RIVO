import { z } from 'zod';
import { PROPERTY_PHOTO_MAX, PROPERTY_PHOTO_MIN } from '@rivo/config';

export const presignedUploadSchema = z.object({
  mediaId: z.string().uuid(),
  /** PUT the file here with exactly the headers in `requiredHeaders`. */
  uploadUrl: z.string().url(),
  objectKey: z.string(),
  expiresAt: z.string(),
  requiredHeaders: z.record(z.string()),
});
export type PresignedUpload = z.infer<typeof presignedUploadSchema>;

export const presignResponseSchema = z.object({
  uploads: z.array(presignedUploadSchema),
  rules: z.object({
    minimum: z.literal(PROPERTY_PHOTO_MIN),
    maximum: z.literal(PROPERTY_PHOTO_MAX),
    currentCount: z.number().int(),
  }),
});
export type PresignResponse = z.infer<typeof presignResponseSchema>;

export const completeUploadResponseSchema = z.object({
  confirmed: z.array(z.string().uuid()),
  /** Objects the server could not verify in storage, with the reason. */
  failed: z.array(z.object({ mediaId: z.string().uuid(), reason: z.string() })),
  photoCount: z.number().int(),
  rules: z.object({
    minimum: z.literal(PROPERTY_PHOTO_MIN),
    maximum: z.literal(PROPERTY_PHOTO_MAX),
    satisfied: z.boolean(),
  }),
});
export type CompleteUploadResponse = z.infer<typeof completeUploadResponseSchema>;

export const jobStatusSchema = z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED']);

export const mediaVersionSchema = z.object({
  id: z.string().uuid(),
  url: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  sizeBytes: z.number().int(),
  isSelected: z.boolean(),
});

/**
 * The original-vs-enhanced comparison (Master Plan §6 step 6).
 * `enhanced` is null when no enhancement has run or it was skipped — the client
 * must show the original in that case, never a fabricated "enhanced" copy.
 */
export const compareVersionsSchema = z.object({
  original: mediaVersionSchema,
  enhanced: mediaVersionSchema.nullable(),
  enhancement: z
    .object({
      status: jobStatusSchema,
      provider: z.string().nullable(),
      model: z.string().nullable(),
      modelVersion: z.string().nullable(),
      operations: z.array(z.string()),
      error: z.string().nullable(),
      queuedAt: z.string(),
      finishedAt: z.string().nullable(),
    })
    .nullable(),
  disclosure: z.object({ en: z.string(), ar: z.string() }),
});
export type CompareVersions = z.infer<typeof compareVersionsSchema>;

export const propertyJobsSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.string().uuid(),
      type: z.string(),
      status: jobStatusSchema,
      mediaId: z.string().uuid().nullable(),
      error: z.string().nullable(),
      finishedAt: z.string().nullable(),
    }),
  ),
  summary: z.object({
    total: z.number().int(),
    pending: z.number().int(),
    succeeded: z.number().int(),
    failed: z.number().int(),
    skipped: z.number().int(),
  }),
});
export type PropertyJobs = z.infer<typeof propertyJobsSchema>;
