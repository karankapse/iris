import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../../app/AppContext';
import { NavDrawer, NavLinks } from './AppShell';
import { CameraPreview } from './CameraPreview';
import { ColumnLayout } from './ColumnLayout';
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

  const pick = (optionIndex: number) =>
    orchestrator.dispatch({ type: 'eye', event: { type: 'select', optionIndex } });

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
