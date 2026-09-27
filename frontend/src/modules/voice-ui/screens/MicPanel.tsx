import { useEffect, useState } from 'react';
import type { SttStatus } from '../../../contracts';

const STATE_LABEL: Record<SttStatus['state'], string> = {
  off: 'off',
  connecting: 'connecting…',
  listening: 'listening',
  error: 'problem',
};

/**
 * Measures how loud the microphone is right now, using its OWN tap on the mic (independent of
 * the speech engine), so you can tell "the mic hears me" apart from "the speech engine is broken".
 * Nothing is recorded or sent anywhere: it only reads the current volume.
 */
function useMicLevel() {
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let raf = 0;

    navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        context.createMediaStreamSource(s).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        let last = 0;
        const tick = (now: number) => {
          raf = requestAnimationFrame(tick);
          if (now - last < 80) return; // ~12 updates a second is plenty
          last = now;
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (const v of samples) sum += v * v;
          const rms = Math.sqrt(sum / samples.length);
          setLevel(Math.min(1, rms * 8)); // speech is quiet in raw terms: scale it up for display
        };
        raf = requestAnimationFrame(tick);
      })
      .catch(() => setError('No microphone access'));

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void context?.close();
    };
  }, []);

  return { level, error };
}

export function MicPanel({ status }: { status: SttStatus }) {
  const { level, error } = useMicLevel();
  const ok = status.state === 'listening';
  return (
    <aside className="mic">
      <div className="mic-head">
        <strong>Microphone</strong>
        <span className={`chip-state ${status.state}`}>{STATE_LABEL[status.state]}</span>
        {status.engine && <span className="mic-engine">{status.engine}</span>}
      </div>
      <div className="mic-level">
        {error ? (
          <span className="bad">{error}: allow the microphone in Chrome and reload.</span>
        ) : (
          <>
            <meter min={0} max={1} value={level} />
            <span>{level > 0.08 ? 'hearing sound' : 'quiet: speak to test'}</span>
          </>
        )}
      </div>
      {status.detail && <p className={ok ? 'mic-note' : 'mic-note warn'}>{status.detail}</p>}
    </aside>
  );
}
