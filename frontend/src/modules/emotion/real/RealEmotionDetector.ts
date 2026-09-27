import type {
  Emotion,
  EmotionDetector,
  EmotionEstimate,
  FaceFrame,
  ToneFeedback,
} from '../../../contracts';
import { api, type ApiEmotionModel } from '../../../core/api';
import { getUserId } from '../../../core/auth';
import { extractFeatures, FEATURE_NAMES, subsample } from '../features';
import { bestGuess, predictProbabilities } from './predict';

/** How quickly the guess reacts. Smaller = smoother but slower (0.15 is ~half a second at 30 fps). */
const SMOOTHING = 0.15;
const MAX_SAMPLES_PER_RECORDING = 30;
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

  async recordSample(label: Emotion, frames: FaceFrame[]) {
    const chosen = subsample(frames, MAX_SAMPLES_PER_RECORDING);
    await api.addSamples({
      user_id: getUserId(),
      feature_names: [...FEATURE_NAMES],
      samples: chosen.map((f) => ({ label, features: extractFeatures(f), source: 'calibration' })),
    });
  }

  async train() {
    this.model = await api.train(getUserId());
    this.smoothed = {};
  }

  async addFeedback(fb: ToneFeedback) {
    const result = await api.feedback({
      user_id: getUserId(),
      utterance_id: fb.utteranceId,
      reply_text: fb.replyText,
      spoken_tone: fb.spokenTone,
      user_tone_ok: fb.userToneOk ?? null,
      partner_reaction: fb.partnerReaction ?? null,
      feature_names: fb.features ? [...FEATURE_NAMES] : null,
      features: fb.features ?? null,
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
