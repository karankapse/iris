import { useEffect, useRef, useState } from 'react';
import { getUserId } from '../../../core/auth';
import { EMOTIONS, TARGET_POSITION } from '../../../contracts';
import type { CalibrationStep, Emotion, FaceFrame } from '../../../contracts';
import type { Orchestrator } from '../../../app/Orchestrator';
import type { Services } from '../../../app/services';

/** Where each calibration dot is drawn (the corners match the option cards exactly). */
const DOT_POSITION = { ...TARGET_POSITION, up: { x: 50, y: 14 }, down: { x: 50, y: 86 } } as const;

const GET_READY_S = 2;
const RECORD_S = 3;
const MIN_FRAMES = 10;
const MIN_AUDIO_DURATION_S = 30;

interface VoiceItem {
  voice_id: string;
  name: string;
  is_default?: boolean;
}

interface VoiceProfile {
  user_id: string;
  voice_id: string | null;
  name: string | null;
  configured: boolean;
  voices?: VoiceItem[];
}

/**
 * Calibration, done once per person (ideally with a caregiver):
 *  1. Eyes: look straight / up / down and close the eyes, so thresholds fit this face.
 *  2. Emotions: record a few seconds of the person showing each emotion THEIR way (a small
 *     brow raise or a half-smile counts), then train their personal model.
 *  3. Voice Banking: upload historical audio/video of the person speaking (min 30s)
 *     to clone their voice with ElevenLabs and speak replies with feeling.
 * Eye gestures are paused while this panel is open.
 */
