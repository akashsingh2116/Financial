import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import LoginPage from './components/LoginPage';
import useScrollHeader from './useScrollHeader';
import OverviewTab from './components/OverviewTab';
import EntriesTab from './components/EntriesTab';
import NotesTab from './components/NotesTab';
import GroupsTab from './components/GroupsTab';
import { listEntries, listGroups, listNotes, getToken, logout, googleStatus, startGoogleConnect, disconnectGoogle, syncNow, retryFailed, discardFailed } from './api';

const TABS = [
  {
    key: 'overview',
    label: 'Overview',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-6" /></svg>
    ),
  },
  {
    key: 'groups',
    label: 'Groups',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z" /></svg>
    ),
  },
  {
    key: 'entries',
    label: 'Finance Entries',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M7 15h4" /></svg>
    ),
  },
  {
    key: 'notes',
    label: 'Notes',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h7.5L20 9v11.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1Z" /><path d="M14 3.5V9h6M9 13h6M9 17h4" /></svg>
    ),
  },
];

export default function App() {
  const [token, setToken] = useState(getToken());
  const [tab, setTab] = useState('overview');
  const [entries, setEntries] = useState([]);
  const [notes, setNotes] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(() => !navigator.onLine);
  const [pending, setPending] = useState(0);
  const [syncError, setSyncError] = useState('');
  const [failed, setFailed] = useState([]);
  const pendingRef = useRef(0);
  const [drive, setDrive] = useState({ configured: false, connected: false, email: '' });
  const [driveError, setDriveError] = useState('');

  const reload = useCallback(async () => {
    try {
      const [entriesData, notesData, groupsData] = await Promise.all([
        listEntries(),
        listNotes(),
        listGroups(),
      ]);
      setEntries(entriesData);
      setNotes(notesData);
      setGroups(groupsData);
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to load data. Is the API server running?');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    function handleUnauthorized() {
      setToken(null);
    }
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  useEffect(() => {
    function onStatus(event) {
      const { offline: isOffline, pending: waiting, error: message, failed: refused } = event.detail;
      setOffline(isOffline);
      setPending(waiting);
      setSyncError(message || '');
      setFailed(refused || []);
      // Everything saved on this device just reached the server: show the synced records.
      if (pendingRef.current > 0 && waiting === 0 && !isOffline && getToken()) reload();
      pendingRef.current = waiting;
    }
    function onVisible() {
      if (document.visibilityState === 'visible' && getToken()) syncNow();
    }
    function onOffline() {
      setOffline(true);
    }
    function onOnline() {
      if (getToken()) reload();
    }
    window.addEventListener('sync:status', onStatus);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('sync:status', onStatus);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [reload]);

  useEffect(() => {
    if (token) reload();
  }, [token, reload]);

  useEffect(() => {
    if (!token) return undefined;
    const params = new URLSearchParams(window.location.search);
    const google = params.get('google');
    const reason = params.get('reason');
    if (google) {
      params.delete('google');
      params.delete('reason');
      const next = params.toString();
      window.history.replaceState({}, '', next ? `?${next}` : window.location.pathname);
      setDriveError(google === 'connected' ? '' : (reason || 'Google Drive was not connected. Approve access on Google and try again.'));
    }
    googleStatus().then(setDrive).catch((err) => setDriveError(err.message));
    return undefined;
  }, [token]);

  const { scrolled, condensed, showTop } = useScrollHeader();
  const tabsRef = useRef(null);
  const [indicator, setIndicator] = useState(null);

  // Slides the highlight under the active tab and keeps that tab in view on narrow screens.
  useLayoutEffect(() => {
    const nav = tabsRef.current;
    if (!nav) return undefined;
    function place() {
      const active = nav.querySelector('.tab-btn-active');
      if (!active) return;
      setIndicator({ left: active.offsetLeft, width: active.offsetWidth });
    }
    place();
    const active = nav.querySelector('.tab-btn-active');
    if (active && nav.scrollWidth > nav.clientWidth) {
      nav.scrollTo({ left: active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2, behavior: 'smooth' });
    }
    const observer = new ResizeObserver(place);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [tab, token, drive.connected]);

  const topRef = useRef(null);

  // The condensed header slides up by exactly the brand row's height.
  useLayoutEffect(() => {
    const top = topRef.current;
    const row = top?.querySelector('.app-header-row');
    if (!row) return undefined;
    const measure = () => top.style.setProperty('--brand-row-height', `${row.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [token]);

  function changeTab(key) {
    setTab(key);
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (!token) {
    return <LoginPage onLogin={setToken} />;
  }

  function handleLogout() {
    logout();
    setToken(null);
  }

  return (
    <div className="app-shell">
      <div ref={topRef} className={`app-top${scrolled ? ' is-scrolled' : ''}${condensed ? ' is-condensed' : ''}`}>
      <header className="app-header">
        <div className="app-header-row">
          <div className="brand">
            <span className="brand-logo" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M12 3v18M7 7.5h7.5a2.5 2.5 0 0 1 0 5H9.5a2.5 2.5 0 0 0 0 5H17" /></svg>
            </span>
            <div className="brand-copy">
              <h1>Finance Tracker</h1>
              <p>Personal ledger</p>
            </div>
          </div>
          <div className="header-actions">
            {drive.connected ? (
              <div className="drive-chip" title={drive.email}>
                <span className="drive-dot" aria-hidden="true" />
                <span className="drive-email">{drive.email}</span>
                <button className="btn btn-ghost header-quiet" onClick={() => disconnectGoogle().then(() => setDrive((current) => ({ ...current, connected: false, email: '' }))).then(reload)}>
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                className="btn btn-primary header-connect"
                onClick={() => startGoogleConnect().catch((err) => setDriveError(err.message))}
              >
                Connect Gmail
              </button>
            )}
            <button className="btn btn-ghost logout-btn" onClick={handleLogout} aria-label="Logout" title="Logout">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7V5a1 1 0 0 1 1-1h8v16h-8a1 1 0 0 1-1-1v-2" /><path d="M4 12h11M12 8l4 4-4 4" /></svg>
              <span className="btn-label">Logout</span>
            </button>
          </div>
        </div>
        <nav className="tabs" aria-label="Sections" ref={tabsRef}>
          {indicator && (
            <span
              className="tab-indicator"
              aria-hidden="true"
              style={{ width: indicator.width, transform: `translateX(${indicator.left}px)` }}
            />
          )}
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`tab-btn${tab === t.key ? ' tab-btn-active' : ''}`}
              onClick={() => changeTab(t.key)}
              aria-current={tab === t.key ? 'page' : undefined}
            >
              <span className="tab-icon">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      </div>

      <main className="app-main">
        {offline && (
          <div className="banner banner-warn">
            You are offline. New entries and notes stay on this device and sync to the database when you are back online.
          </div>
        )}
        {!offline && pending > 0 && (
          <div className="banner banner-warn">
            {pending} saved {pending === 1 ? 'change is' : 'changes are'} waiting to reach the database.
          </div>
        )}
        {syncError && <div className="banner banner-error">{syncError}</div>}
        {failed.length > 0 && (
          <div className="banner banner-error banner-actions">
            <span>
              {failed.length} saved {failed.length === 1 ? 'change was' : 'changes were'} not accepted: {failed[0].reason}
            </span>
            <span className="banner-buttons">
              <button type="button" className="btn btn-ghost" onClick={() => retryFailed().then(reload)}>Retry</button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  if (window.confirm('Discard the changes that could not be saved? This cannot be undone.')) discardFailed().then(reload);
                }}
              >
                Discard
              </button>
            </span>
          </div>
        )}
        {driveError && <div className="banner banner-error">{driveError}</div>}
        {!drive.connected && !loading && (
          <div className="banner">
            Connect Gmail opens Google's page. Enter that Gmail and password there, then approve access. Records and files are saved in that Drive. This app never sees the password.
          </div>
        )}
        {drive.connected && (
          <div className="banner">
            Records and files are saved in {drive.email}'s Google Drive.
          </div>
        )}
        {error && <div className="banner banner-error">{error}</div>}
        {loading ? (
          <div className="empty-state">Loading...</div>
        ) : (
          <div className="tab-panel" key={tab}>
            {tab === 'overview' && <OverviewTab entries={entries} groups={groups} />}
            {tab === 'groups' && <GroupsTab groups={groups} entries={entries} reload={reload} />}
            {tab === 'entries' && <EntriesTab entries={entries} notes={notes} groups={groups} reload={reload} />}
            {tab === 'notes' && <NotesTab notes={notes} entries={entries} reload={reload} />}
          </div>
        )}
      </main>
      <button
        type="button"
        className={`to-top${showTop ? ' is-visible' : ''}`}
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="Back to top"
        tabIndex={showTop ? 0 : -1}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
      </button>
      <footer className="app-footer">
        <span>Made with <span className="heart" aria-label="love">&#10084;</span> by Akash</span>
        <span className="app-version">v{__APP_VERSION__}</span>
      </footer>
    </div>
  );
}
