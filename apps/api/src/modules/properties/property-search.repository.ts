import { Injectable } from '@nestjs/common';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@rivo/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SearchPropertiesDto } from './dto/property.dto';

export interface PropertySearchRow {
  id: string;
  reference: string;
  type: string;
  purpose: string;
  title: string;
  price_iqd: bigint;
  rent_period: string | null;
  area_sqm: string;
  bedrooms: number | null;
  bathrooms: number | null;
  governorate: string;
  city: string | null;
  district: string | null;
  seller_type: string;
  is_verified_listing: boolean;
  is_demo: boolean;
  photo_count: number;
  favorite_count: number;
  view_count: number;
  published_at: Date | null;
  created_at: Date;
  /** Public display coordinates. Never the exact pin when precision is APPROXIMATE. */
  display_lat: number;
  display_lng: number;
  cover_media_id: string | null;
  cover_object_key: string | null;
  has_reel: boolean;
  distance_m: number | null;
  total_count: number;
}

/**
 * Darcom discovery queries.
 *
 * Written as raw SQL rather than through Prisma because the query has to combine
 * PostGIS distance filtering, the exact/approximate coordinate rule, a cover-photo
 * lateral join and a total count in one round trip. Expressing that through the
 * ORM would mean several queries per search on the hottest read path in the app.
 *
 * Every user-supplied value is a bound parameter; nothing is interpolated.
 */
@Injectable()
export class PropertySearchRepository {
  constructor(private readonly prisma: PrismaService) {}

