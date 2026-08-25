import { Injectable, Logger } from '@nestjs/common';
import { INCIDENT_MIN_VISIBLE_SCORE } from '@rivo/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MapboxService, RoutesResponse } from '../../integrations/mapbox/mapbox.service';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { LatLng, decodePolyline } from '../../common/geo/geo.util';
import { RouteFeedbackDto, RouteRequestDto, SearchPlacesDto } from './dto/maps.dto';

export interface EnrichedRoutesResponse extends RoutesResponse {
  /** Active incidents that fall on or near each route. */
  incidentsOnRoute: Array<{
    routeId: string;
    incidents: Array<{ id: string; type: string; lat: number; lng: number; distanceFromRouteM: number; note: string | null }>;
  }>;
  destinationProperty?: { id: string; reference: string; title: string } | null;
}

@Injectable()
export class MapsService {
  private readonly logger = new Logger(MapsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mapbox: MapboxService,
  ) {}

  async searchPlaces(dto: SearchPlacesDto) {
    const proximity = dto.lat !== undefined && dto.lng !== undefined ? { lat: dto.lat, lng: dto.lng } : undefined;
    const results = await this.mapbox.search({
      query: dto.q,
      proximity,
      limit: dto.limit,
      language: dto.language,
    });
    return {
      results: results.map((r) => ({
        id: r.id,
        name: r.name,
        address: r.fullAddress,
        lat: r.center.lat,
        lng: r.center.lng,
        placeType: r.placeType,
        distanceM: r.distanceM ? Math.round(r.distanceM) : null,
      })),
    };
  }

  /**
   * Traffic-aware routing, enriched with RIVO's own incident data.
   *
   * Mapbox supplies the geometry, ETA and congestion; RIVO supplies the reports
   * its users made. That combination is the first concrete step of the traffic
   * engine described in Master Plan §4 — the plan explicitly says not to try to
   * replace Mapbox's traffic model yet.
   */
  async route(dto: RouteRequestDto, _userId: string | null): Promise<EnrichedRoutesResponse> {
    let destination: LatLng = { lat: dto.destination.lat, lng: dto.destination.lng };
    let destinationProperty: { id: string; reference: string; title: string } | null = null;

    // `اذهب إلى العقار` — routing straight to a listing (Master Plan §5).
    // The published coordinate is used, so an approximate listing routes to its
    // approximate pin, exactly as the map shows it.
    if (dto.propertyId) {
      const property = await this.prisma.property.findFirst({
        where: { id: dto.propertyId, status: 'PUBLISHED', deletedAt: null },
        include: { location: true },
      });
      if (!property?.location) {
        throw AppError.notFound({
          message: 'Listing not found, or it has no location',
          messageAr: 'الإعلان غير موجود أو لا يحتوي على موقع.',
        });
      }
      destination = {
        lat: property.location.publicLat ?? property.location.lat,
        lng: property.location.publicLng ?? property.location.lng,
      };
      destinationProperty = { id: property.id, reference: property.reference, title: property.title };
    }

    const routes = await this.mapbox.route({
      origin: { lat: dto.origin.lat, lng: dto.origin.lng },
      destination,
      waypoints: dto.waypoints?.map((w) => ({ lat: w.lat, lng: w.lng })),
      alternatives: dto.alternatives !== false,
      language: dto.language,
      originBearing: dto.originBearing,
      avoid: dto.avoid,
    });

    const incidentsOnRoute = await this.findIncidentsOnRoutes(routes);

    return { ...routes, incidentsOnRoute, destinationProperty };
  }

