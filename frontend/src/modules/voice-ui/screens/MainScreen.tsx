import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../../app/AppContext';
import { NavDrawer, NavLinks } from './AppShell';
import { CameraPreview } from './CameraPreview';
import { ColumnLayout } from './ColumnLayout';
import { EyeTuningPanel } from './EyeTuningPanel';
import { GazeDebugOverlay } from './GazeDebugOverlay';
import { GazeDot } from './GazeDot';
import { StackLayout } from './StackLayout';

/**
 * The Talk page: full screen, just the conversation. Everything else (calibration, settings,
 * profile, account) lives on its own page, reached from the Menu.
 */
export function MainScreen() {
  const { services, orchestrator, view } = useApp();
  const navigate = useNavigate();
  const { eyeMode, stt } = view;
  const [draft, setDraft] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const showDot = (() => {
    try {
      return localStorage.getItem('iris.showGazeDot.v2') === '1';
    } catch {
      return false;
    }
  })();
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

  // While the menu drawer is open the eyes can't choose options behind it (only on open/close).
  const menuPaused = useRef(false);
  useEffect(() => {
    if (showMenu !== menuPaused.current) {
      menuPaused.current = showMenu;
      orchestrator.setSuspended(showMenu);
    }
  }, [orchestrator, showMenu]);

  const pick = (optionIndex: number) =>
    orchestrator.dispatch({ type: 'eye', event: { type: 'select', optionIndex } });

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
                  <button className="linkbtn small" onClick={() => navigate('/calibrate')}>
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
          topButtons={<NavLinks />}
          extras={null}
        />
      )}

      {showMenu && <NavDrawer onClose={() => setShowMenu(false)} />}
    </>
  );
}

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
