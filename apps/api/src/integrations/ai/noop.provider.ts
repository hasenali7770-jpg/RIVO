import {
  AiDisabledError,
  AiProvider,
  EnhancePhotoOutput,
  PhotoQualityInput,
  PhotoQualityOutput,
  VideoCoverOutput,
} from './ai-provider.interface';
import { measureImage } from './image-metrics';

/**
 * Used when AI_PROVIDER=none.
 *
 * This is not a stub that pretends to work: `enhancePhoto` throws
 * `AiDisabledError`, and the media pipeline records the job as SKIPPED and
 * publishes the untouched original. The user is told no enhancement ran, rather
 * than being shown an "enhanced" image identical to the original — which would
 * be exactly the kind of fake success Master Plan §24 forbids.
 *
 * Quality analysis still runs, because it is computed locally and needs no
 * provider.
 */
export class NoopAiProvider implements AiProvider {
  readonly name = 'none';

  isConfigured(): boolean {
    return false;
  }

  async enhancePhoto(): Promise<EnhancePhotoOutput> {
    throw new AiDisabledError();
  }

  async analyzePhotoQuality(input: PhotoQualityInput): Promise<PhotoQualityOutput> {
    const dims = measureImage(input.image);
    const issues: string[] = [];
    let score = 1;
    if (!dims) return { score: 0.5, issues: ['unreadable_metadata'] };
    if (dims.width < 1024 || dims.height < 1024) {
      issues.push('low_resolution');
      score -= 0.3;
    }
    return { score: Math.max(0, score), issues, width: dims.width, height: dims.height };
  }

  async selectVideoCover(): Promise<VideoCoverOutput> {
    throw new AiDisabledError();
  }
}
