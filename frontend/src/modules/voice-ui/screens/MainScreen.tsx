import { useEffect, useState } from 'react';
import type { Emotion } from '../../../contracts';
import type { Services } from '../../../app/services';
import { useOrchestrator } from '../../../app/useOrchestrator';
import { CameraPreview } from './CameraPreview';
import { ColumnLayout } from './ColumnLayout';
import { DevPanel } from './DevPanel';
import { EyeTuningPanel } from './EyeTuningPanel';
import { GazeDebugOverlay } from './GazeDebugOverlay';
import { GazeDot } from './GazeDot';
import { MicPanel } from './MicPanel';
import { MemoryPanel } from './MemoryPanel';
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
  const [showSetup, setShowSetup] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showDot, setShowDot] = useState(() => {
    try {
      return localStorage.getItem('iris.showGazeDot') !== '0';
    } catch {
      return true;
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

  // While the menu drawer or the tuning panel is open, the eyes can't choose options behind it
  // (the setup screen pauses them itself).
  useEffect(() => {
    orchestrator.setSuspended(showMenu, 'menu');
    return () => orchestrator.setSuspended(false, 'menu');
  }, [orchestrator, showMenu]);
  useEffect(() => {
    orchestrator.setSuspended(showTuning, 'tuning');
    return () => orchestrator.setSuspended(false, 'tuning');
  }, [orchestrator, showTuning]);

  const toggleDot = (on: boolean) => {
    setShowDot(on);
    try {
      localStorage.setItem('iris.showGazeDot', on ? '1' : '0');
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
      <MemoryPanel orchestrator={orchestrator} settings={view.settings} />
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
            {panels}
          </aside>
        </div>
      )}

      {showSetup && (
        <SetupPanel
          services={services}
          orchestrator={orchestrator}
          onClose={() => setShowSetup(false)}
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
