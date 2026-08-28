const madrid = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Madrid",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});

export function formatOdooMadrid(value?: string) {
  if (!value) return "";
  const utc = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(utc);
  return Number.isNaN(date.getTime()) ? value.slice(0, 16).replace("T", " ") : madrid.format(date).replace("T", " ");
}
