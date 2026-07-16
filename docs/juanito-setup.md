# Guión para Juanito

## 1. Crear repo
- Nombre sugerido: `dashboard`
- Privado
- Sin README/licencia

## 2. Inicializar git
```bash
git init
git checkout -b main
git add .
git commit -m 'chore: proyecto dashboard inicial'
git remote add origin git@github.com:<ORG>/dashboard.git
git push -u origin main
```

## 3. Ramas recomendadas
- `main`
- `dev`
- `feature/*`

## 4. CI básica
- Node version fija
- npm ci
- build
- tests

## 5. Secrets
Solo en servidor/correr local:
- `DASHBOARD_TOKEN`
- credenciales Google
- URL base API

## 6. Próximos pasos
- Integrar `/api/agent/inbox`
- Integrar módulo de tareas
- Testear `prototipo-tareas.html` en staging
