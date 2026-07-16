export interface ParsedAmazonEmail {
  id: string;
  threadId?: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  marketplace: string;
  category: string;
  bodyText: string;
  bodyHtml: string;
  rawHeaders: Record<string, string>;
  labels: string[];
  orderIds: string[];
  attachments: Array<{ filename: string; mimeType: string }>;
}
