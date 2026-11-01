import QRCode from 'qrcode';
import type {DemoRexLabel} from '../../../backend/incidents/demoLabel';
/** A test artifact only: never printable as an actual carrier shipment. */
export async function downloadDemoRexLabel(label:DemoRexLabel){
 if(label.simulated!==true||!label.shipmentCode.startsWith('SIM-'))throw Error('No es una etiqueta de prueba DEMO');
 const {jsPDF}=await import('jspdf');const pdf=new jsPDF({unit:'mm',format:[100,150]});
 pdf.setFontSize(15);pdf.text('ETIQUETA SIMULADA',8,14);pdf.setFontSize(10);pdf.text('LAB / ODOO DEMO',8,23);pdf.text('SIN VALIDEZ PARA TRANSPORTE',8,31);
 pdf.line(8,36,92,36);pdf.setFontSize(11);pdf.text(label.reference,8,45);pdf.setFontSize(9);pdf.text(`Pedido: ${label.orderReference}`,8,53);pdf.text(`Picking: ${label.pickingId}`,8,60);pdf.text(pdf.splitTextToSize(`Operario: ${label.operator} (${label.operatorCode})`,82),8,67);
 const qr=await QRCode.toDataURL(label.reference,{margin:1,width:200});pdf.addImage(qr,'PNG',30,84,40,40);pdf.setFontSize(7);pdf.text(label.shipmentCode,8,132);pdf.text('Sin agencia ni seguimiento reales.',8,140);
 pdf.save(label.shipmentCode+'.pdf');
}
