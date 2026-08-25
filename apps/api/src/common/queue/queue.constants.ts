/**
 * BullMQ queue names. Shared by the API (producer) and the worker (consumer).
 *
 * Dashes, not colons: BullMQ uses ':' as its own Redis key separator and rejects
 * queue names containing one.
 */
export const QUEUE_NAMES = {
  /** Verify an uploaded object exists in R2 and probe its real dimensions. */
  MEDIA: 'rivo-media',
  /** AI photo/video enhancement. */
  AI: 'rivo-ai',
  /** Poll Cloudflare Stream until a reel is encoded, then validate it. */
  VIDEO: 'rivo-video',
  /** Aggregate telemetry, expire incidents, purge raw GPS. */
  MAINTENANCE: 'rivo-maintenance',
  /** Outbound notifications. */
  NOTIFICATIONS: 'rivo-notifications',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const JOB_NAMES = {
  IMAGE_VERIFY: 'image.verify',
  IMAGE_ENHANCE: 'image.enhance',
  VIDEO_POLL: 'video.poll-stream',
  VIDEO_VALIDATE: 'video.validate',
  VIDEO_COVER: 'video.select-cover',
  TELEMETRY_AGGREGATE: 'telemetry.aggregate',
  TELEMETRY_PURGE: 'telemetry.purge-raw',
  INCIDENTS_EXPIRE: 'incidents.expire',
  PAYMENTS_EXPIRE: 'payments.expire',
  NOTIFY_USER: 'notify.user',
} as const;

/** Default retry policy: exponential backoff, capped attempts, completed jobs trimmed. */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { age: 86400, count: 1000 },
  removeOnFail: { age: 604800 },
};
