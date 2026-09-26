import { useEffect, useState, useCallback } from 'react';
import LoginPage from './components/LoginPage';
import OverviewTab from './components/OverviewTab';
import EntriesTab from './components/EntriesTab';
import NotesTab from './components/NotesTab';
import GroupsTab from './components/GroupsTab';
import { listEntries, listGroups, listNotes, getToken, logout, googleStatus, startGoogleConnect, disconnectGoogle } from './api';

const TABS = [
  { key: 'overview', label: 'Overview', icon: '📊' },
  { key: 'groups', label: 'Groups', icon: '🗂️' },
  { key: 'entries', label: 'Finance Entries', icon: '📁' },
  { key: 'notes', label: 'Notes', icon: '📝' },
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
      setOffline(event.detail.offline);
      setPending(event.detail.pending);
      setSyncError(event.detail.error || '');
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
    return () => {
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
    if (google) {
      params.delete('google');
      const next = params.toString();
      window.history.replaceState({}, '', next ? `?${next}` : window.location.pathname);
      setDriveError(google === 'connected' ? '' : 'Google Drive was not connected. Approve access on Google and try again.');
    }
    googleStatus().then(setDrive).catch((err) => setDriveError(err.message));
    return undefined;
  }, [token]);

  if (!token) {
    return <LoginPage onLogin={setToken} />;
  }

  function handleLogout() {
    logout();
    setToken(null);
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-row">
          <div className="brand">
            <span className="brand-logo">💰</span>
            <h1>Finance Tracker</h1>
          </div>
          <div className="header-actions">
            {drive.connected ? (
              <div className="drive-chip">
                <span>{drive.email}</span>
                <button className="btn btn-ghost" onClick={() => disconnectGoogle().then(() => setDrive((current) => ({ ...current, connected: false, email: '' }))).then(reload)}>
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                className="btn btn-primary"
                onClick={() => startGoogleConnect().catch((err) => setDriveError(err.message))}
              >
                Connect Gmail
              </button>
            )}
            <button className="btn btn-ghost logout-btn" onClick={handleLogout}>
              <span aria-hidden="true">⏻</span> Logout
            </button>
          </div>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`tab-btn${tab === t.key ? ' tab-btn-active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              <span className="tab-icon" aria-hidden="true">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
      </header>

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
          <>
            {tab === 'overview' && <OverviewTab entries={entries} groups={groups} />}
            {tab === 'groups' && <GroupsTab groups={groups} entries={entries} reload={reload} />}
            {tab === 'entries' && <EntriesTab entries={entries} notes={notes} groups={groups} reload={reload} />}
            {tab === 'notes' && <NotesTab notes={notes} entries={entries} reload={reload} />}
          </>
        )}
      </main>
    </div>
  );
}
