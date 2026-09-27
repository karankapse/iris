import { useState } from 'react';
import { login, signup } from '../../../core/auth';

/**
 * Log in / create an account. Usually filled in by a caregiver (typing isn't possible with the
 * eyes). One account per person who uses Iris: their calibration, profile, voice and emotion
 * model are saved under it.
 */
export function LoginScreen({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signup') await signup(email, password, name);
      else await login(email, password);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <div className="face-placeholder small" aria-hidden="true">
            <span />
            <span />
          </div>
          <h1>Iris</h1>
          <p>Speak with your eyes, and with feeling.</p>
        </div>

        <div className="login-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={mode === 'login' ? 'active' : ''}
            onClick={() => setMode('login')}
          >
            Log in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signup'}
            className={mode === 'signup' ? 'active' : ''}
            onClick={() => setMode('signup')}
          >
            Create account
          </button>
        </div>

        {mode === 'signup' && (
          <label className="field">
            <strong>Name of the person using Iris</strong>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
            />
          </label>
        )}
        <label className="field">
          <strong>Email</strong>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </label>
        <label className="field">
          <strong>Password</strong>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === 'signup' ? 8 : undefined}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          />
          {mode === 'signup' && <span className="help">At least 8 characters.</span>}
        </label>

        {error && <p className="msg error">{error}</p>}

        <button className="login-submit" type="submit" disabled={busy}>
          {busy ? 'One moment…' : mode === 'signup' ? 'Create account' : 'Log in'}
        </button>
      </form>
    </main>
  );
}
