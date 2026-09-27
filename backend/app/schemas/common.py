from typing import Literal

# Keep in sync with `frontend/src/contracts/emotion.ts` (EMOTIONS).
# The generated TypeScript types will fail CI if this drifts.
Emotion = Literal["neutral", "happy", "sad", "excited", "joking", "serious"]
Speaker = Literal["partner", "user"]
