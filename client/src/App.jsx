import { useEffect, useState, useCallback } from 'react';
import LoginPage from './components/LoginPage';
import OverviewTab from './components/OverviewTab';
import EntriesTab from './components/EntriesTab';
import NotesTab from './components/NotesTab';
import { listEntries, listNotes, getToken, logout } from './api';

const TABS = [
  { key: 'overview', label: 'Overview', icon: '📊' },
  { key: 'entries', label: 'Finance Entries', icon: '📁' },
  { key: 'notes', label: 'Notes', icon: '📝' },
];

export default function App() {
  const [token, setToken] = useState(getToken());
  const [tab, setTab] = useState('overview');
  const [entries, setEntries] = useState([]);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      const [entriesData, notesData] = await Promise.all([listEntries(), listNotes()]);
      setEntries(entriesData);
      setNotes(notesData);
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
    if (token) reload();
  }, [token, reload]);

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
          <button className="btn btn-ghost logout-btn" onClick={handleLogout}>
            <span aria-hidden="true">⏻</span> Logout
          </button>
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
        {error && <div className="banner banner-error">{error}</div>}
        {loading ? (
          <div className="empty-state">Loading...</div>
        ) : (
          <>
            {tab === 'overview' && <OverviewTab entries={entries} />}
            {tab === 'entries' && <EntriesTab entries={entries} notes={notes} reload={reload} />}
            {tab === 'notes' && <NotesTab notes={notes} entries={entries} reload={reload} />}
          </>
        )}
      </main>
    </div>
  );
}
