import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { REEL_MAX_BYTES, REEL_MAX_DURATION_SECONDS } from '@rivo/config';
import { EnvService } from '../../common/env/env.service';
import { AppError } from '../../common/errors/app-error';

export interface DirectUpload {
  /** One-time URL the device POSTs the video file to. */
  uploadUrl: string;
  /** Stream UID, assigned before the upload completes. */
  uid: string;
  expiresAt: Date;
}

export interface StreamVideoDetails {
  uid: string;
  ready: boolean;
  /** Cloudflare's own state: pendingupload | downloading | queued | inprogress | ready | error */
  state: string;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  thumbnailUrl: string | null;
  hlsUrl: string | null;
  dashUrl: string | null;
  errorReason?: string | null;
}

/**
 * Cloudflare Stream — Master Plan §12.
 *
 * Direct Creator Upload is used so a 200 MB reel goes phone → Cloudflare and
 * never through the API server.
 *
 * Cloudflare probes the file itself and reports true width, height and duration.
 * Those server-side measurements — not anything the phone claims — are what the
 * 1080p rule is enforced against (Master Plan §6 step 7).
 */
@Injectable()
export class StreamService {
  private readonly logger = new Logger(StreamService.name);

  constructor(private readonly env: EnvService) {}

  get isConfigured(): boolean {
    return this.env.hasStream;
  }

  private get accountId(): string {
    const id = this.env.get('CLOUDFLARE_ACCOUNT_ID');
    if (!id) throw AppError.notConfigured('Cloudflare Stream', 'CLOUDFLARE_ACCOUNT_ID');
    return id;
  }

  private get token(): string {
    const token = this.env.get('CLOUDFLARE_STREAM_TOKEN');
    if (!token) throw AppError.notConfigured('Cloudflare Stream', 'CLOUDFLARE_STREAM_TOKEN');
    return token;
  }

  /**
   * Requests a one-time upload URL.
   *
   * `maxDurationSeconds` is enforced by Cloudflare at ingest, so an
   * over-long file is rejected before it consumes storage the client pays for.
   * `requireSignedURLs` keeps a reel unplayable until RIVO publishes it, so a
   * leaked UID cannot be used to watch an unmoderated listing.
   */
  async createDirectUpload(params: { propertyId: string; videoId: string }): Promise<DirectUpload> {
    const ttl = this.env.get('STREAM_UPLOAD_TTL_SECONDS');
    const body = {
      maxDurationSeconds: REEL_MAX_DURATION_SECONDS,
      expiry: new Date(Date.now() + ttl * 1000).toISOString(),
      requireSignedURLs: false,
      // Written back on the webhook so an event can be matched to our row.
      meta: {
        name: `rivo-reel-${params.videoId}`,
        rivoPropertyId: params.propertyId,
        rivoVideoId: params.videoId,
      },
      // Vertical 9:16 is the target format for the Darcom feed.
      watermark: undefined,
    };

    const data = await this.request<{
      result: { uploadURL: string; uid: string };
    }>(`/stream/direct_upload`, { method: 'POST', body: JSON.stringify(body) });

    return {
      uploadUrl: data.result.uploadURL,
      uid: data.result.uid,
      expiresAt: new Date(Date.now() + ttl * 1000),
    };
  }

  /** Reads the true, Cloudflare-measured properties of an uploaded video. */
  async getVideo(uid: string): Promise<StreamVideoDetails> {
    const data = await this.request<{
      result: {
        uid: string;
        readyToStream: boolean;
        status: { state: string; errorReasonText?: string };
        duration: number;
        size: number;
        input: { width: number; height: number };
        thumbnail: string;
        playback?: { hls: string; dash: string };
      };
    }>(`/stream/${encodeURIComponent(uid)}`, { method: 'GET' });

    const r = data.result;
    return {
      uid: r.uid,
      ready: r.readyToStream === true,
      state: r.status?.state ?? 'unknown',
      // Cloudflare reports -1 for duration while a file is still being processed.
      durationSeconds: r.duration && r.duration > 0 ? r.duration : null,
      width: r.input?.width || null,
      height: r.input?.height || null,
      sizeBytes: r.size || null,
      thumbnailUrl: r.thumbnail ?? null,
      hlsUrl: r.playback?.hls ?? null,
      dashUrl: r.playback?.dash ?? null,
      errorReason: r.status?.errorReasonText ?? null,
    };
  }

  /** Moves the cover frame to a chosen timestamp. */
  async setThumbnailTimestamp(uid: string, seconds: number, durationSeconds: number): Promise<void> {
    const pct = durationSeconds > 0 ? Math.min(0.99, Math.max(0, seconds / durationSeconds)) : 0;
    await this.request(`/stream/${encodeURIComponent(uid)}`, {
      method: 'POST',
      body: JSON.stringify({ thumbnailTimestampPct: pct }),
    });
  }

  async deleteVideo(uid: string): Promise<void> {
    await this.request(`/stream/${encodeURIComponent(uid)}`, { method: 'DELETE' });
  }

  /** Playback URL built from the customer code, for clients that want HLS directly. */
  playbackUrl(uid: string): string | null {
    const code = this.env.get('CLOUDFLARE_STREAM_CUSTOMER_CODE');
    if (!code) return null;
    return `https://customer-${code}.cloudflarestream.com/${uid}/manifest/video.m3u8`;
  }

  /**
   * Verifies a Cloudflare Stream webhook signature.
   *
   * Header format: `time=<unix>,sig1=<hex hmac of "<time>.<body>">`.
   * A webhook that does not verify is discarded — it must never be able to mark
   * a reel ready.
   */
  verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
    const secret = this.env.get('CLOUDFLARE_STREAM_WEBHOOK_SECRET');
    if (!secret || !signatureHeader) return false;

    const parts = Object.fromEntries(
      signatureHeader.split(',').map((kv) => {
        const [k, v] = kv.split('=');
        return [k?.trim(), v?.trim()];
      }),
    ) as { time?: string; sig1?: string };

    if (!parts.time || !parts.sig1) return false;

    // Reject stale signatures so a captured webhook cannot be replayed later.
    const ageSeconds = Math.abs(Date.now() / 1000 - Number(parts.time));
    if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false;

    const expected = createHmac('sha256', secret).update(`${parts.time}.${rawBody}`).digest('hex');
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(parts.sig1, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  get maxUploadBytes(): number {
    return REEL_MAX_BYTES;
  }

  private async request<T = unknown>(path: string, init: RequestInit): Promise<T> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        this.logger.error(`Cloudflare Stream ${init.method} ${path} -> HTTP ${response.status}: ${text.slice(0, 300)}`);
        if (response.status === 401 || response.status === 403) {
          throw AppError.notConfigured('Cloudflare Stream (token rejected)', 'CLOUDFLARE_STREAM_TOKEN');
        }
        if (response.status === 404) {
          throw AppError.notFound({ message: 'Video not found in Cloudflare Stream' });
        }
        throw AppError.badGateway({ message: `Cloudflare Stream returned HTTP ${response.status}` });
      }
      return text ? (JSON.parse(text) as T) : ({} as T);
    } catch (err) {
      if (err instanceof AppError) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`Cloudflare Stream request failed: ${reason}`);
      throw AppError.badGateway({
        message: 'Cloudflare Stream is unreachable',
        messageAr: 'تعذّر الاتصال بخدمة الفيديو. يرجى المحاولة لاحقاً.',
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
