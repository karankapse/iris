import { useEffect, useRef, useState } from 'react';
import { EMOTIONS, type Emotion, type TtsProvider } from '../../../contracts';
import { BrowserTts } from '../tts/BrowserTts';
import { EMOTION_PROFILES, type VoiceProfile } from '../tts/emotionProfiles';
import { preferredVoice } from '../tts/voices';

const SLOT_NAMES = ['A', 'B', 'C', 'D'];
const DEFAULT_TONES: Emotion[] = ['neutral', 'happy', 'sad', 'serious'];
const GAP_MS = 800;

/** The knobs worth A/B-ing by ear, with slider ranges. */
const KNOBS: { key: keyof VoiceProfile; label: string; min: number; max: number; step: number }[] =
  [
    { key: 'pitch', label: 'Pitch', min: 0.4, max: 2, step: 0.05 },
    { key: 'rate', label: 'Rate', min: 0.6, max: 1.6, step: 0.02 },
    { key: 'pitchVariation', label: 'Pitch movement', min: 0, max: 0.5, step: 0.01 },
    { key: 'phraseGapMs', label: 'Phrase pause (ms)', min: 0, max: 600, step: 10 },
    { key: 'emphasisGapMs', label: 'Pause before last word (ms)', min: 0, max: 800, step: 10 },
    { key: 'finalFall', label: 'Statement fall', min: 0, max: 0.4, step: 0.01 },
    { key: 'questionRise', label: 'Question rise', min: 0, max: 0.5, step: 0.01 },
  ];

interface Slot {
  tone: Emotion;
  profile: VoiceProfile;
}

/**
 * Dev harness: the SAME sentence spoken with four tone settings back to back (A, B, C, D), so
 * differences are easy to hear. Each slot starts from a tone's profile and can be tweaked; the
 * numbers shown can be copied into tts/emotionProfiles.ts once they sound right.
 */
export function ToneAB({ tts, text }: { tts: TtsProvider; text: string }) {
  const [slots, setSlots] = useState<Slot[]>(() =>
    DEFAULT_TONES.map((tone) => ({ tone, profile: { ...EMOTION_PROFILES[tone] } })),
  );
  const [playing, setPlaying] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [voice, setVoice] = useState('…');
  const stopped = useRef(false);
  const browser = tts instanceof BrowserTts ? tts : null;

  useEffect(() => {
    preferredVoice().then((v) => setVoice(v ? `${v.name} (${v.lang})` : 'browser default'));
  }, []);

  const update = (i: number, next: Partial<Slot>) =>
    setSlots((all) => all.map((s, j) => (j === i ? { ...s, ...next } : s)));

  async function playSlot(i: number) {
    setPlaying(i);
    try {
      const s = slots[i];
      if (browser) await browser.speakWith(text, s.profile);
      else await tts.speak(text, s.tone);
    } finally {
      setPlaying(null);
    }
  }

  async function playAll() {
    stopped.current = false;
    for (let i = 0; i < slots.length; i++) {
      if (stopped.current) break;
      await playSlot(i);
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
  }

  return (
    <section className="tone-ab">
      <h2>A/B: same sentence, four settings</h2>
      <p className="muted">
        Voice: <strong>{voice}</strong>
        {!browser && ' (knobs only affect the browser voice)'}
      </p>
      <div className="tester-actions">
        <button onClick={playAll}>▶ Play A → D</button>
        <button
          onClick={() => {
            stopped.current = true;
            tts.cancel();
          }}
        >
          Stop
        </button>
      </div>
      <ol className="ab-slots">
        {slots.map((s, i) => (
          <li key={SLOT_NAMES[i]} className={playing === i ? 'playing' : ''}>
            <div className="ab-head">
              <strong>{SLOT_NAMES[i]}</strong>
              <select
                value={s.tone}
                onChange={(e) => {
                  const tone = e.target.value as Emotion;
                  update(i, { tone, profile: { ...EMOTION_PROFILES[tone] } });
                }}
              >
                {EMOTIONS.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <button onClick={() => playSlot(i)}>▶</button>
              <button className="linkbtn small" onClick={() => setOpen(open === i ? null : i)}>
                {open === i ? 'hide knobs' : 'tweak'}
              </button>
            </div>
            <code className="muted">
              pitch {s.profile.pitch.toFixed(2)} · rate {s.profile.rate.toFixed(2)} · movement{' '}
              {s.profile.pitchVariation.toFixed(2)} · last-word pause {s.profile.emphasisGapMs} ms
            </code>
            {open === i &&
              KNOBS.map((k) => (
                <label key={k.key} className="slider">
                  <span className="slider-head">
                    <span>{k.label}</span>
                    <span>{s.profile[k.key]}</span>
                  </span>
                  <input
                    type="range"
                    min={k.min}
                    max={k.max}
                    step={k.step}
                    value={s.profile[k.key]}
                    onChange={(e) =>
                      update(i, { profile: { ...s.profile, [k.key]: Number(e.target.value) } })
                    }
                  />
                </label>
              ))}
          </li>
        ))}
      </ol>
    </section>
  );
}
