# Corrección: Pérdida de ubicaciones tras sincronización de catálogo

**Fecha:** 2026-09-10
**Estado:** LISTO PARA PRODUCCIÓN (sin aplicar)
**Rama LAB:** `/home/admin/.openclaw/workspaces/lovable/odoo-v18-dashboard`

## Problema

Al sincronizar el catálogo de productos desde Odoo (POST `/api/odoo/products/sync`), los campos `physicalLocations` y `locationSummary` se perdían en la respuesta API. Esto causaba que la UI mostrara "Sin ubicación" para productos que sí tenían ubicaciones asignadas en Dashboard.

## Causa raíz (tres capas)

### 1. `reconcileCatalogProducts()` descartaba datos locales (`catalog.ts`)

La función `reconcileCatalogProducts` en `backend/products/catalog.ts` reemplazaba cada producto con la versión "refrescada" de Odoo, que nunca incluye `physicalLocations` ni `supplierNames` (son campos exclusivos de Dashboard). En una sincronización incremental, si el producto estaba en `refreshed` pero no en `previous`, se perdían esos campos.

### 2. Endpoint POST `/sync` devolvía catálogo sin enriquecer (`vite.config.ts`)

El endpoint `GET /api/odoo/products` enriquecía la respuesta con `physicalLocations` y `locationSummary` calculados desde `product-locations.json`. Pero el endpoint `POST /api/odoo/products/sync` devolvía el catálogo "raw" de `productCatalog.sync()`, sin ese enriquecimiento.

### 3. Frontend sobreescribía el estado completo (`ProductsCatalogView.tsx`)

La función `sync()` en el frontend hacía `setCatalog(next)` con la respuesta del sync, reemplazando todo el estado incluyendo los campos enriquecidos que el `load()` previo había obtenido del endpoint GET.

## Correcciones aplicadas

### Fix 1: `backend/products/catalog.ts` — Preservar datos locales en reconciliación

```diff
 export function reconcileCatalogProducts(...) {
   const activeIds = new Set(activeProductIds);
+  const prevById = new Map(previous.map((p) => [p.id, p]));
   const next = new Map<number, CatalogProduct>(
     (full ? [] : previous.filter((p) => activeIds.has(p.id))).map(
       (product) => [product.id, product],
     ),
   );
   refreshed.forEach((product) => {
-    if (activeIds.has(product.id)) next.set(product.id, product);
+    if (!activeIds.has(product.id)) return;
+    const prev = prevById.get(product.id);
+    next.set(product.id, {
+      ...product,
+      physicalLocations: product.physicalLocations.length
+        ? product.physicalLocations
+        : prev?.physicalLocations ?? [],
+      supplierNames: product.supplierNames.length
+        ? product.supplierNames
+        : prev?.supplierNames ?? [],
+    });
   });
```

**Efecto:** Al reconciliar, si Odoo trae un producto sin `physicalLocations` (que es siempre), se hereda del snapshot anterior. Nunca se pierden ubicaciones locales.

### Fix 2: `vite.config.ts` — Enriquecer respuesta del sync

```diff
 if (request.method === "POST" && url.pathname === "/sync") {
-  sendJson(response, 200, await productCatalog.sync(...));
+  const rawCatalog = await productCatalog.sync(...);
+  const locs = productLocations.summary().locations;
+  sendJson(response, 200, {
+    ...rawCatalog,
+    products: rawCatalog.products.map((product: any) => {
+      const productLocs = locs.filter((loc) => loc.productId === product.id);
+      const preferred = productLocs.find((loc) => loc.preferred);
+      return {
+        ...product,
+        physicalLocations: productLocs.map((loc) => loc.code),
+        locationSummary: { preferredCode, preferredQuantity, ... },
+      };
+    }),
+  });
```

**Efecto:** El sync ahora devuelve la misma estructura enriquecida que el GET. El frontend recibe `physicalLocations` y `locationSummary` directamente en la respuesta del sync.

### Fix 3: `src/modules/products/ProductsCatalogView.tsx` — Filtro por prefijo

```diff
-if (locationFilter && !p.physicalLocations.includes(locationFilter.trim().toUpperCase()))
-  return false;
+if (locationFilter) {
+  const locationTerm = locationFilter.trim().toUpperCase();
+  if (!p.physicalLocations.some((loc) => loc === locationTerm || loc.startsWith(locationTerm)))
+    return false;
+}
```

**Efecto:** Buscar `A1` ahora encuentra productos en `A1-02-01`, `A101`, `A1-01-01`, etc. El match es case-insensitive y respeta espacios.

## Verificación

### Tests automatizados

| Test | Resultado |
|------|-----------|
| `test-product-catalog-sync.ts` (existente) | ✅ Pasa |
| `test-location-prefix-filter.ts` (nuevo, 9 asserts) | ✅ Pasa |

El test nuevo verifica:
- Filtro por prefijo: `A1` → `A1-02-01`, `A101`, `A1-01-01`
- Match exacto: `B3-01-01`
- Sin resultado: `Z99`
- Case-insensitive con espacios
- `reconcileCatalogProducts` preserva `physicalLocations` del previous

### Build

```
✓ 1713 modules transformed
✓ built in 4.53s
```

### Datos reales del LAB

| Métrica | Valor |
|---------|-------|
| Productos totales | 5.854 |
| Asignaciones ubicación | 1.427 |
| Productos con ubicación | 1.345 |
| Entradas catálogo ubicaciones | 171 (170 activas) |
| supplierNames preservados | 4.325 |

## Archivos modificados

1. `backend/products/catalog.ts` — Función `reconcileCatalogProducts`
2. `vite.config.ts` — Handler POST `/sync` en `/api/odoo/products`
3. `src/modules/products/ProductsCatalogView.tsx` — Filtro de ubicación
4. `scripts/test-location-prefix-filter.ts` — Test nuevo

## Para subir a producción

1. Copiar los 3 archivos fuente modificados a la rama de producción
2. Rebuild (`npx vite build` o deploy automático)
3. No requiere migración de datos (los JSON se enriquecen en runtime)
4. No hay cambios en tipos (`odooTypes.ts` sin modificar)
