import { z } from 'zod';

export const RouteRequestSchema = z.object({
  start: z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]),
  end: z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]),
});

export const GeocodeQuerySchema = z.object({
  q: z.string().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

export type RouteRequest = z.infer<typeof RouteRequestSchema>;

export interface ManeuverType {
  type: string;
  modifier?: string;
  bearing_after?: number;
}

export interface RouteStep {
  instruction: string;
  distance: number;
  duration: number;
  maneuver: ManeuverType;
  maneuver_location: [number, number];
  name: string;
}

export interface RouteResponse {
  geometry: [number, number][];
  steps: RouteStep[];
  distance: number;
  duration: number;
  duration_optimistic: number;
  duration_pessimistic: number;
}

export interface GeocodeResult {
  display_name: string;
  lat: number;
  lon: number;
  type: string;
}
