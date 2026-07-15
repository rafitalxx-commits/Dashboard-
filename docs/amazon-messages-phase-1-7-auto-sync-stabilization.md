# Amazon Messages FASE 1.7 - Estabilizacion auto-sync

Fecha: 2026-06-22

## Objetivo

Validar que la sincronizacion automatica Gmail readonly de FASE 1.6 sigue funcionando sola en produccion, dejar un checkpoint recuperable con bundle Git independiente y mantener el modo seguro:

- Sin enviar correos.
- Sin responder compradores.
- Sin SP-API.
- Sin Odoo.
- Sin Sendcloud.
- Sin Roger ni cambios de modelo.
- `externalSend=false`.

## Produccion revisada

- Servicio: `odoo-v18-dashboard`.
- Estado systemd: activo desde `2026-06-21 18:57:57 CEST`.
- Store: `.dashboard-data/amazon-messages-store.json`.
- Cuenta Gmail: `juanitoopenclaw@gmail.com`.
- Etiqueta Gmail: `AmazonSeller`.
- Job: habilitado.
- Intervalo: 30 minutos.
- Estado actual del sync: `OK`.

## Auto-sync observado

Estado del store en la revision inicial:

- Conversaciones: 18.
- Mensajes: 24.
- Auditoria: 112 eventos.
- Historial Gmail sync: 20 runs.
- Runs automaticos: 20.
- Ultimos 5 runs: `auto`, `OK`, `externalSend=false`.
- Ultimo run observado inicialmente: `2026-06-22T12:05:14.052Z`.
- Siguiente vencimiento observado inicialmente: `2026-06-22T12:35:14.632Z`.

El historial confirma que el job automatico ya corrio de forma natural durante la manana del 2026-06-22 sin errores nuevos ni envio externo.

Confirmacion posterior al siguiente vencimiento:

- Run automatico confirmado: `gmail-sync-1782131774092-21`.
- Inicio: `2026-06-22T12:36:14.092Z`.
- Fin: `2026-06-22T12:36:14.669Z`.
- Estado: `OK`.
- Escaneados: 0.
- Importados: 0.
- Actualizados: 0.
- Duplicados: 0.
- Errores: 0.
- `externalSend=false`.
- Siguiente sync: `2026-06-22T13:06:14.669Z`.
- Auditoria posterior: 114 eventos.

## Backups creados

Backup completo workspace:

- `/backup/lovable-workspace/2026-06-22_1427/lovable-workspace.tgz`
- SHA256: `c32eafe613ae8f58bc732b86c6b1eac7396c9a7ba03a99518fb41c0b2706b51e`

Backup store Amazon Messages:

- `/backup/dashboard-amazon-messages-store/2026-06-22_1427/amazon-messages-store.json`
- SHA256: `d311acc6502b4cb2500a9806ef53a9540be54ee154ea98a74c4814869f3c18d4`

Bundle Git independiente:

- `/backup/lovable-git-bundle/2026-06-22_1427/odoo-v18-dashboard.bundle`
- SHA256: `2683a41506a00bd8030f1c4e6f8fb08403af9811ef9d49e4532db69d84f66e46`
- `git bundle verify`: OK.
- Refs incluidas: `master` y `HEAD`.
- Commit incluido: `72a5d6784cf458c69a0e6606761ebb8ea988b6b3`.

Nota: el backup completo incluye `.env.local` y `.dashboard-data`; es privado y no debe compartirse. El bundle Git contiene solo historial Git, no los ficheros ignorados como `.env.local`, `.dashboard-data`, `node_modules` o `dist`.

## Verificaciones

Comandos ejecutados:

```bash
sha256sum -c /backup/lovable-workspace/2026-06-22_1427/lovable-workspace.tgz.sha256
sha256sum -c /backup/dashboard-amazon-messages-store/2026-06-22_1427/amazon-messages-store.json.sha256
git bundle verify /backup/lovable-git-bundle/2026-06-22_1427/odoo-v18-dashboard.bundle
```

Resultados:

- SHA256 backup workspace: OK.
- SHA256 backup store: OK.
- Bundle Git: OK, historial completo.
- El backup `.tgz` abre correctamente y contiene archivos clave de Amazon Messages, backend, frontend y store.

## Pruebas

```bash
npm run test:amazon-backend
npm run build
```

Resultados:

- `npm run test:amazon-backend`: OK.
- `npm run build`: OK.

Build generado:

- `dist/index.html`
- `dist/assets/index-I3nP4U5T.js`
- `dist/assets/index-CeIvH6NN.css`

## Pendiente

- No queda accion tecnica pendiente dentro de FASE 1.7.
- Vigilar proximos runs si Gmail/API cambia, especialmente OAuth o permisos de la etiqueta `AmazonSeller`.
