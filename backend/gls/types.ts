export type GlsFormat = "PDF" | "ZPL";

export type GlsShipmentInput = {
  reference: string;
  service: string;
  date?: string;
  cashOnDelivery?: number;
  destination: {
    name: string;
    address: string;
    town: string;
    province?: string;
    postalCode: string;
    countryCode: string;
    phone: string;
    mobile?: string;
    email: string;
    contact?: string;
    observations?: string;
  };
  packages: Array<{ weight: number }>;
  format?: GlsFormat;
};

export type GlsShipmentRecord = {
  reference: string;
  status: "pending" | "created" | "unknown" | "failed" | "cancel_pending" | "cancelled";
  tracking?: string;
  service: string;
  labelBase64?: string;
  labelFormat?: GlsFormat;
  createdAt: string;
  updatedAt: string;
  providerErrorMessage?: string;
};
