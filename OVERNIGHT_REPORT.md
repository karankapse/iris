# Overnight report: Iris eye tracking (branch `overnight`)

Work happened only in `~/Documents/iris-overnight` (local git, branch `overnight`, no remote). Nothing
was pushed, no API keys were added, no paid API was called, and nothing was downloaded (no packages, no
model weights). `~/Documents/iris` and `~/Documents/iris-demo` were not touched.

**Checks at the end:** frontend 283 tests (243 at the start), tsc, eslint, prettier all green; backend
51 tests, ruff, ruff format all green (backend test count unchanged, one test extended). `vite build`
also succeeds (into a scratch folder).

## TL;DR

1. **The main cause of "the dot follows well in training but not in the check round" was found:**
   WebGazer's regression only remembers its **last 50 training samples** (a ring buffer hard-coded in
   `webgazer/src/util_regression.mjs`, `InitRegression: var dataWindow = 50`). Calibration records
   ~16 samples per dot, so after 13 dots WebGazer had forgotten all but the last ~3 dots (the bottom-left
   ones). During training the dot looked great because WebGazer had *just* learned that spot; in the check
   round it was predicting the whole screen from 3 dots. Fixed (memory raised to 300), and the pipeline now
   uses its own, cross-validated regression on WebGazer's eye-patch features instead.
2. The rest of the night went into a **simulated person + benchmark** (so every eye-tracking change is
   measured, not guessed) and the requested improvements. In simulation, the default pipeline went from
   **86% → 100% column accuracy, horizontal error 97 → 34 px, dwell selections 52 right / 3 wrong → 60 right
   / 0 wrong (of 60)**, 5 simulated people. *Simulation only: nothing here was verified on a real camera.*
3. No external gaze model was integrated: none is both clearly better and licence-clean (see Research).

## Commits (oldest first)

| Commit | What |
|---|---|
| `bbf4e6a` | fix: a dwell could complete from camera frames alone after the screen-gaze stream stopped (selection with no gaze evidence) |
| `1215831` | fix: Chrome speech: words never finalized were lost when the recognizer restarted mid-sentence |
| `b222a9f` | fix: first-letter typing dropped guesses written with a typographic apostrophe ("I’m") |
| `6d17d1b` | **fix: WebGazer forgot all but the last ~3 calibration dots** (50-sample memory → 300) |
| `ff7d2b1` | fix: after a reload the camera panel said "calibrated" but WebGazer had no training at all |
| `cd31a03` | test: simulated person + gaze benchmark |
| `ff5a4bf` | refactor: shared ridge regression with fast leave-one-dot-out CV (`core/gaze/ridge.ts`) |
| `6dd0b98` | feat: own eye-patch model; honest check round (held-out), then its data joins the training |
| `c284084` | feat: ignore the tracker during blinks; tolerant dwell (grace); optional fixation detection (I-DT) |
| `a0410c1` | feat: learn head-turn compensation gain **and sign** from calibration data; optional head-turn step |
| `cc58064` | feat: learn from confirmed selections during use (drift offset; optional re-fit) |
| `e6f738a` | feat: two half-length training passes (2nd reversed) instead of one |
| `4f6b310` | feat: debug overlay (Alt+D) shows tracker in use, learned head gains, drift, "eyes moving" |
| `08518f7` | test: "before vs after" benchmark |

## A. Code review and bug fixes

Each fix has a test that fails without it.

1. **WebGazer's 50-sample memory** (`6d17d1b`) — see TL;DR. `WebGazerGaze.widenMemory()` raises the
   `windowSize` of the four click buffers after `begin()` and after `clearData()` (which re-creates them).
   Test runs against WebGazer's real `ridgeReg.mjs`. Cost: WebGazer re-solves its ridge regression every
   frame; measured in Node (M-series Mac) ~1.5 ms/frame at 50 samples, ~6 ms at 300. With our own model
   active (below) this memory mostly matters for the live dot during the first pass and as a fallback.
2. **Calibration "survived" reloads only on paper** (`ff7d2b1`). `webgazer.recordScreenPosition()` never
   saves (only real mouse-click training is stored), yet the calibrated flag was in localStorage, so after a
   reload the app claimed "calibrated" while WebGazer returned nothing. The flag is now per page session and
   the misleading comment was corrected. (Persisting our own models across reloads would need WebGazer to
   emit features without native training: see NEXT_PROMPT.)
3. **Dwell completing without gaze** (`bbf4e6a`). `RealEyeInput.onFrame` kept advancing a dwell using the
   last known gaze point after WebGazer went quiet (face lost for it, or `null` readings) while MediaPipe
   frames kept coming.
