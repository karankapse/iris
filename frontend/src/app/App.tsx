import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { checkSession, getSession } from '../core/auth';
import { AppShell } from '../modules/voice-ui/screens/AppShell';
import { LoginScreen } from '../modules/voice-ui/screens/LoginScreen';
import { MainScreen } from '../modules/voice-ui/screens/MainScreen';
import {
  AccountPage,
  CalibratePage,
  ProfilePage,
  SettingsPage,
} from '../modules/voice-ui/screens/pages';
import { PartnerView } from '../modules/voice-ui/screens/PartnerView';
import { ResetPasswordScreen } from '../modules/voice-ui/screens/ResetPasswordScreen';
import { ToneTester } from '../modules/voice-ui/screens/ToneTester';
import { AppProvider } from './AppContext';

/** Signed-in pages only. Not signed in (or the session expired) -> the login page. */
function RequireLogin({ children }: { children: ReactNode }) {
  const [loggedIn, setLoggedIn] = useState(() => getSession() !== null);
  useEffect(() => {
    if (loggedIn) void checkSession().then((u) => !u && setLoggedIn(false));
  }, [loggedIn]);
  return loggedIn ? <>{children}</> : <Navigate to="/login" replace />;
}

function LoginRoute() {
  // Already signed in? Straight to the app. After signing in: full reload so the camera, models
  // and voice start for this person.
  if (getSession()) return <Navigate to="/" replace />;
  return <LoginScreen onDone={() => location.assign('/')} />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/reset-password" element={<ResetPasswordScreen />} />
        {/* the partner's second window: open to anyone, it only mirrors the main window */}
        <Route path="/partner" element={<PartnerView />} />
        <Route
          element={
            <RequireLogin>
              <AppProvider>
                <AppShell />
              </AppProvider>
            </RequireLogin>
          }
        >
          <Route index element={<MainScreen />} />
          <Route path="calibrate" element={<CalibratePage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="voice" element={<ToneTester />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="tone-tester" element={<Navigate to="/voice" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
