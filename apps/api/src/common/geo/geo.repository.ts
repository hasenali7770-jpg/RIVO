import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LatLng } from './geo.util';

/**
 * All PostGIS access lives here.
 *
 * Prisma cannot represent `geography(Point, 4326)`, so the geometry columns are
 * written and read with parameterised raw SQL. Every value is bound as a
 * parameter — no string interpolation of user input into SQL anywhere in this
 * file.
 */
@Injectable()
export class GeoRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Inserts or updates a property's location, including the public (approximate) point. */
  async upsertPropertyLocation(params: {
    propertyId: string;
    point: LatLng;
    publicPoint: LatLng | null;
    displayPrecision: 'EXACT' | 'APPROXIMATE';
    approxRadiusM: number;
    placeLabel?: string | null;
  }): Promise<void> {
    const { propertyId, point, publicPoint, displayPrecision, approxRadiusM, placeLabel } = params;
    await this.prisma.$executeRaw`
      INSERT INTO property_locations (
        property_id, point, public_point, lat, lng, public_lat, public_lng,
        display_precision, approx_radius_m, place_label, created_at, updated_at
      ) VALUES (
        ${propertyId}::uuid,
        ST_SetSRID(ST_MakePoint(${point.lng}::double precision, ${point.lat}::double precision), 4326)::geography,
        CASE WHEN ${publicPoint?.lng ?? null}::double precision IS NULL THEN NULL
             ELSE ST_SetSRID(ST_MakePoint(${publicPoint?.lng ?? null}::double precision, ${publicPoint?.lat ?? null}::double precision), 4326)::geography
        END,
        ${point.lat}, ${point.lng},
        ${publicPoint?.lat ?? null}, ${publicPoint?.lng ?? null},
        ${displayPrecision}, ${approxRadiusM}, ${placeLabel ?? null},
        NOW(), NOW()
      )
      ON CONFLICT (property_id) DO UPDATE SET
        point = EXCLUDED.point,
        public_point = EXCLUDED.public_point,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        public_lat = EXCLUDED.public_lat,
        public_lng = EXCLUDED.public_lng,
        display_precision = EXCLUDED.display_precision,
        approx_radius_m = EXCLUDED.approx_radius_m,
        place_label = EXCLUDED.place_label,
        updated_at = NOW()
    `;
  }

  async upsertSavedPlace(params: {
    id: string;
    userId: string;
    kind: string;
    label: string;
    point: LatLng;
    address?: string | null;
  }): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO saved_places (id, user_id, kind, label, point, lat, lng, address, created_at, updated_at)
      VALUES (
        ${params.id}::uuid, ${params.userId}::uuid, ${params.kind}, ${params.label},
        ST_SetSRID(ST_MakePoint(${params.point.lng}::double precision, ${params.point.lat}::double precision), 4326)::geography,
        ${params.point.lat}, ${params.point.lng}, ${params.address ?? null}, NOW(), NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        label = EXCLUDED.label, point = EXCLUDED.point,
        lat = EXCLUDED.lat, lng = EXCLUDED.lng,
        address = EXCLUDED.address, updated_at = NOW()
    `;
  }

  async insertRoadIncident(params: {
    id: string;
    type: string;
    point: LatLng;
    headingDeg: number | null;
    note: string | null;
    reportedById: string | null;
    expiresAt: Date;
    segmentKey: string;
    score: number;
    confidence: number;
    status: string;
  }): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO road_incidents (
        id, type, status, point, lat, lng, heading_deg, note, reported_by_id,
        score, confirm_count, dismiss_count, confidence, expires_at, segment_key,
        is_demo, created_at, updated_at
      ) VALUES (
        ${params.id}::uuid, ${params.type}::incident_type, ${params.status}::incident_status,
        ST_SetSRID(ST_MakePoint(${params.point.lng}::double precision, ${params.point.lat}::double precision), 4326)::geography,
        ${params.point.lat}, ${params.point.lng}, ${params.headingDeg}, ${params.note},
        ${params.reportedById}::uuid, ${params.score}, 0, 0, ${params.confidence},
        ${params.expiresAt}, ${params.segmentKey}, FALSE, NOW(), NOW()
      )
    `;
  }

  /**
   * Bulk-inserts consented speed samples.
   *
   * Built as a single multi-row INSERT with bound parameters. A telemetry batch
   * can carry 200 points, and 200 round trips per batch would dominate the
   * request budget.
   */
  async insertSpeedSamples(
    rows: Array<{
      sessionKey: string;
      lat: number;
      lng: number;
      speedKph: number;
      headingDeg: number | null;
      accuracyM: number | null;
      segmentKey: string;
      recordedAt: Date;
    }>,
  ): Promise<number> {
    if (rows.length === 0) return 0;

    const values: unknown[] = [];
    const tuples = rows.map((r, i) => {
      const b = i * 8;
      values.push(r.sessionKey, r.lng, r.lat, r.speedKph, r.headingDeg, r.accuracyM, r.segmentKey, r.recordedAt);
      return `($${b + 1}, ST_SetSRID(ST_MakePoint($${b + 2}::double precision, $${b + 3}::double precision), 4326)::geography, $${b + 4}::double precision, $${b + 5}::int, $${b + 6}::double precision, $${b + 7}, $${b + 8}::timestamptz)`;
    });

    const sql = `
      INSERT INTO road_speed_samples (session_key, point, speed_kph, heading_deg, accuracy_m, segment_key, recorded_at)
      VALUES ${tuples.join(', ')}
    `;
    return this.prisma.$executeRawUnsafe(sql, ...values);
  }

  /** Distance in metres between two points, computed by PostGIS on the spheroid. */
  async distanceMeters(a: LatLng, b: LatLng): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ d: number }>>`
      SELECT ST_Distance(
        ST_SetSRID(ST_MakePoint(${a.lng}::double precision, ${a.lat}::double precision), 4326)::geography,
        ST_SetSRID(ST_MakePoint(${b.lng}::double precision, ${b.lat}::double precision), 4326)::geography
      ) AS d
    `;
    return rows[0]?.d ?? 0;
  }
}
