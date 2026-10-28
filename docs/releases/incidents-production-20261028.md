# Incidencias: promoción operativa 2026-10-28

## Autorización y alcance

Rafa, Telegram 9914, 2026-10-27: publicar todo Incidencias LAB en producción y actualizar el código actual del Dashboard en GitHub. Continuación Telegram 9928. Incluye preservar la versión actual de Recepciones, Expediciones, Amazon, Inicio y facturas. No incluye migrar casos TEST, realizar movimientos/etiquetas/envíos de prueba reales ni alterar las capacidades genéricas existentes.

## Fuente y candidato

- Snapshot de código productivo: `4ffd9c6`, construido sobre `9a343d2`.
- Worktree aislado: `odoo-v18-dashboard-release-incidents-20261027`, rama `release/dashboard-current-incidents-20261027`.
- Integra Incidencias del LAB y controles backend contra etiquetas REX prematuras; conserva interfaz pública previa de Recepciones y Reglas.
- Servicio backend productivo: `odoo-v18-dashboard.service`, puerto 5173.
- Web pública estática: `/var/www/odoo-v18-dashboard`, Caddy mantiene `/api/*` hacia 5173.
- Odoo operativo: `https://todoelectrico.odoo.rgbconsulting.com/erp2`; LAB permanece exclusivamente DEMO.
- Datos Incidencias operativas y secuencias separados en `.dashboard-data/incidents-production`; libro y carpeta Google nuevos, sin registros LAB.
- Credenciales Google existentes en ruta protegida `/etc/odoo-v18-dashboard/secrets/`; no se incluyen en Git.
- Secuencia inicial se eleva al máximo observado de identidades reales (29), evitando reutilizar el REX real histórico sin importar su estado.

## Verificación anterior a promoción

Evidencia privada local: `/root/.openclaw/workspace/releases/incidents-production-20261027/`.

- `npm run test:incidents`: 36/36 suites pasan con `fetch` externo denegado, incluida composición real de rutas/cola/ejecutor con conexión operativa simulada.
- Pipeline integrado: 32 escenarios, reinicios, resultados inciertos, DEV/recepción/REX y duplicados; no es una transacción real de producción.
- `npm run test:receptions`: exit 0.
- `npm run build`: exit 0.
- `git diff --check`: exit 0.
- UI completa candidato: reglas, recepciones y expediciones, 3 suites exit 0; todas las APIs de escritura interceptadas.
- Preflight actualizado 2026-10-28: autenticación real sin bypass, catálogo, pedido/líneas, tipos de operación y permisos Odoo correctos; 0 escrituras. Google: 10 pestañas, 0 incidencias, lectura correcta.
- Sin drift en los 127 archivos del delta respecto al snapshot productivo, ni en hashes de assets públicos anteriores.
- Exploración de secretos literales: sin candidatos en fuentes versionables; `.env`, stores, tokens, backups y `dist` excluidos de Git.
- El proyecto arrastra errores de typecheck general ajenos al build; no se presenta `tsc` como verde.

## Configuración y límites

La promoción habilita el flujo operativo propio de Incidencias, Sheets y Drive para acciones futuras de operarios autorizados. Las puertas genéricas Odoo/transportistas existentes se conservan sin cambios. No se ejecutarán operaciones reales para validar el despliegue; las pruebas de escritura siguen siendo simuladas/TEST. SMTP y transportistas no se modifican.

## Publicación

Estado: candidato validado, pendiente de respaldo, despliegue, verificación pública y actualización GitHub. No confundir este documento preparatorio con una publicación completada. El resultado y hashes se añadirán tras la verificación.

## Resultado de publicación (2026-10-28)

- Backend desplegado desde `6fd9198` mediante delta de 127 archivos; `HEAD` del directorio productivo sigue siendo `9a343d2` y conserva sus cambios heredados. La identidad real se registra por SHA256 de los archivos, no por ese HEAD.
- Servicio reiniciado y activo. Dependencias instaladas con scripts npm deshabilitados. Se añadió únicamente el override `90-incidents-production.conf`; no se sustituyeron los overrides anteriores ni se tocó Caddy.
- API pública autenticada sin bypass: modo operativo, Sheets configurado y 0 incidencias, lectura real de Odoo/catálogo correcta; puertas propias Odoo/DEV/REX/Sheets/Drive habilitadas para operadores. La puerta Odoo genérica ya estaba habilitada y no se cambió.
- HTML público y assets coinciden exactamente con el candidato compilado:
  - `index-DnI1CUfi.js`: `c4a863967671f81ebfe9cee880f02404a13e0e0cc3982e13ee9147ac6d91cc1e`.
  - `index-BasP4Vx9.css`: `6d1ba89c8abe0fdbf7455a518f25f3e8cd7bef229e92addde8c25d53e98a3c1b`.
- Verificación visual autenticada: Incidencias, listado y estadísticas, escritorio/móvil; sin errores JS ni desbordamiento horizontal. Regresiones sobre assets públicos de Reglas, Expediciones y Recepciones correctas (todas sus APIs interceptadas).
- Seis stores de etiquetas/reglas mantienen hash exacto antes/después; cola y submissions operativas nuevas vacías; ninguna transacción Odoo, etiqueta, correo o envío real ejecutado por el despliegue.
- LAB sigue en `test` y destino DEMO, con sus datos/configuración intactos.
- Respaldo reversible: `/root/.openclaw/workspace/releases/incidents-production-20261027/rollback-20261028/`; contiene manifiesto, originales de los archivos modificados, web previa y configuración systemd previa. Los assets antiguos siguen disponibles.

### GitHub y pendiente

Todo el código está subido a `release/dashboard-current-incidents-20261027` en `rafitalxx-commits/Dashboard-`, incluyendo el snapshot productivo previo. La herramienta de creación de PR devolvió `user rejected MCP tool call`; no se intentó otra vía. `main` no se ha modificado. Pendiente: crear/revisar/integrar el PR cuando esa acción sea aceptada. No hay proceso de continuación activo ni cron reactivado.

### Rollback

Antes de revertir, comparar hashes actuales con `deployment-runtime.json` y comprobar cambios/intervenciones posteriores. Restaurar solo originales listados en el manifiesto; los archivos nuevos deben apartarse de forma recuperable, no borrarse. Restaurar `index.html` previo atómicamente conservando assets; apartar solo `90-incidents-production.conf`, recargar systemd y reiniciar el servicio. No restaurar todo el directorio de datos ni el libro Google: conservar incidencias/auditorías nuevas. Si hay transacciones posteriores, detenerse y conciliar antes de revertir. Reinstalar dependencias desde el lock previo solo si el rollback lo requiere.
