import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { Orchestrator } from './Orchestrator';
import { linkPartnerView } from './partnerLink';
import type { Services } from './services';

/**
 * Creates the Orchestrator once, starts the camera/mic/eye input while the page is open, and
 * re-renders the component whenever anything changes.
 * (We don't use React.StrictMode: its double-mount would open the camera twice.)
 */
export function useOrchestrator(services: Services) {
  const orchestrator = useMemo(() => new Orchestrator(services), [services]);

  useEffect(() => {
    const stop = orchestrator.start();
    const unlink = linkPartnerView(orchestrator);
    return () => {
      stop();
      unlink();
    };
  }, [orchestrator]);

  const view = useSyncExternalStore(orchestrator.subscribe, orchestrator.getView);
  return { orchestrator, view };
}
