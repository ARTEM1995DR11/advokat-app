/* Ежедневник адвоката · календарь, этап 1 · 5.0.1290
 * Pure local-date and period utilities for the approved month/week/day views.
 * No storage, rendering, event listeners, or modifications to case records.
 */
(function(root){
  'use strict';
  var MODES=Object.freeze(['month','week','day']);
  function pad(n){return String(n).padStart(2,'0');}
  function fromISO(s){
    if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;
    var y=+s.slice(0,4),m=+s.slice(5,7),d=+s.slice(8,10);
    if(y<1900||y>2100||m<1||m>12||d<1||d>31)return null;
    var out=new Date(y,m-1,d,12,0,0,0);
    if(out.getFullYear()!==y||out.getMonth()!==m-1||out.getDate()!==d)return null;
    return out;
  }
  function toISO(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
  function safeDate(s,fallback){return fromISO(s)?s:(fromISO(fallback)?fallback:toISO(new Date()));}
  function addDays(s,n){
    var d=fromISO(s);if(!d)return '';
    d.setDate(d.getDate()+(Number(n)||0));return toISO(d);
  }
  function addMonths(s,n){
    var d=fromISO(s);if(!d)return '';
    var day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+(Number(n)||0));
    var max=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
    d.setDate(Math.min(day,max));return toISO(d);
  }
  function weekStart(s){
    var d=fromISO(s);if(!d)return '';
    return addDays(s,-((d.getDay()+6)%7));
  }
  function period(s,mode){
    if(!fromISO(s))return null;
    if(mode==='day')return {from:s,to:s,mode:'day'};
    if(mode==='week'){
      var mon=weekStart(s);return {from:mon,to:addDays(mon,6),mode:'week'};
    }
    var d=fromISO(s),y=d.getFullYear(),m=d.getMonth();
    return {from:toISO(new Date(y,m,1,12)),to:toISO(new Date(y,m+1,0,12)),mode:'month'};
  }
  function shift(s,mode,amount){
    if(!fromISO(s))return '';
    var n=Number(amount)||0;
    return mode==='month'?addMonths(s,n):addDays(s,(mode==='week'?7:1)*n);
  }
  function monthCells(month){
    if(typeof month!=='string'||!/^\d{4}-\d{2}$/.test(month)||!fromISO(month+'-01'))return [];
    var y=+month.slice(0,4),m=+month.slice(5,7)-1;
    var start=new Date(y,m,1,12),offset=(start.getDay()+6)%7;
    var days=new Date(y,m+1,0,12).getDate(),count=Math.ceil((offset+days)/7)*7;
    var result=[];
    for(var i=0;i<count;i++){
      var date=toISO(new Date(y,m,i-offset+1,12));
      result.push(i<offset||i>=offset+days?{d:date,out:true}:{d:date});
    }
    return result;
  }
  function weekDays(s){
    var mon=weekStart(s),result=[];
    if(!mon)return result;
    for(var i=0;i<7;i++)result.push(addDays(mon,i));
    return result;
  }
  function normalizeMode(value){return MODES.indexOf(value)!==-1?value:'month';}
  function normalizeSelection(selected,month,fallback){
    var day=safeDate(selected,fallback);
    return {selected:day,month:(typeof month==='string'&&fromISO(month+'-01'))?month:day.slice(0,7)};
  }
  function byDay(records,isVisible){
    var groups=Object.create(null);
    (Array.isArray(records)?records:[]).forEach(function(t){
      /* Keep legacy records visible even if an imported due value is unusual. */
      if(!t||!t.due||(isVisible&&!isVisible(t)))return;
      (groups[t.due]||(groups[t.due]=[])).push(t);
    });
    return groups;
  }
  root.AdvokatCalendar=Object.freeze({
    MODES:MODES,fromISO:fromISO,toISO:toISO,safeDate:safeDate,
    addDays:addDays,addMonths:addMonths,weekStart:weekStart,
    weekDays:weekDays,period:period,shift:shift,
    monthCells:monthCells,normalizeMode:normalizeMode,
    normalizeSelection:normalizeSelection,byDay:byDay
  });
})(typeof window!=='undefined'?window:self);
