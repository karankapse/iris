// The signed-in pages other than Talk. Each is a thin wrapper that puts existing panels on a page.
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../../../app/AppContext';
import type { Emotion } from '../../../contracts';
import { changePassword, getSession, updateName } from '../../../core/auth';
import { signOut } from './AppShell';
import { CameraPreview } from './CameraPreview';
import { DevPanel } from './DevPanel';
import { MicPanel } from './MicPanel';
import { MoodBar } from './MoodBar';
import { ProfilePanel } from './ProfilePanel';
import { SettingsPanel } from './SettingsPanel';
import { SetupPanel } from './SetupPanel';

function PageHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="page-header">
      <h1>{title}</h1>
      {sub && <p className="muted">{sub}</p>}
    </div>
  );
}

export function CalibratePage() {
  const { services, orchestrator } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  return (
    <>
      <PageHeader
        title="Calibrate"
        sub="Teach Iris this person's eyes, emotions and voice. Best done with a caregiver."
      />
      <SetupPanel
        services={services}
        orchestrator={orchestrator}
        onClose={() => navigate('/')}
        firstRun={params.get('first') === '1'}
      />
    </>
  );
}

export function ProfilePage() {
  const { orchestrator, view } = useApp();
  return (
    <>
      <PageHeader
        title="Profile"
        sub="Who this person is, so reply suggestions sound like them. Plus their quick phrases."
      />
      <ProfilePanel
        key={JSON.stringify(view.profile)}
        orchestrator={orchestrator}
        profile={view.profile}
      />
    </>
  );
}

export function SettingsPage() {
  const { services, orchestrator, view } = useApp();
  return (
    <>
      <PageHeader
        title="Settings"
        sub="How the eyes control Iris, and how it speaks. Changes apply right away."
      />
      <div className="page-grid">
        <section className="panel">
          <h3>Eye control &amp; mood</h3>
          <MoodBar
            mood={view.machine.mood}
            eyeMode={view.eyeMode}
            onMood={(m) => orchestrator.setMood(m)}
            onEyeMode={(m) => orchestrator.setEyeMode(m)}
          />
        </section>
        <SettingsPanel orchestrator={orchestrator} settings={view.settings} />
        {services.usesCamera && (
          <section className="panel">
            <h3>Camera</h3>
            <CameraPreview services={services} />
          </section>
        )}
        {services.usesMic && <MicPanel status={view.stt} />}
        <DevPanel
          mocks={services.mocks}
          onPartnerText={(text) => orchestrator.dispatch({ type: 'partner_final', text })}
          onSimulateEmotion={(emotion) =>
            orchestrator.dispatch({
              type: 'emotion_estimate',
              estimate: {
                emotion: (emotion || 'neutral') as Emotion,
                confidence: emotion ? 0.95 : 0,
              },
            })
          }
        />
      </div>
    </>
  );
}

export function AccountPage() {
  const user = getSession()?.user;
  const [name, setName] = useState(user?.name ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(job: () => Promise<string>) {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ text: await job() });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Account" sub={user ? `Signed in as ${user.email}` : undefined} />
      {msg && <p className={msg.error ? 'msg error' : 'msg'}>{msg.text}</p>}
      <div className="page-grid">
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await updateName(name);
              return 'Name saved.';
            });
          }}
        >
          <h3>Details</h3>
          <label className="field">
            <strong>Name of the person using Iris</strong>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="field">
            <strong>Email</strong>
            <input value={user?.email ?? ''} disabled />
          </label>
          <button type="submit" disabled={busy}>
            Save
          </button>
        </form>

        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await changePassword(current, next);
              setCurrent('');
              setNext('');
              return 'Password changed.';
            });
          }}
        >
          <h3>Change password</h3>
          <label className="field">
            <strong>Current password</strong>
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          <label className="field">
            <strong>New password</strong>
            <input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
            <span className="help">At least 8 characters.</span>
          </label>
          <button type="submit" disabled={busy}>
            Change password
          </button>
        </form>

        <section className="panel">
          <h3>Sign out</h3>
          <p className="muted">
            Signs out on this device. The next person signs in with their own account, so their
            calibration and voice load instead.
          </p>
          <button onClick={signOut}>Sign out</button>
        </section>
      </div>
    </>
  );
}
