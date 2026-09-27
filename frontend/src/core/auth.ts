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

/** An error from the auth API, with its HTTP status (403 = email not confirmed, 429 = locked). */
export class AuthError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function post<T = AuthResponse>(path: string, body: unknown): Promise<T> {
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
    throw new AuthError(message || `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

/**
 * Creates the account and emails a confirmation link: not signed in until the link is clicked.
 * Where email confirmation is switched off, it signs in right away (returns needsVerification false).
 */
export async function signup(
  email: string,
  password: string,
  name: string,
): Promise<{ email: string; needsVerification: boolean }> {
  const r = await post<{ email: string; needs_verification?: boolean }>('/api/auth/signup', {
    email,
    password,
    name,
  });
  const needsVerification = r.needs_verification !== false;
  if (!needsVerification) await login(email, password);
  return { email: r.email, needsVerification };
}

/** The emailed confirmation link: confirms the address and signs in. */
export async function verifyEmail(token: string): Promise<User> {
  const r = await post('/api/auth/verify', { token });
  setSession({ token: r.token, user: r.user });
  return r.user;
}

export async function resendConfirmation(email: string) {
  await fetch('/api/auth/resend-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
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

async function send(method: string, path: string, body: unknown) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const d = data?.detail;
    throw new Error(
      (Array.isArray(d) ? d.map((x: { msg: string }) => x.msg).join('. ') : d) ||
        `Request failed (${res.status})`,
    );
  }
  return data;
}

export async function updateName(name: string): Promise<User> {
  const user = (await send('PATCH', '/api/auth/me', { name })) as User;
  const s = getSession();
  if (s) setSession({ ...s, user });
  return user;
}

export async function changePassword(currentPassword: string, newPassword: string) {
  await send('POST', '/api/auth/password', {
    current_password: currentPassword,
    new_password: newPassword,
  });
}

/** Emails a reset link (if the account exists: the answer is the same either way). */
export async function forgotPassword(email: string) {
  const res = await fetch('/api/auth/forgot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
}

/** Sets a new password from an emailed link, and signs in. */
export async function resetPassword(token: string, newPassword: string): Promise<User> {
  const r = await post('/api/auth/reset', { token, new_password: newPassword });
  setSession({ token: r.token, user: r.user });
  return r.user;
}

/** Permanently deletes the signed-in account and all its data. */
export async function deleteAccount(password: string) {
  await send('DELETE', '/api/auth/me', { password });
  setSession(null);
}
