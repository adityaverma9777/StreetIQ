import axios from 'axios';
import { logger } from '../middleware/logger';
import { RouteResponse, RouteStep } from '../middleware/validate';

const OSRM_BASE = process.env.OSRM_URL || 'https://router.project-osrm.org';
const INDIA_TRAFFIC_FACTOR = 1.8;
const INDIA_TRAFFIC_FACTOR_HEAVY = 2.4;

function bearingToCompass(bearing: number): string {
  const dirs = ['north','northeast','east','southeast','south','southwest','west','northwest'];
  return dirs[Math.round(((bearing % 360) + 360) % 360 / 45) % 8];
}

function buildInstruction(step: any): string {
  const maneuver = step.maneuver;
  const name = step.name ? `onto ${step.name}` : '';
  const type = maneuver.type;
  const modifier = maneuver.modifier;

  if (type === 'depart') {
    const dir = maneuver.bearing_after !== undefined ? bearingToCompass(maneuver.bearing_after) : (modifier || 'forward');
    return `Head ${dir}${step.name ? ` on ${step.name}` : ''}`;
  }
  if (type === 'arrive') return 'You have arrived at your destination';
  if (type === 'turn') return `Turn ${modifier} ${name}`;
  if (type === 'new name') return `Continue ${modifier || 'straight'} ${name}`;
  if (type === 'continue') return `Continue straight ${name}`;
  if (type === 'merge') return `Merge ${modifier} ${name}`;
  if (type === 'on ramp') return `Take the ramp ${modifier} ${name}`;
  if (type === 'off ramp') return `Take exit ${modifier} ${name}`;
  if (type === 'fork') return `Keep ${modifier} at the fork ${name}`;
  if (type === 'end of road') return `Turn ${modifier} at end of road ${name}`;
  if (type === 'use lane') return `Use the ${modifier} lane ${name}`;
  if (type === 'roundabout' || type === 'rotary') {
    const exit = maneuver.exit ? `exit ${maneuver.exit} ` : '';
    return `At the roundabout, take ${exit}${name}`;
  }
  return `Continue ${name}`;
}

export async function getRoute(
  start: [number, number],
  end: [number, number]
): Promise<RouteResponse> {
  const [startLat, startLng] = start;
  const [endLat, endLng] = end;

  const url = `${OSRM_BASE}/route/v1/driving/${startLng},${startLat};${endLng},${endLat}`;
  const params = {
    overview: 'full',
    geometries: 'geojson',
    steps: 'true',
    annotations: 'false',
  };

  logger.info({ url, params }, 'querying OSRM');

  const response = await axios.get(url, { params, timeout: 15000 });
  const data = response.data;

  if (data.code !== 'Ok' || !data.routes?.length) {
    throw new Error('No route found between these points');
  }

  const route = data.routes[0];
  const geometry: [number, number][] = route.geometry.coordinates.map(
    ([lng, lat]: [number, number]) => [lat, lng]
  );

  const steps: RouteStep[] = [];
  for (const leg of route.legs) {
    for (const step of leg.steps) {
      const loc = step.maneuver.location;
      const adjustedDuration = Math.round(step.duration * INDIA_TRAFFIC_FACTOR);
      steps.push({
        instruction: buildInstruction(step),
        distance: Math.round(step.distance),
        duration: adjustedDuration,
        maneuver: {
          type: step.maneuver.type,
          modifier: step.maneuver.modifier,
          bearing_after: step.maneuver.bearing_after,
        },
        maneuver_location: [loc[1], loc[0]] as [number, number],
        name: step.name || '',
      });
    }
  }

  logger.info({ points: geometry.length, steps: steps.length, distance: route.distance }, 'route computed');

  const rawDuration = route.duration;
  return {
    geometry,
    steps,
    distance: Math.round(route.distance),
    duration: Math.round(rawDuration * INDIA_TRAFFIC_FACTOR),
    duration_optimistic: Math.round(rawDuration * 1.3),
    duration_pessimistic: Math.round(rawDuration * INDIA_TRAFFIC_FACTOR_HEAVY),
  };
}
