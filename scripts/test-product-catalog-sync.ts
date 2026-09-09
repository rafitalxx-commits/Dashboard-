import assert from "node:assert/strict";
import {
  formatCatalogProductName,
  reconcileCatalogProducts,
  type CatalogProduct,
} from "../backend/products/catalog.ts";

const product = (id: number, name: string): CatalogProduct => ({
  id,
  templateId: id + 1000,
  name,
  reference: "REF-" + id,
  barcode: "",
  uom: "uds",
  type: "product",
  onHand: id,
  reserved: 0,
  incoming: 0,
  forecast: id,
  mto: false,
  isKit: false,
  componentCount: 0,
  physicalLocations: [],
  supplierNames: [],
});

const previous = [
  product(1, "Nombre antiguo"),
  product(2, "JSL-216 archivado"),
  product(3, "Sin cambios"),
];
const renamed = product(1, "Nombre nuevo");

const incremental = reconcileCatalogProducts(
  previous,
  [renamed],
  [1, 3],
  false,
);
assert.deepEqual(
  incremental.map(({ id, name }) => ({ id, name })),
  [
    { id: 1, name: "Nombre nuevo" },
    { id: 3, name: "Sin cambios" },
  ],
);

const full = reconcileCatalogProducts(previous, [renamed], [1], true);
assert.deepEqual(full, [renamed]);

assert.equal(
  formatCatalogProductName({
    display_name:
      "[LH15200M] Rollo cable 200 m 1,5 mm² Libre de Halógeno (Marrón)",
    default_code: "LH15200M",
    name: "Rollo cable 200 m 1,5 mm² Libre de Halógeno",
  }),
  "Rollo cable 200 m 1,5 mm² Libre de Halógeno (Marrón)",
);
assert.doesNotMatch(
  formatCatalogProductName({
    display_name: "[REF] Producto (Marrón, 2 metros)",
    default_code: "REF",
  }),
  /Color:|Longitud:/,
);

console.log(
  "Catálogo: renombrados actualizados y archivados retirados en sincronización incremental y completa",
);
console.log(
  "Catálogo y Compras: variantes formateadas solo con sus valores",
);
