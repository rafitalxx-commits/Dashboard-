# Arquitectura

## Visión general
- Frontend standalone en `index.html`
- Backend modular en `backend/`
- Sin dependencias de producción externas

## Módulos
- Tareas: kanban + lista compacta + calendario + drag&drop
- Amazon Messages: parser de emails a borradores
- Odoo: lectura de pedidos/estado
- Sendcloud: estado de envíos

## Datos y secretos
- No hay secretos en el repo
- `.env` solo en servidor
- Documentación en `/docs`

## Despliegue
- VPS con Node + nginx/proxy
- Build por rama protegida
- Rollback con tags
