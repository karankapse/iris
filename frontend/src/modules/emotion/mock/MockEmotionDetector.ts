import type { Emotion, EmotionDetector, EmotionEstimate, ToneFeedback } from '../../../contracts';

/**
 * Fake emotion detector for development. The Dev Panel calls `setEmotion` so you can pretend
 * the user's face shows any emotion. It also logs calibration/feedback calls to the console.
 */
export class MockEmotionDetector implements EmotionDetector {
  private estimate: EmotionEstimate = { emotion: 'neutral', confidence: 0 };

  setEmotion(emotion: Emotion, confidence = 0.8) {
    this.estimate = { emotion, confidence };
  }

  onFrame() {}
  current() {
    return this.estimate;
  }
  currentFeatures() {
    return null;
  }
  async recordSample(label: Emotion) {
    console.info('[mock emotion] recordSample', label);
  }
  async train() {
    console.info('[mock emotion] train');
  }
  async addFeedback(feedback: ToneFeedback) {
    console.info('[mock emotion] feedback', feedback);
  }
}
