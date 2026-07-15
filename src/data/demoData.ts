import type { Invoice, Order, Product, Purchase, StatusTone } from '../services/odooTypes';

export const orders: Order[] = [
  {
    id: 'SO-240618',
    odooRef: 'S240618',
    date: '2026-06-07',
    client: 'Clínica Dental Alameda',
    channel: 'Odoo',
    deliveryPrinted: true,
    total: 1842.5,
    status: 'Pendiente de preparar',
    invoiceStatus: 'Sin factura',
    deliveryStatus: 'Albarán reservado',
    city: 'Valencia',
    items: [
      { sku: 'MED-GLV-NIT-M', name: 'Guantes nitrilo azul M', quantity: 20, price: 7.9, stock: 142 },
      { sku: 'DIS-INF-5L', name: 'Desinfectante superficies 5L', quantity: 12, price: 18.75, stock: 26 },
      { sku: 'PAP-CAM-60', name: 'Papel camilla 60 cm', quantity: 30, price: 11.2, stock: 52 },
    ],
  },
  {
    id: 'SO-240617',
    odooRef: 'S240617',
    date: '2026-06-07',
    client: 'Centro Fisio Norte',
    channel: 'Web B2B',
    deliveryPrinted: false,
    total: 634.8,
    status: 'Confirmado',
    invoiceStatus: 'Borrador',
    deliveryStatus: 'Pendiente stock',
    city: 'Madrid',
    items: [
      { sku: 'VEN-ELAS-10', name: 'Venda elastica 10 cm', quantity: 40, price: 3.6, stock: 11 },
      { sku: 'GEL-US-5L', name: 'Gel ultrasonidos 5L', quantity: 10, price: 14.5, stock: 8 },
    ],
  },
  {
    id: 'SO-240616',
    odooRef: 'S240616',
    date: '2026-06-06',
    client: 'Residencia El Pinar',
    channel: 'Comercial',
    deliveryPrinted: true,
    total: 3210.35,
    status: 'Listo para facturar',
    invoiceStatus: 'Pendiente emitir',
    deliveryStatus: 'Entregado',
    city: 'Sevilla',
    items: [
      { sku: 'EMP-ABS-90', name: 'Empapador absorbente 90x60', quantity: 160, price: 6.25, stock: 310 },
      { sku: 'BAT-QUI-L', name: 'Bata quirurgica L', quantity: 85, price: 9.8, stock: 94 },
    ],
  },
  {
    id: 'SO-240615',
    odooRef: 'S240615',
    date: '2026-06-06',
    client: 'Hospital San Roque',
    channel: 'Odoo',
    deliveryPrinted: false,
    total: 528.2,
    status: 'Bloqueado',
    invoiceStatus: 'Sin factura',
    deliveryStatus: 'Stock insuficiente',
    city: 'Alicante',
    items: [
      { sku: 'SON-ASP-CH12', name: 'Sonda aspiracion CH12', quantity: 50, price: 2.3, stock: 4 },
      { sku: 'MASC-FFP2', name: 'Mascarilla FFP2 blanca', quantity: 200, price: 0.62, stock: 84 },
    ],
  },
  {
    id: 'SO-240614',
    odooRef: 'S240614',
    date: '2026-06-05',
    client: 'DentalPro Levante',
    channel: 'Web B2B',
    deliveryPrinted: true,
    total: 1196.0,
    status: 'Facturado',
    invoiceStatus: 'Pagada',
    deliveryStatus: 'Entregado',
    city: 'Castellon',
    items: [
      { sku: 'RES-COMP-A2', name: 'Composite dental A2', quantity: 24, price: 31.5, stock: 37 },
      { sku: 'AGU-DEN-30G', name: 'Aguja dental 30G', quantity: 18, price: 14.2, stock: 61 },
    ],
  },
  {
    id: 'SO-240613',
    odooRef: 'S240613',
    date: '2026-06-05',
    client: 'Clínica Santa Marta',
    channel: 'Marketplace',
    deliveryPrinted: false,
    total: 872.89,
    status: 'Confirmado',
    invoiceStatus: 'Sin factura',
    deliveryStatus: 'Albarán reservado',
    city: 'Murcia',
    items: [
      { sku: 'MASC-FFP2', name: 'Mascarilla FFP2 blanca', quantity: 120, price: 0.62, stock: 84 },
      { sku: 'DIS-INF-5L', name: 'Desinfectante superficies 5L', quantity: 10, price: 18.75, stock: 26 },
    ],
  },
  {
    id: 'SO-240612',
    odooRef: 'S240612',
    date: '2026-06-04',
    client: 'Centro Médico Bahía',
    channel: 'Comercial',
    deliveryPrinted: true,
    total: 2240.1,
    status: 'Entregado',
    invoiceStatus: 'Pendiente cobro',
    deliveryStatus: 'Entregado',
    city: 'Cadiz',
    items: [
      { sku: 'BAT-QUI-L', name: 'Bata quirurgica L', quantity: 60, price: 9.8, stock: 94 },
      { sku: 'EMP-ABS-90', name: 'Empapador absorbente 90x60', quantity: 80, price: 6.25, stock: 310 },
    ],
  },
  {
    id: 'SO-240611',
    odooRef: 'S240611',
    date: '2026-06-04',
    client: 'Dental Norte',
    channel: 'Odoo',
    deliveryPrinted: false,
    total: 456.75,
    status: 'Pendiente de preparar',
    invoiceStatus: 'Borrador',
    deliveryStatus: 'Pendiente impresión',
    city: 'Bilbao',
    items: [
      { sku: 'AGU-DEN-30G', name: 'Aguja dental 30G', quantity: 12, price: 14.2, stock: 61 },
      { sku: 'RES-COMP-A2', name: 'Composite dental A2', quantity: 8, price: 31.5, stock: 37 },
    ],
  },
  {
    id: 'SO-240610',
    odooRef: 'S240610',
    date: '2026-06-03',
    client: 'Residencia Mar Azul',
    channel: 'Web B2B',
    deliveryPrinted: true,
    total: 1488.0,
    status: 'Facturado',
    invoiceStatus: 'Pagada',
    deliveryStatus: 'Entregado',
    city: 'Malaga',
    items: [
      { sku: 'EMP-ABS-90', name: 'Empapador absorbente 90x60', quantity: 140, price: 6.25, stock: 310 },
    ],
  },
  {
    id: 'SO-240609',
    odooRef: 'S240609',
    date: '2026-06-03',
    client: 'Fisio Global',
    channel: 'Marketplace',
    deliveryPrinted: false,
    total: 315.4,
    status: 'Bloqueado',
    invoiceStatus: 'Sin factura',
    deliveryStatus: 'Stock insuficiente',
    city: 'Zaragoza',
    items: [
      { sku: 'GEL-US-5L', name: 'Gel ultrasonidos 5L', quantity: 16, price: 14.5, stock: 8 },
    ],
  },
  {
    id: 'SO-240608',
    odooRef: 'S240608',
    date: '2026-06-02',
    client: 'Hospital Vega Baja',
    channel: 'Odoo',
    deliveryPrinted: true,
    total: 2764.2,
    status: 'Entregado',
    invoiceStatus: 'Pendiente emitir',
    deliveryStatus: 'Entregado',
    city: 'Orihuela',
    items: [
      { sku: 'MED-GLV-NIT-M', name: 'Guantes nitrilo azul M', quantity: 180, price: 7.9, stock: 142 },
      { sku: 'MASC-FFP2', name: 'Mascarilla FFP2 blanca', quantity: 400, price: 0.62, stock: 84 },
    ],
  },
];

