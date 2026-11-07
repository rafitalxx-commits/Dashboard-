# Incidents mobile dark mode production release — 2026-11-07

- Scope: make mobile Incidents cards and controls follow the persisted dark theme, and add a top-bar Noche/Día control for administrators.
- Existing self-service theme persistence is reused; no backend or data changes.
- Build: `npm ci --ignore-scripts && npm run build` and `git diff --check` passed.
- Production delivery used versioned frontend assets and an atomic entry HTML switch; prior assets remain available for rollback.
- Public entry and versioned JS/CSS returned HTTP 200; browser console/page error log had zero errors on the unauthenticated login page. Authenticated operational UI was not exercised in this release verification.
- Backend service, business stores, and write gates were not modified.
