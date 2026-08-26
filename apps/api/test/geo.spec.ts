import { bucketStart, decodePolyline, haversineMeters, jitterPoint, segmentKeyFor } from '../src/common/geo/geo.util';

describe('haversineMeters', () => {
  it('measures a known Baghdad distance', () => {
    // Tahrir Square to Al-Mansour, roughly 8 km apart.
    const d = haversineMeters({ lat: 33.3152, lng: 44.3661 }, { lat: 33.3125, lng: 44.3316 });
    expect(d).toBeGreaterThan(3000);
    expect(d).toBeLessThan(4000);
  });

  it('returns zero for the same point', () => {
    expect(haversineMeters({ lat: 33.3, lng: 44.4 }, { lat: 33.3, lng: 44.4 })).toBe(0);
  });
});

describe('jitterPoint', () => {
  const origin = { lat: 33.3152, lng: 44.3661 };

  it('stays inside the requested radius', () => {
    for (let i = 0; i < 50; i += 1) {
      const jittered = jitterPoint(origin, 300, `property-${i}`);
      expect(haversineMeters(origin, jittered)).toBeLessThanOrEqual(301);
    }
  });

  it('is deterministic for the same seed', () => {
    // A pin that moved on every request would be obviously fake, and repeated
    // samples could be averaged back to the true location.
    const a = jitterPoint(origin, 300, 'same-seed');
    const b = jitterPoint(origin, 300, 'same-seed');
    expect(a).toEqual(b);
  });

  it('produces different offsets for different seeds', () => {
    const a = jitterPoint(origin, 300, 'seed-a');
    const b = jitterPoint(origin, 300, 'seed-b');
    expect(a).not.toEqual(b);
  });

  it('actually moves the point', () => {
    const jittered = jitterPoint(origin, 300, 'seed');
    expect(haversineMeters(origin, jittered)).toBeGreaterThan(0);
  });
});

describe('segmentKeyFor', () => {
  it('groups nearby points travelling the same way', () => {
    expect(segmentKeyFor(33.31520, 44.36610, 90)).toBe(segmentKeyFor(33.31521, 44.36611, 92));
  });

  it('separates opposite directions of travel', () => {
    // A jammed inbound lane says nothing about a free outbound lane.
    expect(segmentKeyFor(33.3152, 44.3661, 0)).not.toBe(segmentKeyFor(33.3152, 44.3661, 180));
  });

  it('separates points on different roads', () => {
    expect(segmentKeyFor(33.3152, 44.3661, 90)).not.toBe(segmentKeyFor(33.3452, 44.3961, 90));
  });

  it('handles a missing heading', () => {
    expect(segmentKeyFor(33.3152, 44.3661, null)).toContain(':X');
  });
});

describe('bucketStart', () => {
  it('truncates to the bucket boundary', () => {
    const bucket = bucketStart(new Date('2026-08-25T10:37:42.000Z'), 15);
    expect(bucket.toISOString()).toBe('2026-08-25T10:30:00.000Z');
  });

  it('is idempotent', () => {
    const first = bucketStart(new Date('2026-08-25T10:37:42.000Z'), 15);
    expect(bucketStart(first, 15)).toEqual(first);
  });
});

describe('decodePolyline', () => {
  it('round-trips a known precision-5 polyline', () => {
    // The canonical Google example: (38.5,-120.2) (40.7,-120.95) (43.252,-126.453)
    const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
    expect(points).toHaveLength(3);
    expect(points[0].lat).toBeCloseTo(38.5, 4);
    expect(points[0].lng).toBeCloseTo(-120.2, 4);
    expect(points[2].lat).toBeCloseTo(43.252, 4);
    expect(points[2].lng).toBeCloseTo(-126.453, 4);
  });
});
