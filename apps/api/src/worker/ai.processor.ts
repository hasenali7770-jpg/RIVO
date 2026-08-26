import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { StorageService } from '../integrations/r2/storage.service';
import { EnvService } from '../common/env/env.service';
import { MediaService } from '../modules/media/media.service';
import { AI_PROVIDER, AiDisabledError, AiProvider } from '../integrations/ai/ai-provider.interface';
import { DEFAULT_PHOTO_OPERATIONS, assertOperationsAllowed } from '../integrations/ai/allowed-operations';
import { extensionForMime } from '../integrations/ai/image-metrics';

/**
 * AI photo enhancement.
 *
 * Guarantees enforced here, per Master Plan §6 step 6 and §24:
 *  - The operation list is checked against the allow-list a second time, inside
 *    the worker, so a queue entry crafted by hand cannot request a generative edit.
 *  - The original is never overwritten. The enhanced image is written to a new
 *    object under a different prefix and recorded as a separate row.
 *  - The enhanced version is NOT auto-selected. The seller compares and chooses.
 *  - When AI is disabled or fails, the job is recorded as SKIPPED or FAILED and
 *    the original is published unchanged. Nothing ever claims a photo was
 *    enhanced when it was not.
 */
@Injectable()
export class AiProcessor {
  private readonly logger = new Logger(AiProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly env: EnvService,
    private readonly media: MediaService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
  ) {}

  async enhancePhoto(params: { aiJobId: string; mediaId: string }): Promise<void> {
    const { aiJobId, mediaId } = params;

    await this.prisma.aiJob.update({
      where: { id: aiJobId },
      data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 }, provider: this.ai.name },
    });

    const source = await this.prisma.propertyMedia.findUnique({
      where: { id: mediaId },
      include: { property: { select: { id: true, ownerId: true, reference: true } } },
    });

    if (!source) {
      await this.fail(aiJobId, 'Media record no longer exists');
      return;
    }

    if (!this.ai.isConfigured()) {
      // Deliberate, visible no-op rather than a silent pass.
      await this.prisma.aiJob.update({
        where: { id: aiJobId },
        data: {
          status: 'SKIPPED',
          error: `AI enhancement is not configured on this deployment (AI_PROVIDER=${this.env.get('AI_PROVIDER')}). The original photo is published unchanged.`,
          finishedAt: new Date(),
        },
      });
      this.logger.log(`Skipped enhancement for media ${mediaId}: no AI provider configured`);
      return;
    }

    // Spend ceiling per listing, so a seller uploading 18 photos cannot run up an
    // unbounded bill on the client's AI account.
    const spent = await this.prisma.aiJob.aggregate({
      where: { propertyId: source.property.id, status: 'SUCCEEDED' },
      _sum: { costUsd: true },
    });
    const spentUsd = Number(spent._sum.costUsd ?? 0);
    const budget = this.env.get('AI_MAX_COST_USD_PER_PROPERTY');
    if (spentUsd >= budget) {
      await this.prisma.aiJob.update({
        where: { id: aiJobId },
        data: {
          status: 'SKIPPED',
          error: `The AI budget for this listing (${budget} USD) is already spent. The original photo is published unchanged.`,
          finishedAt: new Date(),
        },
      });
      return;
    }

    try {
      const operations = [...DEFAULT_PHOTO_OPERATIONS];
      // Second check, inside the worker: the queue payload is not trusted to
      // have gone through the API's validation.
      assertOperationsAllowed(operations);

      const buffer = await this.storage.getObjectBuffer(source.objectKey);

      const output = await this.ai.enhancePhoto({
        image: buffer,
        contentType: source.mimeType,
        operations,
        maxCostUsd: budget - spentUsd,
      });

      const objectKey = this.storage.buildPhotoKey({
        propertyId: source.propertyId,
        kind: 'ENHANCED',
        extension: extensionForMime(output.contentType),
      });

      await this.storage.putObject({
        objectKey,
        body: output.image,
        contentType: output.contentType,
      });

      const enhancedId = await this.media.recordEnhancedDerivative({
        originalId: source.id,
        objectKey,
        bucket: this.storage.bucket,
        mimeType: output.contentType,
        sizeBytes: output.image.byteLength,
        width: output.width,
        height: output.height,
      });

      await this.prisma.aiJob.update({
        where: { id: aiJobId },
        data: {
          status: 'SUCCEEDED',
          provider: this.ai.name,
          model: output.model,
          modelVersion: output.modelVersion,
          operations: output.operationsApplied,
          providerJobId: output.providerJobId,
          costUsd: output.costUsd,
          result: {
            enhancedMediaId: enhancedId,
            width: output.width,
            height: output.height,
            sizeBytes: output.image.byteLength,
          },
          finishedAt: new Date(),
        },
      });

      this.logger.log(`Enhanced media ${mediaId} with ${output.model} (${output.operationsApplied.join(', ')})`);
    } catch (err) {
      if (err instanceof AiDisabledError) {
        await this.prisma.aiJob.update({
          where: { id: aiJobId },
          data: { status: 'SKIPPED', error: err.message, finishedAt: new Date() },
        });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Enhancement failed for media ${mediaId}: ${message}`);
      await this.fail(aiJobId, message);
      // Rethrown so BullMQ retries. After the final attempt the job stays FAILED
      // and the original is what gets published — the listing is never blocked
      // by an AI failure.
      throw err;
    }
  }

  private async fail(aiJobId: string, error: string) {
    await this.prisma.aiJob.update({
      where: { id: aiJobId },
      data: { status: 'FAILED', error: error.slice(0, 2000), finishedAt: new Date() },
    });
  }
}
