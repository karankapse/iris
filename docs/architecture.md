# Architecture

## Big picture

```
 mic ──> SpeechToText ─┐                                        ┌─> TtsProvider ──> speaker
                       ├─> Orchestrator (state machine) ────────┤
 webcam ─> FaceTracker ┤        │  ▲                            └─> Partner view (2nd window)
            │          │        ▼  │
            ├─> EyeInput ───> events: highlight / select / confirm / cancel
            └─> EmotionDetector ──> {emotion, confidence}
                                        │
   Backend (FastAPI): Claude suggestions · emotion samples + training · feedback storage
```

Everything in the browser talks through the interfaces in `frontend/src/contracts/`.
`frontend/src/app/services.ts` is the only place that picks the mock or real implementation.

## One camera, one FaceTracker

Eye Input and Emotion Detection both need the face, but a webcam can't be opened twice and
MediaPipe is heavy. So `core/face/MediaPipeFaceTracker.ts` owns the camera and emits `FaceFrame`s
(gaze estimate, blendshape scores, head pose) that both modules subscribe to. Video frames
never leave that class. Only numbers are passed around.

## The conversation state machine

`app/machine.ts` is a pure function `(state, event) -> (state, effects)`.

```
listening ─> suggesting ─> selectReply ─> confirmTone ─> speaking ─> feedback ─> listening
                              │             │   ▲
                            typing        pickTone
```

- **Only `confirmTone` + confirm leads to `speaking`.** That's the "never speak without confirmation" rule, covered by tests.
- Choosing a *different* tone returns to `confirmTone` instead of speaking, so the user always confirms.
- At most 4 options per screen (3 AI suggestions + "Type my own reply").
- The machine returns *effects* (call the AI, speak, save feedback); `app/Orchestrator.ts` runs them. That keeps the rules testable without React, a camera, or a network.

### Which tone is proposed?

1. The user's persistent **mood** setting, if set (saves effort: no tone choice every message);
2. otherwise the emotion **detected** from their face, if confidence ≥ 0.5;
3. otherwise the tone **Claude suggested** for that reply.

## Emotion learning loop

Paralyzed users often can't make typical expressions, so we don't use a generic model.

1. **Calibration:** the user/caregiver records examples of the user's own signal for each emotion
   (`recordSample`). Features are MediaPipe blendshapes (`modules/emotion/features.ts`); blink
   shapes are excluded because blinks are the control signal.
2. **Training:** the samples go to `POST /api/emotion/samples`, then `POST /api/emotion/train`
   fits a scikit-learn logistic regression per user.
3. **Prediction in the browser:** the backend returns the weights as JSON (`EmotionModel`).
   `modules/emotion/real/predict.ts` computes standardise → linear → softmax locally: no per-frame network calls.
4. **Feedback:** after each reply, the user's eye yes/no and the partner's tap are stored. A
   "yes, the tone was right" answer turns the face features from that moment into a new training
   sample (`routers/feedback.py`). Retraining then improves the model.

## Type sharing between frontend and backend

- **HTTP payloads:** Pydantic models in `backend/app/schemas/` are the source of truth.
  `make gen-types` exports `backend/openapi.json` and generates
  `frontend/src/shared/api.generated.ts`. CI fails if you forget.
- **In-browser interfaces** (`EyeInput`, `TtsProvider`, …) are hand-written in `contracts/`.
- `Emotion` exists in both places. `core/api.ts` has a compile-time check that the lists match.

## Privacy

- Camera and microphone are processed in the browser. Raw video/audio is never stored or uploaded.
- The backend stores only numeric features, labels, and reply text, in local SQLite (`backend/data/`, git-ignored).
- The Claude API receives conversation text (partner speech transcripts and the user's replies), which is necessary for suggestions.
- **Known gap:** Chrome's Web Speech API sends microphone audio to Google for recognition. The
  `SpeechToText` interface lets us replace it with a local Whisper implementation.

## Adding or swapping an implementation

- **New TTS provider:** implement `TtsProvider` (`contracts/voice.ts`), add a case in
  `modules/voice-ui/tts/index.ts`, and select it with `VITE_TTS_PROVIDER`.
- **Whisper STT:** implement `SpeechToText` and return it from `services.ts` when a flag is set.
- **New emotion:** add it to `EMOTIONS` (`contracts/emotion.ts`) *and* `Emotion` in
  `backend/app/schemas/common.py`, add a voice profile in `emotionProfiles.ts`, then `make gen-types`.

## Known limitations of the first version

- `RealEyeInput` is a stub; the mock (keyboard) drives the demo.
- `MediaPipeFaceTracker` gaze maths and landmark indices are written from MediaPipe's documentation but haven't been tested against a real camera yet.
- The eye keyboard for custom replies is a plain text box for now.
- Single local user (`local-user`); no profile switching.
