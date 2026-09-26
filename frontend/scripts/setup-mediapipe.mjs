// One-time setup for the REAL webcam modules (not needed while everything is mocked).
//   1. copies MediaPipe's WebAssembly runtime from node_modules into public/mediapipe/wasm
//   2. downloads Google's face_landmarker.task model (~4 MB) into public/models
// We serve both from our own origin so the app works offline and no video/data goes to a CDN.
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

await mkdir('public/mediapipe', { recursive: true });
await cp('node_modules/@mediapipe/tasks-vision/wasm', 'public/mediapipe/wasm', { recursive: true });
console.log('copied MediaPipe wasm -> public/mediapipe/wasm');

// WebGazer (screen-coordinate gaze tracking) runs its own copy of MediaPipe FaceMesh. Serving
// its files ourselves means it never downloads a model from a CDN at runtime.
await mkdir('public/webgazer', { recursive: true });
await cp('node_modules/webgazer/dist/mediapipe/face_mesh', 'public/webgazer/face_mesh', {
  recursive: true,
});
// WebGazer itself is loaded as a plain <script> (NOT through the bundler): its face model code
// needs a classic-script `this`, which bundlers rewrite to `undefined`.
await cp('node_modules/webgazer/dist/webgazer.js', 'public/webgazer/webgazer.js');
console.log('copied WebGazer -> public/webgazer');

await mkdir('public/models', { recursive: true });
const modelPath = 'public/models/face_landmarker.task';
if (existsSync(modelPath)) {
  console.log('model already present:', modelPath);
} else {
  console.log('downloading face_landmarker.task ...');
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`model download failed: ${res.status}`);
  await writeFile(modelPath, Buffer.from(await res.arrayBuffer()));
  console.log('saved', modelPath);
}
