// One Orchestrator for the whole signed-in app. It lives ABOVE the pages, so the camera, mic and
// face models keep running when you switch pages (calibrating on its own page works, and coming
// back to Talk is instant).
import { createContext, useContext, type ReactNode } from 'react';
import type { Orchestrator, View } from './Orchestrator';
import { getServices, type Services } from './services';
import { useOrchestrator } from './useOrchestrator';

interface AppState {
  services: Services;
  orchestrator: Orchestrator;
  view: View;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const services = getServices();
  const { orchestrator, view } = useOrchestrator(services);
  return <Ctx.Provider value={{ services, orchestrator, view }}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const state = useContext(Ctx);
  if (!state) throw new Error('useApp() must be used inside <AppProvider>');
  return state;
}
