import { EMOTIONS } from '../contracts';
import type { Emotion, EmotionEstimate, EyeMode, SttStatus, UserProfile } from '../contracts';
import { api } from '../core/api';
import { getUserId } from '../core/auth';
import { ECHO_TAIL_MS, ECHO_WINDOW_MS, isEchoOf } from './echo';
import { createEmitter } from '../core/emitter';
import {
  getOptions,
  initialState,
  reduce,
  type Effect,
  type Event,
  type SpokenReply,
  type State,
} from './machine';
import { DEFAULT_PHRASES } from './phrases';
import { summarizeReaction } from './reaction';
import { subsample } from '../modules/emotion/features';
import type { Services } from './services';
import { loadSettings, normalizeSettings, saveSettings, type Settings } from './settings';

/** Face frames from the reaction window saved with a confirmed tone. */
const FEEDBACK_FRAMES = 10;

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

const STORAGE = { mood: 'iris.mood', eyeMode: 'iris.eyeMode.v2', profile: 'iris.profile' };

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
/** How long the face is read after the partner speaks, before asking for replies. */
const REACTION_WINDOW_MS = 800;

export class Orchestrator {
  private view: View;
  private listeners = new Set<() => void>();
  private viewEmitter = createEmitter<View>();
  private featureSnapshot: number[] | null = null;
  /** Good face frames from the reaction window of the latest partner turn (for learning). */
  private reactionFrames: { requestId: number; frames: number[][]; emotion: Emotion } = {
    requestId: -1,
    frames: [],
    emotion: 'neutral',
  };
  /** What the face showed when the feedback frames / snapshot were taken (see user_feedback). */
  private feedbackFace: Emotion = 'neutral';
  /** The reaction frames that belong to the reply being spoken (sent with the tone feedback). */
  private feedbackFrames: number[][] = [];
  /** Echo guard: speaking now, and when it last stopped / what it said (see app/echo.ts). */
  private speaking = false;
  private spokeUntil = -Infinity;
  private lastSpokenText = '';
  /** While true, eye gestures are ignored (calibration screens use blinks and gazes too). */
  /** Why eye gestures are paused (setup, menu, tuning…); acted on only when this is empty. */
  private suspendedBy = new Set<string>();
  /** Whether the reply being spoken was stopped. */
  private speechStopped = false;
  /** Finishes the reply being spoken (once). Used by "Stop speaking" if the voice hangs. */
  private finishSpeech: (() => void) | null = null;
  private speechId = 0;

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
      eyeMode: load(STORAGE.eyeMode, ['glance', 'full', 'vertical'] as const) ?? 'glance',
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
        // A menu or panel is open over the options: nothing behind it can be highlighted or chosen.
        if (this.suspendedBy.size > 0) return;
        if (event.type === 'highlight') {
          this.setView({ ...this.view, highlight: event.optionIndex, dwell: event.dwellProgress });
        }
        this.dispatch({ type: 'eye', event });
      }),
    );

    unsubs.push(
      stt.onTranscript((t) => {
        if (this.isOwnEcho(t.text)) return; // the microphone hearing our own reply
        this.dispatch(
          t.isFinal
            ? { type: 'partner_final', text: t.text, at: Date.now() }
            : { type: 'partner_partial', text: t.text },
        );
      }),
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

  /**
   * Conversation memory: log what the partner said, how the user's face reacted and what they
   * replied, so future suggestions learn how this person feels about each topic. Off = nothing
   * is stored (Settings).
   */
  private remember(spoken: SpokenReply) {
    if (!this.view.settings.rememberConversations) return;
    const { partnerText, measuredEmotion, mood, feel } = this.view.machine;
    if (!partnerText.trim()) return;
    const live = this.services.emotion.current();
    // how the moment felt (words + face) when known, else the face alone
    const detected =
      feel?.emotion ?? measuredEmotion ?? (live.confidence >= 0.5 ? live.emotion : null);
    api
      .logExchange({
        user_id: getUserId(),
        utterance_id: spoken.id,
        partner_text: partnerText,
        detected_emotion: detected,
        emotion_confidence: feel
          ? feel.confidence
          : detected === live.emotion
            ? live.confidence
            : null,
        mood,
        reply_text: spoken.text,
        reply_tone: spoken.tone,
      })
      .catch((e) => console.warn('[memory]', e)); // the backend may be off: never block speaking
  }

  /**
   * Is this transcript the app's own voice coming back through the microphone? True while
   * speaking and shortly after; later, only if it is mostly the words of the last reply.
   */
  private isOwnEcho(text: string): boolean {
    if (this.speaking) return true;
    const since = performance.now() - this.spokeUntil;
    if (since < ECHO_TAIL_MS) return true;
    return since < ECHO_WINDOW_MS && isEchoOf(text, this.lastSpokenText);
  }

  /** Pause/resume acting on eye gestures while something is open over the options (setup
   * screen, menu drawer, tuning panel). Each `reason` pauses independently. */
  setSuspended(suspended: boolean, reason = 'panel') {
    if (suspended) this.suspendedBy.add(reason);
    else this.suspendedBy.delete(reason);
    // clear any half-filled dwell on the option behind
    if (this.suspendedBy.size > 0 && this.view.highlight !== null) {
      this.setView({ ...this.view, highlight: null, dwell: 0 });
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
      this.applyProfile(await api.getProfile(getUserId()));
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
      this.applyProfile(await api.putProfile(getUserId(), profile));
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

    const byEyeSelection = event.type === 'eye' && event.event.type === 'select';
    effects.forEach((e) => this.run(e, byEyeSelection));
  };

  /**
   * Measures what emotion the user is feeling after a slight reaction buffer (500ms)
   * so the user has realistic time to digest what was said and naturally react.
   * Then tracks the peak / dominant emotion expressed across the reaction window (1200ms).
   */
  private async measureReaction(
    durationMs = 1200,
    delayBufferMs = 500,
    requestId = -1,
  ): Promise<ReturnType<typeof summarizeReaction>> {
    if (delayBufferMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayBufferMs));
    }
    const start = Date.now();
    const samples: EmotionEstimate[] = [];
    const frames: number[][] = [];
    const { emotion } = this.services;
    const sample = () => {
      const live = emotion.current();
      const stateEstimate = this.view.machine.detected;
      samples.push(stateEstimate.confidence >= live.confidence ? stateEstimate : live);
      // the face while reacting: if the user later confirms the tone, these teach the model
      const features = emotion.currentUsableFeatures
        ? emotion.currentUsableFeatures()
        : emotion.currentFeatures();
      if (features) frames.push([...features]);
    };

    sample();

    if (durationMs > 0) {
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          sample();
          if (Date.now() - start >= durationMs) {
            clearInterval(interval);
            resolve();
          }
        }, 100);
      });
    }
    // the expression that lasted, plus the whole picture, for judging words + face together
    const summary = summarizeReaction(samples);
    this.reactionFrames = {
      requestId,
      frames: subsample(frames, FEEDBACK_FRAMES),
      emotion: summary.emotion ?? 'neutral',
    };
    return summary;
  }

  /** `byEyeSelection`: the effect comes straight from an option chosen with the eyes. */
  private run(effect: Effect, byEyeSelection = false) {
    const { conversation, tts, emotion } = this.services;
    switch (effect.type) {
      case 'expand': {
        // First-letter typing: ask the AI what the letters stand for, given the conversation.
        const history = conversation.history();
        api
          .expand(effect.initials, history, effect.mood, this.view.profile)
          .then(({ suggestions }) =>
            this.dispatch({
              type: 'expansions_ready',
              requestId: effect.requestId,
              suggestions: suggestions.map((s) => ({ id: s.id, text: s.text, tone: s.tone })),
            }),
          )
          .catch((e) =>
            this.dispatch({
              type: 'expansions_failed',
              requestId: effect.requestId,
              message: `Could not guess the words: ${e instanceof Error ? e.message : e}`,
            }),
          );
        break;
      }

      case 'check_related': {
        // Answer within 1.5 s; if not (or on error), treat it as unrelated: it's held, not lost.
        const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500));
        const verdict = api
          .related(effect.previous, effect.new)
          .then((r) => r.related)
          .catch(() => false);
        void Promise.race([verdict, timeout]).then((related) =>
          this.dispatch({
            type: 'related_result',
            requestId: effect.requestId,
            related,
            text: effect.new,
          }),
        );
        break;
      }

      case 'suggest': {
        conversation.addTurn({ speaker: 'partner', text: effect.partnerText });
        void (async () => {
          try {
            // Read the face for a moment (kept short: replies should appear right away)
            const { emotion: measured, face } = await this.measureReaction(
              REACTION_WINDOW_MS,
              0,
              effect.requestId,
            );
            // The partner said more while we were measuring: a newer request has replaced this
            // one, so don't spend an AI call on replies nobody will see.
            if (this.view.machine.requestId !== effect.requestId) return;
            // The face was just measured: if it stayed neutral, that IS the reaction (don't fall
            // back to the single reading from the moment speech ended, which may be a flicker).
            const reaction = measured ?? effect.mood ?? null;
            // Replies AND how the moment feels (the partner's words + this face), in one call.
            const { suggestions, emotion: feel } = conversation.suggestRepliesWithEmotion
              ? await conversation.suggestRepliesWithEmotion(
                  effect.mood,
                  this.view.profile,
                  reaction,
                  face,
                )
              : {
                  suggestions: await conversation.suggestReplies(
                    effect.mood,
                    this.view.profile,
                    reaction,
                  ),
                  emotion: null,
                };
            this.dispatch({
              type: 'suggestions_ready',
              requestId: effect.requestId,
              suggestions,
              reaction,
              feel,
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
        // replying to what the partner just said: the face while reacting to it is better data
        if (this.reactionFrames.requestId === this.view.machine.requestId) {
          this.feedbackFrames = this.reactionFrames.frames;
          this.feedbackFace = this.reactionFrames.emotion;
        } else {
          const now = emotion.current();
          this.feedbackFrames = [];
          this.feedbackFace = now.confidence >= 0.5 ? now.emotion : 'neutral';
        }
        break;

      case 'speak': {
        this.remember(effect.spoken);
        this.speaking = true;
        this.lastSpokenText = effect.spoken.text;
        // Gaze learning: a reply chosen with the eyes and spoken to the end confirms that the
        // eyes were on that option; stopping it (or no eye selection) means nothing is learned.
        const learning = this.services.gazeLearning;
        if (byEyeSelection) learning?.hold(performance.now());
        else learning?.discard();
        this.speechStopped = false;
        const id = ++this.speechId;
        // Runs once per reply, whether the voice finishes, fails or is stopped.
        const finish = () => {
          if (id !== this.speechId || this.finishSpeech !== finish) return; // a newer reply
          this.finishSpeech = null;
          this.speaking = false;
          this.spokeUntil = performance.now();
          if (this.speechStopped) learning?.discard();
          else learning?.confirm(performance.now());
          conversation.addTurn({ speaker: 'user', text: effect.spoken.text });
          this.dispatch({ type: 'speak_done' });
        };
        this.finishSpeech = finish;
        tts
          .speak(effect.spoken.text, effect.spoken.tone, {
            speed: this.view.settings.speechSpeed,
          })
          .catch((e) => console.error('[tts]', e))
          .finally(finish);
        break;
      }

      case 'save_mood':
        save(STORAGE.mood, effect.mood);
        break;

      case 'stop_speaking': {
        this.speechStopped = true;
        this.services.gazeLearning?.discard();
        tts.cancel();
        // Safety net: if a voice engine doesn't report back after being stopped, finish the
        // reply ourselves so the app never sticks on the speaking screen with the mic ignored.
        const pending = this.finishSpeech;
        if (pending) setTimeout(() => this.finishSpeech === pending && pending(), 1000);
        break;
      }

      case 'user_feedback':
        emotion
          .addFeedback({
            utteranceId: effect.spoken.id,
            replyText: effect.spoken.text,
            spokenTone: effect.spoken.tone,
            userToneOk: effect.ok,
            // Learn only when the face actually showed that tone. A right tone with a calm face
            // doesn't mean the face looked like it: saving those frames would teach the model
            // the wrong thing and make that tone come up more and more (a feedback loop).
            ...(this.feedbackFace === effect.spoken.tone
              ? { features: this.featureSnapshot, featureFrames: this.feedbackFrames }
              : { features: null, featureFrames: [] }),
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
