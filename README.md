# Kin

A private, character-based roleplay app for WWE, The Vampire Diaries, Supernatural, Twilight, and original characters. People write scenes, character updates, and out-of-character plot notes with approved connections.

## What works

- Invite-only writer accounts with password sign-in and HttpOnly session cookies.
- Single-use recovery codes for forgotten passwords. Recovery revokes previous sessions and issues a replacement code.
- One editable character per writer: name, fandom, role, pronouns, avatar, bio, backstory, and writer boundaries.
- Connection requests by exact writer handle. Recipients approve requests before either side can read posts.
- Story cast and Writing partners audiences assigned by the post author.
- IC/OOC posts and replies, optional photos, likes, private bookmarks, fandom filters, and chronological feeds.
- PostgreSQL-backed records and private photos. Every photo request checks the current viewer's permissions.
- Sign-out, a visible-writing JSON export, and a responsive desktop/mobile interface.

These are unofficial fan portrayals, not official accounts. Kin is unaffiliated with WWE or the featured series.

## Run locally

Install Node.js 22 or later and PostgreSQL. Create an empty database dedicated to Kin.

```sh
npm ci
```

Set these environment variables in your terminal or your development environment:

| Variable | Local example | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://user:password@localhost:5432/kin` | Server-only database connection |
| `APP_ORIGIN` | `http://localhost:3000` | Exact browser origin, without a trailing slash |
| `REGISTRATION_CODE` | Generate a private random value of at least 24 characters | Code you share with invited writers |
| `PORT` | `3000` | Optional local HTTP port |
| `NODE_ENV` | `development` | Production enables Secure cookies and requires HTTPS |

The example database URL is a placeholder. Keep real credentials in environment variables. Do not commit them or place them in `dist/`.

```sh
npm start
```

Open `http://localhost:3000`. Choose **Have an invite? Join Kin**, create a writer handle and password, and save the recovery code. Share your handle with friends, exchange requests in **Your cast**, and approve connections before sharing scenes.

Opening `dist/index.html` directly from disk still runs the original local demo, with sample fan characters and browser-only storage. The HTTP server always uses real accounts; it never falls back to sample data after an account or connection error. Existing browser demo data is not imported into real accounts.

## Deploy to Railway

The repository contains a Dockerfile and `railway.json`. The app listens on Railway's `PORT`, serves the frontend and API from the same origin, and checks database health at `/api/health`.

The selected project is [Kin's Railway project](https://railway.com/project/c7843dc4-479f-4bdd-af39-f385b0e281ab?environmentId=6ffdccad-e63f-438c-96e3-613bd65873c4).

1. In that project and environment, add a dedicated PostgreSQL service if one is not already present.
2. Add an app service from `Rogue-cpu/Kin`, using the repository root and Dockerfile.
3. Reference the Postgres service's `DATABASE_URL` in the app service. Keep the database on Railway's private network. The database connection belongs only in the server environment.
4. Generate a public HTTPS domain for the app. Set `APP_ORIGIN` to that exact origin, with no trailing slash.
5. Set a private `REGISTRATION_CODE` with at least 24 random characters. `NODE_ENV=production` is already set by the Dockerfile.
6. Deploy. Schema creation runs in a transaction at startup and uses `CREATE TABLE IF NOT EXISTS`. No seed characters, posts, or accounts are created in production.
7. Verify `/api/health`, register your own account, save your recovery code, and test sharing with a second invited writer.

Rotate `REGISTRATION_CODE` in Railway to stop an old signup code from being used. Existing accounts keep working. Use a dedicated Kin database and start with one app replica. The initial schema setup is additive; future schema changes should be introduced as explicit migrations. Configure backups for the Postgres service before relying on the app for writing you want to keep.

## Privacy and storage

Writer passwords are salted and hashed with Node's scrypt. Session tokens and recovery codes are stored only as hashes. Password hashing has a concurrency cap, and authentication and write attempts have database-backed limits. Write requests require the configured Origin. The frontend never receives database credentials or session tokens, and live account data is not saved to demo localStorage.

The server uses parameterized queries and chooses account identity from the authenticated session. It checks approved relationships and author-defined audience membership when reading posts, replying, liking, bookmarking, or fetching photos. Removing a connection revokes future access. Copies someone already downloaded cannot be withdrawn.

For this small private beta, resized JPEGs are stored as Postgres `bytea` records, limited to 2 MB each. Files are served only from authenticated API endpoints with `Cache-Control: no-store`. Photos are not put in the public frontend directory. Deleted or replaced image records may remain unreferenced in the database; object storage and media garbage collection are future work.

## Tests

```sh
npm test
```

The API tests use PGlite, which runs actual PostgreSQL in WASM, without requiring access to a real user's database. They exercise unauthenticated access, cross-origin writes, invite-only sign-up, pending requests, recipient-only approval, author-controlled audiences, authenticated replies, private bookmarks, photo authorization, transaction rollback, removal, single-use recovery, session revocation, logout, and rate limits. They do not replace verification against the deployed Railway database.

The browser checks in `qa/browser.mjs` use a temporary database and Chrome profile. They were run on Windows for registration, recovery-code acknowledgement, character editing, posting, second-account approval, OOC replies, bookmarks, sign-out/sign-in persistence, private avatar/photo uploads, and desktop/mobile layouts. The Chrome path in that optional helper is Windows-specific.

GitHub Actions runs the API suite on Node 24 for pushes and pull requests. Production Docker installs omit development dependencies and the test database.

## Beta scope

This version supports one character per account and the latest 200 visible posts. The export includes that visible state, not an unlimited account archive. Feed updates are checked every 30 seconds while the page is visible, or manually through **Settings & trust → Refresh feed**.

Multiple characters per account, direct messages, email verification/recovery, account deletion controls, media garbage collection, and a staffed moderation/appeals process are not implemented. Roleplay labels and writer boundaries are supported; these do not promise that accounts can never be restricted. Keep your recovery code: there is no email fallback yet.

## Files

- `server.mjs`: HTTP server, authentication, authorization, and Postgres operations.
- `schema.sql`: initial dedicated database schema.
- `dist/`: responsive frontend and account adapter.
- `test/`: database-backed API and privacy tests.
- `Dockerfile`, `railway.json`: Railway deployment configuration.
- `.github/workflows/test.yml`: automated API tests.
