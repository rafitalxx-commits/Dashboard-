# Recepciones: cerrar reparto guardado y resaltar Bajo pedido

## Estado

**Publicado en producción el 2026-10-29 tras el OK explícito de Rafa.**
Comprobación pública funcional, visual y autenticada terminada. No hay servidores,
agentes ni continuación automática pendientes. Los LAB gestionados siguen apagados.

## Alcance

- `Guardar reparto` confirma el borrador local existente (`ready: true`), cierra solo
  su editor y devuelve el foco al botón Repartir. No valida la recepción ni llama a Odoo.
- El reparto se puede reabrir sin perder cantidades/ubicaciones y mantiene la
  persistencia existente en localStorage.
- Fondo rojo suave y franja lateral para toda la fila Bajo pedido con cantidad
  pendiente según el conteo local guardado. Las sugerencias sin guardar no cuentan.
  Cero y parcial mantienen el aviso; reparto completo lo retira. Editar de nuevo
  invalida el conteo confirmado hasta guardar. Incluye líneas mixtas con unidades
  vinculadas a venta; no colorea reposición, cantidad pendiente cero ni registros
  bloqueados como validados/cancelados. El cálculo usa la cantidad pendiente total
  de la línea mixta, sin reinterpretar su reparto entre envío y almacén.
- En móvil/tablet el editor tiene el ancho del drawer y sigue accesible al desplazar
  horizontalmente las filas compactas. Los textos/clasificación/estado siguen visibles.
- No se cambia el contrato HTTP, stock, operario, validación, backorder, permisos,
  historial, backend ni gates de escritura.

## Identidad y evidencia

- Worktree: `/home/admin/.openclaw/workspaces/lovable/odoo-v18-dashboard-reception-save-lab-20261029`.
- Rama: `fix/reception-save-highlight-20261029`.
- Base: `0bad8c0188f0f98d0cb4f135a4e535f6b9bad55c`.
- Evidencia: `/root/.openclaw/workspace/releases/reception-save-highlight-20261029/`.
- `baseline.json`: HTML y todos los assets reconstruidos byte-idénticos a los
  servidos antes de modificar. Se conserva la retirada del aviso de Incidencias,
  el feedback de Catálogo, reposición y estadísticas.
- `approved-files.txt`, `source-before.json`, `source-manifest.json`: límite de
  promoción de tres fuentes frontend. Pruebas/docs no necesitan copiarse al runtime.
- Producción conserva árbol sucio/HEAD backend `9a343d2`; se comprobó que sus tres
  fuentes y su entrada pública no cambiaron durante esta tarea.

## Validación observada

- `npm run build`: exit 0 (baseline y candidato; aviso heredado de chunk grande).
- `npm run test:receptions`: exit 0; fases 2–5 y nueve aserciones nuevas del criterio
  de aviso, incluidos cero, parcial, propuesta no confirmada y mixto.
- `node scripts/test-reception-save-ui.mjs`: exit 0; cinco grupos de comprobación:
  filas incluidas/excluidas; guardado cero/parcial/cierre/foco; siguiente producto y
  completo; ubicación inválida/borrador/recarga; móvil/editor sin recorte.
- Todas las APIs de la prueba UI están interceptadas. Cero peticiones vivas,
  cero mutaciones, cero errores JavaScript; no se ha recibido/cancelado nada real.
- Capturas inspeccionadas: `pending-desktop.png`, `pending-mobile-editor.png`,
  `pending-mobile.png`.
- Comparación TypeScript focalizada `check-types.cjs`: 13 diagnósticos heredados
  en base, 12 en candidato, cero nuevos. No se afirma typecheck global verde.
- `git diff --check`: exit 0.

## Publicación y aceptación final

- Revisión fuente publicada: `e4cdc5e067c6f3f0e8f3830940682496e639e68c`; la implementación es
  `60f0292` y `e4cdc5e` añade soporte de aceptación de assets públicos a la prueba.
- Solo se copiaron los tres archivos de `approved-files.txt`; no se promovió el
  árbol sucio de producción ni se cambió backend/configuración/gates.
- HTML SHA-256: `60a8ef76061839798260b216cd0ca7bf203809a44124a23a2ac2e8448e4334a6`.
- JS público: `index-Y1_YUCRR.js`; CSS: `index-DrjHE60a.css`.
  Todos los hashes de chunks/fuentes en `deployment.json`.
- Backend HEAD `9a343d2d2263fd32e85392019355db8d9ee419bc`, PID `991369` activo e idéntico,
  sin reinicio. HEAD backend no identifica la fuente frontend publicada.
- Publicación con assets primero y HTML atómico; los assets anteriores se conservan.
- `node scripts/test-reception-save-ui.mjs --public-assets`: exit 0, cinco grupos
  de interacción correctos sobre el frontend realmente servido, APIs interceptadas,
  cero mutaciones ni errores JavaScript. Incluye cero/parcial/completo, cierre/foco,
  reapertura/recarga y botón móvil sin recorte.
- `node releases/reception-save-highlight-20261029/verify-live.cjs --public`
  (script alojado en la evidencia): exit 0. Lecturas autenticadas reales 200 para
  auth, recepciones, sesiones, ubicaciones, pendientes e historial; 23 recepciones.
  Caso observado recepción `120117`, línea `281192`: color coincide con la lectura
  autorizada. Escritorio y móvil correctos; solo abrir/cerrar, sin iniciar operario,
  contar, guardar reparto ni validar/cancelar una recepción real. GET adyacente de
  incidencias de ubicación interceptado para no ejecutar sincronización incidental.
- Assets públicos descargados y comparados exactamente con candidato.
- `integrity-before.json` / `integrity-after.json`: los 15 archivos de datos y
  configuración comparados permanecieron byte-idénticos durante la publicación final.
- Primer intento: la comprobación HTTP de assets usó por error `response.ok()` de
  Playwright sobre un `fetch` nativo. La prueba de interacción había pasado, pero
  ese fallo activó rollback íntegro de código/HTML antes de corregir el verificador
  a `response.ok` y repetir. Evidencia anterior en `attempt-1/`; no se restauraron datos.
- `whole-release-integrity.json`: desde el primer intento hasta el cierre, 14/15
  archivos byte-idénticos y únicamente avanzó `odooMovementSync.automaticLastSyncedAt`
  en ubicaciones. Se reconstruyeron ambos SHA originales cambiando solo ese campo
  en memoria (11:09:11.553Z → 11:10:11.558Z), acreditando saldos/auditoría de negocio
  idénticos. Ningún dato fue escrito o restaurado para lograr esta verificación.
- Capturas públicas inspeccionadas: `production-desktop.png`, `production-mobile.png`.

## Rollback

Copia reversible de estáticos y fuentes originales: `/root/.openclaw/workspace/releases/reception-save-highlight-20261029/rollback`.
Restaurar solo la entrada HTML anterior y las tres fuentes si aún pertenecen a esta
publicación; conservar assets antiguos. No restaurar stores de negocio ni configuración.
Sin PR remoto/push/merge ejecutado; no quedan acciones pendientes para esta solicitud.
