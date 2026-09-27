import { EMOTIONS } from '../contracts';
import type { Emotion, EyeMode, SttStatus, UserProfile } from '../contracts';
import { api } from '../core/api';
import { USER_ID } from '../core/config';
import { createEmitter } from '../core/emitter';
import { getOptions, initialState, reduce, type Effect, type Event, type State } from './machine';
import { DEFAULT_PHRASES } from './phrases';
import type { Services } from './services';
import { loadSettings, normalizeSettings, saveSettings, type Settings } from './settings';

/** Everything the UI needs to draw one frame. A new object is created on every change. */
export interface View {
  machine: State;
  /** Which option the eyes are on right now, and how far the dwell timer has filled (0..1). */
  highlight: number | null;
  dwell: number;
  eyeMode: EyeMode;
  /** What the microphone / speech engine is doing (for the on-screen indicator). */
  stt: SttStatus;
  /** The user's adjustable settings (dwell time, blink length, speech speed...). */
  settings: Settings;
  /** Who the user is (name, relationships, quick phrases...). */
  profile: UserProfile;
}

const STORAGE = { mood: 'iris.mood', eyeMode: 'iris.eyeMode', profile: 'iris.profile' };

const EMPTY_PROFILE: UserProfile = {
  name: '',
  relationships: [],
  interests: [],
  common_needs: [],
  phrases: DEFAULT_PHRASES,
};

/** The last known profile, kept in the browser so the app still has it when the backend is off. */
function loadCachedProfile(): UserProfile {
  try {
    const p = JSON.parse(localStorage.getItem(STORAGE.profile) ?? 'null');
    if (p && typeof p === 'object' && Array.isArray(p.phrases)) return { ...EMPTY_PROFILE, ...p };
  } catch {
    /* corrupt or blocked */
  }
  return EMPTY_PROFILE;
}

