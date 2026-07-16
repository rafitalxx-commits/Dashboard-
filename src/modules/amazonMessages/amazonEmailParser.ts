import type { ParsedAmazonEmail } from "./amazonMessagesTypes";

export function parseAmazonEmail(): ParsedAmazonEmail {
  return {
    id: "",
    threadId: "",
    subject: "",
    from: "",
    to: "",
    date: "",
    marketplace: "",
    category: "",
    bodyText: "",
    bodyHtml: "",
    rawHeaders: {},
    labels: [],
    orderIds: [],
    attachments: [],
  };
}
