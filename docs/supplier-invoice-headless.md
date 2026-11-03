# Preparación de facturas sin navegador

## Estado y alcance

Publicado en producción con aprobación de Rafa (Telegram 10003). Sin ejecución periódica.
Resultado, operación y rollback actuales: [cierre de publicación](releases/supplier-invoice-headless-production-20261030.md).
Los apartados de ensayo/promoción debajo documentan la validación previa.
Base aislada `af421b0`: snapshot del módulo activo, separado de los cambios de esta función.
La autenticación técnica sustituye la dependencia de sesión humana para la preparación,
no la revisión ni la validación final. La bandeja manual y sus permisos se conservan.

Flujo: actualizar metadatos de SIN REVISAR → seleccionar ID Drive presente → descargar
PDF actual → revisión individual Facturas con texto completo → cotejo Odoo de solo
lectura → guardar campos y líneas locales → revisión/validación humana posterior.

## Contrato técnico

Backend: `SUPPLIER_INVOICES_AUTOMATION_ENABLED=true` y
`SUPPLIER_INVOICES_AUTOMATION_TOKEN_SHA256=<hash SHA256 de token aleatorio base64url de 32 bytes>`.
No crear usuario humano ficticio, copiar cookies, quitar autenticación ni dar acceso
administrativo al analista. El token identifica `Facturas · Preparación automática`.
Sin habilitación explícita, el backend sigue rechazando el acceso técnico.

Solo se admite Bearer en estas rutas y métodos exactos:

- `GET /api/odoo/supplier-invoices/inbox`
- `POST /api/odoo/supplier-invoices/inbox/scan`
- `POST /api/odoo/supplier-invoices/inbox/raskibot-extract` (un ID, sin preguntas)

El resto conserva sesión y permisos humanos: confirmaciones, edición manual,
validación documental, borrador Odoo, precios, productos, subidas y archivo Drive.
No se crean ni contabilizan facturas, ni se mueven archivos durante el lote.
No modificar las puertas de escritura del flujo humano al provisionar este token;
su restricción se aplica en el acceso a rutas, independientemente de esas puertas.

Cliente: `scripts/prepare-supplier-invoices.ts`. Configurar por el gestor de secretos/
servicio, fuera de Git y sin tokens en argumentos o logs:

```
SUPPLIER_INVOICES_AUTOMATION_URL=https://<host-y-prefijo-aprobados>
SUPPLIER_INVOICES_AUTOMATION_TOKEN_FILE=/ruta/protegida/token
SUPPLIER_INVOICES_AUTOMATION_STATE_FILE=/ruta/privada/checkpoint.json
```

Ejecutar como usuario con permiso de lectura del token y escritura en el directorio
privado del checkpoint:

```bash
node --experimental-strip-types scripts/prepare-supplier-invoices.ts
```

Se exige HTTPS salvo loopback para pruebas locales y se rechazan redirecciones.
El revisor recibe el contexto completo mediante `--message-file` (máximo 4 MiB),
en un directorio temporal privado con fichero 0600 y limpieza en success/error.
Esto evita E2BIG sin recortar tablas, líneas o evidencia.

El proceso secuencia PDFs, guarda el checkpoint tras cada resultado y no repite
propuestas completas/parciales cuya versión Drive no cambió. Un parcial espera
revisión humana, no reintentos IA continuos. Los errores por documento no bloquean
los demás; 401/403 o fallo de persistencia sí detienen el lote. Los errores de
análisis vuelven a ser elegibles en otra ejecución. No se instala ningún cron.

Se excluyen registros ausentes, archivados, validados o con factura Odoo vinculada.
Cada análisis automático vuelve a comprobar los padres Drive del ID seleccionado
y descarga bytes actuales para no confundir una versión
Drive modificada con un PDF anterior en caché. Se preservan correcciones humanas.
Un resultado IA sin cotejo independiente se clasifica pendiente, nunca preparado.
La marca `prepared` significa propuesta técnica preparada, no validación humana.

El lock exclusivo `<checkpoint>.lock` impide dos procesos del mismo lote. Si un
proceso muere por SIGKILL, verificar que su PID ya no existe antes de retirar solo
ese lock. Conservar el checkpoint; no reiniciar todo por un fallo de un documento.
Para una revisión solicitada de un pendiente, usar la acción humana por ID o un
checkpoint separado de reanálisis explícito, conservando el histórico anterior.

## Validación

```bash
node --experimental-strip-types scripts/test-correos-express-invoice-pdf.ts
node --experimental-strip-types scripts/test-supplier-invoice-automation.ts
node --experimental-strip-types scripts/test-supplier-invoice-scan-safety.ts
node --experimental-strip-types scripts/test-supplier-auto-fill.ts
node --experimental-strip-types scripts/test-supplier-auto-verifier.ts
node --experimental-strip-types scripts/test-supplier-invoices-phase2.ts
npm run build
```

Se prueban rutas reales registradas sin cookies (76 combinaciones fuera del permiso
rechazadas), prefijos desconocidos, PDF actualizado, lote secuencial, persistencia
por archivo, reanudación desde proceso nuevo, lock y fallo de autenticación. La CLI
usa HTTP local con datos sintéticos; la comprobación real usa el mismo backend,
Drive y Odoo de solo lectura, token efímero, loopback y almacén LAB independiente.
La prueba real no demuestra despliegue público ni planificación persistente.
El revisor reintenta una sola vez la respuesta incompleta/no estructurada de ese
PDF, manteniendo todo el contexto; si persiste el fallo, conserva el bloqueo.
No se reintentan automáticamente preguntas humanas ni se omiten líneas.
La extracción automática usa una sesión por Drive ID y hash de versión PDF; el
historial local del documento sigue siendo la conversación explícita de revisión.
Esto evita arrastrar respuestas corruptas o sucesivas copias completas del PDF.

