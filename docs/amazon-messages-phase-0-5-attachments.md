# Amazon Messages - FASE 0.5 Gestion de adjuntos

Fecha: 2026-06-20

## Alcance

FASE 0.5 prepara Amazon Messages para trabajar con adjuntos de clientes y deja lista la interfaz para adjuntos salientes futuros.

No se conecta Amazon real. No se conecta mailbox real. No se envian mensajes. No se guardan archivos reales en el repositorio. No se toca produccion.

## Modelo de datos

Cada adjunto se normaliza como metadata:

- `id`
- `conversationId`
- `messageId`
- `originalName`
- `sanitizedName`
- `mimeType`
- `extension`
- `sizeBytes`
- `hash`
- `receivedAt`
- `origin`
- `downloadable`
- `previewable`
- `isImage`
- `isPdf`
- `kind`
- `allowed`
- `blockedReason`
- `visualAnalysisReady`
- `visualAnalysisHints`

Formatos detectados:

- JPG / JPEG
- PNG
- PDF
- TXT
- CSV
- HEIC
- WEBP
- otros como `application/octet-stream`

## Flujo Entrante

1. El parser lee adjuntos declarados en `X-Attachments` o lineas `Attachment:`.
2. Deduplica por nombre sanitizado.
3. Sanitiza nombres para evitar rutas, HTML o caracteres peligrosos.
4. Detecta extension, MIME, tipo, previsualizacion y descarga.
5. Calcula hash estable de metadata.
6. Crea evento de auditoria `attachment_received`.
7. La vista muestra el panel "Adjuntos del cliente".

## Visualizacion

La vista de conversacion incluye:

- Mensaje del cliente.
- Panel "Adjuntos del cliente".
- Miniatura placeholder para imagenes.
- Visor placeholder para PDF.
- Descarga preparada para formatos permitidos.
- Bloqueo visible para formatos peligrosos.

Los placeholders son intencionales: no hay archivo real almacenado ni conectado todavia.

## Seguridad

Reglas actuales:

- No ejecutar archivos.
- No renderizar HTML como contenido.
- Nombres sanitizados.
- Extension peligrosa bloqueada.
- Limite de tamano preparado: 10 MB por adjunto.
- Hash registrado.
- Descarga deshabilitada si el adjunto esta bloqueado.

Extensiones bloqueadas:

```text
bat, cmd, com, exe, hta, html, js, msi, ps1, scr, sh, vbs
```

## Auditoria

Eventos preparados:

- `attachment_received`
- `attachment_viewed`
- `attachment_downloaded`

En FASE 0.5 los eventos de visualizacion/descarga son estado local demo. En una fase con backend deberan persistirse con usuario real, fecha, adjunto y conversacion.

## Flujo Saliente

La interfaz incluye "Adjuntar archivo" en el panel de IA/borrador.

Permite:

- anadir archivos al borrador local;
- validar metadata;
- ver preview si aplica;
- eliminar adjuntos;
- bloquear formatos peligrosos.

No envia. No sube a Amazon. No persiste el archivo.

## Facturas Odoo

Queda preparada la arquitectura para adjuntar documentos desde Odoo:

- factura PDF;
- justificantes;
- documentos operativos.

En esta fase solo existe la estructura de metadata y el area de adjuntos salientes. La obtencion real de PDFs desde Odoo queda pendiente.

## Preparacion IA Visual

No se implementa IA visual.

La metadata deja preparado:

- `visualAnalysisReady`
- `visualAnalysisHints`

Hints previstos:

- producto roto;
- producto equivocado;
- embalaje danado;
- etiqueta visible;
- numero de serie visible.

## Tests

Comando:

```bash
npm run test:amazon-parser
```

Resultado actual:

```text
Amazon email parser tests passed: 10 fixtures, 54 field checks.
```

Casos cubiertos:

- email con imagen;
- email con PDF;
- email sin adjuntos;
- adjunto duplicado;
- nombre peligroso;
- formato no previsualizable;
- clasificacion de conversacion;
- cancelacion;
- devolucion;
- A-to-Z critica.

## Limitaciones

- No hay almacenamiento real de binarios.
- No hay URLs de descarga reales.
- Los visores son placeholders de seguridad.
- Auditoria de visualizar/descargar no persiste todavia.
- El limite de tamano esta codificado en frontend/parser y debe pasar a configuracion backend antes de produccion.

## Proximos Pasos

- Definir almacenamiento seguro de adjuntos.
- Persistir metadata y auditoria en backend.
- Conectar descarga controlada con permisos.
- Integrar factura PDF de Odoo en modo solo lectura.
- Validar si Amazon permite adjuntos salientes en la accion concreta antes de habilitar envio.
