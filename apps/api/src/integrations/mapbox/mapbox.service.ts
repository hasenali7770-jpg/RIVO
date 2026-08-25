import { Injectable, Logger } from '@nestjs/common';
import { IRAQ_BBOX, ROUTE_MAX_ALTERNATIVES } from '@rivo/config';
import { EnvService } from '../../common/env/env.service';
import { RedisService } from '../../common/redis/redis.service';
import { AppError } from '../../common/errors/app-error';
import { LatLng } from '../../common/geo/geo.util';

export interface GeocodeResult {
  id: string;
  name: string;
  fullAddress: string;
  center: LatLng;
  /** Mapbox place type: address, poi, neighborhood, place, … */
  placeType: string[];
  /** Metres from the bias point, when one was supplied. */
  distanceM?: number;
}

export interface RouteStep {
  instruction: string;
  instructionAr?: string;
  distanceM: number;
  durationSeconds: number;
  /** Mapbox maneuver type: turn, merge, roundabout, arrive, … */
  maneuverType: string;
  maneuverModifier?: string;
  location: LatLng;
  /** Street name being entered, when the provider supplies one. */
  name?: string;
  exit?: number;
}

export interface RouteLeg {
  distanceM: number;
  durationSeconds: number;
  durationInTrafficSeconds: number;
  steps: RouteStep[];
}

export interface RouteResult {
  /** Stable id for this alternative within the response. */
  id: string;
  distanceM: number;
  /** Free-flow duration. */
  durationSeconds: number;
  /** Duration accounting for live and typical traffic. */
  durationInTrafficSeconds: number;
  /** durationInTraffic − duration; how much congestion is costing on this route. */
  trafficDelaySeconds: number;
  /** Encoded polyline, precision 6. */
  geometry: string;
  legs: RouteLeg[];
  /** Per-geometry-segment congestion, when the provider returns it. */
  congestion?: string[];
  weightName?: string;
  isPrimary: boolean;
}

export interface RoutesResponse {
  requestId: string;
  routes: RouteResult[];
  origin: LatLng;
  destination: LatLng;
  /** Present when Mapbox could not route and a reason was given. */
  notice?: string;
}

/**
 * Mapbox integration — Master Plan §12.
 *
 * Every call is made server-side with the SECRET token. The mobile app never
 * holds a token that can spend money on Directions: it gets only the restricted
 * public token, and only for rendering tiles.
 *
 * Responses are cached in Redis. Directions and Geocoding are billed per request,
 * and repeated identical lookups (a user retyping a search, an app retrying a
 * route) would otherwise be paid for twice. Traffic-aware routes get a short TTL
 * so a cached ETA never goes stale enough to mislead a driver.
 */
@Injectable()
export class MapboxService {
  private readonly logger = new Logger(MapboxService.name);
  private static readonly GEOCODE_CACHE_TTL = 3600;
  private static readonly ROUTE_CACHE_TTL = 60;

  constructor(
    private readonly env: EnvService,
    private readonly redis: RedisService,
  ) {}

  get isConfigured(): boolean {
    return this.env.hasMapbox;
  }

  private get token(): string {
    const token = this.env.get('MAPBOX_SECRET_TOKEN');
    if (!token) {
      throw AppError.notConfigured('Mapbox search and routing', 'MAPBOX_SECRET_TOKEN');
    }
    return token;
  }

