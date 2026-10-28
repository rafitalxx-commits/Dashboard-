import assert from 'node:assert/strict';
import { activeHourKeys, weekDayRows, bucketOrders, localDate, periodFor, shiftDay, uniqueOrders, withinPeriod, workerRoster, type Activity } from '../src/modules/warehouseStats/statistics.ts';
const now = new Date('2026-10-28T15:40:00Z');
const activity = (id:string, ref:string, createdAt:string, workerId='a', result='label-created'):Activity => ({id,orderRef:ref,createdAt,workerId,workerName:'Mismo nombre',workerCode:workerId,result});
const rows = [
 activity('a1','S001','2026-10-01T08:00:00Z'),
 activity('a2',' s001 ','2026-10-28T09:00:00Z','b'), // repeated label: original order remains Oct 1 / a
 activity('a3','S002','2026-10-22T08:00:00Z'),
 activity('a4','S003','2026-10-28T09:00:00Z','b'),
 activity('a5','S004','2026-10-28T09:30:00Z','a'),
 activity('a6','S005','2026-10-28T11:00:00Z','b'),
 activity('a7','SIM','2026-10-28T11:00:00Z','a','simulated-label'),
 activity('a8','ERROR','2026-10-28T11:00:00Z','a','error'),
 activity('a9','FUTURE','2026-10-28T23:59:59Z'),
 activity('a10','INVALID','not-a-date'),
 activity('a11','S006','2026-09-30T22:30:00Z'), // Madrid Oct 1
 activity('a12','S007','2026-09-30T21:59:59Z'),
 activity('a13','S008','2026-10-21T21:59:59Z'),
];
const orders = uniqueOrders(rows, now);
assert.equal(orders.length,8);
assert.equal(orders.find(x=>x.orderRef==='S001')?.workerId,'a');
assert.equal(uniqueOrders([...rows].reverse(),now).length,8);
assert.equal(localDate('2026-09-30T22:30:00Z')?.day,'2026-10-01');
assert.equal(localDate('2026-10-25T00:30:00Z')?.hour,'02');
assert.equal(localDate('2026-10-25T01:30:00Z')?.hour,'02'); // clock-back: both hours included, one bucket
assert.equal(localDate('bad'),null);
assert.equal(shiftDay('2026-03-01',-1),'2026-02-28');
assert.equal(shiftDay('2024-03-01',-1),'2024-02-29');
const month = periodFor('month','2026-10',now);
assert.deepEqual(month,{from:'2026-10-01',to:'2026-10-28'});
assert.equal(periodFor('month','2024-02',now).to,'2024-02-29');
assert.equal(periodFor('month','',now).from,'2026-10-01');
const monthly = withinPeriod(orders,month,'all');
assert.equal(monthly.length,7);
const daily=bucketOrders(monthly,'day',month);
assert.equal(daily.length,28);
assert.equal(daily[0].total,2);
assert.equal(daily.at(-1)?.total,3);
assert.equal(daily.reduce((a,b)=>a+b.total,0),monthly.length);
assert.equal(daily.find(x=>x.key==='2026-10-02')?.total,0);
const week=periodFor('week','',now);
assert.deepEqual(week,{from:'2026-10-22',to:'2026-10-28'});
const weekly=withinPeriod(orders,week,'all');
assert.equal(weekly.length,4);
const hours=bucketOrders(weekly,'hour',week);
assert.equal(hours.length,24);
assert.equal(hours.reduce((a,b)=>a+b.total,0),weekly.length);
const today=periodFor('today','',now);
assert.equal(withinPeriod(orders,today,'b').length,2);
assert.equal(withinPeriod(orders,today,'a').length,1);
const people=workerRoster([{id:'a',code:'a',name:'Mismo nombre',active:true}],rows);
assert.equal(people.length,2,'same display name does not merge identities');
assert.notEqual(people[0].color,people[1].color);
assert.equal(people[1].active,false,'historic worker remains selectable');
const dstRows=[activity('dst1','D1','2026-10-25T00:30:00Z'),activity('dst2','D2','2026-10-25T01:30:00Z')];
assert.equal(bucketOrders(dstRows,'hour',{from:'2026-10-25',to:'2026-10-25'})[2].total,2);
console.log('PASS: unique orders/labels, simulations/future/invalid exclusions, worker attribution, Madrid midnight/DST, 7 calendar days, monthly daily reconciliation/zero days/leap year, stable identity colors.');

const dailyWeek = weekDayRows(weekly, week);
assert.equal(dailyWeek.length, 5, "seven calendar days contain five weekdays; empty weekend is hidden");
assert(dailyWeek.every(day => !day.weekend));
assert.equal(dailyWeek.reduce((sum, day) => sum + day.total, 0), weekly.length);
assert.equal(dailyWeek.flatMap(day => day.hours).reduce((sum, hour) => sum + hour.total, 0), weekly.length);
assert.deepEqual(activeHourKeys(dailyWeek), ["10", "11", "12"]);
assert(dailyWeek.some(day => day.total === 0), "empty working days stay visible");
const exceptionalWeekend = weekDayRows([...weekly, activity('sat', 'SAT', '2026-10-24T21:59:59Z')], week);
assert.equal(exceptionalWeekend.length, 6);
assert.equal(exceptionalWeekend.find(day => day.key === '2026-10-24')?.weekend, true);
assert.equal(exceptionalWeekend.reduce((sum, day) => sum + day.total, 0), weekly.length + 1, "exceptional weekend data must never vanish");
assert.equal(activeHourKeys(exceptionalWeekend).at(-1), '23');
const midnight = weekDayRows([activity('late', 'LATE', '2026-10-27T23:30:00Z')], week);
assert.equal(midnight.find(day => day.key === '2026-10-28')?.hours[0].total, 1);
assert.deepEqual(activeHourKeys(midnight), ['00']);
assert.equal(activeHourKeys(weekDayRows([], week)).length, 24, 'empty state has a truthful full-day axis');
console.log('PASS: separated day/hour cells, weekday zeros, empty weekends omitted, weekend exceptions retained, no dropped edge/midnight hours, totals reconcile.');
