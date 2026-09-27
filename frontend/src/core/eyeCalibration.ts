// The eye calibration belongs to the ACCOUNT, not the browser: it is saved on the server after
// calibrating and loaded on sign-in, so it follows the person to any computer. The browser keeps a
// working copy (the eye module reads it from localStorage) and remembers whose copy it is, so
// another account signing in on the same computer never uses someone else's eyes.
import type { EyeInput } from '../contracts';
import { authHeader, getUserId } from './auth';

/** Everything calibrating the eyes writes (glance mode, blink thresholds, the column model). */
export const EYE_CALIBRATION_KEYS = ['iris.glance.v1', 'iris.eyeTuning.v3', 'iris.gazeModel.v2'];
const OWNER_KEY = 'iris.eyeCalibration.owner';
const URL = '/api/auth/me/eye-calibration';

type Saved = Record<string, string>;

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function set(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the account copy is still saved */
  }
}

function readLocal(): Saved | null {
  const out: Saved = {};
  for (const key of EYE_CALIBRATION_KEYS) {
    const value = get(key);
    if (value !== null) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function writeLocal(saved: Saved | null) {
  for (const key of EYE_CALIBRATION_KEYS) set(key, saved?.[key] ?? null);
}

async function upload(saved: Saved) {
  const res = await fetch(URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ data: saved }),
  });
  if (!res.ok) throw new Error(`Could not save the calibration (${res.status})`);
}

/**
 * On sign-in: use this account's calibration. If the account has none yet but this browser holds
 * an unclaimed one (calibrated before accounts saved it), it becomes this account's.
 */
export async function loadEyeCalibration(eyeInput: EyeInput): Promise<void> {
  const user = getUserId();
  const owner = get(OWNER_KEY);
  if (owner && owner !== user) writeLocal(null); // someone else's eyes: never use them
  try {
    const res = await fetch(URL, { headers: authHeader() });
    if (!res.ok) return; // backend down or signed out: keep what's here
    const { data } = (await res.json()) as { data: Saved | null };
    if (data) {
      writeLocal(data);
      set(OWNER_KEY, user);
    } else {
      const local = readLocal();
      if (local) {
        await upload(local);
        set(OWNER_KEY, user);
      }
    }
  } catch {
    /* offline: keep what's here */
  } finally {
    eyeInput.reloadCalibration?.();
  }
}

/** After calibrating: save it to the account. */
export async function saveEyeCalibration(): Promise<void> {
  const local = readLocal();
  if (!local) return;
  set(OWNER_KEY, getUserId());
  await upload(local);
}
