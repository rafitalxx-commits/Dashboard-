import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';

import {unidentifiedReturnProduct} from '../../../backend/incidents/merchandise';
import type { CustomerReturn } from '../../../backend/incidents/types';
export async function downloadReturnDocument(r:CustomerReturn,asFile=false):Promise<File|undefined>{
 const { jsPDF }=await import('jspdf');
 const pdf=new jsPDF({unit:'mm',format:'a4'});const link=new URL(window.location.href);link.hash=r.stockCorrection?'/incidencias?incident='+encodeURIComponent(r.incidentId):'/productos/recepciones?dev='+encodeURIComponent(r.id);
 const qr=await QRCode.toDataURL(link.toString(),{width:220,margin:1,errorCorrectionLevel:'M'});
 const barcode=document.createElement('canvas');JsBarcode(barcode,r.id,{format:'CODE128',displayValue:true,width:2,height:60,margin:8});
 pdf.setFontSize(22);pdf.text(r.stockCorrection?'Devolución correctiva de stock':'Albarán de devolución',18,22);pdf.setFontSize(24);pdf.text(r.id,18,38);pdf.setFontSize(11);pdf.text(`Pedido: ${r.orderReference}`,18,51);pdf.text(`Cliente: ${r.customerName}`,18,59);pdf.line(18,65,192,65);
 let y=76;for(const p of r.products){const actual=r.itemOverrides?.find(item=>item.expectedSku===p.sku);const text=actual?.mode==='catalog'?`${actual.product!.sku} · ${actual.product!.name} × ${actual.quantity}`:actual?.mode==='not_ours'?`Mercancía ajena: ${actual.description} × ${actual.quantity}`:unidentifiedReturnProduct(p)?'Producto pendiente de identificar en recepción':`${p.sku} · ${p.name} × ${p.expectedQuantity}`;const lines=pdf.splitTextToSize(text,172);if(y+lines.length*6>174){pdf.addPage();y=22;}pdf.text(lines,18,y);y+=lines.length*6+4;}
 if(y>155){pdf.addPage();y=22;}pdf.addImage(qr,'PNG',18,y,35,35);pdf.addImage(barcode.toDataURL('image/png'),'PNG',63,y,125,30);y+=48;
 pdf.setFontSize(14);pdf.text(r.stockCorrection?'Corrección interna':'Instrucciones para la devolución',18,y);y+=9;pdf.setFontSize(10.5);
 for(const text of (r.stockCorrection?['Corrección de una salida registrada en Odoo que no se envió físicamente.','Documento interno. No implica recogida ni devolución física del cliente.','El envío correcto se preparará en un albarán REX separado.']:['Incluya este documento dentro del paquete.','Embale bien el producto para evitar daños durante el transporte.','Si es posible, solicite al transportista un comprobante de recogida.','Si tiene cualquier duda o surge algún problema, responda por el mismo canal por el que inició esta incidencia o devolución.','Gracias por su colaboración.'])){const lines=pdf.splitTextToSize(text,172);pdf.text(lines,18,y);y+=lines.length*5+4;}
 if(asFile)return new File([pdf.output('blob')],`${r.id}.pdf`,{type:'application/pdf'});
 pdf.save(`${r.id}.pdf`);
}
