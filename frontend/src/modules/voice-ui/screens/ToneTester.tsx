import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { EMOTIONS } from '../../../contracts';
import type { Emotion } from '../../../contracts';
import { getServices } from '../../../app/services';
import { flags } from '../../../core/config';
import { EMOTION_PROFILES } from '../tts/emotionProfiles';

const SAMPLE = "I'm so glad you came to see me today.";
const GAP_MS = 500;

/**
 * Plays the SAME sentence in every tone so you can hear (and tune) the difference. With the
 * browser voice the tones are rate/pitch/volume tweaks (see tts/emotionProfiles.ts); with a cloud
 * voice provider they come from the tone map. Open it at /tone-tester.
 */
export function ToneTester() {
  const tts = getServices().tts;
  const [text, setText] = useState(SAMPLE);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState<Emotion | null>(null);
  const stopped = useRef(false);

  async function play(tone: Emotion) {
    setPlaying(tone);
    try {
      await tts.speak(text, tone, { speed });
    } finally {
      setPlaying(null);
    }
  }

  async function playAll() {
    stopped.current = false;
    for (const tone of EMOTIONS) {
      if (stopped.current) break;
      await play(tone);
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
  }

  return (
    <main className="screen tester">
      <header className="topbar">
        <h1>Tone tester</h1>
        <Link className="linkbtn" to="/">
          ← Back to Iris
        </Link>
      </header>
      <p className="muted">
        Voice provider: <strong>{flags.tts}</strong>. Same sentence, every tone.
      </p>

      <label className="field">
        <strong>Sentence</strong>
        <input value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <label className="slider">
        <span className="slider-head">
          <strong>Speed</strong>
          <span>{speed.toFixed(2)}×</span>
        </span>
        <input
          type="range"
          min={0.6}
          max={1.5}
          step={0.05}
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
        />
      </label>

      <div className="tester-actions">
        <button onClick={playAll}>Play all tones</button>
        <button
          onClick={() => {
            stopped.current = true;
            tts.cancel();
          }}
        >
          Stop
        </button>
      </div>

      <ul className="tone-list">
        {EMOTIONS.map((tone) => {
          const p = EMOTION_PROFILES[tone];
          return (
            <li key={tone} className={playing === tone ? 'playing' : ''}>
              <button onClick={() => play(tone)}>▶ {tone}</button>
              {flags.tts === 'browser' && (
                <span className="muted">
                  rate {p.rate} · pitch {p.pitch} · volume {p.volume}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