  async search(dto: SearchPropertiesDto, viewerId: string | null): Promise<{
    rows: PropertySearchRow[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(1, dto.page ?? 1);
    const limit = Math.min(dto.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const offset = (page - 1) * limit;

    const params: unknown[] = [];
    const push = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    const where: string[] = [
      `p.status = 'PUBLISHED'`,
      `p.deleted_at IS NULL`,
      `(p.expires_at IS NULL OR p.expires_at > NOW())`,
    ];

    if (dto.q) {
      // Trigram similarity handles Arabic, where PostgreSQL has no stemmer.
      const q = push(`%${dto.q}%`);
      where.push(`(p.title ILIKE ${q} OR p.district ILIKE ${q} OR p.city ILIKE ${q} OR p.address_line ILIKE ${q})`);
    }
    if (dto.type?.length) {
      where.push(`p.type = ANY(${push(dto.type)}::property_type[])`);
    }
    if (dto.purpose) {
      where.push(`p.purpose = ${push(dto.purpose)}::listing_purpose`);
    }
    if (dto.minPrice) {
      where.push(`p.price_iqd >= ${push(BigInt(dto.minPrice))}`);
    }
    if (dto.maxPrice) {
      where.push(`p.price_iqd <= ${push(BigInt(dto.maxPrice))}`);
    }
    if (dto.minArea !== undefined) {
      where.push(`p.area_sqm >= ${push(dto.minArea)}`);
    }
    if (dto.maxArea !== undefined) {
      where.push(`p.area_sqm <= ${push(dto.maxArea)}`);
    }
    if (dto.minBedrooms !== undefined) {
      where.push(`p.bedrooms >= ${push(dto.minBedrooms)}`);
    }
    if (dto.minBathrooms !== undefined) {
      where.push(`p.bathrooms >= ${push(dto.minBathrooms)}`);
    }
    if (dto.governorate) {
      where.push(`p.governorate = ${push(dto.governorate)}`);
    }
    if (dto.district) {
      where.push(`p.district ILIKE ${push(`%${dto.district}%`)}`);
    }
    if (dto.verifiedOnly) {
      where.push(`p.is_verified_listing = TRUE`);
    }
    if (dto.sellerType) {
      where.push(`p.seller_type = ${push(dto.sellerType)}::seller_type`);
    }
    if (dto.hasReel) {
      where.push(`EXISTS (SELECT 1 FROM property_videos v WHERE v.property_id = p.id AND v.status = 'READY')`);
    }

    // --- Geospatial predicates ---------------------------------------------
    // Filtering uses the public point when one exists, so an approximate listing
    // is matched on the coordinate the user is actually shown.
    const displayPoint = `COALESCE(l.public_point, l.point)`;
    let distanceSelect = 'NULL::double precision AS distance_m';

    if (dto.lat !== undefined && dto.lng !== undefined) {
      const lng = push(dto.lng);
      const lat = push(dto.lat);
      const radius = push(dto.radiusM ?? 5000);
      const centre = `ST_SetSRID(ST_MakePoint(${lng}::double precision, ${lat}::double precision), 4326)::geography`;
      where.push(`ST_DWithin(${displayPoint}, ${centre}, ${radius}::double precision)`);
      distanceSelect = `ST_Distance(${displayPoint}, ${centre}) AS distance_m`;
    } else if (dto.bbox) {
      const parts = dto.bbox.split(',').map(Number);
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
        const [minLng, minLat, maxLng, maxLat] = parts;
        const envelope = `ST_MakeEnvelope(${push(minLng)}::double precision, ${push(minLat)}::double precision, ${push(maxLng)}::double precision, ${push(maxLat)}::double precision, 4326)::geography`;
        where.push(`ST_Intersects(${displayPoint}, ${envelope})`);
      }
    }

    const orderBy = this.buildOrderBy(dto);
    const limitParam = push(limit);
    const offsetParam = push(offset);
    const viewerParam = push(viewerId);

    const sql = `
      SELECT
        p.id, p.reference, p.type::text, p.purpose::text, p.title,
        p.price_iqd, p.rent_period, p.area_sqm::text AS area_sqm,
        p.bedrooms, p.bathrooms, p.governorate, p.city, p.district,
        p.seller_type::text, p.is_verified_listing, p.is_demo,
        p.photo_count, p.favorite_count, p.view_count,
        p.published_at, p.created_at,
        COALESCE(l.public_lat, l.lat) AS display_lat,
        COALESCE(l.public_lng, l.lng) AS display_lng,
        p.cover_media_id,
        cover.object_key AS cover_object_key,
        EXISTS (SELECT 1 FROM property_videos v WHERE v.property_id = p.id AND v.status = 'READY') AS has_reel,
        ${distanceSelect},
        (${viewerParam}::uuid IS NOT NULL
          AND EXISTS (SELECT 1 FROM favorites f WHERE f.property_id = p.id AND f.user_id = ${viewerParam}::uuid)
        ) AS is_favorited,
        COUNT(*) OVER () AS total_count
      FROM properties p
      JOIN property_locations l ON l.property_id = p.id
      LEFT JOIN LATERAL (
        SELECT m.object_key
          FROM property_media m
         WHERE m.property_id = p.id
           AND m.upload_confirmed = TRUE
           AND m.is_selected = TRUE
           AND (p.cover_media_id IS NULL OR m.id = p.cover_media_id OR m.source_media_id = p.cover_media_id)
         ORDER BY (m.id = p.cover_media_id) DESC, m.position ASC
         LIMIT 1
      ) cover ON TRUE
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `;

    const rows = await this.prisma.$queryRawUnsafe<Array<PropertySearchRow & { is_favorited: boolean }>>(
      sql,
      ...params,
    );

    // COUNT(*) OVER () gives the unpaginated total in the same scan. An empty
    // page means zero matches.
    const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
    return { rows, total, page, limit };
  }

  private buildOrderBy(dto: SearchPropertiesDto): string {
    const hasDistance = dto.lat !== undefined && dto.lng !== undefined;
    switch (dto.sort) {
      case 'price_asc':
        return 'p.price_iqd ASC, p.published_at DESC NULLS LAST';
      case 'price_desc':
        return 'p.price_iqd DESC, p.published_at DESC NULLS LAST';
      case 'area_desc':
        return 'p.area_sqm DESC, p.published_at DESC NULLS LAST';
      case 'distance':
        return hasDistance ? 'distance_m ASC NULLS LAST' : 'p.published_at DESC NULLS LAST';
      case 'relevance':
        // Verified first, then those with a reel and a full gallery, then recent.
        // A listing that has done the work to be trustworthy ranks above one that
        // has not, which is the incentive the marketplace needs.
        return `
          p.is_verified_listing DESC,
          (SELECT COUNT(*) FROM property_videos v WHERE v.property_id = p.id AND v.status = 'READY') DESC,
          p.photo_count DESC,
          ${hasDistance ? 'distance_m ASC NULLS LAST,' : ''}
          p.published_at DESC NULLS LAST`;
      case 'newest':
      default:
        return 'p.published_at DESC NULLS LAST, p.created_at DESC';
    }
  }

  /**
   * Lightweight pins for the map viewport.
   *
   * Returns only what a pin renders — id, coordinates, price, type — so a
   * viewport with hundreds of listings stays small over a mobile connection.
   */
  async mapPins(params: {
    bbox: [number, number, number, number];
    filters: SearchPropertiesDto;
    limit: number;
  }): Promise<Array<{ id: string; lat: number; lng: number; price_iqd: bigint; purpose: string; type: string; is_verified_listing: boolean }>> {
    const bind: unknown[] = [];
    const push = (v: unknown) => {
      bind.push(v);
      return `$${bind.length}`;
    };

    const where: string[] = [
      `p.status = 'PUBLISHED'`,
      `p.deleted_at IS NULL`,
      `(p.expires_at IS NULL OR p.expires_at > NOW())`,
    ];

    const [minLng, minLat, maxLng, maxLat] = params.bbox;
    const envelope = `ST_MakeEnvelope(${push(minLng)}::double precision, ${push(minLat)}::double precision, ${push(maxLng)}::double precision, ${push(maxLat)}::double precision, 4326)::geography`;
    where.push(`ST_Intersects(COALESCE(l.public_point, l.point), ${envelope})`);

    if (params.filters.type?.length) where.push(`p.type = ANY(${push(params.filters.type)}::property_type[])`);
    if (params.filters.purpose) where.push(`p.purpose = ${push(params.filters.purpose)}::listing_purpose`);
    if (params.filters.minPrice) where.push(`p.price_iqd >= ${push(BigInt(params.filters.minPrice))}`);
    if (params.filters.maxPrice) where.push(`p.price_iqd <= ${push(BigInt(params.filters.maxPrice))}`);
    if (params.filters.verifiedOnly) where.push(`p.is_verified_listing = TRUE`);

    const sql = `
      SELECT p.id,
             COALESCE(l.public_lat, l.lat) AS lat,
             COALESCE(l.public_lng, l.lng) AS lng,
             p.price_iqd, p.purpose::text, p.type::text, p.is_verified_listing
        FROM properties p
        JOIN property_locations l ON l.property_id = p.id
       WHERE ${where.join(' AND ')}
       ORDER BY p.published_at DESC NULLS LAST
       LIMIT ${push(params.limit)}
    `;
    return this.prisma.$queryRawUnsafe(sql, ...bind);
  }
}
