import { useState, type ReactNode } from 'react';
import { AudioLines, Ear, Eye, MailCheck } from 'lucide-react';
import { ConstellationGrid } from '../../../components/ui/constellation-grid';
import { AuthError, forgotPassword, login, resendConfirmation, signup } from '../../../core/auth';

type Mode = 'login' | 'signup' | 'forgot' | 'checkInbox';

function PasswordField({
  label,
  value,
  onChange,
  show,
  autoComplete,
  minLength,
  help,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  autoComplete: string;
  minLength?: number;
  help?: string;
}) {
  return (
    <label className="field">
      <strong>{label}</strong>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        minLength={minLength}
        autoComplete={autoComplete}
      />
      {help && <span className="help">{help}</span>}
    </label>
  );
}

/** What Iris is, shown beside the form: most people meet the app here. */
function Intro() {
  return (
    <header className="login-intro">
      <div className="login-logo">
        <img className="brand-mark" src="/iris-mark.png" alt="" />
        Iris
      </div>
      <p className="login-eyebrow">
        <Eye size={16} aria-hidden="true" /> Eye-controlled communication
      </p>
      <h1>
        Speak with your eyes. <span>Be heard with feeling.</span>
      </h1>
      <p className="login-lede">
        Iris gives a voice back to people who can&apos;t speak or move, like those living with ALS
        or locked-in syndrome. A glance at an ordinary laptop webcam picks the reply, and Iris says
        it in a tone that matches how they feel.
      </p>
    </header>
  );
}

const STEPS = [
  {
    icon: Ear,
    title: 'Iris listens',
    text: 'When someone talks, Iris writes down what they said and suggests a few short replies that sound like the person.',
  },
  {
    icon: Eye,
    title: 'A glance chooses',
    text: "Look toward a reply, then hold or blink to pick it. No special hardware, just the laptop's camera.",
  },
  {
    icon: AudioLines,
    title: 'It speaks with feeling',
    text: 'Iris reads their expression and suggests a tone, from joking to serious. Nothing is said until they confirm it.',
  },
];

function HowItWorks() {
  return (
    <section className="login-details" aria-label="How Iris works">
      <p className="login-quote">
        Most communication devices talk in a flat computer voice. Iris sounds the way you feel.
      </p>
      <ol className="login-steps">
        {STEPS.map(({ icon: Icon, title, text }) => (
          <li key={title}>
            <span className="login-step-icon" aria-hidden="true">
              <Icon size={22} />
            </span>
            <div>
              <strong>{title}</strong>
              <p>{text}</p>
            </div>
          </li>
        ))}
      </ol>
      <ul className="login-stats">
        <li>
          <strong>1</strong> ordinary webcam
        </li>
        <li>
          <strong>6</strong> tones of voice
        </li>
        <li>
          <strong>0</strong> video frames leave the device
        </li>
      </ul>
    </section>
  );
}

/** The login page: the constellation behind, what Iris is on one side, the form on the other. */
function LoginPage({ children }: { children: ReactNode }) {
  return (
    <main className="login-page">
      <ConstellationGrid />
      <div className="login-layout">
        <Intro />
        {children}
        <HowItWorks />
      </div>
    </main>
  );
}

/**
 * Log in / create an account / forgot password. Usually filled in by a caregiver (typing isn't
 * possible with the eyes). Like most apps: new accounts confirm their email before signing in.
 */
export function LoginScreen({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>(() =>
    new URLSearchParams(location.search).get('forgot') === '1' ? 'forgot' : 'login',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);

  const go = (m: Mode) => {
    setMode(m);
    setError(null);
    setNotice(null);
    setNeedsConfirm(false);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setNeedsConfirm(false);
    if (mode === 'signup' && password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      if (mode === 'forgot') {
        await forgotPassword(email);
        setNotice(
          'If that email has an account, a reset link is on its way. Check the inbox (and spam).',
        );
      } else if (mode === 'signup') {
        const { needsVerification } = await signup(email, password, name);
        setPassword('');
        setConfirm('');
        if (needsVerification) setMode('checkInbox');
        else onDone(); // email confirmation is off here: already signed in
      } else {
        await login(email, password);
        onDone();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setNeedsConfirm(err instanceof AuthError && err.status === 403);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    await resendConfirmation(email);
    setNotice('A new confirmation link is on its way. Check the inbox (and spam).');
  }

  if (mode === 'checkInbox') {
    return (
      <LoginPage>
        <div className="login-card">
          <MailCheck className="inbox-icon" size={48} aria-hidden="true" />
          <h2 className="center">Check your inbox</h2>
          <p className="muted center">
            We sent a confirmation link to <strong>{email}</strong>. Click it to finish creating the
            account. (Not there? Check spam.)
          </p>
          {notice && <p className="msg">{notice}</p>}
          <button type="button" className="login-submit secondary" onClick={resend}>
            Resend the email
          </button>
          <button type="button" className="link-button" onClick={() => go('login')}>
            ← Back to log in
          </button>
        </div>
      </LoginPage>
    );
  }

  return (
    <LoginPage>
      <form className="login-card" onSubmit={submit}>
        {mode !== 'forgot' && (
          <div className="login-card-head">
            <h2>{mode === 'signup' ? 'Create an account' : 'Welcome back'}</h2>
            <p className="muted">
              {mode === 'signup'
                ? 'Usually set up by a caregiver or family member.'
                : 'Log in to pick up the conversation.'}
            </p>
          </div>
        )}
        {mode !== 'forgot' && (
          <div className="login-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              className={mode === 'login' ? 'active' : ''}
              onClick={() => go('login')}
            >
              Log in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              className={mode === 'signup' ? 'active' : ''}
              onClick={() => go('signup')}
            >
              Create account
            </button>
          </div>
        )}
        {mode === 'forgot' && (
          <>
            <h2 className="center">Forgot your password?</h2>
            <p className="muted center">
              Enter the account&apos;s email and we&apos;ll send a link to choose a new one.
            </p>
          </>
        )}

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
        {mode !== 'forgot' && (
          <PasswordField
            label="Password"
            value={password}
            onChange={setPassword}
            show={show}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            minLength={mode === 'signup' ? 8 : undefined}
            help={mode === 'signup' ? 'At least 8 characters.' : undefined}
          />
        )}
        {mode === 'signup' && (
          <PasswordField
            label="Confirm password"
            value={confirm}
            onChange={setConfirm}
            show={show}
            autoComplete="new-password"
          />
        )}
        {mode !== 'forgot' && (
          <label className="check show-pw">
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
            Show password
          </label>
        )}

        {error && <p className="msg error">{error}</p>}
        {needsConfirm && (
          <button type="button" className="link-button" onClick={resend}>
            Resend the confirmation email
          </button>
        )}
        {notice && <p className="msg">{notice}</p>}

        <button className="login-submit" type="submit" disabled={busy}>
          {busy
            ? 'One moment…'
            : mode === 'signup'
              ? 'Create account'
              : mode === 'forgot'
                ? 'Send reset link'
                : 'Log in'}
        </button>
        {mode === 'login' && (
          <button type="button" className="link-button" onClick={() => go('forgot')}>
            Forgot password?
          </button>
        )}
        {mode === 'forgot' && (
          <button type="button" className="link-button" onClick={() => go('login')}>
            ← Back to log in
          </button>
        )}
      </form>
    </LoginPage>
  );
}
