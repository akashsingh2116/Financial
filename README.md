# Finance Tracker Dashboard

A personal finance dashboard for tracking insurance policies, FDs, mutual funds,
and similar instruments — with document attachments and free-form notes.

## Stack

- **client/** — React + Vite (three tabs: Overview, Finance Entries, Notes)
- **server/** — Express API, SQLite (Node's built-in `node:sqlite`), file uploads via Multer
- Uploaded documents are stored on disk at `server/uploads/` and downloaded through the API while you are logged in.

## Setup

```bash
npm run install:all   # installs deps for both server and client
npm run dev            # runs API on :4000 and the app on :5173 (with proxy)
```

Then open http://localhost:5173.

## Browser extension

`extension/` is a Chrome extension for a quick look at active totals and upcoming
maturities. It talks to the local API, so `npm run dev` needs to be running.

1. Open `chrome://extensions`
2. Turn on Developer mode
3. Choose **Load unpacked** and select the `extension` folder
4. Pin Finance Tracker, then sign in with the same username and password as the app

## financial.whoisakash.com

The site is deployed on Vercel from this repo. Static files are built into
`public/`. The API is the Express app.

Vercel does not keep a disk between updates, so entries and uploaded documents
live in temporary storage there and can disappear when Vercel replaces the
server. Your computer copy in `server/finance.db` is the durable one.

DNS for whoisakash.com is at BigRock. Point the subdomain at Vercel with:

| Type | Host | Value |
| --- | --- | --- |
| CNAME | financial | cname.vercel-dns.com |

## Login

Single-user app, credentials are fixed server-side (not self-service signup).

- Default username: `akash`
- Default password: `Finance@123`

To change them, set `AUTH_USERNAME` and `AUTH_PASSWORD` env vars before starting the
server (or edit the defaults in `server/auth.js`), e.g.:

```bash
AUTH_USERNAME=yourname AUTH_PASSWORD=yourpassword npm run dev --prefix server
```

Sessions are simple bearer tokens kept in memory on the server — they reset if the
server restarts (you'll just need to log in again).

## Data

Records already live in a SQLite database, `server/finance.db`. A few hundred
entries is a tiny amount for it. Notes are in the same file. Uploaded documents
are stored next to it in `server/uploads/`.

The database and uploads are gitignored, so GitHub is not a copy of your data.
Each time the API starts, and again every 24 hours while it is running, it saves
a snapshot:

- `server/backups/finance-<timestamp>.db` — the entries and notes (30 snapshots kept)
- `server/backups/uploads/` — a copy of the attached documents

Those copies sit on the same computer, so they protect you if a file is deleted
or the app hits a bad write. They do not protect you if the disk itself fails.
Point the backup folder at a cloud-synced directory (OneDrive, Google Drive, or
an external drive) before starting the server:

```bash
BACKUP_DIR="C:/Users/You/OneDrive/FinanceBackups" npm run dev
```

## Tabs

- **Overview** — active invested/maturity/gain (closed policies are left out of the money totals), upcoming maturities (90 days), breakdown by product and status.
- **Finance Entries** — the core record: serial/policy no., owner, product type, issuer,
  amount, maturity amount, issue/maturity dates, nominee (+ relation), premium frequency,
  status, remarks, and an attached image/PDF. Search, filter by owner/product/status, open a
  record to see the full details and linked notes, and export the current list as Excel, Word, PDF, or CSV.
  Those files can be imported back as new entries. Attached documents are not part of the export.
  Rows nearing maturity (or overdue) are highlighted.
- **Notes** — free-form notes, optionally linked to a specific entry (e.g. "call agent
  before maturity", claim steps, contact numbers).

## Extending

Product types, status values, and premium frequencies are centralized in
`client/src/constants.js` — add more there rather than hardcoding in components.
