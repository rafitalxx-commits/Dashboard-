# Release: current-theme icons

Date: 2026-11-05

## Change

On the per-user theme selector, show a moon while the active theme is light
and a sun while it is dark. The icon carries an accessible hidden label and
the selector retains its own accessible name. On narrow screens, hide the
redundant visible word “Tema” so the selector and icon remain in bounds.

## Validation

- `npm run build`: exit 0 (existing Vite large-main-chunk advisory).
- `git diff --check`: exit 0.
- LAB browser in dark mode showed the sun; 390 px selector remained in bounds.
- Authenticated production browser showed the moon for the existing light
  preference; the session selector remained within the 390 px viewport.
- New public JS and CSS returned HTTP 200. Browser page errors: none.
- No account preference was changed; backend/API/configuration were not changed
  or restarted.

## Production identity and rollback

- Source commit: `6f2d8f5`, based on per-user selector release `cb4a3da`.
- Public index SHA-256:
  `0e826c2e1a774a15d606c810410f0d8b58e86370b14707d69b1d6a321b0638fa`.
- Public JS SHA-256:
  `3e3fd73bb3ecc3b5cd2d260aa379d15c5109f9edc540cb6fd518012b8d52e15c`.
- Public CSS SHA-256:
  `677c578c0f87877e0defbe4e346cf208b3fd38949e90179231589c3966bb6223`.
- Reversible pre-release copies:
  `/var/backups/dashboard-theme-icons-2026-11-05-03`.
- Previous hashed assets remain in place. No remote Git push.
