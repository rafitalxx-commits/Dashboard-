# Estadísticas: 7 días por día y hora + vista compacta

## Alcance autorizado

Corrección de la publicación de estadísticas solicitada por Rafa: «filtro 7 dias es por horas pero por cada dia ... sabado y domingo no enviamos y puedes ahorrar espacio». Se mantiene el intervalo de últimos7días naturales:5filas laborables, no7días laborables ni una suma de24horas mezcladas. Fines de semana vacíos ocultos; cualquier actividad excepcional permanece visible/contada para no perder datos ni desajustar el círculo. Se explicaron estas decisiones durante la tarea.

La autorización de publicación anterior persiste para esta corrección de la misma funcionalidad; se desarrolla/prueba primero en paralelo. No incluye reposición,backend,config,gates,datos ni escrituras externas.

## Implementación

Worktree real `odoo-v18-dashboard-statistics-daily-lab-20261028`, rama `release/expeditions-statistics-daily-20261028`, base45b7baa. Baseline reconstruida byte-idéntica a la web publicada. Tres fuentes warehouseStats,solo esos archivos se promueven. Los mismos tres fuentes y tests actualizan el LAB gestionado existente (ruta pública prefix verificada por GET del módulo), sin cambiar autenticación ni presentar eso como QA LAB autenticada.

- Una fila por día con barras horarias apiladas por operario,escala compartida y total diario. Rango de horas común recorta solo bordes vacíos; ceros interiores,horas atípicas y datos excepcionales conservados.
- Clic/Enter en día abre sus24horas; clic/Enter en celda abre ese día+hora,con KPI/círculo/detalle coherentes. Volver a los7días conserva contexto/operario.
- Menos altura/cabecera/KPI,móvil3KPIs en línea,círculo pequeño con leyenda lateral. Hoy/mes con gráfico menos alto,listas con scroll interior accesible/encabezados fijados. No se eliminan filas ni paginación.
- Mes/atribución global por primera etiqueta/colores/QR/reglas/impresora intactos. Datos solo lectura.

## Pruebas y evidencia

Evidencia privada `/root/.openclaw/workspace/releases/expeditions-statistics-daily-20261028/`, fixtures/HTTP local en `qa/warehouse-statistics-daily-20261028/`.

- `npm run build`:baseline y candidato exit0.
- `node --experimental-strip-types scripts/test-warehouse-statistics.ts`:exit0,regresiones originales+separación diaria,5laborables/ceros,excepciones fin de semana,medianoche,horas atípicas,recorte sin perder pedidos,suma de celdas=días=semana.
- Typecheck enfocado vista/statistics ES2020/noEmit:exit0. Un intento inicial detectó Array.at incompatible con libES2020 en la vista; corregido mediante índice y nueva comprobación correcta.
- `node scripts/test-warehouse-statistics-ui.mjs`:exit0. Padre real App/ExpeditionsView,fixtures con dos IDs/mismo nombre,filtros/cliks,día/hora/vuelta,fin de semana excepcional,00/23h,vacío,503/reintento,QR,color,mes/teclado,paginación,móvil. Después lectorHTTP real con copia aislada del ledger,1627pedidos octubre al reloj fijo; ledger idéntico. Bypass solo temporal/local,puerto aleatorio cerrado en finally,ningún proceso QA residual.
- `node .../verify.cjs`:candidato compilado y snapshot auténtico,cero APIs reales en la navegación. Conciliación independiente56hoy/375semana/1628mes,5filas,totales de celdas/filas y círculo iguales,teclado/táctil,geometría1440/390,alturas compactas,mes,QR,impresora/reglas/enlaces. Capturas revisadas; ajuste final de etiquetas móviles/no-wrap de cabecera y repetición del candidato.

## Promoción y rollback

Publicación selectiva de3fuentes y assets nuevos; entradaHTML atómica. Respaldos estáticos completos y fuentes originales con metadatos. Revalidar hashes de entrada/assets y3fuentes originales. No reiniciar backend. Verificación pública auth+ambas APIs estadísticas reales con sesión existente,sin bypass; GET ajenos interceptados y mutaciones bloqueadas. No se afirma hardware/transacciones externas. Revertir HTML/fuentes si falla; nunca restaurar stores.

Resultado final pendiente. Completar con deployment.json/production-verification.json; no interpretar este estado preparatorio como publicado.
