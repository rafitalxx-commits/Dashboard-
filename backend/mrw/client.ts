import https from "node:https";
import { URL } from "node:url";

export type MrwServiceId =
  | "mrw-urgent-1900-expedition"
  | "mrw-urgent-1400-expedition"
  | "mrw-urgente"
  | "mrw-ecommerce";

export type MrwShipmentRequest = {
  reference: string;
  service: MrwServiceId | string;
  destination: {
    name: string;
    address: string;
    postalCode: string;
    town: string;
    province?: string;
    countryCode: string;
    phone: string;
    email?: string;
  };
  packages: Array<{ weight: number; length?: number; width?: number; height?: number }>;
  observations?: string;
};

export type MrwShipmentResult = {
  requestNumber: string;
  shipmentNumber: string;
  url: string;
  rawXml: string;
};

type MrwAuth = {
  franchiseCode: string;
  subscriberCode: string;
  departmentCode: string;
  username: string;
  password: string;
};

type MrwParty = {
  name: string;
  address: string;
  postalCode: string;
  town: string;
  province?: string;
  countryCode: string;
  phone: string;
  email?: string;
};

export function createMrwClient(env: Record<string, string>) {
  const baseUrl = (env.MRW_API_BASE_URL || "https://sagec-test.mrw.es/MRWEnvio.asmx").trim();
  const productionEnabled = env.MRW_PRODUCTION_ENABLED === "true";
  const auth: MrwAuth = {
    franchiseCode: env.MRW_CODIGO_FRANQUICIA || "",
    subscriberCode: env.MRW_CODIGO_ABONADO || "",
    departmentCode: env.MRW_CODIGO_DEPARTAMENTO || "",
    username: env.MRW_USERNAME || "",
    password: env.MRW_PASSWORD || "",
  };
  const sender = {
    name: env.MRW_SENDER_NAME || env.GENEI_SENDER_NAME || "",
    address: env.MRW_SENDER_ADDRESS || env.GENEI_SENDER_ADDRESS || "",
    postalCode: env.MRW_SENDER_POSTAL_CODE || env.GENEI_SENDER_POSTAL_CODE || "",
    town: env.MRW_SENDER_TOWN || env.GENEI_SENDER_TOWN || "",
    province: env.MRW_SENDER_PROVINCE || "",
    countryCode: env.MRW_SENDER_COUNTRY || env.GENEI_SENDER_COUNTRY || "ES",
    phone: env.MRW_SENDER_PHONE || env.GENEI_SENDER_PHONE || "",
  };
  const serviceCodes: Record<string, string> = {
    "mrw-urgent-1900-expedition": env.MRW_SERVICE_URGENT_1900_EXPEDITION_CODE || env.MRW_SERVICE_URGENTE_CODE || "0205",
    "mrw-urgent-1400-expedition": env.MRW_SERVICE_URGENT_1400_EXPEDITION_CODE || env.MRW_SERVICE_URGENTE_14_CODE || "0110",
    "mrw-urgente": env.MRW_SERVICE_URGENT_1900_EXPEDITION_CODE || env.MRW_SERVICE_URGENTE_CODE || "0205",
    "mrw-ecommerce": env.MRW_SERVICE_ECOMMERCE_CODE || "",
  };

  const assertConfigured = () => {
    const missing = [
      ["MRW_CODIGO_FRANQUICIA", auth.franchiseCode],
      ["MRW_CODIGO_ABONADO", auth.subscriberCode],
      ["MRW_USERNAME", auth.username],
      ["MRW_PASSWORD", auth.password],
      ["MRW_SENDER_NAME", sender.name],
      ["MRW_SENDER_ADDRESS", sender.address],
      ["MRW_SENDER_POSTAL_CODE", sender.postalCode],
      ["MRW_SENDER_TOWN", sender.town],
      ["MRW_SENDER_PHONE", sender.phone],
    ].filter(([, value]) => !value).map(([key]) => key);
    if (missing.length) throw new Error(`Falta configurar MRW: ${missing.join(", ")}`);
  };

  const postSoap = async (method: "TransmEnvio" | "TransmitirEnvio" | "EtiquetaEnvio" | "CancelarEnvio", xml: string) => {
    assertConfigured();
    assertProductionAllowed(baseUrl, productionEnabled);
    const { status, rawXml } = await postSoapHttp(baseUrl, method, xml);
    if (status < 200 || status >= 300 || /<soap:Fault|<soap12:Fault|<faultstring/i.test(rawXml)) {
      const detail = extractTag(rawXml, "faultstring") || extractTag(rawXml, "Mensaje") || stripXml(rawXml).slice(0, 500);
      if (/Runtime Error/i.test(detail)) {
        throw new Error(`MRW ${method} ha devuelto HTTP ${status}: error interno de MRW TEST sin detalle util. Revisar habilitacion SAGEC, credenciales, franquicia/abonado y codigo de servicio con MRW.`);
      }
      throw new Error(detail ? `MRW ${method} ha devuelto HTTP ${status}: ${detail}` : `MRW ${method} ha devuelto HTTP ${status}`);
    }
    const state = extractTag(rawXml, "Estado");
    const message = extractTag(rawXml, "Mensaje");
    if (state && state !== "1") throw new Error(message ? `MRW ${method}: ${message}` : `MRW ${method}: estado ${state}`);
    return rawXml;
  };

  return {
    status() {
      return {
        baseUrl,
        configured: Boolean(auth.franchiseCode && auth.subscriberCode && auth.username && auth.password),
        productionEndpoint: isProductionEndpoint(baseUrl),
        productionEnabled,
        services: [
          { id: "mrw-urgent-1900-expedition", label: "MRW Urgent 19:00 Expedition 0-80kg", code: serviceCodes["mrw-urgent-1900-expedition"] },
          { id: "mrw-urgent-1400-expedition", label: "MRW Urgent 14:00 Expedition", code: serviceCodes["mrw-urgent-1400-expedition"] },
          { id: "mrw-ecommerce", label: "Ecommerce", code: serviceCodes["mrw-ecommerce"] },
        ],
      };
    },
    buildShipmentXml(input: MrwShipmentRequest) {
      const serviceCode = serviceCodes[input.service] || input.service;
      if (!serviceCode) throw new Error(`Falta mapear el codigo MRW para el servicio ${input.service}`);
      return buildTransmEnvioXml(auth, sender, input, serviceCode);
    },
    async createShipment(input: MrwShipmentRequest): Promise<MrwShipmentResult> {
      const serviceCode = serviceCodes[input.service] || input.service;
      if (!serviceCode) throw new Error(`Falta mapear el codigo MRW para el servicio ${input.service}`);
      let rawXml = "";
      try {
        rawXml = await postSoap("TransmEnvio", buildTransmEnvioXml(auth, sender, input, serviceCode));
      } catch (error) {
        if (!isMrwInternalServerError(error)) throw error;
        rawXml = await postSoap("TransmitirEnvio", buildTransmitirEnvioXml(auth, input, serviceCode));
      }
      return {
        requestNumber: extractTag(rawXml, "NumeroSolicitud"),
        shipmentNumber: extractTag(rawXml, "NumeroEnvio") || extractTag(rawXml, "NumEnvio"),
        url: extractTag(rawXml, "Url"),
        rawXml,
      };
    },
    async getLabelPdf(shipmentNumber: string) {
      const rawXml = await postSoap("EtiquetaEnvio", buildEtiquetaEnvioXml(auth, shipmentNumber));
      return extractPdf(rawXml);
    },
    async cancelShipment(shipmentNumber: string) {
      const rawXml = await postSoap("CancelarEnvio", buildCancelarEnvioXml(auth, shipmentNumber));
      return { ok: true, rawXml };
    },
  };
}

