# Incidents mobile dark mode production release — 2026-11-07

- Scope: make mobile Incidents cards and controls follow the persisted dark theme, and add a top-bar Noche/Día control for administrators.
- Existing self-service theme persistence is reused; no backend or data changes.
- Build: `npm ci --ignore-scripts && npm run build` and `git diff --check` passed.
- Production delivery used versioned frontend assets and an atomic entry HTML switch; prior assets remain available for rollback.
- Public entry and versioned JS/CSS returned HTTP 200; browser console/page error log had zero errors on the unauthenticated login page. Authenticated operational UI was not exercised in this release verification.
- Backend service, business stores, and write gates were not modified.

## Deployment result

- Source/code commit: `91636bc34fc7a7084a4af26cbb01100d629673281` (published on the release branch).
- Runtime JS: `index-J_jxld8F.js`, SHA-256 `059e785955afd4acbfe40794599b75bba8e0d527c691f0cdb14d1262c75f4903`.
- Runtime CSS: `incidents-dark-20261107.css`, SHA-256 `19fa6a1de76e18e8f2eab79015b3597d57b408d747db309b9622eda1c22522de`.
- Runtime HTML: SHA-256 `408ff4a1ca4a0e9c69b43f46ce11f45d075c69aaef123c7c267e66b7577aacc0`.
- Rollback backup: private deployment evidence directory, containing previous `index.html`, CSS, and Caddyfile; previous immutable assets remain on the server.
- Caddy and Dashboard service remained active; Caddy configuration was unchanged. Public browser loaded both new resources with HTTP 200 and recorded zero page/console errors before the login screen.
