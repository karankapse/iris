import type { Emotion, EmotionEstimate } from '../../../contracts';
import type { ApiEmotionModel } from '../../../core/api';

/**
 * Run the exported logistic-regression model in the browser. This mirrors what the backend
 * trained (see `EmotionModel` in backend/app/schemas/emotion.py):
 *   scaled = (x - mean) / scale;  logits = coef · scaled + intercept;  probs = softmax(logits)
 *
 * `values` is a name -> number map so the model still works if our feature list is reordered.
 */
export function predictProbabilities(
  model: ApiEmotionModel,
  values: Record<string, number>,
): Record<Emotion, number> {
  const scaled = model.feature_names.map(
    (name, j) => ((values[name] ?? 0) - model.means[j]) / (model.scales[j] || 1),
  );
  const logits = model.coef.map((row, c) =>
    row.reduce((sum, w, j) => sum + w * scaled[j], model.intercept[c]),
  );
  const max = Math.max(...logits);
  const exps = logits.map((z) => Math.exp(z - max)); // subtract max for numerical stability
  const total = exps.reduce((a, b) => a + b, 0);

  const probs: Partial<Record<Emotion, number>> = {};
  model.classes.forEach((c, i) => (probs[c] = exps[i] / total));
  return probs as Record<Emotion, number>;
}

export function bestGuess(probs: Partial<Record<Emotion, number>>): EmotionEstimate {
  let best: EmotionEstimate = { emotion: 'neutral', confidence: 0 };
  for (const [emotion, p] of Object.entries(probs)) {
    if (p > best.confidence) best = { emotion: emotion as Emotion, confidence: p };
  }
  return best;
}
