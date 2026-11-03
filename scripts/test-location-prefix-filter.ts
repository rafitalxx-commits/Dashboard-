/**
 * Test: Filtro de ubicaciones por prefijo
 *
 * Verifica que la lógica de filtrado en ProductsCatalogView permita
 * búsquedas por prefijo (ej. 'A1' debe encontrar 'A1-02-01', 'A101', etc.)
 *
 * Esta función replica exactamente la lógica del frontend:
 *   if (locationFilter) {
 *     const locationTerm = locationFilter.trim().toUpperCase();
 *     if (!p.physicalLocations.some((loc) => loc === locationTerm || loc.startsWith(locationTerm)))
 *       return false;
 *   }
 */
import assert from "node:assert/strict";

type CatalogProduct = {
  id: number;
  physicalLocations: string[];
};

function filterByLocation(
  products: CatalogProduct[],
  locationFilter: string,
): CatalogProduct[] {
  if (!locationFilter) return products;
  const locationTerm = locationFilter.trim().toUpperCase();
  return products.filter((p) =>
    p.physicalLocations.some(
      (loc) => loc === locationTerm || loc.startsWith(locationTerm),
    ),
  );
}

// --- Datos de prueba ---
const products: CatalogProduct[] = [
  { id: 1, physicalLocations: ["A1-02-01", "A1-02-02"] },
  { id: 2, physicalLocations: ["B3-01-01"] },
  { id: 3, physicalLocations: ["A2-01-01"] },
  { id: 4, physicalLocations: ["A101"] },
  { id: 5, physicalLocations: [] },
  { id: 6, physicalLocations: ["C1-03-01", "A1-01-01"] },
];

// --- Test 1: Prefijo 'A1' encuentra A1-02-01, A1-02-02, A101, A1-01-01 ---
const a1Results = filterByLocation(products, "A1");
assert.deepEqual(
  a1Results.map((p) => p.id),
  [1, 4, 6],
  "A1 debe encontrar productos con ubicaciones A1-02-01, A101, A1-01-01",
);

// --- Test 2: Match exacto 'B3-01-01' ---
const exactResults = filterByLocation(products, "B3-01-01");
assert.deepEqual(
  exactResults.map((p) => p.id),
  [2],
  "B3-01-01 debe encontrar solo el producto 2",
);

// --- Test 3: Prefijo 'A2' ---
const a2Results = filterByLocation(products, "A2");
assert.deepEqual(
  a2Results.map((p) => p.id),
  [3],
  "A2 debe encontrar solo el producto 3",
);

// --- Test 4: Sin filtro, todos pasan ---
const allResults = filterByLocation(products, "");
assert.equal(allResults.length, products.length, "Sin filtro devolver todos");

// --- Test 5: Filtro sin resultados ---
const noneResults = filterByLocation(products, "Z99");
assert.equal(noneResults.length, 0, "Z99 no debe encontrar nada");

// --- Test 6: Prefijo 'A10' no incluye A1-02-01 ---
const a10Results = filterByLocation(products, "A10");
assert.deepEqual(
  a10Results.map((p) => p.id),
  [4],
  "A10 solo debe encontrar A101 (startsWith), no A1-02-01",
);

// --- Test 7: Espacios y mayúsculas ---
const spacesResults = filterByLocation(products, "  a1  ");
assert.deepEqual(
  spacesResults.map((p) => p.id),
  [1, 4, 6],
  "Debe ignorar espacios y ser case-insensitive",
);

// --- Test 8: Producto sin ubicaciones nunca aparece ---
const emptyResults = filterByLocation(products, "A1");
assert.ok(
  !emptyResults.some((p) => p.id === 5),
  "Producto sin ubicaciones no debe aparecer en resultados",
);

// --- Test 9: Verificar que reconcileCatalogProducts preserva physicalLocations ---
import {
  reconcileCatalogProducts,
  type CatalogProduct as BackendCatalogProduct,
} from "../backend/products/catalog.ts";

const baseProduct = (id: number, locs: string[]): BackendCatalogProduct => ({
  id,
  templateId: id + 1000,
  name: `Product ${id}`,
  reference: `REF-${id}`,
  barcode: "",
  uom: "uds",
  type: "product",
  onHand: 10,
  reserved: 0,
  incoming: 0,
  forecast: 10,
  mto: false,
  isKit: false,
  componentCount: 0,
  physicalLocations: locs,
  supplierNames: [],
});

const previousProducts = [
  baseProduct(1, ["A1-01-01", "B2-03-01"]),
  baseProduct(2, ["C1-01-01"]),
  baseProduct(3, []),
];

// Sync incremental: producto 1 renombrado, producto 2 no cambió, producto 3 eliminado
const refreshed = [
  { ...baseProduct(1, []), name: "Product 1 Renamed" },
];
const incremental = reconcileCatalogProducts(
  previousProducts,
  refreshed,
  [1, 2], // solo 1 y 2 están activos en Odoo
  false,
);
const p1 = incremental.find((p) => p.id === 1);
const p2 = incremental.find((p) => p.id === 2);
assert.ok(p1, "Producto 1 debe existir tras reconcile incremental");
assert.ok(p2, "Producto 2 debe existir tras reconcile incremental");
// Producto 1: su physicalLocations del previous se preserva (no se pisa con [])
assert.deepEqual(
  p1!.physicalLocations,
  ["A1-01-01", "B2-03-01"],
  "physicalLocations del producto 1 se preserva del previous en reconcile incremental",
);
// Producto 2: se mantiene sin cambios
assert.deepEqual(
  p2!.physicalLocations,
  ["C1-01-01"],
  "physicalLocations del producto 2 se preserva del previous",
);
// Producto 3: eliminado porque no está en activeProductIds
assert.equal(
  incremental.find((p) => p.id === 3),
  undefined,
  "Producto 3 eliminado por no estar activo",
);

console.log("✅ Todos los tests de prefijo y preservación de ubicaciones pasaron");
