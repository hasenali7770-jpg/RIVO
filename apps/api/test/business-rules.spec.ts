import {
  LISTING_FEE_IQD,
  PROPERTY_PHOTO_MAX,
  PROPERTY_PHOTO_MIN,
  REEL_MIN_SHORT_EDGE,
  CURRENCY,
} from '@rivo/config';
import { ALLOWED_OPERATIONS, FORBIDDEN_OPERATIONS, assertOperationsAllowed } from '../src/integrations/ai/allowed-operations';

/**
 * A tripwire, not a behaviour test.
 *
 * Master Plan §24 forbids lowering the photo bounds, the reel minimum or the
 * listing fee without explicit written approval from the project owner. If a
 * future change edits those constants, this suite fails and the build stops,
 * so the change has to be deliberate rather than accidental.
 */
describe('protected business constants', () => {
  it('keeps the photo minimum at 8', () => {
    expect(PROPERTY_PHOTO_MIN).toBe(8);
  });

  it('keeps the photo maximum at 18', () => {
    expect(PROPERTY_PHOTO_MAX).toBe(18);
  });

  it('keeps the reel minimum at 1080p', () => {
    expect(REEL_MIN_SHORT_EDGE).toBe(1080);
  });

  it('keeps the standard listing fee at 3,000 IQD', () => {
    expect(LISTING_FEE_IQD).toBe(3000);
    expect(CURRENCY).toBe('IQD');
  });
});

/**
 * Master Plan §6 step 6 and §24: enhancement may improve image quality but must
 * never change what the property actually looks like.
 */
describe('AI enhancement is limited to non-generative operations', () => {
  it('allows only quality operations', () => {
    expect(ALLOWED_OPERATIONS).toEqual(
      expect.arrayContaining(['exposure', 'white_balance', 'denoise', 'clarity', 'super_resolution']),
    );
  });

  it('does not allow any generative operation through the allow-list', () => {
    for (const forbidden of FORBIDDEN_OPERATIONS) {
      expect(ALLOWED_OPERATIONS).not.toContain(forbidden);
    }
  });

  it('throws when a generative operation is requested', () => {
    for (const forbidden of ['virtual_staging', 'add_furniture', 'generative_fill', 'inpaint']) {
      expect(() => assertOperationsAllowed(['exposure', forbidden])).toThrow(/not permitted/);
    }
  });

  it('accepts a valid operation list', () => {
    expect(() => assertOperationsAllowed(['exposure', 'denoise', 'clarity'])).not.toThrow();
  });
});
