import type { ReactNode } from 'react';
import { Crosshair, Menu } from 'lucide-react';
import { cn } from '../../../../core/utils';

export type TrackingStatus = {
  faceFound: boolean;
  /** Where the eyes are looking ("left column"...), empty when the eye mode doesn't track that. */
  gaze: string;
  calibrated: boolean;
  /** null = no microphone in use (typing only). */
  micListening: boolean | null;
};

type CameraPanelProps = {
  camera: ReactNode;
  tracking: TrackingStatus;
  /** Hidden when no camera is in use (keyboard mock). */
  onCalibrate?: () => void;
  onOpenMenu?: () => void;
};

function StatusPill({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  return (
    <li
      className={cn(
        'flex items-center gap-2 rounded-full px-3 py-1.5 font-mono text-xs',
        ok === true && 'bg-primary/12 text-primary',
        ok === false && 'bg-warning/15 text-warning',
        ok === null && 'bg-foreground/6 text-muted-foreground',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 rounded-full',
          ok === true && 'bg-primary',
          ok === false && 'bg-warning',
          ok === null && 'bg-muted-foreground',
        )}
      />
      {children}
    </li>
  );
}

export function CameraPanel({ camera, tracking, onCalibrate, onOpenMenu }: CameraPanelProps) {
  return (
    <section
      aria-label="Eye tracking status"
      className="flex shrink-0 items-stretch gap-4 rounded-3xl border border-border bg-card/55 p-3 backdrop-blur-2xl"
    >
      <div className="v0-camera relative aspect-square w-32 overflow-hidden rounded-2xl bg-background md:w-40">
        {camera}
        <span
          className={cn(
            'absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-background/70 px-2 py-1 font-mono text-[11px] backdrop-blur',
            tracking.faceFound ? 'text-primary' : 'text-warning',
          )}
        >
          <span
            className={cn(
              'size-1.5 rounded-full',
              tracking.faceFound ? 'animate-iris-pulse bg-primary' : 'bg-warning',
            )}
          />
          {tracking.faceFound ? 'Live' : 'No face'}
        </span>
      </div>

      <div className="flex flex-col justify-between gap-3 py-1 pr-1">
        <ul className="flex flex-col items-start gap-1.5" aria-live="polite">
          <StatusPill ok={tracking.faceFound}>
            {tracking.faceFound ? 'face found' : 'no face'}
          </StatusPill>
          {tracking.gaze && <StatusPill ok={null}>looking: {tracking.gaze}</StatusPill>}
          <StatusPill ok={tracking.calibrated}>
            {tracking.calibrated ? 'calibrated' : 'not calibrated'}
          </StatusPill>
          {tracking.micListening !== null && (
            <StatusPill ok={tracking.micListening}>
              mic: {tracking.micListening ? 'listening' : 'off'}
            </StatusPill>
          )}
        </ul>

        <div className="flex items-center gap-2">
          {onCalibrate && (
            <button
              type="button"
              onClick={onCalibrate}
              className={cn(
                'flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors',
                tracking.calibrated
                  ? 'bg-foreground/8 text-foreground hover:bg-foreground/12'
                  : 'bg-warning text-warning-foreground hover:bg-warning/90',
              )}
            >
              <Crosshair className="size-4" aria-hidden="true" />
              Calibrate
            </button>
          )}
          <button
            type="button"
            onClick={onOpenMenu}
            aria-label="Open menu"
            className="flex size-9 items-center justify-center rounded-full bg-foreground/8 text-foreground transition-colors hover:bg-foreground/12"
          >
            <Menu className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}