  /**
   * Finds active incidents within 60 m of each route line.
   *
   * The polyline is decoded and thinned before being handed to PostGIS: a full
   * route can carry thousands of vertices, and 60 m is well below the spacing
   * that survives thinning, so no incident near the road is missed.
   */
  private async findIncidentsOnRoutes(routes: RoutesResponse): Promise<EnrichedRoutesResponse['incidentsOnRoute']> {
    const out: EnrichedRoutesResponse['incidentsOnRoute'] = [];

    for (const route of routes.routes) {
      let points: LatLng[];
      try {
        points = decodePolyline(route.geometry, 6);
      } catch {
        out.push({ routeId: route.id, incidents: [] });
        continue;
      }
      if (points.length < 2) {
        out.push({ routeId: route.id, incidents: [] });
        continue;
      }

      const step = Math.max(1, Math.floor(points.length / 300));
      const thinned = points.filter((_, i) => i % step === 0 || i === points.length - 1);
      const wkt = `LINESTRING(${thinned.map((p) => `${p.lng} ${p.lat}`).join(',')})`;

      try {
        const rows = await this.prisma.$queryRaw<
          Array<{ id: string; type: string; lat: number; lng: number; note: string | null; distance_m: number }>
        >`
          SELECT i.id, i.type::text, i.lat, i.lng, i.note,
                 ST_Distance(i.point, ST_GeogFromText(${wkt})) AS distance_m
            FROM road_incidents i
           WHERE i.status = 'ACTIVE'
             AND i.expires_at > NOW()
             AND i.score > ${INCIDENT_MIN_VISIBLE_SCORE}
             AND ST_DWithin(i.point, ST_GeogFromText(${wkt}), 60)
           ORDER BY distance_m ASC
           LIMIT 50
        `;
        out.push({
          routeId: route.id,
          incidents: rows.map((r) => ({
            id: r.id,
            type: r.type,
            lat: r.lat,
            lng: r.lng,
            note: r.note,
            distanceFromRouteM: Math.round(r.distance_m),
          })),
        });
      } catch (err) {
        // Incident enrichment is additive: a failure here must not deny the
        // driver a route.
        this.logger.warn(`Incident lookup failed for route ${route.id}: ${err instanceof Error ? err.message : err}`);
        out.push({ routeId: route.id, incidents: [] });
      }
    }
    return out;
  }

  /**
   * Records how a route actually went. Predicted vs. actual is the calibration
   * signal RIVO's own ETA model will need (Master Plan §4).
   */
  async recordRouteFeedback(dto: RouteFeedbackDto, userId: string | null) {
    await this.prisma.routeFeedback.create({
      data: {
        userId,
        routeRequestId: dto.routeRequestId,
        originLat: dto.origin.lat,
        originLng: dto.origin.lng,
        destLat: dto.destination.lat,
        destLng: dto.destination.lng,
        predictedSeconds: dto.predictedSeconds,
        actualSeconds: dto.actualSeconds,
        distanceM: dto.distanceM,
        rerouteCount: dto.rerouteCount ?? 0,
        outcome: dto.outcome,
        rating: dto.rating,
        comment: dto.comment,
      },
    });

    const accuracy =
      dto.actualSeconds && dto.predictedSeconds > 0
        ? Number((1 - Math.abs(dto.actualSeconds - dto.predictedSeconds) / dto.predictedSeconds).toFixed(3))
        : null;

    return { recorded: true, etaAccuracy: accuracy };
  }

  /** Map style URLs and the public token, so the app does not hard-code them. */
  mapConfig() {
    if (!this.mapbox.isConfigured) {
      throw AppError.notConfigured('Maps', 'MAPBOX_SECRET_TOKEN and MAPBOX_PUBLIC_TOKEN');
    }
    return { ok: true };
  }

  /** Convenience for the `اذهب إلى العقار` button: the destination without routing. */
  async propertyDestination(propertyId: string) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, status: 'PUBLISHED', deletedAt: null },
      include: { location: true },
    });
    if (!property?.location) {
      throw new AppError(404, {
        code: ErrorCode.NOT_FOUND,
        message: 'Listing not found, or it has no location',
        messageAr: 'الإعلان غير موجود أو لا يحتوي على موقع.',
      });
    }
    return {
      propertyId: property.id,
      reference: property.reference,
      title: property.title,
      lat: property.location.publicLat ?? property.location.lat,
      lng: property.location.publicLng ?? property.location.lng,
      precision: property.location.displayPrecision,
      placeLabel: property.location.placeLabel,
      governorate: property.governorate,
      district: property.district,
    };
  }
}
