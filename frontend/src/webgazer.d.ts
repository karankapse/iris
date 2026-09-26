// WebGazer ships no TypeScript types. It is loaded as a plain <script> (public/webgazer/webgazer.js,
// see core/gaze/WebGazerGaze.ts) and appears as window.webgazer. This declares just the parts we use.
interface WebGazerApi {
  params: { faceMeshSolutionPath: string; saveDataAcrossSessions: boolean };
  setRegression(name: string): WebGazerApi;
  setGazeListener(
    listener: (data: { x: number; y: number } | null, elapsedMs: number) => void,
  ): WebGazerApi;
  clearGazeListener(): WebGazerApi;
  saveDataAcrossSessions(save: boolean): WebGazerApi;
  applyKalmanFilter(apply: boolean): WebGazerApi;
  showVideo(show: boolean): WebGazerApi;
  showVideoPreview(show: boolean): WebGazerApi;
  showFaceOverlay(show: boolean): WebGazerApi;
  showFaceFeedbackBox(show: boolean): WebGazerApi;
  showPredictionPoints(show: boolean): WebGazerApi;
  /** Opens the camera and starts predicting. Rejects if the camera cannot be used. */
  begin(onFail?: () => void): Promise<WebGazerApi>;
  /** Stops predicting and releases the camera. */
  end(): WebGazerApi;
  /** Learn: the person is looking at (x, y) right now. */
  recordScreenPosition(x: number, y: number, eventType?: string): WebGazerApi;
  removeMouseEventListeners(): WebGazerApi;
  /** Forget everything learned (memory and saved data). */
  clearData(): Promise<void>;
  getTracker(): { init(): Promise<unknown> };
}

interface Window {
  webgazer?: WebGazerApi;
}
