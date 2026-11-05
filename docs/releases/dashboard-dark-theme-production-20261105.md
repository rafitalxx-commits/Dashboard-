# Dashboard dark theme — production release

Date: 2026-11-05
Status: deployed; public bundle and API health verified.

## Scope
- Per-admin theme preference (`light`/`dark`) in Settings → Appearance, persisted in the existing Dashboard user store.
- Dark styling for the reviewed Dashboard modules and surfaces, including sales-order details; light remains the default until an admin selects dark.
- Production source baseline: `888c50c7d84cfff49be361e4f6e393925bb52d4f` (the baseline build reproduced the active public HTML, JS and CSS byte-for-byte).
- Approved code commit: `2841d2d892539547087ae3877206c205bdf97ef8`. Middleware, routes and credentials specific to theme LAB were excluded.

## Verification
- `npm run build`: exit 0 (Vite 6.4.3; existing >500 kB main-chunk warning).
- `git diff --check`: exit 0.
- Public browser loaded `/` and received the new JS and CSS assets with HTTP 200; no browser page errors.
- Production `/api/auth/me`: HTTP 200, `authenticated:false` in the available unauthenticated browser session. The production preference was not changed during deployment; Rafa can select “Oscuro” after login.
- Service `odoo-v18-dashboard.service`: active after Vite config reload; runtime Vite config SHA-256 `914675a62a086490e8d35933cd3a333c0bdcc45e4f30c855cd60280af7e198fc`.
- No Odoo API mutation was performed. The service’s pre-existing `DASHBOARD_AUTO_LOCATION_MOVEMENTS=true` timer ran after restart and updated only the Dashboard-local locations store: hash `39af5277a752f0d04a7466fe2d479daa5c7fcaf6b02fe3b98014e9a3ec14cdb9` before to `c552ffd889b26f1a341f75fca563a87032f71920795a1ec200445ceb9e557049` after. Its cursor advanced at `2026-11-05T09:54:05Z` (customer returns) and `09:54:07Z` (automatic movements). This existing code uses Odoo `search_read`; it does not issue Odoo writes. Auth-store hash stayed `2313cb078ec5dfee4e28d277ab8a3aabc88cee26ad7d9add5e75562df192462f`.

## Public identity
- Entry HTML: SHA-256 `22d174f35cab2e6eee2a0985b9c3bd6f649afacb741940fa12e28d022f22b9e8`.
- Theme JS `/assets/index-pVjJhRDc.js`: SHA-256 `965e3713a0fa9c6d271efe20264e8235c71a1611b5954428ce242127943960b5`.
- Theme CSS `/assets/index-By-Bw3GN.css`: SHA-256 `6cce27cd4879da37fa7732152b3a5975a969c35e68d651a3e16caef7883916c4`.
- Support chunks: `index.es-Cxnzcecj.js`, `jspdf.es.min-DFxYfhiT.js`; unchanged `html2canvas.esm-QH1iLAAe.js` and `purify.es-CAi2OJFm.js` compared byte-identical.
- Old hashed JS/CSS remain in place; Caddy config and production Git HEAD were not changed.

## Rollback
- Backup directory: `/var/backups/dashboard-theme-2026-11-05-01` (includes prior public entry, active JS/CSS and `vite.config.ts`).
- Restore `vite.config.ts.before` to `/home/admin/.openclaw/workspaces/lovable/odoo-v18-dashboard/vite.config.ts`, then restart `odoo-v18-dashboard.service`.
- Atomically restore `public-index.html` to `/var/www/odoo-v18-dashboard/index.html`. No old assets were removed.

No remote Git push was performed. Production browser authentication was not available for a post-release logged-in preference-persistence check; LAB had already exercised dark selection and persistence. Do not equate unauthenticated asset delivery with that final per-account check.
