# Dashboard production baseline — 2026-11-13

This branch consolidates source needed to reproduce the deployed Dashboard frontend and the application backend as inspected on 2026-11-13. It is a development baseline, not a production deployment.

- `src/` contains the React frontend. `backend/` and `vite.config.ts` contain the operational API implementation.
- The production frontend was built against a different revision of incident shared modules than the live backend. `frontend-shared/incidents/` preserves the frontend's exact build-time version; do not blindly replace it with the live backend version. A future reconciliation needs tests for both sides.
- `npm run build` also runs `scripts/restore-production-styles.mjs` to reproduce the ordered extra production stylesheets in `dist/index.html`.
- With the pinned dependencies available at reconciliation time, the main JS and CSS plus the six supplemental stylesheets matched production SHA-256 and order. Recheck this after any change.
- Runtime stores, credentials, environment files, external services and configuration are not included. A fresh checkout needs its own provisioned environment and service configuration; do not copy production data into Git.
- The existing production backend must not be replaced or restarted as a consequence of working on this branch. Follow the repository's lab, review and explicit production approval process.
