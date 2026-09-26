import { useEffect, useRef, useState } from 'react';
import { EMOTIONS } from '../../../contracts';
import type { CalibrationStep, Emotion, FaceFrame } from '../../../contracts';
import type { Orchestrator } from '../../../app/Orchestrator';
import type { Services } from '../../../app/services';

const GET_READY_S = 2;
const RECORD_S = 3;
const MIN_FRAMES = 10;
const MIN_AUDIO_DURATION_S = 30;

interface VoiceProfile {
  user_id: string;
  voice_id: string | null;
  name: string | null;
  configured: boolean;
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
    fetch('/api/voice/profile/local-user')
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
      form.append('name', voiceName.trim() || 'My Voice');
      form.append('user_id', 'local-user');
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

      const data = await res.json();
      setVoiceProfile({
        user_id: 'local-user',
        voice_id: data.voice_id,
        name: data.name,
        configured: true,
      });

      return `Voice "${data.name}" cloned successfully! Iris will now use this voice for replies.`;
    });

  const testVoice = (tone: Emotion) =>
    run(`test-voice-${tone}`, async () => {
      await services.tts.speak(
        `Hello, this is a preview speaking with feeling in a ${tone} tone.`,
        tone,
      );
    });

  const isDurationValid = audioDuration === null || audioDuration >= MIN_AUDIO_DURATION_S;

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

        <section>
          <h3>3. Voice Banking (Personal Cloned Voice)</h3>
          <p>
            Upload a video or audio recording of the person speaking before vocal loss. Iris clones
            their voice using ElevenLabs and modulates pitch, stability, and speed according to
            their emotion.
          </p>

          {voiceProfile?.voice_id && (
            <div className="voice-status-box">
              <span className="badge-active">✓ Voice Active</span>
              <strong>{voiceProfile.name || 'Cloned Voice'}</strong>
              <small className="muted-id">(ID: {voiceProfile.voice_id})</small>
            </div>
          )}

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

              {voiceProfile?.voice_id && (
                <div className="test-buttons">
                  <span>Test tone:</span>
                  <button onClick={() => testVoice('happy')} disabled={busy !== null}>
                    Happy 😊
                  </button>
                  <button onClick={() => testVoice('serious')} disabled={busy !== null}>
                    Serious 😐
                  </button>
                  <button onClick={() => testVoice('joking')} disabled={busy !== null}>
                    Joking 😉
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