export function SetupPanel({
  services,
  orchestrator,
  onClose,
  firstRun = false,
}: {
  services: Services;
  orchestrator: Orchestrator;
  onClose: () => void;
  /** Opened automatically because the eyes have never been calibrated. */
  firstRun?: boolean;
}) {
  const { eyeInput, emotion, faceTracker, mocks } = services;
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [step, setStep] = useState<CalibrationStep | null>(null);
  const [countdown, setCountdown] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [recorded, setRecorded] = useState<Partial<Record<Emotion, number>>>({});

  // Voice banking state
  const [voiceName, setVoiceName] = useState('My Voice');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile | null>(null);

  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    orchestrator.setSuspended(true);

    // Fetch existing voice profile
    fetch(`/api/voice/profile/${getUserId()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: VoiceProfile | null) => {
        if (mounted.current && data) {
          setVoiceProfile(data);
          if (data.name) setVoiceName(data.name);
        }
      })
      .catch(() => {});

    return () => {
      mounted.current = false;
      orchestrator.setSuspended(false);
    };
  }, [orchestrator]);

  useEffect(() => {
    if (!step) return;
    const timer = setInterval(() => setSecondsLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(timer);
  }, [step]);

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
      const warnings = await eyeInput.calibrate((s) => {
        setStep(s);
        setSecondsLeft(Math.ceil(s.seconds));
      });
      const accuracy = eyeInput.status?.().accuracy;
      const measured =
        accuracy === undefined
          ? ''
          : ` Measured accuracy: ${Math.round(accuracy * 100)}% of gaze readings landed in the right box.`;
      if (warnings.length === 0) return `Eye calibration saved.${measured}`;
      throw new Error(
        `Calibrated, but: ${warnings.join(' ')}${measured} Try again: sit still, good light, look right at each dot.`,
      );
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
      const stats = emotion.modelStats;
      if (stats?.accuracy) {
        return `Trained on ${stats.nSamples} samples. Model accuracy: ${Math.round(stats.accuracy * 100)}%!`;
      }
      return 'Trained! Your emotion model is now used to suggest tones.';
    });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setAudioDuration(null);

    if (file) {
      const url = URL.createObjectURL(file);
      const audio = new Audio();
      audio.src = url;
      audio.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        if (mounted.current) {
          setAudioDuration(audio.duration);
        }
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
      };
    }
  };

  const selectVoice = (voiceId: string) =>
    run('select-voice', async () => {
      const res = await fetch('/api/voice/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: getUserId(), voice_id: voiceId }),
      });
      if (!res.ok) {
        throw new Error('Failed to switch voice');
      }
      const data: VoiceProfile = await res.json();
      setVoiceProfile(data);
      return `Switched active voice to "${data.name}".`;
    });

  const cloneVoice = () =>
    run('clone-voice', async () => {
      if (!selectedFile) {
        throw new Error('Please select an audio file first.');
      }
      if (audioDuration !== null && audioDuration < MIN_AUDIO_DURATION_S) {
        throw new Error(
          `Audio sample is ${audioDuration.toFixed(1)}s. Minimum ${MIN_AUDIO_DURATION_S} seconds of clear speech is required.`,
        );
      }

      const form = new FormData();
      const name = voiceName.trim() || 'My Voice';
      form.append('name', name);
      form.append('user_id', getUserId());
      form.append('file', selectedFile);
      if (audioDuration !== null) {
        form.append('duration', String(audioDuration));
      }

      const res = await fetch('/api/voice/clone', {
        method: 'POST',
        body: form,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || 'Voice cloning failed');
      }

      const profRes = await fetch(`/api/voice/profile/${getUserId()}`);
      if (profRes.ok) {
        const data: VoiceProfile = await profRes.json();
        setVoiceProfile(data);
      }
      setSelectedFile(null);
      setAudioDuration(null);
      setVoiceName('');

      return `Voice "${name}" created and set as active!`;
    });

  const testVoice = (tone: Emotion) =>
    run(`test-voice-${tone}`, async () => {
      const phrases: Partial<Record<Emotion, string>> = {
        happy: "I'm so thrilled and happy! Everything is going wonderfully!",
        neutral: 'This is my calm, everyday speaking voice in a neutral tone.',
        serious: 'I need to discuss something important and serious with you.',
        joking: 'Oh sure, because that always goes according to plan, right?',
      };
      const text =
        phrases[tone] || `Hello, this is a preview speaking with feeling in a ${tone} tone.`;
      await services.tts.speak(text, tone);
    });

  const isDurationValid = audioDuration === null || audioDuration >= MIN_AUDIO_DURATION_S;

  return (
    <>
      {step && (
        <div className="calib-overlay" role="dialog" aria-label="Eye calibration">
          {/* light up the whole area to look at: a column, or the rest area */}
          {['left', 'middle', 'right', 'center'].includes(step.target) && (
            <div className={`calib-area calib-area-${step.target}`} />
          )}
          {step.target !== 'closed' && (
            <div
              className="calib-dot"
              style={{
                left: `${(step.target === 'point' ? step.position! : DOT_POSITION[step.target]).x}%`,
                top: `${(step.target === 'point' ? step.position! : DOT_POSITION[step.target]).y}%`,
              }}
            />
          )}
          <div className="calib-text">
            <p className="calib-step">
              Step {step.index} of {step.total}
            </p>
            <p className="calib-prompt">{step.prompt}</p>
            <p className="calib-seconds">{secondsLeft}</p>
          </div>
        </div>
      )}
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
            {firstRun && (
              <p className="msg">
                Welcome! Before starting, calibrate the eyes so Iris knows where the person is
                looking. A caregiver can press the button below.
              </p>
            )}
            <h3>1. Eyes</h3>
            {mocks.eye ? (
              <p>Eye input is the keyboard mock (VITE_MOCK_EYE=1): nothing to calibrate.</p>
            ) : (
              <>
                <p>
                  Each column lights up in turn: look at the words at the bottom of it. Then look at
                  the middle (resting), close your eyes briefly, and a short accuracy check. About
                  40 seconds. Keep your head still.
                </p>
                <button onClick={calibrateEyes} disabled={busy !== null}>
                  Calibrate eyes
                </button>
              </>
            )}
          </section>

          <section>
            <h3>2. Emotions</h3>
            {mocks.emotion ? (
              <p>
                Emotion detection is a mock (VITE_MOCK_EMOTION=1): use the Dev Panel to fake it.
              </p>
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
                      <span>
                        {recorded[label] ? `${recorded[label]} samples this session` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
                {countdown && <p className="prompt">{countdown}</p>}
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '1rem' }}
                >
                  <button onClick={train} disabled={busy !== null}>
                    Train my emotion model
                  </button>
                  {emotion.modelStats && (
                    <span className="stats">
                      <strong>Current model:</strong> {emotion.modelStats.nSamples} samples
                      {emotion.modelStats.accuracy &&
                        `, ${Math.round(emotion.modelStats.accuracy * 100)}% accurate`}
                    </span>
                  )}
                </div>
              </>
            )}
          </section>

          <section>
            <h3>3. Voice Banking & Selection</h3>
            <p>
              Iris synthesizes speech with emotion sliders powered by ElevenLabs. Use Roger as your
              default voice, or upload recordings to clone your own personal voice.
            </p>

            <div className="voice-selector-box">
              <label className="field-group">
                <span>Active Voice:</span>
                <select
                  className="voice-select"
                  value={voiceProfile?.voice_id || 'CwhRBWXzGAHq8TQ4Fs17'}
                  onChange={(e) => selectVoice(e.target.value)}
                  disabled={busy !== null}
                >
                  {voiceProfile?.voices && voiceProfile.voices.length > 0 ? (
                    voiceProfile.voices.map((v) => (
                      <option key={v.voice_id} value={v.voice_id}>
                        {v.name} {v.is_default ? '(Default)' : ''}
                      </option>
                    ))
                  ) : (
                    <option value="CwhRBWXzGAHq8TQ4Fs17">Roger (Default ElevenLabs Voice)</option>
                  )}
                </select>
              </label>

              {voiceProfile?.voice_id && (
                <div className="voice-status-box">
                  <span className="badge-active">✓ Speaking as:</span>
                  <strong>{voiceProfile.name || 'Roger'}</strong>
                  <small className="muted-id">(ID: {voiceProfile.voice_id})</small>
                </div>
              )}

              {voiceProfile?.voice_id && (
                <div className="test-buttons">
                  <span>Test tone:</span>
                  <button onClick={() => testVoice('neutral')} disabled={busy !== null}>
                    Neutral 😐
                  </button>
                  <button onClick={() => testVoice('happy')} disabled={busy !== null}>
                    Happy 😊
                  </button>
                  <button onClick={() => testVoice('serious')} disabled={busy !== null}>
                    Serious 🧐
                  </button>
                  <button onClick={() => testVoice('joking')} disabled={busy !== null}>
                    Joking 😉
                  </button>
                </div>
              )}
            </div>

            <div className="voice-create-card">
              <h4>Create Your Own Voice</h4>
              <p className="voice-create-desc">
                Upload a recording of the person speaking before vocal loss (minimum 30 seconds).
                Iris will clone their voice using ElevenLabs and add it to your voice dropdown.
              </p>

              <div className="voice-form">
                <label className="field-group">
                  <span>Voice name:</span>
                  <input
                    type="text"
                    value={voiceName}
                    onChange={(e) => setVoiceName(e.target.value)}
                    placeholder="e.g. Nishanth"
                    disabled={busy !== null}
                  />
                </label>

                <label className="field-group">
                  <span>Speech recording (minimum 30 seconds):</span>
                  <input
                    type="file"
                    accept="audio/*,video/*,.mp3,.wav,.m4a,.mov,.mp4"
                    onChange={handleFileChange}
                    disabled={busy !== null}
                  />
                </label>

                {audioDuration !== null && (
                  <div className={`duration-badge ${isDurationValid ? 'valid' : 'invalid'}`}>
                    {isDurationValid ? (
                      <span>✓ Duration: {audioDuration.toFixed(1)}s (Ready to clone)</span>
                    ) : (
                      <span>
                        ⚠️ Duration: {audioDuration.toFixed(1)}s (Minimum 30 seconds of clear speech
                        required)
                      </span>
                    )}
                  </div>
                )}

                <div className="action-row">
                  <button
                    onClick={cloneVoice}
                    disabled={busy !== null || !selectedFile || !isDurationValid}
                    className="btn-primary"
                  >
                    {busy === 'clone-voice'
                      ? 'Cloning with ElevenLabs…'
                      : 'Clone Voice with ElevenLabs'}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
