const API = 'http://localhost:4000';
const APP = 'http://localhost:5173';
const app = document.getElementById('app');

function money(n) {
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  return Math.round((target - today) / 86400000);
}

function getToken() {
  return chrome.storage.local.get('token').then((data) => data.token || null);
}

function setToken(token) {
  if (token) return chrome.storage.local.set({ token });
  return chrome.storage.local.remove('token');
}

async function api(path, options = {}) {
  const token = await getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(`${API}${path}`, { ...options, headers });
  } catch {
    throw new Error('API is not running. Start it with npm run dev.');
  }
  if (response.status === 401) {
    await setToken(null);
    throw new Error('unauthorized');
  }
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'Request failed');
  return data;
}

function loginView(message) {
  app.innerHTML = `
    <h1>Finance Tracker</h1>
    ${message ? `<p class="error">${message}</p>` : ''}
    <form id="login">
      <label>Username <input name="username" autocomplete="username" required /></label>
      <label>Password <input name="password" type="password" autocomplete="current-password" required /></label>
      <button type="submit">Sign in</button>
    </form>
  `;
  app.querySelector('#login').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: String(form.get('username') || '').trim(),
          password: String(form.get('password') || ''),
        }),
      });
      await setToken(data.token);
      await render();
    } catch (err) {
      loginView(err.message === 'unauthorized' ? 'Invalid username or password' : err.message);
    }
  });
}

function summaryView(entries) {
  const active = entries.filter((entry) => entry.status === 'active');
  const invested = active.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const upcoming = active
    .map((entry) => ({ ...entry, days: daysUntil(entry.date_of_maturity) }))
    .filter((entry) => entry.days <= 90)
    .sort((a, b) => a.days - b.days)
    .slice(0, 4);

  app.innerHTML = `
    <h1>Finance Tracker</h1>
    <div class="stats">
      <div class="stat"><span>Active</span><strong>${active.length}</strong></div>
      <div class="stat"><span>Invested</span><strong>₹${money(invested)}</strong></div>
    </div>
    <h2>Upcoming</h2>
    ${upcoming.length === 0 ? '<p class="muted">Nothing maturing in 90 days.</p>' : `
      <ul>
        ${upcoming.map((entry) => `
          <li>
            <span>${entry.serial_no}</span>
            <span class="badge${entry.days < 0 ? ' late' : ''}">${entry.days < 0 ? `${Math.abs(entry.days)}d overdue` : `${entry.days}d left`}</span>
          </li>
        `).join('')}
      </ul>
    `}
    <div class="row">
      <button id="open" type="button">Open app</button>
      <button id="logout" class="ghost" type="button">Log out</button>
    </div>
  `;
  app.querySelector('#open').addEventListener('click', () => chrome.tabs.create({ url: APP }));
  app.querySelector('#logout').addEventListener('click', async () => {
    const token = await getToken();
    if (token) {
      fetch(`${API}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    await setToken(null);
    loginView();
  });
}

async function render() {
  const token = await getToken();
  if (!token) {
    loginView();
    return;
  }
  try {
    const entries = await api('/api/entries');
    summaryView(entries);
  } catch (err) {
    if (err.message === 'unauthorized') loginView();
    else loginView(err.message);
  }
}

render();
