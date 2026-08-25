import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { EnvService } from '../../common/env/env.service';
import { AppError } from '../../common/errors/app-error';

export interface PresignedUpload {
  /** PUT the file here with the exact Content-Type that was presigned. */
  uploadUrl: string;
  objectKey: string;
  bucket: string;
  expiresAt: Date;
  requiredHeaders: Record<string, string>;
}

export interface ObjectMetadata {
  exists: boolean;
  sizeBytes?: number;
  contentType?: string;
  etag?: string;
}

/**
 * Cloudflare R2 object storage — Master Plan §12.
 *
 * Uploads go browser/device → R2 directly using a presigned PUT. The API never
 * proxies image bytes: that keeps memory flat and means a slow mobile connection
 * cannot occupy an API worker for the length of an upload.
 *
 * R2 is S3-compatible, so the AWS SDK is used against R2's endpoint. Region is
 * fixed to "auto", which is what R2 expects.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private client: S3Client | null = null;

  constructor(private readonly env: EnvService) {}

  get isConfigured(): boolean {
    return this.env.hasR2;
  }

  get bucket(): string {
    return this.env.get('R2_BUCKET_NAME');
  }

  private get s3(): S3Client {
    if (!this.isConfigured) {
      throw AppError.notConfigured(
        'Cloudflare R2 object storage',
        'CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY',
      );
    }
    if (!this.client) {
      const endpoint =
        this.env.get('R2_ENDPOINT') ||
        `https://${this.env.get('CLOUDFLARE_ACCOUNT_ID')}.r2.cloudflarestorage.com`;
      this.client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: {
          accessKeyId: this.env.get('R2_ACCESS_KEY_ID') as string,
          secretAccessKey: this.env.get('R2_SECRET_ACCESS_KEY') as string,
        },
      });
    }
    return this.client;
  }

  /**
   * Builds the object key for a property photo.
   *
   * Originals and enhanced derivatives live under different prefixes so a
   * lifecycle rule or an audit can address them separately, and so it is
   * impossible to confuse one for the other by key alone.
   */
  buildPhotoKey(params: { propertyId: string; kind: 'ORIGINAL' | 'ENHANCED'; extension: string }): string {
    const prefix = params.kind === 'ORIGINAL' ? 'properties/originals' : 'properties/enhanced';
    return `${prefix}/${params.propertyId}/${randomUUID()}.${params.extension.replace(/^\./, '')}`;
  }

  async presignUpload(params: {
    objectKey: string;
    contentType: string;
    contentLength: number;
  }): Promise<PresignedUpload> {
    const ttlMinutes = this.env.get('R2_PRESIGN_TTL_MINUTES');
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: params.objectKey,
      ContentType: params.contentType,
      // Binding the length into the signature stops a client from presigning a
      // small file and then uploading a large one.
      ContentLength: params.contentLength,
    });

    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: ttlMinutes * 60 });

    return {
      uploadUrl,
      objectKey: params.objectKey,
      bucket: this.bucket,
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
      requiredHeaders: {
        'Content-Type': params.contentType,
        'Content-Length': String(params.contentLength),
      },
    };
  }

  /** Time-limited read URL for a private object. */
  async presignDownload(objectKey: string, ttlMinutes?: number): Promise<string> {
    const ttl = ttlMinutes ?? this.env.get('R2_DOWNLOAD_TTL_MINUTES');
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: objectKey });
    return getSignedUrl(this.s3, command, { expiresIn: ttl * 60 });
  }

  /**
   * Public URL when the bucket is fronted by a custom domain, otherwise a signed
   * URL. Returning a signed URL rather than failing keeps the app working before
   * R2_PUBLIC_BASE_URL is configured.
   */
  async publicOrSignedUrl(objectKey: string): Promise<string> {
    const base = this.env.get('R2_PUBLIC_BASE_URL');
    if (base) return `${base.replace(/\/$/, '')}/${objectKey}`;
    return this.presignDownload(objectKey);
  }

  /**
   * Confirms an object really landed, and reports its true size and type.
   *
   * This is what makes upload confirmation trustworthy: the client says "I
   * uploaded it", and the server checks R2 rather than believing the claim.
   */
  async head(objectKey: string): Promise<ObjectMetadata> {
    try {
      const result = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      return {
        exists: true,
        sizeBytes: result.ContentLength,
        contentType: result.ContentType,
        etag: result.ETag?.replace(/"/g, ''),
      };
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'NotFound' || name === 'NoSuchKey') return { exists: false };
      this.logger.error(`R2 HEAD failed for ${objectKey}: ${err instanceof Error ? err.message : String(err)}`);
      throw AppError.badGateway({ message: 'Object storage is unreachable' });
    }
  }

  /** Downloads an object into memory. Only used by the worker for AI jobs. */
  async getObjectBuffer(objectKey: string): Promise<Buffer> {
    const result = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    const body = result.Body as NodeJS.ReadableStream | undefined;
    if (!body) throw AppError.badGateway({ message: `Object ${objectKey} has no body` });
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(chunks);
  }

  async putObject(params: { objectKey: string; body: Buffer; contentType: string }): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.objectKey,
        Body: params.body,
        ContentType: params.contentType,
      }),
    );
  }

  async deleteObject(objectKey: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
  }
}