function assertProductionAllowed(baseUrl: string, productionEnabled: boolean) {
  if (isProductionEndpoint(baseUrl) && !productionEnabled) {
    throw new Error("MRW produccion bloqueado: configura MRW_PRODUCTION_ENABLED=true solo despues de validacion y OK explicito.");
  }
}

function isProductionEndpoint(value: string) {
  return /sagec\.mrw\.es/i.test(value) && !/sagec-test\.mrw\.es/i.test(value);
}

function buildTransmitirEnvioXml(auth: MrwAuth, input: MrwShipmentRequest, serviceCode: string) {
  const weight = input.packages.reduce((total, parcel) => total + Number(parcel.weight || 0), 0).toFixed(2);
  return soapEnvelopeSwge(auth, `
    <TransmitirEnvio xmlns="http://www.mrw.es/">
      <request>
        <Fecha>${escapeXml(formatMrwDate(new Date()))}</Fecha>
        <Nombre>${escapeXml(input.destination.name)}</Nombre>
        <VerificacionDireccion>N</VerificacionDireccion>
        <Via>${escapeXml(input.destination.address)}</Via>
        <Direccion>${escapeXml(input.destination.address)}</Direccion>
        <NumeroDireccion></NumeroDireccion>
        <RestoDireccion></RestoDireccion>
        <CodigoPostal>${escapeXml(input.destination.postalCode)}</CodigoPostal>
        <Poblacion>${escapeXml(input.destination.town)}</Poblacion>
        <EnFranquicia>N</EnFranquicia>
        <SMSRecogida>N</SMSRecogida>
        <SMSEntrega>N</SMSEntrega>
        <Referencia>${escapeXml(input.reference)}</Referencia>
        <CorrelacionRef></CorrelacionRef>
        <Servicio>${escapeXml(serviceCode)}</Servicio>
        <Bultos>${input.packages.length || 1}</Bultos>
        <Kilos>${escapeXml(weight)}</Kilos>
        <Puentes></Puentes>
        <Nif></Nif>
        <Reembolso>N</Reembolso>
        <ComisionReembolso>N</ComisionReembolso>
        <ImporteReembolso></ImporteReembolso>
        <Mercancia></Mercancia>
        <ValorDeclarado></ValorDeclarado>
        <AtencionDe>${escapeXml(input.destination.name)}</AtencionDe>
        <Telefono>${escapeXml(input.destination.phone)}</Telefono>
        <Observaciones>${escapeXml(input.observations || input.destination.email || "")}</Observaciones>
        <EntregaPartirDe></EntregaPartirDe>
        <ConfirmacionInmediata>N</ConfirmacionInmediata>
        <Retorno>N</Retorno>
        <Gestion></Gestion>
        <EntregaSabado>N</EntregaSabado>
        <Entrega830>N</Entrega830>
        <CodigoPromocion></CodigoPromocion>
        <NumeroSobre></NumeroSobre>
        <Frecuencia></Frecuencia>
        <TipoNotificacion></TipoNotificacion>
        <Notificacion1></Notificacion1>
        <Notificacion2></Notificacion2>
        <MailSMS1></MailSMS1>
        <MailSMS2></MailSMS2>
        <TramoHorario></TramoHorario>
        <PortesDebidos>N</PortesDebidos>
        <Mascara_Tipos></Mascara_Tipos>
        <Mascara_Campos></Mascara_Campos>
        <Asistente>N</Asistente>
      </request>
    </TransmitirEnvio>
  `);
}

