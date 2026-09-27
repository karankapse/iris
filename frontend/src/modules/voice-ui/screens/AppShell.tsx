import { useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  Crosshair,
  KeyRound,
  MessageCircle,
  SlidersHorizontal,
  UserRound,
} from 'lucide-react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../../../app/AppContext';
import { NavBar, type NavItem } from '../../../components/ui/tubelight-navbar';
import { getSession, logout } from '../../../core/auth';
import { loadEyeCalibration } from '../../../core/eyeCalibration';

export const PAGES: readonly NavItem[] = [
  { url: '/', name: 'Talk', icon: MessageCircle },
  { url: '/calibrate', name: 'Calibrate', icon: Crosshair },
  { url: '/profile', name: 'Profile', icon: UserRound },
  { url: '/settings', name: 'Settings', icon: SlidersHorizontal },
  { url: '/voice', name: 'Voice', icon: AudioLines },
  { url: '/account', name: 'Account', icon: KeyRound },
];

export async function signOut() {
  await logout();
  location.assign('/login'); // a fresh app for the next person
}

/** Links to every page (used by the top bar and by the Talk page's menu). */
export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return <NavBar items={PAGES} onNavigate={onNavigate} />;
}

/**
 * The frame around every signed-in page. The Talk page is full screen (the person using their
 * eyes needs every pixel); all other pages get a top bar to move between pages. Eye gestures only
 * act on the Talk page, so looking around elsewhere never picks a reply by accident.
 */
export function AppShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { orchestrator, services } = useApp();
  const onTalk = pathname === '/';

  useEffect(() => {
    orchestrator.setSuspended(!onTalk);
  }, [onTalk, orchestrator]);

  // Load this account's eye calibration, then: never calibrated? Go to the Calibrate page first
  // (once per visit).
  const redirected = useRef(false);
  useEffect(() => {
    if (redirected.current) return;
    redirected.current = true;
    void loadEyeCalibration(services.eyeInput).then(() => {
      const needs =
        services.usesCamera &&
        orchestrator.getView().eyeMode !== 'vertical' &&
        services.eyeInput.status?.().calibrated === false;
      if (needs && onTalk) navigate('/calibrate?first=1', { replace: true });
    });
  }, [navigate, onTalk, orchestrator, services]);

  if (onTalk) return <Outlet />;

  const user = getSession()?.user;
  return (
    <div className="shell">
      <header className="topbar-nav">
        <div className="brand">
          <img className="brand-mark" src="/iris-mark.png" alt="" />
          <strong>Iris</strong>
        </div>
        <NavLinks />
        <div className="topbar-user">
          <span className="muted">{user?.name}</span>
          <button className="linkbtn small" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <main className="page" key={pathname}>
        <Outlet />
      </main>
    </div>
  );
}

/** The Talk page's menu: page links + sign out, in a slide-in drawer. */
export function NavDrawer({ onClose }: { onClose: () => void }) {
  const user = getSession()?.user;
  const [closing, setClosing] = useState(false);
  const close = () => {
    setClosing(true);
    setTimeout(onClose, 150);
  };
  return (
    <div className={`drawer-backdrop ${closing ? 'closing' : ''}`} onClick={close}>
      <aside className="drawer nav-drawer" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Iris</h2>
          <button onClick={close}>Close</button>
        </header>
        <NavBar items={PAGES} variant="list" onNavigate={onClose} />
        <div className="account-row">
          <span>
            Signed in as <strong>{user?.name}</strong>
          </span>
          <button onClick={signOut}>Sign out</button>
        </div>
        <button
          className="linkbtn"
          onClick={() => window.open('/partner', 'iris-partner', 'width=900,height=700')}
        >
          Open partner view ↗
        </button>
      </aside>
    </div>
  );
}
