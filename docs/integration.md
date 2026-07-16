# Integración del prototipo de tareas en el dashboard

## Objetivo
Incorporar el módulo de tareas al dashboard principal sin romper lo existente.

## Archivo a integrar
- `prototipo-tareas.html`

## Rutas sugeridas
- `/tareas` — vista pública sin login
- `/prototipo` — acceso temporal mientras se valida

## Backend: endpoints mínimos requeridos
- `GET /api/agent/inbox` → JSON
- `GET /api/agent/tasks` → JSON
- `GET /api/agent/calendar` → JSON

## Formato JSON esperado
- `/inbox` → `[{ from, subject, date, snippet }]`
- `/tasks` → `[{ id, title, status, assignee, dueDate }]`
- `/calendar` → `[{ id, summary, start, end }]`

## Pasos para Juanito
1. Crear rama `feature/tareas` desde `main`
2. Copiar `prototipo-tareas.html` a la ruta elegida (`/tareas` o `/prototipo`)
3. Implementar endpoints/JSON anteriores en backend
4. Sustituir `fetch("/api/inbox")` por `/api/agent/inbox`
5. Deploy en staging y validar en móvil
6. Abrir PR a `main` y merge cuando esté ok

## Notas
- No exponer secretos ni `.env` en el repo
- Validar CORS/headers desde móvil
- Si Gmail falla, devolver array vacío para no romper el panel
