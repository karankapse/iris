import { EMOTIONS } from '../contracts';
import type { Emotion, EyeMode } from '../contracts';
import { createEmitter } from '../core/emitter';
import { getOptions, initialState, reduce, type Effect, type Event, type State } from './machine';
import type { Services } from './services';

/** Everything the UI needs to draw one frame. A new object is created on every change. */
export interface View {
  machine: State;
  /** Which option the eyes are on right now, and how far the dwell timer has filled (0..1). */
  highlight: number | null;
  dwell: number;
  eyeMode: EyeMode;
  profile: import('../core/api').ApiUserProfile;
}

const STORAGE = { mood: 'iris.mood', eyeMode: 'iris.eyeMode', profile: 'iris.profile' };

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

function loadJson<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}
function saveJson(key: string, value: any) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
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
    this.view = {
      machine: initialState(load(STORAGE.mood, EMOTIONS), idPrefix),
      highlight: null,
      dwell: 0,
      // TODO: default to 'full' once the screen draws options at the up/right/down/left gaze
      // positions (optionRegions). Until then the stacked list only matches 'vertical'.
      eyeMode: load(STORAGE.eyeMode, ['full', 'vertical'] as const) ?? 'vertical',
      profile: loadJson(STORAGE.profile) ?? { name: '', common_needs: [], relationships: {} },
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
    const { faceTracker, eyeInput, emotion, stt } = this.services;
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
    void (async () => {
      await attempt(() => faceTracker.start());
      await attempt(() => this.startEye());
      await attempt(() => stt.start());
    })();

    return () => {
      clearInterval(timer);
      unsubs.forEach((u) => u());
      eyeInput.stop();
      stt.stop();
      faceTracker.stop();
      this.services.tts.cancel();
    };
  }

  private startEye() {
    const optionCount = getOptions(this.view.machine).length;
    this.services.eyeInput.start({ mode: this.view.eyeMode, optionCount });
  }

  /** Pause/resume acting on eye gestures (e.g. while the setup screen is open). */
  setSuspended(suspended: boolean) {
    this.suspended = suspended;
  }

  // ---- user settings -----------------------------------------------------------
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

  setProfile(profile: import('../core/api').ApiUserProfile) {
    saveJson(STORAGE.profile, profile);
    this.setView({ ...this.view, profile });
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
        const profile = this.view.profile;
        conversation.addTurn({ speaker: 'partner', text: effect.partnerText });
        conversation
          .suggestReplies(effect.mood, profile)
          .then((suggestions) =>
            this.dispatch({ type: 'suggestions_ready', requestId: effect.requestId, suggestions }),
          )
          .catch((e) =>
            this.dispatch({
              type: 'suggestions_failed',
              requestId: effect.requestId,
              message: `Could not get suggestions: ${e instanceof Error ? e.message : e}`,
            }),
          );
        break;
      }

      case 'snapshot_features':
        // Remember the face features from the moment the tone was proposed; they become a
        // training example if the user later says "yes, the tone was right".
        this.featureSnapshot = emotion.currentFeatures();
        break;

      case 'speak':
        tts
          .speak(effect.spoken.text, effect.spoken.tone)
          .catch((e) => console.error('[tts]', e))
          .finally(() => {
            conversation.addTurn({ speaker: 'user', text: effect.spoken.text });
            this.dispatch({ type: 'speak_done' });
          });
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
