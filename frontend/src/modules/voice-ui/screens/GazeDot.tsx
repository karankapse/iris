import { useEffect, useRef } from 'react';
import type { Services } from '../../../app/services';
import { FilteredGaze } from '../../../core/gaze/FilteredGaze';

/** Smoothing for the dot only, used when the gaze is NOT already filtered (0..1 per estimate). */
const FOLLOW = 0.35;
const HIDE_AFTER_MS = 600;

/**
 * A red dot that follows where the eyes are looking, in real time, so you can see exactly what
 * the tracker thinks. Purely visual: it does not affect what gets selected.
 */
export function GazeDot({ services }: { services: Services }) {
  const dot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!services.gaze) return;
    // FilteredGaze has already smoothed the points (One Euro): draw them as they are, no extra lag.
    const follow = services.gaze instanceof FilteredGaze ? 1 : FOLLOW;
    let x = 0;
    let y = 0;
    let seen = false;
    let lastAt = 0;
    const off = services.gaze.onGaze((p) => {
      const el = dot.current;
      if (!el || !p) return;
      x = seen ? x + follow * (p.x - x) : p.x;
      y = seen ? y + follow * (p.y - y) : p.y;
      seen = true;
      lastAt = performance.now();
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.style.opacity = '1';
    });
    const hider = setInterval(() => {
      if (dot.current && performance.now() - lastAt > HIDE_AFTER_MS)
        dot.current.style.opacity = '0';
    }, 300);
    return () => {
      off();
      clearInterval(hider);
    };
  }, [services]);

  return <div ref={dot} className="gaze-dot" aria-hidden="true" />;
}
