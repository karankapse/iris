// WebGazer ships no TypeScript types. This declares just the parts we use.
declare module 'webgazer' {
  interface WebGazer {
    params: { faceMeshSolutionPath: string; saveDataAcrossSessions: boolean };
    setRegression(name: string): WebGazer;
    setGazeListener(
      listener: (data: { x: number; y: number } | null, elapsedMs: number) => void,
    ): WebGazer;
    clearGazeListener(): WebGazer;
    saveDataAcrossSessions(save: boolean): WebGazer;
    applyKalmanFilter(apply: boolean): WebGazer;
    showVideo(show: boolean): WebGazer;
    showVideoPreview(show: boolean): WebGazer;
    showFaceOverlay(show: boolean): WebGazer;
    showFaceFeedbackBox(show: boolean): WebGazer;
    showPredictionPoints(show: boolean): WebGazer;
    /** Opens the camera and starts predicting. Rejects if the camera cannot be used. */
    begin(onFail?: () => void): Promise<WebGazer>;
    /** Stops predicting and releases the camera. */
    end(): WebGazer;
    /** Learn: the person is looking at (x, y) right now. */
    recordScreenPosition(x: number, y: number, eventType?: string): WebGazer;
    removeMouseEventListeners(): WebGazer;
    /** Forget everything learned (memory and saved data). */
    clearData(): Promise<void>;
  }
  const webgazer: WebGazer;
  export default webgazer;
}
