import { useState } from 'react';
import { login } from '../api';

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { token } = await login(username.trim(), password);
      onLogin(token);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-blob login-blob-a" />
      <div className="login-blob login-blob-b" />
      <div className="login-blob login-blob-c" />

      <div className="login-card">
        <FinanceIllustration className="login-illustration" />

        <div className="login-brand">
          <span className="login-logo">💰</span>
          <h1>Finance Tracker</h1>
          <p>Your policies, deposits &amp; investments — all in one place.</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="field">
            <span className="field-label">Username</span>
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              autoComplete="username"
            />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <span className="password-field">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </span>
          </label>

          {error && <div className="form-error">{error}</div>}

          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"
      />
      <circle cx="12" cy="12" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 3l18 18M10.6 10.6A2.5 2.5 0 0 0 12 14.5 2.5 2.5 0 0 0 13.4 13.4M9.9 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a18.4 18.4 0 0 1-3.2 4.1M6.1 6.1C3.7 7.8 2 12 2 12s3.5 6 10 6c1.3 0 2.5-.2 3.6-.7"
      />
    </svg>
  );
}

function FinanceIllustration({ className }) {
  return (
    <svg className={className} viewBox="0 0 240 160" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="ftBar1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#60a5fa" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
        <linearGradient id="ftBar2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#34d399" />
          <stop offset="1" stopColor="#059669" />
        </linearGradient>
        <linearGradient id="ftCoin" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fde68a" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
      </defs>

      <ellipse cx="120" cy="146" rx="92" ry="10" fill="#334155" />

      <rect x="34" y="86" width="26" height="54" rx="4" fill="url(#ftBar1)" />
      <rect x="72" y="60" width="26" height="80" rx="4" fill="url(#ftBar2)" />
      <rect x="110" y="100" width="26" height="40" rx="4" fill="url(#ftBar1)" />
      <rect x="148" y="44" width="26" height="96" rx="4" fill="url(#ftBar2)" />

      <path d="M34 88 L72 62 L110 96 L148 40" stroke="#e2e8f0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.7" />
      <path d="M136 40 L148 40 L148 52" stroke="#e2e8f0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.7" />

      <circle cx="188" cy="86" r="16" fill="url(#ftCoin)" stroke="#b45309" strokeWidth="1.5" />
      <text x="188" y="91" fontSize="14" fontWeight="700" fill="#92400e" textAnchor="middle">₹</text>

      <circle cx="205" cy="110" r="10" fill="url(#ftCoin)" stroke="#b45309" strokeWidth="1.2" />
      <text x="205" y="114" fontSize="9" fontWeight="700" fill="#92400e" textAnchor="middle">₹</text>

      <path d="M20 40 a14 14 0 1 1 0 0.1" stroke="#93c5fd" strokeWidth="3" fill="none" opacity="0.6" />
      <circle cx="26" cy="112" r="5" fill="#a7f3d0" />
      <circle cx="212" cy="30" r="6" fill="#bfdbfe" />
    </svg>
  );
}
