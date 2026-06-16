import { useState, useRef, useCallback, useEffect } from 'react';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const STEP_ADVANCE_RADIUS_M = 30;

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
  const { type, modifier, bearing_after } = maneuver;
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
      const res = await fetch(`${BACKEND_URL}/api/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start, end }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Routing failed');
      }
      const data = await res.json();
      setRoute(data.geometry);
      setSteps(data.steps);
      setRouteData(data);
      stepsRef.current = data.steps;
      setEta(Math.round(data.duration / 60));
      return data;
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
