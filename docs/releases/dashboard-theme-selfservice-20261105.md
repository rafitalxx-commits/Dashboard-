# Release: personal theme selector for every Dashboard account

Date: 2026-11-05

## Scope

Builds on the production dark-theme release recorded in
`dashboard-dark-theme-production-20261105.md`. Commit `6f19efe` removes the
admin-role restriction from the user's own saved theme, adds an always-visible
`Tema` selector beside the active account in the top bar, and serves that
preference through authenticated `PATCH /api/auth/me`. An account can only
change its own `light`/`dark` value through this endpoint. User/role
administration remains restricted to the existing settings permission.

## Validation

- `npm ci --ignore-scripts --no-audit --no-fund`: exit 0.
- `npm run build`: exit 0 (existing large-main-chunk advisory only).
- `git diff --check`: exit 0.
- Disposable local API validation used a temporary auth store and data dir,
  `DASHBOARD_DEV_BYPASS_AUTH=false`, `ODOO_WRITE_ENABLED=false`, and automatic
  location movement sync disabled. A temporary viewer persisted only its own
  theme, remained a viewer, still received 403 from user administration, and
  an unauthenticated theme PATCH received 401.
- Authenticated theme LAB UI showed the selector; its theme preference
  survived reload. The test restored the isolated LAB account to its prior
  dark preference. At 390 px, the selector stayed within the viewport.
- Production browser loaded the new JS/CSS (HTTP 200), found the per-account
  selector, and loaded the authenticated account as `admin` with theme
  `light`. No production preference was changed. An invalid theme PATCH was
  rejected with HTTP 400 and role/theme were unchanged. No page errors or
  production POSTs occurred.

## Production identity and rollback

- Source commit: `6f19efe`, based on `525aa5e` (the previous dark-theme
  production release).
- Runtime `vite.config.ts` SHA-256:
  `b40d5a51275799d9bfedf0817272cf5d16490fd684677a13c402003fdc9a4eb6`.
- Public index SHA-256:
  `a2add63c4b63fc212df847672fb364fdee1ade5cd96caa84ff2adc39b9238ccd`.
- Public JS SHA-256:
  `f1b4fa0dbb1cb17e5d37a6912239f4477719420b0998e5085f852f94e9ce8a90`.
- Public CSS SHA-256:
  `0cdc2a9ec6705c41b2632553375fb02a236f12540e816bf814896947d00a58e1`.
- API service remained active; auth bypass was false.
- Reversible pre-release copies and source metadata:
  `/var/backups/dashboard-theme-selfservice-2026-11-05-02`.
- Previous hashed JS/CSS assets were preserved. No Git remote push was made.

## Side effect observed during the release window

The pre-existing `DASHBOARD_AUTO_LOCATION_MOVEMENTS=true` timer ran while the
release was being checked, advancing the Dashboard-local product-location
ledger and its sync cursors. The observed ledger hash changed
`5e24bfea…` → `a08a93fb…` → `dc5a3937…`; the account-auth store hash remained
`4af3d22d…`. The sync source uses Odoo `search_read`; no Odoo RPC writes were
performed. This release did not change the timer or its gates.
