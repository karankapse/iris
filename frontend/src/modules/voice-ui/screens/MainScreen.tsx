import { useEffect, useRef, useState } from 'react';
import type { Emotion } from '../../../contracts';
import type { Services } from '../../../app/services';
import { useOrchestrator } from '../../../app/useOrchestrator';
import { CameraPreview } from './CameraPreview';
import { V0ColumnLayout } from './v0/V0ColumnLayout';
import { DevPanel } from './DevPanel';
import { EyeTuningPanel } from './EyeTuningPanel';
import { GazeDebugOverlay } from './GazeDebugOverlay';
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
  const [showDot, setShowDot] = useState(() => {
    try {
      return localStorage.getItem('iris.showGazeDot.v2') === '1'; // off by default: the box lights up instead
    } catch {
      return false;
    }
  });
  // Debug overlay (Alt+D) and tuning panel (Alt+T): remembered across reloads.
  const [showDebug, setShowDebug] = useStoredFlag('iris.showGazeDebug');
  const [showTuning, setShowTuning] = useStoredFlag('iris.showEyeTuning');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.code === 'KeyD') setShowDebug((v) => !v);
      else if (e.code === 'KeyT') setShowTuning((v) => !v);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setShowDebug, setShowTuning]);

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
      {services.usesCamera && (
        <>
          <label className="dot-toggle">
            <input
              type="checkbox"
              checked={showDebug}
              onChange={(e) => setShowDebug(e.target.checked)}
            />{' '}
            show the gaze debug overlay (Alt+D)
          </label>
          <label className="dot-toggle">
            <input
              type="checkbox"
              checked={showTuning}
              onChange={(e) => setShowTuning(e.target.checked)}
            />{' '}
            show the eye tuning panel (Alt+T)
          </label>
        </>
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
      {showDebug && <GazeDebugOverlay services={services} />}
      {showTuning && (
        <EyeTuningPanel
          services={services}
          orchestrator={orchestrator}
          settings={view.settings}
          onClose={() => setShowTuning(false)}
        />
      )}
      {eyeMode === 'full' ? (
        <V0ColumnLayout services={services}
          orchestrator={orchestrator}
          view={view}
          draft={draft}
          setDraft={setDraft}
          onPick={pick}
          camera={
            services.usesCamera ? (
              <CameraPreview services={services} showReadout={false} />
            ) : (
              <div className="face-placeholder h-full w-full bg-white relative shadow-[inset_0_-8px_0_rgba(0,0,0,0.06)]" aria-hidden="true">
                <span className="absolute top-[30%] left-[30%] w-[13%] aspect-square rounded-full bg-[#111]" />
                <span className="absolute top-[30%] left-[57%] w-[13%] aspect-square rounded-full bg-[#111]" />
              </div>
            )
          }
          onCalibrate={() => setShowSetup(true)}
          onOpenMenu={() => setShowMenu(true)}
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

/** A boolean remembered in localStorage (per-viewer convenience; works without storage too). */
function useStoredFlag(key: string) {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, on ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [key, on]);
  return [on, setOn] as const;
}
