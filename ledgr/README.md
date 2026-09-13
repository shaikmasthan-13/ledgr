# Ledgr Server

This is the real, database-backed version of Ledgr. Unlike the earlier prototype
(which stored data only on the one device that had it open), this version has
an actual database file on a server — so the host and every client, on their
own separate phones, all see the same data because they're all talking to the
same server.

## What's inside

- `server.js` — the backend: a REST API + a real SQLite database (`ledgr.db`,
  created automatically the first time you run it)
- `public/` — the app itself (what phones actually open)
- `package.json` — the two libraries it needs (Express, and the SQLite driver)

## Run it on your own computer (to test)

You need [Node.js](https://nodejs.org) installed once (any version 18 or newer).

**Easiest way:** double-click the starter file for your system —
`Start-Ledgr-Windows.bat` (Windows) or `Start-Ledgr-Mac.command` (Mac). It
installs what it needs the first time, starts the server, and opens the app
in your browser automatically. After that first run, just double-click it
again any time you want to use the app — no typing required.

**Or manually**, if you prefer the terminal:

```bash
cd ledgr-server
npm install
npm start
```

Then open **http://localhost:3000** in your browser. That's the whole app.

## Put it on the internet (so every phone can reach it)

Right now it only works on the one computer it's running on. To make it
reachable from the host's phone and every client's phone, it needs to run on
a server that's always on. The easiest free ways to do that:

**Render.com** (recommended — free tier, simplest for this):
1. Put this folder in a GitHub repository
2. On Render: New → Web Service → connect that repo
3. Build command: `npm install`  ·  Start command: `npm start`
4. Deploy — Render gives you a URL like `https://your-ledgr.onrender.com`

**Railway.app** works the same way, also with a free tier.

⚠️ One thing to know about free tiers: the free plan's disk isn't always
permanent across redeploys. For real, permanent data you're trusting with
real money, either upgrade to a plan with a **persistent disk/volume** (a few
dollars a month on Render/Railway), or run it on a computer or Raspberry Pi
you control that's always on. Ask me if you'd like help picking one — I can
walk through the trade-offs once you tell me what you have available.

## How everyone uses it

Once it's hosted at a URL:
- **Host** opens that URL, sets up the account once, and uses it from there
- **Every client** opens the *same* URL on their own phone
- Everyone taps **"Add to Home Screen"** (Android: menu → Install app / iOS:
  Share → Add to Home Screen) so it sits on their phone like a normal app,
  full-screen, with its own icon — no browser bar

Because everyone is pointed at the same server, a deposit the host records
shows up instantly in that client's passbook, from their own phone.

## What's still simulated

- **OTP is not sent by real SMS yet.** The code is returned directly in the
  app's response (clearly marked "demo" in the UI) instead of being texted.
  Wiring up a real SMS provider (Twilio, MSG91, etc.) is a fairly small
  change to `server.js` — happy to add it once you've picked a provider and
  have an API key.
- **Login security is basic** (password checked server-side, no session
  tokens/expiry yet) — fine for a small trusted deployment, but worth
  hardening before this holds a lot of real money for a lot of people.

## Backing up your data

Your data lives in one file: `ledgr.db`, next to `server.js`. Back it up the
same way you'd back up any important file — copy it somewhere safe on a
regular schedule (weekly is reasonable for this scale).
