// The partner view is a second browser window on the same laptop (route: /partner).
// The two windows talk over a BroadcastChannel: no server needed, and nothing leaves the machine.
import type { Emotion } from '../contracts';
import type { Orchestrator } from './Orchestrator';
import type { Phase, SpokenReply } from './machine';

const CHANNEL_NAME = 'iris-partner-view';

/** main window -> partner window */
export interface PartnerViewMessage {
  type: 'view';
  partnerText: string;
  interim: string;
  phase: Phase;
  /** What the user has typed so far on the eye keyboard (for the "typing…" indicator). */
  typed: string;
  lastSpoken: SpokenReply | null;
  mood: Emotion | null;
}

/** partner window -> main window */
export type PartnerAction =
  { type: 'hello' } | { type: 'reaction'; reaction: 'understood' | 'seemed_off' };

export const openChannel = () =>
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);

/** Main window side: push state to the partner window, and turn its button taps into events. */
export function linkPartnerView(orchestrator: Orchestrator): () => void {
  const channel = openChannel();
  if (!channel) return () => {};

  const push = () => {
    const { machine } = orchestrator.getView();
    const message: PartnerViewMessage = {
      type: 'view',
      partnerText: machine.partnerText,
      interim: machine.interim,
      phase: machine.phase,
      typed: machine.typed,
      lastSpoken: machine.lastSpoken,
      mood: machine.mood,
    };
    channel.postMessage(message);
  };

  channel.onmessage = (e: MessageEvent<PartnerAction>) => {
    if (e.data.type === 'hello') push(); // a partner window just opened: bring it up to date
    if (e.data.type === 'reaction') {
      orchestrator.dispatch({ type: 'partner_reaction', reaction: e.data.reaction });
    }
  };
  const unsubscribe = orchestrator.onView(push);
  return () => {
    unsubscribe();
    channel.close();
  };
}
