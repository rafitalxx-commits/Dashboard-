import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type CatalogProduct = {
  id: number;
  templateId?: number;
  name: string;
  reference: string;
  barcode: string;
  uom: string;
  type: string;
  onHand: number;
  reserved: number;
  incoming: number;
  forecast: number;
  mto: boolean;
  isKit: boolean;
  componentCount: number;
  physicalLocations: string[];
  supplierNames: string[];
  updatedAt?: string;
};
type Store = {
  version: 1;
  updatedAt?: string;
  products: CatalogProduct[];
  sync: {
    status: "never" | "running" | "ok" | "error";
    lastStartedAt?: string;
    lastFinishedAt?: string;
    message?: string;
    full: boolean;
    scanned: number;
    changed: number;
  };
};
type Rpc = (service: string, method: string, args: unknown[]) => Promise<any>;

const emptyStore = (): Store => ({
  version: 1,
  products: [],
  sync: { status: "never", full: false, scanned: 0, changed: 0 },
});
const clean = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";
const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const catalogName = (product: any) => {
  // In Odoo, display_name carries the selected variant values. Prefer it so a
  // variant is never confused with its template in the catalogue or on labels.
  const raw =
    clean(product.display_name).replace(/^\[[^\]]+\]\s*/, "") ||
    clean(product.name);
  const reference = clean(product.default_code);
  if (!reference) return raw;
  // Odoo's name is sometimes manually prefixed with the internal reference.
  // Keep that reference exclusively in its own catalogue column.
  const withoutReference = raw
    .replace(
      new RegExp(
        `^\\s*(?:\\([^)]*\\)\\s*)?\\[?${escapeRegExp(reference)}\\]?\\s*[-–—:]?\\s*`,
        "i",
      ),
      "",
    )
    .trim();
  return withoutReference || raw;
};
const relationId = (value: unknown) =>
  Array.isArray(value) && Number.isInteger(value[0])
    ? Number(value[0])
    : undefined;
const relationName = (value: unknown) =>
  Array.isArray(value) ? clean(value[1]) : "";

