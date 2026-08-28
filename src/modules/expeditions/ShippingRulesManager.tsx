import { useEffect, useMemo, useState } from "react";
import { CircleAlert, Copy, MoreVertical, PlayCircle, Plus, Search, Trash2, X } from "lucide-react";
import { odooClient } from "../../services/odooClient";
import type { Order } from "../../services/odooTypes";

type ProductCondition = { operator: "contains" | "not_contains"; value: string };
type PostalCodeCondition = { operator: "matches" | "not_matches"; value: string };
type ShippingRule = {
  id: string;
  name: string;
  active: boolean;
  priority: number;
  isDefault: boolean;
  forceCarrier: boolean;
  carrier: string;
  service: string;
  conditions: {
    channels?: string[];
    countries?: string[];
    postalCode?: PostalCodeCondition | null;
    postalCodeStartsWith?: string;
    weightFromKg?: number | null;
    weightToKg?: number | null;
    product?: ProductCondition | null;
    shippingMethods?: string[];
  };
};
type ShippingRuleCatalogs = {
  channels: string[];
  carriers: Array<{ id: string; label: string; services: Array<{ id: string; label: string }> }>;
  countries: Array<{ code: string; label: string }>;
};
type ShippingRulesStore = { rules: ShippingRule[]; catalogs: ShippingRuleCatalogs };
type RuleEvaluation = { ruleId: string; ruleName: string; priority: number; matched: boolean; forced: boolean; reasons: string[]; carrier: string; service: string };
type RuleResolution = { appliedRule: ShippingRule | null; carrier: string; service: string; usedDefault: boolean; evaluations: RuleEvaluation[] };
type RuleDraft = ShippingRule & { isNew?: boolean };

const emptyStore: ShippingRulesStore = { rules: [], catalogs: { channels: [], carriers: [], countries: [] } };

