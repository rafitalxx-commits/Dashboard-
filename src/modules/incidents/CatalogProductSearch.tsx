import {useEffect,useState} from 'react';
import type {CatalogMatch} from '../../../backend/incidents/types';
import {api} from './api';
import {Field} from './components';
export function CatalogProductSearch({value,onChange,purpose='recibido',requiredSelection=false}:{value?:CatalogMatch;onChange:(v?:CatalogMatch)=>void;purpose?:'recibido'|'alternativo';requiredSelection?:boolean}){
 const [query,setQuery]=useState('');
 const [state,setState]=useState<{term:string;loading:boolean;products:CatalogMatch[];hasMore?:boolean;error?:string}>({term:'',loading:false,products:[]});
 const term=query.trim();
 useEffect(()=>{
  let active=true;
  if(term.length<2||value){setState({term,loading:false,products:[]});return;}
  setState({term,loading:true,products:[]});
  const timer=setTimeout(()=>{api<{products:CatalogMatch[];hasMore:boolean}>('/catalog?q='+encodeURIComponent(term)).then(result=>{if(active)setState({term,loading:false,...result});}).catch(e=>{if(active)setState({term,loading:false,products:[],error:e.message});});},300);
  return ()=>{active=false;clearTimeout(timer);};
 },[term,value]);
 const current=state.term===term;
 return <section className="w-catalog-search" aria-label={`Catálogo de productos ${purpose==='recibido'?'recibidos':'alternativos'}`}>
  {value?<div className="w-catalog-selected">{value.imageUrl?<img className="catalog-product-thumb" src={value.imageUrl} alt={`Imagen de catálogo: ${value.name}`} loading="lazy"/>:<span className="catalog-product-thumb catalog-product-placeholder" aria-label="Producto sin imagen de catálogo">▧</span>}<span><strong>{value.name}</strong><small>{value.sku}{value.barcode?` · EAN ${value.barcode}`:''}</small></span><button className="link" type="button" onClick={()=>{onChange(undefined);setQuery('');}}>Cambiar producto {purpose}</button></div>:<>
   <Field label={purpose==='recibido'?`Buscar producto recibido en catálogo${requiredSelection?'':' (opcional)'}`:'Buscar producto alternativo en catálogo'}><input type="search" maxLength={120} autoComplete="off" placeholder="Referencia, EAN o nombre" value={query} onChange={e=>setQuery(e.target.value)}/></Field>
   <div role="status" aria-live="polite">{term.length<2?'Escribe al menos 2 caracteres. Consulta el catálogo real de Odoo.':!current||state.loading?'Buscando en catálogo…':state.error?`No se pudo consultar el catálogo: ${state.error}`:state.products.length?`${state.products.length} resultados${state.hasMore?' · hay más, concreta la búsqueda':''}`:'Sin productos para esta búsqueda.'}</div>
   {current&&!state.loading&&!state.error&&state.products.length>0&&<ul className="w-catalog-results" aria-label="Resultados de catálogo">{state.products.map(p=><li key={p.productId}><button className="w-catalog-result" type="button" onClick={()=>{onChange(p);setQuery('');}}>{p.imageUrl?<img className="catalog-product-thumb" src={p.imageUrl} alt="" loading="lazy"/>:<span className="catalog-product-thumb catalog-product-placeholder" aria-hidden="true">▧</span>}<span><strong>{p.name}</strong><small>{p.sku}{p.barcode?` · EAN ${p.barcode}`:''}</small></span></button></li>)}</ul>}
  </>}
 </section>;
}