  /**
   * Forward geocoding, biased to Iraq.
   *
   * `proximity` biases results toward the user so "شارع فلسطين" resolves to the
   * one they are near, and the bounding box keeps results inside the country.
   */
  async search(params: {
    query: string;
    proximity?: LatLng;
    limit?: number;
    language?: string;
  }): Promise<GeocodeResult[]> {
    const limit = Math.min(params.limit ?? 8, 10);
    const language = params.language ?? 'ar';
    const cacheKey = `mapbox:geo:${language}:${limit}:${params.query.toLowerCase()}:${
      params.proximity ? `${params.proximity.lat.toFixed(2)},${params.proximity.lng.toFixed(2)}` : 'none'
    }`;

    const cached = await this.redis.getJson<GeocodeResult[]>(cacheKey);
    if (cached) return cached;

    const url = new URL(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(params.query)}.json`,
    );
    url.searchParams.set('access_token', this.token);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('language', language);
    url.searchParams.set('country', 'iq');
    url.searchParams.set('bbox', IRAQ_BBOX.join(','));
    if (params.proximity) {
      url.searchParams.set('proximity', `${params.proximity.lng},${params.proximity.lat}`);
    }

    const data = await this.fetchJson<{
      features: Array<{
        id: string;
        text: string;
        place_name: string;
        center: [number, number];
        place_type: string[];
        properties?: { distance?: number };
      }>;
    }>(url, 'geocoding');

    const results: GeocodeResult[] = (data.features ?? []).map((f) => ({
      id: f.id,
      name: f.text,
      fullAddress: f.place_name,
      center: { lng: f.center[0], lat: f.center[1] },
      placeType: f.place_type ?? [],
      distanceM: f.properties?.distance,
    }));

    await this.redis.setJson(cacheKey, results, MapboxService.GEOCODE_CACHE_TTL);
    return results;
  }

  /** Reverse geocoding — used to label a property pin when the seller drops it. */
  async reverseGeocode(point: LatLng, language = 'ar'): Promise<GeocodeResult | null> {
    const cacheKey = `mapbox:rev:${language}:${point.lat.toFixed(5)},${point.lng.toFixed(5)}`;
    const cached = await this.redis.getJson<GeocodeResult | null>(cacheKey);
    if (cached !== null) return cached;

    const url = new URL(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${point.lng},${point.lat}.json`,
    );
    url.searchParams.set('access_token', this.token);
    url.searchParams.set('language', language);
    url.searchParams.set('limit', '1');

    const data = await this.fetchJson<{
      features: Array<{ id: string; text: string; place_name: string; center: [number, number]; place_type: string[] }>;
    }>(url, 'reverse geocoding');

    const first = data.features?.[0];
    const result: GeocodeResult | null = first
      ? {
          id: first.id,
          name: first.text,
          fullAddress: first.place_name,
          center: { lng: first.center[0], lat: first.center[1] },
          placeType: first.place_type ?? [],
        }
      : null;

