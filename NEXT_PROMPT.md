# Prompt for the next session (paste as-is)

You are continuing work on **Iris**, an eye-controlled communication app for people who can't speak or
move (ALS / locked-in): webcam gaze picks one of 3 columns (left / middle / right, "rest" band on top) by
dwell or a deliberate blink; Claude suggests replies; they are spoken with an emotional tone.

Last night an agent worked on branch `overnight` in `~/Documents/iris-overnight` (local only). Read
`~/Documents/iris-overnight/OVERNIGHT_REPORT.md` first. Short version:
- Root cause of "the dot follows in training but not in the check round": WebGazer only remembered its
  last 50 training samples (≈3 dots). Fixed; plus our own cross-validated regression on WebGazer's
  eye-patch features, honest check round, blink skipping, tolerant dwell, learned head compensation,
  learning from confirmed selections (drift offset), two calibration passes.
- All evidence is from a simulated person (`frontend/src/modules/eye-input/real/sim/`), **nothing was
  verified on a real camera.**

Environment: `export PATH="$HOME/.local/node/bin:$HOME/.local/bin:$PATH"`. Checks that must stay green:
frontend `npx tsc --noEmit && npm run -s lint && npm run -s format:check && npx vitest run`
(283 tests), backend `uv run ruff check . && uv run ruff format --check . && ANTHROPIC_API_KEY= MODEL_API_KEY= uv run pytest -q` (51 tests).

## Priority 1 — test with a real camera (needs the human)
Run the overnight branch (`cd frontend && npx vite --port 5199`; note `/api` is proxied to :8000) and
with the person at the laptop:
1. Calibrate (Setup → Calibrate eyes, ~50 s). With **Alt+D** open, confirm the "Tracker" line says
   "own eye-patch model" after the first pass, and compare our point vs WebGazer's own.
2. Check round: does the red dot keep following now? Screenshot the calibration report (zones %, raw vs
   final error, learned head gains).
3. In use: select each column 10 times; count right / wrong / missed and time to select. Then toggle in
   **Alt+T** and repeat: "Own eye-patch model" off; "Ignore the tracker while the eyes are closed" off;
   drift rate 0. Record which settings help on the real person.
4. Head: look at one spot and turn the head slowly. Does the dot stay? Does the learned head gain
   (report / Alt+D) have the right sign? Try the optional "head-turn step" in Alt+T → Learning.
5. Performance: Chrome DevTools Performance for 10 s of use; note ms per frame (WebGazer now keeps 300
   samples, ~6 ms in Node) and the length of the model fit at the end of calibration.
6. After ~10 minutes of use (posture changes), does accuracy hold? Watch the drift offset in Alt+D.

## Priority 2 — decide with the numbers from Priority 1
- Keep or revert each default (two passes, drift learning, patch model, blink skip, head gain).
- If our model isn't used (features missing), check `webgazer.util.getEyeFeats` on `data.eyeFeatures`
  in `core/gaze/WebGazerGaze.ts`.
- Make the simulation match what was measured (noise levels, head effect sign) in `sim/person.ts`.

## Priority 3 — engineering follow-ups (no camera needed)
1. Survive reloads: persist our fitted models (already saved in `iris.gazeCalibration.v1`) and prime
   WebGazer with one sample at start so its callback delivers eye features; then `status().calibrated`
   can be true again after a reload (and a quick 6-dot "check only" re-validation could replace a full
   recalibration).
2. Our own eye-patch extraction from MediaPipe landmarks (the same video frame as the iris features),
   which would remove the second camera stream and, eventually, the GPL WebGazer dependency.
3. Look-to-Speak-style optional mode: select left/right by looking *past* the screen edge (very robust
   with webcams), look up to pause.
4. WebEyeTrack (MIT code, BlazeGaze in TF.js, 670 KB): ask the authors (RedForestAI) about the licence
   of the weights (trained on GazeCapture, research-only). If permissive, add it behind a flag as an
   extra estimate (per-frame outputs into `frame.metrics` + `BASE_FEATURES` in `landmarkModel.ts`).
5. Quick typing: SpeakFaster-style mixed input (initials plus some fully spelled words).
6. Minor: `GET /conversation/memory` count is capped at 500; `'local-user'` literals vs `USER_ID`.

Rules as before: work on a branch, small green commits, don't touch the running demo (ports 5173/8000),
no paid API calls in tests, no new API keys.
