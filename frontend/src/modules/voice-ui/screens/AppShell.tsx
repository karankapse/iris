import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../../../app/AppContext';
import { getSession, logout } from '../../../core/auth';

export const PAGES = [
  { to: '/', label: 'Talk', icon: '💬' },
  { to: '/calibrate', label: 'Calibrate', icon: '👁' },
  { to: '/profile', label: 'Profile', icon: '🙂' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
  { to: '/voice', label: 'Voice', icon: '🔊' },
  { to: '/account', label: 'Account', icon: '👤' },
] as const;

export async function signOut() {
  await logout();
  location.assign('/login'); // a fresh app for the next person
}

/** Links to every page (used by the top bar and by the Talk page's menu). */
export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="nav-links" aria-label="Pages">
      {PAGES.map((p) => (
        <NavLink
          key={p.to}
          to={p.to}
          end={p.to === '/'}
          onClick={onNavigate}
          className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
        >
          <span aria-hidden="true">{p.icon}</span> {p.label}
        </NavLink>
      ))}
    </nav>
  );
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

  // Never calibrated? Go to the Calibrate page first (once per visit).
  const redirected = useRef(false);
  useEffect(() => {
    if (redirected.current) return;
    redirected.current = true;
    const needs =
      services.usesCamera &&
      orchestrator.getView().eyeMode !== 'vertical' &&
      services.eyeInput.status?.().calibrated === false;
    if (needs && onTalk) navigate('/calibrate?first=1', { replace: true });
  }, [navigate, onTalk, orchestrator, services]);

  if (onTalk) return <Outlet />;

  const user = getSession()?.user;
  return (
    <div className="shell">
      <header className="topbar-nav">
        <div className="brand">
          <div className="face-placeholder tiny" aria-hidden="true">
            <span />
            <span />
          </div>
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
        <NavLinks onNavigate={onClose} />
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
