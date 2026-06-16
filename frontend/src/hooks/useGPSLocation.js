import { useState, useRef, useCallback, useEffect } from 'react';

const ACCURACY_THRESHOLD_M = 50;
const MIN_MOVEMENT_M = 3;
const KALMAN_Q = 3;
const KALMAN_R = 10;

function haversine(a, b) {
  const R = 6371000;
  const φ1 = (a[0] * Math.PI) / 180;
  const φ2 = (b[0] * Math.PI) / 180;
  const Δφ = ((b[0] - a[0]) * Math.PI) / 180;
  const Δλ = ((b[1] - a[1]) * Math.PI) / 180;
  const s = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

class KalmanFilter1D {
  constructor(q, r) {
    this.q = q;
    this.r = r;
    this.p = 1;
    this.x = null;
  }
  update(measurement) {
    if (this.x === null) {
      this.x = measurement;
      return measurement;
    }
    this.p += this.q;
    const k = this.p / (this.p + this.r);
    this.x += k * (measurement - this.x);
    this.p *= (1 - k);
    return this.x;
  }
}

export function useGPSLocation() {
  const [location, setLocation] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const [speedKmh, setSpeedKmh] = useState(0);
  const [heading, setHeading] = useState(null);
  const lastAcceptedRef = useRef(null);
  const rawLocationRef = useRef(null);
  const kalmanLat = useRef(new KalmanFilter1D(KALMAN_Q, KALMAN_R));
  const kalmanLon = useRef(new KalmanFilter1D(KALMAN_Q, KALMAN_R));

  const handlePosition = useCallback((pos) => {
    const { latitude, longitude, accuracy: acc, speed, heading: hdg } = pos.coords;

    rawLocationRef.current = [latitude, longitude];

    const isFirstFix = lastAcceptedRef.current === null;

    if (!isFirstFix && acc > ACCURACY_THRESHOLD_M) return;

    const smoothLat = kalmanLat.current.update(latitude);
    const smoothLon = kalmanLon.current.update(longitude);
    const smoothed = [smoothLat, smoothLon];

    const speedMs = speed ?? 0;
    const kmh = speedMs * 3.6;

    if (!isFirstFix && lastAcceptedRef.current) {
      const dist = haversine(lastAcceptedRef.current, smoothed);
      const isStationary = kmh < 1.5 && acc > 10;
      if (isStationary && dist < MIN_MOVEMENT_M) return;
    }

    lastAcceptedRef.current = smoothed;
    setLocation(smoothed);
    setAccuracy(acc);
    setSpeedKmh(kmh);
    if (hdg !== null && hdg !== undefined && !isNaN(hdg) && kmh > 2) {
      setHeading(hdg);
    }
  }, []);

  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    const watchId = navigator.geolocation.watchPosition(
      handlePosition,
      (err) => console.error('GPS error:', err),
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000,
      }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [handlePosition]);

  return { location, accuracy, speedKmh, heading, rawLocationRef };
}
