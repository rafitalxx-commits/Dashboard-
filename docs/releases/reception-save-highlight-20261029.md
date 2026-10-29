# Recepciones: cerrar reparto guardado y resaltar Bajo pedido

## Estado

Implementación y validación local terminadas. **No publicado en producción.**
Pendiente: aceptación de Rafa y aprobación explícita de promoción. No hay servidores
ni agentes de continuación activos para esta tarea; los LAB gestionados permanecen apagados.

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

## Próximo paso tras aprobación

Releer estado público y fuentes; abortar/rebasar si difieren del manifiesto.
Crear backup reversible de fuentes y estáticos. Publicar selectivamente los tres
archivos autorizados y assets, con HTML atómico, sin reiniciar backend. Repetir
fixture sobre assets públicos y lectura autenticada únicamente; no iniciar ni
validar sesiones reales para QA. Comparar stores/config antes/después. Actualizar
este documento con hashes, rollback y resultado observado; no restaurar datos de negocio.
