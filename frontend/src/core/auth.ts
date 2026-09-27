// Who is logged in. The login token and the user are kept in the browser (localStorage) so the
// person stays logged in across reloads; every API call sends the token (see core/api.ts).
import type { components } from '../shared/api.generated';

export type User = components['schemas']['UserOut'];
type AuthResponse = components['schemas']['AuthResponse'];

interface Session {
  token: string;
  user: User;
}

const KEY = 'iris.session.v1';
/** Used when nobody is logged in (keyboard-mock development, tests). */
const GUEST_ID = 'local-user';

export function getSession(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return s && typeof s.token === 'string' && s.user?.id ? s : null;
  } catch {
    return null;
  }
}

function setSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the session just won't survive a reload */
  }
}

/** The id everything personal is stored under (profile, calibration, emotion model, voice). */
export function getUserId(): string {
  return getSession()?.user.id ?? GUEST_ID;
}

export function authHeader(): Record<string, string> {
  const token = getSession()?.token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function post(path: string, body: unknown): Promise<AuthResponse> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.detail;
    // FastAPI validation errors come back as a list
    const message = Array.isArray(detail)
      ? detail
          .map((d: { loc?: string[]; msg: string }) => `${d.loc?.at(-1) ?? ''}: ${d.msg}`)
          .join('. ')
      : detail;
    throw new Error(message || `Request failed (${res.status})`);
  }
  return data as AuthResponse;
}

export async function signup(email: string, password: string, name: string): Promise<User> {
  const r = await post('/api/auth/signup', { email, password, name });
  setSession({ token: r.token, user: r.user });
  return r.user;
}

export async function login(email: string, password: string): Promise<User> {
  const r = await post('/api/auth/login', { email, password });
  setSession({ token: r.token, user: r.user });
  return r.user;
}

/** Checks the saved token is still valid (e.g. not logged out elsewhere). Clears it if not. */
export async function checkSession(): Promise<User | null> {
  const s = getSession();
  if (!s) return null;
  try {
    const res = await fetch('/api/auth/me', { headers: authHeader() });
    if (res.status === 401) {
      setSession(null);
      return null;
    }
    return res.ok ? ((await res.json()) as User) : s.user; // backend down: trust the saved session
  } catch {
    return s.user;
  }
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', headers: authHeader() }).catch(() => null);
  setSession(null);
}
