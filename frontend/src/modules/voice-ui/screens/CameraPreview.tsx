import { useEffect, useRef, useState } from 'react';
import type { FaceFrame } from '../../../contracts';
import type { Services } from '../../../app/services';

interface Readout {
  face: boolean;
  blink: number;
  gazeY: number;
  asymmetry: number;
  emotion: string;
}

const NO_FACE_AFTER_MS = 500;
const W = 320;
const H = 240;

/**
 * Live camera view (mirrored, like a mirror) with the 478 face landmarks drawn on top, plus
 * the numbers the app is reading. The landmark overlay and the mouth-asymmetry readout come
 * from Srihith's face-tracking demo (face/face.html). Video is only drawn on this canvas.
 */
export function CameraPreview({ services }: { services: Services }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef<FaceFrame | null>(null);
  const [readout, setReadout] = useState<Readout>({
    face: false,
    blink: 0,
    gazeY: 0,
    asymmetry: 0,
    emotion: '–',
  });

  useEffect(() => {
    const { faceTracker, emotion } = services;
    const unsubscribe = faceTracker.onFrame((f) => (latest.current = f));
    let raf = 0;

    const draw = () => {
      const ctx = canvas.current?.getContext('2d');
      const video = faceTracker.video;
      const frame = latest.current;
      if (ctx && video && video.videoWidth) {
        ctx.save();
        ctx.translate(W, 0);
        ctx.scale(-1, 1); // mirror the picture so it behaves like a mirror
        ctx.drawImage(video, 0, 0, W, H);
        ctx.restore();
        if (frame && performance.now() - frame.t < NO_FACE_AFTER_MS) {
          ctx.fillStyle = '#3fb950';
          for (const p of frame.landmarks) ctx.fillRect((1 - p.x) * W - 1, p.y * H - 1, 2, 2);
        }
      } else if (ctx) {
        ctx.fillStyle = '#161b22';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#9da7b3';
        ctx.font = '16px system-ui';
        ctx.fillText('Starting camera…', 90, H / 2);
      }
      raf = requestAnimationFrame(draw);
    };
    draw();

    // Numbers change fast; update the text ~5 times a second instead of every frame.
    const timer = setInterval(() => {
      const f = latest.current;
      const face = !!f && performance.now() - f.t < NO_FACE_AFTER_MS;
      const guess = emotion.current();
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
      });
    }, 200);

    return () => {
      unsubscribe();
      cancelAnimationFrame(raf);
      clearInterval(timer);
    };
  }, [services]);

  const gazeArrow = readout.gazeY <= -0.2 ? '↑ up' : readout.gazeY >= 0.3 ? '↓ down' : '• middle';

  return (
    <aside className="camera">
      <canvas ref={canvas} width={W} height={H} />
      <dl className="readout">
        <dt>Face</dt>
        <dd className={readout.face ? 'ok' : 'bad'}>{readout.face ? 'found' : 'NOT FOUND'}</dd>
        <dt>Eyes closed</dt>
        <dd>
          <meter min={0} max={1} value={readout.blink} /> {readout.blink.toFixed(2)}
        </dd>
        <dt>Gaze</dt>
        <dd>
          {gazeArrow} ({readout.gazeY.toFixed(2)})
        </dd>
        <dt>Mouth asym.</dt>
        <dd>{readout.asymmetry.toFixed(3)}</dd>
        <dt>Emotion</dt>
        <dd>{readout.emotion}</dd>
      </dl>
    </aside>
  );
}
