import { useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { checkSession, getSession } from '../core/auth';
import { LoginScreen } from '../modules/voice-ui/screens/LoginScreen';
import { MainScreen } from '../modules/voice-ui/screens/MainScreen';
import { PartnerView } from '../modules/voice-ui/screens/PartnerView';
import { ToneTester } from '../modules/voice-ui/screens/ToneTester';
import { getServices } from './services';

/**
 * Only logged-in people get the app. The partner view (a second window on the same laptop) is
 * open to anyone, since it only shows what the main window sends it.
 */
function RequireLogin({ children }: { children: React.ReactNode }) {
  const [loggedIn, setLoggedIn] = useState(() => getSession() !== null);

  // Make sure a saved login is still valid on the backend.
  useEffect(() => {
    if (loggedIn) void checkSession().then((u) => !u && setLoggedIn(false));
  }, [loggedIn]);

  // Full reload after logging in, so everything (camera, models, voice) starts for this person.
  return loggedIn ? <>{children}</> : <LoginScreen onDone={() => location.assign('/')} />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <RequireLogin>
              <MainScreen services={getServices()} />
            </RequireLogin>
          }
        />
        <Route path="/partner" element={<PartnerView />} />
        <Route
          path="/tone-tester"
          element={
            <RequireLogin>
              <ToneTester />
            </RequireLogin>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