function buildTransmEnvioXml(auth: MrwAuth, sender: MrwParty, input: MrwShipmentRequest, serviceCode: string) {
  const weight = input.packages.reduce((total, parcel) => total + Number(parcel.weight || 0), 0).toFixed(2);
  return soapEnvelope(auth, `
    <TransmEnvio xmlns="http://www.mrw.es/">
      <request>
        <ModificaDatosEnvio>
          <NumeroEnvioOriginal></NumeroEnvioOriginal>
        </ModificaDatosEnvio>
        <DatosRecogida>${partyXml(sender, "pickup")}</DatosRecogida>
        <DatosEntrega>${partyXml(input.destination, "delivery")}</DatosEntrega>
        <DatosServicio>
          <Fecha>${escapeXml(formatMrwDate(new Date()))}</Fecha>
          <NumeroAlbaran></NumeroAlbaran>
          <Referencia>${escapeXml(input.reference)}</Referencia>
          <CorrelacionRef></CorrelacionRef>
          <EnFranquicia>N</EnFranquicia>
          <CodigoServicio>${escapeXml(serviceCode)}</CodigoServicio>
          <DescripcionServicio>${escapeXml(input.service)}</DescripcionServicio>
          <Frecuencia></Frecuencia>
          <CodigoPromocion></CodigoPromocion>
          <NumeroSobre></NumeroSobre>
          <Bultos>${input.packages.map((parcel, index) => bultoXml(parcel, index + 1, input.reference)).join("")}</Bultos>
          <NumeroBultos>${input.packages.length || 1}</NumeroBultos>
          <Peso>${escapeXml(weight)}</Peso>
          <NumeroPuentes></NumeroPuentes>
          <EntregaSabado>N</EntregaSabado>
          <Entrega830>N</Entrega830>
          <EntregaPartirDe></EntregaPartirDe>
          <Gestion></Gestion>
          <Retorno>N</Retorno>
          <CodigoServicioRetorno></CodigoServicioRetorno>
          <ConfirmacionInmediata>N</ConfirmacionInmediata>
          <Reembolso>N</Reembolso>
          <ImporteReembolso></ImporteReembolso>
          <TipoMercancia></TipoMercancia>
          <ValorDeclarado></ValorDeclarado>
          <ServicioEspecial></ServicioEspecial>
          <CodigoMoneda></CodigoMoneda>
          <ValorEstadistico></ValorEstadistico>
          <ValorEstadisticoEuros></ValorEstadisticoEuros>
          <Notificaciones></Notificaciones>
          <SeguroOpcional>
            <CodigoNaturaleza></CodigoNaturaleza>
            <CantidadBoletos></CantidadBoletos>
            <ValorAsegurado></ValorAsegurado>
          </SeguroOpcional>
          <TramoHorario></TramoHorario>
          <PortesDebidos>N</PortesDebidos>
          <Mascara_Tipos></Mascara_Tipos>
          <Mascara_Campos></Mascara_Campos>
          <Asistente>N</Asistente>
        </DatosServicio>
      </request>
    </TransmEnvio>
  `);
}

