/** Label history is a volume denominator, not proof of a physical shipment. */
export function incidentVolumes(labels:Array<{tracking?:unknown;shipper?:unknown;operator?:unknown;user?:unknown;odooOrderRef?:unknown;orderRefs?:unknown[];externalOrderRef?:unknown}>,channel?:string){
 const operatorOrders=new Map<string,Set<string>>();const carrierShipments=new Map<string,Set<string>>();const shipments=new Set<string>();
 for(const label of labels){
  const tracking=String(label.tracking||'').trim();if(!tracking)continue;
  const carrier=String(label.shipper||'').trim();const key=carrier.toLowerCase()+':'+tracking;shipments.add(key);
  const operator=String(label.operator||label.user||'').trim();
  if(operator){const orders=operatorOrders.get(operator)||new Set<string>();
   const odooRefs=[label.odooOrderRef,...(label.orderRefs||[])].filter(Boolean).map(String);
   // An external alias of the same order is not another prepared order.
   const refs=odooRefs.length?odooRefs:label.externalOrderRef?[String(label.externalOrderRef)]:[];
   refs.forEach(ref=>orders.add(ref.trim()));operatorOrders.set(operator,orders);
  }
  if(carrier){const set=carrierShipments.get(carrier)||new Set<string>();set.add(key);carrierShipments.set(carrier,set);}
 }
 // The ledger has no verified channel mapping: do not fabricate channel rates.
 return {shipments:channel?null:shipments.size,operators:channel?{}:Object.fromEntries([...operatorOrders].map(([name,refs])=>[name,refs.size])),carriers:channel?{}:Object.fromEntries([...carrierShipments].map(([name,refs])=>[name,refs.size])),volumeScope:channel?'Sin denominadores de etiquetas para este canal: no existe correspondencia verificada':'Historial de etiquetas del rango; pedidos Odoo únicos por operario y tracking único por agencia. No acredita salida física'};
}
