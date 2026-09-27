// The user's adjustable settings. Abilities vary and change over time, so none of these are fixed:
// dwell time, blink length, gaze steadiness (how much a look must hold), double-blink, speech speed.
import type { EyeSettings } from '../contracts';

export interface Settings extends EyeSettings {
  /** Speech speed multiplier (1 = the tone's normal speed). */
  speechSpeed: number;
  /**
   * Remember conversations (what was said, how the user felt, what they replied) on this
   * computer, so suggestions learn how this person feels about each topic.
   */
  rememberConversations: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  dwellMs: 1500,
  blinkMs: 500,
  steadinessMs: 150,
  doubleBlinkBack: false,
  speechSpeed: 1,
  rememberConversations: true,
};

/** [min, max, step] for the sliders, also used to clamp anything loaded from storage. */
export const SETTING_LIMITS = {
  dwellMs: [800, 4000, 100],
  blinkMs: [300, 1200, 50],
  steadinessMs: [50, 500, 25],
  speechSpeed: [0.6, 1.5, 0.05],
} as const;

const clamp = (v: number, [lo, hi]: readonly [number, number, number]) =>
  Math.min(hi, Math.max(lo, v));

/** Fill in defaults and force every number into its allowed range. */
export function normalizeSettings(input: Partial<Settings> | null | undefined): Settings {
  const s = { ...DEFAULT_SETTINGS, ...(input ?? {}) };
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return {
    dwellMs: clamp(num(s.dwellMs, DEFAULT_SETTINGS.dwellMs), SETTING_LIMITS.dwellMs),
    blinkMs: clamp(num(s.blinkMs, DEFAULT_SETTINGS.blinkMs), SETTING_LIMITS.blinkMs),
    steadinessMs: clamp(
      num(s.steadinessMs, DEFAULT_SETTINGS.steadinessMs),
      SETTING_LIMITS.steadinessMs,
    ),
    speechSpeed: clamp(
      num(s.speechSpeed, DEFAULT_SETTINGS.speechSpeed),
      SETTING_LIMITS.speechSpeed,
    ),
    doubleBlinkBack: s.doubleBlinkBack === true,
    rememberConversations: s.rememberConversations !== false,
  };
}

const KEY = 'iris.settings.v1';

export function loadSettings(): Settings {
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_SETTINGS }; // storage blocked or corrupt
  }
}

export function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}
