# Supplier invoice Drive destination confirmation UI — production release (2026-10-30)

## Scope

Promoted only the approved confirmation UI fix for a non-recommended Drive archive destination. The warning and explicit “Acepto, guardar PDF aquí” action remain visible when the folder browser is collapsed. If an Odoo draft already exists and the first move returns HTTP 409, accepting the destination retries only the PDF move; it does not repeat Odoo draft creation.

## Source and isolation

- Public frontend baseline: `3b54820c32ab6bc21a7e1d59a872be7e4071187e` (release branch for the previously deployed Drive destination behavior).
- Validated LAB worktree: `/home/admin/.openclaw/workspaces/lovable/odoo-v18-dashboard-invoice-drive-confirm-ui-lab-20261030`, branch `fix/invoice-drive-destination-confirm-ui-20261030`.
- Approved source allowlist: `src/modules/supplierInvoices/Phase2Views.tsx`, `src/modules/supplierInvoices/supplierInvoices.css`.
- Release built in isolated worktree `/tmp/odoo-invoice-drive-confirm-release`; no source files in the dirty production worktree were used or changed.

## Validation

- Unmodified baseline `npm run build`: PASS; generated `index.html`, JS/CSS, locale, jsPDF and html2canvas outputs matched the currently served baseline byte-for-byte.
- `node --experimental-strip-types scripts/test-supplier-invoice-archive-gate.ts`: PASS.
- `node --experimental-strip-types scripts/test-supplier-invoices-phase2.ts`: PASS; suite output reported all tests passed (five optional historical PDFs were absent and skipped).
- `npm run build` after the approved overlay: PASS; Vite emitted only its existing large-chunk (>500 kB) advisory.
- Playwright against the production URL with every API intercepted: PASS. Simulated 409 displayed consent; collapsing the folder browser left the consent visible; acceptance made exactly one move-only retry (`acceptNonRecommendedDestination: true`); zero Odoo draft-create calls and zero page errors. This verifies public frontend assets with fixture APIs, not a real Drive/Odoo transaction.

## Deployment

- Static root: `/var/www/odoo-v18-dashboard`.
- Installed versioned assets first, then atomically replaced `index.html`; old assets retained.
- Public HTTP `index.html` and all six referenced/transitively loaded assets matched the installed files byte-for-byte.
- Backend/service was unchanged: service active, PID `1196694`, active since `2026-10-30 17:03:13 CET`; production source tree HEAD observed as `9a343d2` (dirty unrelated files preserved).
- No Odoo draft, Drive move, backend write, configuration change or service restart was performed.

## Runtime hashes and rollback

- Public HTML: `211a1668ac9542858af11f3d880e1368a32b75579c2920989426864b89f20c08`
- Main JS: `da3f87c2cc1db3a1213c53b91be0e5fc40f2a0289ed8cd4eefc5cb0c34e947e2`
- CSS: `88ca0fca33599d8dfa26acc5486ed6b399bc929a7a976c027fca009003901f41`
- Rollback copy of old entry and its referenced assets: `/root/.openclaw/workspace/releases/invoice-drive-confirm-ui-20261030/rollback/`.
- Hashes and public HTTP evidence are stored beside that rollback directory.

Rollback: atomically restore the saved `index.html` and retain both old and new hashed assets; no backend rollback or restart is needed.
