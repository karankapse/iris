# Iris

**An eye-controlled communication app that speaks with feeling.**

Iris helps a person who can't speak or move (for example with ALS or locked-in syndrome)
hold a conversation using only their eyes and an ordinary laptop webcam. Most assistive
communication devices talk in a flat computer voice. Iris chooses an **emotional tone** that
matches what the user feels, and learns each person's own signals over time.

## How it works

1. The conversation partner speaks. The microphone turns it into text.
2. Claude reads the conversation and suggests 3–4 short replies.
3. The user picks one with their eyes (gaze direction, deliberate blinks, dwell).
4. Iris estimates the user's emotion from their face and proposes a tone.
5. The user confirms or changes the tone. **Iris never speaks without confirmation.**
6. The reply is spoken with that tone.
7. Feedback (the user's eye yes/no, the partner's tap) trains that person's own emotion model.

**Privacy:** video is processed locally in the browser and never leaves it. Raw video and audio
are never stored; only numeric face features and labels are saved, on your machine.
**Microphone audio is the exception:** with Muse Voice Transcribe it is streamed (through our
backend, never stored) to Meta's cloud for transcription. See
[docs/architecture.md](docs/architecture.md#privacy).

## The four modules

Each teammate owns one module. Every module ships a **mock**, so you can work without waiting on
the others, and without a camera, microphone, or API key.

| # | Module | Code | Talks to others via |
|---|--------|------|---------------------|
| 1 | **Eye Input**: webcam gaze, blinks, dwell, calibration | `frontend/src/modules/eye-input/` | `EyeInput` in `contracts/eye.ts` |
| 2 | **Emotion Detection & Learning**: per-user emotion model | `frontend/src/modules/emotion/`, `backend/app/services/emotion_trainer.py` | `EmotionDetector` in `contracts/emotion.ts` |
| 3 | **Conversation AI**: speech-to-text, Claude suggestions | `frontend/src/modules/conversation/`, `backend/app/services/llm.py` | `SpeechToText`, `ConversationService` in `contracts/conversation.ts` |
| 4 | **Voice Output & UI**: screens, partner view, emotional TTS | `frontend/src/modules/voice-ui/`, `frontend/src/app/` | `TtsProvider` in `contracts/voice.ts` |

Shared code that affects everyone (change these only through a careful PR):
`frontend/src/contracts/` (TypeScript interfaces) and `backend/app/schemas/` (Pydantic models).
Read [docs/architecture.md](docs/architecture.md) for the full picture.

## Setup

You need: **Node.js 22+**, **[uv](https://docs.astral.sh/uv/)** (installs Python for you), and **Chrome** (for the Web Speech API and webcam).

```bash
git clone <repo-url> iris && cd iris
make setup        # installs frontend + backend dependencies, creates .env
```

## Run it with mocks (no camera, mic, or API key needed)

```bash
make dev-frontend
```

Open http://localhost:5173. With mocks, **your keyboard plays the user's eyes** and the Dev Panel
at the bottom plays the partner and the user's face:

1. Type `Are you hungry?` in *Type what the partner says* and press Enter (or use the microphone, see below).
2. Suggestions appear. Use <kbd>↑</kbd>/<kbd>↓</kbd> and <kbd>Space</kbd> (or <kbd>1</kbd>–<kbd>4</kbd>) to pick one.
3. A tone is proposed. <kbd>Enter</kbd> = speak it, <kbd>Esc</kbd> = change the tone.
4. It speaks. Answer "was the tone right?" with <kbd>Enter</kbd> (yes) or <kbd>Esc</kbd> (no).
5. Click **Open partner view** to see the partner's window and its feedback buttons.

| Key | Eye signal it stands in for |
|---|---|
| <kbd>↑</kbd> <kbd>↓</kbd> | look up / down |
| <kbd>Space</kbd>, <kbd>1</kbd>–<kbd>4</kbd> | select (deliberate blink / dwell) |
| <kbd>Enter</kbd> | confirm ("yes") |
| <kbd>Esc</kbd> | cancel ("no") |

## Run with the backend (real Claude suggestions, emotion training, feedback storage)

```bash
make dev-backend          # API on http://localhost:8000 (docs at /docs)
```

The backend works **without an API key** too: it returns canned suggestions. For real Claude
replies, put your key in `.env` (never commit it):

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

Then tell the frontend to use the backend for suggestions by setting `VITE_MOCK_CONVERSATION=0`
in `.env` and restarting `make dev-frontend`.

## Microphone: speech-to-text with Meta Muse Voice Transcribe

The partner's voice is transcribed by [Muse Voice Transcribe](https://dev.meta.ai/docs/speech-to-text).
The browser never sees your API key: it streams microphone audio to our backend
(`/api/stt/stream`), which forwards it to Meta and relays the text back.

1. Create an API key in the [Meta Model API dashboard](https://dev.meta.ai) and put it in `.env`
   (never commit it): `MODEL_API_KEY=...`
2. Set `VITE_STT_PROVIDER=muse` in `.env`.
3. `make dev-backend` and `make dev-frontend`, allow the microphone in Chrome.

**No key?** Run Meta's protocol locally with a fake server instead:
`cd backend && uv run python -m scripts.fake_muse_server`, then set `MODEL_API_KEY=fake` and
`MUSE_URL=ws://localhost:9000`. It "hears" canned sentences whenever audio arrives.

Cost is $3.00 per 1,000 audio minutes. The connection is only open while the app is.
If Meta rejects the handshake, see `MUSE_BEARER_PREFIX` and `STT_DEBUG` in `.env.example`.

## Switching a module from mock to real

Each module has a flag in `.env` (mock is the default; `0` means real):

| Flag | Real implementation | Status |
|---|---|---|
| `VITE_STT_PROVIDER=muse` | Meta Muse Voice Transcribe via the backend (`MuseSpeechToText`) | works against a fake server; needs a `MODEL_API_KEY` for the real one |
| `VITE_STT_PROVIDER=webspeech` | Browser Web Speech API (`WebSpeechToText`) | works (Chrome; audio goes to Google) |
| `VITE_MOCK_CONVERSATION=0` | Backend + Claude | works |
| `VITE_MOCK_EMOTION=0` | Blendshape features + per-user model (`RealEmotionDetector`) | first version; needs calibration UI |
| `VITE_MOCK_EYE=0` | Webcam gaze/blink (`RealEyeInput`) | **not implemented yet** (Module 1's job) |
| `VITE_TTS_PROVIDER` | `browser` (default) or `silent` | works |

Real eye/emotion modules need the MediaPipe files. Fetch them once (downloads a ~4 MB Google
model file into `frontend/public/`, which is git-ignored):

```bash
cd frontend && npm run setup:mediapipe
```

## Checks

```bash
make lint        # ESLint + Prettier + tsc, Ruff
make test        # Vitest + pytest
make format      # auto-fix formatting
make gen-types   # after changing backend/app/schemas/: regenerate the frontend API types
```

CI runs the same checks on every pull request.

## Project layout

```
frontend/src/
  contracts/      shared TypeScript interfaces (the contract between modules)
  shared/         api.generated.ts, generated from the backend, do not edit
  core/           FaceTracker (webcam + MediaPipe), API client, config flags
  modules/        eye-input/  emotion/  conversation/  voice-ui/   (each has real/ and mock/)
  app/            state machine, orchestrator, service wiring, styles
backend/app/
  schemas/        Pydantic models (source of truth for HTTP payloads)
  routers/        /api/suggestions  /api/emotion/*  /api/feedback
  services/       Claude client, canned mock, emotion trainer
docs/             architecture notes
```

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md): branch names, commit messages, and the pull request process.
