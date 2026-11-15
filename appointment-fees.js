/* Appointment-fee rules and date grouping. This module NEVER prices agreements.
 * Statutory criminal rates: Govt Decree 1240 art.22(1), Decree 1191 (01.10.2025).
 * 2026 indexation was suspended by Govt Decree 1366 (16.10.2026).
 * Earlier dates / from 2027 / civil / administrative / CoAP need manual verification.
 */
'use strict';
var APPOINTMENT_CRIMINAL_RATES_2025={
 a:{regular:2667,night:3753,nonworking:4156},
 b:{regular:2395,night:3233,nonworking:3611},
 c:{regular:2128,night:2718,nonworking:3078},
 d:{regular:1861,night:2202,nonworking:2544}
};
var APPOINTMENT_CRIMINAL_CATEGORIES={
 a:'а — присяжные; ВС РФ; областной, апелляционный или кассационный суд и приравненные',
 b:'б — 3+ обвиняемых / 3+ деяний / более 3 томов',
 c:'в — закрытое рассмотрение; несовершеннолетние и другие специальные условия',
 d:'г — остальные уголовные дела'
};
function appointmentFeeCategory(x){return Object.prototype.hasOwnProperty.call(APPOINTMENT_CRIMINAL_RATES_2025,String(x))?String(x):'';}
function appointmentFeeMoney(n){n=Number(n);return Number.isFinite(n)&&n>=0&&n<=100000000?Math.round(n*100)/100:0;}
function appointmentFeeDayType(type,date){
  return ['regular','night','nonworking'].includes(type)?type:'regular';
}
function appointmentFeeSuggestedDayType(date){
  var day=new Date(String(date)+'T12:00:00Z').getUTCDay();
  return day===0||day===6?'nonworking':'regular';
}
function appointmentFeeRate(m,date,category,dayType){
  // Do not silently use 2025–26 criminal tables beyond their verified interval.
  if(!m||m.basis!=='assigned'||m.type!=='criminal'||
     date<'2025-10-01'||date>'2026-12-31')return null;
  var table=APPOINTMENT_CRIMINAL_RATES_2025[appointmentFeeCategory(category)];
  return table?table[appointmentFeeDayType(dayType,date)]:null;
}
function appointmentFeeDays(m,toDate){
  if(!m||m.basis!=='assigned')return [];
  var grouped=Object.create(null);
  function get(date){return grouped[date]||(grouped[date]={date:date,participationIds:[],taskIds:[],kinds:[],details:[],places:[],kind:'other'});}
  participationOf(m.id).forEach(function(p){
    if(!p||!stageISODateValid(p.date)||p.date>toDate)return;
    var row=get(p.date);row.participationIds.push(String(p.id));row.kind=p.kind||'other';
    row.kinds.push(PART_KINDS[p.kind]||'Участие');
    if(p.desc)row.details.push(String(p.desc));
    if(p.place)row.places.push(String(p.place));
  });
  // Calendar events are SUGGESTIONS, not evidence of paid employment.
  // A recorded hearing result (excluding cancellation) or a completed meeting
  // can propose a day, but the lawyer must explicitly include and confirm it.
  tasksOf(m.id).forEach(function(t){
    if(!t||!stageISODateValid(t.due)||t.due>toDate)return;
    var hearing=t.kind==='hearing'&&(t.done||['held','postponed','break','completed'].includes(t.hearingResultStatus));
    var meeting=t.kind==='meeting'&&t.done;
    var investigation=t.kind==='investigation'&&t.done&&t.investigationStatus==='held';
    if(!hearing&&!meeting&&!investigation)return;
    if(t.hearingResultStatus==='cancelled')return;
    var row=get(t.due);row.taskIds.push(String(t.id));if(!row.participationIds.length)row.kind=t.kind;
    row.kinds.push(hearing?'Заседание (запись календаря)':investigation?'Следственное действие (событие, требует подтверждения)':'Встреча (запись календаря)');
    if(t.title)row.details.push(String(t.title));
    if(t.place)row.places.push(String(t.place));
  });
  return Object.keys(grouped).sort().map(function(day){
    var x=grouped[day];
    x.desc=[...new Set(x.kinds.concat(x.details))].join(' · ').slice(0,380);
    x.place=[...new Set(x.places)].join('; ').slice(0,200);
    x.source=x.participationIds.length?'participation':'calendar';
    return x;
  });
}
function appointmentFeeLineTotal(lines){return appointmentFeeMoney((lines||[]).reduce(function(s,x){
 return s+((x.included!==false&&!x.alreadyClaimed)?appointmentFeeMoney(x.rate):0);
},0));}
function appointmentFeeNeedsReview(lines){var included=(lines||[]).filter(function(x){return x.included!==false&&!x.alreadyClaimed;});
 return !included.length||included.some(function(x){return !appointmentFeeMoney(x.rate)||!x.verified||!String(x.proof||'').trim();});}
