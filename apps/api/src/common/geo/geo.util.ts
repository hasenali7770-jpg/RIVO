/** Geospatial helpers that do not need a database round trip. */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Deterministically jitters a point inside `radiusM` for approximate public
 * display (Master Plan §6 step 3).
 *
 * The offset is derived from a seed (the property id) rather than being random
 * per call: a pin that moved on every request would be obviously fake and would
 * also let an observer average many samples back to the true location.
 */
export function jitterPoint(point: LatLng, radiusM: number, seed: string): LatLng {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rand1 = ((h >>> 0) % 100000) / 100000;
  const rand2 = ((Math.imul(h, 48271) >>> 0) % 100000) / 100000;

  const angle = rand1 * 2 * Math.PI;
  // sqrt keeps the distribution uniform over the disc rather than clustered at
  // the centre.
  const distance = Math.sqrt(rand2) * radiusM;

  const dLat = (distance * Math.cos(angle)) / EARTH_RADIUS_M;
  const dLng = (distance * Math.sin(angle)) / (EARTH_RADIUS_M * Math.cos((point.lat * Math.PI) / 180));

  return {
    lat: point.lat + (dLat * 180) / Math.PI,
    lng: point.lng + (dLng * 180) / Math.PI,
  };
}

/** Decodes a Mapbox/Google encoded polyline. `precision` is 5 or 6. */
export function decodePolyline(encoded: string, precision = 6): LatLng[] {
  const factor = 10 ** precision;
  const coordinates: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coordinates.push({ lat: lat / factor, lng: lng / factor });
  }
  return coordinates;
}

/**
 * Quantises a coordinate to a stable segment key.
 *
 * This is the MVP stand-in for true map matching (Master Plan §4 explicitly says
 * not to attempt full Waze-grade traffic intelligence yet). A ~35 m grid cell
 * plus a coarse heading bucket is enough to aggregate speed samples per
 * direction of travel on a road, which is what the aggregates table needs.
 * `docs/architecture/TRAFFIC_ENGINE.md` describes the upgrade path to real
 * OSM-way matching.
 */
export function segmentKeyFor(lat: number, lng: number, headingDeg?: number | null): string {
  const GRID = 0.0003; // ~33 m of latitude
  const gLat = Math.round(lat / GRID);
  const gLng = Math.round(lng / GRID);
  // 8 compass buckets. Opposite directions must not merge — a jammed inbound
  // lane says nothing about the free outbound lane.
  const bucket = headingDeg === null || headingDeg === undefined ? 'X' : String(Math.round(((headingDeg % 360) + 360) % 360 / 45) % 8);
  return `g:${gLat}:${gLng}:${bucket}`;
}

/** Truncates a timestamp to the start of its aggregation bucket. */
export function bucketStart(date: Date, bucketMinutes: number): Date {
  const ms = bucketMinutes * 60_000;
  return new Date(Math.floor(date.getTime() / ms) * ms);
}

export function isValidLat(lat: number): boolean {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

export function isValidLng(lng: number): boolean {
  return Number.isFinite(lng) && lng >= -180 && lng <= 180;
}
