import { readFileSync, writeFileSync } from 'node:fs';
const file = new URL('../dist/index.html', import.meta.url);
let html = readFileSync(file, 'utf8');
const main = /\s*<link\s+rel="stylesheet"\s+crossorigin\s+href="\/assets\/index-[^"]+\.css">/;
if (!main.test(html)) throw new Error('No se encontró el CSS principal generado por Vite');
const before = '<link rel="stylesheet" crossorigin href="/assets/incidents-dark-20261107.css">';
const after = ['incidents-mobile-user-v2-20261107.css','settings-mobile-theme-20261107.css','incidents-mobile-contrast-20261107.css','reception-dark-20261109.css','expeditions-dark-20261112.css'].map(x => `    <link rel="stylesheet" href="/assets/${x}">`).join('\n');
html = html.replace(main, m => `\n    ${before}${m}\n${after}`);
writeFileSync(file, html);
