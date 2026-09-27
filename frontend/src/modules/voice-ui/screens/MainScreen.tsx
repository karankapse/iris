import { useEffect, useRef, useState } from 'react';
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
    view.eyeMode === 'full' &&
    services.eyeInput.status?.().calibrated === false;
  const [showSetup, setShowSetup] = useState(needsCalibration);
  const [firstRun] = useState(needsCalibration);
  const [showMenu, setShowMenu] = useState(false);
  const menuDialog = useRef<HTMLDialogElement>(null);
  const [showDot, setShowDot] = useState(() => {
    try {
      return localStorage.getItem('iris.showGazeDot.v2') === '1'; // off by default: the box lights up instead
    } catch {
      return false;
    }
  });
  const overlayOpen = showMenu || showSetup;
  // While the menu drawer is open the eyes can't choose options behind it. Only on open/close
  // (never on first render), and not while the setup screen is open: it pauses the eyes itself.
  const menuPaused = useRef(false);
  useEffect(() => {
    if (showSetup) {
      menuPaused.current = false;
      return;
    }
    if (showMenu !== menuPaused.current) {
      menuPaused.current = showMenu;
      orchestrator.setSuspended(showMenu);
    }
  }, [orchestrator, showMenu, showSetup]);

  // Native modal semantics contain keyboard focus and block pointer access behind the drawer.
  useEffect(() => {
    if (showMenu) menuDialog.current?.showModal();
    else menuDialog.current?.close();
  }, [showMenu]);

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
        Setup and calibration
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

  // Caregiver controls live in the same drawer in both eye modes.
  const panels = (
    <>
      {services.usesCamera && <CameraPreview services={services} />}
      {services.usesMic && <MicPanel status={stt} />}
      {services.gaze && (
        <label className="dot-toggle">
          <input type="checkbox" checked={showDot} onChange={(e) => toggleDot(e.target.checked)} />{' '}
          Show gaze position
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
      <div inert={overlayOpen}>
        {eyeMode === 'full' ? (
          <ColumnLayout
            orchestrator={orchestrator}
            view={view}
            draft={draft}
            setDraft={setDraft}
            onPick={pick}
            face={
              <>
                <span className="brand">Iris</span>
                <span className="muted">Your words, your voice</span>
                {services.usesMic && (
                  <span className={`chip-state ${stt.state}`}>Microphone: {stt.state}</span>
                )}
                <button className="linkbtn" onClick={() => setShowMenu(true)}>
                  Caregiver settings
                </button>
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
            topButtons={
              <button className="linkbtn" onClick={() => setShowMenu(true)}>
                Caregiver settings
              </button>
            }
          />
        )}
      </div>
      <dialog
        ref={menuDialog}
        className="caregiver-dialog"
        aria-labelledby="caregiver-title"
        onKeyDown={(e) => {
          if (!e.altKey) e.stopPropagation();
        }}
        onCancel={() => setShowMenu(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setShowMenu(false);
        }}
      >
        {showMenu && (
          <aside className="drawer">
            <header>
              <div>
                <h2 id="caregiver-title">Caregiver settings</h2>
                <p className="help">Eye selection is paused while settings are open.</p>
              </div>
              <button autoFocus onClick={() => setShowMenu(false)}>
                Close
              </button>
            </header>
            <div className="drawer-buttons">{actionButtons}</div>
            {panels}
          </aside>
        )}
      </dialog>

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
