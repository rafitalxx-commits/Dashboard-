# Catálogo: espera visible y errores en la ficha del producto

## Solicitud y alcance

Rafa pidió implementar la skill Dashboard en los botones Guardar/Aceptar al modificar stock/asignar o crear ubicación y mostrar los errores específicos del producto dentro de su detalle, no encima de la lista oculta. Se realiza la corrección de interfaz solicitada, primero en una versión paralela; no añade operaciones, cambia validaciones/cálculos de stock, activa flags ni ejecuta escrituras de producción para probar.

## Aislamiento y baseline

Worktree real `odoo-v18-dashboard-catalog-feedback-lab-20261029`, rama `fix/catalog-action-feedback-20261029`. Se detectó mientras se inspeccionaba la publicación simultánea de códigos DEV/REX: la baseline inicialmente3ecbdf8 se avanzó a **bdf2670**, cuya reconstrucción HTML y cada chunk emitido coincide byte a byte con producción `index-DpwN763U.js`/CSSindex-32v5tlI0. Así se conserva la mejora de escaneo y reposición/estadísticas anteriores. No se compila el árbol productivo sucio. Los LAB gestionados apagados por la limpieza de memoria se dejan apagados; QA usa aplicación compilada y rutas interceptadas, sin servidor temporal ni configuración nueva.

Allowlist3fuentes: `ProductsCatalogView.tsx`, `ProductLocationsView.tsx` y nuevo `catalogFeedback.css`, todos en src/modules/products. Tests y este documento separados. Backend/API/gates/config intactos; ninguna dependencia/lockfile se modifica.

## Comportamiento

- Spinner real y etiquetas Guardando/Registrando/Creando/Actualizando en la acción concreta; estado con texto en la ficha, campos/cancelación/cierre y acciones conflictivas bloqueados durante la petición. Ref síncrona evita doble envío aunque los dos eventos lleguen antes del rerender. Reduced-motion conserva el texto sin animación.
- Mensaje local ligado al ID para errores/confirmaciones de stock/ubicaciones/traslados/eliminaciones/EAN/impresión/carga de detalle. Cabecera sticky mantiene el error visible al editar abajo; rolealert, foco y borrador conservado ante fallo. Avisos generales de sincronización/listado permanecen generales y no sustituyen los del producto.
- Versión de petición y reset de traspaso/error al cambiar producto evitan resultados tardíos aplicados a otra ficha. No es una modificación de datos ni de la API.
- Éxito solo después de confirmación de API. Si se guardó pero falla refrescar la lista, informa que está guardado y que falló la lectura, sin presentarlo como guardado fallido. Tras leer el catálogo se refresca el stock mostrado en la ficha con el valor autoritativo devuelto.
- Formulario de asignación/movimiento con submit/Enter y etiquetas accesibles. La opción existente «Ajustar también el total en Odoo» mantiene exactamente su valor inicial y endpoints; no se cambia su política. La impresión solo tiene feedback y bloqueo, no se prueba hardware.
- Crear/activar/desactivar ubicaciones físicas usa el mismo feedback y protección inmediata, sin cambiar validación ni endpoints. Ningún dato se guarda al abrir/cancelar el formulario.

## Pruebas observadas

Evidencia privada `/root/.openclaw/workspace/releases/catalog-feedback-20261029/`.

- `npm run build`:baseline/candidato exit0; diff-check limpio.
- Comparación TypeScript de los dos componentes y sus imports:19diagnósticos heredados en baseline y19en candidato, **0nuevos**. El check enfocado arrastra errores ya existentes de odooClient/Expeditions; no se afirma typecheck global verde. Evidencia typecheck-comparison.json, herramienta check-types.cjs en evidencia.
- `node scripts/test-catalog-feedback-ui.mjs`:exit0.10comprobaciones correctas con15mutaciones interceptadas sobre fixtures de memoria,cero API real/erroresJS/peticiones inesperadas. Respuestas retenidas prueban animación/texto/bloqueo y un solo submit; error400 conserva cantidad/origen/código/EAN y muestra error en ficha; reintento correcto confirma solo al recibir respuesta. Incluye stockOdoo/local,asignación/cancelación,traspaso/eliminación,duplicadoEAN,fallo posterior de lectura,creación/activaciónfísica,carga de detalle fallida y respuesta vieja de otro producto. Móvil390px/sticky/checkbox/reduced-motion y paneles dentro del viewport. Capturas desktop/móvil inspeccionadas. Los primeros intentos fallaron por selector no exacto y GETadicional del banner global no interceptado: ambos corregidos en harness, sin atribuirlos a la aplicación.
- `node .../verify-live.cjs`:exit0. Candidato compilado con auth/catálogo/ficha/ubicaciones reales GET, producto32137. Formularios abiertos/cancelados solamente. Cantidades/auditoría/catálogo sin cambios,desktop/móvil,cero erroresJS/lecturas fallidas/mutaciones reales. El POSTautomático de sincronización preexistente se intercepta y responde con el snapshot leído; el GETde incidencias de ubicaciones también se intercepta para evitar efectos secundarios. No es prueba de guardado real ni hardware. Un primer intento necesitó recoger la sidebar móvil antes de cancelar; se corrigió el harness usando el control real y repitió correctamente.

## Promoción y rollback

Revalidar hashes de baseline/fuentes antes de copiar, conservar web anterior completa/fuentes originales y publicar assets nuevos antes de cambiarHTMLatómico. **No reiniciar backend.** Tras publicar, repetir lectura autenticada real sin escrituras y el suite completo contra los assets públicos con todas las API interceptadas; así se prueban estados/error sin modificar productos/Odoo. Comprobar fuentes/config/stores y PID backend. Si falla, rollback solo de HTML/fuentes aprobadas, nunca de datos de negocio. No push/merge remoto ni intento de saltar el PR previamente rechazado.

## Resultado

Pendiente promoción y comprobación pública. Completar con deployment.json, production-verification.json y public-fixture-report.json; no presentar este estado preparatorio como publicado.
