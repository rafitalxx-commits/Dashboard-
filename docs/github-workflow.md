# Flujo de trabajo en GitHub

## Objetivo

Centralizar el trabajo del Dashboard en un repositorio GitHub para que Rafa, Juanito, Hermes y otros colaboradores puedan trabajar sin pisarse y sin tocar produccion por accidente.

## Ramas

- `main`: version estable revisada. No trabajar directamente aqui.
- `lab/*`: pruebas grandes o prototipos.
- `feature/*`: mejoras concretas.
- `fix/*`: correcciones pequenas.
- `docs/*`: documentacion.

Ejemplos:

```bash
git checkout -b feature/tasks-kanban
git checkout -b fix/odoo-delivery-incidents-count
git checkout -b docs/github-onboarding
```

## Pull Requests

Todo cambio debe entrar por PR. El PR debe incluir:

- Resumen claro.
- Archivos/modulos tocados.
- Comandos ejecutados.
- Riesgos o limites conocidos.
- Capturas si cambia UI.
- Confirmacion de que no incluye secretos.

Usar la plantilla `.github/pull_request_template.md`.

## Issues

Usar issues para:

- Bugs reproducibles.
- Tareas para Hermes.
- Mejoras propuestas.
- Cambios que requieren decision de Rafa.

## Commits

Formato recomendado:

```text
feat(tasks): add kanban board skeleton
fix(odoo): correct delivery incident filter
docs(repo): add GitHub workflow
test(agent-api): cover missing scope rejection
```

## Reglas de seguridad

- Revisar siempre `git diff` antes de commitear.
- Revisar `git status --ignored` si hay dudas sobre secretos.
- Nunca subir `.env.local`, tokens OAuth, stores JSON reales, backups, ZIPs o `node_modules`.
- Si aparece un secreto en un commit, parar y rotarlo antes de seguir.

## Validacion minima

Antes de abrir PR:

```bash
npm run build
```

Segun el modulo:

```bash
npm run test:agent-api
npm run test:amazon-backend
npm run test:odoo-delivery-status
```

Si no se pudo ejecutar algo, decirlo en el PR con el motivo.

## Produccion

Un PR mergeado no significa despliegue automatico. Para desplegar:

1. Confirmar que la rama esta revisada.
2. Validar en lab/paralelo si toca flujo de negocio.
3. Pedir aprobacion explicita de Rafa.
4. Hacer backup si aplica.
5. Desplegar.
6. Validar desde fuera que `https://dashboard.todoelectrico.net` responde.

## Trabajo con agentes

Cuando un agente trabaje en el repo:

- Debe leer `AGENTS.md`.
- Debe explicar que va a tocar antes de editar.
- Debe dejar documentacion si introduce una decision nueva.
- Debe evitar cambios masivos no solicitados.
- Debe trabajar sobre ramas o PRs, no directamente en `main`.
