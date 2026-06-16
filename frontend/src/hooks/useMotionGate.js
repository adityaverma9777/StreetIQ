import { useRef, useCallback } from 'react';

const SPEED_THRESHOLD_KMH = 2;
const IDLE_TIMEOUT_MS = 15000;

export function useMotionGate(onActive, onIdle) {
  const idleTimer = useRef(null);
  const isActive = useRef(false);

  const handlePosition = useCallback((pos) => {
    const speedMs = pos.coords.speed ?? 0;
    const speedKmh = speedMs * 3.6;

    if (speedKmh >= SPEED_THRESHOLD_KMH) {
      if (idleTimer.current) {
        clearTimeout(idleTimer.current);
        idleTimer.current = null;
      }
      if (!isActive.current) {
        isActive.current = true;
        onActive?.();
      }
    } else {
      if (!idleTimer.current) {
        idleTimer.current = setTimeout(() => {
          if (isActive.current) {
            isActive.current = false;
            onIdle?.();
          }
          idleTimer.current = null;
        }, IDLE_TIMEOUT_MS);
      }
    }
  }, [onActive, onIdle]);

  const cleanup = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
  }, []);

  return { handlePosition, cleanup };
}