export function createProductCatalog(env: Record<string, string>) {
  const dataDir =
    env.DASHBOARD_DATA_DIR || join(process.cwd(), ".dashboard-data");
  const file = join(dataDir, "products-catalog.json");
  let syncing = false;
  const read = (): Store => {
    try {
      return existsSync(file)
        ? (JSON.parse(readFileSync(file, "utf8")) as Store)
        : emptyStore();
    } catch {
      return emptyStore();
    }
  };
  const save = (store: Store) =>
    writeFileSync(file, JSON.stringify(store, null, 2), "utf8");
  const config = () => ({
    url: clean(env.ODOO_URL).replace(/\/+$/, ""),
    db: clean(env.ODOO_DATABASE),
    login: clean(env.ODOO_USERNAME),
    key: clean(env.ODOO_API_KEY),
  });
  const rpc = async (service: string, method: string, args: unknown[]) => {
    const c = config();
    if (!c.url || !c.db || !c.login || !c.key)
      throw new Error("Faltan credenciales Odoo para Productos");
    const response = await fetch(`${c.url}/jsonrpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        params: { service, method, args },
        id: Date.now(),
      }),
    });
    const payload = (await response.json()) as {
      result?: unknown;
      error?: { message?: string; data?: { message?: string } };
    };
    if (payload.error)
      throw new Error(
        payload.error.data?.message ||
          payload.error.message ||
          "Error RPC Odoo",
      );
    return payload.result;
  };
  const withOdoo = async <T>(
    task: (
      kw: (
        model: string,
        method: string,
        args: unknown[],
        kwargs?: Record<string, unknown>,
      ) => Promise<any>,
    ) => Promise<T>,
  ) => {
    const c = config();
    const uid = await rpc("common", "authenticate", [c.db, c.login, c.key, {}]);
    if (!uid) throw new Error("Odoo no aceptó la conexión de Productos");
    return task((model, method, args, kwargs = {}) =>
      rpc("object", "execute_kw", [
        c.db,
        uid,
        c.key,
        model,
        method,
        args,
        kwargs,
      ]),
    );
  };
  const sync = async (full = false) => {
    if (syncing) return read();
    syncing = true;
    const before = read();
    const startedAt = new Date().toISOString();
    save({
      ...before,
      sync: { ...before.sync, status: "running", lastStartedAt: startedAt },
    });
    try {
      const next = await withOdoo(async (kw) => {
        const locations = await kw(
          "stock.location",
          "search_read",
          [[["complete_name", "=", "ALM/Stock"]]],
          { fields: ["id", "complete_name"], limit: 1 },
        );
        const stockLocationId = locations[0]?.id;
        if (!stockLocationId)
          throw new Error("No se encontró la ubicación Odoo ALM/Stock");
        const since =
          !full && before.sync.lastFinishedAt
            ? before.sync.lastFinishedAt.replace("T", " ").slice(0, 19)
            : "";
        const productDomain: unknown[] = [["active", "=", true]];
        if (since) productDomain.push(["write_date", ">=", since]);
        const changedProducts = await kw(
          "product.product",
          "search_read",
          [productDomain],
          {
            fields: [
              "id",
              "name",
              "display_name",
              "default_code",
              "barcode",
              "uom_id",
              "type",
              "product_tmpl_id",
              "write_date",
              "incoming_qty",
              "outgoing_qty",
              "virtual_available",
              "qty_available",
            ],
            context: { location: stockLocationId },
            limit: full ? 20000 : 5000,
            order: "id asc",
          },
        );
        const quantDomain: unknown[] = [
          ["location_id", "child_of", stockLocationId],
        ];
        if (since) quantDomain.push(["write_date", ">=", since]);
        const changedQuants = await kw(
          "stock.quant",
          "search_read",
          [quantDomain],
          {
            fields: [
              "product_id",
              "quantity",
              "reserved_quantity",
              "write_date",
            ],
            limit: 20000,
          },
        );
        const changedIds = new Set<number>(
          changedProducts.map((p: any) => p.id),
        );
        changedQuants.forEach((q: any) => {
          const id = relationId(q.product_id);
          if (id) changedIds.add(id);
        });
        const products = full
          ? changedProducts
          : changedIds.size
            ? await kw("product.product", "read", [[...changedIds]], {
                fields: [
                  "id",
                  "name",
                  "display_name",
                  "default_code",
                  "barcode",
                  "uom_id",
                  "type",
                  "product_tmpl_id",
                  "write_date",
                  "incoming_qty",
                  "outgoing_qty",
                  "virtual_available",
                  "qty_available",
                ],
                context: { location: stockLocationId },
              })
            : [];
        const templateIds = [
          ...new Set(
            products
              .map((p: any) => relationId(p.product_tmpl_id))
              .filter(Boolean),
          ),
        ];
        const templates = templateIds.length
          ? await kw("product.template", "read", [templateIds], {
              fields: ["id", "route_ids"],
            })
          : [];
        const routeIds = [
          ...new Set(templates.flatMap((t: any) => t.route_ids || [])),
        ];
        const routes = routeIds.length
          ? await kw("stock.route", "read", [routeIds], {
              fields: ["id", "name"],
            })
          : [];
        const mtoRoutes = new Set(
          routes
            .filter((r: any) =>
              /make to order|bajo pedido|mto/i.test(clean(r.name)),
            )
            .map((r: any) => r.id),
        );
        const templateById = new Map(templates.map((t: any) => [t.id, t]));
        // One batched read keeps the supplier filter local; never query Odoo from the browser.
        const supplierRows = templateIds.length
          ? await kw(
              "product.supplierinfo",
              "search_read",
              [[["product_tmpl_id", "in", templateIds]]],
              { fields: ["product_tmpl_id", "partner_id"], limit: 30000 },
            )
          : [];
        const suppliersByTemplate = new Map<number, string[]>();
        supplierRows.forEach((row: any) => {
          const id = relationId(row.product_tmpl_id);
          const name = relationName(row.partner_id);
          if (id && name)
            suppliersByTemplate.set(id, [
              ...new Set([...(suppliersByTemplate.get(id) || []), name]),
            ]);
        });
        const boms = templateIds.length
          ? await kw(
              "mrp.bom",
              "search_read",
              [
                [
                  ["active", "=", true],
                  ["product_tmpl_id", "in", templateIds],
                ],
              ],
              {
                fields: ["id", "product_tmpl_id", "product_id", "bom_line_ids"],
                limit: 20000,
              },
            )
          : [];
        const bomByTemplate = new Map<number, any[]>();
        boms.forEach((b: any) => {
          const id = relationId(b.product_tmpl_id);
          if (id) bomByTemplate.set(id, [...(bomByTemplate.get(id) || []), b]);
        });
        const quants = await kw(
          "stock.quant",
          "search_read",
          [[["location_id", "child_of", stockLocationId]]],
          {
            fields: ["product_id", "quantity", "reserved_quantity"],
            limit: 30000,
          },
        );
        const stockByProduct = new Map<
          number,
          { onHand: number; reserved: number }
        >();
        quants.forEach((q: any) => {
          const id = relationId(q.product_id);
          if (!id) return;
          const prior = stockByProduct.get(id) || { onHand: 0, reserved: 0 };
          prior.onHand += Number(q.quantity || 0);
          prior.reserved += Number(q.reserved_quantity || 0);
          stockByProduct.set(id, prior);
        });
        const old = new Map(before.products.map((p) => [p.id, p]));
        products.forEach((p: any) => {
          const templateId = relationId(p.product_tmpl_id);
          const template = templateId
            ? templateById.get(templateId)
            : undefined;
          const stock = stockByProduct.get(p.id) || { onHand: 0, reserved: 0 };
          const productBoms = templateId
            ? bomByTemplate.get(templateId) || []
            : [];
          const previous = old.get(p.id);
          old.set(p.id, {
            id: p.id,
            templateId,
            name: catalogName(p),
            reference: clean(p.default_code),
            barcode: clean(p.barcode),
            uom: relationName(p.uom_id),
            type: clean(p.type),
            onHand: stock.onHand,
            reserved: Number(p.outgoing_qty || stock.reserved || 0),
            incoming: Number(p.incoming_qty || 0),
            forecast: Number(p.virtual_available || 0),
            mto: Boolean(
              (template?.route_ids || []).some((id: number) =>
                mtoRoutes.has(id),
              ),
            ),
            isKit: productBoms.length > 0,
            componentCount: productBoms.reduce(
              (n: number, b: any) => n + (b.bom_line_ids?.length || 0),
              0,
            ),
            physicalLocations: previous?.physicalLocations || [],
            supplierNames:
              suppliersByTemplate.get(templateId || -1) ||
              previous?.supplierNames ||
              [],
            updatedAt: clean(p.write_date),
          });
        });
        const now = new Date().toISOString();
        return {
          version: 1 as const,
          updatedAt: now,
          products: [...old.values()].sort((a, b) =>
            a.name.localeCompare(b.name, "es"),
          ),
          sync: {
            status: "ok" as const,
            lastStartedAt: startedAt,
            lastFinishedAt: now,
            message: `ALM/Stock · ${old.size} productos`,
            full: full || !before.sync.full,
            scanned: products.length,
            changed: changedIds.size,
          },
        };
      });
      save(next);
      return next;
    } catch (error) {
      const failed = {
        ...read(),
        sync: {
          ...read().sync,
          status: "error" as const,
          lastFinishedAt: new Date().toISOString(),
          message:
            error instanceof Error
              ? error.message
              : "Error sincronizando productos",
        },
      };
      save(failed);
      throw error;
    } finally {
      syncing = false;
    }
  };
  const detail = async (productId: number) =>
    withOdoo(async (kw) => {
      if (!Number.isInteger(productId) || productId <= 0)
        throw new Error("Producto no válido");
      const [product] = await kw("product.product", "read", [[productId]], {
        fields: [
          "id",
          "display_name",
          "default_code",
          "barcode",
          "image_128",
          "product_tmpl_id",
        ],
      });
      if (!product) throw new Error("Producto no encontrado en Odoo");
      const templateId = relationId(product.product_tmpl_id);
      const suppliers = templateId
        ? await kw(
            "product.supplierinfo",
            "search_read",
            [[["product_tmpl_id", "=", templateId]]],
            {
              fields: [
                "partner_id",
                "product_name",
                "product_code",
                "min_qty",
                "delay",
              ],
              limit: 100,
            },
          )
        : [];
      // Prefer a BOM linked directly to this variant; otherwise use its template BOM.
      const boms = await kw(
        "mrp.bom",
        "search_read",
        [[["active", "=", true], "|", ["product_id", "=", productId], ["product_tmpl_id", "=", templateId || false]]],
        { fields: ["id", "product_id", "bom_line_ids", "sequence"], order: "sequence asc, id asc", limit: 20 },
      );
      const bom = boms.find((item: any) => relationId(item.product_id) === productId) || boms[0];
      const lines = bom?.bom_line_ids?.length
        ? await kw("mrp.bom.line", "read", [bom.bom_line_ids], {
            fields: ["product_id", "product_qty", "product_uom_id", "sequence"],
          })
        : [];
      const componentIds = [...new Set(lines.map((line: any) => relationId(line.product_id)).filter(Boolean))] as number[];
      const componentProducts = componentIds.length
        ? await kw("product.product", "read", [componentIds], {
            fields: ["id", "display_name", "name", "default_code"],
          })
        : [];
      const componentById = new Map(componentProducts.map((item: any) => [item.id, item]));
      return {
        id: product.id,
        name: clean(product.display_name),
        reference: clean(product.default_code),
        barcode: clean(product.barcode),
        image: clean(product.image_128),
        suppliers: suppliers.map((supplier: any) => ({
          name: relationName(supplier.partner_id),
          productName: clean(supplier.product_name),
          productCode: clean(supplier.product_code),
          minQty: Number(supplier.min_qty || 0),
          delay: Number(supplier.delay || 0),
        })),
        components: lines
          .sort((a: any, b: any) => Number(a.sequence || 0) - Number(b.sequence || 0))
          .map((line: any) => {
            const id = relationId(line.product_id);
            const component = id ? componentById.get(id) : undefined;
            return {
              id: id || 0,
              name: component ? catalogName(component) : relationName(line.product_id),
              reference: clean(component?.default_code),
              quantity: Number(line.product_qty || 0),
              uom: relationName(line.product_uom_id),
            };
          })
          .filter((component: { id: number }) => component.id > 0),
      };
    });
  const images = async (ids: number[]) =>
    withOdoo(async (kw) => {
      const validIds = [
        ...new Set(ids.filter((id) => Number.isInteger(id) && id > 0)),
      ].slice(0, 60);
      const products = validIds.length
        ? await kw("product.product", "read", [validIds], {
            fields: ["id", "image_128"],
          })
        : [];
      return Object.fromEntries(
        products
          .filter((p: any) => clean(p.image_128))
          .map((p: any) => [p.id, clean(p.image_128)]),
      );
    });
  const updateBarcode = async (productId: number, barcode: unknown) =>
    withOdoo(async (kw) => {
      const id = Number(productId);
      const value = clean(barcode);
      if (!Number.isInteger(id) || id <= 0 || !value)
        throw new Error("Producto o EAN inválido");
      const [product] = await kw("product.product", "read", [[id]], {
        fields: ["id", "display_name", "default_code", "barcode"],
      });
      if (!product) throw new Error("Producto no encontrado en Odoo");
      const duplicates = await kw(
        "product.product",
        "search_read",
        [
          [
            ["barcode", "=", value],
            ["id", "!=", id],
          ],
        ],
        { fields: ["id", "display_name", "default_code"], limit: 1 },
      );
      if (duplicates.length)
        throw new Error(
          `El EAN ya está asignado a ${catalogName(duplicates[0]) || clean(duplicates[0].default_code) || `producto ${duplicates[0].id}`}`,
        );
      await kw("product.product", "write", [[id], { barcode: value }]);
      const store = read();
      const index = store.products.findIndex((item) => item.id === id);
      if (index >= 0) {
        store.products[index] = {
          ...store.products[index],
          barcode: value,
          updatedAt: new Date().toISOString(),
        };
        store.updatedAt = new Date().toISOString();
        save(store);
      }
      return {
        id,
        name: catalogName(product),
        reference: clean(product.default_code),
        barcode: value,
      };
    });
  return { list: () => read(), sync, detail, images, updateBarcode };
}
