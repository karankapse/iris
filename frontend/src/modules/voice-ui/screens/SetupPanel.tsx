import { useEffect, useRef, useState } from 'react';
import { EMOTIONS } from '../../../contracts';
import type { CalibrationStep, Emotion, FaceFrame } from '../../../contracts';
import type { Orchestrator } from '../../../app/Orchestrator';
import type { Services } from '../../../app/services';

const GET_READY_S = 2;
const RECORD_S = 3;
const MIN_FRAMES = 10;

/**
 * Calibration, done once per person (ideally with a caregiver):
 *  1. Eyes: look straight / up / down and close the eyes, so thresholds fit this face.
 *  2. Emotions: record a few seconds of the person showing each emotion THEIR way (a small
 *     brow raise or a half-smile counts), then train their personal model.
 * Eye gestures are paused while this panel is open.
 */
export function SetupPanel({
  services,
  orchestrator,
  onClose,
}: {
  services: Services;
  orchestrator: Orchestrator;
  onClose: () => void;
}) {
  const { eyeInput, emotion, faceTracker, mocks } = services;
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [step, setStep] = useState<CalibrationStep | null>(null);
  const [countdown, setCountdown] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<Partial<Record<Emotion, number>>>({});
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    orchestrator.setSuspended(true);
    return () => {
      mounted.current = false;
      orchestrator.setSuspended(false);
    };
  }, [orchestrator]);

  async function run(name: string, job: () => Promise<string | void>) {
    setBusy(name);
    setMessage(null);
    try {
      const done = await job();
      if (mounted.current && done) setMessage({ text: done });
    } catch (e) {
      if (mounted.current)
        setMessage({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      if (mounted.current) {
        setBusy(null);
        setStep(null);
        setCountdown(null);
      }
    }
  }

  const calibrateEyes = () =>
    run('eyes', async () => {
      await eyeInput.calibrate((s) => setStep(s));
      return 'Eye calibration saved. The thresholds now fit this face.';
    });

  const recordEmotion = (label: Emotion) =>
    run(`record-${label}`, async () => {
      for (let s = GET_READY_S; s > 0; s--) {
        setCountdown(`Get ready to show "${label}"… ${s}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
      setCountdown(`Show "${label}" now! Hold it…`);
      const frames: FaceFrame[] = [];
      const stop = faceTracker.onFrame((f) => frames.push(f));
      await new Promise((r) => setTimeout(r, RECORD_S * 1000));
      stop();
      if (frames.length < MIN_FRAMES) {
        throw new Error(
          'The face was not visible during the recording. Check the camera and try again.',
        );
      }
      await emotion.recordSample(label, frames);
      setRecorded((r) => ({ ...r, [label]: (r[label] ?? 0) + Math.min(frames.length, 30) }));
      return `Recorded "${label}".`;
    });

  const train = () =>
    run('train', async () => {
      await emotion.train();
      return 'Trained! Your emotion model is now used to suggest tones.';
    });

  return (
    <div className="modal" role="dialog" aria-label="Set up">
      <div className="modal-card">
        <header>
          <h2>Set up</h2>
          <button onClick={onClose} disabled={busy !== null}>
            Done
          </button>
        </header>

        {message && <p className={message.error ? 'msg error' : 'msg'}>{message.text}</p>}

        <section>
          <h3>1. Eyes</h3>
          {mocks.eye ? (
            <p>Eye input is the keyboard mock (VITE_MOCK_EYE=1): nothing to calibrate.</p>
          ) : (
            <>
              <p>
                The person looks straight, up, down, then closes their eyes. Takes about 12 seconds.
              </p>
              <button onClick={calibrateEyes} disabled={busy !== null}>
                Calibrate eyes
              </button>
              {step && (
                <p className="prompt">
                  Step {step.index}/{step.total}: {step.prompt} ({step.seconds}s)
                </p>
              )}
            </>
          )}
        </section>

        <section>
          <h3>2. Emotions</h3>
          {mocks.emotion ? (
            <p>Emotion detection is a mock (VITE_MOCK_EMOTION=1): use the Dev Panel to fake it.</p>
          ) : (
            <>
              <p>
                For each emotion, record the person showing it their own way (subtle is fine).
                Record at least two different emotions, a few times each is better, then train.
              </p>
              <ul className="emotions">
                {EMOTIONS.map((label) => (
                  <li key={label}>
                    <button onClick={() => recordEmotion(label)} disabled={busy !== null}>
                      Record “{label}”
                    </button>
                    <span>{recorded[label] ? `${recorded[label]} samples this session` : ''}</span>
                  </li>
                ))}
              </ul>
              {countdown && <p className="prompt">{countdown}</p>}
              <button onClick={train} disabled={busy !== null}>
                Train my emotion model
              </button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