function load<T extends string>(key: string, allowed: readonly T[]): T | null {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : null;
  } catch {
    return null; // storage can be blocked (private windows); the app must still work
  }
}
function save(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

const EMOTION_POLL_MS = 500;

/**
 * Wires the modules together: it feeds events into the pure state machine (machine.ts)
 * and carries out the side effects the machine asks for (speak, call the AI, save feedback).
 * It's a plain class (no React) so it can be tested; `useOrchestrator` connects it to React.
 */
export class Orchestrator {
  private view: View;
  private listeners = new Set<() => void>();
  private viewEmitter = createEmitter<View>();
  private featureSnapshot: number[] | null = null;
  /** While true, eye gestures are ignored (calibration screens use blinks and gazes too). */
  private suspended = false;

  constructor(
    private services: Services,
    idPrefix: string = crypto.randomUUID(),
  ) {
    const profile = loadCachedProfile();
    this.view = {
      settings: loadSettings(),
      profile,
      machine: initialState(load(STORAGE.mood, EMOTIONS), idPrefix, profile.phrases),
      highlight: null,
      dwell: 0,
      stt: { state: 'off', engine: '' },
      eyeMode: load(STORAGE.eyeMode, ['full', 'vertical'] as const) ?? 'full',
    };
  }

  // ---- store API (used by React's useSyncExternalStore) ----------------------
  getView = () => this.view;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  /** Non-React subscribers (the partner window link). */
  onView(handler: (view: View) => void) {
    return this.viewEmitter.on(handler);
  }

  private setView(next: View) {
    this.view = next;
    this.listeners.forEach((l) => l());
    this.viewEmitter.emit(next);
  }

  // ---- lifecycle -------------------------------------------------------------
  /** Start the camera, mic and eye input. Returns a function that stops everything. */
  start(): () => void {
    const { faceTracker, eyeInput, emotion, stt, gaze } = this.services;
    const unsubs: (() => void)[] = [];

    unsubs.push(faceTracker.onFrame((f) => emotion.onFrame(f)));

    unsubs.push(
      eyeInput.on((event) => {
        if (event.type === 'highlight') {
          this.setView({ ...this.view, highlight: event.optionIndex, dwell: event.dwellProgress });
        } else if (this.suspended) {
          return;
        }
        this.dispatch({ type: 'eye', event });
      }),
    );

    unsubs.push(
      stt.onTranscript((t) =>
        this.dispatch({ type: t.isFinal ? 'partner_final' : 'partner_partial', text: t.text }),
      ),
    );

    if (stt.onStatus) {
      unsubs.push(stt.onStatus((status) => this.setView({ ...this.view, stt: status })));
    }
    if (stt.onError) {
      unsubs.push(stt.onError((message) => this.dispatch({ type: 'error', message })));
    }

    // Ask the emotion detector for its guess a couple of times a second (not every frame).
    const timer = setInterval(() => {
      const estimate = emotion.current();
      const { detected } = this.view.machine;
      if (
        estimate.emotion !== detected.emotion ||
        Math.abs(estimate.confidence - detected.confidence) > 0.1
      ) {
        this.dispatch({ type: 'emotion_estimate', estimate });
      }
    }, EMOTION_POLL_MS);

    // Start the camera, the eyes and the microphone independently: if one is unavailable
    // (no camera permission, no mic key...), the others must still work.
    const attempt = async (job: () => void | Promise<void>) => {
      try {
        await job();
      } catch (e) {
        this.dispatch({ type: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    };
    // Bring in the saved profile (quick phrases, name...) from the backend; keep the cached one if it is off.
    void this.loadProfile();

    void (async () => {
      await attempt(() => faceTracker.start());
      if (gaze) await attempt(() => gaze.start());
      await attempt(() => this.startEye());
      await attempt(() => stt.start());
    })();

    return () => {
      clearInterval(timer);
      unsubs.forEach((u) => u());
      eyeInput.stop();
      gaze?.stop();
      stt.stop();
      faceTracker.stop();
      this.services.tts.cancel();
    };
  }

  private startEye() {
    const optionCount = getOptions(this.view.machine).length;
    this.services.eyeInput.start({ mode: this.view.eyeMode, optionCount });
    this.services.eyeInput.configure?.(this.view.settings);
  }

  /** Pause/resume acting on eye gestures (e.g. while the setup screen is open). */
  setSuspended(suspended: boolean) {
    this.suspended = suspended;
    if (suspended) {
      this.services.stt.stop();
    } else {
      this.services.stt.start();
    }
  }

  // ---- user settings -----------------------------------------------------------
  /** Change adjustable settings (dwell time, blink length, speech speed...). Applies immediately. */
  setSettings(partial: Partial<Settings>) {
    const settings = normalizeSettings({ ...this.view.settings, ...partial });
    saveSettings(settings);
    this.setView({ ...this.view, settings });
    this.services.eyeInput.configure?.(settings);
  }

  private async loadProfile() {
    try {
      this.applyProfile(await api.getProfile(USER_ID));
    } catch {
      /* backend off: keep the cached profile */
    }
  }

  private applyProfile(profile: UserProfile) {
    save(STORAGE.profile, JSON.stringify(profile));
    this.setView({ ...this.view, profile });
    this.dispatch({ type: 'set_phrases', phrases: profile.phrases });
  }

  /** Save the profile locally right away, and to the backend (which trims and stores it). */
  async saveProfile(profile: UserProfile) {
    this.applyProfile(profile);
    try {
      this.applyProfile(await api.putProfile(USER_ID, profile));
    } catch {
      this.dispatch({
        type: 'error',
        message: 'Saved on this device only: the backend is not reachable.',
      });
    }
  }

  setMood(mood: Emotion | null) {
    save(STORAGE.mood, mood);
    this.dispatch({ type: 'set_mood', mood });
  }

  setEyeMode(eyeMode: EyeMode) {
    save(STORAGE.eyeMode, eyeMode);
    this.setView({ ...this.view, eyeMode });
    this.services.eyeInput.stop();
    try {
      this.startEye();
    } catch (e) {
      this.dispatch({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  // ---- the core loop ---------------------------------------------------------------
  dispatch = (event: Event) => {
    const before = this.view.machine;
    const { state, effects } = reduce(before, event);
    this.setView({ ...this.view, machine: state });

    // A new screen means a new set of options: tell the eye module (it also resets the
    // highlight). We compare phases, not counts: e.g. selectReply -> pickTone can keep 4.
    if (state.phase !== before.phase) {
      this.services.eyeInput.setOptionCount(getOptions(state).length);
    }

    effects.forEach((e) => this.run(e));
  };

  private run(effect: Effect) {
    const { conversation, tts, emotion } = this.services;
    switch (effect.type) {
      case 'suggest': {
        conversation.addTurn({ speaker: 'partner', text: effect.partnerText });
        void (async () => {
          try {
            // Ask right away: no waiting to measure a facial reaction first (speed matters most).
            const reaction = effect.mood ?? null;
            const suggestions = await conversation.suggestReplies(
              effect.mood,
              this.view.profile,
              reaction,
            );
            this.dispatch({
              type: 'suggestions_ready',
              requestId: effect.requestId,
              suggestions,
              reaction,
            });
          } catch (e) {
            this.dispatch({
              type: 'suggestions_failed',
              requestId: effect.requestId,
              message: `Could not get suggestions: ${e instanceof Error ? e.message : e}`,
            });
          }
        })();
        break;
      }

      case 'snapshot_features':
        // Remember the face features from the moment the tone was proposed; they become a
        // training example if the user later says "yes, the tone was right".
        this.featureSnapshot = emotion.currentFeatures();
        break;

      case 'speak':
        // Prevent "own-voice echo": stop STT so it doesn't transcribe the app's own voice
        this.services.stt.stop();
        tts
          .speak(effect.spoken.text, effect.spoken.tone, {
            speed: this.view.settings.speechSpeed,
          })
          .catch((e) => console.error('[tts]', e))
          .finally(() => {
            // Re-enable STT now that we are done talking, but only if we aren't suspended (e.g. in Setup menu)
            if (!this.suspended) {
              this.services.stt.start();
            }
            conversation.addTurn({ speaker: 'user', text: effect.spoken.text });
            this.dispatch({ type: 'speak_done' });
          });
        break;

      case 'save_mood':
        save(STORAGE.mood, effect.mood);
        break;

      case 'stop_speaking':
        tts.cancel();
        break;

      case 'user_feedback':
        emotion
          .addFeedback({
            utteranceId: effect.spoken.id,
            replyText: effect.spoken.text,
            spokenTone: effect.spoken.tone,
            userToneOk: effect.ok,
            features: this.featureSnapshot,
          })
          .catch((e) => console.warn('[feedback]', e));
        break;

      case 'partner_feedback':
        emotion
          .addFeedback({
            utteranceId: effect.spoken.id,
            replyText: effect.spoken.text,
            spokenTone: effect.spoken.tone,
            partnerReaction: effect.reaction,
          })
          .catch((e) => console.warn('[feedback]', e));
        break;
    }
  }
}