function buildEtiquetaEnvioXml(auth: MrwAuth, shipmentNumber: string) {
  return soapEnvelope(auth, `
    <GetEtiquetaEnvio xmlns="http://www.mrw.es/">
      <request>
        <NumeroEnvio>${escapeXml(shipmentNumber)}</NumeroEnvio>
        <SeparadorNumerosEnvio>;</SeparadorNumerosEnvio>
        <TipoEtiquetaEnvio>0</TipoEtiquetaEnvio>
        <ReportTopMargin>1100</ReportTopMargin>
        <ReportLeftMargin>650</ReportLeftMargin>
      </request>
    </GetEtiquetaEnvio>
  `);
}

function buildCancelarEnvioXml(auth: MrwAuth, shipmentNumber: string) {
  return soapEnvelope(auth, `
    <CancelarEnvio xmlns="http://www.mrw.es/">
      <request>
        <CancelaEnvio>
          <NumeroEnvioOriginal>${escapeXml(shipmentNumber)}</NumeroEnvioOriginal>
        </CancelaEnvio>
      </request>
    </CancelarEnvio>
  `);
}

function soapEnvelope(auth: MrwAuth, body: string) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header>
    <AuthInfo xmlns="http://www.mrw.es/">
      <CodigoFranquicia>${escapeXml(auth.franchiseCode)}</CodigoFranquicia>
      <CodigoAbonado>${escapeXml(auth.subscriberCode)}</CodigoAbonado>
      <CodigoDepartamento>${escapeXml(auth.departmentCode)}</CodigoDepartamento>
      <UserName>${escapeXml(auth.username)}</UserName>
      <Password>${escapeXml(auth.password)}</Password>
    </AuthInfo>
  </soap:Header>
  <soap:Body>${body}</soap:Body>
</soap:Envelope>`;
}

function soapEnvelopeSwge(auth: MrwAuth, body: string) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header>
    <AuthInfoSWGE xmlns="http://www.mrw.es/">
      <Cliente>${escapeXml(auth.subscriberCode)}</Cliente>
      <Password>${escapeXml(auth.password)}</Password>
      <Departamento>${escapeXml(auth.departmentCode)}</Departamento>
      <Franquicia>${escapeXml(auth.franchiseCode)}</Franquicia>
      <Usuario>${escapeXml(auth.username)}</Usuario>
    </AuthInfoSWGE>
  </soap:Header>
  <soap:Body>${body}</soap:Body>
</soap:Envelope>`;
}

