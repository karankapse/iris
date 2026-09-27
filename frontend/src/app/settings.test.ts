import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTING_LIMITS,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from './settings';

describe('settings', () => {
  beforeEach(() => localStorage.clear());

  it('starts from the defaults', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('saves and loads', () => {
    saveSettings({ ...DEFAULT_SETTINGS, dwellMs: 2500, speechSpeed: 0.8, doubleBlinkBack: true });
    expect(loadSettings()).toMatchObject({
      dwellMs: 2500,
      speechSpeed: 0.8,
      doubleBlinkBack: true,
    });
  });

  it('forces every value into its allowed range (bad or hand-edited storage cannot break the app)', () => {
    const s = normalizeSettings({ dwellMs: 10, blinkMs: 99999, steadinessMs: -5, speechSpeed: 50 });
    expect(s.dwellMs).toBe(SETTING_LIMITS.dwellMs[0]);
    expect(s.blinkMs).toBe(SETTING_LIMITS.blinkMs[1]);
    expect(s.steadinessMs).toBe(SETTING_LIMITS.steadinessMs[0]);
    expect(s.speechSpeed).toBe(SETTING_LIMITS.speechSpeed[1]);
  });

  it('ignores non-numbers and corrupt JSON', () => {
    expect(normalizeSettings({ dwellMs: 'fast' as unknown as number }).dwellMs).toBe(
      DEFAULT_SETTINGS.dwellMs,
    );
    localStorage.setItem('iris.settings.v1', '{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
