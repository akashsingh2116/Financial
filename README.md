# Finance Tracker Dashboard

A personal finance dashboard for tracking insurance policies, FDs, mutual funds,
and similar instruments — with document attachments and free-form notes.

## Stack

- **client/** — React + Vite (three tabs: Overview, Finance Entries, Notes)
- **server/** — Express API. Locally this uses SQLite. With Firebase env vars set, records go to Cloud Firestore and uploaded files go to Cloud Storage.
- Uploaded documents are downloaded through the API while you are logged in.

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

Vercel does not keep a disk between updates. Set the Firebase env vars on the
Vercel project before relying on the live site, otherwise entries and uploaded
documents live in temporary storage and can disappear when Vercel replaces the
server. Without those vars, the computer copy in `server/finance.db` is the durable one.

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

## Firebase

Firestore holds entries, groups, and notes. Cloud Storage holds the attached files, in a separate 5 GB no-cost allowance, so 1,000 records can each keep a normal document. A file can still be up to 15 MB. One thousand files fit while their total size stays around 5 GB (about 5 MB each). Past that, storage is billed per extra gigabyte.

Cloud Storage requires the Firebase Blaze plan. Blaze is pay-as-you-go and still includes that no-cost allowance, but the project needs a billing account. Firestore itself stays inside the free limits for this app.

1. Create a Firebase project and upgrade it to Blaze.
2. Create a Firestore database and a Storage bucket. In `US-CENTRAL1`, `US-EAST1`, or `US-WEST1` the bucket can use the always-free storage tier.
3. Project settings → Service accounts → Generate new private key. Save that JSON as `server/firebase-service-account.json` (it is gitignored).
4. Start the API with:

```bash
FIREBASE_SERVICE_ACCOUNT_PATH=server/firebase-service-account.json FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app npm run dev
```

On Vercel, set `FIREBASE_SERVICE_ACCOUNT` to the JSON file contents and `FIREBASE_STORAGE_BUCKET` to the bucket name. Leave both unset to keep using local SQLite. Vercel’s request limit is about 4.5 MB, so a larger file uploads on your computer but can be rejected on the live site until the browser uploads straight to Storage.

The browser never talks to Firebase. The API uses the service account, so Firestore and Storage rules should deny all client access.

## Data

Without Firebase env vars, records live in a SQLite database, `server/finance.db`. Notes are in the same file. Uploaded documents are stored next to it in `server/uploads/`.

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
