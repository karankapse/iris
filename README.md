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

## Status: work in progress

Working: real camera face tracking with a zoomed live preview, eye control (options in the four
screen corners, chosen by looking + dwell or a blink, or up/down + blink in vertical-only mode),
calibration with an accuracy check, speech-to-text (Meta Muse, or Chrome's as a fallback), Claude
suggestions that use a profile of the user, **quick-access phrases**, an **eye-controlled
keyboard**, **mood chosen by eye**, emotion detection with a per-user model that **retrains itself**
from feedback, tone confirmation, emotional TTS in six tones (incl. excited), the partner view with a
"typing…" indicator, a **tone tester** page (`/tone-tester`), and **adjustable settings** (dwell time,
blink length, gaze steadiness, speech speed, double-blink).

**Not built / not verified yet:** LiveKit + Cartesia voice and LiveKit speech-to-text (see
[docs/architecture.md](docs/architecture.md)); the real Muse and Claude calls have never run with real keys;
eye control has been tried on one face. Word prediction on the eye keyboard is a possible next step.

## Setup

You need: **Node.js 22+**, **[uv](https://docs.astral.sh/uv/)** (installs Python for you), and **Chrome** (camera + microphone).

```bash
git clone git@github.com:karankapse/iris.git && cd iris
make setup        # installs dependencies, downloads the face model, creates .env
make dev          # starts the backend (8000) and the web app (5173)
```

Open http://localhost:5173 in **Chrome** and allow the camera and microphone. Click
**Set up / calibrate** first (about 15 seconds: look straight, left, right, up, down, close your eyes).

`.env` is created from `.env.example` and is **real mode by default** (camera, microphone).
To work without hardware, switch a module to its mock in `.env`, for example:

```bash
VITE_MOCK_EYE=1          # the keyboard plays the eyes
VITE_MOCK_EMOTION=1      # pick the "detected" emotion in the Dev Panel
VITE_STT_PROVIDER=mock   # type what the partner says in the Dev Panel
```

## How to control it with your eyes

Gaze tracking uses **[WebGazer](https://github.com/brownhci/WebGazer)**: it learns, from *your* calibration,
where on the screen you are looking, and a **red dot** shows what it thinks (toggle it in the Menu).

**Calibrate first** (click **Calibrate**, about 40 seconds): dots appear around the screen and you look at
each one. No clicking is needed (the app trains it for you), so it works for people who can't use a mouse.
Then close your eyes for a moment (learns your blink), then a short **accuracy check** tells you what
percentage of readings landed in the right box. Keep your head still and the room well lit.

Up to four options are shown in the **four corners** of the screen (a 2×2 grid, reading order):

| Do this | What happens |
|---|---|
| Look at a corner | that option lights up |
| Keep looking (about 1.5 s) | a bar fills, then the option is selected (**dwell**) |
| **Blink deliberately** (about 0.5 s) while looking at it | selects it right away |
| Look at the middle (face / "Partner said") | rest: nothing is selected |
| Keep your **eyes closed** (about 1.5 s) | cancel / go back |

Natural blinks are ignored, and after a selection you must look back at the middle before the next
dwell can complete. Iris never speaks until you confirm the tone.

**Vertical-only mode** (tick "vertical-only eyes" in the Menu) is for people who can only move their
eyes up and down: options are stacked, look up/down to move the highlight, and blink to select.

With the keyboard mock (`VITE_MOCK_EYE=1`): arrow keys move, <kbd>Space</kbd> or <kbd>1</kbd>–<kbd>4</kbd>
select, <kbd>Enter</kbd> confirm, <kbd>Esc</kbd> cancel.

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

## Licensing note: WebGazer is GPL-3.0

WebGazer is licensed **GPL-3.0-or-later** and is no longer maintained (it still works). If Iris is
distributed with it, Iris should itself be released under a GPL-compatible license. This repository
does not have a `LICENSE` file yet: the team should decide on one. To avoid the dependency, set
`VITE_GAZE_ENGINE=mediapipe` (the older classifier over MediaPipe face signals).

## Mock or real, per module

Each module is chosen in `.env` (`.env.example` defaults to real):

| Setting | Real | Mock | Status of the real one |
|---|---|---|---|
| `VITE_MOCK_EYE` | `0`: webcam gaze + blinks (`RealEyeInput`) | `1`: keyboard | gaze via WebGazer (`VITE_GAZE_ENGINE=webgazer`, default), `mediapipe`, or `mouse` (the pointer stands in for the eyes, for testing without a camera); tried on one face |
| `VITE_MOCK_EMOTION` | `0`: face features + per-user model | `1`: Dev Panel | works after calibration; no auto-retraining yet |
| `VITE_STT_PROVIDER` | `muse` (needs `MODEL_API_KEY`) or `webspeech` (Chrome; audio goes to Google) | `mock` | Muse verified only against a fake server, not the real API |
| `VITE_MOCK_CONVERSATION` | `0`: backend + Claude (canned replies without an Anthropic key) | `1` | Claude call never tested with a real key |
| `VITE_TTS_PROVIDER` | `browser` | `silent` | works |

The face model and wasm files are fetched by `make setup` (or `cd frontend && npm run setup:mediapipe`)
into `frontend/public/`, which is git-ignored (~4 MB from Google's model storage).

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

## Optional: pre-commit checks

```bash
uv tool install pre-commit && pre-commit install
```

Runs Ruff, Prettier and ESLint before each commit (CI runs them on every PR regardless).
A demo script for presenting the app is in [docs/demo-script.md](docs/demo-script.md).

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md): branch names, commit messages, and the pull request process.
