# Kin

A private photo-sharing and roleplay app. One login gives you a personal profile for real-life photos and updates, plus a roleplay profile for WWE, The Vampire Diaries, Supernatural, Twilight, and original characters.

Live app: [Open Kin](https://kin-production-155f.up.railway.app).

The sign-in page uses a responsive split layout with a self-hosted photo collage, Kin branding, rounded fields, a password-visibility control, and working login, invite registration, and recovery flows. To see it while already signed in, sign out or use a private browser window.

The decorative collage uses photos from Unsplash: [friends](https://images.unsplash.com/photo-1529156069898-49953e39b3ac), [portrait](https://images.unsplash.com/photo-1500648767791-00dcc994a43e), and [story portrait](https://images.unsplash.com/photo-1534528741775-53994a69daeb), distributed under the [Unsplash License](https://unsplash.com/license). The images are served locally; the sign-in page does not load them from an external photo service.

Use the profile selector at the top of the app to switch between **Personal** and **Roleplay**. Each profile has its own name, avatar, bio, posts, saved posts, and approved connections. Profiles include an Instagram-style photo grid, a feed layout, and links from grid tiles to individual posts. The upgrade preserves existing characters, roleplay posts, connections, photos, and sign-ins.

Personal and roleplay connections are approved separately. Roleplay access does not grant access to personal posts or avatars. The account handle is shared between both profiles, so these are separate sharing spaces rather than unlinkable identities. Active profile choice is stored per browser tab.

## What works

- Invite-only writer accounts with password sign-in and HttpOnly session cookies.
- Single-use recovery codes for forgotten passwords. Recovery revokes previous sessions and issues a replacement code.
- A personal profile with a name, bio, photo, pronouns, and optional location, plus a roleplay profile with a character name, fandom, role, backstory, and writer boundaries.
- Connection requests by exact writer handle. Recipients approve requests before either side can read posts.
- Author-controlled audiences: Close friends and Family for personal posts, Story cast and Writing partners for roleplay posts.
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
| `APP_ORIGIN` | `http://localhost:3000` | Public app origin; whitespace and trailing slashes are normalized. Optional on Railway when `RAILWAY_PUBLIC_DOMAIN` is available |
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
4. Generate a public HTTPS domain for the app. Kin uses `RAILWAY_PUBLIC_DOMAIN` automatically when `APP_ORIGIN` is unset. For a custom domain, set `APP_ORIGIN` to the public app address, for example `https://kin.example.com`. Trailing slashes and surrounding whitespace are accepted. Do not use the Railway dashboard project URL, the database URL, or a URL with a path, query, or fragment.
5. Set a private `REGISTRATION_CODE` with at least 24 random characters. `NODE_ENV=production` is already set by the Dockerfile.
6. Deploy. Schema creation runs in a transaction at startup and uses `CREATE TABLE IF NOT EXISTS`. No seed characters, posts, or accounts are created in production.
7. Verify `/api/health`, register your own account, save your recovery code, and test sharing with a second invited writer.

Rotate `REGISTRATION_CODE` in Railway to stop an old signup code from being used. Existing accounts keep working. Use a dedicated Kin database and start with one app replica. The initial schema setup is additive; future schema changes should be introduced as explicit migrations. Configure backups for the Postgres service before relying on the app for writing you want to keep.

## Privacy and storage

Writer passwords are salted and hashed with Node's scrypt. Session tokens and recovery codes are stored only as hashes. Password hashing has a concurrency cap, and authentication and write attempts have database-backed limits. Write requests require the configured Origin. The frontend never receives database credentials or session tokens, and live account data is not saved to demo localStorage.

The server uses parameterized queries and chooses account identity from the authenticated session. It checks approved relationships, profile context, and author-defined audience membership when reading posts, replying, liking, bookmarking, or fetching photos. Removing a connection revokes future access. Copies someone already downloaded cannot be withdrawn.

The `X-Kin-Profile` header selects `personal` or `roleplay` for state and action requests. Omitting it preserves roleplay behavior. Media permissions use each stored photo's profile context. Existing records migrate to `roleplay`, and the personal profile starts empty. The migration is rerunnable after the same two accounts connect in both profiles. Do not downgrade to a server version predating profile isolation after personal records have been created; old servers do not understand the new privacy boundary.

For this small private beta, resized JPEGs are stored as Postgres `bytea` records, limited to 2 MB each. Files are served only from authenticated API endpoints with `Cache-Control: no-store`. Photos are not put in the public frontend directory. Deleted or replaced image records may remain unreferenced in the database; object storage and media garbage collection are future work.

## Tests

```sh
npm test
```

The API tests use PGlite, which runs actual PostgreSQL in WASM, without requiring access to a real user's database. They exercise unauthenticated access, cross-origin writes, invite-only sign-up, pending requests, recipient-only approval, author-controlled audiences, authenticated replies, private bookmarks, photo authorization, transaction rollback, removal, single-use recovery, session revocation, logout, and rate limits. They do not replace verification against the deployed Railway database.

The browser checks in `qa/browser.mjs` use a temporary database and Chrome profile. They were run on Windows for registration, recovery-code acknowledgement, character editing, posting, second-account approval, OOC replies, bookmarks, sign-out/sign-in persistence, private avatar/photo uploads, and desktop/mobile layouts. The Chrome path in that optional helper is Windows-specific.

GitHub Actions runs the API suite on Node 24 for pushes and pull requests. Production Docker installs omit development dependencies and the test database.

## Beta scope

Profiles use a dark, mobile-first layout with an avatar, bio, private-connection status, and a three-column post grid. The owner's stats count their currently loaded posts, approved connections, and photo posts; peer profiles show connected status without exposing their connection lists. Circular collections filter actual posts (All posts, Photos, and roleplay-only In character / Writer notes). These are automatic filters, not saved story highlights. Grid tiles open their author's visible feed; the alternative feed tab displays full posts. Approved peers have a Message button. There are no public follower counts.

This version supports one personal profile, one roleplay character, and the latest 200 visible posts per profile. The export includes the active profile's visible state, not an unlimited account archive. Feed updates are checked every 30 seconds while the page is visible, or manually through **Settings & trust → Refresh feed**.

Private text messages support direct conversations and named groups of up to 10 members. All pairs of members must be approved connections in the selected profile, including when reading or sending later. Removing a connection hides affected chats and prevents further reads and sends; reconnecting restores access to existing history. Personal and roleplay inboxes, participant names, and messages remain separate. Direct chats are reused, message retries use idempotent IDs, and the server validates membership and profile context for every request. New messages poll every three seconds while the messages screen is visible. History loads 100 messages at a time, with an earlier-messages button, and the inbox lists the 100 most recently active conversations. Chat drafts are kept only in the current view and cleared when leaving it. The writing export does not include chats. Messages are stored on the server; this is not end-to-end encryption.

Chat photos and voice notes use private attachment URLs with membership checked on every read, including range requests used for audio playback. Photos are resized in the browser to JPEG, at most 1400 pixels on the longest edge. Choose JPEG, PNG, or WebP files up to 10 MB; the resulting uploaded file must be at most 3 MB. Voice notes require microphone permission, stop automatically at 60 seconds, and support browser-recorded WebM, Ogg, or MP4 audio. You can preview or remove an attachment before sending. Recordings and selected files stay only in the current view until sent, and microphone tracks stop when recording finishes, is cancelled, or the view closes. Uploaded photos and voice notes are stored in Postgres and are not included in the writing export.

Use **Reply** beneath a chat message to select it, type or attach a response, and send a reply with a quoted preview. Photos and voice notes can be quoted too. Cancel removes the reply target while retaining the text draft. Tapping a quote highlights its original; originals outside the loaded page open an earlier history view with **Return to latest messages**. While reading that earlier view, new messages appear after returning to latest. Sending from earlier history returns to the newest reply. Quotes are derived from server records, not client-supplied text, and must refer to the same conversation. Reply IDs participate in retry deduplication.

Posts support top-level replies and a **Reply** control on each comment. Replies to comments show the original author's name and an excerpt; tapping that quote highlights the original comment. Post reply drafts and selected targets survive feed refreshes, remain local to the active profile, and clear on sign-out or profile switching. Parents must belong to the same visible post and profile. Existing posts, comments, and chat messages retain their content when this additive migration runs.

Voice and video calls use WebRTC with authenticated, profile-scoped signaling. Direct and group members explicitly answer before their microphone/camera starts. Calls support mute, camera toggle, and leaving; group calls continue for remaining participants. Media streams go between browsers (or through a configured relay) and are not recorded by Kin. Group calls use a mesh of peer connections, so larger groups need more bandwidth and device capacity. Incoming calls appear while the app is open; there are no push notifications for a closed app. Browser media permissions and HTTPS are required, except localhost development. Calls expire after two hours, stale participants disappear after 45 seconds, and rooms without a heartbeat expire after 60 seconds. Hanging up, signing out, changing profile, or leaving the page stops local tracks and peer connections. Authorization loss stops the local call on the next signaling check, normally within 1.5 seconds while the tab is active.

The default calling configuration uses STUN and supports direct connections. Reliable calling across restrictive Wi-Fi/mobile networks also needs a TURN relay, hosted separately from this HTTP app. Set `TURN_URLS` to a comma-separated list of `turn:` / `turns:` endpoints in Railway. Set either `TURN_SHARED_SECRET` for one-hour HMAC credentials compatible with coturn's REST credential mechanism, or the provider's `TURN_USERNAME` and `TURN_PASSWORD`. Keep these values in Railway variables, never source control. `/api/call-config` is authenticated and provides browser connection settings; relay credentials are necessarily provided to signed-in clients. Prefer the short-lived shared-secret option when the provider supports it. Railway has no relay configured by default. Browser tests use isolated accounts and local peer connections; they do not certify cross-network relay operation. WebRTC's [TURN documentation](https://webrtc.org/getting-started/turn-server) describes why a relay is needed.

Read receipts, presence, push notifications, adding/removing members after group creation, and chat deletion are not implemented. Additional roleplay characters per account, email verification/recovery, account deletion controls, media garbage collection, and a staffed moderation/appeals process are also not implemented. Roleplay labels and writer boundaries are supported; these do not promise that accounts can never be restricted. Keep your recovery code: there is no email fallback yet.

## Files

- `server.mjs`: HTTP server, authentication, authorization, and Postgres operations.
- `messages.mjs`: profile-scoped conversation membership, text messaging, and history.
- `chat-attachments.mjs`, `calls.mjs`: attachment validation, private media, and call signaling/configuration.
- `schema.sql`: initial dedicated database schema.
- `dist/`: responsive frontend and account adapter.
- `test/`: database-backed API and privacy tests.
- `Dockerfile`, `railway.json`: Railway deployment configuration.
- `.github/workflows/test.yml`: automated API tests.