export const customerInvoices: Invoice[] = [
  { id: '1', ref: 'INV/2026/00428', date: '2026-06-07', partner: 'Residencia El Pinar', base: 2653.18, tax: 557.17, total: 3210.35, status: 'Pendiente cobro', dueDate: '2026-07-07' },
  { id: '2', ref: 'INV/2026/00427', date: '2026-06-05', partner: 'DentalPro Levante', base: 988.43, tax: 207.57, total: 1196.0, status: 'Pagada', dueDate: '2026-06-20' },
  { id: '3', ref: 'INV/2026/00426', date: '2026-06-04', partner: 'Clínica Santa Marta', base: 721.4, tax: 151.49, total: 872.89, status: 'Parcial', dueDate: '2026-06-19' },
  { id: '4', ref: 'INV/2026/00425', date: '2026-06-03', partner: 'Centro Fisio Norte', base: 502.25, tax: 105.47, total: 607.72, status: 'Vencida', dueDate: '2026-06-03' },
];

export const supplierInvoices: Invoice[] = [
  { id: '1', ref: 'BILL/2026/00112', date: '2026-06-06', partner: 'Suministros Medival', base: 1298.1, tax: 272.6, total: 1570.7, status: 'Pendiente pago', dueDate: '2026-06-21' },
  { id: '2', ref: 'BILL/2026/00111', date: '2026-06-05', partner: 'Iberclinic Distribución', base: 864.2, tax: 181.48, total: 1045.68, status: 'Validada', dueDate: '2026-07-05' },
  { id: '3', ref: 'BILL/2026/00110', date: '2026-06-01', partner: 'Dental Market Pro', base: 492.0, tax: 103.32, total: 595.32, status: 'Pagada', dueDate: '2026-06-16' },
];

