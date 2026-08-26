import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  INCIDENT_AUTO_TRUST_SCORE,
  INCIDENT_DEFAULT_TTL_MINUTES,
  INCIDENT_MIN_VISIBLE_SCORE,
  TELEMETRY_BUCKET_MINUTES,
  TELEMETRY_MIN_SAMPLES_PER_BUCKET,
  TELEMETRY_RAW_RETENTION_DAYS,
} from '@rivo/config';
import type { IncidentType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GeoRepository } from '../../common/geo/geo.repository';
import { RedisService } from '../../common/redis/redis.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { bucketStart, haversineMeters, segmentKeyFor } from '../../common/geo/geo.util';
import { ConfirmIncidentDto, CreateIncidentDto, ListIncidentsDto, TelemetryBatchDto } from './dto/traffic.dto';

@Injectable()
export class TrafficService {
  private readonly logger = new Logger(TrafficService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoRepository,
    private readonly redis: RedisService,
    private readonly flags: FeatureFlagsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Road incidents — Master Plan §4
  // ---------------------------------------------------------------------------

  async createIncident(dto: CreateIncidentDto, userId: string) {
    // One report per user per type per ~100 m per 10 minutes. Without this, a
    // driver stuck in the same jam re-reports it at every red light and the map
    // fills with duplicates.
    const dedupeKey = `incident:dedupe:${userId}:${dto.type}:${dto.lat.toFixed(3)}:${dto.lng.toFixed(3)}`;
    const lock = await this.redis.acquireLock(dedupeKey, 600);
    if (!lock) {
      throw AppError.conflict({
        message: 'You have already reported this here recently',
        messageAr: 'لقد قمت بالإبلاغ عن هذا الموقع قبل قليل.',
      });
    }

    // A report next to an existing active one of the same type is treated as a
    // confirmation of that report rather than a new pin.
    const nearby = await this.prisma.$queryRaw<Array<{ id: string; score: number }>>`
      SELECT i.id, i.score
        FROM road_incidents i
       WHERE i.status = 'ACTIVE'
         AND i.expires_at > NOW()
         AND i.type = ${dto.type}::incident_type
         AND ST_DWithin(
               i.point,
               ST_SetSRID(ST_MakePoint(${dto.lng}::double precision, ${dto.lat}::double precision), 4326)::geography,
               120
             )
       ORDER BY i.created_at DESC
       LIMIT 1
    `;

    if (nearby.length > 0) {
      await this.confirmIncident(nearby[0].id, userId, { confirmed: true, lat: dto.lat, lng: dto.lng });
      const merged = await this.prisma.roadIncident.findUniqueOrThrow({ where: { id: nearby[0].id } });
      return { ...this.toIncidentDto(merged), mergedWithExisting: true };
    }

    const ttlMinutes = INCIDENT_DEFAULT_TTL_MINUTES[dto.type] ?? 120;
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
    const reporterScore = await this.reporterReputation(userId);
    const id = randomUUID();

    // A reporter with a track record starts trusted; a brand-new account's first
    // report waits for a second voice before it reaches everyone.
    const startsActive = reporterScore >= 1;

    await this.geo.insertRoadIncident({
      id,
      type: dto.type,
      point: { lat: dto.lat, lng: dto.lng },
      headingDeg: dto.headingDeg ?? null,
      note: dto.note ?? null,
      reportedById: userId,
      expiresAt,
      segmentKey: segmentKeyFor(dto.lat, dto.lng, dto.headingDeg),
      score: reporterScore,
      confidence: Math.min(1, 0.4 + reporterScore * 0.15),
      status: startsActive ? 'ACTIVE' : 'PENDING_REVIEW',
    });

    const incident = await this.prisma.roadIncident.findUniqueOrThrow({ where: { id } });
    return { ...this.toIncidentDto(incident), mergedWithExisting: false };
  }

  async listIncidents(dto: ListIncidentsDto) {
    const bind: unknown[] = [];
    const push = (v: unknown) => {
      bind.push(v);
      return `$${bind.length}`;
    };

    const where: string[] = [
      `i.status = 'ACTIVE'`,
      `i.expires_at > NOW()`,
      // A report the community has voted down disappears from the map without
      // being deleted, so moderation still has the history.
      `i.score > ${INCIDENT_MIN_VISIBLE_SCORE}`,
    ];

    let distanceSelect = 'NULL::double precision AS distance_m';

    if (dto.lat !== undefined && dto.lng !== undefined) {
      const lng = push(dto.lng);
      const lat = push(dto.lat);
      const radius = push(dto.radiusM ?? 5000);
      const centre = `ST_SetSRID(ST_MakePoint(${lng}::double precision, ${lat}::double precision), 4326)::geography`;
      where.push(`ST_DWithin(i.point, ${centre}, ${radius}::double precision)`);
      distanceSelect = `ST_Distance(i.point, ${centre}) AS distance_m`;
    } else if (dto.bbox) {
      const parts = dto.bbox.split(',').map(Number);
      if (parts.length !== 4 || !parts.every(Number.isFinite)) {
        throw AppError.badRequest({ code: ErrorCode.VALIDATION_FAILED, message: 'bbox must be "minLng,minLat,maxLng,maxLat"' });
      }
      const envelope = `ST_MakeEnvelope(${push(parts[0])}::double precision, ${push(parts[1])}::double precision, ${push(parts[2])}::double precision, ${push(parts[3])}::double precision, 4326)::geography`;
      where.push(`ST_Intersects(i.point, ${envelope})`);
    } else {
      throw AppError.badRequest({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Provide either bbox, or lat and lng',
      });
    }

    if (dto.type?.length) where.push(`i.type = ANY(${push(dto.type)}::incident_type[])`);

    const sql = `
      SELECT i.id, i.type::text, i.lat, i.lng, i.heading_deg, i.note,
             i.score, i.confirm_count, i.dismiss_count, i.confidence,
             i.expires_at, i.created_at, ${distanceSelect}
        FROM road_incidents i
       WHERE ${where.join(' AND ')}
       ORDER BY i.confidence DESC, i.created_at DESC
       LIMIT 300
    `;

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        type: string;
        lat: number;
        lng: number;
        heading_deg: number | null;
        note: string | null;
        score: number;
        confirm_count: number;
        dismiss_count: number;
        confidence: number;
        expires_at: Date;
        created_at: Date;
        distance_m: number | null;
      }>
    >(sql, ...bind);

    return {
      incidents: rows.map((r) => ({
        id: r.id,
        type: r.type,
        lat: r.lat,
        lng: r.lng,
        headingDeg: r.heading_deg,
        note: r.note,
        score: r.score,
        confirmCount: r.confirm_count,
        dismissCount: r.dismiss_count,
        confidence: Number(r.confidence.toFixed(2)),
        expiresAt: r.expires_at,
        reportedAt: r.created_at,
        distanceM: r.distance_m === null ? null : Math.round(r.distance_m),
        // The reporter's identity is never exposed — only their report is.
      })),
    };
  }

