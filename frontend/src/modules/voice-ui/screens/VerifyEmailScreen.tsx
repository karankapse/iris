import { useEffect, useRef, useState } from 'react';
import { verifyEmail } from '../../../core/auth';

/** Opened from the confirmation email: /verify-email?token=... Confirms, signs in, opens the app. */
export function VerifyEmailScreen() {
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // links are single-use: never submit twice
    started.current = true;
    const token = new URLSearchParams(location.search).get('token') ?? '';
    if (!token) {
      setError('This link is missing its code. Use the link from the email.');
      return;
    }
    verifyEmail(token)
      .then(() => location.assign('/calibrate?first=1')) // new account: calibrate first
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <main className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <img className="brand-mark large" src="/iris-mark.png" alt="Iris" />
          <h1>{error ? 'Link problem' : 'Confirming…'}</h1>
          <p>{error ?? 'One moment while we confirm your email.'}</p>
        </div>
        {error && (
          <a className="login-submit center" href="/login">
            Go to log in
          </a>
        )}
      </div>
    </main>
  );
}
