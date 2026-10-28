# Expediciones — reposición de la ubicación preferente, producción

## Autorización y alcance

Rafa confirmó que el traslado funciona como Productos → Catálogo: redistribuye cantidades locales, conserva el total y no modifica stock Odoo. Después autorizó «ok..implementa». Esta aprobación cubre publicar la función descrita, tras preparar y probar la versión aislada; no ejecutar un movimiento de producción para probar.

Tarjeta rojo suave en Operativa inmediatamente después de los4botones y antes de Automático/Manual. Única preferente física <=0 y otra física >0; foto/referencia/nombre, preferente/cantidad, orígenes/saldos. Sin avisos desaparece por completo. Formulario origen/cantidad/destino preferente fijo, confirmación después del movimiento físico, revalidación del saldo y permisoexpeditions. Ubicaciones inactivas se identifican y no permiten traspaso. No se inventa preferente ausente/ambigua ni se usa Pendiente de envío como origen.

## Identidad y cambios

Worktree real aislado `odoo-v18-dashboard-replenishment-release-20261028`, rama `release/expedition-replenishment-20261028`, base4e7e1a6. Baseline frontend reconstruida byte a byte igual a producción. Backend HEAD productivo9a343d2 con muchos cambios ajenos: no compilar/reescribir ese árbol entero. Los3archivos originales afectados coinciden exactamente con gitshow4e7e1a6 antes de editar.

Allowlist8archivos de producción en `releases/expedition-replenishment-20261028/approved-files.txt`:2backend/service-routes nuevos, motor locations existente, registrovite,3frontend nuevos y montaje2líneas en ExpeditionsView. Tests/docs separados. Estadísticas semanales/mes,impresora/reglas,resto de integraciones intactos. No cambiarconfig/proxy/unidades/gates/stores ni copiar snapshots/sesionesLAB.

Motor compartido de Catálogo añade requestId opcional para compatibilidad; la nueva API lo exige. Huella ligada a producto/origen/destino/cantidad, guardada junto a saldos y auditoría. Se reforzó la persistencia en LAB: temporal exclusivo0600+fsync+rename atómico, limpieza ante error, lectura corrupta falla cerrada en vez de asumir stock vacío. Evita pérdida de datos/duplicados sin inventar migraciones ni alterar cantidades por despliegue. No añade conexión de escritura Odoo.

El registro de fotos de copiaLAB solo se activa con baseLAB y archivo de preview; producción siempre usa catálogo real. GETfotos restringido a IDs elegibles. Frontend usa BASE_URL.

## Validación previa

- Build baseline/candidato exit0; typecheck enfocado frontend+backend+locations ES2020/noEmit exit0; diff-check limpio.
- `node --experimental-strip-types scripts/test-expedition-replenishment.ts`:exit0. Elegibilidad/negativo/cero/exclusiones,inactivas,preferente/cantidad/saldo,auditoría/reintentos/reinicio,auth401/403,GETsoloexpeditions,fotos restringidas,HTTPreal en temporal.
- `node --experimental-strip-types scripts/test-expedition-replenishment-persistence.ts`:exit0. Fallo inyectado antes de rename conserva bytes originales, no deja temporales; reintento correcto tras reconstrucción, débito+crédito/token juntos,total invariable,auditoría única; JSON corrupto no se sobrescribe.
- Cinco regresiones exit0: preferred-deliveries,preferred-location-required,reception-locations,pending-location-movements,catalog-locations.
- HarnessUI con snapshots copiados a un temporal:exit0. Fotos reales,8porpágina/búsqueda,límites,cancelación,400conborrador,doble submit lento,reintento idéntico,503recuperable,vacío/últimoaviso,desktop/móvil y posición real del padre. Segunda fase real UI→Vite→ruta→motor en copia desechable:un traslado+POSTrepetido+recarga; deltaorigen−1/destino+1,totalidéntico,token/auditoría persistidos y segundoPOSTsin cambios. Solo400/503intencionados,sinerroresJS. Puerto aleatorio cerrado/finally. No consumeLABcompartido ni producción.
- Usuario de servicio admin:acceso a datos/cache y escrituraatómica/relectura sobre copia desechable probados,sin cambiarmodos/propietariosproductivos.
- Verificación del candidato compilado con snapshot22avisos (10negativos/12cero) y22fotos mediante GETauténtico del catálogo:exit0. Reconciliación independiente con store/catálogo,posición,desktop/móvil/formulario,cancelación,sinmutaciones,stats5filas e impresora conservados;capturas inspeccionadas.11casos tienen preferente/orígenes activos;se preservan las inactivas sin habilitarlas automáticamente.

## Despliegue controlado

Evidencia/rollback `/root/.openclaw/workspace/releases/expedition-replenishment-20261028/`. Copia estática completa y originales de fuentes con metadatos; Caddy solo respaldo de referencia. Revalidar HTML/assets/fuentes antes de copiar. Publicar assets nuevos primero, módulos antes del registrovite, reiniciar solo el servicio afectado y comprobarauth/API nueva por GET antes de cambiarindexatómico. Prueba pública real permite únicamenteauth/reposición/fotos/estadísticas; GETajenos interceptados, toda mutación abortada. Verificación de traslado real solo sobre temporal, no producción.

Rollback restaura entryHTML y solo los8archivos/caminos aprobados si siguen con identidad desplegada,reinicia servicio y verifica salud. No restaurar stores de negocio, aunque cambien durante la ventana; investigar diferencias en lugar de rebobinar operaciones.

## Resultado

**TERMINADO — publicado y verificado.** Fuente `97f98444f8057e6a5d185438c06d9b3c05b48008`, backend HEAD sigue9a343d2 (árbol sucio ajeno preservado). Ocho fuentes desplegadas por hash, JS `index-BeXLOI9e.js`/CSS `index-32v5tlI0.css`; manifiesto completo deployment.json. Reinicio controlado del único backend afectado; Caddy/unidades/gates sin cambios. No push/merge remoto ni reintento del PR previamente rechazado.

- Preflight real tras reinicio antes de cambiarHTML:auth/reposición/fotos GET exit0,22avisos,8fotos y correspondencia exacta independiente con ledger/catálogo.
- Frontera pública final autenticada sinbypass exit0:22avisos (10negativos/12cero),fotos reales,posición y geometría1440/390,paginación/búsqueda,formulario abierto y cancelado sin confirmar,statssemanales/impresora conservados. Cero erroresJS,mutaciones o lecturasfeaturefallidas. Capturas públicas inspeccionadas. GETajenos interceptados;no se afirma prueba de transacciones Odoo/carrier/hardware.
- **13archivos de integridad idénticos** (9stores+4configuraciones),incluidas ubicaciones/auditoría y catálogo. Ningún traslado real ejecutado;el flujo completo de traslado se validó únicamente en copia desechable.
- Ambos servicios habituales producción/LAB activos,ningún harness temporal residual. Fuente atomic/failclosed y tests actualizados también en LAB;no se copiaron saldos/fotos/auth de LAB a producción. Rollback completo de código/HTML disponible,assets anteriores conservados.
- URL https://dashboard.todoelectrico.net/#/expediciones . Ya no hay aprobación/publicación pendiente para esta tarjeta. No hay continuación automática.

