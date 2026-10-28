import {useState} from 'react';
import type {Incident,CatalogMatch} from '../../../backend/incidents/types';
import type {Action} from '../../../backend/incidents/workflow';
import {CatalogProductSearch} from './CatalogProductSearch';
import {Field,Message} from './components';
export function ReplacementEditor({incident,onAction,disabled}:{incident:Incident;onAction:(a:Action)=>Promise<void>;disabled:boolean}){
 const [product,setProduct]=useState<CatalogMatch|undefined>(incident.replacementProduct?.product);const [error,setError]=useState('');
 return <form className="cost-editor" onSubmit={e=>{e.preventDefault();setError('');const quantity=Number(new FormData(e.currentTarget).get('quantity'));void onAction({kind:'replacement',product,quantity}).catch(e=>setError(e.message));}}><h3>Producto alternativo del cambio</h3><p>No se volverá a enviar automáticamente el producto incompatible o comprado por error. Selecciona la alternativa y su cantidad.</p><fieldset disabled={disabled||incident.processes.some(p=>p.kind==='reshipment'&&p.state==='resolved')}><CatalogProductSearch value={product} onChange={setProduct} purpose="alternativo"/><Field label="Unidades del producto alternativo"><input name="quantity" type="number" min="0.001" step="any" required defaultValue={incident.replacementProduct?.quantity||1}/></Field><button className="btn" disabled={!product}>Guardar alternativa del cambio</button></fieldset>{error&&<Message error>{error}</Message>}{incident.replacementProduct&&<Message>Alternativa guardada: {incident.replacementProduct.product.sku} × {incident.replacementProduct.quantity}. El envío físico y el albarán Odoo siguen pendientes.</Message>}</form>;
}
