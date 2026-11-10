import { useState, useRef, useCallback, useEffect } from 'react';

const OSRM_BASE = 'https://router.project-osrm.org';
const INDIA_TRAFFIC_FACTOR = 1.8;
const INDIA_TRAFFIC_FACTOR_HEAVY = 2.4;

function haversine(a, b) {
  const R = 6371000;
  const φ1 = (a[0] * Math.PI) / 180;
  const φ2 = (b[0] * Math.PI) / 180;
  const Δφ = ((b[0] - a[0]) * Math.PI) / 180;
  const Δλ = ((b[1] - a[1]) * Math.PI) / 180;
  const s = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function getManeuverIcon(maneuver) {
  if (!maneuver) return '↑';
  const { type, modifier } = maneuver;
  if (type === 'arrive') return '🏁';
  if (type === 'depart') return '🚀';
  if (type === 'roundabout' || type === 'rotary') return '🔄';
  if (type === 'fork') return modifier?.includes('left') ? '↙' : '↘';
  if (type === 'merge') return '⬆';
  if (!modifier) return '↑';
  if (modifier === 'sharp left') return '↰';
  if (modifier === 'left') return '←';
  if (modifier === 'slight left') return '↖';
  if (modifier === 'straight') return '↑';
  if (modifier === 'slight right') return '↗';
  if (modifier === 'right') return '→';
  if (modifier === 'sharp right') return '↱';
  if (modifier === 'uturn') return '↩';
  return '↑';
}

function bearingToCompass(bearing) {
  const dirs = ['north','northeast','east','southeast','south','southwest','west','northwest'];
  return dirs[Math.round(((bearing % 360) + 360) % 360 / 45) % 8];
}

function buildInstruction(step) {
  const { maneuver, name } = step;
  const roadName = name ? `onto ${name}` : '';
  const { type, modifier } = maneuver;
  if (type === 'depart') return `Head ${maneuver.bearing_after !== undefined ? bearingToCompass(maneuver.bearing_after) : (modifier || 'forward')}${name ? ` on ${name}` : ''}`;
  if (type === 'arrive') return 'You have arrived at your destination';
  if (type === 'turn') return `Turn ${modifier} ${roadName}`;
  if (type === 'new name') return `Continue ${modifier || 'straight'} ${roadName}`;
  if (type === 'continue') return `Continue straight ${roadName}`;
  if (type === 'merge') return `Merge ${modifier} ${roadName}`;
  if (type === 'on ramp') return `Take the ramp ${modifier} ${roadName}`;
  if (type === 'off ramp') return `Take exit ${modifier} ${roadName}`;
  if (type === 'fork') return `Keep ${modifier} at the fork ${roadName}`;
  if (type === 'end of road') return `Turn ${modifier} at end of road ${roadName}`;
  if (type === 'roundabout' || type === 'rotary') return `At the roundabout, take ${maneuver.exit ? `exit ${maneuver.exit} ` : ''}${roadName}`;
  return `Continue ${roadName}`;
}

export function useNavigation(userLocation, speedKmh = 0) {
  const [route, setRoute] = useState(null);
  const [routeData, setRouteData] = useState(null);
  const [steps, setSteps] = useState([]);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [isNavigating, setIsNavigating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [distanceToNext, setDistanceToNext] = useState(null);
  const [remainingDistanceM, setRemainingDistanceM] = useState(null);
  const [eta, setEta] = useState(null);
  const [heading, setHeading] = useState(null);
  const stepsRef = useRef([]);
  const currentIdxRef = useRef(0);
  const compassWatchRef = useRef(null);
  const smoothedEtaRef = useRef(null);

  const fetchRoute = useCallback(async (start, end) => {
    setIsLoading(true);
    setError(null);
    try {
      const [startLat, startLng] = start;
      const [endLat, endLng] = end;
      const url = `${OSRM_BASE}/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson&steps=true`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No route found between these points');
      const osrmRoute = data.routes[0];
      const geometry = osrmRoute.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      const steps = [];
      for (const leg of osrmRoute.legs) {
        for (const step of leg.steps) {
          const loc = step.maneuver.location;
          steps.push({
            instruction: buildInstruction(step),
            distance: Math.round(step.distance),
            duration: Math.round(step.duration * INDIA_TRAFFIC_FACTOR),
            maneuver: { type: step.maneuver.type, modifier: step.maneuver.modifier, bearing_after: step.maneuver.bearing_after },
            maneuver_location: [loc[1], loc[0]],
            name: step.name || '',
          });
        }
      }
      const rawDuration = osrmRoute.duration;
      const routeResult = {
        geometry,
        steps,
        distance: Math.round(osrmRoute.distance),
        duration: Math.round(rawDuration * INDIA_TRAFFIC_FACTOR),
        duration_optimistic: Math.round(rawDuration * 1.3),
        duration_pessimistic: Math.round(rawDuration * INDIA_TRAFFIC_FACTOR_HEAVY),
      };
      setRoute(geometry);
      setSteps(steps);
      setRouteData(routeResult);
      stepsRef.current = steps;
      setEta(Math.round(routeResult.duration / 60));
      return routeResult;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const startNavigation = useCallback(() => {
    setCurrentStepIdx(0);
    currentIdxRef.current = 0;
    setIsNavigating(true);

    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission()
        .then(perm => {
          if (perm === 'granted') {
            const handler = (e) => {
              if (e.absolute && e.alpha !== null) setHeading(360 - e.alpha);
            };
            window.addEventListener('deviceorientationabsolute', handler, true);
            compassWatchRef.current = () => window.removeEventListener('deviceorientationabsolute', handler, true);
          }
        }).catch(() => {});
    } else if (typeof DeviceOrientationEvent !== 'undefined') {
      const handler = (e) => {
        if (e.alpha !== null) setHeading(360 - e.alpha);
      };
      window.addEventListener('deviceorientationabsolute', handler, true);
      compassWatchRef.current = () => window.removeEventListener('deviceorientationabsolute', handler, true);
    }
  }, []);

  const stopNavigation = useCallback(() => {
    setIsNavigating(false);
    setRoute(null);
    setRouteData(null);
    setSteps([]);
    stepsRef.current = [];
    setCurrentStepIdx(0);
    currentIdxRef.current = 0;
    setDistanceToNext(null);
    setRemainingDistanceM(null);
    setEta(null);
    setHeading(null);
    smoothedEtaRef.current = null;
    if (compassWatchRef.current) { compassWatchRef.current(); compassWatchRef.current = null; }
  }, []);

  useEffect(() => {
    if (!isNavigating || !userLocation) return;
    const steps = stepsRef.current;
    if (!steps.length) return;

    const idx = currentIdxRef.current;
    if (idx >= steps.length) { stopNavigation(); return; }

    const nextIdx = idx + 1;
    let distToNextManeuver = null;
    if (nextIdx < steps.length) {
      const nextStepLoc = steps[nextIdx].maneuver_location;
      if (nextStepLoc) {
        const dist = haversine(userLocation, nextStepLoc);
        distToNextManeuver = Math.round(dist);
        setDistanceToNext(distToNextManeuver);
        if (dist < STEP_ADVANCE_RADIUS_M) {
          currentIdxRef.current = idx + 1;
          setCurrentStepIdx(idx + 1);
        }
      }
    } else {
      const finalLoc = steps[idx].maneuver_location;
      if (finalLoc) {
        const dist = haversine(userLocation, finalLoc);
        distToNextManeuver = Math.round(dist);
        setDistanceToNext(distToNextManeuver);
        if (dist < STEP_ADVANCE_RADIUS_M) stopNavigation();
      }
    }

    const futureStepsDistance = steps
      .slice(currentIdxRef.current + 1)
      .reduce((sum, st) => sum + st.distance, 0);
    const remaining = (distToNextManeuver ?? 0) + futureStepsDistance;
    setRemainingDistanceM(remaining);

    if (speedKmh > 4) {
      const speedMs = speedKmh / 3.6;
      const rawEtaSec = remaining / speedMs;
      const prev = smoothedEtaRef.current;
      const smoothed = prev === null ? rawEtaSec : prev * 0.85 + rawEtaSec * 0.15;
      smoothedEtaRef.current = smoothed;
      setEta(Math.max(0, Math.round(smoothed / 60)));
    } else {
      const staticRemaining = steps.slice(currentIdxRef.current).reduce((s, st) => s + st.duration, 0);
      if (smoothedEtaRef.current === null) {
        setEta(Math.round(staticRemaining / 60));
      }
    }
  }, [userLocation, speedKmh, isNavigating, stopNavigation]);

  useEffect(() => {
    if (!isNavigating) return;
    const gpsBearing = (pos) => {
      if (pos.coords.heading !== null && pos.coords.heading !== undefined && !isNaN(pos.coords.heading)) {
        setHeading(pos.coords.heading);
      }
    };
    const watchId = navigator.geolocation?.watchPosition(gpsBearing, () => {}, { enableHighAccuracy: true });
    return () => { if (watchId) navigator.geolocation.clearWatch(watchId); };
  }, [isNavigating]);

  const currentStep = steps[currentStepIdx] || null;
  const maneuverIcon = getManeuverIcon(currentStep?.maneuver);

  return {
    route, routeData, steps, currentStep, currentStepIdx, maneuverIcon,
    isNavigating, isLoading, error, distanceToNext, remainingDistanceM, eta, heading,
    fetchRoute, startNavigation, stopNavigation,
  };
}
