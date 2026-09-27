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
        Eye control:{' '}
        <select value={eyeMode} onChange={(e) => onEyeMode(e.target.value as EyeMode)}>
          <option value="glance">Glance left / right (default)</option>
          <option value="full">Look at an option</option>
          <option value="vertical">Up / down only</option>
        </select>
      </label>
    </div>
  );
}
