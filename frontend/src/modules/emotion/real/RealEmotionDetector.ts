import type {
  Emotion,
  EmotionDetector,
  EmotionEstimate,
  FaceFrame,
  ToneFeedback,
  TrainingReport,
} from '../../../contracts';
import { api, type ApiEmotionModel } from '../../../core/api';
import { getUserId } from '../../../core/auth';
import { extractFeatures, FEATURE_NAMES, subsample, usableFrame } from '../features';
import { bestGuess, predictProbabilities } from './predict';

/** How quickly the guess reacts. Smaller = smoother but slower (0.15 is ~half a second at 30 fps). */
const SMOOTHING = 0.15;
/** Frames kept per labelled recording (a 5 s recording at 30 fps is ~150, many near-identical). */
export const MAX_SAMPLES_PER_RECORDING = 90;
/** A recording needs at least this many good frames (face visible, eyes open, facing the camera). */
export const MIN_USABLE_FRAMES = 10;
/** After this many new "yes, the tone was right" examples, retrain the personal model automatically. */
export const RETRAIN_AFTER = 5;

/**
 * Per-user emotion detector: face features in, {emotion, confidence} out.
 * Flow: calibration (recordSample) -> train() on backend -> prediction runs here in the browser.
 *
 * FIRST VERSION for teammates to extend (see the Emotion issues): calibration UI, better
 * smoothing, handling "no model yet", automatic retraining after enough feedback...
 */
export class RealEmotionDetector implements EmotionDetector {
  private model: ApiEmotionModel | null = null;
  private features: number[] | null = null;
  private usable = false;
  private smoothed: Partial<Record<Emotion, number>> = {};
  private newSamplesSinceTraining = 0;

  constructor() {
    // Use a previously trained model if there is one. Ignore failures (backend may be off).
    api
      .getModel(getUserId())
      .then((m) => (this.model = m))
      .catch(() => undefined);
  }

  onFrame(frame: FaceFrame) {
    this.features = extractFeatures(frame);
    this.usable = usableFrame(frame);
    if (!this.model) return;

    const values = Object.fromEntries(FEATURE_NAMES.map((n, i) => [n, this.features![i]]));
    const probs = predictProbabilities(this.model, values);
    // Exponential moving average so the guess doesn't flicker frame to frame.
    for (const c of this.model.classes) {
      const prev = this.smoothed[c] ?? probs[c];
      this.smoothed[c] = prev + SMOOTHING * (probs[c] - prev);
    }
  }

  current(): EmotionEstimate {
    return this.model ? bestGuess(this.smoothed) : { emotion: 'neutral', confidence: 0 };
  }

  currentFeatures() {
    return this.features;
  }

  currentUsableFeatures() {
    return this.usable ? this.features : null;
  }

  /** Stores the good frames of one recording (numbers only, never images); returns how many. */
  async recordSample(label: Emotion, frames: FaceFrame[]) {
    const good = frames.filter(usableFrame);
    if (good.length < MIN_USABLE_FRAMES) {
      throw new Error(
        'Not enough clear frames: keep the face in view, eyes open, facing the camera, and try again.',
      );
    }
    const chosen = subsample(good, MAX_SAMPLES_PER_RECORDING);
    await api.addSamples({
      user_id: getUserId(),
      feature_names: [...FEATURE_NAMES],
      samples: chosen.map((f) => ({ label, features: extractFeatures(f), source: 'calibration' })),
    });
    return chosen.length;
  }

  async train(): Promise<TrainingReport> {
    this.model = await api.train(getUserId());
    this.smoothed = {};
    return {
      accuracy: this.model.accuracy ?? null,
      perEmotion: this.model.per_class_accuracy ?? {},
      advice: this.model.advice ?? [],
    };
  }

  async addFeedback(fb: ToneFeedback) {
    const result = await api.feedback({
      user_id: getUserId(),
      utterance_id: fb.utteranceId,
      reply_text: fb.replyText,
      spoken_tone: fb.spokenTone,
      user_tone_ok: fb.userToneOk ?? null,
      partner_reaction: fb.partnerReaction ?? null,
      feature_names: fb.features || fb.featureFrames?.length ? [...FEATURE_NAMES] : null,
      features: fb.features ?? null,
      feature_frames: fb.featureFrames?.length ? fb.featureFrames : null,
    });

    // Learning: confirmed tones became training examples on the backend. Every few, retrain, so
    // the model keeps adapting to this person. (Retraining fails harmlessly until there are two
    // different emotions to learn from.)
    if (result.added_training_sample && ++this.newSamplesSinceTraining >= RETRAIN_AFTER) {
      this.newSamplesSinceTraining = 0;
      await this.train().catch((e) => console.info('[emotion] retrain skipped:', e?.message ?? e));
    }
  }

  get modelStats() {
    if (!this.model) return null;
    return {
      nSamples: this.model.n_samples,
      accuracy: this.model.accuracy ?? null,
    };
  }
}
