import {
  REEL_ASPECT_TOLERANCE,
  REEL_MAX_DURATION_SECONDS,
  REEL_MIN_DURATION_SECONDS,
  REEL_MIN_SHORT_EDGE,
  REEL_PREFERRED_ASPECT,
} from '@rivo/config';

export interface VideoProbe {
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  sizeBytes?: number | null;
}

export interface ReelValidationResult {
  valid: boolean;
  /** Machine-readable failure code, matching ErrorCode where one applies. */
  code?: 'REEL_RESOLUTION_TOO_LOW' | 'REEL_DURATION_INVALID' | 'REEL_METADATA_MISSING';
  message?: string;
  messageAr?: string;
  details: {
    width: number | null;
    height: number | null;
    shortEdge: number | null;
    durationSeconds: number | null;
    aspectRatio: number | null;
    requiredShortEdge: number;
    minDurationSeconds: number;
    maxDurationSeconds: number;
    /** True when the reel is close enough to 9:16. Not a rejection reason. */
    isVerticalPreferred: boolean;
  };
}

/**
 * The 1080p rule — Master Plan §6 step 7 and §24.
 *
 * Measured on the SHORT edge, not on height. 1920×1080 (landscape) and
 * 1080×1920 (portrait) both have a short edge of 1080 and both pass; 1280×720
 * has a short edge of 720 and is refused. Testing `height >= 1080` alone would
 * wrongly reject a legitimate landscape Full HD walkthrough.
 *
 * The input must come from a server-side probe — Cloudflare Stream's own
 * measurement or FFprobe — never from metadata the phone supplied.
 */
export function validateReel(probe: VideoProbe): ReelValidationResult {
  const { width, height, durationSeconds } = probe;
  const shortEdge = width !== null && height !== null ? Math.min(width, height) : null;
  const aspectRatio = width !== null && height !== null && height > 0 ? width / height : null;
  const isVerticalPreferred =
    aspectRatio !== null && Math.abs(aspectRatio - REEL_PREFERRED_ASPECT) <= REEL_ASPECT_TOLERANCE;

  const details = {
    width,
    height,
    shortEdge,
    durationSeconds,
    aspectRatio,
    requiredShortEdge: REEL_MIN_SHORT_EDGE,
    minDurationSeconds: REEL_MIN_DURATION_SECONDS,
    maxDurationSeconds: REEL_MAX_DURATION_SECONDS,
    isVerticalPreferred,
  };

  if (width === null || height === null || durationSeconds === null) {
    return {
      valid: false,
      code: 'REEL_METADATA_MISSING',
      message: 'The video could not be measured. It may still be processing, or the file may be corrupt.',
      messageAr: 'تعذّر قراءة معلومات الفيديو. قد يكون الملف قيد المعالجة أو تالفاً.',
      details,
    };
  }

  if (shortEdge === null || shortEdge < REEL_MIN_SHORT_EDGE) {
    return {
      valid: false,
      code: 'REEL_RESOLUTION_TOO_LOW',
      message: `Reels must be at least ${REEL_MIN_SHORT_EDGE}p. This video is ${width}×${height} (shortest edge ${shortEdge}px).`,
      messageAr: `الحد الأدنى لدقة الريلز هو ${REEL_MIN_SHORT_EDGE}p. هذا الفيديو بدقة ${width}×${height}.`,
      details,
    };
  }

  if (durationSeconds < REEL_MIN_DURATION_SECONDS || durationSeconds > REEL_MAX_DURATION_SECONDS) {
    return {
      valid: false,
      code: 'REEL_DURATION_INVALID',
      message: `Reels must be between ${REEL_MIN_DURATION_SECONDS} and ${REEL_MAX_DURATION_SECONDS} seconds. This video is ${Math.round(durationSeconds)}s.`,
      messageAr: `يجب أن تكون مدة الريل بين ${REEL_MIN_DURATION_SECONDS} و ${REEL_MAX_DURATION_SECONDS} ثانية. مدة هذا الفيديو ${Math.round(durationSeconds)} ثانية.`,
      details,
    };
  }

  return { valid: true, details };
}
