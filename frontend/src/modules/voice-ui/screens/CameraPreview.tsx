import { FaceLandmarker } from '@mediapipe/tasks-vision';
import { useEffect, useRef, useState } from 'react';
import type { FaceFrame } from '../../../contracts';
import type { Services } from '../../../app/services';
import { faceCrop, fullCrop, lerpCrop, type Crop } from '../../../core/face/framing';

interface Readout {
  face: boolean;
  blink: number;
  gazeY: number;
  asymmetry: number;
  emotion: string;
  region: string;
  calibrated: boolean;
}

const NO_FACE_AFTER_MS = 500;
const SIZES = { small: { w: 160, h: 120 }, large: { w: 480, h: 360 } } as const;
/** How quickly the zoom follows the face (0..1 per frame): smooth, not jumpy. */
const FOLLOW = 0.12;

type Connection = { start: number; end: number };
const EYES: Connection[] = [
  ...(FaceLandmarker.FACE_LANDMARKS_LEFT_EYE ?? []),
  ...(FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE ?? []),
];
const IRISES: Connection[] = [
  ...(FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS ?? []),
  ...(FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS ?? []),
];

const REGION_LABEL: Record<string, string> = {
  center: 'middle (resting)',
  'up-left': 'top-left',
  'up-right': 'top-right',
  'down-left': 'bottom-left',
  'down-right': 'bottom-right',
};

/**
 * Live camera view, ZOOMED to the face and following it, so the eyes are easy to see. Drawn like a
 * mirror. The eyes and irises are highlighted; the rest of the face mesh is faint. The landmark
 * overlay and mouth-asymmetry readout come from Srihith's face-tracking demo (face/face.html).
 * Video is only ever drawn on this canvas.
 */
export function CameraPreview({
  services,
  size = 'large',
}: {
  services: Services;
  size?: keyof typeof SIZES;
}) {
  const { w: W, h: H } = SIZES[size];
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef<FaceFrame | null>(null);
  const crop = useRef<Crop | null>(null);
  const [readout, setReadout] = useState<Readout>({
    face: false,
    blink: 0,
    gazeY: 0,
    asymmetry: 0,
    emotion: '–',
    region: '',
    calibrated: true,
  });

  useEffect(() => {
    const { faceTracker, emotion, eyeInput } = services;
    const unsubscribe = faceTracker.onFrame((f) => (latest.current = f));
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const ctx = canvas.current?.getContext('2d');
      const video = faceTracker.video;
      if (!ctx) return;
      const vw = video?.videoWidth ?? 0;
      const vh = video?.videoHeight ?? 0;
      if (!video || !vw) {
        ctx.fillStyle = '#161b22';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#9da7b3';
        ctx.font = '16px system-ui';
        ctx.fillText('Starting camera…', W / 2 - 60, H / 2);
        return;
      }

      // Zoom toward the face (or back out to the whole frame when none is visible).
      const frame = latest.current;
      const visible = !!frame && performance.now() - frame.t < NO_FACE_AFTER_MS;
      const target =
        visible && frame ? faceCrop(frame.landmarks, vw, vh, W / H) : fullCrop(vw, vh, W / H);
      crop.current = crop.current ? lerpCrop(crop.current, target, FOLLOW) : target;
      const c = crop.current;

      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1); // mirror, so it behaves like a mirror
      ctx.drawImage(video, c.x, c.y, c.w, c.h, 0, 0, W, H);
      ctx.restore();

      if (visible && frame) {
        // landmark (0..1 of the video) -> canvas pixel, through the crop and the mirror
        const px = (p: { x: number; y: number }) => ({
          x: W - ((p.x * vw - c.x) / c.w) * W,
          y: ((p.y * vh - c.y) / c.h) * H,
        });
        const L = frame.landmarks;
        ctx.fillStyle = 'rgba(63, 185, 80, 0.35)';
        for (const p of L) {
          const q = px(p);
          ctx.fillRect(q.x - 0.5, q.y - 0.5, 1.5, 1.5);
        }
        const lines = (connections: Connection[], color: string, width: number) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.beginPath();
          for (const { start, end } of connections) {
            if (!L[start] || !L[end]) continue;
            const a = px(L[start]);
            const b = px(L[end]);
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
          }
          ctx.stroke();
        };
        lines(EYES, '#58e6ff', 2); // eyes: bright, so you can see what is being tracked
        lines(IRISES, '#ffd33d', 2);
      }
    };
    draw();

    // Numbers change fast; update the text ~5 times a second instead of every frame.
    const timer = setInterval(() => {
      const f = latest.current;
      const face = !!f && performance.now() - f.t < NO_FACE_AFTER_MS;
      const guess = emotion.current();
      const eye = eyeInput.status?.();
      setReadout({
        face,
        blink:
          face && f
            ? ((f.blendshapes.eyeBlinkLeft ?? 0) + (f.blendshapes.eyeBlinkRight ?? 0)) / 2
            : 0,
        gazeY: face && f ? f.gaze.y : 0,
        asymmetry: face && f ? (f.metrics.mouthAsymmetry ?? 0) : 0,
        emotion:
          guess.confidence > 0
            ? `${guess.emotion} ${Math.round(guess.confidence * 100)}%`
            : 'not calibrated',
        region: eye?.region ? (REGION_LABEL[eye.region] ?? eye.region) : '',
        calibrated: eye?.calibrated ?? true,
      });
    }, 200);

    return () => {
      unsubscribe();
      cancelAnimationFrame(raf);
      clearInterval(timer);
    };
  }, [services, W, H]);

  return (
    <aside className={`camera camera-${size}`}>
      <canvas ref={canvas} width={W} height={H} />
      <div className="camera-chips">
        <span className={`chip-state ${readout.face ? 'listening' : 'error'}`}>
          {readout.face ? 'face found' : 'NO FACE'}
        </span>
        {readout.region && <span className="chip-state">looking: {readout.region}</span>}
        {!readout.calibrated && <span className="chip-state error">not calibrated</span>}
      </div>
      {size === 'large' && (
        <dl className="readout">
          <dt>Eyes closed</dt>
          <dd>
            <meter min={0} max={1} value={readout.blink} /> {readout.blink.toFixed(2)}
          </dd>
          <dt>Gaze up/down</dt>
          <dd>{readout.gazeY.toFixed(2)}</dd>
          <dt>Mouth asym.</dt>
          <dd>{readout.asymmetry.toFixed(3)}</dd>
          <dt>Emotion</dt>
          <dd>{readout.emotion}</dd>
        </dl>
      )}
    </aside>
  );
}
