# Entregas Odoo sin ubicación preferente

Si un movimiento completado llega al sincronizador de ubicaciones sin preferente, no se descuenta stock ni se marca su ID como procesado. Se guarda en `odooMovementSync.pendingMovements` con producto, cantidad, ID y motivo. El cursor automático puede avanzar sin perderlo: cada pasada reintenta la cola antes de procesar movimientos nuevos. Al asignarse una preferente, se aplica una vez y se elimina de la cola.

La ruta autenticada `GET /api/odoo/products/locations/incidents` expone la cola y la referencia del catálogo local. `location-incidents.js` muestra un aviso visible en Dashboard sin sustituir el bundle actualmente servido. El aviso no realiza escrituras ni reintentos por sí mismo.

No se reprocesan IDs históricos ya registrados en `processedMoveIds`, ni se rebobina el cursor ni se corrige el histórico anterior al corte automático. Eso requiere conciliación individual o auditoría separada para evitar descuentos duplicados.