  /**
   * Community confirm/dismiss.
   *
   * A confirmation extends the incident's life and raises its score; a dismissal
   * lowers it. Votes are weighted by distance: someone standing at the spot knows
   * more than someone 5 km away.
   */
  async confirmIncident(incidentId: string, userId: string, dto: ConfirmIncidentDto) {
    await this.flags.assertEnabled('incident_confirmations');

    const incident = await this.prisma.roadIncident.findUnique({ where: { id: incidentId } });
    if (!incident) throw AppError.notFound({ message: 'Incident not found' });
    if (incident.status === 'REMOVED') {
      throw AppError.conflict({ message: 'This report has been removed' });
    }
    if (incident.reportedById === userId) {
      throw AppError.badRequest({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'You cannot confirm your own report',
        messageAr: 'لا يمكنك تأكيد بلاغك الخاص.',
      });
    }

    const distanceM =
      dto.lat !== undefined && dto.lng !== undefined
        ? Math.round(haversineMeters({ lat: dto.lat, lng: dto.lng }, { lat: incident.lat, lng: incident.lng }))
        : null;

    const existing = await this.prisma.roadIncidentConfirmation.findUnique({
      where: { incidentId_userId: { incidentId, userId } },
    });
    if (existing) {
      throw AppError.conflict({
        message: 'You have already voted on this report',
        messageAr: 'لقد صوّت على هذا البلاغ مسبقاً.',
      });
    }

    // Beyond 2 km a vote carries no weight: the voter cannot see the road.
    const weight = distanceM === null ? 1 : distanceM <= 200 ? 2 : distanceM <= 2000 ? 1 : 0;
    const delta = dto.confirmed ? weight : -weight;

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.roadIncidentConfirmation.create({
        data: { incidentId, userId, confirmed: dto.confirmed, distanceM },
      });

      const next = await tx.roadIncident.update({
        where: { id: incidentId },
        data: {
          score: { increment: delta },
          ...(dto.confirmed
            ? { confirmCount: { increment: 1 }, expiresAt: extendExpiry(incident.expiresAt, incident.type) }
            : { dismissCount: { increment: 1 } }),
        },
      });

      const total = next.confirmCount + next.dismissCount;
      const confidence = total === 0 ? 0.5 : Math.max(0, Math.min(1, next.confirmCount / total));

      return tx.roadIncident.update({
        where: { id: incidentId },
        data: {
          confidence,
          // A pending report that gathers support becomes visible; one the
          // community rejects is expired rather than deleted.
          ...(next.status === 'PENDING_REVIEW' && next.score >= INCIDENT_AUTO_TRUST_SCORE
            ? { status: 'ACTIVE' as const }
            : {}),
          ...(next.score <= INCIDENT_MIN_VISIBLE_SCORE ? { status: 'EXPIRED' as const } : {}),
        },
      });
    });

    return {
      id: updated.id,
      score: updated.score,
      confirmCount: updated.confirmCount,
      dismissCount: updated.dismissCount,
      confidence: Number(updated.confidence.toFixed(2)),
      status: updated.status,
    };
  }

  async myIncidents(userId: string, page = 1, limit = 20) {
    const [items, total] = await Promise.all([
      this.prisma.roadIncident.findMany({
        where: { reportedById: userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.roadIncident.count({ where: { reportedById: userId } }),
    ]);
    return {
      items: items.map((i) => this.toIncidentDto(i)),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Marks expired incidents. Run by the maintenance queue. */
  async expireIncidents(): Promise<number> {
    const result = await this.prisma.roadIncident.updateMany({
      where: { status: 'ACTIVE', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });
    return result.count;
  }

  // ---------------------------------------------------------------------------
  // Telemetry — Master Plan §4 "RIVO Traffic Engine foundation"
  // ---------------------------------------------------------------------------

  /**
   * Ingests consented speed samples.
   *
   * Privacy properties, all required by Master Plan §4:
   *  - Consent is checked twice: the stored account preference AND a per-batch
   *    flag. Either being false discards the batch.
   *  - The stored row carries NO user id. Only a rotating pseudonymous session
   *    key is kept, so a track cannot be re-attached to a person.
   *  - Raw samples are deleted after TELEMETRY_RAW_RETENTION_DAYS; only
   *    k-anonymous aggregates survive.
   *  - Nothing here ever returns another user's samples. There is no read path
   *    for raw telemetry at all.
   */
  async ingestTelemetry(dto: TelemetryBatchDto, userId: string) {
    await this.flags.assertEnabled('traffic_telemetry');

    if (!dto.consent) {
      return { accepted: 0, rejected: dto.samples.length, reason: 'Batch was not marked as consented' };
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { telemetryOptIn: true },
    });
    if (!user.telemetryOptIn) {
      throw AppError.forbidden({
        message: 'Telemetry is turned off for this account. Enable it in privacy settings first.',
        messageAr: 'مشاركة بيانات الحركة غير مفعّلة في حسابك.',
      });
    }

    const now = Date.now();
    const rows = [];
    let rejected = 0;

    for (const sample of dto.samples) {
      const recordedAt = new Date(sample.recordedAt);

      // A poor GPS fix produces a speed that is noise, and a stale or
      // future-dated sample cannot be placed in a time bucket.
      if (sample.accuracyM !== undefined && sample.accuracyM > 50) {
        rejected += 1;
        continue;
      }
      if (!Number.isFinite(recordedAt.getTime())) {
        rejected += 1;
        continue;
      }
      const ageMs = now - recordedAt.getTime();
      if (ageMs > 24 * 3600 * 1000 || ageMs < -300_000) {
        rejected += 1;
        continue;
      }

      rows.push({
        sessionKey: dto.sessionKey,
        lat: sample.lat,
        lng: sample.lng,
        speedKph: sample.speedKph,
        headingDeg: sample.headingDeg ?? null,
        accuracyM: sample.accuracyM ?? null,
        segmentKey: segmentKeyFor(sample.lat, sample.lng, sample.headingDeg),
        recordedAt,
      });
    }

    const accepted = rows.length > 0 ? await this.geo.insertSpeedSamples(rows) : 0;

    return {
      accepted,
      rejected,
      retentionDays: TELEMETRY_RAW_RETENTION_DAYS,
      note: 'Samples are stored without any account identifier and are deleted after the retention window. Only anonymous aggregates are kept.',
    };
  }

  /**
   * Aggregates raw samples into k-anonymous per-segment buckets.
   *
   * A bucket is only written when it has at least TELEMETRY_MIN_SAMPLES_PER_BUCKET
   * distinct sessions. A bucket built from one session would describe one
   * person's journey, which is exactly what the plan forbids exposing.
   */
  async aggregateTelemetry(since?: Date): Promise<{ buckets: number }> {
    const from = since ?? new Date(Date.now() - 2 * TELEMETRY_BUCKET_MINUTES * 60_000);

    const rows = await this.prisma.$queryRaw<
      Array<{
        segment_key: string;
        bucket_start: Date;
        sample_count: bigint;
        session_count: bigint;
        avg_speed: number;
        p50: number;
        p85: number;
      }>
    >`
      SELECT
        s.segment_key,
        to_timestamp(floor(extract(epoch FROM s.recorded_at) / (${TELEMETRY_BUCKET_MINUTES} * 60)) * (${TELEMETRY_BUCKET_MINUTES} * 60)) AS bucket_start,
        COUNT(*) AS sample_count,
        COUNT(DISTINCT s.session_key) AS session_count,
        AVG(s.speed_kph) AS avg_speed,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.speed_kph) AS p50,
        PERCENTILE_CONT(0.85) WITHIN GROUP (ORDER BY s.speed_kph) AS p85
      FROM road_speed_samples s
      WHERE s.recorded_at >= ${from}
        AND s.segment_key IS NOT NULL
      GROUP BY s.segment_key, bucket_start
      HAVING COUNT(DISTINCT s.session_key) >= ${TELEMETRY_MIN_SAMPLES_PER_BUCKET}
    `;

    let written = 0;
    for (const row of rows) {
      const bucket = bucketStart(row.bucket_start, TELEMETRY_BUCKET_MINUTES);
      // Day-of-week and minute-of-day are stored in Baghdad time so "typical
      // traffic at 8am on a Sunday" is a meaningful lookup for Iraqi users.
      const baghdad = new Date(bucket.getTime() + 3 * 3600 * 1000);
      const dayOfWeek = baghdad.getUTCDay();
      const minuteOfDay = baghdad.getUTCHours() * 60 + baghdad.getUTCMinutes();

      await this.prisma.roadSpeedAggregate.upsert({
        where: { segmentKey_bucketStart: { segmentKey: row.segment_key, bucketStart: bucket } },
        create: {
          segmentKey: row.segment_key,
          bucketStart: bucket,
          dayOfWeek,
          minuteOfDay,
          sampleCount: Number(row.sample_count),
          sessionCount: Number(row.session_count),
          avgSpeedKph: row.avg_speed,
          p50SpeedKph: row.p50,
          p85SpeedKph: row.p85,
          // The 85th percentile is the standard proxy for free-flow speed in
          // traffic engineering: it is what most drivers manage when unobstructed.
          freeFlowKph: row.p85,
        },
        update: {
          sampleCount: Number(row.sample_count),
          sessionCount: Number(row.session_count),
          avgSpeedKph: row.avg_speed,
          p50SpeedKph: row.p50,
          p85SpeedKph: row.p85,
        },
      });
      written += 1;
    }

    return { buckets: written };
  }

  /** Deletes raw samples past the retention window. Aggregates are untouched. */
  async purgeRawTelemetry(): Promise<number> {
    const cutoff = new Date(Date.now() - TELEMETRY_RAW_RETENTION_DAYS * 24 * 3600 * 1000);
    const result = await this.prisma.roadSpeedSample.deleteMany({ where: { recordedAt: { lt: cutoff } } });
    if (result.count > 0) {
      this.logger.log(`Purged ${result.count} raw telemetry samples older than ${TELEMETRY_RAW_RETENTION_DAYS} days`);
    }
    return result.count;
  }

  /**
   * Aggregated congestion for a viewport. Only ever reads the aggregates table,
   * never raw samples.
   */
  async segmentSpeeds(bbox: string) {
    const parts = bbox.split(',').map(Number);
    if (parts.length !== 4 || !parts.every(Number.isFinite)) {
      throw AppError.badRequest({ code: ErrorCode.VALIDATION_FAILED, message: 'bbox must be "minLng,minLat,maxLng,maxLat"' });
    }

    const now = new Date();
    const baghdad = new Date(now.getTime() + 3 * 3600 * 1000);
    const dayOfWeek = baghdad.getUTCDay();
    const minuteOfDay = baghdad.getUTCHours() * 60 + baghdad.getUTCMinutes();

    // Recent measurement preferred; typical for this time of week as the
    // fallback, which is what makes an ETA useful on a quiet road.
    const rows = await this.prisma.$queryRaw<
      Array<{ segment_key: string; avg_speed_kph: number; free_flow_kph: number | null; sample_count: number; is_live: boolean }>
    >`
      WITH live AS (
        SELECT segment_key, avg_speed_kph, free_flow_kph, sample_count, TRUE AS is_live
          FROM road_speed_aggregates
         WHERE bucket_start >= NOW() - INTERVAL '45 minutes'
      ),
      typical AS (
        SELECT segment_key,
               AVG(avg_speed_kph) AS avg_speed_kph,
               AVG(free_flow_kph) AS free_flow_kph,
               SUM(sample_count)::int AS sample_count,
               FALSE AS is_live
          FROM road_speed_aggregates
         WHERE day_of_week = ${dayOfWeek}
           AND minute_of_day BETWEEN ${minuteOfDay - 45} AND ${minuteOfDay + 45}
         GROUP BY segment_key
      )
      SELECT * FROM live
      UNION ALL
      SELECT t.* FROM typical t
       WHERE NOT EXISTS (SELECT 1 FROM live l WHERE l.segment_key = t.segment_key)
      LIMIT 2000
    `;

    return {
      segments: rows.map((r) => ({
        segmentKey: r.segment_key,
        avgSpeedKph: Number(r.avg_speed_kph.toFixed(1)),
        freeFlowKph: r.free_flow_kph ? Number(r.free_flow_kph.toFixed(1)) : null,
        congestionRatio:
          r.free_flow_kph && r.free_flow_kph > 0 ? Number((r.avg_speed_kph / r.free_flow_kph).toFixed(2)) : null,
        sampleCount: r.sample_count,
        source: r.is_live ? 'live' : 'typical',
      })),
      note: 'Aggregated across at least 5 distinct anonymous sessions per bucket. No individual track is ever exposed.',
    };
  }

  /** Reputation seed for a new report, from the reporter's confirmed history. */
  private async reporterReputation(userId: string): Promise<number> {
    const [confirmed, dismissed] = await Promise.all([
      this.prisma.roadIncident.count({ where: { reportedById: userId, confirmCount: { gt: 0 } } }),
      this.prisma.roadIncident.count({ where: { reportedById: userId, status: 'REMOVED' } }),
    ]);
    // Capped at 3 so a long-standing account cannot single-handedly publish an
    // unverified closure.
    return Math.max(0, Math.min(3, Math.floor(confirmed / 3) - dismissed));
  }

  private toIncidentDto(incident: {
    id: string;
    type: IncidentType;
    status: string;
    lat: number;
    lng: number;
    headingDeg: number | null;
    note: string | null;
    score: number;
    confirmCount: number;
    dismissCount: number;
    confidence: number;
    expiresAt: Date;
    createdAt: Date;
  }) {
    return {
      id: incident.id,
      type: incident.type,
      status: incident.status,
      lat: incident.lat,
      lng: incident.lng,
      headingDeg: incident.headingDeg,
      note: incident.note,
      score: incident.score,
      confirmCount: incident.confirmCount,
      dismissCount: incident.dismissCount,
      confidence: Number(incident.confidence.toFixed(2)),
      expiresAt: incident.expiresAt,
      reportedAt: incident.createdAt,
    };
  }
}

/** A confirmation buys the incident another half of its default lifetime. */
function extendExpiry(current: Date, type: string): Date {
  const ttl = INCIDENT_DEFAULT_TTL_MINUTES[type] ?? 120;
  const extension = (ttl / 2) * 60_000;
  const extended = new Date(Math.max(current.getTime(), Date.now()) + extension);
  // Never past twice the default lifetime, so a busy road cannot keep a stale
  // report alive indefinitely.
  const ceiling = new Date(Date.now() + ttl * 2 * 60_000);
  return extended > ceiling ? ceiling : extended;
}