function isMrwInternalServerError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /Runtime Error|error interno de MRW TEST|HTTP 500/i.test(message);
}

function partyXml(party: MrwParty, kind: "pickup" | "delivery") {
  return `
    <Direccion>
      <CodigoDireccion></CodigoDireccion>
      <CodigoTipoVia></CodigoTipoVia>
      <Via>${escapeXml(party.address)}</Via>
      <Numero></Numero>
      <Resto></Resto>
      <CodigoPostal>${escapeXml(party.postalCode)}</CodigoPostal>
      <Poblacion>${escapeXml(party.town)}</Poblacion>
      <Provincia>${escapeXml(party.province || "")}</Provincia>
      <Estado></Estado>
      <CodigoPais>${escapeXml(party.countryCode || "ES")}</CodigoPais>
      <TipoPuntoEntrega></TipoPuntoEntrega>
      <CodigoPuntoEntrega></CodigoPuntoEntrega>
      <CodigoFranquiciaAsociadaPuntoEntrega></CodigoFranquiciaAsociadaPuntoEntrega>
      <TipoPuntoRecogida></TipoPuntoRecogida>
      <CodigoPuntoRecogida></CodigoPuntoRecogida>
      <CodigoFranquiciaAsociadaPuntoRecogida></CodigoFranquiciaAsociadaPuntoRecogida>
      <Agencia></Agencia>
    </Direccion>
    <Nif></Nif>
    <Nombre>${escapeXml(party.name)}</Nombre>
    <Telefono>${escapeXml(party.phone)}</Telefono>
    <Contacto>${escapeXml(party.name)}</Contacto>
    ${kind === "delivery" ? `<ALaAtencionDe>${escapeXml(party.name)}</ALaAtencionDe>` : ""}
    <Horario>
      <Rangos xsi:nil="true" />
    </Horario>
    <Observaciones>${escapeXml(party.email || "")}</Observaciones>
  `;
}

function bultoXml(parcel: { weight: number; length?: number; width?: number; height?: number }, index: number, reference: string) {
  return `
    <BultoRequest>
      <Alto>${escapeXml(parcel.height || "")}</Alto>
      <Largo>${escapeXml(parcel.length || "")}</Largo>
      <Ancho>${escapeXml(parcel.width || "")}</Ancho>
      <Dimension></Dimension>
      <Referencia>${escapeXml(reference)}</Referencia>
      <Peso>${escapeXml(parcel.weight || "")}</Peso>
      <NumeroBulto>${index}</NumeroBulto>
    </BultoRequest>
  `;
}

function extractTag(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "i"));
  return decodeXml(match?.[1] || "").trim();
}

function extractPdf(xml: string) {
  const candidate = extractTag(xml, "EtiquetaFile") || extractTag(xml, "Etiqueta") || extractTag(xml, "GetEtiquetaEnvioResult") || extractTag(xml, "EtiquetaEnvioResult") || extractTag(xml, "Fichero");
  if (!candidate) throw new Error("MRW no ha devuelto PDF de etiqueta");
  return candidate.replace(/^data:application\/pdf;base64,/, "");
}

function postSoapHttp(baseUrl: string, method: "TransmEnvio" | "TransmitirEnvio" | "EtiquetaEnvio" | "CancelarEnvio", xml: string) {
  const url = new URL(baseUrl);
  const soapAction = `http://www.mrw.es/${method === "EtiquetaEnvio" ? "GetEtiquetaEnvio" : method}`;
  return new Promise<{ status: number; rawXml: string }>((resolve, reject) => {
    const request = https.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: `"${soapAction}"`,
        "Content-Length": Buffer.byteLength(xml),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          rawXml: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    request.on("error", reject);
    request.end(xml);
  });
}

function formatMrwDate(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function escapeXml(value: unknown) {
  return String(value ?? "").replace(/[<>&'"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[char] || char);
}

function decodeXml(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&quot;/g, '"');
}

function stripXml(value: string) {
  return decodeXml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}