4. **Chrome speech lost words** (`1215831`). When a recognition session ended with an unfinalized interim
   result, the next session's first interim replaced it. `TurnDetector.keepInterim()` on `onend`.
5. **"I’m" in first-letter typing** (`b222a9f`). Typographic apostrophes split one word into two, so a
   correct guess failed the letter check and was dropped; dedupe treated `I’m`/`I'm` as different.
6. **Check round judged in-sample** (part of `6dd0b98`). The affine correction was fitted on the 6 check
   dots and then judged ("do no harm") and reported on the same 6 dots. Now each check dot is scored with a
   correction learned from the other 5, and the models used for the measurement never saw any check dot.
7. **Blink garbage** (part of `c284084`). WebGazer keeps predicting while the eyes are closed (it reads the
   eyelid), the dot jumped far away and dragged the One Euro filter. FilteredGaze now skips tracker points
   while MediaPipe sees the eyes closed and for 100 ms after (switch: `skipBlinks`).

Reviewed without finding real bugs: `turnDetector.ts` (apart from #4), `prosody.ts`, `BrowserTts.ts`,
`voices.ts`, `conversation_memory.py`, `routers/conversation.py`, `initials.py`, `llm.py expand_initials`,
`machine.ts` quickType/qtMore (stale-response guard via `expandId` is correct), UI effects (all
listeners/timers cleaned up). Minor, not fixed: `GET /conversation/memory` reports `count` capped at 500;
`ExpandRequest.initials` max 30 letters (a 31-word sentence gets a 422); `Orchestrator.remember` and
`MemoryPanel` hard-code `'local-user'` instead of `USER_ID` (same value).

## B. Eye-tracking improvements (all behind tests, all switchable)

### The simulation (B.6) — `src/modules/eye-input/real/sim/`
`person.ts`: a seeded person with reaction delay, fixational jitter, natural blinks, head wander
(Ornstein-Uhlenbeck on yaw/pitch/sideways position), a noisy MediaPipe-like face frame (iris position
along the eye = eye-in-head angle + noise, eyeLook blendshapes, EAR, noisy head pose), WebGazer-like
eye-patch "pixels" that darken where the iris is (a bump, i.e. **non-linear** in gaze — this is what
makes 3 dots not generalise), lighting drift, occasional NaN, and a simulated WebGazer that learns
**exactly like the real one** (no intercept, λ = 1e-5, fixed memory). `harness.ts` runs the *real*
`RealEyeInput.calibrate()` + `FilteredGaze`, then a use phase (rest → option → rest…, the person keeps
looking until the dwell selects or 5 s), with optional drift/slump scripts. `benchmark.test.ts` prints
a table and asserts only the conclusions relied on:

```
cd frontend && npx vitest run src/modules/eye-input/real/sim --silent=false
```

The simulation reproduces the reported symptom: WebGazer's own error in the check round ~400 px with the
50-sample memory vs ~120–140 px with 300 (the pipeline masked part of it via the landmark estimate).
Noise levels were set so the tracker lands at typical webcam accuracy (~100–150 px on a 1024 px screen,
i.e. ~3–4°), not to favour any method. **It is still a model: every number below is simulation.**

### B.1 Check round: measure honestly, then learn from it (`6dd0b98`)
- FilteredGaze now keeps every calibration sample (landmark features, eye-patch features, WebGazer's own
  point, head pose, dot, kind). `observe()` records without teaching WebGazer.
- Report + "do no harm" use models fitted **without** any check dot, and a leave-one-check-dot-out
  correction. Then the check samples join the training, models are re-fitted and the correction re-learned
  for them (option `calLearnFromCheck`, default on).
- Evidence: neutral. 5 people, earlier pipeline: 83.3 → 81.4 px; 8 people with the final pipeline:
  35.0 → 34.8 px. Learning the correction from held-out (CV) predictions instead was **worse** (92 px:
  it over-stretches, because in use the person looks at trained spots), so that variant was dropped.

### Own eye-patch model (part of `6dd0b98`)
WebGazerGaze hands over WebGazer's per-frame 120 eye-patch features (`webgazer.util.getEyeFeats`);
FilteredGaze learns a ridge regression with intercept and λ chosen by leave-one-dot-out CV, fitted once
(not re-solved per frame). Falls back to WebGazer's regression without features. Sim with 120 features:
WebGazer 127 px vs own 106 px raw error. Switch: tuning panel "Own eye-patch model" (`patchModel`).
Cost: one extra `getEyeFeats` per frame (WebGazer creates small canvases for it; <1 ms expected, not
measured in a browser).

### B.2 Online learning from confirmed selections (`cc58064`)
`onlineLearning.ts` + `Orchestrator`: when a reply **chosen with the eyes** is spoken **to the end**, the
last second before that selection (only frames whose estimate was in the selected box, ≥80%; blinks are
never remembered) is used to nudge a bounded **drift offset** toward the option (`driftRate` 0.3, max 15%
of the screen) and, if `onlineRefit` is on, added as ≤8 training samples + model re-fit. Rate limit 1 per
5 s, cap 400 online samples, must be confirmed within 30 s; never from a stopped reply, a cancel blink,
or a reply not chosen with the eyes. Evidence (1-pass era, person slumps 4–5° over 2 min): last-third
column accuracy 58% none / **98% drift** / 61% re-fit only; with the final two-pass calibration the slump
hurts much less (97% none → 100% drift, 98% re-fit). Worst case (wrong selections also confirmed) still
helped. Default: on, drift only (re-fit off: no benefit over drift, costs a model fit per confirmation).

### B.3 Fixation detection (`c284084`)
`fixation.ts` (I-DT, dispersion over a 150 ms window). Dwell now accumulates time and a short exit
(< `dwellGraceMs` 250 ms: noise blip, blink, saccade) only pauses it. Evidence: fixation detection with a
10% box stopped half of all selections (webcam gaze is too noisy for a tight box) and never helped, so it
is **off by default** (`fixSpread` 0, slider in the tuning panel). Grace: small gain (e.g. person 58:
8 → 10 of 12 correct).

### B.4 Head-pose compensation learned (`a0410c1`)
`headGain.ts`: residual (dot − estimate from models that didn't train on that dot) regressed on head
rotation away from the calibration pose, **within each dot only** (people turn toward targets), shrunk
toward 0, kept only if > 2 SE and ≤ 80 px/°; else 0 (off). Optional calibration step "keep looking at the
dot and slowly turn your head" (`calHeadStep`, off: many users can't move their head). Evidence (5 people):
head still → learned 0 = same as off (95.6%), fixed +20 → 90.9% (**the simulated effect has the opposite
sign to the old guess**); head moving a lot (sd 5°) → learned 83.0% vs off 72.1% vs fixed +20 63.6%. The
head step did not help (it learned ~−33 px/° which over-compensates in normal use).

### B.5 Two passes (`e6f738a`)
Two half-length passes (2nd reversed, 500 ms settle) vs one: 8 people, 66 → 35 px horizontal error,
94–95% → 99.9–100% column accuracy. At **equal time** (~47 s) still 32 vs 46 px. Adopted; calibration
goes from ~40 s to ~47 s (SetupPanel text updated). Options `passes`, `collectScale`.

### Before vs after (`08518f7`, 5 people, switched back where possible)
before: column 86%, horizontal error 97 px, 52 right / 3 wrong of 60 → after: 100%, 34 px, 60 / 0.

### New tuning-panel controls (Alt+T)
Gaze filter: "Own eye-patch model", "Ignore the tracker while the eyes are closed", "Learn during use
(drift)". Dwell: "Dwell grace", "Fixation spread". Learning: learn from confirmed selections, re-fit,
learn from check dots, learn head compensation, head-turn step. The calibration report shows the learned
head gains; Alt+D shows the tracker in use, learned head gains, drift and "eyes moving".

## C. Research: browser gaze estimation for a 3-zone selector

| Option | Code licence | Weights / data licence | Browser | Speed | Reported accuracy | Maintenance | Verdict |
|---|---|---|---|---|---|---|---|
| MediaPipe Face Landmarker iris (in use) | Apache-2.0 | Apache-2.0 (Google) | yes (WASM/GPU) | real-time | n/a (landmarks; we regress per person) | active | keep; our landmark model uses it |
| WebGazer (in use) | GPL-3.0 | none (per-user ridge) | yes | ~real-time | ~4° typical | unmaintained | keep as feature extractor/fallback; GPL is a product question |
| [WebEyeTrack / BlazeGaze](https://github.com/RedForestAI/WebEyeTrack) ([paper](https://arxiv.org/html/2508.19544v1)) | MIT (npm `webeyetrack` 0.0.2, 2025-09) | **undocumented**; trained on GazeCapture (research-only dataset) | yes, TF.js | 0.9 ms/frame desktop, 670 KB model | 2.32 cm GazeCapture, 4.56 cm MPIIFaceGaze, few-shot k≤9, head-pose aware | young, low activity | most promising; **blocked on weights licence** (ask authors) |
| [EMC-Gaze / EyeTrax](https://arxiv.org/html/2603.12388) | not released yet | own data (32 people) | ONNX Runtime Web, ~12.6 ms | 4.8 MB | 5.8° after 9-point calibration | 2026 preprint | watch; code "to be released" |
| [L2CS-Net](https://github.com/Ahmednull/L2CS-Net) | MIT | weights trained on Gaze360/MPIIGaze (non-commercial research data), Google Drive | would need ONNX conversion (ResNet-50, large) | GPU-class | ~3.9° MPIIGaze (within-dataset) | stale | no (licence, size) |
| [MobileGaze (yakhyo)](https://github.com/yakhyo/gaze-estimation) | MIT, ONNX on GitHub releases (4.8 MB MobileOne) | trained on Gaze360 (research-only terms) | ONNX Runtime Web feasible | fast | 11–13° MAE on Gaze360 (uncalibrated) | active | no: licence of training data, and 12° is coarser than our calibrated iris features |
| ETH-XGaze baselines / GazeTR | research code | ETH-XGaze CC BY-NC-SA | conversion needed | — | ~4–5° within dataset | — | no (NC) |
| [OpenFace 3.0](https://github.com/CMU-MultiComp-Lab/OpenFace-3.0) | **non-commercial research only** | same | no | — | — | 2025 | no |
| [EyeGestures](https://github.com/NativeSensors/EyeGestures) | GPL-3.0 (+ commercial) | — | JS "Lite" version | — | — | active | no gain over WebGazer licence-wise |
| [Google Look to Speak](https://blog.google/company-news/outreach-and-initiatives/accessibility/look-to-speak/) | app, not a library | — | Android | — | coarse left/right/up gestures | — | **design lesson**, see below |
| [SpeakFaster](https://www.nature.com/articles/s41467-024-53873-3) | paper (Google + Team Gleason) | fine-tuned LLMs, not released | — | — | 57% fewer motor actions; 29–60% faster text entry for 2 ALS users | 2024 | validates first-letter typing; idea: mixed initials + spelled keywords (KeywordAE) |

Design lessons: Look to Speak works with a phone camera because it needs only **coarse, extreme**
gestures (look far left / far right, look up to pause), with adjustable "off-screen distance" and dwell.
Iris's 3 columns are a similar coarse task; an optional "look past the screen edge" mode for left/right
would be very robust with webcams. SpeakFaster confirms that initials-based expansion with conversation
context is the right direction for quick typing.

Decision: **nothing integrated**. The only candidate clearly worth trying (WebEyeTrack) has weights of
unclear licence trained on a research-only dataset, which the overnight rules exclude. The plumbing to
add one is ready: per-frame outputs as extra features into the landmark model (`BASE_FEATURES`) or a
second `EyeFeatureSource`, both weighed by measured, cross-validated error.

## What could NOT be verified without a real camera
- Everything above is simulation + unit tests. Real eye patches, real head-pose sign conventions, real
  blink behaviour of WebGazer, real drift are all modelled, not observed.
- The sign/size of the learned head gain on a real person (the report and Alt+D now show it).
- Per-frame cost in the browser: WebGazer at 300 samples (~6 ms in Node) + our `getEyeFeats` call +
  model fits at the end of calibration (~50–150 ms expected with 120 features) and optional online re-fit.
- That `webgazer.util.getEyeFeats` receives `data.eyeFeatures` in the real library (it does in 3.5.3
  source and dist; untested live).
- Whether users look at the words' centre (the drift offset assumes the target is `TARGET_POSITION`).

## Risks
- The drift offset learns from *confirmed* selections; if a user routinely lets wrong replies be spoken,
  it may learn a wrong offset (bounded to 15%, rate-limited; simulated worst case still helped).
- Two passes make calibration ~7 s longer (fatigue for ALS users).
- Head compensation is now usually **off** after calibration (learned 0 when the head didn't move) where
  it used to be +20 px/°; if the real sign of +20 was right, big head movements are less compensated
  until the head-turn step or manual sliders are used.
- WebGazer remains GPL-3.0.

## How to try it
```
cd ~/Documents/iris-overnight/frontend
npm run setup:mediapipe      # if public/ assets are missing (copies WebGazer/MediaPipe files locally)
npx vite --port 5199         # NOT 5173 (the demo); note: /api is proxied to :8000 (the demo backend)
```
Setup → Calibrate eyes (≈50 s, two passes). Alt+D debug overlay, Alt+T tuning panel (all new switches
are there). Benchmark table: `npx vitest run src/modules/eye-input/real/sim --silent=false`.
