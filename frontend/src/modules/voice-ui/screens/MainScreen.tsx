import { useState } from 'react';
import { getSession, logout } from '../../../core/auth';
import type { Emotion } from '../../../contracts';
import type { Services } from '../../../app/services';
import { useOrchestrator } from '../../../app/useOrchestrator';
import { CameraPreview } from './CameraPreview';
import { ColumnLayout } from './ColumnLayout';
import { DevPanel } from './DevPanel';
import { GazeDot } from './GazeDot';
import { MicPanel } from './MicPanel';
import { MoodBar } from './MoodBar';
import { ProfilePanel } from './ProfilePanel';
import { SettingsPanel } from './SettingsPanel';
import { SetupPanel } from './SetupPanel';
import { StackLayout } from './StackLayout';

/** The main user screen: picks the corner layout (full eye mode) or the stacked list (vertical). */
export function MainScreen({ services }: { services: Services }) {
  const { orchestrator, view } = useOrchestrator(services);
  const { machine, eyeMode, stt } = view;
  const [draft, setDraft] = useState('');
  // Not calibrated yet? Open the setup straight away: eye control is guesswork without it.
  const needsCalibration =
    services.usesCamera &&
    view.eyeMode !== 'vertical' &&
    services.eyeInput.status?.().calibrated === false;
  const [showSetup, setShowSetup] = useState(needsCalibration);
  const [firstRun] = useState(needsCalibration);
  const [showMenu, setShowMenu] = useState(false);
  const [showDot, setShowDot] = useState(() => {
    try {
      return localStorage.getItem('iris.showGazeDot.v2') === '1'; // off by default: the box lights up instead
    } catch {
      return false;
    }
  });
  const toggleDot = (on: boolean) => {
    setShowDot(on);
    try {
      localStorage.setItem('iris.showGazeDot.v2', on ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  const pick = (optionIndex: number) =>
    orchestrator.dispatch({ type: 'eye', event: { type: 'select', optionIndex } });

  const actionButtons = (
    <>
      <button
        className="linkbtn"
        onClick={() => {
          setShowMenu(false);
          setShowSetup(true);
        }}
      >
        Set up / calibrate
      </button>
      <button
        className="linkbtn"
        onClick={() => window.open('/partner', 'iris-partner', 'width=900,height=700')}
      >
        Open partner view ↗
      </button>
      <a className="linkbtn" href="/tone-tester" target="_blank" rel="noreferrer">
        Tone tester ↗
      </a>
    </>
  );

  // The detail panels: inline under the options in the stacked layout, in a drawer in the corner layout.
  const panels = (
    <>
      {services.usesCamera && <CameraPreview services={services} />}
      {services.usesMic && <MicPanel status={stt} />}
      {services.gaze && (
        <label className="dot-toggle">
          <input type="checkbox" checked={showDot} onChange={(e) => toggleDot(e.target.checked)} />{' '}
          show the red gaze dot
        </label>
      )}
      <MoodBar
        mood={machine.mood}
        eyeMode={eyeMode}
        onMood={(m) => orchestrator.setMood(m)}
        onEyeMode={(m) => orchestrator.setEyeMode(m)}
      />
      <SettingsPanel orchestrator={orchestrator} settings={view.settings} />
      <ProfilePanel
        key={JSON.stringify(view.profile)}
        orchestrator={orchestrator}
        profile={view.profile}
      />
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
    </>
  );

  return (
    <>
      {showDot && services.gaze && <GazeDot services={services} />}
      {eyeMode !== 'vertical' ? (
        <ColumnLayout
          orchestrator={orchestrator}
          view={view}
          draft={draft}
          setDraft={setDraft}
          onPick={pick}
          face={
            <>
              {services.usesCamera ? (
                <CameraPreview services={services} showReadout={false} />
              ) : (
                // no camera in use (keyboard mock): a simple face stands in for the live view
                <div className="face-placeholder" aria-hidden="true">
                  <span />
                  <span />
                </div>
              )}
              <div className="face-row">
                {services.usesMic && (
                  <span className={`chip-state ${stt.state}`}>mic: {stt.state}</span>
                )}
                {services.usesCamera && (
                  <button className="linkbtn small" onClick={() => setShowSetup(true)}>
                    Calibrate
                  </button>
                )}
                <button className="linkbtn small" onClick={() => setShowMenu(true)}>
                  ☰ Menu
                </button>
              </div>
            </>
          }
        />
      ) : (
        <StackLayout
          orchestrator={orchestrator}
          view={view}
          draft={draft}
          setDraft={setDraft}
          onPick={pick}
          topButtons={actionButtons}
          extras={panels}
        />
      )}

      {showMenu && (
        <div className="drawer-backdrop" onClick={() => setShowMenu(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <header>
              <h2>Menu</h2>
              <button onClick={() => setShowMenu(false)}>Close</button>
            </header>
            <div className="drawer-buttons">{actionButtons}</div>
            <div className="account-row">
              <span>
                Logged in as <strong>{getSession()?.user.name}</strong> ({getSession()?.user.email})
              </span>
              <button
                onClick={async () => {
                  await logout();
                  location.assign('/'); // back to the login screen, with a fresh app
                }}
              >
                Log out
              </button>
            </div>
            {panels}
          </aside>
        </div>
      )}

      {showSetup && (
        <SetupPanel
          services={services}
          orchestrator={orchestrator}
          onClose={() => setShowSetup(false)}
          firstRun={firstRun}
        />
      )}
    </>
  );
}
