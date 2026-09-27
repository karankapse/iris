import React, { useEffect, useState } from 'react';
import { getOptions } from '../../../../app/machine';
import type { Orchestrator, View } from '../../../../app/Orchestrator';
import type { Services } from '../../../../app/services';
import { MainScreen } from './main-screen';

interface Props {
  orchestrator: Orchestrator;
  view: View;
  services: Services;
  draft: string;
  setDraft: (v: string) => void;
  onPick: (i: number) => void;
  camera: React.ReactNode;
  onCalibrate: () => void;
  onOpenMenu: () => void;
}

const STATUS_MAP: Record<string, string> = {
  listening: 'Listening…',
  suggesting: 'Measuring reaction & getting replies…',
  selectReply: 'Choose a reply',
  moreReplies: 'More replies',
  menu: 'Other options',
  phrases: 'Quick phrases',
  typing: 'Type a reply',
  pickMood: 'Choose a mood',
  confirmTone: 'Speak it in this tone?',
  pickTone: 'Choose a different tone',
  speaking: 'Speaking…',
  feedback: 'Was the tone right?',
};

const REGION_LABEL: Record<string, string> = {
  center: 'resting (top)',
  left: 'left column',
  middle: 'middle column',
  right: 'right column',
};

export function V0ColumnLayout({ orchestrator, view, services, draft, setDraft, onPick, camera, onCalibrate, onOpenMenu }: Props) {
  const { machine, highlight, dwell } = view;
  
  const [tracking, setTracking] = useState({
    faceFound: false,
    gaze: '',
    calibrated: true,
    micListening: false
  });

  useEffect(() => {
    let latestFrameTime = 0;
    const unsub = services.faceTracker.onFrame(f => {
      latestFrameTime = f.t;
    });

    const timer = setInterval(() => {
      const faceFound = (performance.now() - latestFrameTime) < 500;
      const eye = services.eyeInput.status?.();
      setTracking({
        faceFound,
        gaze: eye?.region ? (REGION_LABEL[eye.region] ?? eye.region) : '',
        calibrated: eye?.calibrated ?? true,
        micListening: view.stt.state === 'listening'
      });
    }, 200);

    return () => {
      unsub();
      clearInterval(timer);
    };
  }, [services, view.stt.state]);

  const options = getOptions(machine).map(opt => ({
    label: opt.label,
    hint: opt.hint
  }));

  const partnerText = machine.interim || machine.partnerText || undefined;
  
  const handlePartnerText = (text: string) => {
    orchestrator.dispatch({ type: 'partner_final', text });
  };

  return (
    <MainScreen
      options={options}
      focusedIndex={highlight}
      dwellProgress={dwell}
      partnerText={partnerText}
      status={STATUS_MAP[machine.phase] || machine.phase}
      isListening={machine.phase === 'listening'}
      tracking={tracking}
      camera={camera}
      onSelect={onPick}
      onSendPartnerText={handlePartnerText}
      onCalibrate={onCalibrate}
      onOpenMenu={onOpenMenu}
    />
  );
}