export function ShippingRulesManager() {
  const [store, setStore] = useState<ShippingRulesStore>(emptyStore);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [carrierFilter, setCarrierFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [openMenuId, setOpenMenuId] = useState("");
  const [editingRule, setEditingRule] = useState<RuleDraft | null>(null);
  const [originalRule, setOriginalRule] = useState<RuleDraft | null>(null);
  const [diagnosticRef, setDiagnosticRef] = useState("");
  const [diagnosticOrder, setDiagnosticOrder] = useState<Order | null>(null);
  const [diagnostic, setDiagnostic] = useState<RuleResolution | null>(null);

  const loadRules = async () => {
    const response = await fetch("/api/shipping/rules");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "No se pudieron leer las reglas");
    setStore(payload as ShippingRulesStore);
  };

  useEffect(() => {
    loadRules().catch((error) => setNotice(error instanceof Error ? error.message : "No se pudieron cargar las reglas"));
  }, []);

  const visibleRules = useMemo(() => {
    const filtered = store.rules.filter((rule) => {
      const text = searchableRuleText(rule, store.catalogs);
      if (query && !text.includes(query.toLowerCase())) return false;
      if (carrierFilter && rule.carrier !== carrierFilter) return false;
      if (channelFilter && !(rule.conditions.channels || []).includes(channelFilter)) return false;
      if (countryFilter && !(rule.conditions.countries || []).includes(countryFilter)) return false;
      if (statusFilter === "active" && !rule.active) return false;
      if (statusFilter === "inactive" && rule.active) return false;
      return true;
    });
    return filtered.sort((left, right) => Number(left.isDefault) - Number(right.isDefault) || right.priority - left.priority);
  }, [carrierFilter, channelFilter, countryFilter, query, statusFilter, store.catalogs, store.rules]);

  const openEditor = (rule: ShippingRule) => {
    setOpenMenuId("");
    const draft = structuredClone(rule) as RuleDraft;
    setEditingRule(draft);
    setOriginalRule(draft);
  };

  const openNewRule = () => {
    const draft: RuleDraft = {
      id: "",
      name: "Nueva regla",
      active: true,
      priority: 10,
      isDefault: false,
      forceCarrier: false,
      carrier: "",
      service: "",
      conditions: {},
      isNew: true,
    };
    setEditingRule(draft);
    setOriginalRule(draft);
  };

  const closeEditor = () => {
    if (editingRule && originalRule && JSON.stringify(editingRule) !== JSON.stringify(originalRule) && !window.confirm("Hay cambios sin guardar. ¿Quieres salir sin guardarlos?")) return;
    setEditingRule(null);
    setOriginalRule(null);
  };

  const saveRule = async () => {
    if (!editingRule) return;
    setSaving(true);
    try {
      const response = await fetch(editingRule.isNew ? "/api/shipping/rules" : `/api/shipping/rules/${encodeURIComponent(editingRule.id)}`, {
        method: editingRule.isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingRule),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "No se pudo guardar la regla");
      setStore(payload.store);
      setNotice(`Regla "${payload.rule.name}" guardada correctamente.`);
      setEditingRule(null);
      setOriginalRule(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo guardar la regla");
    } finally {
      setSaving(false);
    }
  };

  const toggleRule = async (rule: ShippingRule) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/shipping/rules/${encodeURIComponent(rule.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...rule, active: !rule.active }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "No se pudo cambiar el estado");
      setStore(payload.store);
      setNotice(payload.rule.active ? "Regla activada correctamente." : "Regla desactivada correctamente.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo cambiar el estado");
    } finally {
      setSaving(false);
    }
  };

  const duplicateRule = async (rule: ShippingRule) => {
    const response = await fetch(`/api/shipping/rules/${encodeURIComponent(rule.id)}/duplicate`, { method: "POST" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "No se pudo duplicar la regla");
    setStore(payload.store);
    setNotice(`Regla "${rule.name}" duplicada como copia inactiva.`);
  };

  const deleteRule = async (rule: ShippingRule) => {
    if (rule.isDefault) return;
    if (!window.confirm(`¿Seguro que quieres eliminar la regla '${rule.name}'?`)) return;
    const response = await fetch(`/api/shipping/rules/${encodeURIComponent(rule.id)}`, { method: "DELETE" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "No se pudo eliminar la regla");
    setStore(payload.store);
    setNotice(`Regla "${rule.name}" eliminada.`);
  };

  const diagnoseRule = async (rule?: ShippingRule) => {
    setOpenMenuId("");
    if (!diagnosticRef.trim()) {
      setNotice("Indica un pedido en PROBAR REGLAS antes de lanzar el diagnostico.");
      return;
    }
    await diagnose(rule);
  };

  const diagnose = async (focusRule?: ShippingRule) => {
    setSaving(true);
    try {
      const detail = await odooClient.getOrderDetail(diagnosticRef);
      if (!detail.order) throw new Error("Pedido no encontrado");
      setDiagnosticOrder(detail.order);
      const response = await fetch("/api/shipping/rules/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: mapOrderForRules(detail.order) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "No se pudo probar reglas");
      if (focusRule) payload.evaluations = payload.evaluations.filter((evaluation: RuleEvaluation) => evaluation.ruleId === focusRule.id);
      setDiagnostic(payload);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo probar reglas");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="settings-demo shipping-rules-manager">
      <div className="settings-demo-head shipping-rules-topbar">
        <div>
          <span>MOTOR DE REGLAS</span>
          <h3>Reglas de transporte</h3>
          <p>Lista compacta. Edita una sola regla cada vez desde el panel lateral.</p>
        </div>
        <button className="primary-action" disabled={saving} onClick={openNewRule} type="button"><Plus size={16} /> Nueva regla</button>
      </div>

      <div className="shipping-rule-filters">
        <label><Search size={15} /> Buscar<input onChange={(event) => setQuery(event.target.value)} value={query} /></label>
        <label>Transportista<select onChange={(event) => setCarrierFilter(event.target.value)} value={carrierFilter}><option value="">Todos</option>{store.catalogs.carriers.map((carrier) => <option key={carrier.id} value={carrier.id}>{carrier.label}</option>)}</select></label>
        <label>Canal<select onChange={(event) => setChannelFilter(event.target.value)} value={channelFilter}><option value="">Todos</option>{store.catalogs.channels.map((channel) => <option key={channel} value={channel}>{channel}</option>)}</select></label>
        <label>Pais<select onChange={(event) => setCountryFilter(event.target.value)} value={countryFilter}><option value="">Todos</option>{store.catalogs.countries.map((country) => <option key={country.code} value={country.code}>{country.label}</option>)}</select></label>
        <label>Estado<select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}><option value="all">Todas</option><option value="active">Activas</option><option value="inactive">Inactivas</option></select></label>
      </div>

      {notice ? <div className="settings-demo-note"><CircleAlert size={16} /> {notice}</div> : null}

      <div className="shipping-rule-compact-list">
        {visibleRules.map((rule) => (
          <RuleRow
            catalogs={store.catalogs}
            disabled={saving}
            key={rule.id}
            menuOpen={openMenuId === rule.id}
            onDelete={() => void deleteRule(rule).catch((error) => setNotice(error.message))}
            onDuplicate={() => void duplicateRule(rule).catch((error) => setNotice(error.message))}
            onEdit={() => openEditor(rule)}
            onMenu={() => setOpenMenuId((current) => current === rule.id ? "" : rule.id)}
            onProbe={() => void diagnoseRule(rule)}
            onToggle={() => void toggleRule(rule)}
            rule={rule}
          />
        ))}
      </div>

      <div className="shipping-rule-diagnostic">
        <div className="settings-demo-head">
          <div><span>PROBAR REGLAS</span><h3>Diagnostico por pedido</h3></div>
          <div className="diagnostic-search">
            <input onChange={(event) => setDiagnosticRef(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void diagnose(); }} placeholder="S88466 / Amazon / Odoo" value={diagnosticRef} />
            <button className="primary-action" disabled={saving || !diagnosticRef.trim()} onClick={() => void diagnose()} type="button"><PlayCircle size={16} /> Probar reglas</button>
          </div>
        </div>
        <DiagnosticResult order={diagnosticOrder} resolution={diagnostic} />
      </div>

      {editingRule ? (
        <RuleDrawer
          catalogs={store.catalogs}
          disabled={saving}
          draft={editingRule}
          onCancel={closeEditor}
          onChange={setEditingRule}
          onDelete={() => editingRule.isNew ? closeEditor() : void deleteRule(editingRule).then(() => closeEditor()).catch((error) => setNotice(error.message))}
          onDuplicate={() => editingRule.isNew ? undefined : void duplicateRule(editingRule).then(() => closeEditor()).catch((error) => setNotice(error.message))}
          onSave={() => void saveRule()}
        />
      ) : null}
    </section>
  );
}

function RuleRow({ catalogs, disabled, menuOpen, onDelete, onDuplicate, onEdit, onMenu, onProbe, onToggle, rule }: {
  catalogs: ShippingRuleCatalogs;
  disabled: boolean;
  menuOpen: boolean;
  onDelete: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
  onMenu: () => void;
  onProbe: () => void;
  onToggle: () => void;
  rule: ShippingRule;
}) {
  const carrierLabel = carrierName(catalogs, rule.carrier);
  const serviceLabel = serviceName(catalogs, rule.carrier, rule.service);
  const conditionSummary = summarizeRule(rule, catalogs);
  const summary = rule.isDefault
    ? conditionSummary ? `Por defecto si ${conditionSummary}` : "Se aplica cuando ninguna otra regla coincide."
    : conditionSummary;
  return (
    <article className={`shipping-rule-row ${rule.active ? "active" : "inactive"} ${rule.isDefault ? "default" : ""}`} onClick={onEdit}>
      <div className="rule-priority-badge">P{rule.priority}</div>
      <div className="rule-row-main">
        <div className="rule-row-title"><strong>{rule.name}</strong>{rule.isDefault ? <span>Defecto</span> : null}</div>
        <p title={summary}>{summary || "Sin condiciones"}</p>
      </div>
      <div className="rule-row-carrier"><span>{carrierLabel}</span><strong>{serviceLabel || "Sin servicio"}</strong></div>
      <button className={`rule-switch ${rule.active ? "on" : ""}`} disabled={disabled} onClick={(event) => { event.stopPropagation(); onToggle(); }} type="button"><span /> {rule.active ? "Activa" : "Inactiva"}</button>
      <button className="secondary-action compact" onClick={(event) => { event.stopPropagation(); onEdit(); }} type="button">Editar</button>
      <div className="rule-actions-menu" onClick={(event) => event.stopPropagation()}>
        <button className="icon-action" onClick={onMenu} type="button" aria-label="Acciones de regla"><MoreVertical size={18} /></button>
        {menuOpen ? (
          <div className="rule-menu-popover">
            <button onClick={onEdit} type="button">Editar</button>
            <button disabled={rule.isDefault} onClick={onDuplicate} type="button">Duplicar</button>
            <button onClick={onProbe} type="button">Probar regla</button>
            <button onClick={onToggle} type="button">{rule.active ? "Desactivar" : "Activar"}</button>
            <button disabled={rule.isDefault} onClick={onDelete} type="button">Eliminar</button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function RuleDrawer({ catalogs, disabled, draft, onCancel, onChange, onDelete, onDuplicate, onSave }: {
  catalogs: ShippingRuleCatalogs;
  disabled: boolean;
  draft: RuleDraft;
  onCancel: () => void;
  onChange: (rule: RuleDraft) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onSave: () => void;
}) {
  const carrier = catalogs.carriers.find((item) => item.id === draft.carrier);
  const serviceOptions = carrier?.services || [];
  const patch = (patchValue: Partial<RuleDraft>) => onChange({ ...draft, ...patchValue });
  const patchConditions = (conditions: Partial<ShippingRule["conditions"]>) => patch({ conditions: { ...draft.conditions, ...conditions } });
  const postalCode = draft.conditions.postalCode ?? (draft.conditions.postalCodeStartsWith ? { operator: "matches", value: draft.conditions.postalCodeStartsWith } : null);

  return (
    <div className="rule-drawer-backdrop">
      <aside className="rule-drawer" role="dialog" aria-label="Editar regla de transporte">
        <header>
          <div><span>EDITAR REGLA</span><h3>{draft.isNew ? "Nueva regla" : draft.name}</h3></div>
          <button className="icon-action" onClick={onCancel} type="button" aria-label="Cerrar"><X size={20} /></button>
        </header>
        <div className="rule-drawer-fields">
          <label>Prioridad<input disabled={disabled || draft.isDefault} inputMode="numeric" onChange={(event) => patch({ priority: Number(event.target.value) || 0 })} value={draft.priority} /></label>
          <label>Nombre<input disabled={disabled} onChange={(event) => patch({ name: event.target.value })} value={draft.name} /></label>
          <MultiSelect label="Canal" options={catalogs.channels.map((channel) => ({ value: channel, label: channel }))} values={draft.conditions.channels || []} onChange={(channels) => patchConditions({ channels })} />
          <MultiSelect label="Pais" options={catalogs.countries.map((country) => ({ value: country.code, label: country.label }))} values={draft.conditions.countries || []} onChange={(countries) => patchConditions({ countries })} />
          <label>Codigo postal operador<select disabled={disabled} onChange={(event) => patchConditions({ postalCode: { operator: event.target.value as PostalCodeCondition["operator"], value: postalCode?.value || "" }, postalCodeStartsWith: "" })} value={postalCode?.operator || "matches"}><option value="matches">Coincide con</option><option value="not_matches">No coincide con</option></select></label>
          <label>Codigo postal patron<input disabled={disabled} onChange={(event) => patchConditions({ postalCode: event.target.value ? { operator: postalCode?.operator || "matches", value: event.target.value } : null, postalCodeStartsWith: "" })} placeholder="03, 03*, 07*, 35*, 38*" value={postalCode?.value || ""} /></label>
          <label>Peso desde<input disabled={disabled} inputMode="decimal" onChange={(event) => patchConditions({ weightFromKg: numericOrNull(event.target.value) })} value={draft.conditions.weightFromKg ?? ""} /></label>
          <label>Peso hasta<input disabled={disabled} inputMode="decimal" onChange={(event) => patchConditions({ weightToKg: numericOrNull(event.target.value) })} value={draft.conditions.weightToKg ?? ""} /></label>
          <label>Producto operador<select disabled={disabled} onChange={(event) => patchConditions({ product: { operator: event.target.value as ProductCondition["operator"], value: draft.conditions.product?.value || "" } })} value={draft.conditions.product?.operator || "contains"}><option value="contains">Contiene</option><option value="not_contains">No contiene</option></select></label>
          <label>Producto texto<input disabled={disabled} onChange={(event) => patchConditions({ product: event.target.value ? { operator: draft.conditions.product?.operator || "contains", value: event.target.value } : null })} placeholder="Cable, Gas, Ralerfresh RS..." value={draft.conditions.product?.value || ""} /></label>
          <label>Metodo de envio<input disabled={disabled} onChange={(event) => patchConditions({ shippingMethods: splitValues(event.target.value) })} placeholder="Next Day, Express..." value={(draft.conditions.shippingMethods || []).join(", ")} /></label>
          <label>Transportista<select disabled={disabled} onChange={(event) => { const nextCarrier = catalogs.carriers.find((item) => item.id === event.target.value); patch({ carrier: event.target.value, service: nextCarrier?.services[0]?.id || "" }); }} value={draft.carrier}><option value="">Sin seleccionar</option>{catalogs.carriers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label>Servicio<select disabled={disabled || !draft.carrier} onChange={(event) => patch({ service: event.target.value })} value={draft.service}><option value="">Sin seleccionar</option>{serviceOptions.map((service) => <option key={service.id} value={service.id}>{service.label}</option>)}</select></label>
          <label className="odoo-auto-validate"><input checked={draft.forceCarrier} disabled={disabled || draft.isDefault} onChange={(event) => patch({ forceCarrier: event.target.checked })} type="checkbox" /> Forzar transportista</label>
          <label className="odoo-auto-validate"><input checked={draft.active} disabled={disabled} onChange={(event) => patch({ active: event.target.checked })} type="checkbox" /> Regla activa</label>
        </div>
        <footer>
          <button className="primary-action" disabled={disabled} onClick={onSave} type="button">Guardar cambios</button>
          <button className="secondary-action" disabled={disabled} onClick={onCancel} type="button">Cancelar</button>
          <button className="secondary-action" disabled={disabled || draft.isNew || draft.isDefault} onClick={onDuplicate} type="button"><Copy size={15} /> Duplicar</button>
          <button className="secondary-action" disabled={disabled || draft.isNew || draft.isDefault} onClick={onDelete} type="button"><Trash2 size={15} /> Eliminar</button>
        </footer>
      </aside>
    </div>
  );
}

function MultiSelect({ label, onChange, options, values }: { label: string; onChange: (values: string[]) => void; options: Array<{ value: string; label: string }>; values: string[] }) {
  return <label>{label}<select multiple onChange={(event) => onChange(Array.from(event.currentTarget.selectedOptions).map((option) => option.value))} value={values}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function DiagnosticResult({ order, resolution }: { order: Order | null; resolution: RuleResolution | null }) {
  if (!resolution) return <div className="amazon-history-empty">Selecciona un pedido para ver que reglas se evaluan.</div>;
  const products = order?.items?.map((item) => item.name || item.sku).filter(Boolean) || [];
  return (
    <div className="diagnostic-result">
      <div className="diagnostic-order">
        <strong>Pedido {order?.id || order?.odooRef}</strong>
        <span>Canal: {order?.channel || "-"}</span><span>Pais: {order?.shippingCountryCode || "-"}</span><span>CP: {order?.shippingPostalCode || "-"}</span><span>Metodo envio: {(order as unknown as { shippingMethod?: string })?.shippingMethod || "-"}</span><span>Productos: {products.length ? products.join(" | ") : "-"}</span>
      </div>
      <div className="diagnostic-evaluations">
        {resolution.evaluations.map((evaluation) => <div className={evaluation.matched ? "matched" : "missed"} key={evaluation.ruleId}><b>{evaluation.matched ? "✓" : "✗"}</b><span>{evaluation.ruleName}</span><small>{evaluation.reasons.join(" · ") || "Sin condiciones"}</small></div>)}
      </div>
      <div className="rule-applied"><PlayCircle size={18} /><div><strong>{resolution.appliedRule ? `Regla aplicada: ${resolution.appliedRule.name}` : "No existe ninguna regla aplicable"}</strong><span>{resolution.appliedRule ? `${resolution.carrier} · ${resolution.service}${resolution.usedDefault ? " · regla por defecto" : ""}` : "Ningun transportista asignado para este pedido."}</span></div></div>
    </div>
  );
}

function summarizeRule(rule: ShippingRule, catalogs: ShippingRuleCatalogs) {
  const parts = [
    ...(rule.conditions.channels || []),
    ...(rule.conditions.countries || []).map((code) => countryName(catalogs, code)),
    postalCodeSummary(rule.conditions.postalCode, rule.conditions.postalCodeStartsWith),
    weightSummary(rule),
    productSummary(rule.conditions.product),
    ...(rule.conditions.shippingMethods || []),
  ].filter(Boolean);
  return parts.join(" · ");
}

function searchableRuleText(rule: ShippingRule, catalogs: ShippingRuleCatalogs) {
  return [rule.name, summarizeRule(rule, catalogs), carrierName(catalogs, rule.carrier), serviceName(catalogs, rule.carrier, rule.service), rule.conditions.product?.value, ...(rule.conditions.shippingMethods || [])].filter(Boolean).join(" ").toLowerCase();
}

function weightSummary(rule: ShippingRule) {
  const from = rule.conditions.weightFromKg;
  const to = rule.conditions.weightToKg;
  if (from === null && to === null || from === undefined && to === undefined) return "";
  return `Peso ${from ?? 0}-${to ?? "∞"} kg`;
}

function productSummary(condition?: ProductCondition | null) {
  if (!condition?.value) return "";
  return `Producto ${condition.operator === "not_contains" ? "no contiene" : "contiene"} "${condition.value}"`;
}

function postalCodeSummary(condition?: PostalCodeCondition | null, legacyStartsWith?: string) {
  const value = condition?.value || legacyStartsWith || "";
  if (!value) return "";
  return `CP ${condition?.operator === "not_matches" ? "no coincide con" : "coincide con"} ${value}`;
}

function carrierName(catalogs: ShippingRuleCatalogs, carrierId: string) {
  return catalogs.carriers.find((carrier) => carrier.id === carrierId)?.label || carrierId || "Sin transportista";
}

function serviceName(catalogs: ShippingRuleCatalogs, carrierId: string, serviceId: string) {
  return catalogs.carriers.find((carrier) => carrier.id === carrierId)?.services.find((service) => service.id === serviceId)?.label || serviceId;
}

function countryName(catalogs: ShippingRuleCatalogs, code: string) {
  return catalogs.countries.find((country) => country.code === code)?.label || code;
}

function mapOrderForRules(order: Order) {
  const anyOrder = order as Order & { shippingMethod?: string };
  return { id: order.id, odooRef: order.odooRef, externalRef: order.externalRef, channel: normalizeOrderChannel(order.channel), countryCode: order.shippingCountryCode, postalCode: order.shippingPostalCode, weightKg: undefined, shippingMethod: anyOrder.shippingMethod, items: order.items.map((item) => ({ sku: item.sku, name: item.name, quantity: item.quantity })) };
}

function normalizeOrderChannel(channel?: string) {
  const value = String(channel || "");
  if (/amazon/i.test(value)) return "Amazon";
  if (/prestashop|web|website|webside/i.test(value)) return "Webside";
  if (/odoo|sales/i.test(value)) return "Sales";
  return value || "Sales";
}

function numericOrNull(value: string) {
  const numeric = Number(value.replace(",", "."));
  return Number.isFinite(numeric) ? numeric : null;
}

function splitValues(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