export const purchases: Purchase[] = [
  { id: '1', ref: 'PO/2026/00186', supplier: 'Suministros Medival', expectedDate: '2026-06-10', products: 'Guantes nitrilo, mascarillas FFP2', amount: 2450.8, status: 'Confirmado' },
  { id: '2', ref: 'PO/2026/00185', supplier: 'Iberclinic Distribución', expectedDate: '2026-06-12', products: 'Gel ultrasonidos, vendas elasticas', amount: 1342.3, status: 'Pendiente recibir' },
  { id: '3', ref: 'PO/2026/00184', supplier: 'Dental Market Pro', expectedDate: '2026-06-14', products: 'Composite dental, agujas dentales', amount: 778.4, status: 'Borrador' },
  { id: '4', ref: 'PO/2026/00183', supplier: 'Logimed Europa', expectedDate: '2026-06-08', products: 'Sondas aspiracion CH12', amount: 610.0, status: 'Retrasado' },
];

export const products: Product[] = [
  { id: '1', sku: 'SON-ASP-CH12', name: 'Sonda aspiracion CH12', category: 'Hospitalario', stock: 4, reserved: 50, incoming: 200, cost: 1.18, lastPurchasePrice: 1.22, status: 'Crítico' },
  { id: '2', sku: 'GEL-US-5L', name: 'Gel ultrasonidos 5L', category: 'Fisioterapia', stock: 8, reserved: 10, incoming: 60, cost: 8.9, lastPurchasePrice: 9.15, status: 'Bajo stock' },
  { id: '3', sku: 'DIS-INF-5L', name: 'Desinfectante superficies 5L', category: 'Limpieza clínica', stock: 26, reserved: 12, incoming: 80, cost: 10.4, lastPurchasePrice: 10.1, status: 'Vigilancia' },
  { id: '4', sku: 'MED-GLV-NIT-M', name: 'Guantes nitrilo azul M', category: 'Consumible', stock: 142, reserved: 20, incoming: 400, cost: 4.55, lastPurchasePrice: 4.72, status: 'OK' },
  { id: '5', sku: 'RES-COMP-A2', name: 'Composite dental A2', category: 'Dental', stock: 37, reserved: 24, incoming: 24, cost: 20.1, lastPurchasePrice: null, status: 'Coste pendiente' },
];

export const statusTone = (status: string): StatusTone => {
  const value = status.toLowerCase();
  if (value.includes('pagada') || value.includes('ok') || value.includes('entregado')) return 'ok';
  if (value.includes('crítico') || value.includes('bloqueado') || value.includes('vencida') || value.includes('retrasado')) return 'danger';
  if (value.includes('pendiente') || value.includes('bajo') || value.includes('vigilancia') || value.includes('borrador')) return 'warning';
  if (value.includes('confirmado') || value.includes('validada') || value.includes('facturado')) return 'info';
  return 'neutral';
};

export const money = (value: number) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value);
