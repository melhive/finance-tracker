# Vault — Finance Tracker

A private, offline-first PWA for tracking income and expenses — installable
through Chrome, works with no internet connection, and updates itself with
a tap. Built for both personal use and running a business, with fully
separate profiles for each.

## Deploying to GitHub Pages

1. Push everything in this folder to the root of a GitHub repo (or to a
   `/docs` folder — either works with Pages).
2. In the repo's **Settings → Pages**, set the source to that branch/folder.
3. Wait a minute for the first build, then open the published URL.
4. In Chrome, you should see an **Install** icon in the address bar
   (desktop) or an "Add to Home screen" prompt (Android). That confirms
   `manifest.json` is being read correctly.

No build step, no `npm install` — every file here is served as-is.

## Shipping an update later

1. Bump `CACHE_VERSION` at the top of `service-worker.js` (e.g. `v1.7.0` →
   `v1.7.1`).
2. Add a new entry to the **top** of `changelog.json` describing what
   changed — this is what powers the "What's New" sheet.
3. Push to GitHub Pages.

Anyone with the app already installed will see a small "A new version is
ready" toast next time they open it, with a **Refresh** button. Tapping it
activates the update immediately — no reinstall, no app store.

## Full test checklist

Since this was built in stages, here's everything worth checking in one
pass before you call it done:

**Install & offline**
- [ ] Install prompt appears in Chrome; installed icon looks correct
- [ ] Turn off Wi-Fi, reopen the app — it still loads
- [ ] Bump the cache version, reload — the "new version ready" toast
      appears and Refresh works

**Profiles**
- [ ] Create a Personal and a Business profile — each gets different
      default categories
- [ ] Add transactions to each — confirm they never mix
- [ ] Switch between profiles from Settings

**Dashboard**
- [ ] Add both an income and an expense — balance, totals, and the
      recent list all update, and the balance number animates
- [ ] Yesterday card reflects only yesterday's activity; tapping it opens
      the full list
- [ ] Business profile's add-transaction sheet shows the tax-deductible
      checkbox; Personal profile's doesn't

**Security**
- [ ] Set a password on a profile → recovery words are shown once, and
      Continue is disabled until the checkbox is ticked
- [ ] Close and reopen that profile → lockscreen appears
- [ ] Enter the wrong password → shake + red glow, no access
- [ ] Enter the correct password → brief loading transition, then dashboard
- [ ] Use "Forgot password?" with the recovery words → able to set a new
      password and get in
- [ ] Change password (with correct current password) still unlocks
      existing data afterward
- [ ] Remove password → profile opens directly next time, no lockscreen

**Statistics**
- [ ] Category chart and trend chart populate after adding a few
      transactions across different days/categories
- [ ] Week / Month / Year switch changes both charts
- [ ] Top 3 categories list matches what's actually the biggest spending

**Reports**
- [ ] Weekly and Monthly cards show correct totals for their date ranges
- [ ] Both PDFs download and open correctly, with summary, category
      breakdown, and transaction list
- [ ] Business profile's PDF includes the tax-deductible total

**Polish**
- [ ] Loading screen appears briefly on first open and again right after
      unlocking a password-protected profile
- [ ] Dark/light toggle updates the whole app immediately, including chart
      text color
- [ ] "What's New" appears automatically on first open of a new version,
      and can be reopened anytime from the profile screen

## Project structure

```
finance-tracker/
├── index.html              # App shell — all screens live here, swapped via JS
├── manifest.json           # Installability + icons
├── service-worker.js       # Offline caching + update mechanism
├── changelog.json          # Powers "What's New"
├── css/styles.css          # Full design token system (dark + light theme)
├── js/
│   ├── app.js               # Boot loader, theme init, SW registration, What's New
│   ├── crypto.js             # Web Crypto: key derivation, DEK wrap/unwrap, mnemonic
│   ├── db.js                  # Dexie schema — shell DB (profiles) + per-profile DBs
│   ├── profiles.js            # Profile switcher UI
│   ├── dashboard.js            # Dashboard, add-transaction, yesterday view, tabs
│   ├── security.js              # Lockscreen, set/change/remove password, recovery
│   ├── stats.js                  # Category + trend charts (Chart.js)
│   └── reports.js                 # Weekly/monthly PDF generation (jsPDF)
└── icons/
    ├── icon.svg, icon-192.png, icon-512.png, icon-maskable-512.png
    ├── apple-touch-icon.png
    └── logo-wordmark.svg
```

## How your data is protected

Each profile's transactions live in their own IndexedDB database — nothing
is shared between profiles. If you set a password, a random encryption key
is generated for that profile and used to encrypt every transaction
(AES-GCM via the browser's Web Crypto API); that key is then wrapped under
your password and, separately, under your 12-word recovery phrase.

Because this app has no server, "forgot password" only works through the
recovery phrase — there's no email reset or account recovery possible.
Losing both the password and the recovery words means that profile's data
cannot be recovered. That's the honest tradeoff of a fully offline vault.