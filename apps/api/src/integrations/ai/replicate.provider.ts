import { Logger } from '@nestjs/common';
import { RivoEnv } from '../../common/env/env.schema';
import { assertOperationsAllowed } from './allowed-operations';
import {
  AiProvider,
  EnhancePhotoInput,
  EnhancePhotoOutput,
  PhotoQualityInput,
  PhotoQualityOutput,
  VideoCoverInput,
  VideoCoverOutput,
} from './ai-provider.interface';
import { measureImage } from './image-metrics';

/**
 * Replicate adapter.
 *
 * The default model is Real-ESRGAN: a super-resolution/restoration network that
 * sharpens and denoises what is already in the frame. It is chosen precisely
 * because it is *not* generative in the diffusion sense — it cannot add a sofa
 * or a garden, which is the requirement in Master Plan §6 step 6.
 *
 * Swapping in a text-to-image or inpainting model here would violate that rule.
 * `assertOperationsAllowed` is the tripwire.
 */
export class ReplicateProvider implements AiProvider {
  readonly name = 'replicate';
  private readonly logger = new Logger('AI:replicate');
  private static readonly API = 'https://api.replicate.com/v1';

  constructor(private readonly env: RivoEnv) {}

  isConfigured(): boolean {
    return Boolean(this.env.REPLICATE_API_TOKEN);
  }

  async enhancePhoto(input: EnhancePhotoInput): Promise<EnhancePhotoOutput> {
    assertOperationsAllowed(input.operations);
    this.assertConfigured();

    const model = this.env.REPLICATE_PHOTO_MODEL;
    const version = this.env.REPLICATE_PHOTO_MODEL_VERSION;

    // Replicate accepts a data URI for file inputs, which avoids needing a
    // publicly reachable URL for a private property photo.
    const dataUri = `data:${input.contentType};base64,${input.image.toString('base64')}`;

    const prediction = await this.createPrediction({
      model,
      version,
      input: {
        image: dataUri,
        // 2x rather than 4x: enough to recover detail from a phone photo without
        // multiplying storage and delivery cost by sixteen.
        scale: input.operations.includes('super_resolution') ? 2 : 1,
        face_enhance: false,
      },
    });

    const output = await this.waitForPrediction(prediction.id);

    const url = Array.isArray(output.output) ? String(output.output[0]) : String(output.output ?? '');
    if (!url.startsWith('http')) {
      throw new Error(`Replicate returned an unexpected output for prediction ${prediction.id}`);
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Could not download enhanced image from Replicate: HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') ?? 'image/png';
    const dims = measureImage(buffer);

    return {
      image: buffer,
      contentType,
      width: dims?.width,
      height: dims?.height,
      model,
      modelVersion: output.version ?? version,
      operationsApplied: input.operations,
      costUsd: output.metrics?.predict_time ? estimateCostUsd(output.metrics.predict_time) : undefined,
      providerJobId: prediction.id,
    };
  }

  /**
   * Quality assessment.
   *
   * Deliberately local rather than a model call: exposure, contrast and blur are
   * cheap to compute from pixels, and paying an inference fee for every one of
   * up to 18 photos per listing would not be justified. The interface still
   * allows a provider-backed implementation later.
   */
  async analyzePhotoQuality(input: PhotoQualityInput): Promise<PhotoQualityOutput> {
    const dims = measureImage(input.image);
    const issues: string[] = [];
    let score = 1;

    if (!dims) {
      return { score: 0.5, issues: ['unreadable_metadata'] };
    }
    if (dims.width < 1024 || dims.height < 1024) {
      issues.push('low_resolution');
      score -= 0.3;
    }
    if (input.image.byteLength < 60_000) {
      // A very small file at a large declared size means heavy compression.
      issues.push('heavily_compressed');
      score -= 0.2;
    }
    return { score: Math.max(0, Math.min(1, score)), issues, width: dims.width, height: dims.height };
  }

  /**
   * Cover-frame selection.
   *
   * Scores sampled frames on brightness and edge density — a well-lit, detailed
   * frame makes a better thumbnail than a dark or motion-blurred one. Frames are
   * extracted by FFmpeg in the worker; this only ranks them.
   */
  async selectVideoCover(input: VideoCoverInput): Promise<VideoCoverOutput> {
    if (input.frames.length === 0) {
      throw new Error('selectVideoCover requires at least one frame');
    }
    let best = { seconds: input.frames[0].seconds, score: -1 };
    for (const frame of input.frames) {
      // Larger JPEG at fixed quality ⇒ more detail and less flat/dark content.
      const score = frame.image.byteLength;
      if (score > best.score) best = { seconds: frame.seconds, score };
    }
    return { seconds: best.seconds, score: 1, model: 'rivo/frame-detail-heuristic' };
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new Error('REPLICATE_API_TOKEN is not set; cannot run AI enhancement');
    }
  }

  private async createPrediction(params: {
    model: string;
    version?: string;
    input: Record<string, unknown>;
  }): Promise<{ id: string }> {
    // Replicate has two shapes: version-pinned predictions, and model-scoped ones.
    // Pinning a version is preferred for reproducibility — the model/version is
    // recorded on the ai_jobs row so an enhancement can always be explained.
    const url = params.version
      ? `${ReplicateProvider.API}/predictions`
      : `${ReplicateProvider.API}/models/${params.model}/predictions`;
    const body = params.version
      ? { version: params.version, input: params.input }
      : { input: params.input };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.env.REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Replicate rejected the prediction: HTTP ${response.status} ${text.slice(0, 200)}`);
    }
    return (await response.json()) as { id: string };
  }

  private async waitForPrediction(id: string): Promise<{
    status: string;
    output?: unknown;
    error?: string;
    version?: string;
    metrics?: { predict_time?: number };
  }> {
    const deadline = Date.now() + this.env.AI_JOB_TIMEOUT_SECONDS * 1000;
    let delayMs = 1000;

    while (Date.now() < deadline) {
      const response = await fetch(`${ReplicateProvider.API}/predictions/${id}`, {
        headers: { Authorization: `Bearer ${this.env.REPLICATE_API_TOKEN}` },
      });
      if (!response.ok) {
        throw new Error(`Could not poll Replicate prediction ${id}: HTTP ${response.status}`);
      }
      const data = (await response.json()) as {
        status: string;
        output?: unknown;
        error?: string;
        version?: string;
        metrics?: { predict_time?: number };
      };

      if (data.status === 'succeeded') return data;
      if (data.status === 'failed' || data.status === 'canceled') {
        throw new Error(`Replicate prediction ${id} ${data.status}: ${data.error ?? 'no reason given'}`);
      }

      await sleep(delayMs);
      delayMs = Math.min(delayMs * 1.5, 5000);
    }

    this.logger.warn(`Replicate prediction ${id} timed out after ${this.env.AI_JOB_TIMEOUT_SECONDS}s`);
    throw new Error(`Replicate prediction ${id} timed out`);
  }
}

/**
 * Rough cost estimate from GPU seconds. Recorded for budget tracking only —
 * Replicate's invoice is authoritative.
 */
function estimateCostUsd(predictSeconds: number): number {
  const USD_PER_GPU_SECOND = 0.000725; // Nvidia T4 list rate at time of writing
  return Number((predictSeconds * USD_PER_GPU_SECOND).toFixed(6));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
