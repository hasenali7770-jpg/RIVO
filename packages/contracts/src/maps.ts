import { z } from 'zod';
import { INCIDENT_TYPES } from '@rivo/config';
import { latLngSchema } from './common';

export const placeSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  lat: z.number(),
  lng: z.number(),
  placeType: z.array(z.string()),
  distanceM: z.number().nullable(),
});
export type Place = z.infer<typeof placeSchema>;

export const routeStepSchema = z.object({
  instruction: z.string(),
  distanceM: z.number().int(),
  durationSeconds: z.number().int(),
  maneuverType: z.string(),
  maneuverModifier: z.string().optional(),
  location: latLngSchema,
  name: z.string().optional(),
  exit: z.number().int().optional(),
});

export const routeSchema = z.object({
  id: z.string(),
  distanceM: z.number().int(),
  /** Free-flow duration, from the provider's historical baseline. */
  durationSeconds: z.number().int(),
  /** Duration accounting for current traffic. This is the ETA to show. */
  durationInTrafficSeconds: z.number().int(),
  /** How much congestion is costing on this route, in seconds. */
  trafficDelaySeconds: z.number().int(),
  /** Encoded polyline, precision 6. */
  geometry: z.string(),
  legs: z.array(
    z.object({
      distanceM: z.number().int(),
      durationSeconds: z.number().int(),
      durationInTrafficSeconds: z.number().int(),
      steps: z.array(routeStepSchema),
    }),
  ),
  /** Per-segment congestion classes, for painting the route line. */
  congestion: z.array(z.string()).optional(),
  weightName: z.string().optional(),
  isPrimary: z.boolean(),
});
export type Route = z.infer<typeof routeSchema>;

export const routesResponseSchema = z.object({
  requestId: z.string(),
  routes: z.array(routeSchema),
  origin: latLngSchema,
  destination: latLngSchema,
  notice: z.string().optional(),
  /** RIVO incidents lying on each route line. */
  incidentsOnRoute: z.array(
    z.object({
      routeId: z.string(),
      incidents: z.array(
        z.object({
          id: z.string().uuid(),
          type: z.enum(INCIDENT_TYPES),
          lat: z.number(),
          lng: z.number(),
          distanceFromRouteM: z.number().int(),
          note: z.string().nullable(),
        }),
      ),
    }),
  ),
  /** Set when routing was requested by propertyId (the `اذهب إلى العقار` action). */
  destinationProperty: z
    .object({ id: z.string().uuid(), reference: z.string(), title: z.string() })
    .nullable()
    .optional(),
});
export type RoutesResponse = z.infer<typeof routesResponseSchema>;

export const incidentSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(INCIDENT_TYPES),
  lat: z.number(),
  lng: z.number(),
  headingDeg: z.number().int().nullable(),
  note: z.string().nullable(),
  score: z.number().int(),
  confirmCount: z.number().int(),
  dismissCount: z.number().int(),
  /** 0–1. Drives how prominently the client should render the report. */
  confidence: z.number(),
  expiresAt: z.string(),
  reportedAt: z.string(),
  distanceM: z.number().nullable(),
  // The reporter is deliberately absent: reports are never attributed publicly.
});
export type Incident = z.infer<typeof incidentSchema>;

export const incidentsResponseSchema = z.object({ incidents: z.array(incidentSchema) });

export const segmentSpeedsSchema = z.object({
  segments: z.array(
    z.object({
      segmentKey: z.string(),
      avgSpeedKph: z.number(),
      freeFlowKph: z.number().nullable(),
      /** avg / free-flow. Below ~0.5 is heavy congestion. */
      congestionRatio: z.number().nullable(),
      sampleCount: z.number().int(),
      source: z.enum(['live', 'typical']),
    }),
  ),
  note: z.string(),
});
export type SegmentSpeeds = z.infer<typeof segmentSpeedsSchema>;

export const propertyDestinationSchema = z.object({
  propertyId: z.string().uuid(),
  reference: z.string(),
  title: z.string(),
  lat: z.number(),
  lng: z.number(),
  precision: z.enum(['EXACT', 'APPROXIMATE']),
  placeLabel: z.string().nullable(),
  governorate: z.string(),
  district: z.string().nullable(),
});
export type PropertyDestination = z.infer<typeof propertyDestinationSchema>;
