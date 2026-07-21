type GeneiLoginResponse = {
  token?: string;
  message?: string;
};

export type GeneiAgency = {
  id_agencia: number;
  id_agencia_madre?: number;
  nombre_agencia: string;
  nombre_integracion_cliente?: string | null;
  nombre_completo_agencia?: string;
};

type GeneiEnvelope<T> = {
  status: number;
  message?: string;
  data?: T;
  errors?: string[];
};

export function createGeneiClient(env: Record<string, string>) {
  const baseUrl = (env.GENEI_API_BASE_URL || "https://apiv2.genei.es/api/v2").replace(/\/+$/, "");
  const username = env.GENEI_API_USERNAME || "";
  const password = env.GENEI_API_PASSWORD || "";
  let token: string | null = null;

  const configurationError = () => {
    if (!username || !password) throw new Error("Faltan las credenciales de Genei en el entorno del backend");
  };

  const login = async () => {
    configurationError();
    const response = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const body = (await response.json()) as GeneiLoginResponse;
    if (!response.ok || !body.token) throw new Error(body.message || "Genei no ha aceptado las credenciales");
    token = body.token;
    return token;
  };

  const request = async <T>(path: string, init: RequestInit = {}) => {
    const activeToken = token || await login();
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { Accept: "application/json", Authorization: `Bearer ${activeToken}`, ...init.headers },
    });
    const rawBody = await response.text();
    const body = (rawBody ? JSON.parse(rawBody) : { status: response.ok ? 1 : 0 }) as GeneiEnvelope<T>;
    if (response.status === 401 && token) {
      token = null;
      return request<T>(path, init);
    }
    if (!response.ok || body.status !== 1) {
      throw new Error(body.errors?.join(", ") || body.message || "Genei ha rechazado la solicitud");
    }
    return body.data;
  };

  const requestJson = async <T>(path: string, method: "POST", payload: unknown) =>
    request<T>(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

  return {
    async listAgencies() {
      return (await request<GeneiAgency[]>("/agencies")) || [];
    },
    async getUser() {
      return request<{ name?: string; dni?: string; address?: string; postalCode?: string; city?: string; country?: string; phone?: string; mail?: string }>("/users");
    },
    async quote(query: Record<string, unknown>) {
      const search = new URLSearchParams();
      Object.entries(query).forEach(([key, value]) => {
        if (value === undefined || value === "") return;
        if (Array.isArray(value)) {
          value.forEach((item, index) => {
            if (!item || typeof item !== "object") return;
            Object.entries(item as Record<string, unknown>).forEach(([field, fieldValue]) => {
              if (fieldValue !== undefined && fieldValue !== "") search.set(`${key}[${index}][${field}]`, String(fieldValue));
            });
          });
          return;
        }
        search.set(key, String(value));
      });
      return request<unknown[]>(`/agencies/prices?${search.toString()}`);
    },
    async createShipment(payload: unknown) {
      return requestJson<{ reference: string; transactionId: number; paymentUrl?: string; paymentUrlRest?: string }>("/shipments", "POST", payload);
    },
    async getPaymentToken() {
      return request<string>("/payments/token?pg=4");
    },
    async payTransaction(transactionId: number, paymentToken: string) {
      return request<unknown>(`/payments/pay/transactions/${transactionId}?payment_token=${encodeURIComponent(paymentToken)}`);
    },
    async getPdfLabel(shipmentCode: string) {
      return request<unknown>(`/shipments/${encodeURIComponent(shipmentCode)}/label?forceBase64=true&format=PDF`);
    },
    async getShipmentByExternalCode(externalShippingCode: string) {
      return request<unknown>(`/shipments/external/${encodeURIComponent(externalShippingCode)}`);
    },
    async getShipment(shipmentCode: string) {
      return request<unknown>(`/shipments/${encodeURIComponent(shipmentCode)}`);
    },
    async cancelShipment(shipmentCode: string) {
      return request<unknown>(`/shipments/${encodeURIComponent(shipmentCode)}`, { method: "DELETE" });
    },
    async unlinkShipment(shipmentId: string | number, externalShippingCode: string) {
      return request<unknown>(`/shipments/${encodeURIComponent(String(shipmentId))}/${encodeURIComponent(externalShippingCode)}`, { method: "DELETE" });
    },
  };
}
