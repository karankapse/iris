import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../../app/AppContext';
import { NavDrawer, NavLinks } from './AppShell';
import { CameraPreview } from './CameraPreview';
import { EyeTuningPanel } from './EyeTuningPanel';
import { GazeDebugOverlay } from './GazeDebugOverlay';
import { GazeDot } from './GazeDot';
import { StackLayout } from './StackLayout';
import { V0ColumnLayout } from './v0/V0ColumnLayout';

/**
 * The Talk page: full screen, just the conversation. Everything else (calibration, settings,
 * profile, account) lives on its own page, reached from the Menu.
 */
export function MainScreen() {
  const { services, orchestrator, view } = useApp();
  const navigate = useNavigate();
  const { eyeMode } = view;
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

  // While the menu drawer or the tuning panel is open, the eyes can't choose options behind it.
  useEffect(() => {
    orchestrator.setSuspended(showMenu, 'menu');
    return () => orchestrator.setSuspended(false, 'menu');
  }, [orchestrator, showMenu]);
  useEffect(() => {
    orchestrator.setSuspended(showTuning, 'tuning');
    return () => orchestrator.setSuspended(false, 'tuning');
  }, [orchestrator, showTuning]);

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
        <V0ColumnLayout
          orchestrator={orchestrator}
          view={view}
          services={services}
          draft={draft}
          setDraft={setDraft}
          onPick={pick}
          camera={
            services.usesCamera ? (
              <CameraPreview services={services} showReadout={false} />
            ) : (
              // no camera in use (keyboard mock): a simple face stands in for the live view
              <div className="face-placeholder" aria-hidden="true">
                <span />
                <span />
              </div>
            )
          }
          onCalibrate={services.usesCamera ? () => navigate('/calibrate') : undefined}
          onOpenMenu={() => setShowMenu(true)}
        />
      ) : (
        <StackLayout
          orchestrator={orchestrator}
          view={view}
          draft={draft}
          setDraft={setDraft}
          onPick={pick}
          topButtons={<NavLinks />}
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
