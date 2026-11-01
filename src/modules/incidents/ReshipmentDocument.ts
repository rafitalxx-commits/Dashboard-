import {incidentReshipmentDocument,reshipmentReference} from '../../../backend/incidents/reshipment';
import QRCode from 'qrcode';
import type {Incident} from '../../../backend/incidents/types';
import type {reshipmentPrintData} from '../../../backend/incidents/reshipment';
import {api} from './api';
type RexSlip=Awaited<ReturnType<typeof reshipmentPrintData>>;
async function productPhoto(productId:number):Promise<string|undefined>{
 try{
  const response=await fetch(`${import.meta.env.BASE_URL}api/incidents/product-image?id=${productId}`,{signal:AbortSignal.timeout(10000)});if(!response.ok)return;
  const url=URL.createObjectURL(await response.blob());try{const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d');if(!ctx)return;ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0);return canvas.toDataURL('image/png');}finally{URL.revokeObjectURL(url);}
 }catch{return undefined;}
}
/** Order-style packing slip: exact REX lines, shipping destination and product photographs. */
export async function downloadReshipmentDocumentByReference(reference:string,asFile=false,localData?:RexSlip):Promise<File|undefined>{
 const data=localData||(await api<{document:RexSlip}>(`/reshipments/${encodeURIComponent(reference)}/document`)).document;if(data.reference!==reference)throw Error('El albarán devuelto no corresponde al REX');
 const photos=await Promise.all(data.lines.map(line=>productPhoto(line.productId)));const {jsPDF}=await import('jspdf');const pdf=new jsPDF({unit:'mm',format:'a4'});
 const text=(value:string,x:number,y:number,size=10)=>{pdf.setFontSize(size);pdf.setTextColor('#243449');pdf.text(value,x,y);};
 if(data.test){pdf.setFillColor('#fff4dd');pdf.rect(16,8,178,8,'F');text('PRUEBA LAB / ODOO DEMO - NO EXPEDIR',20,13.5,8);}
 pdf.setFont('helvetica','bold');text('ALBARAN',18,29,23);pdf.setFont('helvetica','normal');
 text(`Pedido: ${data.orderReference}`,111,23,10);text(`Incidencia: ${data.incidentId}`,111,30,10);text(`Reexpedicion: ${data.reference}`,111,37,10);text(`Fecha: ${new Date(data.createdAt).toLocaleDateString('es-ES')}`,18,40,9);
 pdf.setDrawColor('#d8e2eb');pdf.line(18,49,192,49);text('DESTINATARIO DE ENVIO',18,57,8);pdf.setFont('helvetica','bold');text(pdf.splitTextToSize(data.destination.name,125) as any,18,65,12);pdf.setFont('helvetica','normal');
 const address=[data.destination.address,[data.destination.postalCode,data.destination.city].filter(Boolean).join(' '),data.destination.country,data.destination.phone,data.destination.email].filter(Boolean);let y=65+pdf.splitTextToSize(data.destination.name,125).length*6+3;
 for(const value of address){const lines=pdf.splitTextToSize(String(value),125);text(lines as any,18,y,10);y+=lines.length*5;}
 if(data.pickingName)text(`Odoo: ${data.pickingName}`,111,44,9);
 const qr=await QRCode.toDataURL(data.reference,{margin:1,width:220,errorCorrectionLevel:'M'});pdf.addImage(qr,'PNG',155,54,35,35);text('Escanear REX',159,94,8);y=Math.max(y+10,107);
 const header=()=>{pdf.setFillColor('#eef3f8');pdf.rect(18,y,174,9,'F');text('Imagen',21,y+6,9);text('Codigo',50,y+6,9);text('Descripcion',90,y+6,9);text('Cantidad',174,y+6,9);y+=11;};header();
 for(let n=0;n<data.lines.length;n++){
  const line=data.lines[n],description=pdf.splitTextToSize(line.name,77),sku=pdf.splitTextToSize(line.sku,34),height=Math.max(31,description.length*5+9,sku.length*5+9);
  if(y+height>270){pdf.addPage();y=20;text(`${data.reference} - ${data.incidentId}`,18,y,10);y+=8;header();}
  if(photos[n]){const image=pdf.getImageProperties(photos[n]!);const scale=Math.min(23/image.width,23/image.height);const w=image.width*scale,h=image.height*scale;pdf.addImage(photos[n]!,'PNG',21+(23-w)/2,y+3+(23-h)/2,w,h);}else {pdf.setDrawColor('#d8e2eb');pdf.rect(21,y+3,23,23);text('Sin imagen',23,y+16,7);}
  pdf.setFont('helvetica','bold');text(sku as any,50,y+10,9);pdf.setFont('helvetica','normal');text(description as any,90,y+10,9);pdf.setFont('helvetica','bold');text(String(line.quantity),179,y+13,13);pdf.setFont('helvetica','normal');y+=height;pdf.setDrawColor('#d8e2eb');pdf.line(18,y,192,y);
 }
 for(let page=1;page<=pdf.getNumberOfPages();page++){pdf.setPage(page);text(`${data.reference} | ${data.incidentId} | ${page}/${pdf.getNumberOfPages()}`,18,281,8);text('Documento de preparacion. No es etiqueta de agencia ni acredita entrega.',18,287,8);}
 if(asFile)return new File([pdf.output('blob')],`${reference}.pdf`,{type:'application/pdf'});pdf.save(`${reference}.pdf`);
}
export async function downloadReshipmentDocument(i:Incident,asFile=false,operationKey?:string):Promise<File|undefined>{
 const ops=(i.odooOperations||[]).filter(op=>op.kind==='reshipment'&&op.dispatchReference&&op.lines?.length&&(!operationKey||op.key===operationKey));if(ops.length>1)throw Error('Selecciona el albarán REX');
 // Once Odoo has confirmed a picking, print from that exact audited picking.
 // Do not rebuild it from the original incident: its auxiliary process can be
 // absent even though the journal contains a valid REX operation.
 if(ops[0]?.dispatchReference)return downloadReshipmentDocumentByReference(ops[0].dispatchReference,asFile);
 if(i.order.shippingDestination)return downloadReshipmentDocumentByReference(reshipmentReference(i.id),asFile,incidentReshipmentDocument(i,i.documentPreparation?.target||i.odooOperations?.find(op=>op.kind==='reshipment')?.target));
 return downloadReshipmentDocumentByReference(reshipmentReference(i.id),asFile);
}
