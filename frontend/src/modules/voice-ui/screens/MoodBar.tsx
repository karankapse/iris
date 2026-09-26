import { EMOTIONS } from '../../../contracts';
import type { Emotion, EyeMode } from '../../../contracts';

interface Props {
  mood: Emotion | null;
  eyeMode: EyeMode;
  onMood: (mood: Emotion | null) => void;
  onEyeMode: (mode: EyeMode) => void;
}

/** Persistent settings: a mood so the user doesn't pick a tone every time, and the eye mode. */
export function MoodBar({ mood, eyeMode, onMood, onEyeMode }: Props) {
  return (
    <div className="moodbar">
      <span className="moodbar-label">Mood:</span>
      {[null, ...EMOTIONS].map((m) => (
        <button
          key={m ?? 'none'}
          className={`chip ${mood === m ? 'active' : ''}`}
          onClick={() => onMood(m)}
        >
          {m ?? 'auto'}
        </button>
      ))}
      <label className="eyemode">
        <input
          type="checkbox"
          checked={eyeMode === 'vertical'}
          onChange={(e) => onEyeMode(e.target.checked ? 'vertical' : 'full')}
        />
        vertical-only eyes
      </label>
    </div>
  );
}
