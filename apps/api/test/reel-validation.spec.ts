import {
  REEL_MAX_DURATION_SECONDS,
  REEL_MIN_DURATION_SECONDS,
  REEL_MIN_SHORT_EDGE,
} from '@rivo/config';
import { validateReel } from '../src/modules/reels/reel-validation';

/**
 * The 1080p rule measured on the SHORT edge.
 *
 * The distinction matters: checking `height >= 1080` alone would pass 1280x720
 * rotated to 720x1280, and would reject a legitimate 1920x1080 landscape
 * walkthrough. These cases pin that behaviour down.
 */
describe('validateReel', () => {
  const ok = { durationSeconds: 30 };

  it('accepts portrait 1080x1920 (the preferred format)', () => {
    const result = validateReel({ width: 1080, height: 1920, ...ok });
    expect(result.valid).toBe(true);
    expect(result.details.shortEdge).toBe(1080);
    expect(result.details.isVerticalPreferred).toBe(true);
  });

  it('accepts landscape 1920x1080', () => {
    const result = validateReel({ width: 1920, height: 1080, ...ok });
    expect(result.valid).toBe(true);
    // Allowed, but flagged as not the preferred 9:16 shape.
    expect(result.details.isVerticalPreferred).toBe(false);
  });

  it('accepts 4K 2160x3840', () => {
    expect(validateReel({ width: 2160, height: 3840, ...ok }).valid).toBe(true);
  });

  it('rejects 1280x720', () => {
    const result = validateReel({ width: 1280, height: 720, ...ok });
    expect(result.valid).toBe(false);
    expect(result.code).toBe('REEL_RESOLUTION_TOO_LOW');
    expect(result.details.shortEdge).toBe(720);
    expect(result.messageAr).toBeTruthy();
  });

  it('rejects 720x1280 — portrait 720p is still 720p', () => {
    const result = validateReel({ width: 720, height: 1280, ...ok });
    expect(result.valid).toBe(false);
    expect(result.code).toBe('REEL_RESOLUTION_TOO_LOW');
  });

  it('rejects exactly one pixel under the limit', () => {
    expect(validateReel({ width: 1079, height: 1920, ...ok }).valid).toBe(false);
  });

  it('accepts exactly at the limit', () => {
    expect(validateReel({ width: REEL_MIN_SHORT_EDGE, height: 1920, ...ok }).valid).toBe(true);
  });

  it('rejects a reel that is too short', () => {
    const result = validateReel({
      width: 1080,
      height: 1920,
      durationSeconds: REEL_MIN_DURATION_SECONDS - 1,
    });
    expect(result.valid).toBe(false);
    expect(result.code).toBe('REEL_DURATION_INVALID');
  });

  it('rejects a reel that is too long', () => {
    const result = validateReel({
      width: 1080,
      height: 1920,
      durationSeconds: REEL_MAX_DURATION_SECONDS + 1,
    });
    expect(result.valid).toBe(false);
    expect(result.code).toBe('REEL_DURATION_INVALID');
  });

  it('rejects a file it could not measure rather than assuming it is fine', () => {
    const result = validateReel({ width: null, height: null, durationSeconds: null });
    expect(result.valid).toBe(false);
    expect(result.code).toBe('REEL_METADATA_MISSING');
  });
});
