import { AllowedOperation } from './allowed-operations';

export interface EnhancePhotoInput {
  /** Source image bytes, fetched from R2 by the worker. */
  image: Buffer;
  contentType: string;
  operations: AllowedOperation[];
  /** Upper bound on spend for this single job, in USD. */
  maxCostUsd: number;
}

export interface EnhancePhotoOutput {
  image: Buffer;
  contentType: string;
  width?: number;
  height?: number;
  model: string;
  modelVersion?: string;
  operationsApplied: AllowedOperation[];
  costUsd?: number;
  providerJobId?: string;
}

export interface PhotoQualityInput {
  image: Buffer;
  contentType: string;
}

export interface PhotoQualityOutput {
  /** 0..1, higher is better. */
  score: number;
  /** Machine-readable observations, e.g. `too_dark`, `blurry`, `low_resolution`. */
  issues: string[];
  width?: number;
  height?: number;
}

export interface VideoCoverInput {
  /** Frames sampled from the reel, as JPEG buffers, with their timestamps. */
  frames: Array<{ seconds: number; image: Buffer }>;
}

export interface VideoCoverOutput {
  /** Timestamp of the frame judged the best cover. */
  seconds: number;
  score: number;
  model: string;
}

/**
 * AI provider contract — Master Plan §12.
 *
 * The domain layer depends on this interface only, so Replicate can be replaced
 * without touching the media pipeline.
 *
 * Every implementation MUST honour the operation allow-list. A provider that
 * cannot restrict itself to non-generative edits is not eligible.
 */
export interface AiProvider {
  readonly name: string;
  isConfigured(): boolean;
  enhancePhoto(input: EnhancePhotoInput): Promise<EnhancePhotoOutput>;
  analyzePhotoQuality(input: PhotoQualityInput): Promise<PhotoQualityOutput>;
  selectVideoCover(input: VideoCoverInput): Promise<VideoCoverOutput>;
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');

/** Raised when the provider is deliberately disabled (AI_PROVIDER=none). */
export class AiDisabledError extends Error {
  constructor() {
    super('AI enhancement is disabled on this deployment (AI_PROVIDER=none)');
    this.name = 'AiDisabledError';
  }
}
