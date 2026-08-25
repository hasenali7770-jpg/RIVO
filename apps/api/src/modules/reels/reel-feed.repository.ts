import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface ReelFeedRow {
  video_id: string;
  playback_hls_url: string | null;
  playback_dash_url: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  caption: string | null;
  view_count: number;
  property_id: string;
  reference: string;
  title: string;
  purpose: string;
  type: string;
  price_iqd: bigint;
  rent_period: string | null;
  area_sqm: string;
  bedrooms: number | null;
  bathrooms: number | null;
  governorate: string;
  district: string | null;
  display_lat: number;
  display_lng: number;
  is_verified_listing: boolean;
  contact_phone: string | null;
  contact_preference: string;
  seller_name: string | null;
  seller_type: string;
  seller_verified: boolean;
  is_favorited: boolean;
  distance_m: number | null;
  rank_score: number;
}

/**
 * Darcom Reels ranking — Master Plan §7.
 *
 * The MVP score combines the six inputs the plan lists: recency, location
 * relevance, the viewer's property filters (applied as hard filters), watch
 * completion, saves, and listing verification.
 *
 * It is one SQL expression rather than an ML model on purpose: it is auditable,
 * it needs no training data the product does not yet have, and a marketplace
 * operator can be told exactly why a reel ranked where it did.
 */
@Injectable()
export class ReelFeedRepository {
  constructor(private readonly prisma: PrismaService) {}

  async rank(params: {
    viewerId: string | null;
    lat?: number;
    lng?: number;
    purpose?: string;
    type?: string[];
    governorate?: string;
    maxPrice?: string;
    page: number;
    limit: number;
  }): Promise<ReelFeedRow[]> {
    const bind: unknown[] = [];
    const push = (v: unknown) => {
      bind.push(v);
      return `$${bind.length}`;
    };

    const where: string[] = [
      `v.status = 'READY'`,
      // A reel is only visible while its listing is published: a rejected or
      // archived listing must not keep circulating in the feed.
      `p.status = 'PUBLISHED'`,
      `p.deleted_at IS NULL`,
      `(p.expires_at IS NULL OR p.expires_at > NOW())`,
    ];

    if (params.purpose) where.push(`p.purpose = ${push(params.purpose)}::listing_purpose`);
    if (params.type?.length) where.push(`p.type = ANY(${push(params.type)}::property_type[])`);
    if (params.governorate) where.push(`p.governorate = ${push(params.governorate)}`);
    if (params.maxPrice) where.push(`p.price_iqd <= ${push(BigInt(params.maxPrice))}`);

    // --- Score components ---------------------------------------------------
    // Recency: 1.0 today, decaying with a 14-day half-life. Fresh stock is the
    // point of a marketplace feed.
    const recency = `EXP(-EXTRACT(EPOCH FROM (NOW() - COALESCE(v.published_at, v.created_at))) / (14 * 86400.0))`;

    // Completion: average watched fraction. A reel people finish is a reel worth
    // showing. Undefined for a reel with no views, so it starts neutral at 0.5.
    const completion = `CASE WHEN v.view_count > 0 THEN LEAST(1.0, v.completion_sum / v.view_count) ELSE 0.5 END`;

    // Saves, log-damped so one viral listing cannot dominate the feed forever.
    const saves = `LEAST(1.0, LN(1 + p.favorite_count) / LN(50))`;

    const verified = `CASE WHEN p.is_verified_listing THEN 1.0 ELSE 0.0 END`;

    let proximity = '0.0';
    let distanceSelect = 'NULL::double precision AS distance_m';
    if (params.lat !== undefined && params.lng !== undefined) {
      const lng = push(params.lng);
      const lat = push(params.lat);
      const centre = `ST_SetSRID(ST_MakePoint(${lng}::double precision, ${lat}::double precision), 4326)::geography`;
      const distance = `ST_Distance(COALESCE(l.public_point, l.point), ${centre})`;
      distanceSelect = `${distance} AS distance_m`;
      // Full weight within ~2 km, tapering to zero by ~50 km.
      proximity = `GREATEST(0.0, 1.0 - (${distance} / 50000.0))`;
    }

    const score = `(
      0.30 * ${recency} +
      0.25 * ${proximity} +
      0.20 * ${completion} +
      0.15 * ${saves} +
      0.10 * ${verified}
    )`;

    const viewer = push(params.viewerId);
    const limit = push(params.limit);
    const offset = push((params.page - 1) * params.limit);

    const sql = `
      SELECT
        v.id AS video_id, v.playback_hls_url, v.playback_dash_url, v.thumbnail_url,
        v.duration_seconds, v.width, v.height, v.caption, v.view_count,
        p.id AS property_id, p.reference, p.title, p.purpose::text, p.type::text,
        p.price_iqd, p.rent_period, p.area_sqm::text AS area_sqm,
        p.bedrooms, p.bathrooms, p.governorate, p.district,
        COALESCE(l.public_lat, l.lat) AS display_lat,
        COALESCE(l.public_lng, l.lng) AS display_lng,
        p.is_verified_listing, p.contact_phone, p.contact_preference::text,
        u.display_name AS seller_name, u.seller_type::text,
        COALESCE(sp.verification = 'VERIFIED', FALSE) AS seller_verified,
        (${viewer}::uuid IS NOT NULL
          AND EXISTS (SELECT 1 FROM favorites f WHERE f.property_id = p.id AND f.user_id = ${viewer}::uuid)
        ) AS is_favorited,
        ${distanceSelect},
        ${score} AS rank_score
      FROM property_videos v
      JOIN properties p ON p.id = v.property_id
      JOIN property_locations l ON l.property_id = p.id
      JOIN users u ON u.id = p.owner_id
      LEFT JOIN seller_profiles sp ON sp.user_id = u.id
      WHERE ${where.join(' AND ')}
      ORDER BY rank_score DESC, v.published_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    return this.prisma.$queryRawUnsafe<ReelFeedRow[]>(sql, ...bind);
  }
}
