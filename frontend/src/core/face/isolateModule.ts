// Two copies of Google's MediaPipe engine run on this page: WebGazer's (for screen gaze) and the one
// we use for blinks and emotion (@mediapipe/tasks-vision). Both are built with Emscripten, and
// WebGazer's leaves a global `window.Module` behind. tasks-vision starts up with
// `self.ModuleFactory(self.Module || ...)`, so if WebGazer loaded first it grabs WebGazer's object
// and crashes ("Module.noExitRuntime has been replaced ..."). Fix: hide the global while our engine
// starts, then put it back so WebGazer keeps working.

type WithModule = { Module?: unknown };

/** Run `start` with `window.Module` temporarily removed, restoring it afterwards (even on errors). */
export async function withoutGlobalModule<T>(start: () => Promise<T>): Promise<T> {
  const g = globalThis as WithModule;
  const saved = g.Module;
  g.Module = undefined;
  try {
    return await start();
  } finally {
    g.Module = saved;
  }
}
