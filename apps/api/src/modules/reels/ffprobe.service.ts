import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { VideoProbe } from './reel-validation';

const execFileAsync = promisify(execFile);

/**
 * FFprobe-based media inspection — Master Plan §6 step 7:
 * "Use server-side media metadata validation with FFprobe or equivalent; do not
 * trust only mobile metadata."
 *
 * In the normal Cloudflare Stream path, Cloudflare probes the file itself and
 * reports true dimensions; that is the primary measurement. FFprobe is the
 * fallback and cross-check for a locally held file, and it is what extracts
 * candidate cover frames.
 *
 * `execFile` is used rather than `exec` so arguments are passed as an array and
 * never through a shell — a filename can never become a command.
 */
@Injectable()
export class FfprobeService {
  private readonly logger = new Logger(FfprobeService.name);
  private available: boolean | null = null;

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      await execFileAsync('ffprobe', ['-version'], { timeout: 5000 });
      this.available = true;
    } catch {
      this.logger.warn('ffprobe is not on PATH; local video probing is unavailable (Cloudflare Stream metadata is still used)');
      this.available = false;
    }
    return this.available;
  }

  /** Reads real dimensions and duration from a local file. */
  async probe(filePath: string): Promise<VideoProbe> {
    if (!(await this.isAvailable())) {
      throw new Error('ffprobe is not installed on this host');
    }

    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,duration,r_frame_rate',
        '-show_entries', 'format=duration,size',
        '-of', 'json',
        filePath,
      ],
      { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
    );

    const parsed = JSON.parse(stdout) as {
      streams?: Array<{ width?: number; height?: number; duration?: string }>;
      format?: { duration?: string; size?: string };
    };

    const stream = parsed.streams?.[0];
    // Container duration is more reliable than stream duration for some
    // phone-recorded MP4s, so it is preferred when present.
    const duration = Number(parsed.format?.duration ?? stream?.duration ?? NaN);

    return {
      width: stream?.width ?? null,
      height: stream?.height ?? null,
      durationSeconds: Number.isFinite(duration) ? duration : null,
      sizeBytes: parsed.format?.size ? Number(parsed.format.size) : null,
    };
  }

  /** Extracts JPEG frames at the given timestamps, for AI cover selection. */
  async extractFrames(filePath: string, timestamps: number[]): Promise<Array<{ seconds: number; image: Buffer }>> {
    if (!(await this.isAvailable())) return [];

    const frames: Array<{ seconds: number; image: Buffer }> = [];
    for (const seconds of timestamps) {
      try {
        const { stdout } = await execFileAsync(
          'ffmpeg',
          [
            '-ss', String(seconds),
            '-i', filePath,
            '-frames:v', '1',
            '-q:v', '3',
            '-f', 'image2pipe',
            '-vcodec', 'mjpeg',
            'pipe:1',
          ],
          { timeout: 30_000, maxBuffer: 16 * 1024 * 1024, encoding: 'buffer' },
        );
        if (stdout.length > 0) frames.push({ seconds, image: stdout as unknown as Buffer });
      } catch (err) {
        this.logger.warn(`Could not extract a frame at ${seconds}s: ${err instanceof Error ? err.message : err}`);
      }
    }
    return frames;
  }
}
