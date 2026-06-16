import axios from 'axios';
import { logger } from '../middleware/logger';
import { GeocodeResult } from '../middleware/validate';

const PHOTON_BASE = process.env.PHOTON_URL || 'https://photon.komoot.io';

export async function geocode(query: string, limit: number = 5): Promise<GeocodeResult[]> {
  logger.info({ query, limit }, 'geocoding query');

  const response = await axios.get(`${PHOTON_BASE}/api/`, {
    params: { q: query, limit },
    timeout: 8000,
    headers: { 'Accept-Language': 'en' },
  });

  const features = response.data?.features ?? [];

  const results: GeocodeResult[] = features.map((f: any) => {
    const props = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    const parts = [props.name, props.city, props.state, props.country].filter(Boolean);
    return {
      display_name: parts.join(', '),
      lat: parseFloat(lat),
      lon: parseFloat(lon),
      type: props.type || 'place',
    };
  });

  logger.info({ count: results.length }, 'geocode results');
  return results;
}
