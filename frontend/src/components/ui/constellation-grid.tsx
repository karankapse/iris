import { useEffect, useRef } from 'react';
import { cn } from '../../core/utils';

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseX: number;
  baseY: number;
  radius: number;
  label: string;
  pulse: number;
}

const SPACING = 55; // grid gap in px
const NODE_RGB = '255, 255, 255';
const ACCENT_RGB = '88, 227, 220'; // the app's primary cyan, oklch(0.84 0.12 190)
const SPRING_K = 18; // pull back to the home point
const DAMPING = 0.82;
const MAX_CONN_DIST = 75;

/**
 * An animated dot grid for the page background: dots spring away from the pointer (harder the
 * faster it moves) and link up with nearby dots. Fixed behind the page, so give the parent
 * `isolation: isolate` and it sits above the parent's background but under its content.
 * People who ask for reduced motion get a still grid.
 */
export function ConstellationGrid({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let frameId = 0;
    let width = 0;
    let height = 0;
    let rows = 0;
    let nodes: Node[] = [];
    const pointer = { x: -1000, y: -1000, prevX: -1000, prevY: -1000, radius: 220 };

    const initNodes = () => {
      nodes = [];
      const cols = Math.ceil(width / SPACING) + 1;
      rows = Math.ceil(height / SPACING) + 1;
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = i * SPACING;
          const y = j * SPACING;
          nodes.push({
            x,
            y,
            vx: 0,
            vy: 0,
            baseX: x,
            baseY: y,
            radius: Math.random() * 1.2 + 1.2,
            label: `${(i * 7).toString(16).toUpperCase()}:${(j * 11).toString(16).toUpperCase()}`,
            pulse: Math.random() * Math.PI * 2,
          });
        }
      }
    };

    const step = (dt: number) => {
      const speed =
        Math.hypot(pointer.x - pointer.prevX, pointer.y - pointer.prevY) / (dt * 1000 || 1);
      pointer.prevX = pointer.x;
      pointer.prevY = pointer.y;

      for (const n of nodes) {
        n.pulse += dt * 3;
        const dx = pointer.x - n.x;
        const dy = pointer.y - n.y;
        const dist = Math.hypot(dx, dy);
        // a shockwave: pushed away from the pointer, harder the faster it moves
        if (dist < pointer.radius && dist > 0) {
          const force = (1 - dist / pointer.radius) * (1500 + speed * 150);
          n.vx -= (dx / dist) * force * dt;
          n.vy -= (dy / dist) * force * dt;
        }
        // a spring back home, with damping
        n.vx = (n.vx + (n.baseX - n.x) * SPRING_K * dt) * DAMPING;
        n.vy = (n.vy + (n.baseY - n.y) * SPRING_K * dt) * DAMPING;
        n.x += n.vx * dt * 60;
        n.y += n.vy * dt * 60;
      }
    };

    const link = (n: Node, n2: Node | undefined) => {
      if (!n2) return;
      const d = Math.hypot(n.x - n2.x, n.y - n2.y);
      if (d >= MAX_CONN_DIST) return;
      ctx.strokeStyle = `rgba(${NODE_RGB}, ${(1 - d / MAX_CONN_DIST) * 0.18})`;
      ctx.beginPath();
      ctx.moveTo(n.x, n.y);
      ctx.lineTo(n2.x, n2.y);
      ctx.stroke();
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      // Links: dots only ever get near their grid neighbours, so check those (not every pair).
      ctx.lineWidth = 0.7;
      for (let k = 0; k < nodes.length; k++) {
        const j = k % rows;
        if (j + 1 < rows) link(nodes[k], nodes[k + 1]);
        if (j + 2 < rows) link(nodes[k], nodes[k + 2]);
        for (let di = 1; di <= 2; di++) {
          for (let dj = -2; dj <= 2; dj++) {
            if (j + dj >= 0 && j + dj < rows) link(nodes[k], nodes[k + di * rows + dj]);
          }
        }
      }

      for (const n of nodes) {
        const dist = Math.hypot(pointer.x - n.x, pointer.y - n.y);
        const near = dist < pointer.radius;
        const alpha = near ? 0.95 : 0.25 + Math.sin(n.pulse) * 0.1;
        ctx.fillStyle = `rgba(${near ? ACCENT_RGB : NODE_RGB}, ${alpha})`;
        ctx.beginPath();
        const r = near ? n.radius * 2.2 : n.radius + Math.sin(n.pulse) * 0.3;
        ctx.arc(n.x, n.y, Math.max(0.5, r), 0, Math.PI * 2);
        ctx.fill();

        // radar rings and a coordinate readout right under the pointer
        if (dist < 90) {
          const ring = ((n.pulse * 20) % 30) + 4;
          ctx.strokeStyle = `rgba(${ACCENT_RGB}, ${(1 - ring / 34) * 0.4})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(n.x, n.y, ring, 0, Math.PI * 2);
          ctx.stroke();
          ctx.lineWidth = 0.7;
          ctx.font = '8px ui-monospace, SFMono-Regular, Consolas, monospace';
          ctx.fillStyle = `rgba(${ACCENT_RGB}, 0.85)`;
          ctx.fillText(n.label, n.x + 10, n.y - 10);
        }
      }
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initNodes();
      if (still) draw();
    };

    const onPointer = (e: PointerEvent) => {
      // coming back in: start from here, not from off-screen (no giant first shockwave)
      if (pointer.x < -500) {
        pointer.prevX = e.clientX;
        pointer.prevY = e.clientY;
      }
      pointer.x = e.clientX;
      pointer.y = e.clientY;
    };
    const onAway = () => {
      pointer.x = pointer.y = pointer.prevX = pointer.prevY = -1000;
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') onAway(); // a lifted finger isn't hovering anywhere
    };

    resize();
    window.addEventListener('resize', resize);
    if (still) return () => window.removeEventListener('resize', resize);

    window.addEventListener('pointermove', onPointer);
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onAway);
    window.addEventListener('blur', onAway);
    document.documentElement.addEventListener('pointerleave', onAway);

    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05); // same speed on 60 Hz and 120 Hz screens
      last = now;
      step(dt);
      draw();
      frameId = requestAnimationFrame(frame);
    };
    frameId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onAway);
      window.removeEventListener('blur', onAway);
      document.documentElement.removeEventListener('pointerleave', onAway);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn('pointer-events-none fixed inset-0 -z-10 block h-full w-full', className)}
    />
  );
}
