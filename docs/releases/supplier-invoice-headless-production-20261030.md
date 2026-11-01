# Facturas sin navegador — producción 2026-10-30

## Alcance y autorización

Rafa aprobó en Telegram 10003 el despliegue de la preparación únicamente. Publicado backend desde candidato LAB fb19816, base de módulo af421b0; HEAD de producción y cambios ajenos conservados. Frontend público sin cambios. No push remoto ni programación periódica.

Identidad técnica dedicada, hash protegido en `/etc/odoo-v18-dashboard/supplier-invoice-automation.env`, drop-in exclusivo `95-supplier-invoice-automation.conf`. Cliente y token protegidos bajo `/home/admin/.config/dashboard-invoice-automation/`; no valores secretos en Git, argumentos ni este documento. Variables de Vite insertadas selectivamente, sin reemplazar config. Puertas humanas de escritura intactas; la identidad técnica solo lista/refresca/prepara.

## Resultado real

- 17 PDF presentes en SIN REVISAR, 17 propuestas locales guardadas en producción, todas parciales y pendientes de revisión humana. 0 fallos técnicos de análisis.
- 3275 líneas y 3 copias PDF idénticas por SHA-256, sin fusionar ni mover registros.
- Correos F260917324: 732 líneas, base 4000,26 EUR; F260816214: 2438 líneas, base 12383,55 EUR. Sumas exactas, fuel explícito separado.
- La diferencia de una línea respecto al ensayo LAB corresponde al Shipping Fee de 285 USD impreso en la commercial invoice Sonoff. La discrepancia de 0,50 USD entre mercancía interpretada y subtotal se conserva pendiente, no corregida ni aprobada automáticamente.
- 0 nuevas validaciones, 0 nuevos vínculos a facturas Odoo y 0 movimientos Drive. Las 5 validaciones y 4 vínculos Odoo históricos se conservaron. purchase-orders.json y supplierMappings.json idénticos al backup.
- Reanudación por proceso nuevo: 17 presentes, 17 omitidos, 0 análisis y 0 errores. No se copió store LAB sobre producción.

## Verificación y operación

API pública: lectura técnica 200; sin identidad y token inválido 401; 76 combinaciones de rutas/métodos no autorizados 401 reales. Usuario real admin puede escribir/releer el store; revisor Facturas resoluble y ejecutable desde su entorno real. Listado público autenticado y JSON persistido coinciden en IDs y líneas. Todas las puertas de negocio anteriores conservan valores efectivos. Servicio activo PID 1137881.

Suite auth/CLI/checkpoint, seguridad del escaneo, autofill y verificador PASS. Build y resto de suites relevantes ya superados en LAB; no rebuild ni publicación de frontend desde árbol dirty. Los hashes públicos de estáticos permanecen idénticos.

Excel `Cotejo_facturas_PRODUCCION_2026-10-30.xlsx`: 17 filas documentales, 3275 líneas y 222 motivos agrupados. Reabierto y verificado sin fórmulas ni celdas de texto fuera de límite.

Evidencia/rollback privados: `/root/.openclaw/workspace/outbox/invoice-headless-20261030/production-release/`; `manifest.json` identifica SHA-256 antes/después y metadatos; `invoice-store/` es backup previo, `verified-result.json` y `all-route-denials.json` son pruebas. Reversión selectiva en ROLLBACK.md. No restaurar todo el store sobre ediciones posteriores.

Para ejecutar una preparación autorizada: cargar client.env protegido del usuario admin y ejecutar `node --experimental-strip-types scripts/prepare-supplier-invoices.ts` en producción. Checkpoint exclusivo de producción, no borrar ni reutilizar el LAB. La ejecución periódica y las notificaciones quedan para configuración posterior. Validación humana, creación Odoo y archivo siguen siendo acciones separadas. No queda ningún lote ni monitor activo.
