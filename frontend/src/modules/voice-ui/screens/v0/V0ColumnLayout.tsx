import { useEffect, useState, type ReactNode } from 'react';
import { getOptions } from '../../../../app/machine';
import type { Orchestrator, View } from '../../../../app/Orchestrator';
import type { Services } from '../../../../app/services';
import { ErrorBanner, PhaseDetails, STATUS, TypingForm } from '../parts';
import { CameraPanel, type TrackingStatus } from './camera-panel';
import { OptionColumn } from './option-column';
import { PartnerPanel } from './partner-panel';

interface Props {
  orchestrator: Orchestrator;
  view: View;
  services: Services;
  draft: string;
  setDraft: (v: string) => void;
  onPick: (i: number) => void;
  /** The live camera view (or a stand-in face without a camera). */
  camera: ReactNode;
  onCalibrate?: () => void;
  onOpenMenu: () => void;
}

const REGION_LABEL: Record<string, string> = {
  center: 'resting (top)',
  left: 'left column',
  middle: 'middle column',
  right: 'right column',
};

const TYPING_PHASES = ['typing', 'quickType', 'qtMore'];

/**
 * The Talk screen (Arya's redesign): what the partner said and the camera/status card on top,
 * three tall answer boxes below with the words at the bottom, where the eyes aim. The boxes keep
 * the column positions the eye input expects (see LAYOUT / TARGET_POSITION in contracts/eye.ts).
 */
export function V0ColumnLayout({
  orchestrator,
  view,
  services,
  draft,
  setDraft,
  onPick,
  camera,
  onCalibrate,
  onOpenMenu,
}: Props) {
  const { machine, highlight, dwell } = view;
  const tracking = useTracking(services, view);
  const listening = machine.phase === 'listening' || machine.phase === 'suggesting';

  return (
    <main className="v0 flex h-dvh flex-col gap-4 overflow-hidden bg-background p-4 text-foreground md:gap-5 md:p-5">
      <ErrorBanner machine={machine} orchestrator={orchestrator} floating />
      <header className="flex shrink-0 flex-col gap-4 md:flex-row md:gap-5">
        <PartnerPanel
          partnerText={
            (listening ? machine.interim || machine.partnerText : machine.partnerText) || undefined
          }
          alsoSaid={listening ? undefined : machine.heldPartner || undefined}
          feels={
            machine.feel
              ? {
                  label: `${machine.feel.emotion} (${machine.feel.source})`,
                  reason: machine.feel.reason,
                }
              : undefined
          }
          status={STATUS[machine.phase]}
          isListening={machine.phase === 'listening'}
          showInput={machine.phase === 'listening'}
          onSendPartnerText={(text) => orchestrator.dispatch({ type: 'partner_final', text })}
        >
          <div className="v0-details empty:hidden">
            <PhaseDetails machine={machine} />
          </div>
          {TYPING_PHASES.includes(machine.phase) && (
            <TypingForm draft={draft} setDraft={setDraft} orchestrator={orchestrator} />
          )}
        </PartnerPanel>
        <CameraPanel
          camera={camera}
          tracking={tracking}
          onCalibrate={onCalibrate}
          onOpenMenu={onOpenMenu}
        />
      </header>

      <div
        role="group"
        aria-label="Reply options"
        className="grid min-h-0 flex-1 grid-cols-3 gap-4 md:gap-5"
      >
        {getOptions(machine).map((option, i) => (
          <OptionColumn
            key={`${i}-${option.label}`}
            index={i + 1}
            label={option.label}
            hint={option.hint}
            info={option.info}
            focused={highlight === i}
            dwellProgress={highlight === i ? dwell : 0}
            onSelect={() => onPick(i)}
          />
        ))}
      </div>
    </main>
  );
}

/** Face found / where the eyes look / calibrated / mic, refreshed a few times a second. */
function useTracking(services: Services, view: View): TrackingStatus {
  const [tracking, setTracking] = useState<TrackingStatus>({
    faceFound: false,
    gaze: '',
    calibrated: true,
    micListening: null,
  });
  const micState = view.stt.state;
  useEffect(() => {
    let lastFrameAt = -Infinity;
    const unsub = services.faceTracker.onFrame(() => {
      lastFrameAt = performance.now();
    });
    const timer = setInterval(() => {
      const eye = services.eyeInput.status?.();
      setTracking({
        faceFound: services.usesCamera ? performance.now() - lastFrameAt < 500 : true,
        gaze: eye?.region ? (REGION_LABEL[eye.region] ?? eye.region) : '',
        calibrated: eye?.calibrated ?? true,
        micListening: services.usesMic ? micState === 'listening' : null,
      });
    }, 200);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, [services, micState]);
  return tracking;
}
