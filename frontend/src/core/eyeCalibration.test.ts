import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EyeInput } from '../contracts';
import { loadEyeCalibration, saveEyeCalibration } from './eyeCalibration';

const GLANCE = 'iris.glance.v1';
const OWNER = 'iris.eyeCalibration.owner';

function signIn(id: string) {
  localStorage.setItem(
    'iris.session.v1',
    JSON.stringify({ token: `t-${id}`, user: { id, email: `${id}@x.test`, name: id } }),
  );
}

/** A fake server holding one saved calibration per token. */
function server(saved: Record<string, Record<string, string> | null>) {
  const puts: { token: string; data: Record<string, string> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const token = String((init?.headers as Record<string, string>)?.Authorization).slice(7);
      if (init?.method === 'PUT') {
        const { data } = JSON.parse(String(init.body));
        puts.push({ token, data });
        saved[token] = data;
        return new Response(null, { status: 204 });
      }
      return Response.json({ data: saved[token] ?? null });
    }),
  );
  return puts;
}

const eye = () => ({ reloadCalibration: vi.fn() }) as unknown as EyeInput;

describe('eye calibration saved with the account', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("loads the account's calibration on sign-in and starts using it", async () => {
    signIn('sam');
    server({ 't-sam': { [GLANCE]: '{"threshold":0.1}' } });
    const input = eye();
    await loadEyeCalibration(input);
    expect(localStorage.getItem(GLANCE)).toBe('{"threshold":0.1}');
    expect(localStorage.getItem(OWNER)).toBe('sam');
    expect(input.reloadCalibration).toHaveBeenCalled();
  });

  it('a calibration made before accounts saved it becomes this account’s', async () => {
    signIn('sam');
    localStorage.setItem(GLANCE, '{"threshold":0.2}');
    const puts = server({});
    await loadEyeCalibration(eye());
    expect(puts).toEqual([{ token: 't-sam', data: { [GLANCE]: '{"threshold":0.2}' } }]);
    expect(localStorage.getItem(OWNER)).toBe('sam');
  });

  it("never uses (or takes) another account's calibration on the same computer", async () => {
    signIn('kim');
    localStorage.setItem(GLANCE, '{"threshold":0.2}');
    localStorage.setItem(OWNER, 'sam');
    const puts = server({});
    await loadEyeCalibration(eye());
    expect(localStorage.getItem(GLANCE)).toBeNull(); // Kim will be asked to calibrate
    expect(puts).toEqual([]);
  });

  it('after calibrating, it is saved to the account', async () => {
    signIn('sam');
    const puts = server({});
    localStorage.setItem(GLANCE, '{"threshold":0.3}');
    await saveEyeCalibration();
    expect(puts).toEqual([{ token: 't-sam', data: { [GLANCE]: '{"threshold":0.3}' } }]);
  });
});
