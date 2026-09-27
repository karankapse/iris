import { useState } from 'react';
import { resetPassword } from '../../../core/auth';

/** Opened from the emailed link: /reset-password?token=... */
export function ResetPasswordScreen() {
  const token = new URLSearchParams(location.search).get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <main className="login-page">
      <form
        className="login-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await resetPassword(token, password);
            location.assign('/'); // signed in with the new password
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="login-brand">
          <h1>New password</h1>
          <p>Choose a new password for this Iris account.</p>
        </div>
        {!token && (
          <p className="msg error">This link is missing its code. Use the link from the email.</p>
        )}
        <label className="field">
          <strong>New password</strong>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
          <span className="help">At least 8 characters.</span>
        </label>
        {error && <p className="msg error">{error}</p>}
        <button className="login-submit" type="submit" disabled={busy || !token}>
          {busy ? 'One moment…' : 'Save and sign in'}
        </button>
        <a className="link-button" href="/login">
          ← Back to log in
        </a>
      </form>
    </main>
  );
}
