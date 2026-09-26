import { useState } from 'react';
import type { Services } from '../../../app/services';
import { useOrchestrator } from '../../../app/useOrchestrator';
import { CameraPreview } from './CameraPreview';
import { CornerLayout } from './CornerLayout';
import { DevPanel } from './DevPanel';
import { MicPanel } from './MicPanel';
import { MoodBar } from './MoodBar';
import { SetupPanel } from './SetupPanel';
import { StackLayout } from './StackLayout';

/** The main user screen: picks the corner layout (full eye mode) or the stacked list (vertical). */
export function MainScreen({ services }: { services: Services }) {
  const { orchestrator, view } = useOrchestrator(services);
  const { machine, eyeMode, stt } = view;
  const [draft, setDraft] = useState('');
  const [showSetup, setShowSetup] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

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
    </>
  );

  // The detail panels: inline under the options in the stacked layout, in a drawer in the corner layout.
  const panels = (
    <>
      {services.usesCamera && <CameraPreview services={services} />}
      {services.usesMic && <MicPanel status={stt} />}
      <MoodBar
        mood={machine.mood}
        eyeMode={eyeMode}
        onMood={(m) => orchestrator.setMood(m)}
        onEyeMode={(m) => orchestrator.setEyeMode(m)}
      />
      <DevPanel
        mocks={services.mocks}
        onPartnerText={(text) => orchestrator.dispatch({ type: 'partner_final', text })}
      />
    </>
  );

  return (
    <>
      {eyeMode === 'full' ? (
        <CornerLayout
          orchestrator={orchestrator}
          view={view}
          draft={draft}
          setDraft={setDraft}
          onPick={pick}
          face={
            <>
              {services.usesCamera && <CameraPreview services={services} showReadout={false} />}
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