    await this.redis.setJson(cacheKey, result, MapboxService.GEOCODE_CACHE_TTL);
    return result;
  }

  /**
   * Traffic-aware routing.
   *
   * Uses the `driving-traffic` profile, which Mapbox backs with live and typical
   * traffic in Iraq. `annotations=duration,congestion` is what lets RIVO show the
   * delay and paint the congested portion of the line, rather than only an ETA.
   */
  async route(params: {
    origin: LatLng;
    destination: LatLng;
    waypoints?: LatLng[];
    alternatives?: boolean;
    language?: string;
    /** Bearing of travel, so a reroute does not suggest an immediate U-turn. */
    originBearing?: number;
    avoid?: Array<'toll' | 'motorway' | 'ferry'>;
  }): Promise<RoutesResponse> {
    const language = params.language ?? 'ar';
    const coords = [params.origin, ...(params.waypoints ?? []), params.destination];
    const path = coords.map((c) => `${c.lng.toFixed(6)},${c.lat.toFixed(6)}`).join(';');

    const cacheKey = `mapbox:route:${language}:${path}:${params.alternatives ? 'alt' : 'single'}:${(params.avoid ?? []).join(',')}`;
    const cached = await this.redis.getJson<RoutesResponse>(cacheKey);
    if (cached) return { ...cached, requestId: newRequestId() };

    const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${path}`);
    url.searchParams.set('access_token', this.token);
    url.searchParams.set('alternatives', params.alternatives === false ? 'false' : 'true');
    url.searchParams.set('geometries', 'polyline6');
    url.searchParams.set('overview', 'full');
    url.searchParams.set('steps', 'true');
    url.searchParams.set('language', language);
    url.searchParams.set('annotations', 'duration,distance,congestion,speed');
    url.searchParams.set('banner_instructions', 'true');
    url.searchParams.set('voice_instructions', 'true');
    url.searchParams.set('voice_units', 'metric');
    if (params.avoid?.length) url.searchParams.set('exclude', params.avoid.join(','));
    if (typeof params.originBearing === 'number') {
      // 45° tolerance: wide enough to survive GPS jitter, narrow enough to keep
      // the route pointing the way the car is actually facing.
      const bearings = coords.map((_, i) => (i === 0 ? `${Math.round(params.originBearing as number)},45` : ''));
      url.searchParams.set('bearings', bearings.join(';'));
    }

    const data = await this.fetchJson<{
      code: string;
      message?: string;
      routes: Array<{
        distance: number;
        duration: number;
        duration_typical?: number;
        weight_name?: string;
        geometry: string;
        legs: Array<{
          distance: number;
          duration: number;
          duration_typical?: number;
          annotation?: { congestion?: string[] };
          steps: Array<{
            distance: number;
            duration: number;
            name?: string;
            maneuver: { type: string; modifier?: string; instruction: string; location: [number, number]; exit?: number };
          }>;
        }>;
      }>;
    }>(url, 'directions');

    if (data.code !== 'Ok' || !data.routes?.length) {
      throw AppError.unprocessable({
        code: 'NO_ROUTE' as never,
        message: data.message ?? 'No route could be found between these points',
        messageAr: 'تعذّر إيجاد مسار بين النقطتين المحددتين.',
        details: { providerCode: data.code },
      });
    }

    const routes: RouteResult[] = data.routes.slice(0, ROUTE_MAX_ALTERNATIVES + 1).map((r, index) => {
      // `duration` on driving-traffic already includes live traffic;
      // `duration_typical` is the historical baseline. The difference is the
      // delay attributable to current conditions.
      const inTraffic = Math.round(r.duration);
      const typical = Math.round(r.duration_typical ?? r.duration);
      return {
        id: `${index}`,
        distanceM: Math.round(r.distance),
        durationSeconds: typical,
        durationInTrafficSeconds: inTraffic,
        trafficDelaySeconds: Math.max(0, inTraffic - typical),
        geometry: r.geometry,
        weightName: r.weight_name,
        isPrimary: index === 0,
        congestion: r.legs?.[0]?.annotation?.congestion,
        legs: (r.legs ?? []).map((leg) => ({
          distanceM: Math.round(leg.distance),
          durationSeconds: Math.round(leg.duration_typical ?? leg.duration),
          durationInTrafficSeconds: Math.round(leg.duration),
          steps: (leg.steps ?? []).map((s) => ({
            instruction: s.maneuver.instruction,
            distanceM: Math.round(s.distance),
            durationSeconds: Math.round(s.duration),
            maneuverType: s.maneuver.type,
            maneuverModifier: s.maneuver.modifier,
            location: { lng: s.maneuver.location[0], lat: s.maneuver.location[1] },
            name: s.name,
            exit: s.maneuver.exit,
          })),
        })),
      };
    });

    const response: RoutesResponse = {
      requestId: newRequestId(),
      routes,
      origin: params.origin,
      destination: params.destination,
    };

    await this.redis.setJson(cacheKey, response, MapboxService.ROUTE_CACHE_TTL);
    return response;
  }

  private async fetchJson<T>(url: URL, operation: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        // The token is in the query string, so the URL is never logged.
        this.logger.error(`Mapbox ${operation} failed: HTTP ${response.status} ${body.slice(0, 200)}`);
        if (response.status === 401 || response.status === 403) {
          throw AppError.notConfigured('Mapbox (token rejected)', 'MAPBOX_SECRET_TOKEN');
        }
        if (response.status === 429) {
          throw AppError.tooManyRequests({
            message: 'Mapbox rate limit reached. Try again shortly.',
            messageAr: 'الخدمة مزدحمة حالياً. يرجى المحاولة بعد قليل.',
          });
        }
        throw AppError.badGateway({ message: `Mapbox ${operation} returned HTTP ${response.status}` });
      }
      return (await response.json()) as T;
    } catch (err) {
      if (err instanceof AppError) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`Mapbox ${operation} error: ${reason}`);
      throw AppError.badGateway({
        message: `Mapbox ${operation} is unreachable`,
        messageAr: 'تعذّر الاتصال بخدمة الخرائط. يرجى المحاولة لاحقاً.',
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function newRequestId(): string {
  return `rt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