## Documentos largos y escaneados

La plantilla exacta Ecosystems B2B de Correos Express tiene un extractor estricto:
identifica emisor, cuenta cada Albarán, comprueba cada precio/cantidad y fuel,
y exige suma de filas = base y base + IVA = total impresos. Conserva importes cero.
Si cualquier fila, identidad o suma no encaja, no aplica esta extracción.
El revisor recibe el PDF completo y un resumen comprobado, devuelve cabecera y
dudas; el backend incorpora todas las líneas comprobadas sin hacer que el modelo
reescriba miles de filas. El fuel se conserva separado por albarán con importe
impreso y cantidad/precio unitario vacíos si no figuran; no se inventan.
El guardado manual admite hasta 5000 líneas y 8 MB en esa ruta concreta. Más de
5000 líneas se rechazan sin truncar ni reemplazar la ficha anterior. Las demás
rutas conservan su límite de cuerpo previo. La prueba de persistencia reabre una
factura de 2438 líneas después del guardado manual.

Un PDF sin texto se entrega al mismo revisor para lectura visual/OCR del archivo
completo. Si no puede leerlo, la propuesta queda bloqueada. Una propuesta visual
se guarda siempre parcial y pendiente de cotejo, sin equiparar el texto supuesto
con evidencia de identidad/precio en Odoo ni marcar el OCR como verificado.
La factura comercial y su packing list no se suman como facturas independientes.

## Procedimiento de promoción (ya ejecutado)

Revisar el informe LAB y el diff desde `af421b0`. Obtener aprobación explícita de
Rafa para el cambio concreto en producción según AGENTS.md. Antes de desplegar,
comparar los archivos base del módulo con los activos: producción está dirty y
este worktree no debe sustituirla entera. Hacer backup del store local y comprobar
permisos del usuario del servicio. Desplegar solo los módulos revisados y las dos
variables de Vite; provisionar token/hash por el consumidor protegido existente.
Repetir pruebas negativas y una factura real a través de la frontera desplegada.
No copiar encima de producción el store del ensayo. Dejar borradores reales solo
mediante las rutas autenticadas del servicio, preservando IDs y ediciones actuales.
Programar periodicidad y notificación solo tras aprobar su configuración concreta.


## Resultado real y punto de continuación

Ensayo 2026-10-30 terminado: 17 PDF presentes en SIN REVISAR; 17 propuestas
persistidas, todas parciales con decisiones de revisión, 0 fallos técnicos restantes,
3 copias idénticas por SHA-256, 3274 líneas locales. No confundir esta preparación
con 17 facturas íntegramente verificadas o aprobadas. Ningún registro quedó VALIDADA,
con odooDraftMoveId ni movedTo. Producción y schedulers no se modificaron.

Las facturas Correos F260917324 y F260816214 conservan 367/1219 envíos y 732/2438
líneas (fuel separado), con bases 4000,26/12383,55 y totales 4840,31/14984,10 EUR;
las sumas detalladas coinciden con las bases impresas. El PDF de commercial invoice
+ packing list se leyó visualmente y guardó 3 líneas como propuesta parcial, sin
inventar NIF, IVA ni cantidad/precio de portes ausentes. La copia FACRODI que daba
JSON inválido se preparó correctamente usando el contexto limpio por ID+hash.

Evidencia privada fuera de Git:
`/root/.openclaw/workspace/outbox/invoice-headless-20261030/`:
`live-checkpoint.json`, `live-lab-data/`, `batch-report.json`,
`Cotejo_facturas_LAB_2026-10-30.xlsx` (17 documentos, 3274 líneas y pendientes
agrupados sin truncar celdas), `make_report.py` y harnesses de ensayo.
No copiar ese store sobre producción. Los puertos efímeros 35245, 33525, 34331,
43133, 33953 y 44041 están cerrados; no queda ejecución ni monitor activo.

Checks ejecutados con exit 0: test-correos-express-invoice-pdf,
test-supplier-invoice-automation (incluye CLI/HTTP/checkpoint y 76 negativas),
test-supplier-invoices-phase2 (incluye guardar/reabrir 2438 líneas y rechazar 5001),
test-supplier-invoice-scan-safety, test-supplier-agent-reply,
test-supplier-auto-fill, test-supplier-auto-verifier y npm run build.
Las cinco fixtures PDF antiguas opcionales de /tmp de phase2 no estaban presentes;
la prueba real anterior se hizo con los 17 PDF actuales y es evidencia separada.
Build conserva el aviso preexistente de tamaño de bundle; no cambió el frontend.

Procedimiento documentado previo a publicación: comparar baseline
`af421b0` con archivos activos, aplicar solo el delta descrito, provisionar identidad
protegida, backup/permisos del store y prueba de frontera real. El vite.config.ts
activo contiene cambios ajenos: insertar solo las dos variables, nunca sustituirlo.
La periodicidad/cron no está autorizada/configurada y es un paso posterior.

Reanudación real desde proceso nuevo confirmada: 17 PDF presentes, 17 omitidos por checkpoint vigente, 0 llamadas de análisis y 0 errores.

## Cierre de producción

Publicado con OK de Rafa: 17 propuestas parciales reales, 3275 líneas, 3 copias idénticas, 0 fallos técnicos. API pública y reanudación verificadas. Validación manual; Odoo/Drive sin acciones finales automáticas. Sin cron, lote ni monitor activo. Véase cierre de publicación enlazado arriba; este estado sustituye los pendientes históricos del ensayo.
