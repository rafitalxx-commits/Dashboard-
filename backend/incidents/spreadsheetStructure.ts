import { HEADERS, SHEETS, GoogleApi } from './repository.ts';

/** Additive only: preserve unrelated tabs and refuse incompatible populated headers. */
export async function planIncidentSpreadsheet(api: GoogleApi, spreadsheetId: string) {
  if (!spreadsheetId) throw Error('Configura el libro de incidencias');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
  const meta = await api.request(url + '?fields=spreadsheetId,properties.title,sheets.properties');
  const byName = new Map<string, any>(meta.sheets.map((s: any) => [s.properties.title, s.properties]));
  let nextId = Math.max(0, ...meta.sheets.map((s: any) => s.properties.sheetId)) + 1;
  const requests: any[] = [];
  for (const title of SHEETS) {
    const sheet = byName.get(title);
    let sheetId = sheet?.sheetId;
    if (sheet) {
      const range = `'${title.replaceAll("'", "''")}'!A1:AK2`;
      const existing = await api.request(url + '/values/' + encodeURIComponent(range));
      const rows = existing.values || [];
      if (rows[0]?.join(',') === HEADERS.join(',')) continue;
      if (rows.some((row: any[]) => row.some(v => v !== ''))) throw Error(`Cabeceras incompatibles en ${title}; no se sobrescribe`);
      requests.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { columnCount: Math.max(40, sheet.gridProperties.columnCount), frozenRowCount: 1 } }, fields: 'gridProperties.columnCount,gridProperties.frozenRowCount' } });
    } else {
      sheetId = nextId++;
      requests.push({ addSheet: { properties: { sheetId, title, gridProperties: { rowCount: 1000, columnCount: 40, frozenRowCount: 1 } } } });
    }
    requests.push({ updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: [{ values: HEADERS.map(stringValue => ({ userEnteredValue: { stringValue }, userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: .93, green: .96, blue: 1 } } })) }], fields: 'userEnteredValue,userEnteredFormat' } });
  }
  return { spreadsheetId, title: meta.properties.title, preservedTabs: [...byName.keys()].filter(n => !(SHEETS as readonly string[]).includes(n)), requests };
}
