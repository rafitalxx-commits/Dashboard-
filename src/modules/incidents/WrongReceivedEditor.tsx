import {canIdentifyWrongReceived} from '../../../backend/incidents/workflow';
import { useEffect,useState } from 'react';
import type { Incident,CatalogMatch } from '../../../backend/incidents/types';
import type { Action } from '../../../backend/incidents/workflow';
import { CatalogProductSearch } from './CatalogProductSearch';
import { Field,Message } from './components';
export function WrongReceivedEditor({incident,onAction,disabled}:{incident:Incident;onAction:(a:Action)=>Promise<void>;disabled:boolean}){
 const [product,setProduct]=useState<CatalogMatch|undefined>(incident.wrongReceivedProduct?{productId:incident.wrongReceivedProduct.productId||0,sku:incident.wrongReceivedProduct.sku,name:incident.wrongReceivedProduct.name||incident.wrongReceivedProduct.sku,barcode:incident.wrongReceivedProduct.barcode||''}:undefined);const [error,setError]=useState('');
 useEffect(()=>{const saved=incident.wrongReceivedProduct;setProduct(saved?{productId:saved.productId||0,sku:saved.sku,name:saved.name||saved.sku,barcode:saved.barcode||''}:undefined);},[incident.id,incident.wrongReceivedProduct?.productId,incident.wrongReceivedProduct?.sku]);
 const locked=disabled||!canIdentifyWrongReceived(incident);
 return <form className="cost-editor" onSubmit={e=>{e.preventDefault();setError('');const quantity=Number(new FormData(e.currentTarget).get('quantity'));void onAction({kind:'wrong_received',product,quantity}).catch(e=>setError(e.message));}}><h3>Identificar mercancía realmente expedida</h3><p>Antes de regularizar A y registrar la salida real de B, identifica B. No se deduce de las observaciones.</p><fieldset disabled={locked}><CatalogProductSearch value={product} onChange={setProduct}/><Field label="Unidades realmente expedidas del producto equivocado"><input key={`${incident.id}-${incident.wrongReceivedProduct?.quantity||1}`} name="quantity" type="number" min="0.001" step="any" required defaultValue={incident.wrongReceivedProduct?.quantity||1}/></Field><button className="btn" disabled={!product}>Guardar identificación del producto equivocado</button></fieldset>{incident.wrongReceivedProduct&&<Message>Identificado y guardado: {incident.wrongReceivedProduct.sku} · {incident.wrongReceivedProduct.name} × {incident.wrongReceivedProduct.quantity}. No implica movimiento Odoo.</Message>}{error&&<Message error>{error}</Message>}</form>;
}
