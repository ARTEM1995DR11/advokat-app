/* =====================================================================
   Ежедневник адвоката — личный помощник
   Vanilla JS, офлайн, данные только на устройстве
   ===================================================================== */
'use strict';

var APP_VERSION='5.0.41';
var APP_BUILD='5041';

/* ------------------------- state + encrypted local storage ------------------------- */
var KEY = 'advokat_pro_v1'; // legacy localStorage key (migration only)
var META_KEY = 'advokat_secure_meta_v3';
var DB_NAME = 'advokat_secure_v3';
var DB_STORE = 'vault';
var DB_VER = 1;

var DEF = {
  matters: [], tasks: [], participation: [], journal: [], time: [],
  settings: {
    theme:'auto', themeAutoV3114:true, name:'', dayRate:0, cur:'₽', notify:false,
    seen:false, dismissed:false, backupEveryDays:1, lastBackup:'', backupDailyV3132:true,
    lockOnReturn:true, version:3
  },
  ui: {
    tab:'today', taskSeg:'open', taskChip:'', taskType:'', q:'', calM:null, calSel:null,
    showArch:false, matterType:'', matterBasis:'', matterStage:'', matterScope:'active', matterSort:'priority', matterQ:'', matterSearchOpen:false, taskGroupOpen:{}
  }
};
var S = JSON.parse(JSON.stringify(DEF)), mem = null;
var DBP = null, META = null, SESSION_KEY = null, saveTimer = null, unlocked = false;

function clone(x){ return JSON.parse(JSON.stringify(x)); }
function mergeState(d){
  d = d || {};
  var out = Object.assign(clone(DEF), d);
  out.settings = Object.assign({}, DEF.settings, d.settings||{});
  // 3.1.14: once migrate existing installations to automatic day/night appearance.
  // Manual Light/Dark remains available afterwards from the Appearance sheet.
  if(!(d.settings&&Object.prototype.hasOwnProperty.call(d.settings,'themeAutoV3114'))){
    out.settings.theme='auto';
    out.settings.themeAutoV3114=true;
  }
  if(!(d.settings&&Object.prototype.hasOwnProperty.call(d.settings,'backupDailyV3132'))){
    out.settings.backupEveryDays=1;
    out.settings.backupDailyV3132=true;
  }
  delete out.settings.pin; delete out.settings.rate;
  out.ui = Object.assign({}, DEF.ui, d.ui||{});
  if(!out.ui.taskGroupOpen || typeof out.ui.taskGroupOpen!=='object') out.ui.taskGroupOpen={};
  if(!out.ui.matterScope) out.ui.matterScope=out.ui.showArch?'archive':'active';
  if(typeof out.ui.matterBasis!=='string') out.ui.matterBasis='';
  if(typeof out.ui.matterStage!=='string') out.ui.matterStage='';
  if(['priority','client','stage'].indexOf(out.ui.matterSort)<0) out.ui.matterSort='priority';
  if(typeof out.ui.matterQ!=='string') out.ui.matterQ='';
  out.ui.matterSearchOpen=!!out.ui.matterSearchOpen;
  out.matters = Array.isArray(d.matters)?d.matters:[];
  out.tasks = Array.isArray(d.tasks)?d.tasks:[];
  out.participation = Array.isArray(d.participation)?d.participation:[];
  out.journal = Array.isArray(d.journal)?d.journal:[];
  // 5.0.05: legacy builds could store numeric IDs. DOM data-* always returns strings,
  // so normalize every record and relation ID on load to keep old matters clickable.
  out.matters.forEach(function(m){ if(m && m.id!=null) m.id=String(m.id); });
  out.tasks.forEach(function(t){
    if(!t) return;
    if(t.id!=null) t.id=String(t.id);
    if(t.mid!=null && t.mid!=='') t.mid=String(t.mid);
    if(t.kind==='call' || t.kind==='doc') t.kind='task';
    if(t.done && !t.doneAt) t.doneAt=new Date().toISOString();
  });
  out.participation.forEach(function(e){
    if(!e) return;
    if(e.id!=null) e.id=String(e.id);
    if(e.mid!=null && e.mid!=='') e.mid=String(e.mid);
  });
  out.journal.forEach(function(j){
    if(!j) return;
    if(j.id!=null) j.id=String(j.id);
    if(j.mid!=null && j.mid!=='') j.mid=String(j.mid);
  });
  out.time = Array.isArray(d.time)?d.time:[];
  // Migration: hourly-rate fields become day-rate defaults; old time logs become participation days.
  out.matters.forEach(function(m){
    if(m.dayRate==null) m.dayRate = 0;
    if(!m.type) m.type = 'other';
    if(!m.stage) m.stage = 'Первая инстанция';
    normalizeLegacyMatterStage(m);
    if(typeof m.basis!=='string') m.basis = '';
    // 5.0.16: название дела не вводится вручную. Для старых карточек
    // сразу формируем его из структурированных данных, чтобы весь интерфейс
    // (списки, поиск, отчёты, заседания) использовал одно актуальное название.
    m.title=matterAutoTitle(m);
  });
  if(!out.participation.length && out.time.length){
    var seen = {};
    out.time.forEach(function(e){
      var k = (e.mid||'')+'|'+(e.date||'');
      if(seen[k]) return; seen[k]=1;
      out.participation.push({id:'p'+Math.random().toString(36).slice(2), mid:e.mid||'', date:e.date||'',
        kind:'other', place:'', desc:e.desc||'Участие / работа по делу', rate:0, legacy:true});
    });
  }
  return out;
}

function b64(bytes){
  var s=''; bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for(var i=0;i<bytes.length;i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function unb64(s){
  var x=atob(s), a=new Uint8Array(x.length); for(var i=0;i<x.length;i++) a[i]=x.charCodeAt(i); return a;
}
function randomB64(n){ var a=new Uint8Array(n); crypto.getRandomValues(a); return b64(a); }
function getMeta(){
  try{ var m=JSON.parse(localStorage.getItem(META_KEY)||'null'); if(m&&m.v===3) return m; }catch(e){}
  var m={v:3,mode:'device',salt:randomB64(16),deviceSecret:randomB64(32),created:new Date().toISOString()};
  localStorage.setItem(META_KEY,JSON.stringify(m)); return m;
}
function putMeta(){ try{ localStorage.setItem(META_KEY,JSON.stringify(META)); }catch(e){} }
function pinEnabled(){ return !!(META && META.mode==='pin'); }

function openDB(){
  if(DBP) return DBP;
  DBP = new Promise(function(resolve,reject){
    var req=indexedDB.open(DB_NAME,DB_VER);
    req.onupgradeneeded=function(){ var db=req.result; if(!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE); };
    req.onsuccess=function(){ resolve(req.result); };
    req.onerror=function(){ reject(req.error||new Error('IndexedDB')); };
  });
  return DBP;
}
async function idbGet(k){
  var db=await openDB(); return new Promise(function(resolve,reject){
    var tx=db.transaction(DB_STORE,'readonly'), r=tx.objectStore(DB_STORE).get(k);
    r.onsuccess=function(){ resolve(r.result||null); }; r.onerror=function(){ reject(r.error); };
  });
}
async function idbSet(k,v){
  var db=await openDB(); return new Promise(function(resolve,reject){
    var tx=db.transaction(DB_STORE,'readwrite'); tx.objectStore(DB_STORE).put(v,k);
    tx.oncomplete=function(){ resolve(); }; tx.onerror=function(){ reject(tx.error); };
  });
}
async function idbDel(k){
  var db=await openDB(); return new Promise(function(resolve,reject){
    var tx=db.transaction(DB_STORE,'readwrite'); tx.objectStore(DB_STORE).delete(k);
    tx.oncomplete=function(){ resolve(); }; tx.onerror=function(){ reject(tx.error); };
  });
}
async function deriveKey(secret,saltB64){
  var enc=new TextEncoder();
  var base=await crypto.subtle.importKey('raw',enc.encode(secret),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt:unb64(saltB64),iterations:180000,hash:'SHA-256'},base,
    {name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function encryptObj(obj,key){
  var iv=new Uint8Array(12); crypto.getRandomValues(iv);
  var data=new TextEncoder().encode(JSON.stringify(obj));
  var ct=await crypto.subtle.encrypt({name:'AES-GCM',iv:iv},key,data);
  return {v:3,iv:b64(iv),data:b64(ct),saved:new Date().toISOString()};
}
async function decryptObj(payload,key){
  if(!payload) return null;
  var pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(payload.iv)},key,unb64(payload.data));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function persistNow(){
  if(!SESSION_KEY || !unlocked) return;
  try{ await idbSet('state',await encryptObj(S,SESSION_KEY)); mem=clone(S); }
  catch(e){ mem=clone(S); }
}
function save(){
  mem=clone(S); clearTimeout(saveTimer); saveTimer=setTimeout(function(){ persistNow(); },70);
}
function flushSave(){
  clearTimeout(saveTimer); saveTimer=null; return persistNow();
}
function cleanupOldCompletedTasks(days){
  days=+days||30;
  var cutoff=Date.now()-days*864e5, before=S.tasks.length;
  S.tasks=S.tasks.filter(function(t){
    if(!t || !t.done || !t.doneAt) return true;
    /* Заседания с зафиксированным результатом — часть истории дела и календаря. */
    if(t.kind==='hearing' && t.hearingResultStatus) return true;
    var ts=new Date(t.doneAt).getTime();
    return !isFinite(ts) || ts>=cutoff;
  });
  return before-S.tasks.length;
}
async function loadForSecret(secret){
  META = getMeta();
  var key=await deriveKey(secret,META.salt);
  var payload=await idbGet('state');
  if(payload){
    var d=await decryptObj(payload,key); S=mergeState(d); SESSION_KEY=key; unlocked=true;
    return S;
  }
  // one-time migration from the old unencrypted localStorage version
  var legacy=null;
  try{ legacy=JSON.parse(localStorage.getItem(KEY)||'null'); }catch(e){}
  S=mergeState(legacy||DEF); SESSION_KEY=key; unlocked=true;
  await persistNow();
  try{ localStorage.removeItem(KEY); }catch(e){}
  return S;
}
async function bootLoadDevice(){
  META=getMeta();
  if(META.mode==='pin') return false;
  if(!META.deviceSecret){ META.deviceSecret=randomB64(32); putMeta(); }
  await loadForSecret(META.deviceSecret); return true;
}
async function unlockWithPin(pin){
  META=getMeta();
  if(META.mode!=='pin') return false;
  try{ await loadForSecret(pin); return true; }catch(e){ SESSION_KEY=null; unlocked=false; return false; }
}
async function enablePinEncryption(pin){
  META=getMeta();
  var oldState=clone(S), oldKey=SESSION_KEY;
  var next={v:3,mode:'pin',salt:randomB64(16),created:META.created||new Date().toISOString(),changed:new Date().toISOString()};
  var key=await deriveKey(pin,next.salt);
  var payload=await encryptObj(oldState,key);
  await idbSet('state',payload);
  META=next; SESSION_KEY=key; unlocked=true; putMeta();
  return true;
}
async function disablePinEncryption(){
  var next={v:3,mode:'device',salt:randomB64(16),deviceSecret:randomB64(32),created:(META&&META.created)||new Date().toISOString(),changed:new Date().toISOString()};
  var key=await deriveKey(next.deviceSecret,next.salt);
  await idbSet('state',await encryptObj(S,key));
  META=next; SESSION_KEY=key; unlocked=true; putMeta();
}
async function clearSecureStorage(){
  try{ await idbDel('state'); }catch(e){}
  META={v:3,mode:'device',salt:randomB64(16),deviceSecret:randomB64(32),created:new Date().toISOString()}; putMeta();
  SESSION_KEY=await deriveKey(META.deviceSecret,META.salt); S=clone(DEF); unlocked=true; await persistNow();
}

/* ------------------------- utils ------------------------- */
function $(s){ return document.querySelector(s); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
function ico(n,c){ return '<svg class="ico '+(c||'')+'" viewBox="0 0 24 24"><use href="#i-'+n+'"/></svg>'; }
function headerBell(){
  return '<button class="today-bell app-header-bell" style="appearance:none!important;-webkit-appearance:none!important;position:absolute!important;top:1px!important;right:2px!important;left:auto!important;bottom:auto!important;box-sizing:border-box!important;width:42px!important;height:42px!important;min-width:42px!important;min-height:42px!important;max-width:42px!important;max-height:42px!important;margin:0!important;padding:0!important;border:1px solid var(--app-bell-border)!important;border-radius:14px!important;background:var(--app-bell-bg)!important;color:var(--app-bell-color)!important;box-shadow:var(--app-bell-shadow)!important;opacity:1!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;display:flex!important;align-items:center!important;justify-content:center!important;line-height:1!important;transform:none!important;filter:none!important;z-index:20!important" data-act="notify-sheet" aria-label="Уведомления">'+ico('bell')+'</button>';
}
function headerSearch(action,active,label){
  action=action||'global-search';
  label=label||'Поиск';
  var cls='iconbtn app-header-search'+(active?' on':'');
  return '<button class="'+cls+'" data-act="'+esc(action)+'" title="'+esc(label)+'" aria-label="'+esc(label)+'" type="button">'+ico('search')+'</button>';
}
function mainBrandHeader(){
  return '<div class="today-brand main-brand-fixed app-main-brand" style="position:relative!important;box-sizing:border-box!important;width:100%!important;height:44px!important;min-height:44px!important;max-height:44px!important;margin:0 0 8px!important;padding:0 2px!important;display:flex!important;align-items:center!important;justify-content:flex-start!important;gap:12px!important;transform:none!important"><div class="today-brand-left"><span class="today-logo"><img src="scale-gold.png?v=4098" alt="Весы правосудия"></span><div><b>Ежедневник адвоката</b><small>Больше, чем календарь</small></div></div>'+headerBell()+'</div>';
}
function brandLine(){ return '<div class="brandline">'+ico('scale','s')+'<span>Ежедневник адвоката</span><i>OFFLINE</i></div>'; }
function iso(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function today(){ return iso(new Date()); }
function parseD(s){ return new Date(s+'T00:00:00'); }
function dd(s){ return Math.round((parseD(s) - parseD(today()))/864e5); }
function addD(s,n){ var d = parseD(s); d.setDate(d.getDate()+n); return iso(d); }
function addM(s,n){ var d = parseD(s), day = d.getDate(); d.setMonth(d.getMonth()+n);
  if(d.getDate() < day) d.setDate(0); return iso(d); }
var MON = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
var MONN = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
var DOW = ['вс','пн','вт','ср','чт','пт','сб'];
function fmtD(s,long){ var d = parseD(s);
  return d.getDate()+' '+MON[d.getMonth()]+(long?' '+d.getFullYear():''); }
function fmtShort(s){ var d = parseD(s); return d.getDate()+' '+MON[d.getMonth()].slice(0,3); }

/* ------------------------- premium date picker ------------------------- */
var DATE_PICKER=null;
function premiumDateControl(id,value,emptyLabel){
  var v=value||'', label=v?fmtD(v,true):(emptyLabel||'Выберите дату');
  return '<input type="hidden" id="'+esc(id)+'" value="'+esc(v)+'">'+
    '<button type="button" class="premium-date-field'+(v?'':' empty')+'" data-act="date-open" data-target="'+esc(id)+'" data-date-for="'+esc(id)+'">'+
      '<span class="premium-date-field-copy"><b>'+esc(label)+'</b></span>'+
    '</button>';
}
function datePickerMonthLabel(ym){
  var p=(ym||today().slice(0,7)).split('-'), y=+p[0],m=+p[1];
  return MONN[m-1]+' '+y;
}
function datePickerShiftMonth(ym,delta){
  var p=(ym||today().slice(0,7)).split('-'),d=new Date(+p[0],(+p[1]-1)+delta,1);
  return iso(d).slice(0,7);
}
function openPremiumDatePicker(target,value,mode,taskId){
  var selected=value||((target&&$('#'+target))?$('#'+target).value:'')||'';
  DATE_PICKER={target:target||'',selected:selected,month:(selected||today()).slice(0,7),mode:mode||'field',taskId:taskId||''};
  renderPremiumDatePicker();
  var modal=$('#premium-date-modal'), scr=$('#date-scrim');
  if(modal)modal.classList.add('open'); if(scr)scr.classList.add('open');
  document.body.classList.add('premium-date-open');
  vib(5);
}
function closePremiumDatePicker(){
  var modal=$('#premium-date-modal'),scr=$('#date-scrim');
  if(modal)modal.classList.remove('open'); if(scr)scr.classList.remove('open');
  document.body.classList.remove('premium-date-open'); DATE_PICKER=null;
}
function renderPremiumDatePicker(){
  if(!DATE_PICKER)return;
  var modal=$('#premium-date-modal');if(!modal)return;
  var p=DATE_PICKER.month.split('-'), y=+p[0],m=+p[1], first=new Date(y,m-1,1);
  var offset=(first.getDay()+6)%7,start=new Date(y,m-1,1-offset), cells='';
  for(var i=0;i<42;i++){
    var d=new Date(start);d.setDate(start.getDate()+i);var ds=iso(d),outside=d.getMonth()!==(m-1),sel=DATE_PICKER.selected===ds,isToday=ds===today();
    cells+='<button type="button" class="premium-date-day'+(outside?' outside':'')+(sel?' selected':'')+(isToday?' today':'')+'" data-act="date-day" data-v="'+ds+'" aria-label="'+esc(fmtD(ds,true))+'"><span>'+d.getDate()+'</span></button>';
  }
  modal.innerHTML='<div class="premium-date-grab"></div>'+
    '<div class="premium-date-head"><div><small>Выбор даты</small><h3>'+esc(datePickerMonthLabel(DATE_PICKER.month))+'</h3></div><div class="premium-date-nav"><button type="button" data-act="date-prev" aria-label="Предыдущий месяц">'+ico('left')+'</button><button type="button" data-act="date-next" aria-label="Следующий месяц">'+ico('chev')+'</button></div></div>'+
    '<div class="premium-date-week"><span>ПН</span><span>ВТ</span><span>СР</span><span>ЧТ</span><span>ПТ</span><span>СБ</span><span>ВС</span></div>'+
    '<div class="premium-date-grid">'+cells+'</div>'+
    '<div class="premium-date-selected"><span>'+ico('cal','s')+'</span><div><small>Выбрано</small><b>'+(DATE_PICKER.selected?esc(fmtD(DATE_PICKER.selected,true)):'Дата не выбрана')+'</b></div></div>'+
    '<div class="premium-date-actions">'+
      '<button type="button" class="premium-date-secondary" data-act="date-today">Сегодня</button>'+
      (DATE_PICKER.mode==='field'?'<button type="button" class="premium-date-secondary reset" data-act="date-clear">Сбросить</button>':'')+
      '<button type="button" class="premium-date-primary" data-act="date-apply">Готово '+ico('check','s')+'</button>'+
    '</div>';
}
function applyPremiumDatePicker(){
  if(!DATE_PICKER)return; var dp=DATE_PICKER;
  if(dp.mode==='task'){
    if(!dp.selected){toast('Выберите дату');return;}
    closePremiumDatePicker();closeSheet();moveTaskToDate(dp.taskId,dp.selected,'Дата изменена');return;
  }
  var inp=dp.target?$('#'+dp.target):null;if(inp)inp.value=dp.selected||'';
  var btn=dp.target?document.querySelector('[data-date-for="'+dp.target+'"]'):null;
  if(btn){
    btn.classList.toggle('empty',!dp.selected);
    var b=btn.querySelector('.premium-date-field-copy b');if(b)b.textContent=dp.selected?fmtD(dp.selected,true):'Выберите дату';
  }
  if(dp.target==='hr-next-date'&&HR)HR.nextDate=dp.selected||'';
  closePremiumDatePicker();
  if(inp)inp.dispatchEvent(new Event('change',{bubbles:true}));
}
/* ------------------------- premium time wheel picker ------------------------- */
var TIME_PICKER=null;
function timeToMinutes(v){ var p=String(v||'').split(':'); if(p.length<2)return NaN; var h=+p[0],m=+p[1]; return (isFinite(h)&&isFinite(m))?h*60+m:NaN; }
function minutesToTime(n){ n=Math.max(0,Math.min(1439,Math.round(n))); return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0'); }
function isHearingTime(v){ var n=timeToMinutes(v); return isFinite(n)&&n>=480&&n<=1080; }
function timePickerRange(mode){ return mode==='hearing'?{min:480,max:1080,title:'Судебное заседание',range:'08:00 — 18:00'}:{min:0,max:1439,title:'Выбор времени',range:'00:00 — 23:59'}; }
function premiumTimeControl(id,value,mode,emptyLabel){
  var v=value||'',label=v?v:(emptyLabel||'Выберите время');
  return '<input type="hidden" id="'+esc(id)+'" value="'+esc(v)+'">'+
    '<button type="button" class="premium-time-field'+(v?'':' empty')+'" data-act="time-open" data-target="'+esc(id)+'" data-time-mode="'+esc(mode||'default')+'" data-time-for="'+esc(id)+'"><b>'+esc(label)+'</b></button>';
}
function openPremiumTimePicker(target,value,mode){
  var r=timePickerRange(mode||'default'),raw=value||((target&&$('#'+target))?$('#'+target).value:'')||'',n=timeToMinutes(raw);
  if(!isFinite(n)||n<r.min||n>r.max){ if(mode==='hearing')n=540; else {var d=new Date();n=d.getHours()*60+d.getMinutes();} }
  TIME_PICKER={target:target||'',mode:mode||'default',hour:Math.floor(n/60),minute:n%60,min:r.min,max:r.max,title:r.title,rangeLabel:r.range};
  normalizePremiumTimeSelection(); renderPremiumTimePicker();
  var modal=$('#premium-time-modal'),scr=$('#time-scrim'); if(modal)modal.classList.add('open'); if(scr)scr.classList.add('open');
  document.body.classList.add('premium-time-open'); vib(5);
}
function closePremiumTimePicker(){ var modal=$('#premium-time-modal'),scr=$('#time-scrim'); if(modal)modal.classList.remove('open'); if(scr)scr.classList.remove('open'); document.body.classList.remove('premium-time-open'); TIME_PICKER=null; }
function normalizePremiumTimeSelection(){ if(!TIME_PICKER)return; var n=TIME_PICKER.hour*60+TIME_PICKER.minute; if(n<TIME_PICKER.min)n=TIME_PICKER.min; if(n>TIME_PICKER.max)n=TIME_PICKER.max; TIME_PICKER.hour=Math.floor(n/60);TIME_PICKER.minute=n%60; }
function premiumTimeMinuteAllowed(h,m){ if(!TIME_PICKER)return true;var n=h*60+m;return n>=TIME_PICKER.min&&n<=TIME_PICKER.max; }
function renderPremiumTimePicker(){
  if(!TIME_PICKER)return; var modal=$('#premium-time-modal');if(!modal)return;
  var minH=Math.floor(TIME_PICKER.min/60),maxH=Math.floor(TIME_PICKER.max/60),hours='',minutes='';
  for(var h=minH;h<=maxH;h++)hours+='<button type="button" class="premium-time-item'+(h===TIME_PICKER.hour?' selected':'')+'" data-act="time-hour" data-v="'+h+'">'+String(h).padStart(2,'0')+'</button>';
  for(var m=0;m<60;m++){var ok=premiumTimeMinuteAllowed(TIME_PICKER.hour,m);minutes+='<button type="button" class="premium-time-item'+(m===TIME_PICKER.minute?' selected':'')+(ok?'':' disabled')+'" data-act="time-minute" data-v="'+m+'"'+(ok?'':' disabled')+'>'+String(m).padStart(2,'0')+'</button>';}
  modal.innerHTML='<div class="premium-time-grab"></div><div class="premium-time-head"><div><small>Выбор времени</small><h3>'+esc(TIME_PICKER.title)+'</h3></div><span class="premium-time-range">'+esc(TIME_PICKER.rangeLabel)+'</span></div>'+ 
    '<div class="premium-time-wheels"><div class="premium-time-center"></div><div class="premium-time-wheel" data-wheel="hour">'+hours+'</div><b class="premium-time-colon">:</b><div class="premium-time-wheel" data-wheel="minute">'+minutes+'</div></div>'+ 
    '<div class="premium-time-selected"><small>Выбрано</small><b>'+minutesToTime(TIME_PICKER.hour*60+TIME_PICKER.minute)+'</b></div>'+ 
    '<div class="premium-time-actions"><button type="button" class="premium-time-secondary" data-act="time-clear">Сбросить</button><button type="button" class="premium-time-primary" data-act="time-apply">Готово '+ico('check','s')+'</button></div>';
  setTimeout(bindPremiumTimeWheels,0);
}
function bindPremiumTimeWheels(){
  if(!TIME_PICKER)return; var itemH=52;
  ['hour','minute'].forEach(function(type){
    var wheel=document.querySelector('#premium-time-modal .premium-time-wheel[data-wheel="'+type+'"]');if(!wheel)return;
    var items=Array.prototype.slice.call(wheel.querySelectorAll('.premium-time-item')),val=type==='hour'?TIME_PICKER.hour:TIME_PICKER.minute,idx=items.findIndex(function(b){return +b.dataset.v===val;});if(idx<0)idx=0;
    wheel.scrollTop=idx*itemH;
    wheel.addEventListener('scroll',function(){clearTimeout(wheel._tw);wheel._tw=setTimeout(function(){
      if(!TIME_PICKER)return;var i=Math.max(0,Math.min(items.length-1,Math.round(wheel.scrollTop/itemH))),btn=items[i];if(!btn)return;var n=+btn.dataset.v;
      if(type==='hour'){
        TIME_PICKER.hour=n;normalizePremiumTimeSelection();
        if(!premiumTimeMinuteAllowed(TIME_PICKER.hour,TIME_PICKER.minute))TIME_PICKER.minute=(TIME_PICKER.hour*60>=TIME_PICKER.max)?TIME_PICKER.max%60:Math.max(0,TIME_PICKER.min-TIME_PICKER.hour*60);
        updatePremiumTimeWheelVisuals();
        var mw=document.querySelector('#premium-time-modal .premium-time-wheel[data-wheel="minute"]');if(mw){var mi=Array.prototype.slice.call(mw.querySelectorAll('.premium-time-item')).findIndex(function(x){return +x.dataset.v===TIME_PICKER.minute;});if(mi>=0)mw.scrollTo({top:mi*itemH,behavior:'smooth'});}
      }else{
        if(!premiumTimeMinuteAllowed(TIME_PICKER.hour,n)){var valid=(TIME_PICKER.hour*60>=TIME_PICKER.max)?TIME_PICKER.max%60:Math.max(0,TIME_PICKER.min-TIME_PICKER.hour*60);TIME_PICKER.minute=valid;var vi=items.findIndex(function(x){return +x.dataset.v===valid;});if(vi>=0)wheel.scrollTo({top:vi*itemH,behavior:'smooth'});}else TIME_PICKER.minute=n;
        updatePremiumTimeWheelVisuals();
      }
      vib(3);
    },85);},{passive:true});
  });
}
function updatePremiumTimeWheelVisuals(){
  if(!TIME_PICKER)return;var modal=$('#premium-time-modal');if(!modal)return;
  modal.querySelectorAll('.premium-time-wheel[data-wheel="hour"] .premium-time-item').forEach(function(b){b.classList.toggle('selected',+b.dataset.v===TIME_PICKER.hour);});
  modal.querySelectorAll('.premium-time-wheel[data-wheel="minute"] .premium-time-item').forEach(function(b){var m=+b.dataset.v,ok=premiumTimeMinuteAllowed(TIME_PICKER.hour,m);b.disabled=!ok;b.classList.toggle('disabled',!ok);b.classList.toggle('selected',m===TIME_PICKER.minute);});
  var sel=modal.querySelector('.premium-time-selected b');if(sel)sel.textContent=minutesToTime(TIME_PICKER.hour*60+TIME_PICKER.minute);
}
function applyPremiumTimePicker(){
  if(!TIME_PICKER)return;var tp=TIME_PICKER,v=minutesToTime(tp.hour*60+tp.minute),inp=tp.target?$('#'+tp.target):null;
  if(tp.mode==='hearing'&&!isHearingTime(v)){toast('Заседания можно назначать с 08:00 до 18:00');return;}
  if(inp)inp.value=v;var btn=tp.target?document.querySelector('[data-time-for="'+tp.target+'"]'):null;if(btn){btn.classList.remove('empty');var b=btn.querySelector('b');if(b)b.textContent=v;}
  if(tp.target==='hr-next-time'&&HR)HR.nextTime=v;closePremiumTimePicker();if(inp)inp.dispatchEvent(new Event('change',{bubbles:true}));
}
function clearPremiumTimePicker(){
  if(!TIME_PICKER)return;var tp=TIME_PICKER,inp=tp.target?$('#'+tp.target):null;if(inp)inp.value='';var btn=tp.target?document.querySelector('[data-time-for="'+tp.target+'"]'):null;if(btn){btn.classList.add('empty');var b=btn.querySelector('b');if(b)b.textContent='Выберите время';}if(tp.target==='hr-next-time'&&HR)HR.nextTime='';closePremiumTimePicker();if(inp)inp.dispatchEvent(new Event('change',{bubbles:true}));
}


/* ------------------------- premium list picker ------------------------- */
var LIST_PICKER=null;
function listPickerMeta(target){
  if(target==='m-role'){
    var rt=(MED&&MED.type)||'other',rs=(MED&&MED.stage)||'';
    var mapped=!!(MATTER_ROLE_STAGE_MAP[rt]&&rs&&MATTER_ROLE_STAGE_MAP[rt][rs]);
    return {title:'Статус доверителя',sub:mapped?(rs+' · только статусы этой стадии'):'Процессуальное положение доверителя по делу',search:'Поиск по статусам…',icon:'user'};
  }
  if(target==='m-court-choice'){
    var pc=matterPlaceContext((MED&&MED.type)||'other',(MED&&MED.stage)||'',(MED&&MED.court)||'');
    return {title:pc.title,sub:pc.sub,search:pc.search,icon:pc.icon};
  }
  var map={
    'e-mid':{title:'Выбор дела',sub:'Выберите дело из списка',search:'Поиск по делам…',icon:'folder'},
    'j-mid-select':{title:'Выбор дела',sub:'Выберите дело для записи в журнал',search:'Поиск по делам…',icon:'folder'},
    'pt-mid':{title:'Выбор дела',sub:'Выберите дело для учёта участия',search:'Поиск по делам…',icon:'folder'},
    'e-hjudge-choice':{title:'Выбор судьи',sub:'Выберите судью из справочника',search:'Поиск по ФИО судьи…',icon:'user'},
    'm-judge-choice':{title:'Выбор судьи',sub:'Выберите судью из справочника',search:'Поиск по ФИО судьи…',icon:'user'},
    'e-court-choice':{title:'Выбор суда',sub:'Выберите суд или участок',search:'Поиск по судам…',icon:'gavel'},
    'm-stage':{title:'Стадия дела',sub:'Текущий этап производства',search:'Поиск по стадиям…',icon:'flag'},
    'm-execution-issue':{title:'Вопрос исполнения приговора',sub:'Глава 47 УПК РФ · выберите предмет судебного рассмотрения',search:'Поиск по УДО, статье или вопросу…',icon:'gavel'},
    'm-restraint-choice':{title:'Мера пресечения',sub:'Выберите меру пресечения',search:'Поиск…',icon:'lock'},
    'm-type':{title:'Тип производства',sub:'Выберите категорию дела',search:'Поиск…',icon:'folder'},
    'm-basis':{title:'Основание ведения',sub:'Выберите основание работы по делу',search:'Поиск…',icon:'brief'},
    'e-deadline-code':{title:'Производство / кодекс',sub:'Выберите применимый кодекс',search:'Поиск…',icon:'doc'},
    'e-deadline-rule':{title:'Процессуальный срок',sub:'Выберите правило расчёта · '+legalDeadlineCount()+' сроков в базе',search:'Поиск по сроку или статье…',icon:'clock'},
    'pt-kind':{title:'Вид участия',sub:'Выберите вид процессуального действия',search:'Поиск…',icon:'gavel'}
  };
  return map[target]||{title:'Выбор',sub:'Выберите значение из списка',search:'Поиск…',icon:'list'};
}
function premiumListItemExtra(target,value,label){
  if((target==='e-mid'||target==='j-mid-select'||target==='pt-mid')&&value){
    var m=matter(value); if(m){
      var bits=[]; if(m.client)bits.push(m.client); if(m.number)bits.push('№ '+m.number); if(m.court)bits.push(m.court);
      return bits.join(' · ');
    }
  }
  if((target==='e-mid'||target==='j-mid-select'||target==='pt-mid')&&!value) return 'Запись без привязки к конкретному делу';
  if(target==='e-deadline-rule'&&value){
    var dr=legalDeadlineRule(value); if(dr)return dr.article+' · '+legalDeadlineTerm(dr);
  }
  if(target==='e-deadline-code'&&value){
    var dc=legalDeadlineCode(value); return legalDeadlineCount(value)+' '+plural(legalDeadlineCount(value),'срок','срока','сроков')+' в разделе';
  }
  if(target==='m-execution-issue'&&value){
    var exi=criminalExecutionIssue(value); if(exi)return exi.article+' · '+exi.jurisdictionLabel;
  }
  if(target==='e-hjudge-choice'||target==='m-judge-choice'){
    var j=knownJudgeEntry(value); if(j&&j.court)return j.court;
  }
  if(target==='e-court-choice'||target==='m-court-choice'){
    var c=commonCourtByValue(value); if(c&&c.short&&c.short!==label)return c.short;
    var org=matterInvestigationOrgByValue(value); if(org)return org.extra||org.short||'';
  }
  return '';
}
function judgePickerToneMeta(value){
  if(!value)return null;
  var entry=knownJudgeEntry(value), judge=(entry&&entry.judge)||value||'', surname=normLookup((judge||'').split(/\s+/)[0]), court=(entry&&entry.court)||'';
  if(CRIMINAL_JUDGE_SURNAMES[surname]) return {type:'judge-red',color:'#D96464',icon:'user'};
  if(/судебный участок/i.test(court)||/миров/i.test(court)) return {type:'judge-green',color:'#2FA36B',icon:'user'};
  return {type:'judge-blue',color:'#4E86C6',icon:'user'};
}
function premiumListMatterMeta(target,value){
  if(target==='e-deadline-code'){
    var codeMap={
      'GPK':{type:'gpk',color:'#4E86C6',icon:'doc'},
      'APK':{type:'apk',color:'#5F8FCD',icon:'doc'},
      'KAS':{type:'kas',color:'#49A88D',icon:'doc'},
      'UPK':{type:'upk',color:'#D96464',icon:'doc'},
      'KOAP':{type:'koap',color:'#C29130',icon:'doc'},
      'FSSP':{type:'fssp',color:'#9B78C8',icon:'doc'}
    };
    return codeMap[value]||{type:'other',color:'#7A8FA6',icon:'doc'};
  }
  if(target==='e-deadline-rule'&&value){
    var rr=legalDeadlineRule(value); if(rr){
      var ruleMap={GPK:['gpk','#4E86C6'],APK:['apk','#5F8FCD'],KAS:['kas','#49A88D'],UPK:['upk','#D96464'],KOAP:['koap','#C29130'],FSSP:['fssp','#9B78C8']};
      var rm=ruleMap[rr.code]||['other','#7A8FA6']; return {type:rm[0],color:rm[1],icon:'clock'};
    }
  }
  if(target==='m-type'&&value){
    var mtChoice=MATTER_TYPES[value]||MATTER_TYPES.other;
    return {type:'type-'+value,color:mtChoice.c||MATTER_TYPES.other.c,icon:matterCardIconName({type:value})||'folder'};
  }
  if(target==='m-basis'){
    var mbChoice=MATTER_BASIS[value]||null;
    if(mbChoice)return {type:'basis-'+value,color:mbChoice.c||'#7A8FA6',icon:value==='assigned'?'user':'brief'};
  }
  if(target==='m-stage'&&value){
    var sm=matterStageMeta(value); return {type:'stage-'+normLookup(value),color:sm.c||'#7A8FA6',icon:sm.icon||'flag'};
  }
  if(target==='m-execution-issue'&&value){
    return {type:'execution-issue',color:'#C29130',icon:'gavel'};
  }
  if(target==='m-role'&&value){
    var roleType=(MED&&MED.type)||'other',roleMatter=MATTER_TYPES[roleType]||MATTER_TYPES.other;
    return {type:'role-'+roleType,color:roleMatter.c||'#7A8FA6',icon:'user'};
  }
  if(target==='m-court-choice'&&value){
    var orgChoice=matterInvestigationOrgByValue(value);
    if(orgChoice)return {type:'org-'+orgChoice.kind,color:orgChoice.c||'#7A8FA6',icon:'brief'};
    var courtChoice=commonCourtByValue(value);
    if(courtChoice)return {type:courtChoice.main?'court-city':'court-world',color:courtChoice.main?'#4E86C6':'#2FA36B',icon:'gavel'};
  }
  if(target==='e-hjudge-choice'||target==='m-judge-choice') return judgePickerToneMeta(value);
  if(target!=='e-mid'&&target!=='j-mid-select'&&target!=='pt-mid')return null;
  if(!value)return {type:'none',color:'#B78A2F',icon:'folder'};
  var m=matter(value);if(!m)return {type:'other',color:MATTER_TYPES.other.c,icon:'folder'};
  var mt=MATTER_TYPES[m.type]||MATTER_TYPES.other;
  return {type:m.type||'other',color:mt.c||MATTER_TYPES.other.c,icon:matterCardIconName(m)||'folder'};
}
function premiumListSelectedValue(sel,inputId){
  if(inputId){var inp=$('#'+inputId);if(inp&&inp.value)return inp.value;}
  return sel?sel.value:'';
}
function openPremiumListPicker(target,inputId){
  var sel=target?$('#'+target):null;if(!sel||sel.tagName!=='SELECT')return;
  if(target==='m-judge-choice'){
    var courtNow=(($('#m-court')||{}).value||((MED&&MED.court)||'')).trim();
    var judgeNow=(($('#m-judge')||{}).value||((MED&&MED.judge)||'')).trim();
    sel.innerHTML=matterChoiceOptions(judgeDirectory(courtNow,(MED&&MED.type)||'',(MED&&MED.stage)||'').map(function(x){return x.judge;}),judgeNow,'— выбрать судью —');
  }
  if(target==='e-hjudge-choice'&&ED){
    var hearingCourtNow=(($('#e-place')||{}).value||ED.place||'').trim();
    var hearingJudgeNow=(($('#e-hjudge')||{}).value||ED.hearingJudge||'').trim();
    sel.innerHTML=judgeChoiceOptions(hearingJudgeNow,hearingCourtNow);
  }
  var meta=listPickerMeta(target),items=Array.prototype.slice.call(sel.options).map(function(o){
    var mm=premiumListMatterMeta(target,o.value);
    return {value:o.value,label:(o.textContent||o.label||o.value||'').trim(),disabled:!!o.disabled,extra:premiumListItemExtra(target,o.value,(o.textContent||'').trim()),matterMeta:mm};
  });
  // Пустые служебные варианты («выбрать судью», «выбрать меру», «выбрать вопрос» и т.п.)
  // остаются только техническим состоянием поля и не показываются отдельной строкой premium-списка.
  if(matterEditorPickerWithoutEmptyRow(target))items=items.filter(function(it){return !!String(it.value||'').trim();});
  LIST_PICKER={target:target,inputId:inputId||'',selected:premiumListSelectedValue(sel,inputId||''),query:'',items:items,meta:meta};
  renderPremiumListPicker();
  var modal=$('#premium-list-modal'),scr=$('#list-scrim');if(modal)modal.classList.add('open');if(scr)scr.classList.add('open');
  document.body.classList.add('premium-list-open');vib(5);
}
function closePremiumListPicker(){
  var modal=$('#premium-list-modal'),scr=$('#list-scrim');if(modal)modal.classList.remove('open');if(scr)scr.classList.remove('open');
  document.body.classList.remove('premium-list-open');LIST_PICKER=null;
}
function matterEditorPickerWithoutEmptyRow(target){
  return ['m-type','m-basis','m-stage','m-role','m-court-choice','m-judge-choice','m-restraint-choice','m-execution-issue'].indexOf(target)>=0;
}
function matterEditorPickerWithoutSearch(target){
  // Для вопроса исполнения приговора поиск оставляем: вариантов много.
  return ['m-type','m-basis','m-stage','m-role','m-court-choice','m-judge-choice','m-restraint-choice'].indexOf(target)>=0;
}
function renderPremiumListPicker(){
  if(!LIST_PICKER)return;var modal=$('#premium-list-modal');if(!modal)return;
  var noSearch=matterEditorPickerWithoutSearch(LIST_PICKER.target);
  var q=noSearch?'':(LIST_PICKER.query||'').trim().toLowerCase().replace(/ё/g,'е');
  var rows=LIST_PICKER.items.filter(function(it){
    if(!q)return true;return ((it.label||'')+' '+(it.extra||'')).toLowerCase().replace(/ё/g,'е').indexOf(q)>=0;
  });
  var search=noSearch?'':'<div class="premium-list-search">'+ico('search','s')+'<input id="premium-list-search" value="'+esc(LIST_PICKER.query||'')+'" placeholder="'+esc(LIST_PICKER.meta.search||'Поиск…')+'" autocomplete="off"></div>';
  var list=rows.length?rows.map(function(it){
    var selected=String(it.value)===String(LIST_PICKER.selected||''), empty=!it.value, mm=it.matterMeta||null;
    var rowClass='premium-list-row'+(selected?' selected':'')+(empty?' empty':'')+(mm?' matter-option matter-'+esc(mm.type||'other'):'');
    var rowStyle=mm?' style="--matter-color:'+esc(mm.color||'#7A8FA6')+'"':'';
    var markIcon=mm?(mm.icon||'folder'):(LIST_PICKER.meta.icon||'list');
    return '<button type="button" class="'+rowClass+'"'+rowStyle+' data-act="list-pick" data-v="'+esc(it.value)+'"'+(it.disabled?' disabled':'')+'>'+ 
      '<span class="premium-list-row-mark">'+(selected?ico('check','s'):ico(markIcon,'s'))+'</span>'+ 
      '<span class="premium-list-row-copy"><b>'+esc(it.label||'— выбрать —')+'</b>'+(it.extra?'<small>'+esc(it.extra)+'</small>':'')+'</span>'+ 
      '<span class="premium-list-row-end">'+(selected?'<em>Выбрано</em>':ico('chev','s'))+'</span></button>';
  }).join(''):'<div class="premium-list-empty">'+ico('search')+'<b>Ничего не найдено</b><small>Измените поисковый запрос.</small></div>';
  modal.innerHTML='<div class="premium-list-grab"></div>'+ 
    '<div class="premium-list-head"><span class="premium-list-head-icon">'+ico(LIST_PICKER.meta.icon||'list')+'</span><div><h3>'+esc(LIST_PICKER.meta.title)+'</h3><p>'+esc(LIST_PICKER.meta.sub)+'</p></div><button type="button" class="premium-list-close" data-act="list-close" aria-label="Закрыть">'+ico('xmark','s')+'</button></div>'+ 
    search+'<div class="premium-list-body">'+list+'</div>'+ 
    '<div class="premium-list-sign"><i></i><span><img class="premium-list-sign-logo" src="scale-gold.png?v=4098" alt="Весы правосудия"></span><i></i></div>';
}
function syncPremiumSelectButton(id){
  var sel=id?$('#'+id):null;if(!sel)return;var btn=document.querySelector('[data-premium-select-for="'+id+'"]');if(!btn)return;
  var inMatterEditor=!!sel.closest('.matter-editor-sheet');
  var opt=sel.options&&sel.selectedIndex>=0?sel.options[sel.selectedIndex]:null,label=opt?(opt.textContent||opt.label||'').trim():'— выбрать —';
  if(id==='m-role'&&sel.value)label=matterRoleDisplayLabel((MED&&MED.type)||'other',(MED&&MED.stage)||'',sel.value);
  if(inMatterEditor&&!sel.value)label='';
  var b=btn.querySelector('b');if(b)b.textContent=label||(inMatterEditor?'':'— выбрать —');btn.classList.toggle('empty',!sel.value);
  var tone=(id==='m-type'||id==='m-basis'||id==='m-stage'||id==='m-role')?premiumListMatterMeta(id,sel.value):null;
  btn.classList.toggle('matter-choice-tone',!!tone);
  if(tone){btn.style.setProperty('--matter-choice-color',tone.color||'#7A8FA6');btn.dataset.matterTone=tone.type||'other';}
  else{btn.style.removeProperty('--matter-choice-color');delete btn.dataset.matterTone;}
}
function upgradePremiumSelects(root){
  root=root||document;
  Array.prototype.slice.call(root.querySelectorAll('select')).forEach(function(sel){
    if(!sel.id||sel.dataset.premiumReady==='1')return;
    sel.dataset.premiumReady='1';
    if(sel.classList.contains('inline-choice-select')){
      sel.classList.add('premium-select-native');
      // Скрытый native select служит только источником данных для нашего
      // premium picker и никогда не должен открывать системный iOS picker.
      sel.tabIndex=-1;
      sel.setAttribute('aria-hidden','true');
      sel.style.pointerEvents='none';
      var wrap=sel.closest('.inline-choice-wrap');if(!wrap)return;
      var inp=wrap.querySelector('input'),old=wrap.querySelector('.inline-choice-arrow');if(old)old.remove();
      var inMatterInline=!!sel.closest('.matter-editor-sheet');
      if(inMatterInline)wrap.classList.add('matter-inline-choice-clean');
      var trigger=document.createElement('button');trigger.type='button';trigger.className='inline-choice-arrow premium-list-trigger'+(inMatterInline?' matter-choice-chevron-clean':'');trigger.dataset.act='list-open';trigger.dataset.target=sel.id;trigger.dataset.input=inp?inp.id:'';trigger.setAttribute('aria-label','Выбрать из списка');trigger.style.pointerEvents='auto';trigger.style.touchAction='manipulation';trigger.innerHTML=ico('chev','s');
      wrap.appendChild(trigger);return;
    }
    var parent=sel.parentNode;if(!parent)return;
    var wrap2=document.createElement('div');wrap2.className='premium-select-wrap';parent.insertBefore(wrap2,sel);wrap2.appendChild(sel);sel.classList.add('premium-select-native');
    var btn=document.createElement('button');btn.type='button';btn.className='premium-select-field';btn.dataset.act='list-open';btn.dataset.target=sel.id;btn.dataset.premiumSelectFor=sel.id;btn.innerHTML='<span class="premium-select-field-copy"><b></b></span><span class="premium-select-field-arrow">'+ico('chev','s')+'</span>';
    wrap2.appendChild(btn);syncPremiumSelectButton(sel.id);
  });
}
var PREMIUM_SELECT_OBSERVER=null;
function startPremiumSelectObserver(){
  if(PREMIUM_SELECT_OBSERVER||!window.MutationObserver)return;
  PREMIUM_SELECT_OBSERVER=new MutationObserver(function(muts){
    var roots=[];
    muts.forEach(function(m){Array.prototype.forEach.call(m.addedNodes||[],function(n){if(n&&n.nodeType===1)roots.push(n);});});
    roots.forEach(function(n){
      if(n.matches&&n.matches('select')) upgradePremiumSelects(n.parentNode||document);
      else if(n.querySelector&&n.querySelector('select')) upgradePremiumSelects(n);
    });
  });
  PREMIUM_SELECT_OBSERVER.observe(document.body,{childList:true,subtree:true});
}
setTimeout(function(){upgradePremiumSelects(document);startPremiumSelectObserver();},0);

function applyPremiumListChoice(value){
  if(!LIST_PICKER)return;var lp=LIST_PICKER,sel=$('#'+lp.target);if(!sel)return;
  var item=lp.items.filter(function(x){return String(x.value)===String(value);})[0];if(!item||item.disabled)return;
  LIST_PICKER.selected=item.value;
  sel.value=item.value;
  if(lp.inputId&&!item.value){var inp=$('#'+lp.inputId);if(inp){inp.value='';inp.dispatchEvent(new Event('input',{bubbles:true}));}}
  syncPremiumSelectButton(sel.id);
  sel.dispatchEvent(new Event('change',{bubbles:true}));
  closePremiumListPicker();vib(5);
}

function russianPhoneDigits(value){
  var digits=String(value||'').replace(/\D/g,'');
  if(!digits)return '';
  if(digits.charAt(0)==='8')digits='7'+digits.slice(1);
  else if(digits.charAt(0)!=='7')digits='7'+digits;
  return digits.slice(0,11);
}
function formatRussianPhone(value){
  var digits=russianPhoneDigits(value);
  if(!digits)return '';
  var n=digits.slice(1),out='+7';
  if(n.length){out+=' ('+n.slice(0,3);if(n.length>=3)out+=')';}
  if(n.length>3)out+=' '+n.slice(3,6);
  if(n.length>6)out+='-'+n.slice(6,8);
  if(n.length>8)out+='-'+n.slice(8,10);
  return out;
}
function phoneDigitCountBefore(value,pos){
  var s=String(value||''),end=Math.max(0,Math.min(typeof pos==='number'?pos:s.length,s.length)),n=0;
  for(var i=0;i<end;i++)if(/\d/.test(s.charAt(i)))n++;
  return n;
}
function phoneCaretAfterDigits(value,count){
  var s=String(value||'');
  if(count<=0)return 0;
  var seen=0;
  for(var i=0;i<s.length;i++){
    if(/\d/.test(s.charAt(i))){seen++;if(seen>=count)return i+1;}
  }
  return s.length;
}
function setPhoneValueAndCaret(input,digits,caretDigitCount){
  var masked=formatRussianPhone(digits);
  input.value=masked;
  if(MED)MED.phone=masked;
  var pos=phoneCaretAfterDigits(masked,Math.min(caretDigitCount,russianPhoneDigits(masked).length));
  try{input.setSelectionRange(pos,pos);}catch(_){ }
}
function handlePhoneDeleteKey(e){
  var input=e.target;
  if(!input||input.id!=='m-phone'||(e.key!=='Backspace'&&e.key!=='Delete'))return false;
  if(e.metaKey||e.ctrlKey||e.altKey)return false;
  var value=input.value||'',start=input.selectionStart==null?value.length:input.selectionStart,end=input.selectionEnd==null?start:input.selectionEnd;
  var positions=[],digits='';
  for(var i=0;i<value.length;i++)if(/\d/.test(value.charAt(i))){positions.push(i);digits+=value.charAt(i);}
  if(!digits)return false;
  var keep=[],caretDigits=phoneDigitCountBefore(value,start),removed=false;
  if(start!==end){
    for(var j=0;j<positions.length;j++){
      if(positions[j]>=start&&positions[j]<end){removed=true;continue;}
      keep.push(digits.charAt(j));
    }
  }else{
    var target=-1;
    if(e.key==='Backspace'){
      for(var b=positions.length-1;b>=0;b--)if(positions[b]<start){target=b;break;}
      if(target>=0)caretDigits=Math.max(0,caretDigits-1);
    }else{
      for(var d=0;d<positions.length;d++)if(positions[d]>=start){target=d;break;}
    }
    if(target<0)return false;
    for(var k=0;k<digits.length;k++){
      if(k===target){removed=true;continue;}
      keep.push(digits.charAt(k));
    }
  }
  if(!removed)return false;
  e.preventDefault();
  var next=keep.join('');
  /* Если удалён только префикс 7 при оставшихся цифрах, сохраняем российский префикс. */
  if(next&&next.charAt(0)!=='7')next='7'+next;
  setPhoneValueAndCaret(input,next,caretDigits);
  return true;
}

function relD(s){ var n = dd(s);
  if(n===0) return 'сегодня'; if(n===1) return 'завтра'; if(n===-1) return 'вчера';
  if(n<0) return 'просрочено '+(-n)+' дн.'; if(n<=6) return 'через '+n+' дн.'; return fmtShort(s); }
function money(n){ return (Math.round(n)).toLocaleString('ru-RU')+' '+S.settings.cur; }
function hm(min){ var h = Math.floor(min/60), m = min%60; return (h?h+' ч ':'')+(m||!h?m+' мин':''); }
function toast(m){ var t = $('#toast'); t.textContent = m; t.classList.add('on');
  clearTimeout(t._t); t._t = setTimeout(function(){ t.classList.remove('on'); }, 2200); }
function vib(n){ if(navigator.vibrate) navigator.vibrate(n||8); }

var PAL = ['#C9A227','#4E86C6','#2FA36B','#8B7BD8','#D9724A','#3FA9A0','#C05C8E','#7A8FA6'];
function mColor(id){ var h = 0; for(var i=0;i<String(id).length;i++) h = (h*31 + String(id).charCodeAt(i))>>>0;
  return PAL[h % PAL.length]; }
function initials(s){ s = (s||'?').trim().split(/[\s—-]+/).filter(Boolean);
  return ((s[0]||'?')[0] + (s[1]?s[1][0]:'')).toUpperCase(); }

var KIND = {
  task:    {n:'Задача',      i:'check'},
  hearing: {n:'Заседание',   i:'gavel'},
  meeting: {n:'Встреча',     i:'user'},
  call:    {n:'Звонок',      i:'phone'},
  doc:     {n:'Документ',    i:'doc'},
  deadline:{n:'Процессуальный срок', i:'flag'}
};
var EDITOR_KINDS = ['task','hearing','meeting','deadline'];
var LEGAL_DEADLINE_CODES = [
  {id:'GPK',name:'ГПК РФ'},
  {id:'APK',name:'АПК РФ'},
  {id:'KAS',name:'КАС РФ'},
  {id:'UPK',name:'УПК РФ'},
  {id:'KOAP',name:'КоАП РФ'},
  {id:'FSSP',name:'229-ФЗ · ФССП'}
];
var LEGAL_DEADLINE_RULES = [
  /* ГПК РФ */
  {id:'gpk-appeal',code:'GPK',name:'Апелляционная жалоба на решение',article:'ч. 2 ст. 321 ГПК РФ',unit:'months',n:1,dateLabel:'Дата принятия решения в окончательной форме',note:'1 месяц со дня принятия решения суда в окончательной форме.'},
  {id:'gpk-simple-appeal',code:'GPK',name:'Апелляция — упрощённое производство',shortName:'Апелляция — упрощённое',article:'ч. 8 ст. 232.4 ГПК РФ',unit:'workdays',n:15,dateLabel:'Дата принятия решения / окончательной формы',note:'15 рабочих дней; если составлено мотивированное решение — со дня его принятия в окончательной форме.'},
  {id:'gpk-private',code:'GPK',name:'Частная жалоба на определение — общий срок',shortName:'Частная жалоба — общая',article:'ст. 332 ГПК РФ',unit:'workdays',n:15,dateLabel:'Дата вынесения определения',note:'15 рабочих дней, если иной специальный срок прямо не установлен ГПК РФ.'},
  {id:'gpk-order',code:'GPK',name:'Возражения на судебный приказ',shortName:'Возражения на приказ',article:'ст. 128 ГПК РФ',unit:'workdays',n:10,dateLabel:'Дата получения судебного приказа',note:'10 рабочих дней со дня получения судебного приказа.'},
  {id:'gpk-default',code:'GPK',name:'Заявление об отмене заочного решения',shortName:'Отмена заочного решения',article:'ч. 1 ст. 237 ГПК РФ',unit:'workdays',n:7,dateLabel:'Дата вручения копии заочного решения',note:'7 рабочих дней со дня вручения копии заочного решения ответчику.'},
  {id:'gpk-default-appeal-no-cancel',code:'GPK',name:'Апелляция заочного решения — заявление об отмене не подавалось',shortName:'Заочное: апелляция без отмены',article:'ч. 2 ст. 237 ГПК РФ',unit:'months',n:1,dateLabel:'Дата истечения 7-дневного срока на заявление об отмене',note:'Для иных лиц, участвующих в деле, и лиц, не привлечённых к участию в деле: 1 месяц по истечении срока подачи ответчиком заявления об отмене заочного решения, если такое заявление не подавалось.'},
  {id:'gpk-default-appeal-refusal',code:'GPK',name:'Апелляция заочного решения — после отказа в отмене',shortName:'Заочное: апелляция после отказа',article:'ч. 2 ст. 237 ГПК РФ',unit:'months',n:1,dateLabel:'Дата вынесения определения об отказе в отмене',note:'1 месяц со дня вынесения определения об отказе в удовлетворении заявления об отмене заочного решения.'},
  {id:'gpk-magistrate-motive-present',code:'GPK',name:'Мотивированное решение мирового судьи — участник был в заседании',shortName:'Мировой судья: мотивировка — был',article:'п. 1 ч. 4 ст. 199 ГПК РФ',unit:'workdays',n:3,dateLabel:'Дата объявления резолютивной части',note:'3 рабочих дня со дня объявления резолютивной части решения.'},
  {id:'gpk-magistrate-motive-absent',code:'GPK',name:'Мотивированное решение мирового судьи — участник отсутствовал',shortName:'Мировой судья: мотивировка — не был',article:'п. 2 ч. 4 ст. 199 ГПК РФ',unit:'workdays',n:15,dateLabel:'Дата объявления резолютивной части',note:'15 рабочих дней со дня объявления резолютивной части решения.'},
  {id:'gpk-simple-motive',code:'GPK',name:'Заявление о мотивированном решении — упрощённое',shortName:'Упрощённое: мотивировка',article:'ч. 3 ст. 232.4 ГПК РФ',unit:'workdays',n:5,dateLabel:'Дата подписания резолютивной части',note:'5 рабочих дней со дня подписания резолютивной части решения.'},
  {id:'gpk-child-return-appeal',code:'GPK',name:'Апелляция — возвращение ребёнка / права доступа',shortName:'Возвращение ребёнка: апелляция',article:'ст. 244.17 ГПК РФ',unit:'workdays',n:10,dateLabel:'Дата принятия решения в окончательной форме',note:'10 рабочих дней со дня принятия решения суда в окончательной форме.'},
  {id:'gpk-child-return-private',code:'GPK',name:'Частная жалоба — возвращение ребёнка / права доступа',shortName:'Возвращение ребёнка: частная',article:'ст. 244.18 ГПК РФ',unit:'workdays',n:10,dateLabel:'Дата вынесения определения',note:'10 рабочих дней со дня вынесения определения суда первой инстанции по заявлению о возвращении ребёнка или об осуществлении прав доступа.'},
  {id:'gpk-indexation',code:'GPK',name:'Заявление об индексации присуждённых денежных сумм',shortName:'Индексация присуждённых сумм',article:'ст. 208 ГПК РФ',unit:'years',n:1,dateLabel:'Дата исполнения должником судебного акта',note:'Не более 1 года со дня исполнения должником судебного акта. При уважительных причинах срок может быть восстановлен.'},
  {id:'gpk-cass',code:'GPK',name:'Кассационная жалоба — кассационный суд общей юрисдикции',shortName:'Кассация — КСОЮ',article:'ст. 376.1 ГПК РФ',unit:'months',n:3,dateLabel:'Дата вступления акта в силу / мотивированного апелляционного определения',note:'3 месяца. Если акт обжаловался в апелляции — со дня изготовления мотивированного апелляционного определения. Для актов мировых судей после 10.05.2026 действует отдельный маршрут в президиум суда субъекта РФ.'},
  {id:'gpk-magistrate-cass',code:'GPK',name:'Кассация актов мирового судьи — президиум суда субъекта РФ',shortName:'Мировой судья: кассация',article:'ст. 375.1, 375.2 ГПК РФ',unit:'months',n:3,dateLabel:'Дата вступления акта в силу / мотивированного апелляционного определения',note:'3 месяца. С 10.05.2026 кассационные жалобы на судебные приказы, решения и определения мирового судьи, а также связанные с ними апелляционные акты районного суда подаются в президиум суда субъекта РФ.'},
  {id:'gpk-cass-return',code:'GPK',name:'Жалоба на определение о возвращении кассационной жалобы',shortName:'Возврат кассации',article:'ст. 379.2 ГПК РФ',unit:'months',n:1,dateLabel:'Дата вынесения определения о возвращении',note:'1 месяц со дня вынесения определения о возвращении кассационной жалобы без рассмотрения по существу.'},
  {id:'gpk-vs-cass',code:'GPK',name:'Кассационная жалоба в судебную коллегию Верховного Суда РФ',shortName:'Кассация в ВС РФ',article:'ст. 390.3 ГПК РФ',unit:'months',n:3,dateLabel:'Дата вынесения определения кассационным судом / президиумом',note:'3 месяца со дня вынесения определения кассационным судом общей юрисдикции либо иного обжалуемого кассационного акта.'},
  {id:'gpk-supervision',code:'GPK',name:'Надзорная жалоба',shortName:'Надзорная жалоба',article:'ч. 2 ст. 391.2 ГПК РФ',unit:'months',n:3,dateLabel:'Дата вступления судебного постановления в законную силу',note:'3 месяца со дня вступления обжалуемого судебного постановления в законную силу.'},
  {id:'gpk-new',code:'GPK',name:'Пересмотр по новым / вновь открывшимся обстоятельствам',shortName:'Новые / вновь открывшиеся',article:'ст. 394 ГПК РФ',unit:'months',n:3,dateLabel:'Дата установления основания для пересмотра',note:'3 месяца со дня установления основания для пересмотра; конкретный момент начала срока определяется ст. 395 ГПК РФ.'},
  {id:'gpk-costs',code:'GPK',name:'Заявление о судебных расходах',shortName:'Судебные расходы',article:'ст. 103.1 ГПК РФ',unit:'months',n:3,dateLabel:'Дата вступления в силу последнего судебного акта',note:'3 месяца со дня вступления в законную силу последнего судебного акта, которым закончено рассмотрение дела.'},
  {id:'gpk-settlement-cass',code:'GPK',name:'Кассация определения об утверждении мирового соглашения',shortName:'Мировое соглашение: кассация',article:'ч. 11 ст. 153.10 ГПК РФ',unit:'months',n:1,dateLabel:'Дата вынесения определения',note:'1 месяц со дня вынесения определения об утверждении мирового соглашения.'},
  {id:'gpk-arbitral-competence',code:'GPK',name:'Отмена предварительного постановления третейского суда о компетенции',shortName:'Третейский суд: компетенция',article:'ст. 422.1 ГПК РФ',unit:'months',n:1,dateLabel:'Дата получения предварительного постановления третейского суда',note:'1 месяц со дня получения стороной постановления третейского суда предварительного характера о наличии у него компетенции.'},
  {id:'gpk-foreign-enforce',code:'GPK',name:'Предъявление решения иностранного суда к принудительному исполнению',shortName:'Иностранное решение: исполнение',article:'ч. 3 ст. 409 ГПК РФ',unit:'years',n:3,dateLabel:'Дата вступления решения иностранного суда в законную силу',note:'3 года со дня вступления решения иностранного суда в законную силу. Пропущенный по уважительной причине срок может быть восстановлен.'},
  {id:'gpk-foreign-recognition-objection',code:'GPK',name:'Возражения против признания решения иностранного суда',shortName:'Иностранное решение: возражения',article:'ч. 2 ст. 413 ГПК РФ',unit:'months',n:1,dateLabel:'Дата, когда стало известно о решении иностранного суда',note:'1 месяц после того, как заинтересованному лицу стало известно о решении иностранного суда, не требующем принудительного исполнения.'},
  {id:'gpk-arbitral-enforce',code:'GPK',name:'Заявление о выдаче исполнительного листа на решение третейского суда',shortName:'Третейское решение: исполнение',article:'гл. 47 ГПК РФ; ст. 41 Закона № 382-ФЗ',unit:'years',n:3,dateLabel:'Дата принятия решения / окончания срока добровольного исполнения',note:'Как правило, не более 3 лет со дня принятия решения третейского суда либо окончания установленного им срока добровольного исполнения. Проверьте условия конкретного решения и применимый закон.'},
  {id:'gpk-arbitral-cancel',code:'GPK',name:'Заявление об отмене решения третейского суда',shortName:'Отмена решения третейского суда',article:'ч. 2 ст. 418 ГПК РФ',unit:'months',n:3,dateLabel:'Дата получения решения третейского суда',note:'Не позднее 3 месяцев со дня получения оспариваемого решения стороной.'},

  /* АПК РФ */
  {id:'apk-appeal',code:'APK',name:'Апелляционная жалоба на решение',shortName:'Апелляционная жалоба',article:'ч. 1 ст. 259 АПК РФ',unit:'months',n:1,dateLabel:'Дата принятия решения',note:'1 месяц после принятия решения, если иной срок не установлен АПК РФ.'},
  {id:'apk-simple-appeal',code:'APK',name:'Апелляция — упрощённое производство',shortName:'Апелляция — упрощённое',article:'ч. 4 ст. 229 АПК РФ',unit:'workdays',n:15,dateLabel:'Дата принятия решения / решения в полном объёме',note:'15 рабочих дней; при составлении мотивированного решения — со дня принятия решения в полном объёме.'},
  {id:'apk-ruling',code:'APK',name:'Жалоба на определение суда — общий срок',shortName:'Определение — общий срок',article:'ч. 3 ст. 188 АПК РФ',unit:'months',n:1,dateLabel:'Дата вынесения определения',note:'Не более 1 месяца со дня вынесения определения, если иной срок не установлен АПК РФ.'},
  {id:'apk-transfer',code:'APK',name:'Жалоба на определение о передаче дела',shortName:'Передача дела',article:'ч. 5 ст. 39 АПК РФ',unit:'workdays',n:10,dateLabel:'Дата вынесения определения',note:'10 рабочих дней со дня вынесения определения о передаче дела в другой арбитражный суд либо об отказе в передаче.'},
  {id:'apk-joinder',code:'APK',name:'Жалоба на отказ во вступлении соистца / привлечении соответчика',shortName:'Соистец / соответчик',article:'ч. 7 ст. 46 АПК РФ',unit:'workdays',n:10,dateLabel:'Дата вынесения определения',note:'10 рабочих дней со дня вынесения соответствующего определения.'},
  {id:'apk-thirdparty',code:'APK',name:'Жалоба на отказ во вступлении третьего лица',shortName:'Третье лицо',article:'ч. 4 ст. 50, ч. 3.1 ст. 51 АПК РФ',unit:'workdays',n:10,dateLabel:'Дата вынесения определения',note:'10 рабочих дней со дня вынесения определения об отказе во вступлении в дело третьего лица.'},
  {id:'apk-fine',code:'APK',name:'Жалоба на определение о наложении судебного штрафа',shortName:'Судебный штраф',article:'ч. 6 ст. 120 АПК РФ',unit:'workdays',n:10,dateLabel:'Дата получения копии определения',note:'10 рабочих дней со дня получения копии определения о наложении судебного штрафа.'},
  {id:'apk-merge',code:'APK',name:'Жалоба на отказ в объединении / выделении требований',shortName:'Объединение / выделение',article:'ч. 7 ст. 130 АПК РФ',unit:'workdays',n:10,dateLabel:'Дата вынесения определения',note:'10 рабочих дней со дня вынесения определения.'},
  {id:'apk-private-ruling',code:'APK',name:'Жалоба на частное определение',shortName:'Частное определение',article:'ст. 188.1 АПК РФ',unit:'workdays',n:10,dateLabel:'Дата вынесения частного определения',note:'10 рабочих дней со дня вынесения частного определения (с учётом разъяснений Пленума ВС РФ по апелляции в арбитражном процессе).'},
  {id:'apk-public-act-challenge',code:'APK',name:'Заявление об оспаривании ненормативного акта / решения / действия органа',shortName:'Ненормативный акт / действие',article:'ч. 4 ст. 198 АПК РФ',unit:'months',n:3,dateLabel:'Дата, когда стало известно о нарушении прав',note:'3 месяца со дня, когда гражданину или организации стало известно о нарушении прав и законных интересов, если иной срок не установлен федеральным законом.'},
  {id:'apk-admin-agency-initial',code:'APK',name:'Заявление об оспаривании решения административного органа о привлечении к ответственности',shortName:'Адм. орган: оспаривание в суд',article:'ч. 2 ст. 208 АПК РФ',unit:'workdays',n:10,dateLabel:'Дата получения копии решения административного органа',note:'10 рабочих дней со дня получения копии оспариваемого решения, если иной срок не установлен федеральным законом.'},
  {id:'apk-admin-liability',code:'APK',name:'Апелляция по делу о привлечении к административной ответственности',shortName:'Адм. ответственность: апелляция',article:'ч. 4 ст. 206 АПК РФ',unit:'workdays',n:10,dateLabel:'Дата принятия решения',note:'10 рабочих дней со дня принятия решения арбитражного суда.'},
  {id:'apk-admin-agency',code:'APK',name:'Апелляция по делу об оспаривании решения административного органа',shortName:'Решение адм. органа: апелляция',article:'ч. 5 ст. 211 АПК РФ',unit:'workdays',n:10,dateLabel:'Дата принятия решения',note:'10 рабочих дней со дня принятия решения арбитражного суда.'},
  {id:'apk-corporate-ruling',code:'APK',name:'Жалоба на определение по корпоративному спору',shortName:'Корпоративное определение',article:'ст. 225.9 АПК РФ',unit:'workdays',n:10,dateLabel:'Дата вынесения определения',note:'10 рабочих дней со дня вынесения определения, если специальной нормой не предусмотрено иное.'},
  {id:'apk-order',code:'APK',name:'Возражения на судебный приказ',shortName:'Возражения на приказ',article:'ч. 3 ст. 229.5 АПК РФ',unit:'workdays',n:10,dateLabel:'Дата получения копии судебного приказа',note:'10 рабочих дней со дня получения копии судебного приказа.'},
  {id:'apk-order-return',code:'APK',name:'Жалоба на возврат / отказ в принятии заявления о судебном приказе',shortName:'Приказ: возврат / отказ',article:'ч. 4 ст. 229.4 АПК РФ',unit:'workdays',n:15,dateLabel:'Дата вынесения определения',note:'15 рабочих дней со дня вынесения определения.'},
  {id:'apk-simple-motive',code:'APK',name:'Заявление о мотивированном решении — упрощённое',shortName:'Упрощённое: мотивировка',article:'ч. 2 ст. 229 АПК РФ',unit:'workdays',n:5,dateLabel:'Дата размещения решения в сети Интернет',note:'5 рабочих дней со дня размещения решения, принятого в упрощённом производстве.'},
  {id:'apk-cass',code:'APK',name:'Кассационная жалоба в арбитражный суд округа',shortName:'Кассация — округ',article:'ч. 1 ст. 276 АПК РФ',unit:'months',n:2,dateLabel:'Дата вступления судебного акта в законную силу',note:'Не более 2 месяцев со дня вступления обжалуемого судебного акта в законную силу.'},
  {id:'apk-ruling-cass',code:'APK',name:'Кассация постановления апелляции по определению первой инстанции',shortName:'Определение: кассация',article:'ч. 5 ст. 188 АПК РФ',unit:'months',n:1,dateLabel:'Дата вступления постановления апелляции в законную силу',note:'1 месяц со дня вступления постановления арбитражного суда апелляционной инстанции в законную силу.'},
  {id:'apk-vs-cass',code:'APK',name:'Кассационная жалоба в Судебную коллегию ВС РФ',shortName:'Кассация в ВС РФ',article:'ч. 1 ст. 291.2 АПК РФ',unit:'months',n:2,dateLabel:'Дата вступления обжалуемого судебного акта в законную силу',note:'2 месяца со дня вступления в законную силу последнего обжалуемого судебного акта.'},
  {id:'apk-supervision',code:'APK',name:'Надзорная жалоба в Верховный Суд РФ',shortName:'Надзорная жалоба',article:'ч. 4 ст. 308.1 АПК РФ',unit:'months',n:3,dateLabel:'Дата вступления обжалуемого судебного акта в законную силу',note:'3 месяца со дня вступления обжалуемого судебного акта в законную силу.'},
  {id:'apk-new',code:'APK',name:'Пересмотр по новым / вновь открывшимся обстоятельствам',shortName:'Новые / вновь открывшиеся',article:'ч. 1 ст. 312 АПК РФ',unit:'months',n:3,dateLabel:'Дата появления / открытия обстоятельства',note:'3 месяца со дня появления или открытия обстоятельств; конкретный момент начала срока определяется ст. 312 АПК РФ.'},
  {id:'apk-costs',code:'APK',name:'Заявление о судебных расходах',shortName:'Судебные расходы',article:'ч. 2 ст. 112 АПК РФ',unit:'months',n:3,dateLabel:'Дата вступления в силу последнего судебного акта',note:'3 месяца со дня вступления в законную силу последнего судебного акта.'},
  {id:'apk-settlement-cass',code:'APK',name:'Кассация определения об утверждении мирового соглашения',shortName:'Мировое соглашение: кассация',article:'ч. 11 ст. 141 АПК РФ',unit:'months',n:1,dateLabel:'Дата вынесения определения',note:'1 месяц со дня вынесения определения об утверждении мирового соглашения.'},
  {id:'apk-indexation',code:'APK',name:'Заявление об индексации присуждённых денежных сумм',shortName:'Индексация присуждённых сумм',article:'ст. 183 АПК РФ',unit:'years',n:1,dateLabel:'Дата исполнения должником судебного акта',note:'Не более 1 года со дня исполнения должником судебного акта. При уважительных причинах срок может быть восстановлен.'},
  {id:'apk-arbitral-competence',code:'APK',name:'Отмена предварительного постановления третейского суда о компетенции',shortName:'Третейский суд: компетенция',article:'ст. 235 АПК РФ',unit:'months',n:1,dateLabel:'Дата получения постановления третейского суда',note:'1 месяц после получения стороной третейского разбирательства предварительного постановления третейского суда о наличии у него компетенции.'},
  {id:'apk-foreign-recognition-objection',code:'APK',name:'Возражения против признания иностранного решения',shortName:'Иностранное решение: возражения',article:'ч. 3 ст. 245.1 АПК РФ',unit:'months',n:1,dateLabel:'Дата, когда стало известно об иностранном решении',note:'1 месяц после того, как заинтересованному лицу стало известно о решении иностранного суда или иностранном арбитражном решении, не требующем принудительного исполнения.'},
  {id:'apk-foreign-enforce',code:'APK',name:'Предъявление иностранного решения к принудительному исполнению',shortName:'Иностранное решение: исполнение',article:'ч. 2 ст. 246 АПК РФ',unit:'years',n:3,dateLabel:'Дата вступления иностранного решения в законную силу',note:'Не более 3 лет со дня вступления иностранного решения в законную силу. Пропущенный срок может быть восстановлен арбитражным судом.'},
  {id:'apk-foreign-ruling-cass',code:'APK',name:'Кассация определения о признании / приведении в исполнение иностранного решения',shortName:'Иностранное решение: кассация',article:'ч. 3 ст. 245 АПК РФ',unit:'months',n:1,dateLabel:'Дата вынесения определения',note:'1 месяц со дня вынесения определения арбитражного суда о признании и приведении в исполнение иностранного решения либо об отказе.'},
  {id:'apk-arbitral-enforce',code:'APK',name:'Заявление о выдаче исполнительного листа на решение третейского суда',shortName:'Третейское решение: исполнение',article:'§ 2 гл. 30 АПК РФ; ст. 41 Закона № 382-ФЗ',unit:'years',n:3,dateLabel:'Дата принятия решения / окончания срока добровольного исполнения',note:'Как правило, не более 3 лет со дня принятия решения третейского суда либо окончания установленного им срока добровольного исполнения. Проверьте условия конкретного решения.'},
  {id:'apk-arbitral-cancel',code:'APK',name:'Заявление об отмене решения третейского суда',shortName:'Отмена решения третейского суда',article:'ст. 230 АПК РФ',unit:'months',n:3,dateLabel:'Дата получения решения третейского суда',note:'Не позднее 3 месяцев со дня получения оспариваемого решения стороной.'},

  /* КАС РФ */
  {id:'kas-order',code:'KAS',name:'Возражения относительно исполнения судебного приказа',shortName:'Возражения на судебный приказ',article:'ч. 3 ст. 123.5 КАС РФ',unit:'workdays',n:20,dateLabel:'Дата направления должнику копии судебного приказа',note:'20 рабочих дней со дня направления копии судебного приказа должнику. В КАС РФ исходной датой является именно дата направления, а не получения.'},
  {id:'kas-indexation',code:'KAS',name:'Заявление об индексации присуждённых денежных сумм',shortName:'Индексация присуждённых сумм',article:'ст. 189.1 КАС РФ',unit:'years',n:1,dateLabel:'Дата исполнения должником судебного акта',note:'Не более 1 года со дня исполнения должником судебного акта. При уважительных причинах срок может быть восстановлен.'},
  {id:'kas-simple-cancel-nonparty',code:'KAS',name:'Отмена упрощённого решения по заявлению лица, не привлечённого к делу',shortName:'Упрощённое: отмена для неучастника',article:'ст. 294.1 КАС РФ',unit:'months',n:2,dateLabel:'Дата принятия решения в упрощённом порядке',note:'Заявление лица, не привлечённого к участию в деле, о правах и обязанностях которого принято решение, должно поступить в суд в течение 2 месяцев после принятия решения.'},
  {id:'kas-appeal',code:'KAS',name:'Апелляционная жалоба — общий срок',shortName:'Апелляция — общая',article:'ч. 1 ст. 298 КАС РФ',unit:'months',n:1,dateLabel:'Дата принятия решения в окончательной форме',note:'1 месяц со дня принятия решения суда в окончательной форме, если КАС РФ не установлен специальный срок.'},
  {id:'kas-simple-appeal',code:'KAS',name:'Апелляция — упрощённое (письменное) производство',shortName:'Апелляция — упрощённое',article:'ст. 294 КАС РФ',unit:'workdays',n:15,dateLabel:'Дата получения копии решения',note:'15 рабочих дней со дня получения лицом, участвующим в деле, копии решения.'},
  {id:'kas-appeal-municipal',code:'KAS',name:'Апелляция — досрочное прекращение полномочий / самороспуск',shortName:'Апелляция — муниципальная',article:'ч. 2 ст. 298 КАС РФ',unit:'workdays',n:10,dateLabel:'Дата принятия решения в окончательной форме',note:'10 рабочих дней со дня принятия решения суда в окончательной форме.'},
  {id:'kas-appeal-election',code:'KAS',mustReachCourt:true,name:'Апелляция — защита избирательных прав',shortName:'Апелляция — выборы',article:'ч. 3 ст. 298 КАС РФ',unit:'caldays',n:5,dateLabel:'Дата принятия решения',note:'5 календарных дней по делам о защите избирательных прав и права на участие в референдуме.'},
  {id:'kas-appeal-election-remove',code:'KAS',mustReachCourt:true,name:'Апелляция — удаление наблюдателя / члена комиссии',shortName:'Выборы: удаление / отстранение',article:'ч. 3.1 ст. 298 КАС РФ',unit:'caldays',n:5,dateLabel:'Дата принятия решения',note:'5 календарных дней по делам об удалении наблюдателя или отстранении члена избирательной комиссии.'},
  {id:'kas-appeal-foreigner',code:'KAS',name:'Апелляция — помещение иностранца в специальное учреждение',shortName:'Иностранец: апелляция',article:'ч. 4 ст. 298 КАС РФ',unit:'caldays',n:10,dateLabel:'Дата принятия решения',note:'10 календарных дней со дня принятия решения.'},
  {id:'kas-appeal-supervision',code:'KAS',name:'Апелляция — административный надзор',shortName:'Адм. надзор: апелляция',article:'ч. 5 ст. 298 КАС РФ',unit:'workdays',n:10,dateLabel:'Дата принятия решения',note:'10 рабочих дней со дня принятия решения.'},
  {id:'kas-appeal-medical',code:'KAS',name:'Апелляция — психиатрия / туберкулёз / психиатрическое освидетельствование',shortName:'Психиатрия / туберкулёз: апелляция',article:'ч. 6–8 ст. 298 КАС РФ',unit:'caldays',n:10,dateLabel:'Дата принятия решения',note:'10 календарных дней по специальным категориям глав 30, 31 и 31.1 КАС РФ.'},
  {id:'kas-private',code:'KAS',name:'Частная жалоба — общий срок',shortName:'Частная жалоба — общая',article:'ч. 1 ст. 314 КАС РФ',unit:'workdays',n:15,dateLabel:'Дата вынесения определения',note:'15 рабочих дней, если специальный срок не установлен ст. 314 КАС РФ.'},
  {id:'kas-private-election',code:'KAS',mustReachCourt:true,name:'Частная жалоба — избирательные дела',shortName:'Частная жалоба — выборы',article:'ч. 2 ст. 314 КАС РФ',unit:'caldays',n:5,dateLabel:'Дата вынесения определения',note:'5 календарных дней по избирательным делам.'},
  {id:'kas-private-foreigner',code:'KAS',name:'Частная жалоба — специальное учреждение для иностранца',shortName:'Частная — иностранец',article:'ч. 3 ст. 314 КАС РФ',unit:'caldays',n:10,dateLabel:'Дата вынесения определения',note:'10 календарных дней.'},
  {id:'kas-private-supervision',code:'KAS',name:'Частная жалоба — административный надзор',shortName:'Частная — адм. надзор',article:'ч. 4 ст. 314 КАС РФ',unit:'workdays',n:10,dateLabel:'Дата вынесения определения',note:'10 рабочих дней.'},
  {id:'kas-private-medical',code:'KAS',name:'Частная жалоба — психиатрия / туберкулёз / освидетельствование',shortName:'Частная — психиатрия / туберкулёз',article:'ч. 5–7 ст. 314 КАС РФ',unit:'caldays',n:10,dateLabel:'Дата вынесения определения',note:'10 календарных дней по специальным категориям глав 30, 31 и 31.1 КАС РФ.'},
  {id:'kas-cass',code:'KAS',name:'Кассационная жалоба',article:'ч. 2 ст. 318 КАС РФ',unit:'months',n:6,dateLabel:'Дата вступления судебного акта в законную силу',note:'6 месяцев со дня вступления судебного акта в законную силу. С 10.05.2026 для актов мировых судей действует изменённая кассационная маршрутизация через президиум суда субъекта РФ.'},
  {id:'kas-magistrate-cass',code:'KAS',name:'Кассация актов мирового судьи — президиум суда субъекта РФ',shortName:'Мировой судья: кассация',article:'ст. 318, п. 1 ч. 2 ст. 319 КАС РФ',unit:'months',n:6,dateLabel:'Дата вступления судебного акта в законную силу',note:'6 месяцев. С 10.05.2026 судебные приказы и определения мировых судей и связанные апелляционные определения районных судов обжалуются в президиум суда субъекта РФ.'},
  {id:'kas-supervision',code:'KAS',name:'Надзорная жалоба',shortName:'Надзорная жалоба',article:'ч. 2 ст. 333 КАС РФ',unit:'months',n:3,dateLabel:'Дата вступления судебного акта в законную силу',note:'3 месяца со дня вступления судебного акта в законную силу.'},
  {id:'kas-costs',code:'KAS',name:'Заявление о судебных расходах',shortName:'Судебные расходы',article:'ст. 114.1 КАС РФ',unit:'months',n:3,dateLabel:'Дата вступления в силу последнего судебного акта',note:'3 месяца со дня вступления в законную силу последнего судебного акта.'},
  {id:'kas-fine',code:'KAS',name:'Жалоба на определение о наложении судебного штрафа',shortName:'Судебный штраф',article:'ст. 123 КАС РФ',unit:'months',n:1,dateLabel:'Дата получения копии определения',note:'1 месяц со дня получения копии определения о наложении судебного штрафа.'},
  {id:'kas-settlement-cass',code:'KAS',name:'Кассация определения об утверждении соглашения о примирении',shortName:'Примирение: кассация',article:'ст. 137.1 КАС РФ',unit:'months',n:1,dateLabel:'Дата вынесения определения',note:'1 месяц со дня вынесения определения об утверждении соглашения о примирении.'},
  {id:'kas-new',code:'KAS',name:'Пересмотр по новым / вновь открывшимся обстоятельствам',shortName:'Новые / вновь открывшиеся',article:'ст. 346 КАС РФ',unit:'months',n:3,dateLabel:'Дата установления основания для пересмотра',note:'3 месяца; конкретный момент начала срока определяется ст. 347 КАС РФ.'},
  {id:'kas-inaction',code:'KAS',name:'Иск об оспаривании бездействия — после прекращения обязанности действовать',shortName:'Бездействие: после прекращения обязанности',article:'ч. 1.1 ст. 219 КАС РФ',unit:'months',n:3,dateLabel:'Дата прекращения обязанности совершить действие',note:'Если обязанность органа или должностного лица совершить действие прекратилась, иск может быть подан в течение 3 месяцев после этого. Пока обязанность сохраняется, действует специальное правило ч. 1.1 ст. 219 КАС РФ.'},
  {id:'kas-normative-municipal-dissolution',code:'KAS',name:'Иск об оспаривании закона субъекта о роспуске представительного органа МО',shortName:'Роспуск представительного органа МО',article:'ч. 7 ст. 208 КАС РФ',unit:'workdays',n:10,dateLabel:'Дата принятия закона субъекта РФ',note:'10 рабочих дней со дня принятия закона субъекта РФ о роспуске представительного органа муниципального образования.'},
  {id:'kas-claim-general',code:'KAS',name:'Административный иск — общий срок',shortName:'Административный иск',article:'ч. 1 ст. 219 КАС РФ',unit:'months',n:3,dateLabel:'Дата, когда стало известно о нарушении права',note:'3 месяца со дня, когда стало известно о нарушении прав, если специальный срок не установлен.'},
  {id:'kas-bailiff',code:'KAS',name:'Иск об оспаривании действий / бездействия пристава',shortName:'Оспаривание действий пристава',article:'ч. 3 ст. 219 КАС РФ',unit:'workdays',n:10,dateLabel:'Дата, когда стало известно о нарушении права',note:'10 рабочих дней со дня, когда стало известно о нарушении права.'},
  {id:'kas-municipal-claim',code:'KAS',name:'Иск по отдельным вопросам местного самоуправления',shortName:'Местное самоуправление: иск',article:'ч. 2 ст. 219 КАС РФ',unit:'workdays',n:10,dateLabel:'Дата принятия оспариваемого решения',note:'10 рабочих дней для предусмотренных ч. 2 ст. 219 КАС РФ случаев.'},
  {id:'kas-public-event',code:'KAS',name:'Иск по согласованию публичного мероприятия',shortName:'Публичное мероприятие',article:'ч. 4 ст. 219 КАС РФ',unit:'workdays',n:10,dateLabel:'Дата, когда стало известно о нарушении',note:'10 рабочих дней со дня, когда стало известно о нарушении прав.'},
  {id:'kas-compensation',code:'KAS',name:'Заявление о компенсации — после вступления итогового акта в силу',shortName:'Компенсация за длительность',article:'ст. 250 КАС РФ',unit:'months',n:6,dateLabel:'Дата вступления в силу последнего судебного акта',note:'Не позднее 6 месяцев со дня вступления в законную силу последнего судебного акта; у ст. 250 КАС РФ есть дополнительные специальные основания и начальные моменты.'},
  {id:'kas-compensation-enforcement',code:'KAS',name:'Компенсация за нарушение разумного срока исполнения — после окончания исполнения',shortName:'Компенсация: после исполнения',article:'ч. 4 ст. 250 КАС РФ',unit:'months',n:6,dateLabel:'Дата окончания производства по исполнению судебного акта',note:'Не позднее 6 месяцев со дня окончания производства по исполнению судебного акта. Для обращения в период исполнения действует также правило о минимальном шестимесячном периоде после истечения установленного законом срока исполнения.'},
  {id:'kas-compensation-criminal',code:'KAS',name:'Компенсация за нарушение разумного срока уголовного судопроизводства',shortName:'Компенсация: уголовное судопроизводство',article:'ч. 5 ст. 250 КАС РФ',unit:'months',n:6,dateLabel:'Дата вступления в силу приговора / итогового акта о прекращении уголовного судопроизводства',note:'6 месяцев со дня вступления в законную силу приговора либо иного итогового решения, которым прекращено уголовное судопроизводство, с учётом специальных правил ст. 250 КАС РФ.'},
  {id:'kas-mandatory-payments',code:'KAS',name:'Иск о взыскании обязательных платежей и санкций',shortName:'Обязательные платежи и санкции',article:'ч. 2 ст. 286 КАС РФ',unit:'months',n:6,dateLabel:'Дата истечения срока исполнения требования об уплате',note:'6 месяцев со дня истечения срока исполнения требования об уплате обязательных платежей и санкций, если иной срок не установлен федеральным законом.'},
  {id:'kas-election-general',code:'KAS',name:'Избирательный спор — общий срок обращения',shortName:'Выборы: общий срок',article:'ч. 1 ст. 240 КАС РФ',unit:'months',n:3,dateLabel:'Дата, когда стало известно / должно было стать известно о нарушении',mustReachCourt:true,note:'3 месяца, если ст. 240 КАС РФ не устанавливает специальный срок. Для сроков ст. 240 КАС РФ сдача документов на почту в последний день не сохраняет срок — документ должен поступить в суд.'},
  {id:'kas-election-results-published',code:'KAS',name:'Иск об отмене результатов выборов / референдума после опубликования',shortName:'Выборы: опубликованные результаты',article:'ч. 3 ст. 240 КАС РФ',unit:'months',n:3,dateLabel:'Дата официального опубликования результатов',mustReachCourt:true,note:'3 месяца со дня официального опубликования результатов выборов или референдума. Срок относится к специальным срокам ст. 240 КАС РФ.'},
  {id:'kas-election-registration',code:'KAS',name:'Иск по решению о регистрации / отказе в регистрации / заверении списка',shortName:'Выборы: регистрация / список',article:'ч. 4 ст. 240 КАС РФ',unit:'caldays',n:10,mustReachCourt:true,dateLabel:'Дата принятия оспариваемого решения комиссии',note:'10 календарных дней. Если последний день приходится на нерабочий день, применяется общее правило ч. 2 ст. 93 КАС РФ о переносе на следующий рабочий день. Сдача на почту в последний день срок не сохраняет — документ должен поступить в суд.'},
  {id:'kas-election-after-admin',code:'KAS',name:'Иск после отказа вышестоящей избирательной комиссии',shortName:'Выборы: после адм. жалобы',article:'ч. 4 ст. 240 КАС РФ',unit:'caldays',n:5,mustReachCourt:true,dateLabel:'Дата решения вышестоящей комиссии об оставлении жалобы без удовлетворения',note:'5 календарных дней. Если последний день нерабочий — применяется ч. 2 ст. 93 КАС РФ. Сдача документа на почту в последний день срок не сохраняет.'},
  {id:'kas-election-vote-results',code:'KAS',name:'Иск об отмене решения об итогах голосования',shortName:'Выборы: итоги голосования',article:'ч. 2 ст. 240 КАС РФ',unit:'caldays',n:10,mustReachCourt:true,dateLabel:'Дата принятия решения об итогах голосования',note:'10 календарных дней. Если последний день нерабочий — применяется ч. 2 ст. 93 КАС РФ. Срок не восстанавливается; сдача на почту в последний день его не сохраняет.'},
  {id:'kas-election-candidate-cancel',code:'KAS',name:'Иск об отмене регистрации кандидата — крайний срок до голосования',shortName:'Выборы: отмена регистрации',article:'ч. 5 ст. 240 КАС РФ',unit:'before_caldays',n:8,noShift:true,mustReachCourt:true,dateLabel:'Дата голосования / первого дня голосования',note:'Иск подаётся не позднее чем за 8 календарных дней до дня голосования. Для многодневного голосования ориентируйтесь на первый день голосования и специальную избирательную норму.'},

  {id:'kas-election-commission-organizer',code:'KAS',name:'Расформирование комиссии, организующей выборы / референдум',shortName:'Выборы: расформирование организующей комиссии',article:'п. 1 ч. 6 ст. 240 КАС РФ',unit:'months',n:3,mustReachCourt:true,dateLabel:'Дата окончания избирательной кампании / кампании референдума',note:'После окончания кампании, но не позднее чем через 3 месяца после дня её окончания. Срок не подлежит восстановлению.'},
  {id:'kas-election-commission-other-before',code:'KAS',name:'Расформирование иной комиссии — до дня голосования',shortName:'Выборы: иная комиссия — до голосования',article:'п. 2 ч. 6 ст. 240 КАС РФ',unit:'before_caldays',n:30,noShift:true,mustReachCourt:true,dateLabel:'Дата голосования / первого дня голосования',note:'Не позднее чем за 30 календарных дней до дня голосования (при многодневном голосовании — до первого дня). Срок не восстанавливается.'},
  {id:'kas-election-commission-other-after',code:'KAS',name:'Расформирование иной комиссии — после окончания кампании',shortName:'Выборы: иная комиссия — после кампании',article:'п. 2 ч. 6 ст. 240 КАС РФ',unit:'months',n:3,mustReachCourt:true,dateLabel:'Дата появления основания для расформирования после окончания кампании',note:'После окончания кампании — не позднее чем через 3 месяца после дня появления основания для расформирования иной комиссии. Срок не восстанавливается.'},
  {id:'kas-election-precinct-repeat-before',code:'KAS',name:'Расформирование участковой комиссии перед повторным голосованием',shortName:'Выборы: участковая комиссия — повторное',article:'п. 3 ч. 6 ст. 240 КАС РФ',unit:'before_caldays',n:7,noShift:true,mustReachCourt:true,dateLabel:'Дата повторного голосования / первого дня повторного голосования',note:'После установления итогов голосования на участке, но не позднее чем за 7 календарных дней до повторного голосования. Срок не восстанавливается.'},

  /* УПК РФ */
  {id:'upk-pretrial-hearing',code:'UPK',name:'Ходатайство о проведении предварительного слушания после направления дела в суд',shortName:'Предварительное слушание',article:'ч. 3 ст. 229 УПК РФ',unit:'caldays',n:3,dateLabel:'Дата получения обвиняемым копии обвинительного заключения / акта',note:'3 суток со дня получения обвиняемым копии обвинительного заключения или обвинительного акта, если ходатайство заявляется после направления дела в суд. Ходатайство также может быть заявлено при ознакомлении с материалами дела.'},
  {id:'upk-appeal',code:'UPK',name:'Апелляционная жалоба — общий случай',shortName:'Апелляционная жалоба',article:'ч. 1 ст. 389.4 УПК РФ',unit:'caldays',n:15,dateLabel:'Дата постановления приговора / вынесения решения',note:'15 суток. Нерабочие дни входят в срок; если последний день нерабочий — окончание переносится на следующий рабочий день.'},
  {id:'upk-appeal-custody',code:'UPK',name:'Апелляция — осуждённый под стражей',shortName:'Апелляция — под стражей',article:'ч. 1 ст. 389.4 УПК РФ',unit:'caldays',n:15,dateLabel:'Дата вручения копии приговора / решения осуждённому',note:'15 суток со дня вручения копии осуждённому, содержащемуся под стражей.'},
  {id:'upk-restraint-appeal',code:'UPK',name:'Апелляция меры пресечения: запреты / залог / домашний арест / стража',shortName:'Мера пресечения: 3 суток',article:'ст. 105.1, 106, 107, 108 УПК РФ; ч. 11 ст. 108 УПК РФ',unit:'caldays',n:3,dateLabel:'Дата вынесения постановления / определения',note:'3 суток на апелляционное обжалование решений об избрании или продлении запрета определённых действий, залога, домашнего ареста, заключения под стражу и связанных решений, для которых УПК РФ устанавливает сокращённый срок.'},
  {id:'upk-extradition',code:'UPK',name:'Жалоба на решение о выдаче лица (экстрадиции)',shortName:'Экстрадиция',article:'ч. 1 ст. 463 УПК РФ',unit:'caldays',n:10,dateLabel:'Дата получения уведомления о решении о выдаче',note:'10 суток с момента получения уведомления о принятом решении о выдаче.'},
  {id:'upk-cass',code:'UPK',name:'Кассационная жалоба — сплошная кассация',shortName:'Сплошная кассация',article:'ч. 4 ст. 401.3 УПК РФ',unit:'months',n:6,dateLabel:'Дата вступления итогового судебного решения в законную силу',note:'6 месяцев только для жалоб, рассматриваемых по правилам ст. 401.7 и 401.8 УПК РФ. Не следует автоматически применять этот срок ко всем видам кассации; с 10.05.2026 для актов мировых судей действует иной маршрут.'},
  {id:'upk-cass-custody',code:'UPK',name:'Сплошная кассация — осуждённый под стражей',shortName:'Сплошная кассация — под стражей',article:'ч. 4 ст. 401.3 УПК РФ',unit:'months',n:6,dateLabel:'Дата вручения копии вступившего в силу решения',note:'6 месяцев со дня вручения осуждённому под стражей копии вступившего в силу итогового судебного решения — для жалоб по ст. 401.7 и 401.8 УПК РФ.'},

  {id:'upk-cass-worse-limit',code:'UPK',name:'Предельный срок поворота к худшему — кассация / надзор',shortName:'Поворот к худшему: предел',article:'ст. 401.6, ч. 2 ст. 412.9 УПК РФ',unit:'years',n:1,dateLabel:'Дата вступления судебного решения в законную силу',note:'Пересмотр по основаниям, влекущим ухудшение положения осуждённого, оправданного или лица, в отношении которого дело прекращено, допускается не более 1 года со дня вступления решения в силу при наличии предусмотренных законом оснований. Это предельный срок, а не общий срок кассационного/надзорного обжалования.'},

  /* КоАП РФ */
  {id:'koap-appeal',code:'KOAP',name:'Жалоба на постановление по делу об административном правонарушении',shortName:'Жалоба на постановление',article:'ч. 1 ст. 30.3 КоАП РФ',unit:'caldays',n:10,dateLabel:'Дата вручения / получения копии постановления',note:'10 календарных дней; начало — со следующего дня, последний нерабочий день переносится на следующий рабочий.'},
  {id:'koap-return-protocol',code:'KOAP',name:'Жалоба на определение о возвращении протокола / материалов',shortName:'Возврат протокола: 24 часа',article:'ч. 1.1 ст. 30.3 КоАП РФ',unit:'hours',n:24,requiresTime:true,noShift:true,dateLabel:'Дата получения копии определения',timeLabel:'Точное время получения',note:'1 сутки с момента получения копии определения, указанного в п. 4 ч. 1 ст. 29.4 или п. 3 ч. 2 ст. 29.9 КоАП РФ. Это срок от точного момента получения; перенос на рабочий день не применяется.'},
  {id:'koap-appeal-election',code:'KOAP',name:'Жалоба по отдельным избирательным составам',shortName:'Жалоба по избирательным составам',article:'ч. 3 ст. 30.3 КоАП РФ',unit:'caldays',n:5,dateLabel:'Дата вручения / получения копии постановления',note:'5 календарных дней для составов, прямо перечисленных в ч. 3 ст. 30.3 КоАП РФ.'},
  {id:'koap-followup',code:'KOAP',name:'Жалоба на решение по жалобе — общий случай',shortName:'Решение по жалобе — общее',article:'ст. 30.9 во взаимосвязи с ч. 1 ст. 30.3 КоАП РФ',unit:'caldays',n:10,dateLabel:'Дата вручения / получения копии решения',note:'10 календарных дней в общем случае; последующая жалоба подаётся в порядке и сроки, установленные главой 30 КоАП РФ.'},
  {id:'koap-followup-election',code:'KOAP',name:'Жалоба на решение по жалобе — избирательные составы',shortName:'Решение по жалобе — выборы',article:'ст. 30.9 во взаимосвязи с ч. 3 ст. 30.3 КоАП РФ',unit:'caldays',n:5,dateLabel:'Дата вручения / получения копии решения',note:'5 календарных дней для специальных избирательных составов.'},
  {id:'koap-final-customs',code:'KOAP',name:'Жалоба собственника имущества на вступивший в силу акт о конфискации',shortName:'Конфискация: собственник',article:'ч. 6 ст. 30.12 КоАП РФ',unit:'caldays',n:10,dateLabel:'Дата получения копии вступившего в силу постановления',note:'10 календарных дней для собственника имущества в специальном случае, предусмотренном ч. 6 ст. 30.12 КоАП РФ.'},

  /* Исполнительное производство */
  {id:'fssp-complaint',code:'FSSP',name:'Жалоба на постановление / действие пристава',shortName:'Жалоба на пристава',article:'ст. 122, ч. 2 ст. 15 Закона № 229-ФЗ',unit:'workdays',n:10,dateLabel:'Дата постановления / действия / установления бездействия',note:'10 рабочих дней. Для лица, не извещённого о действии, — со дня, когда оно узнало или должно было узнать.'},
  {id:'fssp-voluntary',code:'FSSP',name:'Срок для добровольного исполнения',shortName:'Добровольное исполнение',article:'ч. 12 ст. 30 Закона № 229-ФЗ',unit:'workdays',n:5,dateLabel:'Дата получения постановления о возбуждении ИП / извещения',note:'5 рабочих дней со дня получения постановления о возбуждении исполнительного производства либо извещения в предусмотренных законом случаях.'},
  {id:'fssp-writ-general',code:'FSSP',name:'Предъявление исполнительного листа — общий срок',shortName:'Исполнительный лист — общий',article:'ч. 1 ст. 21 Закона № 229-ФЗ',unit:'years',n:3,dateLabel:'Дата вступления судебного акта в законную силу',note:'3 года со дня вступления судебного акта в законную силу, если законом не установлен специальный момент начала.'},
  {id:'fssp-order',code:'FSSP',name:'Предъявление судебного приказа к исполнению',shortName:'Судебный приказ к исполнению',article:'ч. 3 ст. 21 Закона № 229-ФЗ',unit:'years',n:3,dateLabel:'Дата выдачи судебного приказа',note:'3 года со дня выдачи судебного приказа.'},
  {id:'fssp-restored-arbitral',code:'FSSP',name:'Исполнительный лист после восстановления пропущенного срока',shortName:'Восстановленный срок ИЛ',article:'ч. 2 ст. 21 Закона № 229-ФЗ',unit:'months',n:3,dateLabel:'Дата определения о восстановлении срока',note:'3 месяца со дня вынесения определения о восстановлении пропущенного срока предъявления исполнительного документа.'},
  {id:'fssp-child-return',code:'FSSP',name:'Исполнительный лист о возвращении незаконно перемещённого ребёнка',shortName:'Возвращение ребёнка: ИЛ',article:'ч. 1.1 ст. 21 Закона № 229-ФЗ',unit:'years',n:1,dateLabel:'Дата вступления судебного акта в законную силу',note:'1 год со дня вступления судебного акта в законную силу.'},
  {id:'fssp-kts',code:'FSSP',name:'Удостоверение комиссии по трудовым спорам',shortName:'КТС к исполнению',article:'ч. 5 ст. 21 Закона № 229-ФЗ',unit:'months',n:3,dateLabel:'Дата выдачи удостоверения КТС',note:'3 месяца со дня выдачи удостоверения комиссии по трудовым спорам.'},
  {id:'fssp-periodic-after',code:'FSSP',name:'Периодические платежи — срок после окончания периода взыскания',shortName:'Периодические платежи: после периода',article:'ч. 4 ст. 21 Закона № 229-ФЗ',unit:'years',n:3,dateLabel:'Дата окончания срока, на который присуждены периодические платежи',note:'Исполнительный документ может предъявляться в течение всего срока, на который присуждены периодические платежи, а также в течение 3 лет после окончания этого срока.'},
  {id:'fssp-control-bank',code:'FSSP',name:'Акт контрольного органа с банковскими документами',shortName:'Контрольный орган: после банка',article:'ч. 6 ст. 21 Закона № 229-ФЗ',unit:'months',n:6,dateLabel:'Дата возвращения акта банком / кредитной организацией',note:'6 месяцев со дня возвращения банком или иной кредитной организацией акта контрольного органа с отметками о полном или частичном неисполнении.'},
  {id:'fssp-control-no-bank',code:'FSSP',name:'Акт контрольного органа без банковских документов',shortName:'Контрольный орган: без банка',article:'ч. 6.1 ст. 21 Закона № 229-ФЗ',unit:'months',n:6,dateLabel:'Дата вынесения акта контрольного органа',note:'6 месяцев со дня вынесения акта контрольного органа о взыскании денежных средств без банковских документов, указанных в ч. 6 ст. 21.'},
  {id:'fssp-admin-offense',code:'FSSP',name:'Предъявление к исполнению акта по делу об административном правонарушении',shortName:'Адм. правонарушение: исполнение',article:'ч. 7 ст. 21 Закона № 229-ФЗ',unit:'years',n:2,dateLabel:'Дата вступления акта в законную силу',note:'2 года со дня вступления в законную силу судебного акта, акта другого органа или должностного лица по делу об административном правонарушении.'}
];
var LEGAL_DEADLINE_REVIEWED='11.09.2026';
function legalDeadlineCount(code){ return code?LEGAL_DEADLINE_RULES.filter(function(x){return x.code===code;}).length:LEGAL_DEADLINE_RULES.length; }
function legalDeadlineCode(id){ return LEGAL_DEADLINE_CODES.filter(function(x){return x.id===id;})[0]||LEGAL_DEADLINE_CODES[0]; }
function legalDeadlineRule(id){ return LEGAL_DEADLINE_RULES.filter(function(x){return x.id===id;})[0]||null; }
function legalDeadlineRules(code){ return LEGAL_DEADLINE_RULES.filter(function(x){return x.code===code;}); }
function legalDeadlineCodeOptions(value){
  return LEGAL_DEADLINE_CODES.map(function(c){return '<option value="'+c.id+'"'+(c.id===value?' selected':'')+'>'+esc(c.name)+' · '+legalDeadlineCount(c.id)+'</option>';}).join('');
}
function legalDeadlineRuleOptions(code,value){
  var a=legalDeadlineRules(code); return a.map(function(r){var label=r.shortName||r.name;return '<option value="'+r.id+'"'+(r.id===value?' selected':'')+'>'+esc(label)+'</option>';}).join('');
}
function legalDeadlineTerm(r){
  if(!r)return '';
  if(r.termLabel)return r.termLabel;
  if(r.unit==='months') return r.n+' '+plural(r.n,'месяц','месяца','месяцев');
  if(r.unit==='years') return r.n+' '+plural(r.n,'год','года','лет');
  if(r.unit==='hours') return r.n+' '+plural(r.n,'час','часа','часов')+' с момента получения';
  if(r.unit==='before_caldays') return 'не позднее чем за '+r.n+' '+plural(r.n,'календарный день','календарных дня','календарных дней');
  if(r.unit==='workdays') return r.n+' '+plural(r.n,'рабочий день','рабочих дня','рабочих дней');
  return r.n+' '+plural(r.n,'календарный день','календарных дня','календарных дней');
}
var EXTRA_NONWORK_2026={'2026-01-09':1,'2026-03-09':1,'2026-05-11':1,'2026-12-31':1};
function isFederalHoliday(s){
  var d=parseD(s),m=d.getMonth()+1,day=d.getDate(),y=d.getFullYear();
  if(m===1&&day>=1&&day<=8)return true;
  if((m===2&&day===23)||(m===3&&day===8)||(m===5&&(day===1||day===9))||(m===6&&day===12)||(m===11&&day===4))return true;
  if(y===2026&&EXTRA_NONWORK_2026[s])return true;
  return false;
}
function isNonWorkingDate(s){ var d=parseD(s),w=d.getDay(); return w===0||w===6||isFederalHoliday(s); }
function nextWorkingDate(s){ var x=s,guard=0; while(isNonWorkingDate(x)&&guard++<20)x=addD(x,1); return x; }
function addWorkingDaysLegal(from,n){ var x=from,c=0,guard=0; while(c<n&&guard++<4000){x=addD(x,1);if(!isNonWorkingDate(x))c++;} return x; }
function pad2(n){return String(n).padStart(2,'0');}
function addLegalHours(from,time,n){
  if(!from||!time)return null;
  var dp=from.split('-').map(Number),tp=time.split(':').map(Number);
  if(dp.length<3||tp.length<2||dp.some(isNaN)||tp.some(isNaN))return null;
  var d=new Date(Date.UTC(dp[0],dp[1]-1,dp[2],tp[0],tp[1],0));
  d.setUTCHours(d.getUTCHours()+n);
  return {date:d.getUTCFullYear()+'-'+pad2(d.getUTCMonth()+1)+'-'+pad2(d.getUTCDate()),time:pad2(d.getUTCHours())+':'+pad2(d.getUTCMinutes())};
}
function calculateLegalDeadline(rule,from,fromTime){
  if(!rule||!from)return null;
  if(rule.requiresTime&&!fromTime)return null;
  var raw,end,start=rule.unit==='before_caldays'?from:addD(from,1),shifted=false,endTime='';
  if(rule.unit==='workdays') raw=addWorkingDaysLegal(from,rule.n);
  else if(rule.unit==='months') raw=addM(from,rule.n);
  else if(rule.unit==='years') raw=addM(from,rule.n*12);
  else if(rule.unit==='before_caldays') raw=addD(from,-rule.n-1);
  else if(rule.unit==='hours'){
    var h=addLegalHours(from,fromTime,rule.n); if(!h)return null; raw=h.date; endTime=h.time;
  } else raw=addD(from,rule.n);
  end=raw;
  if(rule.unit!=='workdays'&&rule.unit!=='hours'&&!rule.noShift&&isNonWorkingDate(end)){end=nextWorkingDate(end);shifted=end!==raw;}
  var yr=parseD(from).getFullYear(),ey=parseD(end).getFullYear();
  var calendarSensitive=(rule.unit==='workdays'||(!rule.noShift&&rule.unit!=='hours'));
  return {from:from,fromTime:fromTime||'',start:start,raw:raw,end:end,endTime:endTime,shifted:shifted,calendarExact:!calendarSensitive||(yr===2026&&ey===2026),reverse:rule.unit==='before_caldays'};
}
function deadlineRuleFromTask(t){
  if(t&&t.deadlineRuleId&&legalDeadlineRule(t.deadlineRuleId))return legalDeadlineRule(t.deadlineRuleId);
  var raw=((t&&t.rule)||'')+' '+((t&&t.ruleArticle)||'');
  var cmap={GPK:'ГПК',APK:'АПК',KAS:'КАС',UPK:'УПК',KOAP:'КоАП',FSSP:'229-ФЗ'};
  for(var i=0;i<LEGAL_DEADLINE_RULES.length;i++){
    var rr=LEGAL_DEADLINE_RULES[i],token=cmap[rr.code]||rr.code;
    if(raw.indexOf(token)>=0 && raw.indexOf(rr.article.replace(/^.*?ст\.\s*/,'').split(' ')[0])>=0) return rr;
  }
  return null;
}
function deadlineCalcResultHTML(rule,res){
  if(!rule)return '<div class="deadline-calc-empty">Выберите процессуальное действие.</div>';
  if(!res){
    var need=rule.requiresTime?'Укажите исходную дату и точное время — крайний срок рассчитается автоматически.':'Укажите исходную дату — крайний срок рассчитается автоматически.';
    return '<div class="deadline-calc-empty"><b>'+esc(rule.dateLabel)+'</b><br>'+need+'</div>';
  }
  var when=fmtD(res.end,true)+(res.endTime?' · '+esc(res.endTime):'');
  var note=res.shifted?'<div class="deadline-calc-shift">Последний день пришёлся на нерабочий день — срок перенесён с '+fmtD(res.raw,true)+' на следующий рабочий день.</div>':'';
  var special=rule.noShift&&rule.unit!=='hours'?'<div class="deadline-calc-special">Специальное правило: крайняя дата определяется непосредственно специальной нормой и не сдвигается как обычный срок.</div>':'';
  var delivery=rule.mustReachCourt?'<div class="deadline-calc-special">Важно: для этого специального срока недостаточно сдать документ на почту в последний день — документ должен поступить в суд в пределах срока.</div>':'';
  var warn=!res.calendarExact?'<div class="deadline-calc-warn">Для дат вне 2026 года федеральные праздники учитываются, но переносы выходных Правительством требуют актуального производственного календаря соответствующего года.</div>':'';
  var dow=res.endTime?'':('<em>'+cap(DOW[parseD(res.end).getDay()])+'</em>');
  return '<div class="deadline-calc-result"><small>'+(res.reverse?'Крайняя дата подачи':'Крайний срок подачи')+'</small><b>'+when+'</b>'+dow+'<div class="deadline-calc-law"><strong>'+esc(rule.article)+'</strong><span>'+esc(legalDeadlineTerm(rule))+'</span></div><p>'+esc(rule.note)+'</p>'+special+delivery+note+warn+'</div>';
}
function applyDeadlineRuleFromDom(){
  if(!ED||ED.kind!=='deadline')return null;
  var ce=$('#e-deadline-code'),re=$('#e-deadline-rule'),se=$('#e-source'),te=$('#e-source-time');
  if(ce)ED.deadlineCode=ce.value;
  if(re)ED.deadlineRuleId=re.value;
  if(se)ED.sourceDate=se.value;
  if(te)ED.sourceTime=te.value;
  var rule=legalDeadlineRule(ED.deadlineRuleId),res=calculateLegalDeadline(rule,ED.sourceDate,ED.sourceTime);
  if(rule){
    ED.title=rule.name; ED.ruleCode=legalDeadlineCode(rule.code).name; ED.ruleArticle=rule.article; ED.rule=rule.article; ED.pri='high';
    if(res){ED.due=res.end;ED.time=res.endTime||'';}
  }
  var out=$('#e-deadline-result'); if(out)out.innerHTML=deadlineCalcResultHTML(rule,res);
  var lab=$('#e-source-label'); if(lab&&rule)lab.textContent=rule.dateLabel;
  var tw=$('#e-source-time-wrap'); if(tw)tw.hidden=!(rule&&rule.requiresTime);
  var tl=$('#e-source-time-label'); if(tl&&rule)tl.textContent=rule.timeLabel||'Точное время';
  return {rule:rule,res:res};
}
function inferDeadlineRuleParts(t){
  var r=deadlineRuleFromTask(t); if(r)return {code:r.code,article:r.article,ruleId:r.id};
  return {code:'GPK',article:(t&&t.rule)||'',ruleId:''};
}
var PRI = { high:{n:'Срочно',c:'red'}, mid:{n:'Обычный',c:'yel'}, low:{n:'Низкий',c:''} };
var STAGE = ['Досудебная работа','Первая инстанция','Апелляция','Кассация','Надзор','Исполнение'];
var MATTER_STAGE_META = {
  'Материал проверки':{c:'#D98A2B',icon:'doc',mode:'investigation'},
  'Дознание':{c:'#8A6AD8',icon:'brief',mode:'investigation'},
  'Следствие МВД':{c:'#4E86C6',icon:'brief',mode:'investigation'},
  'Следствие СК':{c:'#D96464',icon:'brief',mode:'investigation'},
  'Досудебная работа':{c:'#B78A2F',icon:'doc',mode:'other'},
  'Проверка / административное расследование':{c:'#D98A2B',icon:'doc',mode:'other'},
  'Первая инстанция':{c:'#2FA08E',icon:'gavel',mode:'judicial'},
  'Апелляция':{c:'#4E86C6',icon:'gavel',mode:'judicial'},
  'Пересмотр / апелляция':{c:'#4E86C6',icon:'gavel',mode:'judicial'},
  'Кассация':{c:'#6D65C4',icon:'gavel',mode:'judicial'},
  'Надзор':{c:'#9A62A6',icon:'gavel',mode:'judicial'},
  'Исполнение':{c:'#C29130',icon:'brief',mode:'execution'},
  'Исполнение приговора':{c:'#C29130',icon:'gavel',mode:'execution'},
  'Завершено':{c:'#7A8FA6',icon:'check',mode:'completed'}
};
var MATTER_INVESTIGATION_ORGANS = [
  {short:'ОД МО МВД РФ Кинешемский',value:'ОД МО МВД РФ Кинешемский',kind:'inquiry',c:'#8A6AD8',extra:'Дознание МВД'},
  {short:'СО МО МВД РФ Кинешемский',value:'СО МО МВД РФ Кинешемский',kind:'mvd',c:'#4E86C6',extra:'Следствие МВД'},
  {short:'СО по г. Кинешма СУ СК РФ',value:'СО по г. Кинешма СУ СК РФ',kind:'sk',c:'#D96464',extra:'Следствие СК России'},
  {short:'Кинешемский РОСП',value:'Кинешемский РОСП',kind:'fssp',c:'#8A6AD8',extra:'Дознание ФССП'}
];

// Глава 47 УПК РФ: вопросы, рассматриваемые судом на стадии исполнения приговора.
// jurisdiction: sentence — суд, постановивший приговор; institution — по месту учреждения;
// residence — по месту жительства осуждённого; detention — по месту задержания;
// crimeResidence — по подсудности преступления и последнему месту жительства; conviction — ст. 400 УПК РФ.
var CRIMINAL_EXECUTION_ISSUES = [
  {id:'udo',name:'Условно-досрочное освобождение',short:'УДО',article:'п. 4 ст. 397 УПК РФ · ст. 79 УК РФ',jurisdiction:'institution',jurisdictionLabel:'суд по месту учреждения, исполняющего наказание'},
  {id:'softer',name:'Замена неотбытой части наказания более мягким видом',short:'Замена наказания · ст. 80 УК РФ',article:'п. 5 ст. 397 УПК РФ · ст. 80 УК РФ',jurisdiction:'institution',jurisdictionLabel:'суд по месту учреждения, исполняющего наказание'},
  {id:'illness',name:'Освобождение от наказания в связи с болезнью',short:'Освобождение по болезни',article:'п. 6 ст. 397 УПК РФ · ст. 81 УК РФ',jurisdiction:'institution',jurisdictionLabel:'суд по месту учреждения, исполняющего наказание'},
  {id:'institution-type',name:'Изменение вида исправительного учреждения',short:'Изменение вида ИУ',article:'п. 3 ст. 397 УПК РФ · ст. 78, 140 УИК РФ',jurisdiction:'institution',jurisdictionLabel:'суд по месту учреждения, исполняющего наказание'},
  {id:'reverse-law',name:'Освобождение или смягчение наказания вследствие нового уголовного закона',short:'Обратная сила уголовного закона',article:'п. 13 ст. 397 УПК РФ · ст. 10 УК РФ',jurisdiction:'institution',jurisdictionLabel:'суд по месту учреждения, исполняющего наказание'},
  {id:'pmh',name:'Назначение, продление, изменение или прекращение ПММХ',short:'ПММХ',article:'п. 12 ст. 397 УПК РФ · ст. 102, 104 УК РФ',jurisdiction:'institution',jurisdictionLabel:'суд по месту применения ПММХ'},
  {id:'pmh-expert',name:'Назначение судебно-психиатрической экспертизы при исполнении приговора',short:'Экспертиза при исполнении',article:'п. 4.2 ст. 397 УПК РФ',jurisdiction:'institution',jurisdictionLabel:'суд по месту учреждения / применения ПММХ'},
  {id:'replace-evasion',name:'Замена наказания при злостном уклонении от его отбывания',short:'Замена за уклонение',article:'п. 2 ст. 397 УПК РФ',jurisdiction:'sentence',jurisdictionLabel:'суд, постановивший приговор'},
  {id:'forced-to-prison',name:'Замена принудительных работ лишением свободы',short:'Принудительные работы → лишение свободы',article:'п. 2.1 ст. 397 УПК РФ · ст. 53.1 УК РФ',jurisdiction:'sentence',jurisdictionLabel:'суд, постановивший приговор'},
  {id:'cancel-udo',name:'Отмена условно-досрочного освобождения',short:'Отмена УДО',article:'п. 4.1 ст. 397 УПК РФ · ст. 79 УК РФ',jurisdiction:'residence',jurisdictionLabel:'суд по месту жительства осуждённого'},
  {id:'conditional',name:'Отмена условного осуждения или продление испытательного срока',short:'Условное осуждение',article:'п. 7 ст. 397 УПК РФ · ст. 74 УК РФ',jurisdiction:'residence',jurisdictionLabel:'суд по месту жительства осуждённого'},
  {id:'conditional-duties',name:'Отмена или дополнение обязанностей условно осуждённого',short:'Обязанности условно осуждённого',article:'п. 8 ст. 397 УПК РФ · ст. 73 УК РФ',jurisdiction:'residence',jurisdictionLabel:'суд по месту жительства осуждённого'},
  {id:'restriction',name:'Изменение ограничений при наказании в виде ограничения свободы',short:'Ограничение свободы',article:'п. 8.1 ст. 397 УПК РФ · ст. 53 УК РФ',jurisdiction:'residence',jurisdictionLabel:'суд по месту жительства осуждённого'},
  {id:'limitation',name:'Освобождение от наказания вследствие истечения сроков давности приговора',short:'Давность исполнения приговора',article:'п. 9 ст. 397 УПК РФ · ст. 83 УК РФ',jurisdiction:'sentence',jurisdictionLabel:'суд, постановивший приговор'},
  {id:'multiple-sentences',name:'Исполнение приговора при наличии других неисполненных приговоров',short:'Несколько приговоров',article:'п. 10 ст. 397 УПК РФ · ст. 70 УК РФ',jurisdiction:'sentence',jurisdictionLabel:'суд, постановивший приговор'},
  {id:'credit',name:'Зачёт времени содержания под стражей / пребывания в лечебном учреждении',short:'Зачёт срока',article:'п. 11 ст. 397 УПК РФ · ст. 72, 103, 104 УК РФ',jurisdiction:'sentence',jurisdictionLabel:'суд, постановивший приговор'},
  {id:'deductions',name:'Снижение удержаний из заработной платы при исправительных работах',short:'Снижение удержаний',article:'п. 14 ст. 397 УПК РФ · ст. 44 УИК РФ',jurisdiction:'sentence',jurisdictionLabel:'суд, постановивший приговор'},
  {id:'clarify',name:'Разъяснение сомнений и неясностей при исполнении приговора',short:'Разъяснение приговора',article:'п. 15 ст. 397 УПК РФ',jurisdiction:'sentence',jurisdictionLabel:'суд, постановивший приговор'},
  {id:'minor',name:'Освобождение несовершеннолетнего от наказания с применением мер воспитательного воздействия',short:'Несовершеннолетний · освобождение',article:'п. 16 ст. 397 УПК РФ · ст. 92 УК РФ',jurisdiction:'sentence',jurisdictionLabel:'суд, постановивший приговор'},
  {id:'defer',name:'Отсрочка исполнения приговора / отсрочка или рассрочка штрафа',short:'Отсрочка исполнения приговора',article:'ст. 398 УПК РФ',jurisdiction:'sentence',jurisdictionLabel:'суд, постановивший приговор'},
  {id:'defer-change',name:'Отмена или сокращение отсрочки отбывания наказания',short:'Изменение / отмена отсрочки',article:'п. 17, 17.1, 17.2 ст. 397 УПК РФ · ст. 82, 82.1 УК РФ',jurisdiction:'residence',jurisdictionLabel:'суд по месту жительства осуждённого'},
  {id:'detention-evasion',name:'Заключение под стражу осуждённого, уклоняющегося от отбывания наказания',short:'Заключение под стражу за уклонение',article:'п. 18, 18.1 ст. 397 УПК РФ',jurisdiction:'detention',jurisdictionLabel:'суд по месту задержания осуждённого'},
  {id:'military',name:'Замена наказания / освобождение военнослужащего, уволенного с военной службы',short:'Ограничение по военной службе',article:'п. 19 ст. 397 УПК РФ · ст. 148 УИК РФ',jurisdiction:'institution',jurisdictionLabel:'суд по месту учреждения / органа, исполняющего наказание'},
  {id:'rehabilitation',name:'Возмещение вреда и восстановление прав реабилитированного',short:'Реабилитация',article:'п. 1 ст. 397 УПК РФ',jurisdiction:'sentence',jurisdictionLabel:'суд, постановивший приговор'},
  {id:'property',name:'Меры по обеспечению сохранности имущества или жилого помещения',short:'Сохранность имущества',article:'п. 22 ст. 397 УПК РФ · ст. 313.1 УПК РФ',jurisdiction:'sentence',jurisdictionLabel:'суд, постановивший приговор'},
  {id:'foreign-transfer',name:'Передача осуждённого / исполнения наказания иностранному государству',short:'Передача исполнения иностранному государству',article:'п. 20, 20.1 ст. 397 УПК РФ',jurisdiction:'sentence',jurisdictionLabel:'суд, постановивший приговор'},
  {id:'foreign-recognition',name:'Признание и исполнение приговора суда иностранного государства',short:'Иностранный приговор',article:'п. 21, 23 ст. 397 УПК РФ',jurisdiction:'crimeResidence',jurisdictionLabel:'суд по подсудности преступления и последнему месту жительства в РФ'},
  {id:'conviction-remove',name:'Снятие судимости',short:'Снятие судимости',article:'ст. 400 УПК РФ · ст. 86 УК РФ',jurisdiction:'conviction',jurisdictionLabel:'суд / мировой судья по месту жительства лица, отбывшего наказание'}
];
function criminalExecutionIssue(id){ return CRIMINAL_EXECUTION_ISSUES.filter(function(x){return x.id===id;})[0]||null; }
function criminalExecutionIssueOptions(current){
  return '<option value="" hidden disabled'+(!current?' selected':'')+'></option>'+CRIMINAL_EXECUTION_ISSUES.map(function(x){return '<option value="'+esc(x.id)+'"'+(current===x.id?' selected':'')+'>'+esc(x.short)+'</option>';}).join('');
}
function criminalExecutionJurisdiction(issueId){ var x=criminalExecutionIssue(issueId); return x?x.jurisdiction:''; }
function criminalExecutionRoleList(issueId){
  if(issueId==='rehabilitation')return ['реабилитированный'];
  if(issueId==='pmh'||issueId==='pmh-expert')return ['лицо, в отношении которого исполняется принудительная мера медицинского характера'];
  if(issueId==='conviction-remove')return ['лицо, отбывшее наказание'];
  if(issueId==='cancel-udo')return ['условно-досрочно освобождённый'];
  if(issueId==='conditional'||issueId==='conditional-duties')return ['условно осуждённый'];
  if(issueId==='restriction')return ['осуждённый к ограничению свободы'];
  if(issueId==='defer-change')return ['осуждённый с отсрочкой отбывания наказания'];
  if(issueId==='udo'||issueId==='softer'||issueId==='military'||issueId==='defer')return ['осуждённый','потерпевший'];
  return ['осуждённый'];
}
var MATTER_TYPES = {
  criminal:{n:'Уголовное',short:'УК',c:'#E15B57'}, civil:{n:'Гражданское',short:'ГПК',c:'#4E86C6'},
  admin:{n:'Административное (КАС)',short:'КАС',c:'#35A996'}, koap:{n:'КоАП',short:'КоАП',c:'#D98A2B'},
  other:{n:'Иное',short:'Иное',c:'#7A8FA6'}
};
var MATTER_TYPE_KEYS=['criminal','civil','admin','koap'];
var MATTER_BASIS = {
  agreement:{n:'По соглашению',short:'Соглашение',c:'#2FA08E'},
  assigned:{n:'По назначению',short:'Назначение',c:'#8A6AD8'}
};
var PART_KINDS = { hearing:'Судебное заседание',investigation:'Следственное действие',visit:'Выезд / посещение',meeting:'Встреча',other:'Иное участие' };

var MATTER_STAGE_MAP = {
  criminal:['Материал проверки','Дознание','Следствие МВД','Следствие СК','Первая инстанция','Апелляция','Кассация','Надзор','Исполнение приговора'],
  civil:['Досудебная работа','Первая инстанция','Апелляция','Кассация','Надзор','Исполнение'],
  admin:['Досудебная работа','Первая инстанция','Апелляция','Кассация','Надзор','Исполнение'],
  koap:['Проверка / административное расследование','Первая инстанция','Пересмотр / апелляция','Исполнение'],
  other:STAGE.slice()
};
function matterStageMeta(stage){ return MATTER_STAGE_META[stage]||{c:'#7A8FA6',icon:'flag',mode:'other'}; }
function matterStageMode(type,stage,currentPlace){
  var meta=matterStageMeta(stage),mode=meta.mode||'other';
  if(mode==='completed'){
    if(commonCourtByValue(currentPlace)) return 'judicial';
    if(matterInvestigationOrgByValue(currentPlace)) return 'investigation';
    return 'completed';
  }
  if(type==='koap'&&stage==='Проверка / административное расследование') return 'other';
  return mode;
}
function matterInvestigationOrgByValue(value){
  return MATTER_INVESTIGATION_ORGANS.filter(function(o){return o.value===value;})[0]||null;
}
function matterInvestigationOrgList(stage){
  if(stage==='Дознание') return MATTER_INVESTIGATION_ORGANS.filter(function(o){return o.kind==='inquiry'||o.kind==='fssp';});
  if(stage==='Следствие МВД') return MATTER_INVESTIGATION_ORGANS.filter(function(o){return o.kind==='mvd';});
  if(stage==='Следствие СК') return MATTER_INVESTIGATION_ORGANS.filter(function(o){return o.kind==='sk';});
  if(stage==='Материал проверки') return MATTER_INVESTIGATION_ORGANS.slice();
  return MATTER_INVESTIGATION_ORGANS.slice();
}
function matterPlaceContext(type,stage,currentPlace){
  var mode=matterStageMode(type,stage,currentPlace);
  // В форме уже есть подпись поля. Внутри самого поля не повторяем
  // «выберите суд / орган» — пустое значение выглядит чище и спокойнее.
  if(mode==='judicial') return {mode:mode,label:'Суд',title:'Суд',sub:'Суды и судебные участки',search:'Поиск по судам…',placeholder:'',empty:'',icon:'gavel'};
  if(mode==='investigation') return {mode:mode,label:'Орган расследования',title:'Орган расследования',sub:'Подразделение, ведущее материал или уголовное дело',search:'Поиск по органам расследования…',placeholder:'',empty:'',icon:'brief'};
  if(mode==='execution'&&type==='criminal') return {mode:mode,label:'Суд',title:'Суд',sub:'Суд, разрешающий вопрос в порядке главы 47 УПК РФ',search:'Поиск по судам…',placeholder:'',empty:'',icon:'gavel'};
  if(mode==='execution') return {mode:mode,label:'Орган исполнения',title:'Орган исполнения',sub:'Орган, исполняющий судебный акт',search:'Поиск по органам…',placeholder:'',empty:'',icon:'brief'};
  if(type==='koap'&&stage==='Проверка / административное расследование') return {mode:'other',label:'Орган производства',title:'Орган производства',sub:'Орган, ведущий производство по делу',search:'Поиск по органам…',placeholder:'',empty:'',icon:'brief'};
  return {mode:mode,label:'Орган / ведомство',title:'Орган / ведомство',sub:'Орган или ведомство по делу',search:'Поиск…',placeholder:'',empty:'',icon:'brief'};
}
function matterInvestigatorLabel(stage){
  if(stage==='Дознание')return 'Дознаватель';
  if(stage==='Материал проверки')return 'Должностное лицо / исполнитель';
  return 'Следователь';
}
function matterPlaceEntries(type,stage,currentPlace){
  var ctx=matterPlaceContext(type,stage,currentPlace);
  if(ctx.mode==='judicial'){
    var courts=COMMON_KINESHMA_COURTS.slice();
    // Апелляционная инстанция не может быть мировым судьёй / судебным участком.
    // Поэтому на апелляционных стадиях мировые участки из справочника скрываем.
    if(stage==='Апелляция'||stage==='Пересмотр / апелляция'){
      courts=courts.filter(function(c){return !!c.main;});
    }
    return courts;
  }
  if(ctx.mode==='investigation') return matterInvestigationOrgList(stage);
  if(ctx.mode==='execution'&&type==='criminal'){
    var exIssue=(MED&&MED.executionIssue)||'';
    var jur=criminalExecutionJurisdiction(exIssue);
    var courts=COMMON_KINESHMA_COURTS.slice();
    // По месту учреждения / жительства / задержания вопрос разрешает суд соответствующей территории;
    // мировые участки не подмешиваем. Для суда, постановившего приговор, и снятия судимости
    // мировой судья может быть допустим, поэтому сохраняем весь справочник.
    if(jur==='institution'||jur==='residence'||jur==='detention'||jur==='crimeResidence')courts=courts.filter(function(c){return !!c.main;});
    return courts;
  }
  if(ctx.mode==='execution') return [];
  return [];
}
function matterPlaceChoiceOptions(type,stage,current){
  var selected=current||'',entries=matterPlaceEntries(type,stage,current);
  // Пустую строку «выбрать суд / орган» в premium-списке не показываем:
  // назначение поля уже указано его заголовком.
  return entries.map(function(o){return '<option value="'+esc(o.value)+'"'+(o.value===selected?' selected':'')+'>'+esc(o.short||o.value)+'</option>';}).join('');
}
function matterPlaceDatalist(id,type,stage,current){
  return '<datalist id="'+id+'">'+matterPlaceEntries(type,stage,current).map(function(o){return '<option value="'+esc(o.value)+'">'+esc(o.short||o.value)+'</option>';}).join('')+'</datalist>';
}
var MATTER_ROLE_MAP = {
  // Базовые резервные списки. Основная логика ниже задаётся матрицей
  // «тип производства → стадия → допустимый статус доверителя».
  criminal:[
    'заявитель','лицо, в отношении которого проводится проверка','лицо, которому причинён вред','лицо, дающее объяснение',
    'подозреваемый','обвиняемый','подсудимый','осуждённый','оправданный','потерпевший','частный обвинитель','свидетель',
    'лицо, в отношении которого ведётся производство о применении принудительной меры медицинского характера',
    'лицо, в отношении которого уголовное дело прекращено','реабилитированный','осуждённый','условно-досрочно освобождённый','условно осуждённый',
    'осуждённый к ограничению свободы','осуждённый с отсрочкой отбывания наказания','лицо, отбывшее наказание',
    'лицо, в отношении которого решается вопрос исполнения приговора','лицо, в отношении которого исполняется принудительная мера медицинского характера'
  ],
  civil:[
    'будущий истец','будущий ответчик','заявитель','кредитор','должник','истец','ответчик',
    'третье лицо с самостоятельными требованиями','третье лицо без самостоятельных требований',
    'заинтересованное лицо','взыскатель','лицо, чьи права затронуты судебным актом'
  ],
  admin:[
    'будущий административный истец','будущий административный ответчик','административный истец','административный ответчик',
    'заинтересованное лицо','взыскатель','должник','лицо, чьи права затронуты судебным актом'
  ],
  koap:[
    'лицо, в отношении которого ведётся производство','лицо, привлечённое к административной ответственности','потерпевший','свидетель',
    'законный представитель физического лица','законный представитель юридического лица'
  ],
  other:['заявитель','заинтересованное лицо','взыскатель','должник','истец','ответчик']
};

// Полная матрица допустимых статусов доверителя.
// Статус зависит одновременно от вида производства и фактической стадии.
// При смене стадии несовместимый статус автоматически очищается.
var MATTER_ROLE_STAGE_MAP = {
  criminal:{
    'Материал проверки':[
      'заявитель',
      'лицо, в отношении которого проводится проверка',
      'лицо, которому причинён вред',
      'лицо, дающее объяснение'
    ],
    'Дознание':[
      'подозреваемый','обвиняемый','потерпевший','свидетель',
      'лицо, в отношении которого ведётся производство о применении принудительной меры медицинского характера'
    ],
    'Следствие МВД':[
      'подозреваемый','обвиняемый','потерпевший','свидетель',
      'лицо, в отношении которого ведётся производство о применении принудительной меры медицинского характера'
    ],
    'Следствие СК':[
      'подозреваемый','обвиняемый','потерпевший','свидетель',
      'лицо, в отношении которого ведётся производство о применении принудительной меры медицинского характера'
    ],
    'Первая инстанция':[
      'подсудимый','потерпевший','частный обвинитель','свидетель',
      'лицо, в отношении которого ведётся производство о применении принудительной меры медицинского характера'
    ],
    'Апелляция':[
      'осуждённый','оправданный','потерпевший','частный обвинитель',
      'лицо, в отношении которого уголовное дело прекращено',
      'лицо, в отношении которого ведётся производство о применении принудительной меры медицинского характера'
    ],
    'Кассация':[
      'осуждённый','оправданный','потерпевший','частный обвинитель',
      'лицо, в отношении которого уголовное дело прекращено',
      'лицо, в отношении которого ведётся производство о применении принудительной меры медицинского характера'
    ],
    'Надзор':[
      'осуждённый','оправданный','потерпевший','частный обвинитель',
      'лицо, в отношении которого уголовное дело прекращено',
      'лицо, в отношении которого ведётся производство о применении принудительной меры медицинского характера'
    ],
    'Исполнение приговора':['осуждённый']
  },
  civil:{
    'Досудебная работа':[
      'будущий истец','будущий ответчик','заявитель','кредитор','должник'
    ],
    'Первая инстанция':[
      'истец','ответчик','третье лицо с самостоятельными требованиями','третье лицо без самостоятельных требований',
      'заявитель','заинтересованное лицо','взыскатель','должник'
    ],
    'Апелляция':[
      'истец','ответчик','третье лицо с самостоятельными требованиями','третье лицо без самостоятельных требований',
      'заявитель','заинтересованное лицо','лицо, чьи права затронуты судебным актом'
    ],
    'Кассация':[
      'истец','ответчик','третье лицо с самостоятельными требованиями','третье лицо без самостоятельных требований',
      'заявитель','заинтересованное лицо','взыскатель','должник','лицо, чьи права затронуты судебным актом'
    ],
    'Надзор':[
      'истец','ответчик','третье лицо с самостоятельными требованиями','третье лицо без самостоятельных требований',
      'заявитель','заинтересованное лицо','взыскатель','должник','лицо, чьи права затронуты судебным актом'
    ],
    'Исполнение':['взыскатель','должник']
  },
  admin:{
    'Досудебная работа':[
      'будущий административный истец','будущий административный ответчик','заинтересованное лицо'
    ],
    'Первая инстанция':[
      'административный истец','административный ответчик','заинтересованное лицо','взыскатель','должник'
    ],
    'Апелляция':[
      'административный истец','административный ответчик','заинтересованное лицо','лицо, чьи права затронуты судебным актом'
    ],
    'Кассация':[
      'административный истец','административный ответчик','заинтересованное лицо','взыскатель','должник','лицо, чьи права затронуты судебным актом'
    ],
    'Надзор':[
      'административный истец','административный ответчик','заинтересованное лицо','взыскатель','должник','лицо, чьи права затронуты судебным актом'
    ],
    'Исполнение':['взыскатель','должник']
  },
  koap:{
    'Проверка / административное расследование':[
      'лицо, в отношении которого ведётся производство','потерпевший','свидетель',
      'законный представитель физического лица','законный представитель юридического лица'
    ],
    'Первая инстанция':[
      'лицо, в отношении которого ведётся производство','потерпевший','свидетель',
      'законный представитель физического лица','законный представитель юридического лица'
    ],
    'Пересмотр / апелляция':[
      'лицо, в отношении которого ведётся производство','потерпевший',
      'законный представитель физического лица','законный представитель юридического лица'
    ],
    'Исполнение':[
      'лицо, привлечённое к административной ответственности','потерпевший',
      'законный представитель физического лица','законный представитель юридического лица'
    ]
  }
};

var MATTER_RESTRAINT_MAP = {
  criminal:['подписка о невыезде','запрет определённых действий','личное поручительство','залог','домашний арест','заключение под стражу','наблюдение командования воинской части']
};
var MATTER_ARTICLE_HINTS = {
  criminal:'Например: ч. 2 ст. 228',
  koap:'Например: ч. 1 ст. 12.8 КоАП РФ',
  other:'Статья, договор, основание спора — при необходимости'
};
function matterStageList(type,basis){
  var list=(MATTER_STAGE_MAP[type]||STAGE).slice();
  // В рабочей модели приложения уголовные дела по назначению ведём только
  // на стадиях, где защита по назначению используется в практике пользователя.
  // Материал проверки, кассация, надзор и исполнение приговора — только по соглашению.
  if(type==='criminal'&&basis==='assigned'){
    var allowed={'Дознание':1,'Следствие МВД':1,'Следствие СК':1,'Первая инстанция':1,'Апелляция':1};
    list=list.filter(function(stage){return !!allowed[stage];});
  }
  return list;
}
function matterRoleList(type,stage,executionIssue){
  if(type==='criminal'&&stage==='Исполнение приговора')return criminalExecutionRoleList(executionIssue||'');
  var byType=MATTER_ROLE_STAGE_MAP[type]||null;
  if(byType&&stage&&byType[stage]) return byType[stage].slice();
  return (MATTER_ROLE_MAP[type]||MATTER_ROLE_MAP.other).slice();
}
// Полное процессуальное наименование хранится в данных и показывается в списке
// выбора. В компактных полях карточки используем короткую понятную подпись,
// чтобы длинный статус не ломал геометрию формы на iPhone.
function matterRoleDisplayLabel(type,stage,role){
  var r=String(role||'').trim();
  if(!r)return '';
  var shortMap={
    'лицо, в отношении которого проводится проверка':'Проверяемое лицо',
    'лицо, которому причинён вред':'Лицо, которому причинён вред',
    'лицо, дающее объяснение':'Даёт объяснение',
    'лицо, в отношении которого ведётся производство о применении принудительной меры медицинского характера':'Лицо по ПММХ',
    'лицо, в отношении которого исполняется принудительная мера медицинского характера':'Лицо по ПММХ',
    'условно-досрочно освобождённый':'Условно-досрочно освобождённый',
    'условно осуждённый':'Условно осуждённый',
    'осуждённый к ограничению свободы':'Ограничение свободы',
    'осуждённый с отсрочкой отбывания наказания':'Осуждённый с отсрочкой',
    'лицо, отбывшее наказание':'Лицо, отбывшее наказание',
    'лицо, в отношении которого исполняется принудительная мера медицинского характера':'Лицо по ПММХ',
    'лицо, в отношении которого уголовное дело прекращено':'Дело прекращено',
    'лицо, в отношении которого решается вопрос исполнения приговора':'Вопрос исполнения приговора',
    'третье лицо с самостоятельными требованиями':'3-е лицо с требованиями',
    'третье лицо без самостоятельных требований':'3-е лицо без требований',
    'лицо, чьи права затронуты судебным актом':'Права затронуты судебным актом',
    'будущий административный истец':'Будущий адм. истец',
    'будущий административный ответчик':'Будущий адм. ответчик',
    'лицо, в отношении которого ведётся производство':'Привлекаемое лицо',
    'лицо, привлечённое к административной ответственности':'Привлечён к ответственности',
    'законный представитель физического лица':'Законный представитель физлица',
    'законный представитель юридического лица':'Законный представитель юрлица'
  };
  return shortMap[r]||r;
}
function normalizeMatterClientRole(type,role,stage,executionIssue){
  var r=String(role||'').trim();
  if(!r)return '';
  var legacy={
    'осужденный':'осуждённый',
    'лицо, привлекаемое к административной ответственности':'лицо, в отношении которого ведётся производство',
    'пострадавший':'лицо, которому причинён вред',
    'пострадавший (до признания потерпевшим)':'лицо, которому причинён вред'
  };
  r=legacy[r]||r;
  if(type==='criminal'&&stage==='Материал проверки'){
    if(r==='потерпевший')r='лицо, которому причинён вред';
    if(r==='свидетель')r='лицо, дающее объяснение';
  }
  // «Гражданский истец» и «гражданский ответчик» намеренно не являются
  // основными статусами доверителя в уголовной карточке. Старые значения
  // не переопределяем автоматически, а очищаем, чтобы пользователь выбрал
  // актуальное процессуальное положение доверителя.
  if(type==='criminal'&&(r==='гражданский истец'||r==='гражданский ответчик'))return '';
  if(r==='представитель'||r==='защитник')return '';
  return matterRoleList(type,stage,executionIssue).indexOf(r)>=0?r:'';
}
function matterRestraintList(type){ return (MATTER_RESTRAINT_MAP[type]||[]).slice(); }
function matterChoiceOptions(list,current,emptyLabel){
  return '<option value="">'+esc(emptyLabel||'— выбрать —')+'</option>'+list.map(function(x){ return '<option value="'+esc(x)+'"'+(current===x?' selected':'')+'>'+esc(x)+'</option>'; }).join('');
}
function matterChoiceDatalist(id,list){ return '<datalist id="'+id+'">'+list.map(function(x){ return '<option value="'+esc(x)+'"></option>'; }).join('')+'</datalist>'; }
function inlineMatterChoiceField(inputId,selectId,value,placeholder,list,emptyLabel,listId){
  listId=listId||('list-'+inputId);
  return inlineChoiceField(inputId,selectId,value,placeholder,matterChoiceOptions(list,value,emptyLabel),listId)+matterChoiceDatalist(listId,list);
}
function normalizeMatterArticle(type,value){
  var v=String(value||'').trim().replace(/\s+/g,' ');
  if(!v)return '';
  if(type!=='criminal')return v;
  // Для уголовной категории кодекс фиксирован: пользователь вводит только
  // часть / статью, а «УК РФ» приложение добавляет автоматически.
  if(/УК\s*РФ/i.test(v)) return v.replace(/УК\s*РФ/ig,'УК РФ');
  return v ? (v+' УК РФ') : '';
}
function matterArticleLabel(type){
  if(type==='criminal')return 'Статья УК РФ';
  if(type==='koap')return 'Статья КоАП РФ';
  return 'Статья / квалификация';
}

function matterAutoTitlePiece(value,maxLen){
  var text=String(value||'').replace(/\s+/g,' ').trim();
  if(!text)return '';
  maxLen=maxLen||72;
  // Для описания берём первую смысловую фразу: именно она играет роль
  // краткого предмета дела в автоматически сформированном названии.
  var sentence=text.match(/^(.+?)(?:[.!?](?:\s|$)|$)/);
  var piece=(sentence&&sentence[1]?sentence[1]:text).trim();
  if(piece.length<=maxLen)return piece;
  var cut=piece.slice(0,maxLen+1),space=cut.lastIndexOf(' ');
  if(space>Math.floor(maxLen*.62))cut=cut.slice(0,space);
  else cut=cut.slice(0,maxLen);
  return cut.replace(/[,:;\-–—\s]+$/,'').trim()+'…';
}
function matterAutoClientLabel(value){
  var text=String(value||'').replace(/\s+/g,' ').trim();
  if(!text)return '';
  // Организации и ИП оставляем как введены: сокращение ФИО здесь неуместно.
  if(/^(?:ООО|АО|ПАО|ИП|ФКУ|ФКУЗ|ГУ|МБУ|МУП|УФСИН|ОМВД|МВД|СУ\s+СК|РОСП)\b/i.test(text) || /[«»"]/.test(text)){
    return matterAutoTitlePiece(text,58);
  }
  // Уже сокращённое ФИО вида «Иванов И.И.» не меняем.
  if(/^[А-ЯЁA-Z][А-Яа-яЁёA-Za-z'’\-]+\s+[А-ЯЁA-Z]\.[А-ЯЁA-Z]\.?$/u.test(text))return text;
  var words=text.split(' ');
  if(words.length>=2 && words.length<=4 && words.every(function(w){return /^[А-ЯЁA-Z][А-Яа-яЁёA-Za-z'’\-]+$/u.test(w);} )){
    var initials=words.slice(1,3).map(function(w){return w.charAt(0).toUpperCase()+'.';}).join('');
    return words[0]+(initials?' '+initials:'');
  }
  return matterAutoTitlePiece(text,58);
}
function matterAutoTitle(o){
  o=o||{};
  var type=o.type||'other';
  var client=matterAutoClientLabel(o.client||'');
  var article=matterAutoTitlePiece(o.article||'',60);
  var subject=matterAutoTitlePiece(o.notes||'',58);
  var execution='';
  if(type==='criminal'&&o.stage==='Исполнение приговора'&&o.executionIssue){
    var issue=criminalExecutionIssue(o.executionIssue);
    execution=issue?(issue.short||issue.name||''):'';
  }
  var parts=[];
  function add(part){
    part=String(part||'').replace(/\s+/g,' ').trim();
    if(!part)return;
    var low=part.toLowerCase().replace(/ё/g,'е');
    if(parts.some(function(x){
      var xl=x.toLowerCase().replace(/ё/g,'е');
      return xl===low||xl.indexOf(low)>=0||low.indexOf(xl)>=0;
    }))return;
    parts.push(part);
  }

  // Автозаголовок зависит от вида производства.
  // Уголовное: Фамилия — статья (или конкретный вопрос исполнения приговора).
  // Гражданское: Фамилия — предмет спора из первой фразы описания.
  // КАС: Фамилия — предмет административного спора.
  // КоАП: Фамилия — статья КоАП; при её отсутствии — краткая суть.
  add(client);
  if(type==='criminal'){
    if(execution)add(execution);
    else if(article)add(article);
    else if(subject)add(subject);
    else add('уголовное дело');
  }else if(type==='civil'){
    if(subject)add(subject);
    else add('гражданский спор');
  }else if(type==='admin'){
    if(subject)add(subject);
    else add('административный спор');
  }else if(type==='koap'){
    if(article)add(article);
    else if(subject)add(subject);
    else add('дело по КоАП РФ');
  }else{
    if(subject)add(subject);
    else if(article)add(article);
    else add('дело');
  }

  if(parts.length)return parts.join(' — ');
  var fallback={criminal:'Уголовное дело',civil:'Гражданский спор',admin:'Административный спор',koap:'Дело по КоАП РФ',other:'Дело'};
  return fallback[type]||'Дело';
}
function matterMeta(type,basis){
  var t=type||'other';
  var base={
    numberLabel:'Номер дела / материала', courtLabel:'Суд / орган / ведомство', judgeLabel:'Судья', investigatorLabel:'Следователь / дознаватель',
    clientLabel:'Доверитель', clientPlaceholder:'ФИО / организация', titlePlaceholder:'Иванов И.И. — взыскание долга',
    roleLabel:'Статус доверителя', opponentLabel:'Оппонент / другая сторона', opponentPlaceholder:'ФИО / организация',
    showJudge:true, showInvestigator:false, showArticle:false, showRestraint:false, showOpponent:true,
    stageList:matterStageList(t,basis), roleList:matterRoleList(t,''), restraintList:matterRestraintList(t), articlePlaceholder:MATTER_ARTICLE_HINTS[t]||''
  };
  if(t==='criminal') return Object.assign(base,{
    numberLabel:'Номер дела / материала', courtLabel:'Суд / следственный орган / ведомство', clientLabel:'Подзащитный / доверитель',
    clientPlaceholder:'ФИО подзащитного / доверителя', titlePlaceholder:'Иванов И.И. — защита по уголовному делу',
    roleLabel:'Статус доверителя', opponentLabel:'Потерпевший / иной участник', opponentPlaceholder:'Потерпевший, иной участник…',
    showJudge:true, showInvestigator:true, showArticle:true, showRestraint:true, showOpponent:true
  });
  if(t==='civil') return Object.assign(base,{
    numberLabel:'Номер дела', courtLabel:'Суд / орган / ведомство', clientLabel:'Доверитель', titlePlaceholder:'Иванов И.И. — взыскание долга',
    roleLabel:'Статус доверителя', opponentLabel:'Ответчик / другая сторона', opponentPlaceholder:'Ответчик, истец по встречному иску…',
    showJudge:true, showInvestigator:false, showArticle:false, showRestraint:false, showOpponent:true
  });
  if(t==='admin') return Object.assign(base,{
    numberLabel:'Номер дела', courtLabel:'Суд / административный орган', clientLabel:'Доверитель', titlePlaceholder:'Иванов И.И. — административный иск',
    roleLabel:'Статус доверителя', opponentLabel:'Административный ответчик / орган', opponentPlaceholder:'Орган, должностное лицо…',
    showJudge:true, showInvestigator:false, showArticle:false, showRestraint:false, showOpponent:true
  });
  if(t==='koap') return Object.assign(base,{
    numberLabel:'Номер дела / протокола', courtLabel:'Суд / орган / должностное лицо', clientLabel:'Лицо / доверитель', titlePlaceholder:'Иванов И.И. — дело по КоАП',
    judgeLabel:'Судья / должностное лицо', roleLabel:'Статус доверителя', opponentLabel:'Орган / потерпевший', opponentPlaceholder:'Отдел МВД, инспектор, потерпевший…',
    showJudge:true, showInvestigator:false, showArticle:true, showRestraint:false, showOpponent:true
  });
  return Object.assign(base,{
    titlePlaceholder:'Иванов И.И. — рабочее дело', roleLabel:'Статус доверителя', showJudge:true, showInvestigator:false,
    showArticle:true, showRestraint:false, showOpponent:true
  });
}
function pullMatterDraft(){
  if(!MED)return;
  var map={type:'#m-type',basis:'#m-basis',client:'#m-client',phone:'#m-phone',number:'#m-number',stage:'#m-stage',executionIssue:'#m-execution-issue',executionInstitution:'#m-execution-institution',court:'#m-court',judge:'#m-judge',investigator:'#m-investigator',article:'#m-article',role:'#m-role',restraint:'#m-restraint',opponent:'#m-opponent',dayRate:'#m-dayrate',notes:'#m-notes'};
  Object.keys(map).forEach(function(k){ var e=$(map[k]); if(!e)return; MED[k]=(k==='dayRate'?(+e.value||0):e.value.trim()); });
  MED.phone=formatRussianPhone(MED.phone||'');
  MED.article=normalizeMatterArticle(MED.type||'other',MED.article||'');
  // Поля редактора динамические: часть из них исчезает при смене типа/стадии.
  // После чтения формы сразу очищаем значения, которые больше не относятся
  // к текущему контексту, чтобы скрытые старые данные не возвращались позже.
  MED=sanitizeMatterByType(MED);
}
function matterDynamicFields(){
  var cfg=matterMeta((MED&&MED.type)||'other',(MED&&MED.basis)||'');
  var currentStage=(MED&&MED.stage)||cfg.stageList[0]||'';
  var legacyCompleted=currentStage==='Завершено';
  if(!legacyCompleted&&cfg.stageList.indexOf(currentStage)<0) currentStage=cfg.stageList[0]||'';
  if(MED&&!legacyCompleted)MED.stage=currentStage;
  // «Завершено» больше не является выбираемой стадией. Для старых записей
  // значение сохраняем только как read-only, чтобы редактирование не оживляло дело случайно.
  var stageField=legacyCompleted
    ? '<select id="m-stage" disabled aria-label="Завершённое дело"><option value="Завершено" selected>Завершено</option></select>'
    : '<select id="m-stage">'+cfg.stageList.map(function(x){return '<option value="'+esc(x)+'"'+(currentStage===x?' selected':'')+'>'+esc(x)+'</option>';}).join('')+'</select>';
  var placeCtx=matterPlaceContext((MED&&MED.type)||'other',currentStage,(MED&&MED.court)||'');
  var placeEntries=matterPlaceEntries((MED&&MED.type)||'other',currentStage,(MED&&MED.court)||'');
  var placeField=placeEntries.length
    ? inlineChoiceField('m-court','m-court-choice',MED.court||'',placeCtx.placeholder,matterPlaceChoiceOptions((MED&&MED.type)||'other',currentStage,MED.court||''),'matter-place-options')+matterPlaceDatalist('matter-place-options',(MED&&MED.type)||'other',currentStage,MED.court||'')
    : '<input id="m-court" value="'+esc(MED.court||'')+'" placeholder="'+esc(placeCtx.placeholder)+'">';
  var showJudgeNow=!!(cfg.showJudge&&(placeCtx.mode==='judicial'||(placeCtx.mode==='execution'&&(MED&&MED.type)==='criminal')));
  var showInvestigatorNow=!!(cfg.showInvestigator&&placeCtx.mode==='investigation');
  if(showJudgeNow&&MED&&MED.judge&&!judgeAllowedForCourt(MED.judge,MED.court||'',MED.type||'',currentStage))MED.judge='';
  var judgeField=showJudgeNow?inlineMatterChoiceField('m-judge','m-judge-choice',MED.judge||'','Фамилия И.О.',judgeDirectory((MED&&MED.court)||'',(MED&&MED.type)||'',currentStage).map(function(x){return x.judge;}),'— выбрать судью —','m-judge-list'):'';
  var currentRoleList=matterRoleList((MED&&MED.type)||'other',currentStage,(MED&&MED.executionIssue)||'');
  var currentRole=normalizeMatterClientRole((MED&&MED.type)||'other',(MED&&MED.role)||'',currentStage,(MED&&MED.executionIssue)||'');
  if(MED)MED.role=currentRole;
  var roleField='<select id="m-role"><option value="" hidden disabled'+(!currentRole?' selected':'')+'></option>'+currentRoleList.map(function(x){return '<option value="'+esc(x)+'"'+(currentRole===x?' selected':'')+'>'+esc(x)+'</option>';}).join('')+'</select>';
  var showRestraintNow=!!(cfg.showRestraint&&currentStage!=='Материал проверки'&&currentStage!=='Исполнение приговора');
  if(MED&&!showRestraintNow) MED.restraint='';
  var restraintField=showRestraintNow?inlineMatterChoiceField('m-restraint','m-restraint-choice',MED.restraint||'','Введите или выберите меру',cfg.restraintList,'— выбрать меру —','m-restraint-list'):'';
  var executionBlock='';
  if((MED&&MED.type)==='criminal'&&currentStage==='Исполнение приговора'){
    var exIssue=criminalExecutionIssue((MED&&MED.executionIssue)||'');
    executionBlock='<div class="fld matter-execution-issue"><label>Вопрос исполнения приговора *</label><select id="m-execution-issue">'+criminalExecutionIssueOptions((MED&&MED.executionIssue)||'')+'</select></div>';
    if(exIssue){
      executionBlock+='<div class="hint matter-execution-jurisdiction"><b>Подсудность:</b> '+esc(exIssue.jurisdictionLabel)+' · '+esc(exIssue.article)+'</div>';
      if(exIssue.jurisdiction==='institution')executionBlock+='<div class="fld"><label>Учреждение / место отбывания наказания</label><input id="m-execution-institution" value="'+esc(MED.executionInstitution||'')+'" placeholder="Например: ИК-4, УФИЦ, медицинская организация"></div>';
    }
  }
  var html=''+
    '<div class="fld"><label>'+esc(cfg.clientLabel)+'</label><input id="m-client" value="'+esc(MED.client)+'" placeholder="'+esc(cfg.clientPlaceholder)+'"></div>'+
    '<div class="fld"><label>Телефон</label><input id="m-phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="18" value="'+esc(formatRussianPhone(MED.phone))+'" placeholder="+7 (___) ___-__-__"></div>'+
    '<div class="fld matter-number-field"><label>'+esc(cfg.numberLabel)+'</label><input id="m-number" value="'+esc(MED.number)+'"></div>'+
    '<div class="fld matter-stage-field matter-stage-field-full"><label>Стадия</label>'+stageField+'</div>'+
    executionBlock+
    '<div class="fld matter-court-field matter-hybrid-choice-field" data-place-mode="'+esc(placeCtx.mode)+'"><label>'+esc(placeCtx.label)+'</label>'+placeField+'</div>';

  if(showJudgeNow){
    html += '<div class="fld matter-judge-field matter-hybrid-choice-field"><label>'+esc(cfg.judgeLabel)+'</label>'+judgeField+'</div>';
  }else if(showInvestigatorNow){
    var invLabel=matterInvestigatorLabel(currentStage);
    html += '<div class="fld"><label>'+esc(invLabel)+'</label><input id="m-investigator" value="'+esc(MED.investigator||'')+'" placeholder="Фамилия И.О."></div>';
  }

  if(cfg.showArticle){
    if((MED&&MED.type)==='criminal'){
      html += '<div class="fld matter-article-field matter-article-field-wide"><label>'+esc(matterArticleLabel((MED&&MED.type)||'other'))+'</label><textarea id="m-article" rows="3" placeholder="Например: ч. 3 ст. 30, ч. 5 ст. 228.1; ч. 2 ст. 228">'+esc(MED.article||'')+'</textarea></div>';
      html += '<div class="fld matter-role-field-wide"><label>'+esc(cfg.roleLabel)+'</label>'+roleField+'</div>';
    }else{
      html += '<div class="fld"><label>'+esc(matterArticleLabel((MED&&MED.type)||'other'))+'</label><input id="m-article" value="'+esc(MED.article||'')+'" placeholder="'+esc(cfg.articlePlaceholder||'')+'"></div>';
      html += '<div class="fld"><label>'+esc(cfg.roleLabel)+'</label>'+roleField+'</div>';
    }
  }else{
    html += '<div class="fld"><label>'+esc(cfg.roleLabel)+'</label>'+roleField+'</div>';
  }

  if(showRestraintNow){
    html += '<div class="fld matter-restraint-field matter-hybrid-choice-field"><label>Мера пресечения</label>'+restraintField+'</div>';
  }
  if(cfg.showOpponent){
    var oppLabel=cfg.opponentLabel,oppPlaceholder=cfg.opponentPlaceholder||'';
    if((MED&&MED.type)==='criminal'&&currentStage==='Исполнение приговора'){
      oppLabel='Учреждение / орган / иной участник'; oppPlaceholder='ИК, УФИЦ, УИИ, прокурор, потерпевший…';
    }
    html += '<div class="fld"><label>'+esc(oppLabel)+'</label><input id="m-opponent" value="'+esc(MED.opponent||'')+'" placeholder="'+esc(oppPlaceholder)+'"></div>';
  }
  var notesType=(MED&&MED.type)||'other';
  var notesLabel=notesType==='civil'?'Предмет спора / суть дела':(notesType==='admin'?'Предмет административного спора / суть дела':'Суть дела / рабочая заметка');
  var notesPlaceholder=notesType==='civil'?'Например: иск о разделе имущества; определение порядка общения с ребёнком…':(notesType==='admin'?'Например: оспаривание действий пристава; признание решения незаконным…':'Кратко: предмет дела, спор или основной вопрос…');
  var notesHint=notesType==='civil'?'Первая фраза формирует название гражданского дела вместе с фамилией доверителя.':'Первая фраза используется приложением для автоматического названия дела.';
  html += '<div class="fld"><label>'+esc(notesLabel)+'</label><textarea id="m-notes" rows="4" placeholder="'+esc(notesPlaceholder)+'">'+esc(MED.notes||'')+'</textarea><small class="fieldhint">'+esc(notesHint)+'</small></div>';
  return html;
}
function renderMatterDynamic(){ var box=$('#matter-dynamic'); if(box){ box.innerHTML=matterDynamicFields(); setTimeout(function(){upgradePremiumSelects(box);},0); } }
function normalizeLegacyMatterStage(o){
  if(!o)return o;
  if(o.type==='criminal'){
    if(o.stage==='Проверка сообщения')o.stage='Материал проверки';
    else if(o.stage==='Досудебная работа')o.stage='Материал проверки';
    else if(o.stage==='Дознание / следствие')o.stage='Следствие МВД';
    else if(o.stage==='Консультация')o.stage='Материал проверки';
    else if(o.stage==='Исполнение')o.stage='Исполнение приговора';
  }else if(o.stage==='Консультация'){
    o.stage=(o.type==='koap')?'Проверка / административное расследование':'Досудебная работа';
  }
  if((o.stage==='Исполнение'||o.stage==='Исполнение приговора')&&o.court==='Кинешемский РОСП')o.court='';
  return o;
}
function sanitizeMatterByType(o){
  o=normalizeLegacyMatterStage(o);
  var cfg=matterMeta(o.type||'other',o.basis||'');
  if(!cfg.showInvestigator) o.investigator='';
  if(!cfg.showArticle) o.article='';
  else o.article=normalizeMatterArticle(o.type||'other',o.article||'');
  if(!cfg.showRestraint || (o.type==='criminal'&&(o.stage==='Материал проверки'||o.stage==='Исполнение приговора'))) o.restraint='';
  if(!cfg.showJudge) o.judge='';
  if(!cfg.showOpponent) o.opponent='';
  var stageBeforeBasisCheck=o.stage||'';
  if(o.stage!=='Завершено'&&!cfg.stageList.filter(function(x){ return x===o.stage; }).length) o.stage=cfg.stageList[0]||o.stage||'';
  if(stageBeforeBasisCheck!==o.stage){
    // Основание или тип производства сделали прежнюю стадию недопустимой.
    // Не переносим в новую стадию суд/орган, судью, исполнителя и процессуальные поля по инерции.
    o.court='';o.judge='';o.investigator='';o.role='';o.restraint='';o.executionIssue='';o.executionInstitution='';
  }
  if(o.type!=='criminal'||o.stage!=='Исполнение приговора'){o.executionIssue='';o.executionInstitution='';}
  else if(o.executionIssue&&!criminalExecutionIssue(o.executionIssue)){o.executionIssue='';o.executionInstitution='';}

  // 5.0.25: взаимно исключаемые реквизиты очищаются не только визуально,
  // но и в самой записи дела. Иначе старый судья мог снова появиться после
  // перехода на дознание, а следователь — после возврата в судебную стадию.
  var ctx=matterPlaceContext(o.type||'other',o.stage||'',o.court||'');
  var judicial=ctx.mode==='judicial'||(ctx.mode==='execution'&&o.type==='criminal');
  var investigation=ctx.mode==='investigation';
  if(judicial){
    o.investigator='';
    if(matterInvestigationOrgByValue(o.court||'')) o.court='';
    // Для известных судов не оставляем судью, которого этот суд/тип дела не допускает.
    if(o.judge&&commonCourtByValue(o.court||'')&&!judgeAllowedForCourt(o.judge,o.court||'',o.type||'',o.stage||'')) o.judge='';
  }else if(investigation){
    o.judge='';
    if(commonCourtByValue(o.court||'')) o.court='';
    var knownOrg=matterInvestigationOrgByValue(o.court||'');
    if(knownOrg){
      var allowed=matterInvestigationOrgList(o.stage||'').map(function(x){return x.value;});
      if(allowed.indexOf(o.court)<0) o.court='';
    }
  }else{
    o.judge='';
    o.investigator='';
  }

  o.role=normalizeMatterClientRole(o.type||'other',o.role,o.stage||'',o.executionIssue||'');
  if(typeof o.basis!=='string') o.basis='';
  return o;
}
function matterDossierRows(m){
  var cfg=matterMeta(m&&m.type,m&&m.basis), rows=[],ctx=matterPlaceContext((m&&m.type)||'other',(m&&m.stage)||'',(m&&m.court)||'');
  function push(icon,label,val){ if(val) rows.push([icon,label,val]); }
  push('user',cfg.clientLabel,m.client);
  push('phone','Телефон',m.phone);
  push('folder',cfg.numberLabel,m.number);
  push((ctx.mode==='judicial'||(ctx.mode==='execution'&&m.type==='criminal'))?'gavel':'brief',ctx.label,m.court);
  if((ctx.mode==='judicial'||(ctx.mode==='execution'&&m.type==='criminal'))&&cfg.showJudge) push('user',cfg.judgeLabel,m.judge);
  if(m.type==='criminal'&&m.stage==='Исполнение приговора'&&m.executionIssue){ var exd=criminalExecutionIssue(m.executionIssue); if(exd){push('gavel','Вопрос исполнения приговора',exd.short); push('doc','Правовое основание',exd.article); push('brief','Подсудность',exd.jurisdictionLabel);} }
  if(m.type==='criminal'&&m.stage==='Исполнение приговора') push('brief','Учреждение / место отбывания',m.executionInstitution);
  if(ctx.mode==='investigation'&&cfg.showInvestigator) push('user',matterInvestigatorLabel(m.stage),m.investigator);
  if(cfg.showArticle) push('lock',matterArticleLabel((m&&m.type)||'other'),m.article);
  push('user',cfg.roleLabel,matterRoleDisplayLabel((m&&m.type)||'other',(m&&m.stage)||'',m.role));
  if(cfg.showRestraint&&m.stage!=='Материал проверки'&&m.stage!=='Исполнение приговора') push('lock','Мера пресечения',m.restraint);
  if(cfg.showOpponent) push('user',cfg.opponentLabel,m.opponent);
  push('doc','Основание ведения',matterBasisLabel(m.basis));
  push('clock','Стадия',m.stage);
  push('doc','Суть / рабочая заметка',m.notes);
  return rows;
}

function matterType(m){ return MATTER_TYPES[m&&m.type]||MATTER_TYPES.other; }
function matterBasisMeta(v){ return MATTER_BASIS[v]||null; }
function matterBasisLabel(v){ var x=matterBasisMeta(v); return x?x.n:''; }
function sameRecordId(a,b){ return String(a==null?'':a)===String(b==null?'':b); }
function participationOf(id){ return S.participation.filter(function(p){ return sameRecordId(p.mid,id); }); }
function journalOf(id){ return S.journal.filter(function(j){ return sameRecordId(j.mid,id); }); }


function matter(id){ return S.matters.filter(function(m){ return sameRecordId(m.id,id); })[0]; }
function tasksOf(id){ return S.tasks.filter(function(t){ return sameRecordId(t.mid,id); }); }
function activeM(){ return S.matters.filter(function(m){ return !m.archived; }); }

var HEARING_RESULTS={
  held:{label:'Состоялось',tone:'held',sheetTitle:'Состоялось',sheetSub:'Заседание прошло'},
  postponed:{label:'Отложено',tone:'postponed',sheetTitle:'Отложено',sheetSub:'Перенесено или объявлен перерыв'},
  break:{label:'Объявлен перерыв',tone:'break',sheetTitle:'Перерыв',sheetSub:'Продолжение заседания'},
  completed:{label:'Рассмотрение завершено',tone:'completed',sheetTitle:'Завершено',sheetSub:'Рассмотрение окончено'},
  cancelled:{label:'Не состоялось / снято',tone:'cancelled',sheetTitle:'Не состоялось',sheetSub:'Снято или не рассмотрено'}
};
var HEARING_RESULT_CHOICES=['held','postponed','cancelled'];
function hearingResultInfo(t){ return t&&t.hearingResultStatus?HEARING_RESULTS[t.hearingResultStatus]||null:null; }
function completedHearingFeedback(t){
  var ri=hearingResultInfo(t);
  var msg='Результат уже сохранён';
  if(ri&&ri.label) msg='Результат: '+ri.label;
  toast(msg);
}
function hearingHasResult(t){ return !!(t&&t.kind==='hearing'&&t.hearingResultStatus); }
function hearingStartTime(t){
  if(!t||t.kind!=='hearing'||!t.due||!t.time)return null;
  var d=new Date(t.due+'T'+t.time+':00');
  return isNaN(d.getTime())?null:d;
}
function hearingNeedsResult(t){
  if(!t||t.kind!=='hearing'||t.done||hearingHasResult(t)||!t.due)return false;
  var diff=dd(t.due);
  if(diff<0)return true;
  if(diff>0)return false;
  var at=hearingStartTime(t);
  return !!(at&&Date.now()>=at.getTime());
}
function meetingStartTime(t){
  if(!t||t.kind!=='meeting'||!t.due||!t.time)return null;
  var d=new Date(t.due+'T'+t.time+':00');
  return isNaN(d.getTime())?null:d;
}
function meetingOccurred(t){
  if(!t||t.kind!=='meeting'||t.done||!t.due)return false;
  var diff=dd(t.due);
  if(diff<0)return true;
  if(diff>0)return false;
  var at=meetingStartTime(t);
  return !!(at&&Date.now()>=at.getTime());
}
function isPastHearing(t){ return !!(t&&t.kind==='hearing'&&t.due&&dd(t.due)<0&&!hearingNeedsResult(t)); }
function isActiveRecord(t){ return !!(t && !t.done && !meetingOccurred(t)); }
function overdue(){ return S.tasks.filter(function(t){ return !t.done && (t.kind==='task'||t.kind==='deadline') && t.due && dd(t.due)<0; }); }
function dueToday(){ return S.tasks.filter(function(t){ return !t.done && !meetingOccurred(t) && t.due===today(); }); }
function sortT(a,b){
  if(a.done!==b.done) return a.done?1:-1;
  if(!!a.due!==!!b.due) return a.due?-1:1;
  if(a.due&&b.due&&a.due!==b.due) return a.due<b.due?-1:1;
  if((a.time||'')!==(b.time||'')) return (a.time||'99')<(b.time||'99')?-1:1;
  var o = {high:0,mid:1,low:2}; return o[a.pri]-o[b.pri];
}
function stepsDone(t){ return (t.steps||[]).filter(function(s){ return s.d; }).length; }

/* ------------------------- sheets ------------------------- */
/* Шторка: содержимое прокручивается, а кнопки действий закреплены внизу —
   их всегда видно и не нужно доскролливать до конца длинной формы. */
function openSheet(html){
  var s = $('#sheet');
  s.classList.remove('quick-sheet','task-editor-sheet','hearing-result-sheet','filter-premium-sheet','task-filter-premium','matter-filter-premium','matter-editor-sheet','task-actions-premium','matter-actions-premium','sheet-premium-form','sheet-premium-search','notify-premium-sheet');
  s.innerHTML = '<div class="grab"></div>'+html;
  var kids = Array.prototype.slice.call(s.children).filter(function(n){ return !n.classList.contains('grab'); });
  var foot = kids.filter(function(n){ return n.tagName === 'BUTTON'; });
  if(foot.length){
    var body = document.createElement('div'); body.className = 'shbody';
    kids.forEach(function(n){ if(foot.indexOf(n) < 0) body.appendChild(n); });
    var f = document.createElement('div'); f.className = 'shfoot';
    foot.forEach(function(n){ f.appendChild(n); });
    s.appendChild(body); s.appendChild(f);
    s.classList.add('withfoot');
  } else s.classList.remove('withfoot');
  s.classList.add('open'); $('#scrim').classList.add('open'); s.scrollTop = 0;
  setTimeout(function(){upgradePremiumSelects(s);},0);
}
function openPage(html){ var p = $('#page'); p.innerHTML = html; p._mid = null; p._navType = 'page';
  p.classList.add('open'); $('#scrim').classList.add('open'); p.scrollTop = 0; }
function closeAll(){ if(LIST_PICKER)closePremiumListPicker(); if(TIME_PICKER)closePremiumTimePicker(); if(DATE_PICKER)closePremiumDatePicker(); $('#sheet').classList.remove('open'); $('#page').classList.remove('open');
  $('#page')._mid=null; $('#page')._navType=''; $('#scrim').classList.remove('open'); }
function closeSheet(){ var sh=$('#sheet'); sh.classList.remove('open');
  if(!$('#page').classList.contains('open')) $('#scrim').classList.remove('open');
  setTimeout(function(){ if(!sh.classList.contains('open')){ sh.classList.remove('matter-editor-sheet'); } },380); }

/* =====================================================================
   TASK CARD
   ===================================================================== */
function dueTag(t){
  if(!t.due) return '';
  var n = dd(t.due), c='', s='';
  if(t.kind==='hearing'){
    c = (!t.done && n>=0 && n<=1) ? 'yel' : '';
    s = n===0 ? 'сегодня' : n===1 ? 'завтра' : n<0 ? fmtShort(t.due) : relD(t.due);
  }else if(t.kind==='meeting'){
    c = (!t.done && n>=0 && n<=1) ? 'yel' : '';
    s = n===0 ? 'сегодня' : n===1 ? 'завтра' : n<0 ? fmtShort(t.due) : relD(t.due);
  }else{
    c = t.done ? '' : (n<0?'red':n<=1?'yel':n<=6?'':'');
    s = t.done ? fmtShort(t.due) : relD(t.due);
  }
  return '<span class="tag '+c+'">'+ico('cal','s')+esc(s)+'</span>';
}

function kindTag(t){
  var cls='kind-'+(t.kind||'task');
  if(t.kind==='hearing') return '<span class="tag kind-tag '+cls+'">'+ico('gavel','s')+'Заседание</span>';
  if(t.kind==='meeting') return '<span class="tag kind-tag '+cls+'">'+ico('user','s')+'Встреча</span>';
  if(t.kind==='deadline') return '<span class="tag kind-tag '+cls+'">'+ico('clock','s')+'Срок</span>';
  return '<span class="tag kind-tag '+cls+'">'+ico('check','s')+'Задача</span>';
}

function taskCard(t,opts){
  opts = opts||{};
  var m = t.mid ? matter(t.mid) : null;
  var hearing=t.kind==='hearing', rinfo=hearingResultInfo(t), needResult=hearingNeedsResult(t);
  var title = hearing ? (m?(m.number||'Судебное заседание'):(t.hearingNumber||t.hearingClient||'Судебное заседание')) : t.title;
  return '<div class="task p-'+t.pri+' k-'+t.kind+(t.done?' done':'')+(needResult?' hearing-needs-result':'')+'" data-act="task" data-id="'+t.id+'">'+
    (hearing?'<div class="eventmark '+(needResult?'needs-result':'')+'">'+ico(needResult?'clock':'gavel')+'</div>':(meetingOccurred(t)?'<div class="eventmark meeting-held">'+ico('check')+'</div>':'<button class="chk" data-act="toggle" data-id="'+t.id+'">'+ico('check')+'</button>'))+
    '<div class="tbody">'+
      '<div class="trow">'+
        (t.time?'<span class="ttime mono">'+esc(t.time)+'</span>':'')+
        '<div class="tt">'+esc(title)+'</div>'+
      '</div>'+
      '<div class="meta">'+
        kindTag(t)+
        (opts.noMatter||!m ? '' : '<span class="tag dot" style="color:'+mColor(m.id)+'">'+esc(m.title)+'</span>')+
        (opts.noDue ? '' : dueTag(t))+
        (needResult?'<span class="tag hearing-result-pending">Указать результат</span>':'')+
        (rinfo?'<span class="tag hearing-result-tag '+rinfo.tone+'">'+esc(rinfo.label)+'</span>':'')+
        (t.pri==='high' && !t.done && !hearing ? '<span class="tag red">'+ico('flag','s')+'Срочно</span>' : '')+
        (t.place?'<span class="tag">'+esc(t.place)+'</span>':'')+
      '</div>'+
      (hearingHasResult(t)&&t.hearingResultText?'<div class="note hearing-result-note">'+esc(t.hearingResultText.length>180?t.hearingResultText.slice(0,180)+'…':t.hearingResultText)+'</div>':(t.note?'<div class="note">'+esc(t.note.length>140?t.note.slice(0,140)+'…':t.note)+'</div>':''))+
    '</div></div>';
}
function groupList(list,opts){
  if(!list.length) return '';
  var buckets = [['Просрочено',[],'red'],['Сегодня',[]],['Завтра',[]],['Ближайшая неделя',[]],['Позже',[]],['Без срока',[]],['Прошедшие заседания',[]],['Состоявшиеся встречи',[],'slate'],['Выполнено',[]]];
  list.forEach(function(t){
    var i = t.done ? 8 : (t.kind==='hearing' && t.due && dd(t.due)<0) ? 6 : meetingOccurred(t) ? 7 : !t.due ? 5 : dd(t.due)<0 ? 0 : dd(t.due)===0 ? 1 : dd(t.due)===1 ? 2 : dd(t.due)<=7 ? 3 : 4;
    buckets[i][1].push(t);
  });
  return buckets.filter(function(b){ return b[1].length; }).map(function(b){
    return '<div class="grp'+(b[2]?' '+b[2]:'')+'">'+b[0]+'<em>'+b[1].length+'</em></div>'+
      b[1].map(function(t){ return taskCard(t,opts); }).join('');
  }).join('');
}
/* Заглушка пустого экрана. acts = [{act,t,ghost,v,id}] — кнопки действия прямо в заглушке. */
function empty(icon,title,text,acts){
  var b = (acts && acts.length)
    ? '<div class="eacts">' + acts.map(function(a){
        return '<button class="btn' + (a.ghost ? ' ghost' : '') + '" data-act="' + a.act + '"' +
          (a.v ? ' data-v="' + a.v + '"' : '') +
          (a.id ? ' data-id="' + a.id + '"' : '') + '>' + a.t + '</button>';
      }).join('') + '</div>'
    : '';
  return '<div class="empty">' + ico(icon) + '<h3>' + title + '</h3><p>' + text + '</p>' + b + '</div>';
}
function noData(){ return !S.matters.length && !S.tasks.length && !S.participation.length && !S.journal.length; }
function backupAge(){ if(!S.settings.lastBackup) return 999; try{return Math.floor((Date.now()-new Date(S.settings.lastBackup).getTime())/864e5);}catch(e){return 999;} }
function backupDue(){ if(!S.matters.length&&!S.tasks.length&&!S.participation.length&&!S.journal.length) return false; return backupAge() >= (+S.settings.backupEveryDays||7); }
function deadlineTasks(){ return S.tasks.filter(function(t){ return !t.done && t.kind==='deadline' && t.due; }).sort(sortT); }

/* =====================================================================
   SCREEN: СЕГОДНЯ
   ===================================================================== */
function greet(){ var h = new Date().getHours();
  return h<5?'Доброй ночи':h<12?'Доброе утро':h<18?'Добрый день':'Добрый вечер'; }

function todayMatter(t){ return t && t.mid ? matter(t.mid) : null; }
function todaySectionHead(kind,icon,title,count,extra){
  return '<div class="today-sec '+kind+'"><div class="today-sec-title"><span class="today-sec-ico">'+ico(icon,'s')+'</span><b>'+title+'</b></div>'+
    (extra||'')+'<span class="today-count">'+count+'</span></div>';
}
function todayDeadlineRow(t){
  var m=todayMatter(t), late=dd(t.due), title=t.title||'Процессуальный срок';
  var context=m?(m.title+(m.number?' · '+m.number:'')):'';
  var state=late<0?('Просрочен'+(late<-1?' на '+(-late)+' дн.':'')):(dd(t.due)===0?'Истекает сегодня':fmtD(t.due,true));
  return '<button class="today-row deadline-row kind-deadline" data-act="task" data-id="'+t.id+'">'+
    '<span class="today-row-ico">'+ico('clock','s')+'</span><span class="today-row-main"><b>'+esc(title)+'</b>'+
    '<small class="today-kindline"><span class="today-kind-badge deadline">Срок</span>'+(context?'<span class="today-kind-context">'+esc(context)+'</span>':'')+'</small>'+
    '<em>'+esc(state)+'</em></span>'+ico('chev','s')+'</button>';
}
function hearingCaption(t,m){
  if(m) return m.number||m.title;
  return t.hearingNumber||t.hearingClient||'Судебное заседание';
}
function hearingSubcaption(t,m){
  if(m) return '';
  if(t.hearingNumber&&t.hearingClient) return t.hearingClient;
  return '';
}
function hearingClientName(t,m){ return (m&&m.client)||t.hearingClient||''; }
function hearingJudgeName(t,m){ return (m&&(m.judge||m.investigator))||t.hearingJudge||''; }
function hearingMetaLine(t,m){
  var client=hearingClientName(t,m), judge=hearingJudgeName(t,m), bits=[];
  if(client) bits.push('<span class="hearing-client">'+esc(client)+'</span>');
  if(judge) bits.push('<span class="hearing-judge">'+esc(judge)+'</span>');
  return bits.join('<span class="hearing-dot"> · </span>');
}
function todayHearingRow(t){
  var m=todayMatter(t), place=t.place||(m&&m.court)||'', meta=hearingMetaLine(t,m), context=m?(m.title+(m.number?' · '+m.number:'')):'';
  return '<button class="today-row hearing-row kind-hearing" data-act="task" data-id="'+t.id+'">'+
    '<span class="today-time mono">'+esc(t.time||'—:—')+'</span><span class="today-row-main"><b>'+esc(hearingCaption(t,m))+'</b>'+
    '<small class="today-kindline"><span class="today-kind-badge hearing">Заседание</span>'+(context?'<span class="today-kind-context">'+esc(context)+'</span>':'')+'</small>'+
    (meta?'<small class="hearing-meta">'+meta+'</small>':'')+
    '<small class="hearing-court">'+esc(place||'Суд не указан')+'</small>'+(t.note?'<small class="hearing-note">'+esc(t.note)+'</small>':'')+'</span>'+ico('chev','s')+'</button>';
}
function todayPendingHearingRow(t){
  var m=todayMatter(t), place=t.place||(m&&m.court)||'', meta=hearingMetaLine(t,m), when=t.due===today()?'сегодня':fmtD(t.due,true), context=m?(m.title+(m.number?' · '+m.number:'')):'';
  return '<div class="today-hearing-swipe" data-id="'+t.id+'">'+
    '<div class="today-hearing-swipe-bg"><span class="today-hearing-swipe-more">Результат'+ico('gavel','s')+'</span></div>'+
    '<button class="today-row hearing-row hearing-result-row kind-hearing today-hearing-swipe-row" data-act="hearing-result" data-id="'+t.id+'">'+
      '<span class="today-time mono">'+esc(t.time||'—:—')+'</span><span class="today-row-main"><b>'+esc(hearingCaption(t,m))+'</b>'+
      '<small class="today-kindline"><span class="today-kind-badge hearing">Заседание</span>'+(context?'<span class="today-kind-context">'+esc(context)+'</span>':'')+'</small>'+
      (meta?'<small class="hearing-meta">'+meta+'</small>':'')+
      '<small class="hearing-court">'+esc(place||'Суд не указан')+'</small>'+
      '<em class="hearing-result-call">Указать результат · '+esc(when)+' →</em></span>'+ico('chev','s')+'</button>'+
  '</div>';
}
function todayTaskRow(t){
  var m=todayMatter(t);
  var context=m?(m.title+(m.number?' · '+m.number:'')):'';
  return '<div class="today-row task-row kind-task" data-act="task" data-id="'+t.id+'">'+
    '<button class="today-check" data-act="toggle" data-id="'+t.id+'">'+ico('check','s')+'</button><span class="today-row-main"><b>'+esc(t.title)+'</b>'+
    '<small class="today-kindline"><span class="today-kind-badge task">Задача</span>'+(context?'<span class="today-kind-context">'+esc(context)+'</span>':'')+'</small>'+
    (t.note?'<small class="today-note">'+esc(t.note)+'</small>':'')+'</span>'+
    (t.time?'<span class="today-row-time mono">'+esc(t.time)+'</span>':'')+'</div>';
}
function todayMeetingRow(t){
  var m=todayMatter(t);
  var context=m?(m.title+(m.number?' · '+m.number:'')):'';
  var typeLine='<small class="today-kindline"><span class="today-kind-badge meeting">Встреча</span>'+(context?'<span class="today-kind-context">'+esc(context)+'</span>':'')+'</small>';
  return '<div class="today-row task-row meeting-row kind-meeting" data-act="task" data-id="'+t.id+'">'+
    '<button class="today-check" data-act="toggle" data-id="'+t.id+'">'+ico('check','s')+'</button><span class="today-row-main"><b>'+esc(t.title||'Встреча')+'</b>'+
    typeLine+
    (t.place?'<small class="meeting-place">'+esc(t.place)+'</small>':'')+
    (t.note?'<small class="today-note">'+esc(t.note)+'</small>':'')+'</span>'+
    (t.time?'<span class="today-row-time mono">'+esc(t.time)+'</span>':'')+'</div>';
}
function todayUpcomingRow(t){
  var m=todayMatter(t), d=parseD(t.due), place=t.place||(m&&m.court)||'', meta=hearingMetaLine(t,m), context=m?(m.title+(m.number?' · '+m.number:'')):'';
  return '<button class="today-row upcoming-row kind-hearing" data-act="task" data-id="'+t.id+'">'+
    '<span class="today-date"><b>'+d.getDate()+'</b><small>'+MON[d.getMonth()].slice(0,3)+'</small></span>'+
    '<span class="today-time mono">'+esc(t.time||'—:—')+'</span><span class="today-row-main"><b>'+esc(hearingCaption(t,m))+'</b>'+
    '<small class="today-kindline"><span class="today-kind-badge hearing">Заседание</span>'+(context?'<span class="today-kind-context">'+esc(context)+'</span>':'')+'</small>'+
    (meta?'<small class="hearing-meta">'+meta+'</small>':'')+'<small class="hearing-court">'+esc(place||'Суд не указан')+'</small></span>'+ico('chev','s')+'</button>';
}

function todayNext7Row(t){
  var m=todayMatter(t), d=parseD(t.due), context=m?(m.title+(m.number?' · '+m.number:'')):'';
  var cls='kind-'+(t.kind||'task'), badge='', title='', line2='', line3='';
  if(t.kind==='hearing'){
    var place=t.place||(m&&m.court)||'', meta=hearingMetaLine(t,m);
    badge='<span class="today-kind-badge hearing">Заседание</span>';
    title=hearingCaption(t,m);
    if(meta) line2='<small class="hearing-meta">'+meta+'</small>';
    if(place) line3='<small class="hearing-court">'+esc(place)+'</small>';
  }else if(t.kind==='meeting'){
    badge='<span class="today-kind-badge meeting">Встреча</span>';
    title=t.title||'Встреча';
    if(t.place) line2='<small class="meeting-place">'+esc(t.place)+'</small>';
    else if(t.note) line2='<small class="today-note">'+esc(t.note)+'</small>';
    line3='<small class="soon-rel">'+esc(relD(t.due))+'</small>';
  }else{
    badge='<span class="today-kind-badge deadline">Срок</span>';
    title=t.title||'Процессуальный срок';
    line2='<small class="soon-rel">'+esc(relD(t.due))+'</small>';
    if(t.note) line3='<small class="today-note">'+esc(t.note)+'</small>';
  }
  return '<button class="today-row upcoming-row next7-row '+cls+'" data-act="task" data-id="'+t.id+'">'+
    '<span class="today-date"><b>'+d.getDate()+'</b><small>'+MON[d.getMonth()].slice(0,3)+'</small></span>'+
    '<span class="today-time mono">'+esc(t.time||'')+'</span>'+
    '<span class="today-row-main"><b>'+esc(title)+'</b>'+
      '<small class="today-kindline">'+badge+(context?'<span class="today-kind-context">'+esc(context)+'</span>':'')+'</small>'+
      line2+line3+
    '</span>'+ico('chev','s')+'</button>';
}
function todayPlaceholderRow(kind,text){
  var icon = kind==='blue' ? 'gavel' : (kind==='green' ? 'check' : (kind==='danger' ? 'flag' : 'cal'));
  return '<div class="today-row placeholder-row '+kind+'"><span class="today-row-ico">'+ico(icon,'s')+'</span><span class="today-row-main"><b>'+esc(text)+'</b><small>Добавьте запись через кнопку + или в карточке дела</small></span></div>';
}
function todayQuoteOfDay(){
  var q=[
    ['Правосудие не может быть<br>отрешено от справедливости.','— А. Ф. Кони'],
    ['Смерть греху, но оставьте<br>жизнь грешнику!','— Ф. Н. Плевако'],
    ['Факты отвергать нельзя:<br>снятой головы к плечам не приставишь.','— Ф. Н. Плевако'],
    ['Мы должны быть рабами законов,<br>чтобы стать свободными.','— Марк Туллий Цицерон'],
    ['Судья — это говорящий закон,<br>а закон — это немой судья.','— Марк Туллий Цицерон'],
    ['Крайняя строгость закона —<br>крайняя несправедливость.','— Марк Туллий Цицерон'],
    ['Свобода есть право делать всё,<br>что дозволено законами.','— Шарль Монтескьё'],
    ['Совесть — это правильный суд<br>доброго человека.','— Аристотель'],
    ['Советуй не то, что всего приятнее,<br>а то, что всего лучше.','— Солон'],
    ['Требуя ответа от других,<br>и сам давай отчёт.','— Солон'],
    ['Дело судьи — истолковать закон,<br>а не даровать его.','— Фрэнсис Бэкон'],
    ['Судья, осуждающий невиновного,<br>осуждает самого себя.','— Публилий Сир'],
    ['Послушание несправедливым<br>приказам есть преступление.','— Вольтер'],
    ['Быть добрым совсем нетрудно:<br>трудно быть справедливым.','— Виктор Гюго']
  ];
  var d=parseD(today()), day=Math.floor(d.getTime()/86400000);
  var item=q[((day%q.length)+q.length)%q.length];
  if(!item[1]||!String(item[1]).trim()) item[1]='— Автор не указан';
  return item;
}
function renderToday(){
  var d=new Date(), allOpen=S.tasks.filter(function(t){return !t.done;});
  var pendingHearingResults=allOpen.filter(hearingNeedsResult).sort(sortT);
  var overdueDeadlines=allOpen.filter(function(t){return t.kind==='deadline'&&t.due&&dd(t.due)<0;}).sort(sortT);
  var overdueTasks=allOpen.filter(function(t){return t.kind==='task'&&t.due&&dd(t.due)<0;}).sort(sortT);
  var hearingsToday=allOpen.filter(function(t){return t.kind==='hearing'&&t.due===today()&&!hearingNeedsResult(t);}).sort(sortT);
  var meetingsToday=allOpen.filter(function(t){return t.kind==='meeting'&&t.due===today()&&!meetingOccurred(t);}).sort(sortT);
  var tasksToday=allOpen.filter(function(t){return t.kind==='task'&&t.due===today();}).sort(sortT);
  var deadlinesToday=allOpen.filter(function(t){return t.kind==='deadline'&&t.due===today();}).sort(sortT);
  var next7=allOpen.filter(function(t){return t.due&&dd(t.due)>0&&dd(t.due)<=7&&(t.kind==='hearing'||t.kind==='meeting'||t.kind==='deadline');}).sort(sortT).slice(0,5);
  var quote=todayQuoteOfDay();

  function block(kind, icon, title, items, renderer, extra){
    if(!items.length)return '';
    return todaySectionHead(kind,icon,title,items.length,extra||'')+
      '<div class="today-group '+kind+'-group">'+items.map(renderer).join('')+'</div>';
  }

  var html =
    mainBrandHeader()+
    '<div class="today-head"><div><h1>Сегодня</h1><p>'+d.getDate()+' '+MON[d.getMonth()]+' '+d.getFullYear()+' · '+cap(new Intl.DateTimeFormat('ru-RU',{weekday:'long'}).format(d))+'</p></div>'+
      '<div class="today-actions">'+headerSearch('global-search',false,'Глобальный поиск')+'</div></div>'+
    '<div class="today-quote"><div><b>'+quote[0]+'</b><span>'+quote[1]+'</span></div></div>';

  html += block('danger','flag','Просроченные процессуальные сроки',overdueDeadlines,todayDeadlineRow);
  html += block('gold','clock','Процессуальные сроки сегодня',deadlinesToday,todayDeadlineRow);
  if(overdueTasks.length){
    html += block('danger','flag','Просроченные задачи',overdueTasks,todayTaskRow,
      '<button class="today-sec-link" data-act="reschedule">Перенести</button>');
  }
  html += block('gold','clock','Требуют результата',pendingHearingResults,todayPendingHearingRow);
  html += block('blue','gavel','Заседания сегодня',hearingsToday,todayHearingRow);
  html += block('purple','user','Встречи сегодня',meetingsToday,todayMeetingRow);

  html += block('green','check','Задачи на сегодня',tasksToday,todayTaskRow);
  html += block('slate','cal','Ближайшие 7 дней',next7,todayNext7Row,
    '<button class="today-sec-link" data-act="go-cal">Все →</button>');

  $('#sc-today').innerHTML=html;
  setTimeout(resetAllTodayHearingSwipes,0);
}


function cap(s){ return s.charAt(0).toUpperCase()+s.slice(1); }
function plural(n,a,b,c){ n = Math.abs(n)%100; var m = n%10;
  if(n>10&&n<20) return c; if(m>1&&m<5) return b; if(m===1) return a; return c; }
function ring(pct){
  var r = 26, c = 2*Math.PI*r;
  return '<div class="ring"><svg width="66" height="66">'+
    '<circle cx="33" cy="33" r="'+r+'" stroke="var(--elev2)" stroke-width="5" fill="none"/>'+
    '<circle cx="33" cy="33" r="'+r+'" stroke="url(#g)" stroke-width="5" fill="none" stroke-linecap="round" '+
    'stroke-dasharray="'+c+'" stroke-dashoffset="'+(c*(1-pct/100))+'" style="transition:.6s"/>'+
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'+
    '<stop offset="0" stop-color="#2FA36B"/><stop offset="1" stop-color="#E6C55C"/></linearGradient></defs>'+
    '</svg><b>'+pct+'%</b></div>';
}
function kpi(n,l,c,act){ return '<button class="kpi '+c+'" data-act="'+act+'"><b>'+n+'</b><span>'+l+'</span></button>'; }

/* =====================================================================
   SCREEN: ЗАДАЧИ — проектный экран 3.1.27
   ===================================================================== */

function taskGroupDefaultOpen(key){
  if((S.ui.q||'').trim()) return true;
  return key==='done' ? false : true;
}
function taskGroupOpen(key){
  var st=S.ui.taskGroupOpen||{};
  return Object.prototype.hasOwnProperty.call(st,key) ? !!st[key] : taskGroupDefaultOpen(key);
}
function setTaskGroupOpen(key,val){
  if(!S.ui.taskGroupOpen || typeof S.ui.taskGroupOpen!=='object') S.ui.taskGroupOpen={};
  S.ui.taskGroupOpen[key]=!!val; save();
}
function closeTaskActionRows(exceptId){
  $$('.pt-item.open').forEach(function(n){ if(!exceptId || n.dataset.id!==exceptId) n.classList.remove('open'); });
}
function toggleTaskActionRow(id){
  var wrap=document.querySelector('.pt-item[data-id="'+id+'"]');
  if(!wrap) return;
  var willOpen=!wrap.classList.contains('open');
  closeTaskActionRows(id);
  wrap.classList.toggle('open', willOpen);
  if(willOpen) vib(5);
}
function moveTaskToDate(id,date,label){
  var t=S.tasks.filter(function(x){return x.id===id;})[0];
  if(!t) return;
  t.due=date;
  if(t.mid) addJournal(t.mid,'Перенесено: '+t.title+' — '+fmtD(date,true),today(),'task',true);
  save();
  render();
  if($('#page').classList.contains('open')&&t.mid) openMatter(t.mid);
  toast((label||'Перенесено')+' · '+t.title.slice(0,28));
}
function deleteTaskById(id){
  var t=S.tasks.filter(function(x){return x.id===id;})[0];
  if(!t) return;
  if(t.kind==='hearing'&&(hearingNeedsResult(t)||hearingHasResult(t))){toast('Прошедшее заседание сохраняется в истории');return;}
  var deleteQuestion=t.kind==='hearing'?'Удалить заседание?':(t.kind==='meeting'?'Удалить встречу?':(t.kind==='deadline'?'Удалить процессуальный срок?':'Удалить задачу?'));
  if(confirm(deleteQuestion)){
    S.tasks=S.tasks.filter(function(x){return x.id!==id;});
    save(); render();
    if($('#page').classList.contains('open')&&t.mid) openMatter(t.mid);
    toast('Удалено');
  }
}
function toggleTaskDone(id){
  var t=S.tasks.filter(function(x){return x.id===id;})[0];
  if(!t) return;
  /* Заседание закрывается только через фиксацию результата. */
  if(t.kind==='hearing'){
    if(hearingNeedsResult(t)) sheetHearingResult(t.id);
    else if(hearingHasResult(t)) completedHearingFeedback(t);
    else toast('Результат можно указать после начала заседания');
    return;
  }
  t.done=!t.done; t.doneAt=t.done?new Date().toISOString():null;
  if(t.mid) addJournal(t.mid,(t.done?'Выполнено: ':'Возвращено в работу: ')+t.title,today(),'task',true);
  vib(t.done?[10,40,14]:8); save(); render();
  if($('#page').classList.contains('open')&&t.mid) openMatter(t.mid);
  toast((t.done?'Выполнено':'Возвращено в работу')+' · '+t.title.slice(0,32));
}

var HR=null;
function hearingResultIcon(k){
  return ({held:'check', postponed:'clock', break:'alert', completed:'flag', cancelled:'xmark'})[k]||'check';
}
function hearingContextText(t){
  var m=t.mid?matter(t.mid):null, bits=[];
  if(m) bits.push(m.number||m.title);
  else { if(t.hearingNumber)bits.push(t.hearingNumber); if(t.hearingClient)bits.push(t.hearingClient); }
  if(t.hearingJudge)bits.push('судья '+t.hearingJudge);
  if(t.place)bits.push(t.place);
  return bits.join(' · ');
}
function pullHearingResult(){
  if(!HR)return;
  var n=$('#hr-note'),d=$('#hr-next-date'),tm=$('#hr-next-time');
  if(n)HR.note=n.value.trim();
  if(d)HR.nextDate=d.value;
  if(tm)HR.nextTime=tm.value;
}
function drawHearingResultSheet(){
  if(!HR)return;
  var oldBody=$('#sheet .shbody'), oldScroll=oldBody?oldBody.scrollTop:0;
  var t=S.tasks.filter(function(x){return x.id===HR.id;})[0]; if(!t)return;
  var choices=HEARING_RESULT_CHOICES.map(function(k){
    var r=HEARING_RESULTS[k], ic=hearingResultIcon(k), selected=HR.status===k;
    return '<button class="hearing-result-choice '+r.tone+(selected?' on':'')+'" data-act="hearing-result-pick" data-v="'+k+'" aria-pressed="'+(selected?'true':'false')+'">'+
      '<span class="hearing-result-choice-icon">'+ico(ic)+'</span>'+
      '<span class="hearing-result-choice-copy">'+
        '<span class="hearing-result-choice-title">'+esc(r.sheetTitle||r.label)+'</span>'+
        '<span class="hearing-result-choice-sub">'+esc(r.sheetSub||'')+'</span>'+
      '</span>'+
      (selected?'<span class="hearing-result-choice-selected">'+ico('check','s')+'</span>':'')+
    '</button>';
  }).join('');
  var follow=(HR.status==='postponed')
    ? '<div class="hearing-followup"><div class="hearing-followup-title">Следующее заседание</div><div class="two"><div class="fld"><label>Дата</label>'+premiumDateControl('hr-next-date',HR.nextDate||'','Выберите дату')+'</div><div class="fld"><label>Время</label>'+premiumTimeControl('hr-next-time',HR.nextTime||'','hearing','Выберите время')+'</div></div><small>Если новая дата уже известна, приложение создаст следующее заседание с тем же делом, судом и судьёй.</small></div>' : '';
  var hrDate=fmtD(t.due,true)+(t.time?' · '+t.time:'');
  var hrContext=hearingContextText(t)||'';
  openSheet('<div class="hearing-result-head premium"><span class="hearing-result-head-icon">'+ico('gavel')+'</span><div><h2>Результат заседания</h2><p><span>'+esc(hrDate)+'</span>'+(hrContext?'<b>'+esc(hrContext)+'</b>':'')+'</p></div></div>'+ 
    '<div class="hearing-result-options">'+choices+'</div>'+follow+
    '<div class="fld hearing-result-note-field"><label>Итог / примечание</label><textarea id="hr-note" rows="4" placeholder="Например: допрошен свидетель, исследованы материалы, суд отложил рассмотрение…">'+esc(HR.note||'')+'</textarea></div>'+ 
    '<div class="hint hearing-result-hint"><span class="hearing-result-hint-icon">'+ico('info','s')+'</span><p>После сохранения заседание уйдёт с главной страницы и останется в истории. Для связанного дела результат автоматически попадёт в журнал.</p></div>'+ 
    '<button class="btn hearing-result-save" data-act="hearing-result-save"><span>Сохранить результат</span>'+ico('chev','s')+'</button>');
  $('#sheet').classList.add('hearing-result-sheet');
  requestAnimationFrame(function(){
    var body=$('#sheet .shbody');
    if(body) body.scrollTop=oldScroll;
  });
}
function sheetHearingResult(id){
  var t=S.tasks.filter(function(x){return x.id===id;})[0]; if(!t||t.kind!=='hearing')return;
  if(hearingHasResult(t)){completedHearingFeedback(t);return;}
  if(!hearingNeedsResult(t)){toast('Результат можно указать после начала заседания');return;}
  HR={id:id,status:'',note:'',nextDate:'',nextTime:''};
  drawHearingResultSheet();
}
function saveHearingResult(){
  if(!HR)return; pullHearingResult();
  var t=S.tasks.filter(function(x){return x.id===HR.id;})[0]; if(!t)return;
  if(!HR.status){toast('Выберите результат заседания');return;}
  var isFollow=HR.status==='postponed';
  if(isFollow && ((HR.nextDate&&!HR.nextTime)||(!HR.nextDate&&HR.nextTime))){toast('Для следующего заседания укажите дату и время');return;}
  if(isFollow&&HR.nextTime&&!isHearingTime(HR.nextTime)){toast('Следующее заседание можно назначить с 08:00 до 18:00');openPremiumTimePicker('hr-next-time',HR.nextTime,'hearing');return;}
  var now=new Date().toISOString(),ri=HEARING_RESULTS[HR.status];
  t.hearingResultStatus=HR.status;
  t.hearingResultText=HR.note||'';
  t.hearingResultAt=now;
  t.hearingNextDate=HR.nextDate||'';
  t.hearingNextTime=HR.nextTime||'';
  t.done=true;t.doneAt=now;
  var next=null;
  if(isFollow&&HR.nextDate&&HR.nextTime){
    next={id:uid(),title:'Судебное заседание',mid:t.mid||'',note:'',due:HR.nextDate,time:HR.nextTime,place:t.place||'',pri:'mid',kind:'hearing',sourceDate:'',sourceTime:'',rule:'',ruleCode:'',ruleArticle:'',deadlineCode:'GPK',deadlineRuleId:'gpk-appeal',hearingClient:t.hearingClient||'',hearingNumber:t.hearingNumber||'',hearingJudge:t.hearingJudge||'',done:false,doneAt:null,steps:[],created:now,hearingPreviousId:t.id};
    S.tasks.unshift(next);t.hearingFollowupId=next.id;
  }
  if(t.mid){
    var label='Результат заседания '+fmtD(t.due,true)+(t.time?' в '+t.time:'')+': '+ri.label;
    if(HR.note)label+='. '+HR.note;
    if(next)label+='. Следующее заседание — '+fmtD(next.due,true)+' в '+next.time;
    addJournal(t.mid,label,t.due||today(),'hearing-result',true);
  }
  HR=null;vib([12,35,12]);save();closeSheet();render();
  if($('#page').classList.contains('open')&&t.mid)openMatter(t.mid);
  toast(next?'Результат сохранён · следующее заседание создано':'Результат заседания сохранён');
  schedule();
}
function sheetHearingResultSummary(id){
  var t=S.tasks.filter(function(x){return x.id===id;})[0]; if(!t||!hearingHasResult(t))return;
  var ri=hearingResultInfo(t),next=t.hearingFollowupId?S.tasks.filter(function(x){return x.id===t.hearingFollowupId;})[0]:null;
  openSheet('<div class="hearing-result-head"><span class="hearing-result-head-icon done">'+ico('check')+'</span><div><h2>Результат заседания</h2><p>'+esc(fmtD(t.due,true)+(t.time?' · '+t.time:'')+(hearingContextText(t)?' · '+hearingContextText(t):''))+'</p></div></div>'+ 
    '<div class="hearing-result-summary '+(ri?ri.tone:'')+'"><small>Результат</small><b>'+esc(ri?ri.label:'Зафиксирован')+'</b>'+(t.hearingResultText?'<p>'+esc(t.hearingResultText)+'</p>':'')+'</div>'+ 
    (next?'<div class="hearing-result-next"><small>Следующее заседание</small><b>'+esc(fmtD(next.due,true)+' · '+next.time)+'</b><span>'+esc(next.place||'')+'</span></div>':'')+
    '<div class="hint">Запись сохранена в истории'+(t.mid?' и журнале дела':'')+'. Завершённые заседания автоматически не удаляются.</div>');
  $('#sheet').classList.add('hearing-result-sheet');
}

function sheetTaskActions(id){
  var t=S.tasks.filter(function(x){return x.id===id;})[0];
  if(!t) return;
  var m=t.mid?matter(t.mid):null;
  var sub=m?([m.number,m.title].filter(Boolean).join(' · ')):'';
  if(t.kind==='hearing'&&(hearingNeedsResult(t)||hearingHasResult(t))){
    if(hearingNeedsResult(t)) sheetHearingResult(t.id); else completedHearingFeedback(t);
    return;
  }
  var cur=t.due||today();
  var kmeta={task:{icon:'check',title:'Задача',tone:'green'},meeting:{icon:'user',title:'Встреча',tone:'purple'},deadline:{icon:'clock',title:'Процессуальный срок',tone:'red'},hearing:{icon:'gavel',title:'Заседание',tone:'blue'}}[t.kind]||{icon:'check',title:'Запись',tone:'gold'};
  var deleteText=t.kind==='hearing'?'Удалить запланированное заседание':(t.kind==='meeting'?'Удалить встречу без возможности восстановления':(t.kind==='deadline'?'Удалить процессуальный срок без возможности восстановления':'Удалить задачу без возможности восстановления'));
  var rows='<button type="button" class="task-action-premium-row date" data-act="date-open-task" data-id="'+t.id+'" data-date-value="'+esc(cur)+'">'+
      '<span class="task-action-premium-icon">'+ico('cal')+'</span><span class="task-action-premium-copy"><b>Изменить дату</b><small>'+(t.due?('Сейчас: '+fmtD(t.due,true)):'Дата не установлена')+'</small></span><span class="task-action-premium-tail">'+ico('chev','s')+'</span></button>'+ 
      '<button class="task-action-premium-row delete" data-act="task-action-delete" data-id="'+t.id+'"><span class="task-action-premium-icon">'+ico('trash')+'</span><span class="task-action-premium-copy"><b>Удалить</b><small>'+deleteText+'</small></span><span class="task-action-premium-tail">'+ico('chev','s')+'</span></button>';
  openSheet('<div class="task-action-premium-head '+kmeta.tone+'"><span class="task-action-premium-head-icon">'+ico(kmeta.icon)+'</span><div><small>'+esc(kmeta.title)+'</small><h2>Быстрые действия</h2><p>'+esc(t.title)+(sub?' · '+esc(sub):'')+'</p></div></div><div class="task-action-premium-card">'+rows+'</div>');
  $('#sheet').classList.add('task-actions-premium');
}
function taskTypeMeta(){
  var type=S.ui.taskType||'';
  var map={
    '':{name:'Все типы', short:'Все типы', hint:'Показывать задачи, заседания, встречи и сроки'},
    task:{name:'Задачи', short:'Задачи', hint:'Только обычные задачи'},
    hearing:{name:'Заседания', short:'Заседания', hint:'Только судебные заседания'},
    meeting:{name:'Встречи', short:'Встречи', hint:'Только встречи с доверителями и иные встречи'},
    deadline:{name:'Сроки', short:'Сроки', hint:'Только процессуальные сроки'}
  };
  return map[type]||map[''];
}
function taskTypeMatch(t,type){ return !type || (t&&t.kind===type); }
function sheetTaskTypeFilters(){
  var base=taskProjectBase();
  var counts={
    all:base.length,
    task:base.filter(function(t){return t.kind==='task';}).length,
    hearing:base.filter(function(t){return t.kind==='hearing';}).length,
    meeting:base.filter(function(t){return t.kind==='meeting';}).length,
    deadline:base.filter(function(t){return t.kind==='deadline';}).length
  };
  function fr(v,icon,title,sub,count,tone){
    var on=S.ui.taskType===v;
    return '<button class="filter-premium-row '+tone+(on?' selected':'')+'" style="--tone:'+(tone==='task'?'#3FA970':tone==='hearing'?'#4E86C6':tone==='meeting'?'#8B7BD8':tone==='deadline'?'#D95A57':'#B88C2D')+'" data-act="task-type-filter" data-v="'+v+'">'+
      '<span class="filter-premium-icon">'+ico(icon)+'</span><span class="filter-premium-copy"><b>'+title+'</b><small>'+sub+'</small></span><span class="filter-premium-count">'+count+'</span><span class="filter-premium-tail">'+ico(on?'check':'chev','s')+'</span></button>';
  }
  var rows=''+
    fr('','list','Все типы','Задачи, заседания, встречи и сроки',counts.all,'all')+
    fr('task','check','Задачи','Обычные рабочие задачи',counts.task,'task')+
    fr('hearing','gavel','Заседания','Судебные заседания и их история',counts.hearing,'hearing')+
    fr('meeting','user','Встречи','Встречи с доверителями и иные встречи',counts.meeting,'meeting')+
    fr('deadline','clock','Сроки','Процессуальные сроки',counts.deadline,'deadline');
  openSheet('<div class="filter-premium-head"><span class="filter-premium-head-icon">'+ico('list')+'</span><div><h2>Фильтр записей</h2><p>Выберите тип записи</p></div></div><div class="filter-premium-card">'+rows+'</div>');
  $('#sheet').classList.add('filter-premium-sheet','task-filter-premium');
}
function taskProjectBase(){
  var q=(S.ui.q||'').toLowerCase().trim();
  return S.tasks.filter(function(t){
    if(!q) return true;
    var m=t.mid?matter(t.mid):null;
    var hay=(t.title+' '+(t.note||'')+' '+(t.place||'')+' '+(t.rule||'')+' '+(t.ruleArticle||'')+' '+(t.ruleCode||'')+' '+(t.hearingClient||'')+' '+(t.hearingNumber||'')+' '+(t.hearingJudge||'')+' '+(t.hearingResultText||'')+' '+(t.hearingResultStatus||'')+' '+(m?m.title+' '+(m.client||'')+' '+(m.number||'')+' '+(m.court||'')+' '+(m.judge||'')+' '+(m.article||''):'')).toLowerCase();
    return hay.indexOf(q)>=0;
  }).sort(sortT);
}
function taskProjectMatch(t,chip){
  if(chip==='late') return !t.done && !meetingOccurred(t) && (t.kind==='task'||t.kind==='deadline') && t.due && dd(t.due)<0;
  if(chip==='today') return !t.done && !meetingOccurred(t) && t.due && dd(t.due)===0;
  if(chip==='week') return !t.done && !meetingOccurred(t) && t.due && dd(t.due)>0 && dd(t.due)<=7;
  if(chip==='later') return !t.done && !meetingOccurred(t) && t.due && dd(t.due)>7;
  if(chip==='nodue') return !t.done && !meetingOccurred(t) && !t.due;
  if(chip==='done') return !!t.done || meetingOccurred(t);
  return true;
}
function taskProjectCounts(){
  var all=taskProjectBase().filter(function(t){return taskTypeMatch(t,S.ui.taskType);});
  var active=all.filter(function(t){return !t.done && !meetingOccurred(t);});
  return {
    all:all.length,
    work:active.length,
    late:active.filter(function(t){return (t.kind==='task'||t.kind==='deadline')&&t.due&&dd(t.due)<0;}).length,
    today:active.filter(function(t){return t.due&&dd(t.due)===0;}).length,
    week:active.filter(function(t){return t.due&&dd(t.due)>0&&dd(t.due)<=7;}).length,
    later:active.filter(function(t){return t.due&&dd(t.due)>7;}).length,
    nodue:active.filter(function(t){return !t.due;}).length,
    done:all.filter(function(t){return !!t.done || meetingOccurred(t);}).length
  };
}
function revealActiveTaskChip(){
  var strip=document.querySelector('#sc-tasks .tasks-project-filters');
  if(!strip)return;
  var active=strip.querySelector('button.on');
  if(!active)return;
  var target=active.offsetLeft-(strip.clientWidth-active.offsetWidth)/2;
  strip.scrollLeft=Math.max(0,target);
}
function renderTasks(){
  var u=S.ui;
  if(['','late','today','week','later','nodue','done'].indexOf(u.taskChip)<0) u.taskChip='';
  if(['','task','hearing','meeting','deadline'].indexOf(u.taskType||'')<0) u.taskType='';
  var c=taskProjectCounts(), tt=taskTypeMeta();
  var html='<div class="tasks-project">'+
    mainBrandHeader()+
    '<div class="today-head tasks-title-head"><div><h1>Задачи</h1><p>'+c.work+' '+plural(c.work,'запись','записи','записей')+' в работе</p></div>'+
      '<div class="today-actions">'+headerSearch('search',!!u.q,'Поиск по задачам')+'</div></div>'+
    (u.q!==''||u._sq?'<div class="fld tasks-project-search"><input id="q" placeholder="Поиск по задачам и делам" value="'+esc(u.q)+'" autocomplete="off"></div>':'')+
    '<div class="tasks-filterbar">'+
      '<div class="tasks-project-filters">'+
        '<button class="'+(u.taskChip===''?'on':'')+'" data-act="chip" data-v=""><span>Все</span><em>'+c.all+'</em></button>'+
        '<button class="late '+(u.taskChip==='late'?'on':'')+'" data-act="chip" data-v="late"><span>Просроченные</span><em>'+c.late+'</em></button>'+
        '<button class="today '+(u.taskChip==='today'?'on':'')+'" data-act="chip" data-v="today"><span>Сегодня</span><em>'+c.today+'</em></button>'+
        '<button class="week '+(u.taskChip==='week'?'on':'')+'" data-act="chip" data-v="week"><span>На этой неделе</span><em>'+c.week+'</em></button>'+
        '<button class="later '+(u.taskChip==='later'?'on':'')+'" data-act="chip" data-v="later"><span>Позже</span><em>'+c.later+'</em></button>'+
        '<button class="nodue '+(u.taskChip==='nodue'?'on':'')+'" data-act="chip" data-v="nodue"><span>Без срока</span><em>'+c.nodue+'</em></button>'+
        '<button class="done '+(u.taskChip==='done'?'on':'')+'" data-act="chip" data-v="done"><span>Выполнено</span><em>'+c.done+'</em></button>'+
      '</div>'+
      '<button class="task-type-trigger'+(u.taskType?' on':'')+'" data-act="task-type-sheet" title="Фильтр по типу">'+ico('list','s')+'<span>'+esc(tt.short)+'</span></button>'+
    '</div><div id="tasklist"></div></div>';
  $('#sc-tasks').innerHTML=html;
  renderTaskList();
  requestAnimationFrame(revealActiveTaskChip);
  if(u._sq){var el=$('#q');if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);}}
}
function taskFilter(){
  return taskProjectBase().filter(function(t){return taskTypeMatch(t,S.ui.taskType) && taskProjectMatch(t,S.ui.taskChip);});
}
function taskProjectGroups(list){
  var out=[
    {key:'result',title:'Требуют результата',tone:'result',items:[]},
    {key:'deadline-late',title:'Просроченные процессуальные сроки',tone:'red',items:[]},
    {key:'deadlines',title:'Процессуальные сроки',tone:'gold',items:[]},
    {key:'late',title:'Просроченные задачи',tone:'red',items:[]},
    {key:'today',title:'Сегодня',tone:'blue',items:[]},
    {key:'week',title:'На этой неделе',tone:'gold',items:[]},
    {key:'later',title:'Позже',tone:'slate',items:[]},
    {key:'nodue',title:'Без срока',tone:'slate',items:[]},
    {key:'past-meetings',title:'Состоявшиеся встречи',tone:'green',items:[]},
    {key:'hearing-history',title:'История заседаний',tone:'blue',items:[]},
    {key:'done',title:'Выполнено',tone:'green',items:[]}
  ];
  list.forEach(function(t){
    if(t.done){
      if(t.kind==='hearing' && hearingHasResult(t)){out[9].items.push(t);return;}
      out[10].items.push(t);return;
    }
    if(hearingNeedsResult(t)){out[0].items.push(t);return;}
    if(t.kind==='deadline'){
      if(t.due && dd(t.due)<0){out[1].items.push(t);return;}
      out[2].items.push(t);return;
    }
    if(!t.due){out[7].items.push(t);return;}
    var d=dd(t.due);
    if(meetingOccurred(t)){out[8].items.push(t);return;}
    if(d<0){out[3].items.push(t);return;}
    if(d===0){out[4].items.push(t);return;}
    if(d<=7){out[5].items.push(t);return;}
    out[6].items.push(t);
  });
  return out.filter(function(g){return g.items.length;});
}
function taskProjectBadge(t){
  var ri=hearingResultInfo(t);
  if(ri) return '<span class="pt-badge hearing-result '+ri.tone+'">'+esc(ri.label)+'</span>';
  if(hearingNeedsResult(t)) return '<span class="pt-badge hearing-result pending">Результат</span>';
  if(t.done) return '<span class="pt-badge done">Готово</span>';
  if(meetingOccurred(t)) return '<span class="pt-badge meeting held">Состоялась</span>';
  if(t.kind==='hearing') return '<span class="pt-badge hearing">Заседание</span>';
  if(t.kind==='meeting') return '<span class="pt-badge meeting">Встреча</span>';
  if(t.kind==='deadline') return '<span class="pt-badge deadline">Срок</span>';
  if(t.pri==='high') return '<span class="pt-badge high">Высокий</span>';
  if(t.pri==='mid') return '<span class="pt-badge mid">Средний</span>';
  if(t.pri==='low') return '<span class="pt-badge low">Низкий</span>';
  return '';
}
function taskDueText(t){
  if(!t.due) return '';
  var d=dd(t.due);
  if(hearingNeedsResult(t)) return '<small class="pt-result-due">Требуется результат · '+fmtD(t.due)+'</small>';
  if(t.done) return '<small>'+fmtD(t.due)+'</small>';
  if(meetingOccurred(t)) return '<small class="pt-past-meeting">Состоялась'+(t.time?' · '+esc(t.time):'')+' · '+fmtD(t.due)+'</small>';
  if(d<0) return '<small class="pt-overdue">'+(t.kind==='deadline'?'Срок просрочен':'Просрочено')+' на '+Math.abs(d)+' '+plural(Math.abs(d),'день','дня','дней')+'</small>';
  if(d===0) return '<small>Сегодня</small>';
  if(d===1) return '<small>Завтра</small>';
  return '<small>'+fmtD(t.due)+'</small>';
}
function taskProjectRow(t){
  var m=t.mid?matter(t.mid):null;
  var title=esc(t.kind==='hearing'?(t.title||'Судебное заседание'):t.title);
  var due=taskDueText(t);
  var context=m?([m.number,m.title].filter(Boolean).join(' · ')):'';
  var hclient=t.kind==='hearing'?hearingClientName(t,m):'', hjudge=t.kind==='hearing'?hearingJudgeName(t,m):'';
  var right=(t.time?'<b class="pt-time mono">'+esc(t.time)+'</b>':'')+taskProjectBadge(t);
  var leadIcon=t.kind==='hearing'
    ? (hearingNeedsResult(t)
        ? '<button class="pt-hearing-state pending" data-act="hearing-result" data-id="'+t.id+'">'+ico('clock','s')+'</button>'
        : '<span class="pt-hearing-state '+(hearingHasResult(t)?'completed':'scheduled')+'">'+ico(hearingHasResult(t)?'check':'gavel','s')+'</span>')
    : (meetingOccurred(t)
        ? '<span class="pt-hearing-state completed meeting-held">'+ico('check','s')+'</span>'
        : '<button class="pt-check" data-act="toggle" data-id="'+t.id+'">'+ico('check','s')+'</button>');
  var swipeAllowed=(t.kind==='task'||t.kind==='meeting'||t.kind==='deadline'||(t.kind==='hearing'&&hearingNeedsResult(t)));
  var swipeCaption=(t.kind==='hearing'&&hearingNeedsResult(t))?'Результат':'Действия';
  return '<div class="pt-item" data-id="'+t.id+'">'+
    (swipeAllowed?'<div class="pt-swipe-bg'+((t.kind==='hearing'&&hearingNeedsResult(t))?' result':'')+'"><span></span><span class="pt-swipe-more">'+swipeCaption+ico((t.kind==='hearing'&&hearingNeedsResult(t))?'gavel':'more','s')+'</span></div>':'')+
    '<div class="pt-row'+(t.done?' done':'')+(hearingHasResult(t)?' hearing-result-done':'')+(hearingNeedsResult(t)?' needs-result':'')+(t.kind==='deadline'?' deadline-record':'')+'" data-id="'+t.id+'" data-kind="'+esc(t.kind||'task')+'">'+
      leadIcon+
      '<div class="pt-main">'+
        '<button class="pt-open" data-act="task" data-id="'+t.id+'"><b>'+title+'</b></button>'+ 
        (m?'<button class="pt-link" data-act="task-matter" data-id="'+m.id+'">'+esc(context)+'</button>':'')+
        (t.kind==='hearing'&&(hclient||hjudge)?'<div class="pt-hearing-meta">'+(hclient?'<span class="hearing-client">'+esc(hclient)+'</span>':'')+(hclient&&hjudge?'<span class="hearing-dot"> · </span>':'')+(hjudge?'<span class="hearing-judge">'+esc(hjudge)+'</span>':'')+'</div>':'')+
        (t.kind==='hearing'&&t.place?'<small class="pt-hearing-court">'+esc(t.place)+'</small>':'')+
        (hearingHasResult(t)&&t.hearingResultText?'<small class="pt-hearing-result-text">'+esc(t.hearingResultText)+'</small>':(t.note?'<small class="pt-note">'+esc(t.note)+'</small>':''))+
        due+
      '</div>'+ 
      '<div class="pt-side">'+right+'</div><button class="pt-chev" data-act="task" data-id="'+t.id+'" aria-label="Открыть запись">'+ico('chev','s')+'</button></div></div>';
}
function renderTaskList(){
  var box=$('#tasklist');if(!box)return;
  var list=taskFilter();
  if(!list.length){
    var filtered=!!(S.ui.q||S.ui.taskChip||S.ui.taskType);
    box.innerHTML=empty('list',S.ui.q?'Ничего не найдено':(filtered?'Нет записей по фильтру':'Задач пока нет'),S.ui.q?'Измените поисковый запрос или фильтр.':(filtered?'Измените выбранный период или тип записи.':'Новые задачи появятся здесь после добавления.'),filtered?[{act:'reset-task-filters',t:'Сбросить фильтры',ghost:true}]:[{act:'new-task',t:'Добавить задачу'}]);
    return;
  }
  box.innerHTML=taskProjectGroups(list).map(function(g){
    var open=taskGroupOpen(g.key);
    return '<section class="pt-group '+g.tone+' '+(open?'':'collapsed')+'">'+
      '<button class="pt-group-head" data-act="task-group" data-v="'+g.key+'">'+
        '<h2>'+g.title+'</h2><div class="pt-group-meta"><span>'+g.items.length+'</span><i class="pt-group-arrow">'+ico('chev','s')+'</i></div></button>'+
      '<div class="pt-card" '+(open?'':'hidden')+'>'+g.items.map(taskProjectRow).join('')+'</div></section>';
  }).join('');
}

/* =====================================================================
   SCREEN: ДЕЛА
   ===================================================================== */
function matterStats(m){
  var t = tasksOf(m.id), open = t.filter(isActiveRecord);
  var pendingResults = open.filter(function(x){ return x.kind==='hearing' && hearingNeedsResult(x); }).sort(sortT);
  var lateItems = open.filter(function(x){ return (x.kind==='task'||x.kind==='deadline') && x.due && dd(x.due)<0; }).sort(sortT);
  var late = lateItems.length;
  var done = t.filter(function(x){ return x.done || meetingOccurred(x); }).length;
  var next = open.filter(function(x){ return x.due && dd(x.due)>=0; }).sort(sortT)[0]||null;
  var parts = participationOf(m.id).slice().sort(function(a,b){ return a.date<b.date?1:-1; });
  var rate = +m.dayRate || +S.settings.dayRate || 0;
  var sum = parts.reduce(function(a,e){ return a + (+e.rate||rate); },0);
  return { open:open.length, done:done, all:t.length, late:late, lateItems:lateItems, next:next,
           pendingResults:pendingResults, pendingResult:pendingResults[0]||null,
           days:parts.length, sum:sum, parts:parts };
}
function matterStageTone(m){
  if(m.archived || m.stage==='Завершено') return 'slate';
  if(m.stage==='Следствие СК') return 'red';
  if(m.stage==='Следствие МВД' || m.stage==='Апелляция' || m.stage==='Кассация' || m.stage==='Надзор' || m.stage==='Пересмотр / апелляция') return 'blue';
  if(m.stage==='Дознание') return 'violet';
  if(m.stage==='Досудебная работа' || m.stage==='Материал проверки' || m.stage==='Проверка / административное расследование' || m.stage==='Исполнение' || m.stage==='Исполнение приговора') return 'gold';
  return 'green';
}
function isCriminalCheckMaterial(m){
  return !!(m && m.type==='criminal' && m.stage==='Материал проверки');
}
function isCriminalExecutionMatter(m){
  return !!(m && m.type==='criminal' && m.stage==='Исполнение приговора');
}
function criminalExecutionCardLabel(issueId){
  var labels={
    'udo':'УДО',
    'softer':'СТ. 80 УК РФ',
    'illness':'ПО БОЛЕЗНИ',
    'institution-type':'ВИД ИУ',
    'reverse-law':'СТ. 10 УК РФ',
    'pmh':'ПММХ',
    'pmh-expert':'ЭКСПЕРТИЗА',
    'replace-evasion':'ЗА УКЛОНЕНИЕ',
    'forced-to-prison':'ПРИНУД. РАБОТЫ',
    'cancel-udo':'ОТМЕНА УДО',
    'conditional':'УСЛОВНОЕ ОСУЖДЕНИЕ',
    'conditional-duties':'ОБЯЗАННОСТИ',
    'restriction':'ОГРАНИЧ. СВОБОДЫ',
    'limitation':'ДАВНОСТЬ',
    'multiple-sentences':'НЕСКОЛЬКО ПРИГОВОРОВ',
    'credit':'ЗАЧЁТ СРОКА',
    'deductions':'УДЕРЖАНИЯ',
    'clarify':'РАЗЪЯСНЕНИЕ',
    'minor':'НЕСОВЕРШЕННОЛЕТНИЙ',
    'defer':'ОТСРОЧКА',
    'defer-change':'ОТМЕНА ОТСРОЧКИ',
    'detention-evasion':'СТРАЖА ЗА УКЛОНЕНИЕ',
    'military':'ВОЕННОСЛУЖАЩИЙ',
    'rehabilitation':'РЕАБИЛИТАЦИЯ',
    'property':'ИМУЩЕСТВО',
    'foreign-transfer':'ПЕРЕДАЧА ОСУЖДЁННОГО',
    'foreign-recognition':'ИНОСТР. ПРИГОВОР',
    'conviction-remove':'СНЯТИЕ СУДИМОСТИ'
  };
  return labels[issueId]||'ИСПОЛНЕНИЕ ПРИГОВОРА';
}
function matterTypeCardLabel(m){
  // До возбуждения уголовного дела это материал проверки, а не уголовное дело.
  if(isCriminalCheckMaterial(m)) return 'МАТЕРИАЛ ПРОВЕРКИ';
  // На стадии главы 47 УПК карточка использует короткий ярлык вопроса,
  // чтобы подпись всегда помещалась рядом с основанием ведения.
  if(isCriminalExecutionMatter(m)){
    return criminalExecutionCardLabel((m&&m.executionIssue)||'');
  }
  if((m&&m.type)==='criminal') return 'УГОЛОВНОЕ ДЕЛО';
  if((m&&m.type)==='civil') return 'ГРАЖДАНСКОЕ ДЕЛО';
  if((m&&m.type)==='admin') return 'ИСК КАС';
  if((m&&m.type)==='koap') return 'ДЕЛО ПО КОАП';
  if((m&&m.type)==='other') return 'ИНОЕ ДЕЛО';
  var type=(matterType(m).n||'').toUpperCase();
  return type+' ДЕЛО';
}
function matterCardIconName(m){
  if(!m) return 'doc';
  if(isCriminalCheckMaterial(m)) return 'doc';
  if(isCriminalExecutionMatter(m)) return 'gavel';
  if(m.type==='criminal') return 'gavel';
  if(m.type==='civil') return 'brief';
  if(m.type==='admin') return 'flag';
  if(m.type==='koap') return 'lock';
  if(m.type==='other') return 'folder';
  return 'doc';
}
function matterCardSubject(m){
  if(!m)return '';
  if(m.title && m.title!==m.number && m.title!==m.client) return m.title;
  if((m.type==='criminal'||m.type==='koap') && m.article) return m.article;
  return '';
}

function matterCardTitle(m){
  if(!m) return 'Без названия';
  if(m.title) return m.title;
  if((m.type==='criminal'||m.type==='koap') && m.article) return m.article;
  if(m.number) return m.number;
  if(m.client) return m.client;
  return 'Без названия';
}
function matterCardInfoRow(icon,label,value,sub){
  if(!value)return '';
  return '<div class="mp-v3-row"><span class="mp-v3-row-icon">'+ico(icon,'s')+'</span><div class="mp-v3-row-copy"><small>'+esc(label)+'</small><b>'+esc(value)+'</b>'+(sub?'<em>'+esc(sub)+'</em>':'')+'</div></div>';
}
function matterCardInfoRows(m){
  var rows=[], client=m.client||'', role=matterRoleDisplayLabel(m.type||'other',m.stage||'',m.role||''), court=m.court||'', judge=m.judge||'', inv=m.investigator||'', opp=m.opponent||'';
  var ctx=matterPlaceContext(m.type||'other',m.stage||'',court);
  function add(icon,label,value,sub){ if(value) rows.push(matterCardInfoRow(icon,label,value,sub)); }
  if(m.type==='criminal'){
    add('user','Подзащитный / доверитель',client,role);
    add('lock','Статья / квалификация',m.article||'','');
    if(ctx.mode==='investigation'){
      if(court)add('brief',ctx.label,court,'');
      if(inv)add('user',matterInvestigatorLabel(m.stage),inv,'');
    }else if(court){
      add(ctx.mode==='judicial'?'gavel':'brief',ctx.label,court,ctx.mode==='judicial'?judge:'');
    }
    if(m.restraint&&m.stage!=='Материал проверки') add('lock','Мера пресечения',m.restraint,'');
  }else if(m.type==='civil'){
    add('user','Доверитель',client,role);
    if(court)add(ctx.mode==='judicial'?'gavel':'brief',ctx.label,court,ctx.mode==='judicial'?judge:'');
    if(opp) add('user','Другая сторона',opp,'');
  }else if(m.type==='admin'){
    add('user','Доверитель',client,role);
    if(court)add(ctx.mode==='judicial'?'gavel':'brief',ctx.label,court,ctx.mode==='judicial'?judge:'');
    if(opp) add('user','Административный ответчик / орган',opp,'');
  }else if(m.type==='koap'){
    add('user','Лицо / доверитель',client,role);
    add('lock','Статья КоАП',m.article||'','');
    if(court)add(ctx.mode==='judicial'?'gavel':'brief',ctx.label,court,ctx.mode==='judicial'?judge:'');
  }else{
    add('user','Доверитель',client,role);
    if(court)add(ctx.mode==='judicial'?'gavel':'brief',ctx.label,court,ctx.mode==='judicial'?judge:'');
  }
  return rows.join('');
}
function matterCardNextAction(m){
  var list=tasksOf(m.id).filter(isActiveRecord);
  if(!list.length)return '';
  var needs=list.filter(function(t){return t.kind==='hearing'&&hearingNeedsResult(t);}).sort(sortT);
  var late=list.filter(function(t){return (t.kind==='task'||t.kind==='deadline')&&t.due&&dd(t.due)<0;}).sort(sortT);
  var t=(needs[0]||late[0]||list.slice().sort(sortT)[0]);
  if(!t)return '';
  var tone='task', type='Задача', icon='check', title=t.title||'Без названия';
  if(t.kind==='hearing'){tone='hearing';type=hearingNeedsResult(t)?'Требуется результат':'Заседание';icon='gavel';title=t.title||'Судебное заседание';}
  else if(t.kind==='meeting'){tone='meeting';type='Встреча';icon='user';title=t.title||'Встреча';}
  else if(t.kind==='deadline'){tone='deadline';type=(t.due&&dd(t.due)<0)?'Просроченный срок':'Процессуальный срок';icon='clock';title=t.title||'Процессуальный срок';}
  else if(t.due&&dd(t.due)<0){tone='overdue';type='Просроченная задача';}
  var meta=[];
  if(t.due) meta.push(fmtD(t.due,true));
  if(t.time) meta.push(t.time);
  if(t.kind==='hearing'&&t.place) meta.push(t.place);
  else if(t.kind==='meeting'&&t.place) meta.push(t.place);
  var act=hearingNeedsResult(t)?'hearing-result':'task';
  return '<button class="mp-v3-next '+tone+'" data-act="'+act+'" data-id="'+t.id+'"><span class="mp-v3-next-icon">'+ico(icon,'s')+'</span><span class="mp-v3-next-copy"><small>Следующее действие · <em>'+esc(type)+'</em></small><b>'+esc(title)+'</b>'+(meta.length?'<span>'+esc(meta.join(' · '))+'</span>':'')+'</span><span class="mp-v3-next-chev">'+ico('chev','s')+'</span></button>';
}
function matterCardPulse(m){
  // Архивная карточка должна выглядеть как архивная: связанные незавершённые
  // записи могут оставаться в общем списке задач, но в архиве не показываем
  // «следующее действие» и просрочку как будто дело всё ещё в работе.
  if(m&&m.archived)return '';
  var st=matterStats(m);
  if(st.pendingResult){
    var p=st.pendingResult;
    return '<div class="matter-ultra-pulse result"><i></i><span>Требуется результат · '+esc(fmtShort(p.due))+(p.time?' · '+esc(p.time):'')+'</span></div>';
  }
  if(st.late){
    return '<div class="matter-ultra-pulse overdue"><i></i><span>Просрочено · '+st.late+' '+plural(st.late,'запись','записи','записей')+'</span></div>';
  }
  var t=st.next;if(!t)return '';
  var kind=t.kind==='hearing'?'Заседание':(t.kind==='meeting'?'Встреча':(t.kind==='deadline'?'Срок':'Задача'));
  var tone=t.kind==='hearing'?'hearing':(t.kind==='meeting'?'meeting':(t.kind==='deadline'?'deadline':'task'));
  var d=dd(t.due),when=d===0?'сегодня':(d===1?'завтра':fmtShort(t.due));
  return '<div class="matter-ultra-pulse '+tone+'"><i></i><span>След.: '+esc(kind)+' · '+esc(when)+(t.time?' · '+esc(t.time):'')+'</span></div>';
}

function compactMatterCardNumber(value){
  var n=String(value||'').trim();
  if(!n) return {text:'Без номера',full:'',long:false,empty:true};
  // Судебные номера обычно короткие и остаются целиком. Длинные номера
  // материалов/уголовных дел в карточке сокращаем, полный номер хранится в деле.
  if(n.length<=13) return {text:n,full:n,long:false,empty:false};
  return {text:n.slice(0,6)+'…'+n.slice(-3),full:n,long:true,empty:false};
}
function matterCard(m){
  var mt=matterType(m), basis=matterBasisMeta(m.basis);
  var caseColor=mt.c;
  if(isCriminalCheckMaterial(m)) caseColor=matterStageMeta('Материал проверки').c;
  else if(isCriminalExecutionMatter(m)) caseColor=matterStageMeta('Исполнение приговора').c;
  var title=matterCardTitle(m);
  var number=compactMatterCardNumber(m.number);
  var professional=matterCardProfessional(m);
  var basisChip=basis?'<span class="matter-compact-basis '+(m.basis==='agreement'?'agreement':'assigned')+'">'+esc(basis.short||basis.n)+'</span>':'';
  var meta=[];
  if(!number.empty) meta.push('<span class="matter-card-number'+(number.long?' is-long':'')+'" title="№ '+esc(number.full)+'">№ '+esc(number.text)+'</span>');
  if(m.stage) meta.push('<span>'+esc(m.stage)+'</span>');
  if(professional) meta.push('<span class="matter-strip-person">'+esc(professional.label)+' <b>'+esc(professional.value)+'</b></span>');
  return '<article class="matter-compact-card ultra matter-strip'+(m.archived?' archived':'')+'" style="--case:'+caseColor+'" data-act="matter" data-id="'+esc(m.id)+'" role="button" tabindex="0" aria-label="Открыть дело: '+esc(title)+'">'+
    '<div class="matter-compact-copy">'+
      '<div class="matter-ultra-kicker"><span class="matter-compact-type">'+esc(matterTypeCardLabel(m))+'</span>'+basisChip+'</div>'+ 
      '<b class="matter-compact-title">'+esc(title)+'</b>'+ 
      (meta.length?'<div class="matter-ultra-meta">'+meta.join('<i></i>')+'</div>':'')+
      matterCardPulse(m)+
    '</div>'+ 
    '<span class="matter-compact-chevron">'+ico('chev','s')+'</span>'+ 
  '</article>';
}

function matterAllStages(){
  var out=[];
  Object.keys(MATTER_STAGE_MAP).forEach(function(type){
    (MATTER_STAGE_MAP[type]||[]).forEach(function(stage){if(stage&&out.indexOf(stage)<0)out.push(stage);});
  });
  return out;
}
function matterStageOrder(stage){
  var all=matterAllStages(),i=all.indexOf(stage||'');
  return i<0?999:i;
}
function matterSearchText(m){
  var type=matterType(m),basis=matterBasisMeta(m.basis);
  return [m.title,m.client,m.phone,m.number,m.court,m.judge,m.investigator,m.article,m.role,m.notes,m.stage,type&&type.n,basis&&(basis.n||basis.short)]
    .filter(Boolean).join(' ').toLowerCase().replace(/ё/g,'е');
}
function matterCardProfessional(m){
  if(!m)return null;
  var ctx=matterPlaceContext(m.type||'other',m.stage||'',m.court||'');
  if(ctx.mode==='investigation'&&m.investigator){
    return {label:matterInvestigatorLabel(m.stage||'')||'Следователь / дознаватель',value:m.investigator};
  }
  if((ctx.mode==='judicial'||ctx.mode==='execution')&&m.judge){
    return {label:(m.type==='koap'?'Судья / должностное лицо':'Судья'),value:m.judge};
  }
  return null;
}
function matterSortLabel(v){
  return v==='client'?'По доверителю':(v==='stage'?'По стадии':'По срочности');
}
function sheetMatterFilters(){
  var scope=S.ui.matterScope||'active';
  var scopeMatters=S.matters.filter(function(m){return scope==='all'||(scope==='active'?!m.archived:!!m.archived);});
  var typeCounts={all:scopeMatters.length}; MATTER_TYPE_KEYS.forEach(function(k){ typeCounts[k]=scopeMatters.filter(function(m){return m.type===k;}).length; });
  var basisCounts={all:scopeMatters.length}; Object.keys(MATTER_BASIS).forEach(function(k){ basisCounts[k]=scopeMatters.filter(function(m){return m.basis===k;}).length; });
  var stageBase=scopeMatters.filter(function(m){
    if(S.ui.matterType&&m.type!==S.ui.matterType)return false;
    if(S.ui.matterBasis&&(m.basis||'')!==S.ui.matterBasis)return false;
    return true;
  });
  var stages=matterAllStages().filter(function(stage){return stageBase.some(function(m){return m.stage===stage;});});
  var stageCounts={all:stageBase.length}; stages.forEach(function(stage){stageCounts[stage]=stageBase.filter(function(m){return m.stage===stage;}).length;});
  function mr(act,v,icon,title,sub,count,tone,on){
    return '<button class="filter-premium-row'+(on?' selected':'')+'" style="--tone:'+tone+'" data-act="'+act+'" data-v="'+esc(v)+'"><span class="filter-premium-icon">'+ico(icon)+'</span><span class="filter-premium-copy"><b>'+title+'</b><small>'+sub+'</small></span>'+(count==null?'':'<span class="filter-premium-count">'+count+'</span>')+'<span class="filter-premium-tail">'+ico(on?'check':'chev','s')+'</span></button>';
  }
  var typeRows=mr('m-filter','','folder','Все производства','Показывать дела всех типов',typeCounts.all,'#B88C2D',S.ui.matterType==='')+
    MATTER_TYPE_KEYS.map(function(k){var t=MATTER_TYPES[k],fi=matterCardIconName({type:k});return mr('m-filter',k,fi,esc(t.n),esc(t.short),typeCounts[k]||0,t.c,S.ui.matterType===k);}).join('');
  var basisRows=mr('m-basis-filter','','doc','Все основания','Соглашение и дела по назначению',basisCounts.all,'#B88C2D',S.ui.matterBasis==='')+
    Object.keys(MATTER_BASIS).map(function(k){var t=MATTER_BASIS[k];return mr('m-basis-filter',k,k==='agreement'?'doc':'user',esc(t.n),esc(t.short),basisCounts[k]||0,t.c,S.ui.matterBasis===k);}).join('');
  var stageRows=mr('m-stage-filter','','flag','Все стадии','Без ограничения по стадии',stageCounts.all,'#B88C2D',S.ui.matterStage==='')+
    (stages.length?stages.map(function(stage){var sm=matterStageMeta(stage);return mr('m-stage-filter',stage,sm.icon||'flag',esc(stage),'Стадия производства',stageCounts[stage]||0,sm.c||'#7A8FA6',S.ui.matterStage===stage);}).join(''):'');
  var sortRows=mr('m-sort','priority','clock','По срочности','Сначала результат заседания, просрочки и ближайшие действия',null,'#C29130',S.ui.matterSort==='priority')+
    mr('m-sort','client','user','По доверителю','Алфавитная сортировка по доверителю / подзащитному',null,'#4E86C6',S.ui.matterSort==='client')+
    mr('m-sort','stage','flag','По стадии','Группировка по ходу производства',null,'#35A996',S.ui.matterSort==='stage');
  openSheet('<div class="filter-premium-head"><span class="filter-premium-head-icon">'+ico('folder')+'</span><div><h2>Фильтр дел</h2><p>Тип, основание, стадия и порядок списка</p></div></div>'+ 
    '<div class="filter-premium-section"><div class="filter-premium-label">Тип производства</div><div class="filter-premium-card">'+typeRows+'</div></div>'+ 
    '<div class="filter-premium-section"><div class="filter-premium-label">Основание ведения</div><div class="filter-premium-card">'+basisRows+'</div></div>'+ 
    '<div class="filter-premium-section"><div class="filter-premium-label">Стадия</div><div class="filter-premium-card">'+stageRows+'</div></div>'+ 
    '<div class="filter-premium-section"><div class="filter-premium-label">Сортировка</div><div class="filter-premium-card">'+sortRows+'</div></div>'+ 
    '<button class="btn ghost matter-filter-reset-btn" data-act="matter-filter-reset">Сбросить фильтры и сортировку</button>');
  $('#sheet').classList.add('filter-premium-sheet','matter-filter-premium');
}

function renderMatters(){
  if(S.ui&&S.ui.matterType==='other'){S.ui.matterType='';save();}
  var scope=S.ui.matterScope||'active';
  if(['all','active','archive'].indexOf(scope)<0) scope='active';
  var allCount=S.matters.length, activeCount=activeM().length, archCount=S.matters.filter(function(m){return m.archived;}).length;
  var q=String(S.ui.matterQ||'').trim().toLowerCase().replace(/ё/g,'е');
  var list=S.matters.filter(function(m){
    if(scope==='active' && m.archived) return false;
    if(scope==='archive' && !m.archived) return false;
    if(S.ui.matterType && m.type!==S.ui.matterType) return false;
    if(S.ui.matterBasis && (m.basis||'')!==S.ui.matterBasis) return false;
    if(S.ui.matterStage && (m.stage||'')!==S.ui.matterStage) return false;
    if(q && matterSearchText(m).indexOf(q)<0) return false;
    return true;
  });
  var sortMode=S.ui.matterSort||'priority';
  list.sort(function(a,b){
    if(a.archived!==b.archived) return a.archived?1:-1;
    if(sortMode==='client'){
      var ac=matterAutoClientLabel(a.client||a.title||''),bc=matterAutoClientLabel(b.client||b.title||'');
      var cmp=ac.localeCompare(bc,'ru',{sensitivity:'base'}); if(cmp)return cmp;
      return (a.title||'').localeCompare(b.title||'','ru',{sensitivity:'base'});
    }
    if(sortMode==='stage'){
      var so=matterStageOrder(a.stage)-matterStageOrder(b.stage); if(so)return so;
      var sc=(a.stage||'').localeCompare(b.stage||'','ru',{sensitivity:'base'}); if(sc)return sc;
      return matterAutoClientLabel(a.client||'').localeCompare(matterAutoClientLabel(b.client||''),'ru',{sensitivity:'base'});
    }
    var A=matterStats(a),B=matterStats(b);
    if(!!A.pendingResult!==!!B.pendingResult) return A.pendingResult?-1:1;
    if(!!A.late!==!!B.late) return A.late?-1:1;
    var an=A.next?A.next.due:'9999',bn=B.next?B.next.due:'9999';
    if(an!==bn) return an<bn?-1:1;
    return B.open-A.open;
  });
  var typeName=S.ui.matterType?(MATTER_TYPES[S.ui.matterType]||MATTER_TYPES.other).short:'';
  var basisName=S.ui.matterBasis?(MATTER_BASIS[S.ui.matterBasis]||{short:'Основание'}).short:'';
  var stageName=S.ui.matterStage||'';
  var sortName=sortMode!=='priority'?matterSortLabel(sortMode):'';
  var filterName=[typeName,basisName,stageName,sortName].filter(Boolean).join(' · ')||'Фильтр';
  var hasMatterFilter=!!(S.ui.matterType||S.ui.matterBasis||S.ui.matterStage||sortMode!=='priority');
  var scopeCount=scope==='all'?allCount:(scope==='archive'?archCount:activeCount);
  var scopeCaption=scope==='all'
    ? scopeCount+' '+plural(scopeCount,'дело','дела','дел')+' всего'
    : (scope==='archive'
      ? scopeCount+' '+plural(scopeCount,'дело','дела','дел')+' в архиве'
      : scopeCount+' '+plural(scopeCount,'дело','дела','дел')+' в производстве');
  if(hasMatterFilter||q)scopeCaption=list.length+' '+plural(list.length,'дело','дела','дел')+(q?' найдено':' по фильтру');
  var html='<div class="matters-project">'+
    mainBrandHeader()+
    '<div class="today-head matters-title-head"><div><h1>Дела</h1><p>'+scopeCaption+'</p></div>'+ 
      '<div class="today-actions">'+headerSearch('matter-search',!!(S.ui.matterSearchOpen||q),'Поиск по делам')+'</div></div>'+ 
    ((S.ui.matterSearchOpen||q)?'<div class="fld matters-local-search"><input id="matter-q" placeholder="Поиск: доверитель, номер, статья, суд, судья…" value="'+esc(S.ui.matterQ||'')+'" autocomplete="off"></div>':'')+
    '<div class="matters-scope">'+
      '<button class="'+(scope==='all'?'on':'')+'" data-act="matter-scope" data-v="all"><span>Все</span><em>'+allCount+'</em></button>'+ 
      '<button class="'+(scope==='active'?'on':'')+'" data-act="matter-scope" data-v="active"><span>В работе</span><em>'+activeCount+'</em></button>'+ 
      '<button class="'+(scope==='archive'?'on':'')+'" data-act="matter-scope" data-v="archive"><span>Архив</span><em>'+archCount+'</em></button>'+ 
      '<button class="matter-filter-btn'+(hasMatterFilter?' on':'')+'" data-act="matter-filter-sheet" title="Фильтр дел" aria-label="Фильтр дел">'+ico('list','s')+'<span>'+esc(filterName)+'</span></button></div>'+ 
    '<div class="matters-list">';
  html+=list.length?list.map(matterCard).join(''):
    ((hasMatterFilter||q)
      ? empty('folder',q?'Дела не найдены':'Нет дел по фильтру',q?'Измените запрос или очистите поиск.':'Измените параметры отбора или сбросьте фильтры.',q?[{act:'matter-search-clear',t:'Очистить поиск'}]:[{act:'matter-filter-reset',t:'Сбросить фильтры'}])
      : empty('folder',scope==='archive'?'Архив пуст':'Дел пока нет',scope==='archive'?'Завершённые дела появятся здесь после отправки в архив.':'Создайте первое дело и ведите задачи, заседания и историю в одном месте.',scope==='archive'?null:[{act:'new-matter',t:'Завести дело'}]));
  html+='</div></div>';
  $('#sc-matters').innerHTML=html;
  if((S.ui.matterSearchOpen||q)&&$('#matter-q')){
    var mq=$('#matter-q');
    setTimeout(function(){try{mq.focus({preventScroll:true});mq.setSelectionRange(mq.value.length,mq.value.length);}catch(_){mq.focus();}},0);
  }
}


function calAgendaTone(t){
  if(hearingNeedsResult(t)) return 'result';
  if(hearingHasResult(t)) return 'history';
  if(t.done) return 'done';
  if(t.kind==='hearing') return 'hearing';
  if(t.kind==='meeting') return 'meeting';
  if(t.kind==='deadline') return 'deadline';
  if(t.pri==='high') return 'high';
  if(t.pri==='mid') return 'mid';
  return 'task';
}
function calAgendaLabel(t){
  var ri=hearingResultInfo(t);
  if(ri) return ri.label;
  if(hearingNeedsResult(t)) return 'Результат';
  if(t.kind==='hearing') return 'Заседание';
  if(t.kind==='meeting') return 'Встреча';
  if(t.kind==='deadline') return 'Срок';
  if(t.done) return 'Готово';
  if(t.pri==='high') return 'Высокий';
  if(t.pri==='mid') return 'Средний';
  if(t.pri==='low') return 'Низкий';
  return 'Задача';
}
function calAgendaIcon(t){
  if(hearingNeedsResult(t)) return ico('clock','s');
  if(t.kind==='hearing') return ico(hearingHasResult(t)?'check':'gavel','s');
  if(t.kind==='meeting') return ico('user','s');
  if(t.kind==='deadline') return ico('clock','s');
  return ico('check','s');
}
function calAgendaRow(t){
  var m=t.mid?matter(t.mid):null;
  var tone=calAgendaTone(t), label=calAgendaLabel(t);
  var title=t.kind==='hearing'?(t.title||'Судебное заседание'):(t.title||'Без названия');
  var sub='';
  if(t.kind==='hearing') sub=hearingContextText(t)||t.place||'';
  else if(t.kind==='meeting') sub=t.place||((m&&m.client)?m.client:'Встреча');
  else if(t.kind==='deadline') sub=t.rule||((m&&m.number)?m.number:'Процессуальный срок');
  else sub=(m?[m.number,m.title].filter(Boolean).join(' · '):'');
  var note='';
  if(t.kind==='hearing'&&t.place) note=t.place;
  else if(t.note) note=t.note;
  var meta=[sub,note].filter(function(x,i,a){ return x && a.indexOf(x)===i; }).join(' · ');
  var act=hearingNeedsResult(t)?'hearing-result':'task';
  return '<button class="cal-agenda-item '+tone+'" data-act="'+act+'" data-id="'+t.id+'">'+
    '<span class="cal-agenda-time mono">'+esc(t.time||'—')+'</span>'+
    '<span class="cal-agenda-icon">'+calAgendaIcon(t)+'</span>'+
    '<span class="cal-agenda-main"><b>'+esc(title)+'</b>'+
      (meta?'<small>'+esc(meta)+'</small>':'')+
      (t.mid&&m?'<em>'+esc([m.number,m.client||m.title].filter(Boolean).join(' · '))+'</em>':'')+
    '</span>'+
    '<span class="cal-agenda-side"><span class="cal-agenda-badge '+tone+'">'+esc(label)+'</span><i>'+ico('chev','s')+'</i></span>'+
  '</button>';
}
function profileInitials(name){
  var raw=(name||'Адвокат').trim();
  if(!raw) return 'АК';
  var parts=raw.split(/\s+/).filter(Boolean);
  if(parts.length===1) return parts[0].slice(0,2).toUpperCase();
  return (parts[0].slice(0,1)+parts[1].slice(0,1)).toUpperCase();
}

/* =====================================================================
   SCREEN: КАЛЕНДАРЬ
   ===================================================================== */
function renderCal(){
  var u=S.ui;
  if(!u.calM) u.calM=today().slice(0,7);
  if(!u.calSel) u.calSel=today();
  var y=+u.calM.slice(0,4), mo=+u.calM.slice(5,7)-1;
  var first=new Date(y,mo,1), start=(first.getDay()+6)%7;
  var dim=new Date(y,mo+1,0).getDate(), dimPrev=new Date(y,mo,0).getDate();
  var cells=[];
  for(var i=0;i<start;i++) cells.push({d:iso(new Date(y,mo-1,dimPrev-start+i+1)),out:true});
  for(var j=1;j<=dim;j++) cells.push({d:iso(new Date(y,mo,j))});
  while(cells.length%7) cells.push({d:iso(new Date(y,mo+1,cells.length-start-dim+1)),out:true});

  var byDay={};
  S.tasks.forEach(function(t){ if(t.due){ (byDay[t.due]=byDay[t.due]||[]).push(t); } });
  var monthItems=S.tasks.filter(function(t){ return t.due && t.due.slice(0,7)===u.calM; });
  var monthOpen=monthItems.filter(isActiveRecord).length;
  var monthHearings=monthItems.filter(function(t){ return t.kind==='hearing'; }).length;
  var monthDeadlines=monthItems.filter(function(t){ return t.kind==='deadline'; }).length;

  var grid=['пн','вт','ср','чт','пт','сб','вс'].map(function(d){ return '<div class="cdow">'+d+'</div>'; }).join('');
  grid += cells.map(function(c){
    var dayItems=(byDay[c.d]||[]), its=dayItems.filter(function(t){ return !t.done; });
    var dots=[];
    if(its.some(function(t){ return t.kind==='hearing'&&!hearingNeedsResult(t); })) dots.push('var(--blue)');
    if(its.some(hearingNeedsResult)) dots.push('var(--warn)');
    if(dayItems.some(function(t){ return t.kind==='hearing'&&hearingHasResult(t); })) dots.push('var(--ok)');
    if(its.some(function(t){ return t.kind==='deadline'; })) dots.push('var(--dang)');
    if(its.some(function(t){ return t.kind==='meeting'; })) dots.push('var(--purple)');
    if(its.some(function(t){ return t.kind==='task'; })) dots.push('var(--gold)');
    var wd=parseD(c.d).getDay();
    return '<button class="cday'+(c.out?' out':'')+(c.d===today()?' today':'')+(c.d===u.calSel?' sel':'')+((wd===0||wd===6)?' wk':'')+'" data-act="cday" data-v="'+c.d+'">'+parseD(c.d).getDate()+'<span class="cdots">'+dots.slice(0,3).map(function(x){ return '<i style="background:'+x+'"></i>'; }).join('')+'</span></button>';
  }).join('');

  var day=(byDay[u.calSel]||[]).sort(sortT);
  var dHear=day.filter(function(t){ return t.kind==='hearing'; }).length;
  var dDead=day.filter(function(t){ return t.kind==='deadline'; }).length;
  var dOpen=day.filter(isActiveRecord).length;
  var html='<div class="calendar-project">'+
    mainBrandHeader()+
    '<div class="today-head calendar-title-head"><div><h1>Календарь</h1><p>'+fmtD(u.calSel,true)+' · '+cap(DOW[parseD(u.calSel).getDay()])+'</p></div>'+
      '<div class="today-actions">'+headerSearch('global-search',false,'Глобальный поиск')+'</div></div>'+
    '<div class="calendar-month-card">'+
      '<div class="calendar-month-top"><button class="iconbtn" data-act="cal-m" data-v="-1" aria-label="Предыдущий месяц">'+ico('left')+'</button><div class="calendar-month-label">'+cap(MONN[mo])+' '+y+'</div><div class="calendar-month-actions"><button class="calendar-today-btn" data-act="cal-today">Сегодня</button><button class="iconbtn" data-act="cal-m" data-v="1" aria-label="Следующий месяц">'+ico('chev')+'</button></div></div>'+
      '<div class="cgrid calendar-grid">'+grid+'</div>'+
      '<div class="calendar-month-stats"><span><b>'+monthOpen+'</b><small>в работе</small></span><span><b>'+monthHearings+'</b><small>заседаний</small></span><span><b>'+monthDeadlines+'</b><small>сроков</small></span></div>'+
    '</div>'+
    '<div class="calendar-day-card">'+
      '<div class="calendar-day-head"><div><h2>'+fmtD(u.calSel,true)+'</h2><p>'+day.length+' '+plural(day.length,'запись','записи','записей')+' на дату</p></div><button class="calendar-add-btn" data-act="new-on-day">Добавить</button></div>'+
      '<div class="calendar-day-stats"><span><b>'+dOpen+'</b><small>в работе</small></span><span><b>'+dHear+'</b><small>заседаний</small></span><span><b>'+dDead+'</b><small>сроков</small></span></div>'+
      (day.length?('<div class="calendar-agenda-list">'+day.map(calAgendaRow).join('')+'</div>'):'<div class="calendar-empty">'+empty('cal','Свободный день','На эту дату ничего не запланировано.',[{act:'new-on-day',t:'Запланировать на этот день'}])+'</div>')+
    '</div></div>';
  $('#sc-cal').innerHTML=html;
}

/* =====================================================================
   SCREEN: ЕЩЁ
   ===================================================================== */
function weekStats(){
  var from=addD(today(),-6);
  var done=S.tasks.filter(function(t){return t.done&&t.doneAt&&t.doneAt.slice(0,10)>=from;}).length;
  var parts=S.participation.filter(function(e){return e.date>=from;});
  var sum=parts.reduce(function(a,e){var m=matter(e.mid);return a+(+e.rate||+(m&&m.dayRate)||+S.settings.dayRate||0);},0);
  return {done:done,days:parts.length,sum:sum};
}
function isIOS(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
}
function isStandalone(){ return window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true; }
function iphoneInstallHint(){
  if(!isIOS()||isStandalone())return '';
  return '<div class="hint" style="margin:0 0 14px"><b>Установите на iPhone для офлайн-работы:</b><br>Откройте ссылку в браузере, выберите «На экран Домой». Если браузер не предлагает установку веб-приложения — используйте Safari.</div>';
}
function offlineStatusText(){
  if(isStandalone())return 'Установлено на экран «Домой» · офлайн-режим готов';
  if(isIOS())return 'Добавьте приложение на экран «Домой», чтобы запускать его автономно';
  return navigator.onLine?'Приложение готово к автономной работе после установки':'Сейчас работает без подключения к интернету';
}
function effectiveTheme(){
  if(S.settings.theme!=='auto') return S.settings.theme==='light'?'light':'dark';
  var h=new Date().getHours();
  return (h>=7 && h<19)?'light':'dark';
}
function themeLabel(){
  if(S.settings.theme==='auto') return 'Автоматически · '+(effectiveTheme()==='light'?'светлая сейчас':'тёмная сейчас');
  return S.settings.theme==='light'?'Светлая':'Тёмная';
}
function applyTheme(){
  var t=effectiveTheme();
  document.body.classList.toggle('light',t==='light');
  var meta=document.querySelector('meta[name=theme-color]');
  if(meta) meta.content=t==='dark'?'#07111C':'#F4F6F9';
}
var THEME_TIMER=null;
function scheduleThemeBoundary(){
  if(THEME_TIMER){clearTimeout(THEME_TIMER);THEME_TIMER=null;}
  if(S.settings.theme!=='auto') return;
  var now=new Date(),next=new Date(now);
  var h=now.getHours();
  if(h<7){next.setHours(7,0,0,0);}
  else if(h<19){next.setHours(19,0,0,0);}
  else{next.setDate(next.getDate()+1);next.setHours(7,0,0,0);}
  var wait=Math.max(1000,next.getTime()-now.getTime()+250);
  THEME_TIMER=setTimeout(function(){
    if(unlocked){render();scheduleThemeBoundary();}
  },wait);
}
function sheetTheme(){
  function opt(mode,title,sub,icon){
    var on=S.settings.theme===mode;
    return '<button class="row" data-act="theme-set" data-v="'+mode+'">'+ico(icon||'sun')+
      '<span class="rl">'+title+'<small>'+sub+'</small></span>'+(on?'<span class="tag gold">✓</span>':ico('chev','s'))+'</button>';
  }
  openSheet('<h2>Оформление</h2><p class="sh-sub">Автоматический режим использует светлую тему днём и тёмную вечером.</p>'+
    '<div class="card pad0">'+
      opt('auto','Автоматически','Светлая 07:00–18:59 · тёмная с 19:00','sun')+
      opt('light','Светлая','Всегда использовать светлое оформление','sun')+
      opt('dark','Тёмная','Всегда использовать тёмное оформление','moon')+
    '</div>');
}

function backupPlanStats(){
  var active=S.tasks.filter(function(t){return !t.done;});
  return {
    tasks:active.filter(function(t){return t.kind==='task';}).length,
    hearings:active.filter(function(t){return t.kind==='hearing';}).length,
    deadlines:active.filter(function(t){return t.kind==='deadline';}).length
  };
}
function backupStatusText(){
  if(!S.settings.lastBackup) return 'Копия ещё не создавалась';
  var age=backupAge();
  return age===0?'Последняя копия: сегодня':'Последняя копия: '+fmtD(S.settings.lastBackup.slice(0,10),true);
}
function renderMore(){
  var w=weekStats(), bs=backupPlanStats();
  var active=S.tasks.filter(isActiveRecord).length;
  var backupText=backupStatusText();
  var profileName=S.settings.name||'Адвокат';
  var profileSub=(S.settings.dayRate?money(S.settings.dayRate)+'/день':'Ставка не задана')+' · '+(S.settings.notify?'напоминания включены':'напоминания выключены');
  var html='<div class="more-project">'+
    mainBrandHeader()+
    '<div class="today-head calendar-title-head more-title-head"><div><h1>Настройки</h1><p>'+esc(offlineStatusText())+'</p></div>'+
      '<div class="today-actions">'+headerSearch('global-search',false,'Глобальный поиск')+'</div></div>'+
    '<button class="settings-profile-card" data-act="profile"><span class="settings-profile-avatar">'+esc(profileInitials(profileName))+'</span><span class="settings-profile-meta"><b>'+esc(profileName)+'</b><small>Адвокат</small><em>'+esc(profileSub)+'</em></span><i class="settings-profile-chevron">'+ico('chev','s')+'</i></button>'+
    '<div class="settings-kpis"><span><b>'+w.done+'</b><small>выполнено за 7 дней</small></span><span><b>'+w.days+'</b><small>дней участия</small></span><span><b>'+active+'</b><small>активных записей</small></span></div>'+
    (backupDue()?'<button class="backupwarn" data-act="backup-sheet">'+ico('lock','s')+'<span><b>Резервная копия просрочена</b><small>Рекомендуется сохранять копию не реже одного раза в '+(+S.settings.backupEveryDays||7)+' дней</small></span>'+ico('chev','s')+'</button>':'')+
    iphoneInstallHint()+
    '<div class="settings-section-title">Инструменты</div><div class="card pad0 settings-card">'+
      row('flag','Калькулятор сроков','Создание и расчёт процессуальных сроков','deadline')+
      row('gavel','Дни участия','Суд, следственные действия и выезды','participation-log')+
      row('tpl','Шаблоны чек-листов','Готовые планы по типовым поручениям','templates')+
      row('doc','Отчёты и печать','План дня и выгрузка по делу','reports')+
      row('share','Экспорт списка','Отправить рабочий список в заметки или мессенджер','export')+
    '</div>'+
    '<div class="settings-section-title">Уведомления и оформление</div><div class="card pad0 settings-card">'+
      rowSw('bell','Напоминания',S.settings.notify?'Уведомления включены':'Уведомления выключены','notify-sheet',S.settings.notify)+
      row('sun','Оформление',themeLabel(),'theme')+
      row('search','Глобальный поиск','Дела, доверители, задачи, заметки и журнал','global-search')+
    '</div>'+
    '<div class="settings-section-title">Безопасность и данные</div>'+
    '<div class="backup-safety settings-backup-card"><div class="backup-safety-top"><span class="backup-safety-icon">'+ico('lock')+'</span><div><b>Резервная копия планов</b><small>'+backupText+'</small></div></div>'+
      '<div class="backup-safety-stats"><span><b>'+bs.tasks+'</b> задач</span><span><b>'+bs.hearings+'</b> заседаний</span><span><b>'+bs.deadlines+'</b> сроков</span></div>'+
      '<p>Сохраняются все дела, задачи, заседания, процессуальные сроки и связанные записи.</p>'+
      '<button class="btn backup-main-btn" data-act="backup-sheet">Создать резервную копию</button></div>'+
    '<div class="card pad0 settings-card">'+
      row('folder','Восстановить из копии','Вернуть данные после переустановки или сбоя','restore')+
      row('lock','Код доступа и шифрование',pinEnabled()?'PIN включён · база зашифрована':'База зашифрована локальным ключом устройства','pin')+
    '</div>'+
    '<div class="settings-section-title">Обслуживание и справка</div><div class="card pad0 settings-card">'+
      row('sun','Как пользоваться','Краткая инструкция по рабочему процессу','intro')+
      row('list','Загрузить примеры','Учебные дела и задачи','demo')+
      row('trash','Удалить выполненные','Очистить завершённые задачи','clearDone')+
      row('trash','Удалить все данные','Полностью очистить локальную базу','wipe')+
    '</div>'+
    '<div class="settings-footnote">Ежедневник адвоката · iPhone Offline '+APP_VERSION+'<br>'+esc(offlineStatusText())+'<br>Рабочая база хранится локально в зашифрованном виде.</div>'+
  '</div>';
  $('#sc-more').innerHTML=html;
}
function rowSw(i,t,s,act,on){
  return '<button class="row" data-act="'+act+'">'+ico(i)+'<span class="rl">'+t+'<small>'+esc(s)+'</small></span>'+
    '<span class="switch'+(on?' on':'')+'"><i></i></span></button>';
}
function row(i,t,s,act){
  return '<button class="row" data-act="'+act+'">'+ico(i)+'<span class="rl">'+t+'<small>'+esc(s)+'</small></span>'+
    ico('chev','s')+'</button>';
}

/* =====================================================================
   RENDER
   ===================================================================== */
var TAB_TRANSITION='';
function render(){
  ['today','tasks','matters','cal','more'].forEach(function(k){
    $('#sc-'+k).classList.toggle('hide', S.ui.tab!==k); });
  ({today:renderToday,tasks:renderTasks,matters:renderMatters,cal:renderCal,more:renderMore})[S.ui.tab]();
  document.querySelectorAll('.tab').forEach(function(b){ b.classList.toggle('on', b.dataset.tab===S.ui.tab); });
  document.querySelectorAll('.tab[data-tab="matters"] use').forEach(function(u){
    u.setAttribute('href', S.ui.tab==='matters' ? '#i-nav-cases-fill' : '#i-nav-cases');
  });
  var hideFab=(S.ui.tab==='more');
  $('#fab').classList.toggle('fab-context-hide',hideFab);
  $('#fab').style.display=hideFab?'none':'flex';
  var active=$('#sc-'+S.ui.tab);
  if(active){
    active.classList.remove('fadein','tab-slide-next','tab-slide-prev');
    var motionClass=TAB_TRANSITION==='next'?'tab-slide-next':(TAB_TRANSITION==='prev'?'tab-slide-prev':'fadein');
    active.classList.add(motionClass);
    setTimeout(function(){ if(active) active.classList.remove(motionClass); },340);
  }
  TAB_TRANSITION='';
  applyTheme();
}
var NAV_TABS=[];
function go(tab,replaceHistory,transition){
  var cur=S.ui.tab;
  if(tab!==cur && !replaceHistory){
    if(!NAV_TABS.length || NAV_TABS[NAV_TABS.length-1]!==cur) NAV_TABS.push(cur);
    if(NAV_TABS.length>12) NAV_TABS.shift();
  }
  TAB_TRANSITION=transition||'';
  S.ui.tab = tab; S.ui.q=''; S.ui._sq=false; save(); render();
  var e = $('#sc-'+tab); if(e) e.scrollTop = 0;
}
function appBack(){
  if(LIST_PICKER){closePremiumListPicker();vib(5);return true;}
  if(TIME_PICKER){closePremiumTimePicker();vib(5);return true;}
  if(DATE_PICKER){closePremiumDatePicker();vib(5);return true;}
  var sheet=$('#sheet'), page=$('#page');
  if(sheet.classList.contains('open')){ closeSheet(); vib(5); return true; }
  if(page.classList.contains('open')){
    if(page._navType==='report' && REPORT && REPORT.back && matter(REPORT.back)){
      openMatter(REPORT.back); vib(5); return true;
    }
    closeAll(); vib(5); return true;
  }
  if(NAV_TABS.length){
    var prev=NAV_TABS.pop(); go(prev,true); vib(5); return true;
  }
  if(S.ui.tab!=='today'){ go('today',true); vib(5); return true; }
  return false;
}

/* =====================================================================
   TASK EDITOR
   ===================================================================== */
var ED = null;
function hearingCourt(mid){ var m=mid?matter(mid):null; return (m&&m.court)||''; }
function syncHearingCourt(force){
  if(!ED||ED.kind!=='hearing'||!ED.mid)return;
  var c=hearingCourt(ED.mid);
  if(force || !ED.place) ED.place=c;
}
var COMMON_KINESHMA_COURTS = [
  {short:'Кинешемский городской суд', value:'Кинешемский городской суд Ивановской области', main:true, judge:''},
  {short:'Мировой № 1', value:'Судебный участок № 1 Кинешемского судебного района Ивановской области', judge:'Осокина Е.В.'},
  {short:'Мировой № 2', value:'Судебный участок № 2 Кинешемского судебного района Ивановской области', judge:'Новиков О.В.'},
  {short:'Мировой № 3', value:'Судебный участок № 3 Кинешемского судебного района Ивановской области', judge:'Скворцова А.В.'},
  {short:'Мировой № 4', value:'Судебный участок № 4 Кинешемского судебного района Ивановской области', judge:'Кочемина М.Л.'},
  {short:'Мировой № 5', value:'Судебный участок № 5 Кинешемского судебного района Ивановской области', judge:'Шлыков А.В.'},
  {short:'Мировой № 6', value:'Судебный участок № 6 Кинешемского судебного района Ивановской области', judge:''}
];
var KINESHMA_CITY_JUDGES = [
  'Асташкин Е.М.','Груздев В.В.','Долинкина Е.К.','Ельцова Т.В.','Капустина Е.А.','Кротов Е.В.',
  'Разуваев Г.Л.','Туроватов Д.В.','Шилова Н.Ю.','Ширшин А.А.','Румянцева Ю.А.','Хватова О.И.',
  'Коровкина О.А.','Лобанкова А.Е.','Силина О.А.','Пангачева М.В.'
];
var CRIMINAL_JUDGE_SURNAMES = {
  'асташкин':1,
  'груздев':1,
  'туроватов':1,
  'кротов':1,
  'разуваев':1,
  'шилова':1,
  'ширшин':1
};
function commonCourtByValue(value){
  return COMMON_KINESHMA_COURTS.filter(function(c){return c.value===value;})[0]||null;
}
function judgeDirectory(courtValue,matterType,stage){
  var cityCourt=(COMMON_KINESHMA_COURTS.filter(function(c){return c.main;})[0]||{}).value||'Кинешемский городской суд Ивановской области';
  // Premium order without a selected court: criminal (red), civil (blue), magistrates (green).
  var criminal=[], civil=[];
  KINESHMA_CITY_JUDGES.forEach(function(j){
    var surname=normLookup((j||'').split(/\s+/)[0]);
    var row={judge:j,court:cityCourt,label:j};
    if(CRIMINAL_JUDGE_SURNAMES[surname]) criminal.push(row); else civil.push(row);
  });
  var magistrates=[];
  COMMON_KINESHMA_COURTS.filter(function(c){return !c.main&&c.judge;}).forEach(function(c){
    magistrates.push({judge:c.judge,court:c.value,label:c.short+' — '+c.judge});
  });
  var selected=String(courtValue||'').trim();
  var type=String(matterType||'').trim();
  var currentStage=String(stage||'').trim();
  var isAppealStage=(currentStage==='Апелляция'||currentStage==='Пересмотр / апелляция');
  var known=selected?commonCourtByValue(selected):null;

  // В апелляционной инстанции мировой судья не может выступать судьёй апелляции.
  // Поэтому мировые судьи исключаются из справочника независимо от типа производства.
  if(isAppealStage){
    magistrates=[];
    if(known&&!known.main)return [];
  }

  // Для уголовного производства в Кинешемском городском суде показываем
  // только судей уголовной специализации (красная группа). Гражданские судьи
  // в уголовном деле не предлагаются. Мировой участок сохраняет своего судью.
  if(type==='criminal'){
    if(known&&known.main)return criminal.slice();
    if(known&&!known.main)return magistrates.filter(function(r){return r.court===known.value;});
    if(!selected)return criminal.concat(magistrates);
    return [];
  }

  // Для гражданского производства зеркально исключаем уголовную специализацию:
  // в Кинешемском городском суде показываются только гражданские судьи (синяя группа),
  // а при выборе мирового участка — только судья конкретного участка.
  if(type==='civil'){
    if(known&&known.main)return civil.slice();
    if(known&&!known.main)return magistrates.filter(function(r){return r.court===known.value;});
    if(!selected)return civil.concat(magistrates);
    return [];
  }

  var rows=criminal.concat(civil,magistrates);
  if(!selected)return rows;
  if(known){
    return rows.filter(function(r){return r.court===known.value;});
  }
  return [];
}
function judgeAllowedForCourt(judgeValue,courtValue,matterType,stage){
  if(!judgeValue)return true;
  var allowed=judgeDirectory(courtValue,matterType||'',stage||'');
  return allowed.some(function(r){return r.judge===judgeValue;});
}
function normLookup(v){
  return String(v||'').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/gi,'').trim();
}
function knownJudgeEntry(value){
  var q=normLookup(value); if(!q)return null;
  var rows=judgeDirectory(''), exact=rows.filter(function(x){return normLookup(x.judge)===q;});
  if(exact.length===1)return exact[0];
  if(q.length<4)return null;
  var candidates=rows.filter(function(x){
    var full=normLookup(x.judge), surname=normLookup((x.judge||'').split(/\s+/)[0]);
    return full.indexOf(q)===0||surname===q;
  });
  return candidates.length===1?candidates[0]:null;
}
function courtChoiceOptions(current){
  var selected=current||'';
  return '<option value="">— выбрать суд —</option>'+COMMON_KINESHMA_COURTS.map(function(c){
    return '<option value="'+esc(c.value)+'"'+(c.value===selected?' selected':'')+'>'+esc(c.short)+'</option>';
  }).join('');
}
function judgeChoiceOptions(current,courtValue){
  var selected=current||'';
  return '<option value="">— выбрать судью —</option>'+judgeDirectory(courtValue||'').map(function(x){
    return '<option value="'+esc(x.judge)+'"'+(x.judge===selected?' selected':'')+'>'+esc(x.label)+'</option>';
  }).join('');
}
function courtDatalist(){
  return '<datalist id="court-options">'+COMMON_KINESHMA_COURTS.map(function(c){return '<option value="'+esc(c.value)+'">'+esc(c.short)+'</option>';}).join('')+'</datalist>';
}
function judgeDatalist(courtValue){
  return '<datalist id="judge-options">'+judgeDirectory(courtValue||'').map(function(x){return '<option value="'+esc(x.judge)+'">'+esc(x.label)+'</option>';}).join('')+'</datalist>';
}
function inlineChoiceField(inputId,selectId,value,placeholder,optionsHtml,listId){
  // Не привязываем input к <datalist>. На iPhone/Safari нативный datalist
  // иногда перехватывает касание и показывает системную чёрную подсказку
  // вместо нашего premium-списка. Ручной ввод остаётся обычным input,
  // а справочник всегда открывается только через собственный trigger.
  return '<div class="inline-choice-wrap"><input id="'+inputId+'" value="'+esc(value||'')+'" placeholder="'+esc(placeholder||'')+'" autocomplete="off">'+
    '<select id="'+selectId+'" class="inline-choice-select premium-select-native" aria-label="Выбрать из списка" tabindex="-1" aria-hidden="true">'+optionsHtml+'</select></div>';
}
function applyKnownJudgeCourt(judgeValue,editorMode){
  var entry=knownJudgeEntry(judgeValue); if(!entry)return false;
  if(editorMode==='matter'){
    var mc=$('#m-court'); if(mc)mc.value=entry.court;
    var mcs=$('#m-court-choice'); if(mcs)mcs.value=entry.court;
  }else if(ED&&ED.kind==='hearing'){
    ED.place=entry.court;
    var pl=$('#e-place'); if(pl)pl.value=entry.court;
    var cs=$('#e-court-choice'); if(cs)cs.value=entry.court;
  }
  return true;
}
function applyKnownCourtJudge(courtValue,editorMode){
  var c=commonCourtByValue(courtValue); if(!c||!c.judge)return false;
  if(editorMode==='matter'){
    if(MED)MED.judge=c.judge;
    var mj=$('#m-judge'); if(mj)mj.value=c.judge;
  }else if(ED&&ED.kind==='hearing'){
    ED.hearingJudge=c.judge;
    var hj=$('#e-hjudge'); if(hj)hj.value=c.judge;
    var js=$('#e-hjudge-choice'); if(js)js.value=c.judge;
  }
  return true;
}
function editTask(t,preset){
  ED = t ? JSON.parse(JSON.stringify(t))
    : Object.assign({ id:null,title:'',mid:'',note:'',due:'',time:'',place:'',pri:'mid',kind:'task',sourceDate:'',sourceTime:'',rule:'',ruleCode:'',ruleArticle:'',deadlineCode:'GPK',deadlineRuleId:'gpk-appeal',hearingClient:'',hearingNumber:'',hearingJudge:'',
        done:false,steps:[] }, preset||{});
  if(EDITOR_KINDS.indexOf(ED.kind)<0) ED.kind='task';
  syncHearingCourt(false);
  drawEditor();
}
function drawEditor(preserveScroll){
  var previousBody=$('#sheet .shbody');
  var previousScroll=(preserveScroll&&previousBody)?previousBody.scrollTop:0;
  var t = ED, isNew = !t.id, hearing=t.kind==='hearing', meeting=t.kind==='meeting', timedEvent=(t.kind==='hearing'||t.kind==='meeting');
  var opts = '<option value="">— без дела —</option>' + activeM().map(function(m){
    return '<option value="'+m.id+'"'+(t.mid===m.id?' selected':'')+'>'+esc(m.title)+'</option>'; }).join('');
  var kindIcons={task:'check',hearing:'cal',meeting:'user',deadline:'clock'};
  var kinds = EDITOR_KINDS.map(function(k){
    return '<button class="chip'+(t.kind===k?' on':'')+'" data-act="e-kind" data-v="'+k+'"><span class="editor-chip-icon">'+ico(kindIcons[k]||KIND[k].i,'s')+'</span><span>'+KIND[k].n+'</span></button>'; }).join('');
  var priIcons={high:'flag',mid:'check',low:'chev'};
  var pris = Object.keys(PRI).map(function(k){
    return '<button class="chip pri-'+k+(t.pri===k?' on':'')+'" data-act="e-pri" data-v="'+k+'"><span class="editor-chip-icon">'+ico(priIcons[k]||'flag','s')+'</span><span>'+PRI[k].n+'</span></button>'; }).join('');
  var quickDates = timedEvent ? [['0','Сегодня'],['1','Завтра'],['3','+3 дня'],['7','Неделя']] : [['0','Сегодня'],['1','Завтра'],['3','+3 дня'],['7','Неделя'],['','Без даты']];
  var title = hearing ? (isNew?'Новое заседание':'Редактирование заседания') : (meeting ? (isNew?'Новая встреча':'Редактирование встречи') : (t.kind==='deadline' ? (isNew?'Новый процессуальный срок':'Редактирование срока') : (isNew?'Новая задача':'Редактирование задачи')));
  var oldRuleParts=t.kind==='deadline'?inferDeadlineRuleParts(t):{code:'GPK',ruleId:''};
  if(t.kind==='deadline'){
    if(!t.deadlineCode)t.deadlineCode=oldRuleParts.code||'GPK';
    if(!t.deadlineRuleId)t.deadlineRuleId=oldRuleParts.ruleId||((legalDeadlineRules(t.deadlineCode)[0]||{}).id||'gpk-appeal');
    if(!t.sourceDate)t.sourceDate=t.due||today();
  }
  var deadlineRule=t.kind==='deadline'?legalDeadlineRule(t.deadlineRuleId):null;
  var deadlineRes=t.kind==='deadline'?calculateLegalDeadline(deadlineRule,t.sourceDate,t.sourceTime):null;

  openSheet(
  '<div class="task-editor-brand"><img src="scale-gold.png?v=4098" alt="Весы правосудия"><div><b>Ежедневник адвоката</b><small>Больше, чем календарь</small></div></div>'+
  '<div class="shhead task-editor-head"><button class="task-editor-back" data-act="close" aria-label="Назад">'+ico('left')+'</button><h2>'+title+'</h2><span class="task-editor-head-spacer"></span></div>'+
  '<div class="fld task-editor-type"><label>Тип</label><div class="chips task-kind-chips">'+kinds+'</div></div>'+
  (!hearing&&t.kind!=='deadline'?'<div class="fld task-editor-title-field"><label>'+(meeting?'Тема встречи':'Что нужно сделать')+'</label><input id="e-title" placeholder="'+(meeting?'Встреча с доверителем':'Подготовить апелляционную жалобу')+'" value="'+esc(t.title)+'" autocomplete="off"></div>':'')+
  '<div class="fld editor-select-field"><label>'+(hearing?'Дело (необязательно)':(meeting?'Дело / доверитель (необязательно)':'Дело / доверитель'))+'</label><select id="e-mid">'+opts+'</select></div>'+
  (hearing?'<div id="hearing-standalone" class="hearing-standalone"'+(t.mid?' style="display:none"':'')+'><div class="two hearing-party-grid"><div class="fld"><label>Доверитель / подзащитный</label><input id="e-hclient" placeholder="Фамилия или ФИО" value="'+esc(t.hearingClient||'')+'"></div><div class="fld"><label>№ дела / материала</label><input id="e-hnumber" placeholder="Например: 1-123/2026" value="'+esc(t.hearingNumber||'')+'"></div></div><div class="fld hearing-judge-field"><label>Судья / председательствующий</label>'+inlineChoiceField('e-hjudge','e-hjudge-choice',t.hearingJudge||'','Фамилия И.О.',judgeChoiceOptions(t.hearingJudge||'',t.place||''),'judge-options')+'<small class="fieldhint">Можно выбрать судью стрелкой справа или напечатать фамилию вручную. Для известного судьи суд подставится автоматически.</small>'+judgeDatalist(t.place||'')+'</div></div>':'')+
  (t.kind!=='deadline'?('<div class="two task-datetime'+(hearing?' hearing-datetime':'')+'">'+
    '<div class="fld"><label>Дата'+(timedEvent?' *':'')+'</label>'+premiumDateControl('e-due',t.due||'','Выберите дату')+'</div>'+
    '<div class="fld"><label>Время'+(timedEvent?' *':'')+'</label>'+premiumTimeControl('e-time',t.time||'',hearing?'hearing':'default','Выберите время')+'</div>'+
  '</div>'+
  '<div class="chips task-quick-dates">'+quickDates.map(function(x){
      return '<button class="chip" data-act="e-quick" data-v="'+x[0]+'">'+x[1]+'</button>'; }).join('')+'</div>'):'')+
  (!hearing&&!meeting&&t.kind!=='deadline'?'<div class="fld task-priority-field"><label>Приоритет</label><div class="chips task-priority-chips">'+pris+'</div></div>':'')+
  (hearing
    ? '<div class="fld hearing-court-field"><label>Суд / место заседания *</label>'+inlineChoiceField('e-place','e-court-choice',t.place||'','Суд или место заседания',courtChoiceOptions(t.place||''),'court-options')+'<small class="fieldhint">Можно выбрать Кинешемский городской суд или мировой участок стрелкой справа либо ввести любой другой суд вручную.</small>'+courtDatalist()+'</div>'
    : (meeting?'<div class="fld hearing-court-field"><label>Место встречи</label><input id="e-place" placeholder="Офис, СИЗО, адрес, кафе" value="'+esc(t.place||'')+'"></div>':''))+
  (t.kind==='deadline' ? '<div class="deadline-calculator">'+
    '<div class="deadline-calculator-title"><span>'+ico('clock','s')+'</span><div><b>Юридический калькулятор срока</b><small>Правила расчёта встроены по выбранной норме</small></div></div>'+
    '<div class="deadline-premium-status"><span class="deadline-premium-shield">'+ico('check','s')+'</span><div><b>'+legalDeadlineCount()+' процессуальных сроков</b><small>Правовая база проверена '+LEGAL_DEADLINE_REVIEWED+'</small></div><em>PRO</em></div>'+
    '<div class="two deadline-calc-grid"><div class="fld"><label>Производство / кодекс</label><select id="e-deadline-code">'+legalDeadlineCodeOptions(t.deadlineCode||'GPK')+'</select></div>'+
    '<div class="fld"><label>Что рассчитываем</label><select id="e-deadline-rule">'+legalDeadlineRuleOptions(t.deadlineCode||'GPK',t.deadlineRuleId)+'</select></div></div>'+
    '<div class="deadline-source-grid"><div class="fld deadline-source-field"><label id="e-source-label">'+esc(deadlineRule?deadlineRule.dateLabel:'Исходная дата')+'</label>'+premiumDateControl('e-source',t.sourceDate||today(),'Выберите исходную дату')+'</div>'+
    '<div id="e-source-time-wrap" class="fld deadline-source-time"'+(deadlineRule&&deadlineRule.requiresTime?'':' hidden')+'><label id="e-source-time-label">'+esc(deadlineRule&&deadlineRule.timeLabel?deadlineRule.timeLabel:'Точное время')+'</label>'+premiumTimeControl('e-source-time',t.sourceTime||'','default','Укажите время')+'<small class="fieldhint deadline-time-hint">Требуется только для специального срока, который исчисляется ровно в часах от момента получения.</small></div></div>'+
    '<div id="e-deadline-result">'+deadlineCalcResultHTML(deadlineRule,deadlineRes)+'</div>'+
    '<div class="deadline-calc-footnote">Расчёт учитывает режим конкретной нормы: рабочие и календарные дни, перенос окончания срока, обратные сроки, точный 24-часовой период и производственный календарь 2026. Для специальных норм всегда сверяйте событие, с которого начинается срок.</div>'+
    '</div>' : '')+
  '<div class="fld task-editor-note-field"><label>'+(hearing?'Примечание (необязательно)':(meeting?'Комментарий':'Примечание'))+'</label>'+
    '<textarea id="e-note" class="task-note-editor" rows="5" placeholder="'+(hearing?'Например: зал 3, взять оригиналы документов':(meeting?'Например: обсудить позицию, взять документы':'Нормы права, документы, что взять с собой…'))+'">'+esc(t.note||'')+'</textarea></div>'+
  '<button class="btn task-editor-save" data-act="e-save"><span class="save-icon">'+ico('save','s')+'</span>'+(hearing?'Сохранить заседание':(meeting?'Сохранить встречу':'Сохранить'))+'</button>'+
  (isNew?'':((hearing||meeting||t.kind==='deadline')?'<button class="btn ghost" data-act="ics-task" data-id="'+t.id+'" style="margin-top:8px">Добавить в календарь iPhone</button>':'')+
   '<button class="btn danger task-editor-delete" data-act="e-del">'+ico('trash','s')+'Удалить</button>'));
  $('#sheet').classList.add('task-editor-sheet');
  var editorSheet=$('#sheet'), editorBody=editorSheet&&editorSheet.querySelector('.shbody');
  if(editorSheet) editorSheet.scrollLeft=0;
  if(editorBody){
    editorBody.scrollLeft=0;
    if(preserveScroll){
      var restoreScroll=function(){
        var body=$('#sheet .shbody');
        if(!body)return;
        var max=Math.max(0,body.scrollHeight-body.clientHeight);
        body.scrollTop=Math.min(previousScroll,max);
      };
      requestAnimationFrame(function(){restoreScroll();requestAnimationFrame(restoreScroll);});
      setTimeout(restoreScroll,80);
    }
  }
  if(isNew && !hearing && !preserveScroll) setTimeout(function(){ var e=$('#e-title'); if(e) e.focus({preventScroll:true}); },340);
}
function pullEditor(){
  var g = function(id){ var e = $(id); return e ? e.value : undefined; };
  if(g('#e-title')!==undefined) ED.title = $('#e-title').value.trim();
  if(g('#e-mid')!==undefined) ED.mid = $('#e-mid').value;
  if(g('#e-due')!==undefined) ED.due = $('#e-due').value;
  if(g('#e-time')!==undefined) ED.time = $('#e-time').value;
  if(g('#e-place')!==undefined) ED.place = $('#e-place').value.trim();
  if(g('#e-hclient')!==undefined) ED.hearingClient = $('#e-hclient').value.trim();
  if(g('#e-hnumber')!==undefined) ED.hearingNumber = $('#e-hnumber').value.trim();
  if(g('#e-hjudge')!==undefined) ED.hearingJudge = $('#e-hjudge').value.trim();
  if(g('#e-source')!==undefined) ED.sourceDate = $('#e-source').value;
  if(g('#e-source-time')!==undefined) ED.sourceTime = $('#e-source-time').value;
  if(g('#e-deadline-code')!==undefined) ED.deadlineCode = $('#e-deadline-code').value;
  if(g('#e-deadline-rule')!==undefined) ED.deadlineRuleId = $('#e-deadline-rule').value;
  if(ED.kind==='deadline'){
    var dr=legalDeadlineRule(ED.deadlineRuleId),dres=calculateLegalDeadline(dr,ED.sourceDate,ED.sourceTime);
    if(dr){ED.title=dr.name;ED.ruleCode=legalDeadlineCode(dr.code).name;ED.ruleArticle=dr.article;ED.rule=dr.article;ED.pri='high';}
    if(dres){ED.due=dres.end;ED.time=dres.endTime||'';}
  }
  if(g('#e-note')!==undefined) ED.note = $('#e-note').value.trim();
}
function saveTask(){
  pullEditor();
  var hearing=ED.kind==='hearing', meeting=ED.kind==='meeting';
  if(hearing){
    if(!ED.due){ toast('Укажите дату заседания'); openPremiumDatePicker('e-due',''); return; }
    if(!ED.time){ toast('Укажите время заседания'); openPremiumTimePicker('e-time','','hearing'); return; }
    if(!isHearingTime(ED.time)){ toast('Время заседания: с 08:00 до 18:00'); openPremiumTimePicker('e-time',ED.time,'hearing'); return; }
    if(!ED.place) syncHearingCourt(false);
    if(!ED.place){ toast('Укажите суд / место заседания'); var pe=$('#e-place'); if(pe)pe.focus(); return; }
    ED.title='Судебное заседание'; ED.pri='mid'; ED.steps=[];
  }else if(meeting){
    if(!ED.title){ toast('Введите тему встречи'); var me=$('#e-title'); if(me) me.focus(); return; }
    if(!ED.due){ toast('Укажите дату встречи'); openPremiumDatePicker('e-due',''); return; }
    if(!ED.time){ toast('Укажите время встречи'); openPremiumTimePicker('e-time','','default'); return; }
    ED.pri='mid'; ED.steps=[];
  }else if(ED.kind==='deadline'){
    var dc=applyDeadlineRuleFromDom();
    if(!dc||!dc.rule){toast('Выберите процессуальное действие');return;}
    if(!ED.sourceDate){toast('Укажите исходную дату');var se=$('#e-source');if(se)se.focus();return;}
    if(dc.rule.requiresTime&&!ED.sourceTime){toast('Укажите точное время получения');var ste=$('#e-source-time');if(ste)ste.focus();return;}
    if(!dc.res){toast('Не удалось рассчитать срок');return;}
    ED.due=dc.res.end;ED.title=dc.rule.name;ED.rule=dc.rule.article;ED.ruleCode=legalDeadlineCode(dc.rule.code).name;ED.ruleArticle=dc.rule.article;ED.pri='high';ED.time=dc.res.endTime||'';ED.steps=[];
  }else if(!ED.title){ toast('Введите текст задачи'); var e=$('#e-title'); if(e) e.focus(); return; }
  var isNew=!ED.id;
  if(ED.id){
    var t = S.tasks.filter(function(x){ return x.id===ED.id; })[0]; Object.assign(t, ED);
  } else {
    ED.id=uid();ED.created=new Date().toISOString();ED.done=false;S.tasks.unshift(ED);
  }
  if(ED.mid && (isNew || ED.kind==='hearing' || ED.kind==='meeting' || ED.kind==='deadline')){
    var label='';
    if(ED.kind==='hearing') label='Назначено заседание'+(ED.due?' — '+fmtD(ED.due,true):'')+(ED.time?' в '+ED.time:'')+(ED.place?' · '+ED.place:'');
    else if(ED.kind==='meeting') label='Назначена встреча: '+ED.title+(ED.due?' — '+fmtD(ED.due,true):'')+(ED.time?' в '+ED.time:'')+(ED.place?' · '+ED.place:'');
    else if(ED.kind==='deadline') label='Поставлен процессуальный срок: '+ED.title+(ED.due?' — '+fmtD(ED.due,true):'')+(ED.time?' в '+ED.time:'');
    else label='Добавлена задача: '+ED.title+(ED.due?' — '+fmtD(ED.due,true):'');
    addJournal(ED.mid,label,today(),'task',true);
  }
  save();closeSheet();render();if($('#page').classList.contains('open')&&$('#page')._mid)openMatter($('#page')._mid);toast(hearing?'Заседание сохранено':(meeting?'Встреча сохранена':'Сохранено'));schedule();
}

/* =====================================================================
   MATTER PAGE
   ===================================================================== */
var MED = null;

function matterFieldCard(i,l,v,opts){
  if(!v) return '';
  opts=opts||{};
  var cls='matter-field-card'+(opts.wide?' wide':'');
  var body='<span class="matter-field-icon">'+ico(i)+'</span><span class="matter-field-copy"><small>'+esc(l)+'</small><b>'+esc(v)+'</b></span>'+(opts.chev?ico('chev','s'):'');
  if(opts.href) return '<a class="'+cls+'" href="'+opts.href+'" style="text-decoration:none;color:inherit">'+body+'</a>';
  return '<div class="'+cls+'">'+body+'</div>';
}
function matterNoteCard(text){
  return text?'<div class="matter-note-card"><small>Рабочая заметка</small><p>'+esc(text)+'</p></div>':'';
}

function matterPanelRow(i,l,v,opts){
  if(!v) return '';
  opts=opts||{};
  var tail='';
  if(opts.href) tail='<a class="matter-panel-tail" href="'+opts.href+'">'+ico('chev','s')+'</a>';
  else if(opts.chev) tail='<span class="matter-panel-tail">'+ico('chev','s')+'</span>';
  return '<div class="matter-panel-row">'+
    '<span class="matter-panel-icon">'+ico(i)+'</span>'+
    '<div class="matter-panel-copy"><small>'+esc(l)+'</small><b>'+esc(v)+'</b></div>'+
    tail+
  '</div>';
}
function matterPremiumBadge(kind,label){
  return '<span class="matter-pill '+kind+'">'+esc(label)+'</span>';
}
function matterPremiumTaskRow(t,m){
  var title=t.kind==='hearing'?(t.title||'Судебное заседание'):(t.title||'Без названия');
  var subtitle='';
  if(t.kind==='hearing') subtitle=[hearingPlace(t).replace(/<br>/g,' · '), hearingJudgeName(t,m), hearingClientName(t,m)].filter(Boolean).join(' · ');
  else if(t.kind==='meeting') subtitle=t.place||'Встреча';
  else if(t.kind==='deadline') subtitle=t.ruleCode||t.rule||'Процессуальный срок';
  else subtitle=(m&&m.number)?('По делу № '+m.number):(m&&m.client?m.client:'');
  var dateBadge='';
  if(t.due){
    var d=dd(t.due), held=meetingOccurred(t), dateLabel=held?'состоялась':(d<0?'просрочено':(d===0?'сегодня':(d===1?'завтра':fmtShort(t.due))));
    dateBadge=matterPremiumBadge('date '+(held?'held':(d<0?'overdue':(d===0?'today':''))),dateLabel);
  }
  var kindLabel='';
  if(t.kind==='hearing') kindLabel=matterPremiumBadge('hearing','Заседание');
  else if(t.kind==='meeting') kindLabel=matterPremiumBadge('meeting'+(meetingOccurred(t)?' held':''),meetingOccurred(t)?'Состоялась':'Встреча');
  else if(t.kind==='deadline') kindLabel=matterPremiumBadge('deadline','Срок');
  else kindLabel=matterPremiumBadge('task','Задача');
  var lead=t.kind==='hearing'
    ? '<span class="matter-event-check icon">'+ico(hearingHasResult(t)?'check':'gavel','s')+'</span>'
    : (meetingOccurred(t)
        ? '<span class="matter-event-check done meeting-held">'+ico('check','s')+'</span>'
        : '<button class="matter-event-check'+(t.done?' done':'')+'" data-act="toggle" data-id="'+t.id+'">'+ico('check','s')+'</button>');
  return '<div class="matter-event-card'+(t.done?' done':'')+(t.kind==='hearing'?' hearing':'')+(t.kind==='meeting'?' meeting':'')+(t.kind==='deadline'?' deadline':'')+'">'+
    lead+
    '<div class="matter-event-main"><button class="matter-event-open" data-act="'+(hearingNeedsResult(t)?'hearing-result':'task')+'" data-id="'+t.id+'"><b>'+esc(title)+'</b>'+
    (subtitle?'<small>'+esc(subtitle)+'</small>':'')+'</button></div>'+
    '<div class="matter-event-side">'+(t.time?'<em class="matter-event-time mono">'+esc(t.time)+'</em>':'')+'<div class="matter-event-badges">'+kindLabel+dateBadge+'</div></div>'+
    '<span class="matter-event-chevron">'+ico('chev','s')+'</span>'+
  '</div>';
}
function matterJournalRow(j){
  return '<div class="matter-jline"><i></i><div class="matter-jcopy"><b>'+fmtD(j.date||today(),true)+'</b><p>'+esc(j.text)+'</p></div><button class="matter-jdel" data-act="journal-del" data-id="'+j.id+'">'+ico('trash','s')+'</button></div>';
}


function matterStatusText(m){
  if(!m) return 'В производстве';
  if(m.archived) return 'Архив';
  if(m.stage==='Завершено') return 'Завершено';
  return 'В производстве';
}
function matterStatusClass(m){
  if(!m) return 'green';
  if(m.archived) return 'slate';
  if(m.stage==='Завершено') return 'blue';
  if(m.stage==='Апелляция' || m.stage==='Кассация' || m.stage==='Надзор') return 'blue';
  return 'green';
}
function matterDisplayTitle(m){
  return esc(m.number||m.title||'Карточка дела');
}
function matterDisplaySubtitle(m){
  if(m.number && m.title && m.title!==m.number) return esc(m.title);
  return esc([matterType(m).n,matterBasisLabel(m.basis),m.stage].filter(Boolean).join(' · ') || 'Карточка дела');
}
function matterSegment(label,count,active,target,disabled){
  return '<button type="button" class="matter-detail-seg'+(active?' on':'')+'"'+(disabled?' disabled aria-disabled="true"':' data-act="matter-jump" data-v="'+esc(target||'matter-detail-top')+'"')+'>'+esc(label)+(count>0?'<em>'+count+'</em>':'')+'</button>';
}
function matterNextHearingCard(t,m){
  if(!t) return '';
  var needs=t.kind==='hearing'&&hearingNeedsResult(t);
  var title=needs?'Требуется результат заседания':(t.kind==='meeting'?'Ближайшая встреча':'Следующее заседание');
  var place=t.kind==='hearing' ? hearingPlace(t).replace(/<br>/g,' · ') : (t.place||'');
  var judge=t.kind==='hearing' ? hearingJudgeName(t,m) : '';
  var subtitle=[place,judge].filter(Boolean).join(' · ');
  return '<button class="matter-next-card'+(needs?' needs-result':'')+'" data-act="'+(needs?'hearing-result':'task')+'" data-id="'+t.id+'">'+
    '<span class="matter-next-icon">'+ico(needs?'gavel':(t.kind==='meeting'?'user':'cal'),'s')+'</span>'+ 
    '<span class="matter-next-copy"><small>'+title+'</small><b>'+fmtD(t.due,true)+(t.time?', '+esc(t.time):'')+'</b>'+(subtitle?'<span>'+esc(subtitle)+'</span>':'')+'</span>'+ 
    '<span class="matter-next-tail">'+ico('chev','s')+'</span>'+ 
  '</button>';
}
function matterCompactDeadlineRow(t){
  var days=typeof dd==='function'&&t.due?dd(t.due):null;
  var label=days===null?'':(days<0?'просрочено':days===0?'сегодня':days===1?'1 день':String(days)+' дней');
  return '<button class="matter-deadline-row" data-act="task" data-id="'+t.id+'">'+
    '<span class="matter-deadline-dot '+(days!==null&&days<0?'overdue':'')+'"></span>'+
    '<span class="matter-deadline-copy"><b>'+esc(t.title||'Процессуальный срок')+'</b><small>'+esc(fmtD(t.due,true)+(t.ruleArticle?' · '+t.ruleArticle:''))+'</small></span>'+
    (label?'<span class="matter-deadline-tag '+(days!==null&&days<0?'overdue':'')+'">'+esc(label)+'</span>':'')+
  '</button>';
}
function sheetMatterMore(id){
  var m=matter(id); if(!m) return;
  function row(act, tone, icon, title, subtitle, extraCls){
    return '<button type="button" class="matter-act-row '+(extraCls||'')+'" style="--tone:'+tone+'" data-act="'+act+'" data-id="'+id+'">'+
      '<span class="matter-act-ico">'+ico(icon)+'</span>'+
      '<span class="matter-act-copy"><b>'+title+'</b><small>'+subtitle+'</small></span>'+
      '<span class="matter-act-tail">'+ico('chev','s')+'</span>'+
    '</button>';
  }
  var archiveTitle = m.archived ? 'Вернуть в работу' : 'Отправить в архив';
  var archiveSub = m.archived ? 'Снова показать дело в активном списке' : 'Скрыть дело из активного списка';
  var rows='';
  if(!m.archived){
    rows+=row('m-hearing','#4E8FF2','cal','Заседание','Назначить судебное заседание')+
      row('m-deadline','#D5A13D','clock','Процессуальный срок','Добавить контролируемый срок');
  }
  rows+=row('m-journal','#4AA89B','doc','Запись в журнал','Зафиксировать действие по делу')+
    row('m-edit','#728FB0','edit','Изменить карточку','Отредактировать реквизиты дела')+
    row('m-print','#C89A3F','share','Экспорт / печать','Подготовить сводку по делу')+
    row('m-arch','#8197AF','arch',archiveTitle,archiveSub)+
    row('m-del','#E06161','trash','Удалить дело','Связанные записи также будут удалены','danger');
  openSheet(
    '<div class="matter-actions-head">'+
      '<div class="matter-actions-head-icon">'+ico('brief')+'</div>'+
      '<div class="matter-actions-head-copy"><small>управление делом</small><h2>Действия по делу</h2><p>'+esc(matterDisplayTitle(m))+'</p></div>'+
    '</div>'+
    '<div class="matter-actions-card">'+rows+'</div>'
  );
  $('#sheet').classList.add('matter-actions-premium');
}

function openMatter(id){
  var m = matter(id); if(!m){ closeAll(); return; }
  var ts = tasksOf(id).sort(sortT);
  var open = ts.filter(isActiveRecord);
  var done = ts.filter(function(t){ return t.done || meetingOccurred(t); });
  var activeDeadlines = open.filter(function(t){ return t.kind==='deadline'; });
  var activeFlow = open.filter(function(t){ return t.kind!=='deadline'; });
  var hearings = open.filter(function(t){ return t.kind==='hearing' || t.kind==='meeting'; }).sort(sortT);
  var nextEvent = hearings[0] || null;
  var js = journalOf(id).slice().sort(function(a,b){ return (a.date||'')<(b.date||'')?1:-1; });
  var dossier = matterDossierRows(m);
  var noteRow = dossier.filter(function(r){ return r[1]==='Суть / рабочая заметка'; })[0] || null;
  var mainRows = dossier.filter(function(r){ return r[1]!=='Суть / рабочая заметка'; });

  openPage(
  '<div class="shhead matter-headerbar matter-headerbar-project"><button class="iconbtn" data-act="close">'+ico('left')+'</button>'+
    '<div class="matter-header-brand">Карточка дела</div>'+
    '<div class="matter-header-actions"><button class="iconbtn" data-act="m-print">'+ico('share')+'</button><button class="iconbtn" data-act="m-edit">'+ico('edit')+'</button></div></div>'+
  '<div class="matter-detail-shell matter-detail-shell-project">'+
    '<div class="matter-project-topcard" id="matter-detail-top">'+
      '<div class="matter-project-topline"><div class="matter-project-headcopy"><h1>'+matterDisplayTitle(m)+'</h1><p>'+matterDisplaySubtitle(m)+'</p></div><span class="matter-project-status '+matterStatusClass(m)+'">'+esc(matterStatusText(m))+'</span></div>'+
      '<div class="matter-project-tabs">'+
        matterSegment('Общее',0,true,'matter-detail-top',false)+
        matterSegment('Сроки',activeDeadlines.length,false,'matter-sec-deadlines',!activeDeadlines.length)+
        matterSegment('Задачи',activeFlow.length,false,'matter-sec-flow',false)+
        matterSegment('Журнал',js.length,false,'matter-sec-journal',false)+
      '</div>'+
    '</div>'+
    (mainRows.length?'<div class="matter-dossier-panel matter-dossier-panel-project">'+mainRows.map(function(r){ return matterPanelRow(r[0],r[1],r[2],{chev:false}); }).join('')+'</div>':'')+
    matterNextHearingCard(nextEvent,m)+
    (activeDeadlines.length?'<div class="matter-premium-section" id="matter-sec-deadlines"><div class="matter-premium-section-head"><h2>Процессуальные сроки</h2>'+(m.archived?'<span class="matter-section-link static">'+activeDeadlines.length+'</span>':'<button class="matter-section-link" data-act="m-deadline" data-id="'+id+'">Добавить</button>')+'</div><div class="matter-deadline-list">'+activeDeadlines.slice(0,6).map(matterCompactDeadlineRow).join('')+'</div></div>':'')+
    '<div class="matter-premium-section" id="matter-sec-flow"><div class="matter-premium-section-head"><h2>Задачи и события</h2>'+(m.archived?'<span class="matter-section-link static">'+activeFlow.length+'</span>':'<button class="matter-section-link" data-act="m-add" data-id="'+id+'">'+activeFlow.length+'</button>')+'</div>'+
      (activeFlow.length?'<div class="matter-events-list matter-events-list-compact">'+activeFlow.map(function(t){ return matterPremiumTaskRow(t,m); }).join('')+'</div>':'<div class="card"><div class="hint">Добавьте по делу первую задачу, заседание или встречу.</div></div>')+
    '</div>'+
    '<div class="matter-premium-section" id="matter-sec-journal"><div class="matter-premium-section-head"><h2>Недавние действия</h2><button class="matter-section-link" data-act="m-journal" data-id="'+id+'">Новая запись</button></div>'+
      (js.length?'<div class="matter-journal-list matter-journal-list-card">'+js.slice(0,8).map(matterJournalRow).join('')+'</div>':'<div class="hint">Записи журнала помогут быстро восстановить ход работы по делу.</div>')+
    '</div>'+
    (noteRow&&noteRow[2]?matterNoteCard(noteRow[2]):'')+
    (done.length?'<div class="matter-premium-section"><div class="matter-premium-section-head"><h2>Выполнено</h2><span class="matter-section-link static">'+done.length+'</span></div><div class="matter-events-list matter-events-list-compact done-list">'+done.slice(0,4).map(function(t){ return matterPremiumTaskRow(t,m); }).join('')+'</div></div>':'')+
    '<div class="matter-bottom-actions">'+
      (m.archived
        ? '<button class="matter-bottom-btn primary" data-act="m-arch" data-id="'+id+'">'+ico('arch','s')+' <span>Вернуть в работу</span></button>'
        : '<button class="matter-bottom-btn primary" data-act="m-add" data-id="'+id+'">'+ico('plus','s')+' <span>Добавить задачу</span></button>')+
      '<button class="matter-bottom-btn" data-act="m-moremenu" data-id="'+id+'">'+ico('more','s')+' <span>Ещё действия</span></button>'+
    '</div>'+
    '<div style="height:18px"></div>'+
  '</div>');
  $('#page')._mid=id; $('#page')._navType='matter';
}
function infoRow(i,l,v){ return '<div class="row">'+ico(i)+'<span class="rl">'+l+'<small>'+esc(v)+'</small></span></div>'; }

function editMatter(m){
  MED = m ? clone(m) : {id:null,title:'',type:'civil',basis:'agreement',client:'',phone:'',number:'',court:'',judge:'',investigator:'',article:'',role:'',restraint:'',opponent:'',stage:'Первая инстанция',executionIssue:'',executionInstitution:'',dayRate:'',notes:'',archived:false};
  MED = sanitizeMatterByType(MED);
  if(!MATTER_BASIS[MED.basis]) MED.basis='agreement';
  openSheet(
  '<h2>'+(m?'Изменить досье':'Новое дело')+'</h2><p class="sh-sub">Основная карточка доверителя и производства.</p>'+
  '<div class="fld"><label>Тип производства</label><select id="m-type">'+((MED.type==='other')?'<option value="other" selected disabled>Иное (старое дело — выберите новый тип)</option>':'')+MATTER_TYPE_KEYS.map(function(k){return '<option value="'+k+'"'+(MED.type===k?' selected':'')+'>'+MATTER_TYPES[k].n+'</option>';}).join('')+'</select></div>'+
  '<div class="fld"><label>Основание ведения *</label><select id="m-basis">'+Object.keys(MATTER_BASIS).map(function(k){return '<option value="'+k+'"'+(MED.basis===k?' selected':'')+'>'+MATTER_BASIS[k].n+'</option>';}).join('')+'</select></div>'+
  '<div id="matter-dynamic"></div>'+
  '<button class="btn" data-act="m-save">Сохранить</button>');
  $('#sheet').classList.add('matter-editor-sheet');
  renderMatterDynamic();
  setTimeout(function(){ if(!m){ var e=$('#m-client'); if(e)e.focus(); } },340);
}
function saveMatter(){
  pullMatterDraft();
  if(!MED||!MATTER_BASIS[MED.basis]){toast('Выберите основание ведения');return;}
  if(MED.type==='criminal'&&MED.stage==='Исполнение приговора'&&!MED.executionIssue){toast('Выберите вопрос исполнения приговора');return;}
  var notes=(($('#m-notes')&&$('#m-notes').value)||MED.notes||'').trim();
  var o={title:'',type:MED.type||'other',basis:MED.basis,client:MED.client||'',phone:MED.phone||'',number:MED.number||'',stage:MED.stage||'',executionIssue:MED.executionIssue||'',executionInstitution:MED.executionInstitution||'',court:MED.court||'',judge:MED.judge||'',investigator:MED.investigator||'',article:MED.article||'',role:MED.role||'',restraint:MED.restraint||'',opponent:MED.opponent||'',dayRate:+MED.dayRate||0,notes:notes};
  o=sanitizeMatterByType(o);
  o.title=matterAutoTitle(o);
  var wasNew=!MED.id;
  if(MED.id) Object.assign(matter(MED.id),o); else {o.id=uid();o.archived=false;o.created=new Date().toISOString();S.matters.unshift(o);MED.id=o.id;}
  addJournal(MED.id,wasNew?'Досье создано':'Досье обновлено',today(),'system',true);
  save(); closeSheet(); if($('#page').classList.contains('open'))openMatter(MED.id); render(); toast('Дело сохранено');
}

function addJournal(mid,text,date,type,silent){
  if(!mid||!text)return; S.journal.unshift({id:uid(),mid:mid,date:date||today(),text:text,type:type||'note',created:new Date().toISOString()}); if(!silent)save();
}
function sheetJournal(mid){
  openSheet(premiumHead('doc','Запись в журнал дела','Краткая хронология работы и процессуальных событий.')+
    (!mid?'<div class="fld"><label>Дело</label><select id="j-mid-select"><option value="">— выбрать дело —</option>'+activeM().map(function(m){return '<option value="'+m.id+'">'+esc(m.title)+'</option>';}).join('')+'</select></div>':'')+
    '<div class="fld"><label>Дата</label>'+premiumDateControl('j-date',today(),'Выберите дату')+'</div>'+
    '<div class="fld"><label>Событие / заметка</label><textarea id="j-text" rows="5" placeholder="Подано ходатайство, получены документы, заседание перенесено…"></textarea></div>'+
    '<input type="hidden" id="j-mid" value="'+esc(mid)+'"><button class="btn" data-act="j-save">Добавить в журнал</button>');
  $('#sheet').classList.add('sheet-premium-form');
}
function sheetParticipation(mid){
  var m=mid?matter(mid):null;
  openSheet('<h2>День участия</h2><p class="sh-sub">Любое фактическое участие считается как 1 день, даже если оно длилось несколько минут.</p>'+
    '<div class="two"><div class="fld"><label>Дата</label>'+premiumDateControl('pt-date',today(),'Выберите дату')+'</div><div class="fld"><label>Вид участия</label><select id="pt-kind">'+Object.keys(PART_KINDS).map(function(k){return '<option value="'+k+'">'+PART_KINDS[k]+'</option>';}).join('')+'</select></div></div>'+
    '<div class="fld"><label>Дело</label><select id="pt-mid"><option value="">— выбрать дело —</option>'+activeM().map(function(x){return '<option value="'+x.id+'"'+(mid===x.id?' selected':'')+'>'+esc(x.title)+'</option>';}).join('')+'</select></div>'+
    '<div class="fld"><label>Место / орган</label><input id="pt-place" value="'+esc((m&&m.court)||'')+'" placeholder="Суд, СИЗО, следственный отдел…"></div>'+
    '<div class="fld"><label>Что было</label><input id="pt-desc" placeholder="Заседание, допрос, ознакомление, выезд…"></div>'+
    '<div class="fld"><label>Ставка за этот день, '+esc(S.settings.cur)+'</label><input id="pt-rate" type="number" inputmode="numeric" value="'+esc((m&&m.dayRate)||S.settings.dayRate||'')+'"></div>'+
    '<div class="hint">Если по одному делу в одну дату запись уже есть, приложение не создаст второй оплачиваемый день.</div><button class="btn" data-act="pt-save">Записать день участия</button>');
}

/* =====================================================================
   ШАБЛОНЫ ЧЕК-ЛИСТОВ
   ===================================================================== */
var TPL = [
 { n:'Первичная консультация', i:'user', items:[
   ['Уточнить существо обращения и цель доверителя',0],
   ['Запросить документы и доказательства',1],
   ['Проверить сроки исковой давности',1],
   ['Оценить судебную перспективу',2],
   ['Подготовить и подписать соглашение об оказании юрпомощи',3],
   ['Выписать ордер / оформить доверенность',3]]},
 { n:'Иск в суд общей юрисдикции', i:'doc', items:[
   ['Рассчитать цену иска и госпошлину',1],
   ['Собрать доказательства, заверить копии',3],
   ['Составить исковое заявление',5],
   ['Направить копии иска сторонам, сохранить квитанции',6],
   ['Оплатить госпошлину, приложить платёжку',6],
   ['Подать иск (канцелярия / ГАС «Правосудие»)',7],
   ['Отследить принятие иска и дату заседания',12]]},
 { n:'Арбитражный иск', i:'gavel', items:[
   ['Направить претензию, дождаться 30 дней',1],
   ['Выписка из ЕГРЮЛ на ответчика (не старше 30 дней)',2],
   ['Расчёт долга, неустойки, процентов ст. 395 ГК',3],
   ['Составить исковое заявление',5],
   ['Направить иск сторонам заказным с уведомлением',6],
   ['Госпошлина, подача через «Мой арбитр»',7],
   ['Проверить карточку дела в КАД',10]]},
 { n:'Подготовка к заседанию', i:'gavel', items:[
   ['Изучить материалы дела, сделать выписки',0],
   ['Подготовить правовую позицию и тезисы выступления',1],
   ['Подготовить вопросы свидетелям / оппоненту',1],
   ['Проверить наличие ордера, удостоверения, доверенности',2],
   ['Подготовить ходатайства (об истребовании, экспертизе)',2],
   ['Согласовать позицию с доверителем',2]]},
 { n:'Апелляционная жалоба', i:'flag', items:[
   ['Получить мотивированное решение суда',0],
   ['Проанализировать решение, выявить нарушения',2],
   ['Составить апелляционную жалобу',5],
   ['Оплатить госпошлину',6],
   ['Направить копии лицам, участвующим в деле',6],
   ['Подать жалобу через суд первой инстанции',7]]},
 { n:'Уголовное дело — вступление', i:'lock', items:[
   ['Заключить соглашение, выписать ордер',0],
   ['Ознакомиться с постановлением о возбуждении дела',1],
   ['Свидание с подзащитным, согласование позиции',1],
   ['Заявить ходатайство об ознакомлении с материалами',2],
   ['Проверить законность задержания / меры пресечения',2],
   ['Подготовить ходатайства и жалобы (ст. 125 УПК)',4]]},
 { n:'Исполнительное производство', i:'money', items:[
   ['Получить исполнительный лист',0],
   ['Заявление о возбуждении ИП в ФССП',2],
   ['Запрос об имуществе и счетах должника',5],
   ['Контроль действий пристава, ознакомление с ИП',14],
   ['При бездействии — жалоба старшему приставу',21]]},
 { n:'Завершение дела', i:'arch', items:[
   ['Получить и передать доверителю итоговые документы',0],
   ['Подписать акт выполненных работ',2],
   ['Выставить и проконтролировать оплату',3],
   ['Сформировать адвокатское досье, сдать в архив',5]]},
 { n:'КАС — административный иск', i:'doc', items:[
   ['Проверить подсудность и административного ответчика',0],
   ['Проверить срок обращения в суд',0],
   ['Собрать оспариваемые решения, ответы и доказательства',2],
   ['Сформулировать предмет и основания административного иска',3],
   ['Подготовить административное исковое заявление',5],
   ['Направить копии участникам и подготовить подтверждения',6],
   ['Подать административный иск и отследить принятие',7]]},
 { n:'Ст. 81 УК РФ — освобождение по болезни', i:'lock', items:[
   ['Собрать медицинские документы и актуальные заключения',0],
   ['Сверить диагнозы и функциональные нарушения с ПП РФ № 54',1],
   ['Проверить состав и процедуру медицинского освидетельствования',1],
   ['Подготовить ходатайство и приложения',3],
   ['Подготовить вопросы врачу / специалисту',4],
   ['Подготовить позицию к судебному заседанию',5],
   ['При отказе — получить постановление и рассчитать срок обжалования',7]]},
 { n:'УДО — подготовка', i:'flag', items:[
   ['Проверить фактически отбытый срок и право на обращение',0],
   ['Получить характеристику и сведения о поощрениях / взысканиях',2],
   ['Собрать документы о семье, жилье и трудоустройстве',3],
   ['Подготовить ходатайство об УДО и приложения',5],
   ['Подготовить осужденного к вопросам суда',6],
   ['Проверить извещение потерпевшего и позицию учреждения',7]]},
 { n:'Допрос / очная ставка — защита', i:'user', items:[
   ['Согласовать позицию и допустимый объём показаний',0],
   ['Подготовить краткий свободный рассказ',0],
   ['Составить вероятные вопросы следствия / суда и ответы',1],
   ['Определить вопросы другому участнику',1],
   ['Проверить противоречия с прежними показаниями',1],
   ['Обсудить основания для использования ст. 51 Конституции РФ',1]]}
];
function sheetTemplates(mid){
  openSheet('<h2>Шаблоны чек-листов</h2><p class="sh-sub">Готовый набор задач со сроками — один тап, и план работы по делу составлен.</p>'+
    (mid?'':'<div class="hint">Задачи добавятся без привязки к делу. Чтобы привязать — откройте карточку дела и нажмите «Шаблон».</div>')+
    '<div class="card" style="padding:0 16px">'+TPL.map(function(t,i){
      return '<button class="row" data-act="tpl-use" data-v="'+i+'" data-id="'+(mid||'')+'">'+ico(t.i)+
        '<span class="rl">'+t.n+'<small>'+t.items.length+' задач</small></span>'+ico('chev','s')+'</button>'; }).join('')+'</div>');
}
function applyTpl(i,mid){
  var t = TPL[i];
  t.items.forEach(function(it,k){
    S.tasks.push({ id:uid(), title:it[0], mid:mid||'', due:addD(today(),it[1]), time:'',
      pri: it[1]<=1?'high':it[1]<=5?'mid':'low', kind:'task', note:'', steps:[], done:false,
      created:new Date().toISOString(), tpl:t.n });
  });
  save(); closeSheet();
  if($('#page').classList.contains('open') && mid) openMatter(mid);
  render(); toast('Добавлено задач: '+t.items.length);
}

/* =====================================================================
   КАЛЬКУЛЯТОР СРОКОВ
   ===================================================================== */
function sheetDeadline(mid){
  editTask(null,{kind:'deadline',mid:mid||'',sourceDate:today(),deadlineCode:'GPK',deadlineRuleId:'gpk-appeal',pri:'high'});
}

/* =====================================================================
   УЧАСТИЕ / БЫСТРЫЕ ДЕЙСТВИЯ / ПОИСК / КАЛЕНДАРЬ IPHONE
   ===================================================================== */
function sheetParticipationLog(){
  var logs=S.participation.slice().sort(function(a,b){return a.date<b.date?1:-1;});
  var sum=logs.reduce(function(a,e){var m=matter(e.mid);return a+(+e.rate||+(m&&m.dayRate)||+S.settings.dayRate||0);},0);
  openSheet('<h2>Дни участия</h2><p class="sh-sub">Всего '+logs.length+' '+plural(logs.length,'день','дня','дней')+' · '+money(sum)+'</p>'+
    '<button class="btn" data-act="pt-new" style="margin-bottom:14px">Добавить день участия</button>'+
    (logs.length?'<div class="card pad0">'+logs.slice(0,50).map(function(e){var m=matter(e.mid);return '<div class="row">'+ico('gavel')+'<span class="rl">'+esc(PART_KINDS[e.kind]||'Участие')+'<small>'+fmtD(e.date,true)+(m?' · '+esc(m.title):'')+(e.place?' · '+esc(e.place):'')+'</small></span><button data-act="part-del" data-id="'+e.id+'">'+ico('trash','s')+'</button></div>';}).join('')+'</div>':empty('gavel','Участий пока нет','Добавьте судебное заседание, следственное действие, выезд или другое фактическое участие.')));
}

function sheetQuickAdd(){
  openSheet('<div class="quickintro">'+premiumHead('plus','Быстрая запись','Добавьте нужное действие без перехода по разделам.')+'</div><div class="quickgrid quickgrid-core">'+
    quickItem('gavel','Заседание','qa-hearing','blue')+
    quickItem('user','Встреча','qa-meeting','purple')+
    quickItem('flag','Процессуальный срок','qa-deadline','red')+
    quickItem('check','Задача','qa-task','green')+
    quickItem('doc','Запись в журнал','qa-journal','gold')+
  '</div>');
  $('#sheet').classList.add('quick-sheet');
}
function quickItem(i,t,act,tone){return '<button class="quickitem q-'+(tone||'slate')+'" data-act="'+act+'"><span class="qico">'+ico(i,'l')+'</span><b>'+t+'</b></button>';}
function premiumHead(icon,title,sub){return '<div class="filter-premium-head"><span class="filter-premium-head-icon">'+ico(icon)+'</span><div><h2>'+title+'</h2><p>'+sub+'</p></div></div>'; }

var GQ='';
function globalSearchData(q){
  q=(q||'').trim().toLowerCase(); if(!q)return {m:[],t:[],j:[]};
  function has(x){return String(x||'').toLowerCase().indexOf(q)>=0;}
  var ms=S.matters.filter(function(m){return [m.title,m.client,m.phone,m.number,m.court,m.judge,m.investigator,m.article,m.role,m.notes].some(has);}).slice(0,8);
  var ts=S.tasks.filter(function(t){var m=t.mid?matter(t.mid):null;return [t.title,t.note,t.place,t.rule,t.hearingClient,t.hearingNumber,t.hearingJudge,m&&m.title,m&&m.client,m&&m.number].some(has);}).sort(sortT).slice(0,12);
  var js=S.journal.filter(function(j){var m=matter(j.mid);return [j.text,m&&m.title,m&&m.client].some(has);}).slice(0,10);
  return {m:ms,t:ts,j:js};
}
function sheetGlobalSearch(){
  GQ=''; openSheet(premiumHead('search','Глобальный поиск','Доверители, номера дел, суды, статьи, задачи и журнал.')+
    '<div class="fld"><input id="gq" placeholder="Например: Ошарин, 81 УК, Ивановский суд" autocomplete="off"></div><div id="gresults">'+
    '<div class="hint">Введите фамилию, номер дела, суд, статью или часть заметки.</div></div>');
  $('#sheet').classList.add('sheet-premium-search');
  setTimeout(function(){var e=$('#gq');if(e)e.focus();},320);
}
function renderGlobalSearch(){
  var box=$('#gresults');if(!box)return;var r=globalSearchData(GQ),n=r.m.length+r.t.length+r.j.length;
  if(!GQ.trim()){box.innerHTML='<div class="hint">Введите фамилию, номер дела, суд, статью или часть заметки.</div>';return;}
  if(!n){box.innerHTML=empty('search','Ничего не найдено','Попробуйте другой фрагмент запроса.');return;}
  var h='';
  if(r.m.length)h+='<div class="grp">Дела<em>'+r.m.length+'</em></div>'+r.m.map(matterCard).join('');
  if(r.t.length)h+='<div class="grp">Задачи<em>'+r.t.length+'</em></div>'+r.t.map(function(t){return taskCard(t);}).join('');
  if(r.j.length)h+='<div class="grp">Журнал<em>'+r.j.length+'</em></div><div class="card pad0">'+r.j.map(function(j){var m=matter(j.mid);return '<button class="row" data-act="journal-open" data-id="'+j.mid+'">'+ico('doc')+'<span class="rl">'+esc(j.text)+'<small>'+fmtD(j.date,true)+(m?' · '+esc(m.title):'')+'</small></span>'+ico('chev','s')+'</button>';}).join('')+'</div>';
  box.innerHTML=h;
}

function icsEsc(s){return String(s||'').replace(/\\/g,'\\\\').replace(/,/g,'\\,').replace(/;/g,'\\;').replace(/\n/g,'\\n');}
function icsDT(date,time){return date.replace(/-/g,'')+(time?'T'+time.replace(':','')+'00':'');}
function taskICS(t){
  if(!t||!t.due)return '';
  var m=t.mid?matter(t.mid):null, hctx=t.kind==='hearing'&&!m?[t.hearingNumber,t.hearingClient].filter(Boolean).join(' · '):'', title=(t.kind==='hearing'?'Судебное заседание':t.title)+(m?' — '+m.title:(hctx?' — '+hctx:'')), desc=[t.note,t.rule].filter(Boolean).join('\n');
  var lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Advokat Offline//RU','CALSCALE:GREGORIAN','BEGIN:VEVENT','UID:'+t.id+'@advokat-offline','DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')];
  if(t.time){
    lines.push('DTSTART:'+icsDT(t.due,t.time));
    var d=new Date(t.due+'T'+t.time+':00'); d.setMinutes(d.getMinutes()+60);
    lines.push('DTEND:'+d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')+'T'+String(d.getHours()).padStart(2,'0')+String(d.getMinutes()).padStart(2,'0')+'00');
  }else{
    lines.push('DTSTART;VALUE=DATE:'+icsDT(t.due,'')); lines.push('DTEND;VALUE=DATE:'+icsDT(addD(t.due,1),''));
  }
  lines.push('SUMMARY:'+icsEsc(title)); if(t.place)lines.push('LOCATION:'+icsEsc(t.place)); if(desc)lines.push('DESCRIPTION:'+icsEsc(desc));
  lines.push('END:VEVENT','END:VCALENDAR'); return lines.join('\r\n');
}
async function shareICS(t){
  if(!t||!t.due){toast('Сначала укажите дату');return;}
  var text=taskICS(t),name='advokat-'+t.due+'-'+t.id.slice(-4)+'.ics',blob=new Blob([text],{type:'text/calendar'});
  try{
    var file=new File([blob],name,{type:'text/calendar'});
    if(navigator.canShare&&navigator.canShare({files:[file]})&&navigator.share){await navigator.share({files:[file],title:t.title});toast('Откройте файл в Календаре');return;}
  }catch(e){}
  dl(name,text,'text/calendar');
}

/* ------------------------- encrypted backup ------------------------- */
function backupReadableRecords(){
  var active=S.tasks.filter(isActiveRecord).slice().sort(sortT);
  return {
    hearings:active.filter(function(t){ return t.kind==='hearing'; }),
    deadlines:active.filter(function(t){ return t.kind==='deadline'; }),
    tasks:active.filter(function(t){ return t.kind!=='hearing' && t.kind!=='deadline'; })
  };
}
function backupReadableTitle(t){
  var m=t.mid?matter(t.mid):null;
  if(t.kind==='hearing') return hearingCaption(t,m);
  return t.title||KIND[t.kind].n;
}
function backupReadableSub(t){
  var m=t.mid?matter(t.mid):null, bits=[];
  if(m){
    if(m.title) bits.push(m.title);
    if(m.number) bits.push('№ '+m.number);
  }else if(t.kind==='hearing'){
    if(t.hearingClient) bits.push(t.hearingClient);
    if(t.hearingNumber) bits.push('№ '+t.hearingNumber);
    if(t.hearingJudge) bits.push('Судья: '+t.hearingJudge);
  }
  if(t.kind==='hearing' && t.place) bits.push(t.place);
  if(t.kind==='deadline' && t.rule) bits.push(t.rule);
  if(t.note) bits.push(t.note);
  return bits.join(' · ');
}
function backupReadableDateCell(t){
  var base=t.due?fmtShort(t.due):'Без даты';
  if(t.time) base += ', '+t.time;
  return base;
}
function backupReadableSection(title,list){
  if(!list.length) return '<h2>'+title+'</h2><p>Нет записей.</p>';
  return '<h2>'+title+'</h2><table>'+list.map(function(t){
    var sub=backupReadableSub(t);
    return '<tr><td style="white-space:nowrap;width:118px"><b>'+esc(backupReadableDateCell(t))+'</b></td><td><b>'+esc(backupReadableTitle(t))+'</b>'+
      (sub?'<br><small>'+esc(sub)+'</small>':'')+'</td></tr>';
  }).join('')+'</table>';
}
function backupReadableText(){
  var r=backupReadableRecords(), lines=['ЧИТАЕМАЯ КОПИЯ ПЛАНОВ — '+fmtD(today(),true),''];
  var pushGroup=function(title,list){
    lines.push(title+':');
    if(!list.length){ lines.push('  — нет записей'); lines.push(''); return; }
    list.forEach(function(t){
      var row='  • '+backupReadableDateCell(t)+' — '+backupReadableTitle(t);
      var sub=backupReadableSub(t); if(sub) row += ' · '+sub;
      lines.push(row);
    });
    lines.push('');
  };
  pushGroup('Заседания',r.hearings);
  pushGroup('Процессуальные сроки',r.deadlines);
  pushGroup('Задачи',r.tasks);
  return lines.join('\n');
}
function openBackupReadableReport(){
  var r=backupReadableRecords();
  var rows='<h2>Сводка</h2><table>'+
    '<tr><td>Заседания</td><td style="text-align:right"><b>'+r.hearings.length+'</b></td></tr>'+
    '<tr><td>Процессуальные сроки</td><td style="text-align:right"><b>'+r.deadlines.length+'</b></td></tr>'+
    '<tr><td>Задачи</td><td style="text-align:right"><b>'+r.tasks.length+'</b></td></tr>'+
    '</table>'+
    backupReadableSection('Заседания',r.hearings)+
    backupReadableSection('Процессуальные сроки',r.deadlines)+
    backupReadableSection('Задачи',r.tasks);
  printHTML('Ежедневник адвоката','Читаемая резервная копия · '+fmtD(today(),true),rows,'Сформировано '+fmtD(today(),true)+(S.settings.name?' · '+S.settings.name:'')+'. Сохраните документ как PDF.',backupReadableText());
  setTimeout(function(){ try{ doPrint(); }catch(e){} }, 220);
}
function sheetBackup(){
  var bs=backupPlanStats();
  openSheet('<h2>Резервная копия планов</h2><p class="sh-sub">По одной кнопке создаются сразу две копии: <b>зашифрованный файл</b> для полного восстановления приложения и <b>читаемая копия в PDF</b>, чтобы при необходимости вручную перенести заседания, сроки и задачи.</p>'+
    '<div class="backup-sheet-counts"><span>'+bs.tasks+' задач</span><span>'+bs.hearings+' заседаний</span><span>'+bs.deadlines+' сроков</span></div>'+
    '<div class="fld"><label>Пароль копии (минимум 6 символов)</label><input id="bk-pass" type="password" autocomplete="new-password" placeholder="Запомните этот пароль"></div>'+
    '<div class="fld"><label>Повторите пароль</label><input id="bk-pass2" type="password" autocomplete="new-password"></div>'+
    '<div class="hint">Пароль нужен только для зашифрованного файла восстановления. После его сохранения приложение сразу откроет читаемую копию для печати / сохранения в PDF.</div><button class="btn" data-act="backup-create">Сохранить обе копии</button>');
}
async function createBackupFile(){
  var a=$('#bk-pass').value,b=$('#bk-pass2').value;if(a.length<6){toast('Минимум 6 символов');return;}if(a!==b){toast('Пароли не совпадают');return;}
  try{
    var salt=randomB64(16),key=await deriveKey(a,salt),payload=await encryptObj(S,key);
    var wrap={app:'Ежедневник адвоката',version:3,encrypted:true,salt:salt,created:new Date().toISOString(),payload:payload};
    var txt=JSON.stringify(wrap),name='advokat-backup-'+today()+'.advokat.json';
    var shared=false;
    try{
      var blob=new Blob([txt],{type:'application/json'}),file=new File([blob],name,{type:'application/json'});
      if(navigator.canShare&&navigator.canShare({files:[file]})&&navigator.share){
        await navigator.share({files:[file],title:'Резервная копия — Ежедневник адвоката'}); shared=true;
      }
    }catch(shareErr){ if(shareErr&&shareErr.name==='AbortError') return; }
    if(!shared) dl(name,txt,'application/json');
    S.settings.lastBackup=new Date().toISOString();save();closeSheet();render();
    openBackupReadableReport();
    toast('Копии подготовлены');
  }catch(e){toast('Не удалось создать копию');}
}
async function restoreBackupObject(obj,password){
  var data=obj;
  if(obj&&obj.encrypted&&obj.payload){var key=await deriveKey(password,obj.salt);data=await decryptObj(obj.payload,key);}
  if(!data||!Array.isArray(data.tasks)||!Array.isArray(data.matters))throw new Error('bad backup');
  S=mergeState(data);save();await persistNow();closeAll();render();toast('Данные восстановлены');
}

/* =====================================================================
   ОТЧЁТЫ / ПЕЧАТЬ
   ===================================================================== */
var REPORT = null;
function printHTML(title,sub,rows,foot,text){
  var body = '<div class="ph"><h1>'+esc(title)+'</h1><div>'+esc(sub)+'</div></div>'+rows+
    '<div class="ft">'+esc(foot||('Сформировано '+fmtD(today(),true)+(S.settings.name?' · '+S.settings.name:'')))+'</div>';
  $('#printarea').innerHTML = body;
  var back = $('#page').classList.contains('open') ? $('#page')._mid : '';
  REPORT = { title:title, text:text||'', back:back };
  openPage('<div class="shhead"><button class="iconbtn" data-act="rep-back">'+ico('left')+'</button>'+
    '<div style="flex:1"></div>'+
    '<button class="iconbtn" data-act="rep-share">'+ico('share')+'</button>'+
    '<button class="iconbtn" data-act="rep-print">'+ico('doc')+'</button></div>'+
    '<div class="report">'+body+'</div>'+
    '<button class="btn" data-act="rep-print" style="margin-top:16px">Печать / сохранить в PDF</button>'+
    '<button class="btn ghost" data-act="rep-share" style="margin-top:8px">Поделиться текстом</button>'+
    '<div style="height:24px"></div>');
  $('#page')._navType='report';
}
function doPrint(){
  try{
    var w = window.open('', '_blank');
    if(w){
      w.document.write('<html><head><meta charset="utf-8"><title>'+esc(REPORT?REPORT.title:'Отчёт')+'</title>'+
        '<style>body{font:12pt/1.45 -apple-system,Georgia,serif;color:#000;padding:18px}'+
        'h1{font-size:18pt;margin:0 0 4px}.ph{border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:16px}'+
        'h2{font-size:13pt;margin:18px 0 6px;border-bottom:1px solid #999;padding-bottom:3px}'+
        'table{width:100%;border-collapse:collapse;font-size:10.5pt}td{padding:5px 4px;border-bottom:1px solid #ddd;vertical-align:top}'+
        '.cb{width:18px}.ft{margin-top:26px;font-size:9pt;color:#555;border-top:1px solid #ccc;padding-top:8px}</style>'+
        '</head><body>'+$('#printarea').innerHTML+'</body></html>');
      w.document.close(); w.focus();
      setTimeout(function(){ try{ w.print(); }catch(e){} }, 400);
      return;
    }
  }catch(e){}
  try{ window.print(); }catch(e){ toast('Печать недоступна — используйте «Поделиться текстом»'); }
}
function reportText(){
  var el = document.createElement('div'); el.innerHTML = $('#printarea').innerHTML;
  el.querySelectorAll('tr').forEach(function(r){ r.appendChild(document.createTextNode('\n')); });
  el.querySelectorAll('td').forEach(function(c){ c.appendChild(document.createTextNode('  ')); });
  el.querySelectorAll('h1,h2,div').forEach(function(c){ c.appendChild(document.createTextNode('\n')); });
  return (el.textContent||'').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
function printDay(){
  var list = overdue().concat(dueToday()).sort(sortT);
  var rows = '<h2>План на '+fmtD(today(),true)+'</h2><table>'+list.map(function(t){
    var m = t.mid?matter(t.mid):null;
    return '<tr><td class="cb">☐</td><td><b>'+(t.time?t.time+' ':'')+esc(t.title)+'</b>'+
      (m?'<br><small>'+esc(m.title)+'</small>':'')+
      (t.note?'<br><small>'+esc(t.note)+'</small>':'')+'</td>'+
      '<td style="text-align:right;white-space:nowrap">'+(t.due?fmtShort(t.due):'')+'</td></tr>'; }).join('')+'</table>';
  if(!list.length) rows = '<h2>Задач на сегодня нет</h2>';
  var h = S.tasks.filter(function(t){ return !t.done && t.kind==='hearing' && t.due && dd(t.due)>=0 && dd(t.due)<=14; }).sort(sortT);
  if(h.length) rows += '<h2>Заседания ближайших двух недель</h2><table>'+h.map(function(t){
    var m = t.mid?matter(t.mid):null;
    return '<tr><td style="white-space:nowrap"><b>'+fmtShort(t.due)+(t.time?', '+t.time:'')+'</b></td><td>'+esc(t.title)+
      (m?' — '+esc(m.title):'')+(t.place?'<br><small>'+esc(t.place)+'</small>':'')+'</td></tr>'; }).join('')+'</table>';
  printHTML('План работы адвоката', fmtD(today(),true), rows);
}
function printMatter(id){
  var m=matter(id),st=matterStats(m),ts=tasksOf(id).sort(sortT),parts=participationOf(id).slice().sort(function(a,b){return a.date<b.date?1:-1;}),js=journalOf(id).slice().sort(function(a,b){return a.date<b.date?1:-1;});
  var pctx=matterPlaceContext(m.type||'other',m.stage||'',m.court||'');
  var info='<table>'+[
    ['Тип',matterType(m).n],['Основание ведения',matterBasisLabel(m.basis)],['Доверитель',m.client],['Номер дела / материала',m.number],[pctx.label,m.court],[pctx.mode==='judicial'?'Судья':'',pctx.mode==='judicial'?m.judge:''],[pctx.mode==='investigation'?matterInvestigatorLabel(m.stage):'',pctx.mode==='investigation'?m.investigator:''],[matterArticleLabel((m&&m.type)||'other'),m.article],['Статус',matterRoleDisplayLabel(m.type||'other',m.stage||'',m.role)],['Мера пресечения',m.stage==='Материал проверки'?'':m.restraint],['Оппонент',m.opponent],['Стадия',m.stage]
  ].filter(function(r){return r[0]&&r[1];}).map(function(r){return '<tr><td style="width:38%;color:#555">'+r[0]+'</td><td><b>'+esc(r[1])+'</b></td></tr>';}).join('')+
  '<tr><td style="color:#555">Дни участия</td><td><b>'+st.days+(st.sum?' · '+money(st.sum):'')+'</b></td></tr></table>';
  var rows='<h2>Сведения по делу</h2>'+info+'<h2>Задачи ('+st.open+' в работе, '+st.done+' выполнено)</h2><table>'+ts.map(function(t){return '<tr><td class="cb">'+(t.done?'☑':'☐')+'</td><td>'+esc(t.title)+(t.note?'<br><small>'+esc(t.note)+'</small>':'')+'</td><td style="text-align:right;white-space:nowrap">'+(t.due?fmtShort(t.due):'—')+'</td></tr>';}).join('')+'</table>';
  if(parts.length)rows+='<h2>Дни участия</h2><table>'+parts.map(function(e){var rate=+e.rate||+m.dayRate||+S.settings.dayRate||0;return '<tr><td style="white-space:nowrap">'+fmtD(e.date)+'</td><td>'+esc(PART_KINDS[e.kind]||'Участие')+(e.place?'<br><small>'+esc(e.place)+'</small>':'')+(e.desc?'<br><small>'+esc(e.desc)+'</small>':'')+'</td><td style="text-align:right">'+(rate?money(rate):'—')+'</td></tr>';}).join('')+'</table>';
  if(js.length)rows+='<h2>Журнал дела</h2><table>'+js.map(function(j){return '<tr><td style="white-space:nowrap">'+fmtD(j.date)+'</td><td>'+esc(j.text)+'</td></tr>';}).join('')+'</table>';
  printHTML(m.title,'Отчёт по делу · '+fmtD(today(),true),rows);
}
function exportText(){
  var lines = ['ЕЖЕДНЕВНИК АДВОКАТА — '+fmtD(today(),true),''];
  activeM().forEach(function(m){
    var ts = tasksOf(m.id); if(!ts.length) return;
    lines.push('◆ '+m.title+(m.number?' ('+m.number+')':''));
    ts.sort(sortT).forEach(function(t){
      lines.push('  '+(t.done?'[x]':'[ ]')+' '+t.title+(t.due?' — '+fmtShort(t.due):'')+(t.time?' '+t.time:'')); });
    lines.push('');
  });
  var free = S.tasks.filter(function(t){ return !t.mid; });
  if(free.length){ lines.push('◆ Без дела');
    free.sort(sortT).forEach(function(t){ lines.push('  '+(t.done?'[x]':'[ ]')+' '+t.title+(t.due?' — '+fmtShort(t.due):'')); }); }
  var txt = lines.join('\n');
  shareOrCopy('Ежедневник адвоката', txt);
}
function dl(name,text,type){
  try{
    var a = document.createElement('a');
    if(typeof a.download === 'undefined') throw new Error('no download');
    a.href = URL.createObjectURL(new Blob([text],{type:type+';charset=utf-8'}));
    a.download = name; a.rel='noopener'; document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); },400);
    toast('Файл сохранён: '+name);
  }catch(e){ showText(name,text); }
}
/* запасной путь для iPhone в режиме приложения: показать текст и дать скопировать */
var TXT = '';
function showText(name,text){
  TXT = text;
  openPage('<div class="shhead"><button class="iconbtn" data-act="close">'+ico('left')+'</button>'+
    '<h2 style="flex:1;font-size:17px">'+esc(name)+'</h2>'+
    '<button class="iconbtn" data-act="txt-copy">'+ico('doc')+'</button></div>'+
    '<div class="hint">Скачивание файлов недоступно в этом режиме. Скопируйте текст или отправьте его себе — в Заметки, почту, мессенджер.</div>'+
    '<textarea id="txt-area" rows="16" style="width:100%;font-size:12px;background:var(--elev2);'+
    'border:1px solid var(--line);border-radius:12px;padding:12px;color:var(--txt)">'+esc(text)+'</textarea>'+
    '<button class="btn" data-act="txt-copy" style="margin-top:12px">Скопировать</button>'+
    '<button class="btn ghost" data-act="txt-share" style="margin-top:8px">Поделиться</button><div style="height:24px"></div>');
  $('#page')._navType='text';
}
function shareOrCopy(title,text){
  if(navigator.share){ navigator.share({title:title,text:text}).catch(function(){ copyText(text); }); }
  else copyText(text);
}
function copyText(text){
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(function(){ toast('Скопировано в буфер обмена'); },
      function(){ legacyCopy(text); });
  } else legacyCopy(text);
}
function legacyCopy(text){
  var ta = $('#txt-area');
  if(!ta){ showText('Текст',text); return; }
  ta.focus(); ta.setSelectionRange(0,ta.value.length);
  try{ document.execCommand('copy'); toast('Скопировано'); }catch(e){ toast('Выделите текст и скопируйте вручную'); }
}

/* =====================================================================
   НАСТРОЙКИ
   ===================================================================== */
function sheetProfile(){
  openSheet('<h2>Профиль</h2><p class="sh-sub">Ставка применяется к каждому фактическому дню участия. Продолжительность участия не учитывается.</p>'+
  '<div class="fld"><label>Имя / ФИО</label><input id="p-name" value="'+esc(S.settings.name)+'" placeholder="Смирнов А. В."></div>'+
  '<div class="two"><div class="fld"><label>Ставка за день участия</label><input id="p-dayrate" type="number" inputmode="numeric" value="'+(S.settings.dayRate||'')+'" placeholder="10000"></div>'+
  '<div class="fld"><label>Валюта</label><input id="p-cur" value="'+esc(S.settings.cur)+'"></div></div>'+
  '<div class="fld"><label>Напоминать о резервной копии каждые, дней</label><input id="p-backdays" type="number" inputmode="numeric" min="1" max="90" value="'+(+S.settings.backupEveryDays||7)+'"></div>'+
  '<button class="btn" data-act="p-save">Сохранить</button>');
}
function sheetPin(){
  if(pinEnabled()){
    openSheet('<h2>Код доступа и шифрование</h2><p class="sh-sub">PIN используется как ключ для локальной зашифрованной базы.</p>'+
      '<div class="hint"><b>PIN включён.</b> Без правильного PIN база не расшифровывается при запуске приложения. Сам PIN в базе не хранится.</div>'+
      '<button class="btn ghost" data-act="pin-off">Отключить PIN и перейти на локальный ключ устройства</button>');
  }else{
    openSheet('<h2>Включить PIN-шифрование</h2><p class="sh-sub">4 цифры. Они понадобятся при каждом новом запуске веб-приложения.</p>'+
      '<div class="fld"><label>PIN</label><input id="pin1" type="tel" inputmode="numeric" maxlength="4" placeholder="••••" style="letter-spacing:.5em;text-align:center;font-size:22px"></div>'+
      '<div class="fld"><label>Повторите PIN</label><input id="pin2" type="tel" inputmode="numeric" maxlength="4" style="letter-spacing:.5em;text-align:center;font-size:22px"></div>'+
      '<div class="hint">Если PIN будет забыт, расшифровать локальную базу невозможно. Перед включением рекомендуется сделать зашифрованную резервную копию с отдельным паролем.</div>'+
      '<button class="btn" data-act="pin-set">Включить PIN-шифрование</button>');
  }
}
function sheetNotify(){
  var st=('Notification' in window)?Notification.permission:'unsupported';
  var firstText=st==='unsupported'?'Этот браузер не поддерживает уведомления. На iPhone они доступны после установки приложения на экран «Домой».':st==='denied'?'Уведомления запрещены в настройках iPhone. Разрешите их для приложения, чтобы получать локальные напоминания.':S.settings.notify?'Напоминания включены. На iPhone они срабатывают, пока веб-приложение активно; iOS может приостанавливать его в фоне.':'Напоминания сейчас выключены. После включения приложение запросит разрешение iPhone на уведомления.';
  openSheet('<div class="notify-premium-head"><span class="notify-premium-head-icon">'+ico('bell')+'</span><div><h2>Напоминания</h2><p>Локальное напоминание за 10 минут до задачи и за час до заседания.</p></div></div>'+ 
    '<div class="notify-premium-card"><span class="notify-premium-card-icon">'+ico('info','s')+'</span><div><b>'+(S.settings.notify?'Напоминания включены':'Локальные уведомления')+'</b><p>'+firstText+'</p></div></div>'+ 
    '<div class="notify-premium-card"><span class="notify-premium-card-icon">'+ico('cal','s')+'</span><div><b>Критичные события — в системный календарь</b><p>Для судебных заседаний и важных процессуальных сроков дополнительно используйте «Календарь» или «Напоминания» iPhone. Автономное PWA не может гарантировать фоновые таймеры после выгрузки системой.</p></div></div>'+ 
    '<button class="btn notify-premium-toggle'+(S.settings.notify?' off':' on')+'" data-act="notify"><span>'+ico(S.settings.notify?'bell':'check','s')+'</span>'+(S.settings.notify?'Выключить напоминания':'Включить напоминания')+ico('chev','s')+'</button>');
  $('#sheet').classList.add('notify-premium-sheet');
}
function sheetReports(){
  openSheet('<h2>Отчёты</h2><p class="sh-sub">Печать или сохранение в PDF (в меню печати iPhone).</p>'+
   '<div class="card" style="padding:0 16px">'+
    '<button class="row" data-act="print-day">'+ico('sun')+'<span class="rl">План на сегодня<small>Задачи и заседания на 2 недели</small></span>'+ico('chev','s')+'</button>'+
    activeM().map(function(m){ return '<button class="row" data-act="print-m" data-id="'+m.id+'">'+ico('folder')+
      '<span class="rl">Отчёт по делу<small>'+esc(m.title)+'</small></span>'+ico('chev','s')+'</button>'; }).join('')+
   '</div>');
}

/* =====================================================================
   НАПОМИНАНИЯ
   ===================================================================== */
var timers = [];
function schedule(){
  timers.forEach(clearTimeout); timers = [];
  if(!S.settings.notify || !('Notification' in window) || Notification.permission!=='granted') return;
  var now = new Date();
  S.tasks.filter(function(t){ return !t.done && t.due===today() && t.time; }).forEach(function(t){
    var at = new Date(today()+'T'+t.time+':00'); var lead = t.kind==='hearing' ? 60 : 10;
    var when = at.getTime() - lead*60000 - now.getTime();
    if(when>0 && when<86400000){
      timers.push(setTimeout(function(){
        var title = KIND[t.kind].n+' через '+lead+' мин';
        var opts = { body:t.title+(t.place?' · '+t.place:''), icon:'icon-192.png', badge:'icon-192.png', tag:'adv-'+t.id };
        if(navigator.serviceWorker && navigator.serviceWorker.ready){
          navigator.serviceWorker.ready.then(function(reg){
            if(reg.showNotification) return reg.showNotification(title, opts);
            try{ new Notification(title, opts); }catch(e){}
          }).catch(function(){ try{ new Notification(title, opts); }catch(e){} });
        } else { try{ new Notification(title, opts); }catch(e){} }
      }, when));
    }
  });
}
function toggleNotify(){
  if(S.settings.notify){ S.settings.notify = false; save(); render(); toast('Напоминания выключены'); return; }
  if(!('Notification' in window)){ toast('Устройство не поддерживает уведомления'); return; }
  Notification.requestPermission().then(function(p){
    if(p==='granted'){ S.settings.notify = true; save(); render(); schedule();
      toast('Напоминания включены'); }
    else toast('Разрешение не выдано');
  });
}

/* =====================================================================
   LOCK
   ===================================================================== */
var pinBuf='';
function drawPad(){
  $('#lock-pad').innerHTML=[1,2,3,4,5,6,7,8,9].map(function(n){return '<button data-n="'+n+'">'+n+'</button>';}).join('')+'<button class="f"></button><button data-n="0">0</button><button class="f" data-n="del">←</button>';
}
function lockShow(msg){pinBuf='';paintDots();$('#lock-msg').textContent=msg||'Введите PIN для расшифровки базы';$('#lock').classList.add('on');}
function paintDots(){document.querySelectorAll('#lock-dots i').forEach(function(d,i){d.classList.toggle('f',i<pinBuf.length);});}
function pinPress(n){
  if(n==='del'){pinBuf=pinBuf.slice(0,-1);paintDots();return;} if(pinBuf.length>=4)return;
  pinBuf+=n;paintDots();vib(6);
  if(pinBuf.length===4)setTimeout(async function(){
    $('#lock-msg').textContent='Проверка…';var ok=await unlockWithPin(pinBuf);
    if(ok){$('#lock').classList.remove('on');pinBuf='';paintDots();afterUnlock();}
    else{$('#lock-dots').classList.add('shake');$('#lock-msg').textContent='Неверный PIN';vib([40,60,40]);setTimeout(function(){$('#lock-dots').classList.remove('shake');pinBuf='';paintDots();},420);}
  },120);
}

/* =====================================================================
   ПЕРВЫЙ ЗАПУСК / ПРИМЕРЫ / ПОЛНАЯ ОЧИСТКА
   ===================================================================== */
function showIntro(){
  openSheet('<h2>Ежедневник адвоката 3.1</h2><p class="sh-sub">Локальный рабочий кабинет для дел, заседаний, сроков и задач.</p>'+iphoneInstallHint()+
  '<div class="card pad0">'+
    infoRow('sun','Сегодня','Критичные сроки, ближайшее заседание и план дня')+
    infoRow('folder','Досье дела','Доверитель, суд/орган, статья, стадия, задачи и журнал')+
    infoRow('gavel','Дни участия','Каждое фактическое участие = 1 день независимо от продолжительности')+
    infoRow('flag','Процессуальные сроки','Расчёт срока и отдельная подготовительная задача')+
    infoRow('cal','Календарь iPhone','Заседание или срок можно выгрузить в .ics')+
    infoRow('lock','Конфиденциальность','Локальная база в IndexedDB шифруется; резервные копии защищаются паролем')+
  '</div><p class="sh-sub" style="margin:14px 2px 8px">С чего начать</p>'+
  '<button class="btn" data-act="new-matter">Завести первое дело</button><button class="btn ghost" data-act="quick-add" style="margin-top:8px">Быстрая запись</button>'+
  '<button class="btn ghost" data-act="demo" style="margin-top:8px">Загрузить примеры</button><button class="btn danger" data-act="skip">Закрыть</button>');
}
async function wipeAll(){
  if(!confirm('Удалить ВСЕ локальные данные: дела, задачи, дни участия и журнал? Рекомендуется сначала создать резервную копию.'))return;
  await clearSecureStorage();S.settings.seen=false;S.ui.q='';S.ui.taskChip='';S.ui.taskType='';S.ui.showArch=false;S.ui.matterType='';S.ui.matterBasis='';S.ui.matterStage='';S.ui.matterSort='priority';S.ui.matterQ='';S.ui.matterSearchOpen=false;save();closeAll();go('today');toast('Все данные удалены');setTimeout(showIntro,320);
}

function demo(){
  if(S.matters.length||S.tasks.length||S.participation.length||S.journal.length){if(!confirm('Примеры будут добавлены к текущей базе. Продолжить?'))return;}
  var m1={id:uid(),title:'Ошарин А.С. — освобождение по болезни',type:'criminal',client:'Ошарин Александр Сергеевич',number:'материал 4/17-2026',court:'Ивановский районный суд',article:'ст. 81 УК РФ',role:'осужденный',stage:'Первая инстанция',dayRate:10000,notes:'Оспаривается полнота медицинского освидетельствования. Контроль медицинских документов и процессуальных сроков.',archived:false,created:new Date().toISOString()};
  var m2={id:uid(),title:'Наследственный спор — признание свидетельств недействительными',type:'civil',client:'Иванова А.С.',number:'2-1438/2026',court:'Кинешемский городской суд',judge:'Судья Петрова Н.В.',stage:'Первая инстанция',dayRate:10000,notes:'Фактическое принятие наследства, спор о составе наследственной массы.',archived:false,created:new Date().toISOString()};
  var m3={id:uid(),title:'Песков — спор о квалификации',type:'criminal',client:'Песков Д.С.',number:'УД-88/2026',court:'Районный суд',article:'ч. 2 ст. 228 УК РФ / обвинение в покушении на сбыт',role:'подсудимый',stage:'Первая инстанция',dayRate:10000,archived:false,created:new Date().toISOString()};
  S.matters=[m1,m2,m3].concat(S.matters);
  S.matters.forEach(function(m){m.title=matterAutoTitle(m);});
  var T=[
    [m1.id,'Подать апелляционную жалобу','deadline',4,'','high','','Срок обжалования постановления'],
    [m1.id,'Получить копию заключения медицинской комиссии','task',0,'','high','',''],
    [m2.id,'Заседание по наследственному делу','hearing',1,'10:30','high','Кинешемский городской суд','Подготовить оригиналы документов'],
    [m2.id,'Подготовить вопросы свидетелям','task',0,'','mid','',''],
    [m3.id,'Подготовить Пескова к допросу','task',2,'','high','','Свободный рассказ + вопросы участников'],
    [m3.id,'Судебное заседание','hearing',5,'11:00','high','Районный суд',''],
    ['','Позвонить новому доверителю','task',0,'16:00','low','','']
  ];
  T.forEach(function(x){S.tasks.push({id:uid(),mid:x[0],title:x[1],kind:x[2],due:addD(today(),x[3]),time:x[4],pri:x[5],place:x[6],note:x[7],sourceDate:x[2]==='deadline'?today():'',rule:x[2]==='deadline'?'Сверить с постановлением и применимым кодексом':'',done:false,steps:[],created:new Date().toISOString()});});
  S.participation.unshift({id:uid(),mid:m2.id,date:addD(today(),-3),kind:'hearing',place:'Кинешемский городской суд',desc:'Судебное заседание',rate:10000,created:new Date().toISOString()});
  S.participation.unshift({id:uid(),mid:m3.id,date:addD(today(),-6),kind:'meeting',place:'СИЗО',desc:'Свидание с подзащитным',rate:10000,created:new Date().toISOString()});
  S.journal.unshift({id:uid(),mid:m2.id,date:addD(today(),-2),text:'Приобщены письменные объяснения и копии документов.',type:'note'});
  S.journal.unshift({id:uid(),mid:m1.id,date:addD(today(),-1),text:'Получены медицинские документы для подготовки жалобы.',type:'note'});
  S.settings.seen=true;S.ui.tab='today';save();render();toast('Примеры загружены');
}

/* =====================================================================
   EVENTS
   ===================================================================== */
var SWIPE_CLICK_BLOCK_UNTIL=0;
document.addEventListener('click', function(ev){
  if(Date.now()<SWIPE_CLICK_BLOCK_UNTIL){ev.preventDefault();ev.stopPropagation();return;}
  var el=ev.target.closest('[data-act]'); if(!el){ if(!ev.target.closest('.pt-item')) closeTaskActionRows(); return; }
  var a=el.dataset.act,v=el.dataset.v,id=el.dataset.id; ev.stopPropagation();
  if(el.classList.contains('quickitem')) vib(7);
  switch(a){
    /* navigation / dashboard */
    case 'go-matters': go('matters'); break;
    case 'go-tasks': go('tasks'); break;
    case 'go-more': go('more'); break;
    case 'go-cal': go('cal'); break;
    case 'close': appBack(); break;
    case 'quick-add': sheetQuickAdd(); break;
    case 'global-search': sheetGlobalSearch(); break;
    case 'date-open': {var dt=el.dataset.target||'',di=dt?$('#'+dt):null;openPremiumDatePicker(dt,di?di.value:'','field','');break;}
    case 'date-open-task': openPremiumDatePicker('',el.dataset.dateValue||today(),'task',id);break;
    case 'date-prev': if(DATE_PICKER){DATE_PICKER.month=datePickerShiftMonth(DATE_PICKER.month,-1);renderPremiumDatePicker();}break;
    case 'date-next': if(DATE_PICKER){DATE_PICKER.month=datePickerShiftMonth(DATE_PICKER.month,1);renderPremiumDatePicker();}break;
    case 'date-day': if(DATE_PICKER){DATE_PICKER.selected=v;DATE_PICKER.month=v.slice(0,7);renderPremiumDatePicker();vib(4);}break;
    case 'date-today': if(DATE_PICKER){DATE_PICKER.selected=today();DATE_PICKER.month=today().slice(0,7);renderPremiumDatePicker();}break;
    case 'date-clear': if(DATE_PICKER){DATE_PICKER.selected='';renderPremiumDatePicker();}break;
    case 'date-apply': applyPremiumDatePicker();break;
    case 'date-close': closePremiumDatePicker();break;
    case 'time-open': {var tt=el.dataset.target||'',ti=tt?$('#'+tt):null;openPremiumTimePicker(tt,ti?ti.value:'',el.dataset.timeMode||'default');break;}
    case 'time-hour': if(TIME_PICKER){TIME_PICKER.hour=+v;normalizePremiumTimeSelection();renderPremiumTimePicker();vib(4);}break;
    case 'time-minute': if(TIME_PICKER&&premiumTimeMinuteAllowed(TIME_PICKER.hour,+v)){TIME_PICKER.minute=+v;updatePremiumTimeWheelVisuals();vib(4);}break;
    case 'time-apply': applyPremiumTimePicker();break;
    case 'time-clear': clearPremiumTimePicker();break;
    case 'time-close': closePremiumTimePicker();break;
    case 'list-open': {
      var lt=el.dataset.target||'',li=el.dataset.input||'';
      var ls=lt?$('#'+lt):null;
      if(!ls){upgradePremiumSelects(el.closest('.sheet')||document);ls=lt?$('#'+lt):null;}
      if(ls)openPremiumListPicker(lt,li);else toast('Список временно недоступен');
      break;
    }
    case 'list-pick': applyPremiumListChoice(v==null?'':v);break;
    case 'list-close': closePremiumListPicker();break;
    case 'journal-open': closeSheet(); if(matter(id))openMatter(id); break;
    case 'reschedule': {var ov=S.tasks.filter(function(t){return !t.done&&t.kind==='task'&&t.due&&dd(t.due)<0;});if(!ov.length)break;if(confirm('Перенести '+ov.length+' просроченных задач на сегодня?')){ov.forEach(function(t){t.due=today();});save();render();toast('Перенесено задач: '+ov.length);}break;}
    case 'f-late': go('tasks');S.ui.taskSeg='open';S.ui.taskChip='late';S.ui.taskType='';save();renderTasks();break;
    case 'f-today': go('tasks');S.ui.taskSeg='open';S.ui.taskChip='today';S.ui.taskType='';save();renderTasks();break;
    case 'f-hear': go('tasks');S.ui.taskSeg='open';S.ui.taskChip='';S.ui.taskType='hearing';save();renderTasks();break;
    case 'today-more-tasks': go('tasks');S.ui.taskSeg='open';S.ui.taskChip='today';S.ui.taskType='';save();renderTasks();break;
    case 'today-more-hearings': go('tasks');S.ui.taskSeg='open';S.ui.taskChip='';S.ui.taskType='hearing';save();renderTasks();break;
    case 'f-deadline': go('tasks');S.ui.taskSeg='open';S.ui.taskChip='';S.ui.taskType='deadline';save();renderTasks();break;
    case 'seg': S.ui.taskSeg=v;save();renderTasks();break;
    case 'chip': S.ui.taskChip=v;save();renderTasks();break;
    case 'search': S.ui._sq=!S.ui._sq;if(!S.ui._sq)S.ui.q='';renderTasks();break;
    case 'reset-task-filters': S.ui.q='';S.ui._sq=false;S.ui.taskChip='';S.ui.taskType='';save();renderTasks();toast('Фильтры сброшены');break;
    case 'task-type-sheet': sheetTaskTypeFilters();break;
    case 'task-type-filter': S.ui.taskType=v||'';save();closeSheet();renderTasks();break;
    case 'arch': S.ui.showArch=!S.ui.showArch;S.ui.matterScope=S.ui.showArch?'archive':'active';save();renderMatters();break;
    case 'matter-scope': S.ui.matterScope=v||'active';S.ui.showArch=S.ui.matterScope==='archive';save();renderMatters();break;
    case 'matter-search': S.ui.matterSearchOpen=!S.ui.matterSearchOpen;if(!S.ui.matterSearchOpen)S.ui.matterQ='';save();renderMatters();break;
    case 'matter-search-clear': S.ui.matterQ='';S.ui.matterSearchOpen=true;save();renderMatters();break;
    case 'matter-filter-sheet': sheetMatterFilters();break;
    case 'm-filter': S.ui.matterType=v||'';save();closeSheet();renderMatters();break;
    case 'm-basis-filter': S.ui.matterBasis=v||'';save();closeSheet();renderMatters();break;
    case 'm-stage-filter': S.ui.matterStage=v||'';save();closeSheet();renderMatters();break;
    case 'm-sort': S.ui.matterSort=v||'priority';save();closeSheet();renderMatters();break;
    case 'matter-filter-reset': S.ui.matterType='';S.ui.matterBasis='';S.ui.matterStage='';S.ui.matterSort='priority';save();closeSheet();renderMatters();toast('Фильтры и сортировка сброшены');break;

    /* quick add */
    case 'qa-hearing': closeSheet();editTask(null,{kind:'hearing',pri:'mid',due:'',time:''});break;
    case 'qa-meeting': closeSheet();editTask(null,{kind:'meeting',pri:'mid',due:today(),time:''});break;
    case 'qa-deadline': closeSheet();sheetDeadline('');break;
    case 'qa-task': closeSheet();editTask(null,{kind:'task',due:today()});break;
    case 'qa-call': closeSheet();editTask(null,{kind:'task',due:today()});break;
    case 'qa-journal': closeSheet();sheetJournal('');break;

    /* tasks */
    case 'toggle': toggleTaskDone(id); break;
    case 'hearing-result': sheetHearingResult(id); break;
    case 'hearing-result-pick': pullHearingResult();if(HR){HR.status=v;drawHearingResultSheet();}break;
    case 'hearing-result-save': saveHearingResult();break;
    case 'task': {var tk=S.tasks.filter(function(x){return x.id===id;})[0];if(tk){if(hearingNeedsResult(tk))sheetHearingResult(tk.id);else if(hearingHasResult(tk))completedHearingFeedback(tk);else editTask(tk);}break;}
    case 'task-action-delete': closeSheet(); deleteTaskById(id); break;
    case 'task-del': deleteTaskById(id); break;
    case 'task-matter': if(matter(id)){ closeSheet(); openMatter(id); } break;
    case 'task-group': setTaskGroupOpen(v,!taskGroupOpen(v)); renderTaskList(); break;
    case 'ics-task': {var it=S.tasks.filter(function(x){return x.id===id;})[0];if(it)shareICS(it);break;}
    case 'e-kind': {pullEditor();var prevKind=ED.kind;ED.kind=v;if(v==='hearing'){ED.pri='mid';ED.steps=[];if(prevKind!=='hearing')syncHearingCourt(true);}if(v==='meeting'){ED.pri='mid';ED.steps=[];ED.due=ED.due||today();}if(v==='deadline'){ED.pri='high';ED.deadlineCode=ED.deadlineCode||'GPK';ED.deadlineRuleId=legalDeadlineRule(ED.deadlineRuleId)?ED.deadlineRuleId:((legalDeadlineRules(ED.deadlineCode)[0]||{}).id||'gpk-appeal');ED.sourceDate=ED.sourceDate||today();var rr=legalDeadlineRule(ED.deadlineRuleId),cr=calculateLegalDeadline(rr,ED.sourceDate);if(rr){ED.title=rr.name;ED.rule=rr.article;ED.ruleArticle=rr.article;}if(cr)ED.due=cr.end;}if(prevKind==='deadline'&&(v==='task'||v==='meeting')){ED.title='';ED.rule='';ED.ruleArticle='';ED.ruleCode='';ED.due=ED.due||today();}drawEditor(true);break;}
    case 'e-pri': pullEditor();ED.pri=v;drawEditor(true);break;
    case 'e-quick': pullEditor();ED.due=v===''?'':addD(today(),+v);drawEditor(true);break;
    case 'e-save': saveTask();break;
    case 'e-del': {var edt=ED&&ED.id?S.tasks.filter(function(x){return x.id===ED.id;})[0]:null;if(edt&&edt.kind==='hearing'&&(hearingNeedsResult(edt)||hearingHasResult(edt))){toast('Прошедшее заседание сохраняется в истории');break;}if(confirm(ED&&ED.kind==='hearing'?'Удалить заседание?':(ED&&ED.kind==='meeting'?'Удалить встречу?':(ED&&ED.kind==='deadline'?'Удалить процессуальный срок?':'Удалить задачу?')))){S.tasks=S.tasks.filter(function(x){return x.id!==ED.id;});save();closeSheet();render();if($('#page').classList.contains('open'))openMatter($('#page')._mid);toast('Удалено');}break;}

    /* matters */
    case 'new-matter': closeSheet();editMatter(null);break;
    case 'matter': if(matter(id)){closeSheet();openMatter(id);}break;
    case 'matter-jump': {var mj=$('#'+v);if(mj){mj.scrollIntoView({behavior:'smooth',block:'start'});}break;}
    case 'm-edit': {var me=matter($('#page')._mid);if(me)editMatter(me);break;}
    case 'm-moremenu': sheetMatterMore(id||$('#page')._mid); break;
    case 'm-save': saveMatter();break;
    case 'm-add': {var ma=matter(id);if(ma&&ma.archived){toast('Сначала верните дело в работу');break;}editTask(null,{mid:id,due:today()});break;}
    case 'm-hearing': {var mh=matter(id);if(mh&&mh.archived){toast('Сначала верните дело в работу');break;}editTask(null,{mid:id,kind:'hearing',pri:'mid',due:'',time:''});break;}
    case 'm-deadline': {var md=matter(id);if(md&&md.archived){toast('Сначала верните дело в работу');break;}sheetDeadline(id);break;}
    case 'm-tpl': sheetTemplates(id);break;
    case 'm-part': sheetParticipation(id);break;
    case 'm-journal': sheetJournal(id);break;
    case 'm-print': if(matter($('#page')._mid))printMatter($('#page')._mid);break;
    case 'm-arch': {var mm=matter(id);if(!mm)break;
      if(!mm.archived){
        var activeLinked=tasksOf(id).filter(isActiveRecord);
        if(activeLinked.length&&!confirm('По делу осталось '+activeLinked.length+' '+plural(activeLinked.length,'активная запись','активные записи','активных записей')+'. Они продолжат отображаться в «Сегодня» и «Задачах». Всё равно отправить дело в архив?'))break;
      }
      mm.archived=!mm.archived;addJournal(id,mm.archived?'Дело отправлено в архив':'Дело возвращено в работу',today(),'system',true);save();closeAll();render();toast(mm.archived?'Дело в архиве':'Дело возвращено в работу');break;}
    case 'm-del': if(confirm('Удалить дело, связанные задачи и журнал? Действие необратимо.')){S.tasks=S.tasks.filter(function(t){return t.mid!==id;});S.participation=S.participation.filter(function(e){return e.mid!==id;});S.journal=S.journal.filter(function(j){return j.mid!==id;});S.matters=S.matters.filter(function(m){return m.id!==id;});save();closeAll();render();toast('Дело удалено');}break;

    /* journal + participation */
    case 'j-save': {var jm=$('#j-mid-select')?$('#j-mid-select').value:($('#j-mid')?$('#j-mid').value:'');var jt=$('#j-text').value.trim();if(!jm){toast('Выберите дело');break;}if(!jt){toast('Введите запись');break;}addJournal(jm,jt,$('#j-date').value||today(),'note',true);save();closeSheet();if($('#page').classList.contains('open'))openMatter(jm);render();toast('Запись добавлена');break;}
    case 'journal-del': {S.journal=S.journal.filter(function(j){return j.id!==id;});save();if($('#page').classList.contains('open'))openMatter($('#page')._mid);render();break;}
    case 'pt-new': closeSheet();sheetParticipation('');break;
    case 'participation-log': sheetParticipationLog();break;
    case 'pt-save': {var pm=$('#pt-mid').value,pd=$('#pt-date').value||today();if(!pm){toast('Выберите дело');break;}var dup=S.participation.some(function(e){return e.mid===pm&&e.date===pd;});if(dup){toast('По этому делу день участия на эту дату уже учтён');break;}var rec={id:uid(),mid:pm,date:pd,kind:$('#pt-kind').value||'other',place:$('#pt-place').value.trim(),desc:$('#pt-desc').value.trim(),rate:+$('#pt-rate').value||0,created:new Date().toISOString()};S.participation.unshift(rec);addJournal(pm,'День участия: '+(PART_KINDS[rec.kind]||'участие')+(rec.place?' · '+rec.place:''),pd,'participation',true);save();closeSheet();if($('#page').classList.contains('open'))openMatter(pm);render();toast('Учтён 1 день участия');break;}
    case 'part-del': {var pe=S.participation.filter(function(e){return e.id===id;})[0];S.participation=S.participation.filter(function(e){return e.id!==id;});save();if($('#page').classList.contains('open'))openMatter($('#page')._mid);else sheetParticipationLog();render();toast('День участия удалён');break;}

    /* calendar */
    case 'cday': S.ui.calSel=v;save();renderCal();break;
    case 'cal-m': {var pp=S.ui.calM.split('-'),d2=new Date(+pp[0],+pp[1]-1+(+v),1);S.ui.calM=iso(d2).slice(0,7);renderCal();break;}
    case 'cal-today': S.ui.calM=today().slice(0,7);S.ui.calSel=today();renderCal();break;
    case 'new-on-day': editTask(null,{due:S.ui.calSel});break;

    /* helpers */
    case 'templates': sheetTemplates('');break;
    case 'tpl-use': applyTpl(+v,id||'');break;
    case 'deadline': sheetDeadline('');break;
    case 'dl-add': break;
    case 'reports': sheetReports();break;
    case 'notify-sheet': sheetNotify();break;
    case 'rep-back': appBack();break;
    case 'rep-print': doPrint();break;
    case 'rep-share': shareOrCopy(REPORT?REPORT.title:'Отчёт',reportText());break;
    case 'txt-copy': copyText(TXT);break;
    case 'txt-share': shareOrCopy('Ежедневник адвоката',TXT);break;
    case 'print-day': closeAll();printDay();break;
    case 'print-m': closeAll();printMatter(id);break;

    /* settings / data */
    case 'profile': sheetProfile();break;
    case 'p-save': S.settings.name=$('#p-name').value.trim();S.settings.dayRate=+$('#p-dayrate').value||0;S.settings.cur=$('#p-cur').value.trim()||'₽';S.settings.backupEveryDays=Math.min(90,Math.max(1,+$('#p-backdays').value||7));save();closeSheet();render();toast('Профиль сохранён');break;
    case 'pin': sheetPin();break;
    case 'pin-set': {var a1=$('#pin1').value,b1=$('#pin2').value;if(!/^\d{4}$/.test(a1)){toast('Нужны 4 цифры');break;}if(a1!==b1){toast('Коды не совпадают');break;}enablePinEncryption(a1).then(function(){closeSheet();render();toast('PIN-шифрование включено');}).catch(function(){toast('Не удалось включить PIN');});break;}
    case 'pin-off': if(confirm('Отключить PIN? База останется зашифрованной локальным ключом устройства.'))disablePinEncryption().then(function(){closeSheet();render();toast('PIN отключён');});break;
    case 'notify': toggleNotify();break;
    case 'theme': sheetTheme();break;
    case 'theme-set': S.settings.theme=(v==='light'||v==='dark')?v:'auto';S.settings.themeAutoV3114=true;save();closeSheet();render();scheduleThemeBoundary();toast(S.settings.theme==='auto'?'Автотема включена':(S.settings.theme==='light'?'Светлая тема':'Тёмная тема'));break;
    case 'export': exportText();break;
    case 'backup-sheet': sheetBackup();break;
    case 'backup-create': createBackupFile();break;
    case 'restore': $('#file').click();break;
    case 'clearDone': {var n=S.tasks.filter(function(t){return t.done&&!(t.kind==='hearing'&&t.hearingResultStatus);}).length;if(!n){toast('Нет выполненных задач для удаления');break;}if(confirm('Удалить '+n+' выполненных задач? Результаты судебных заседаний останутся в истории.')){S.tasks=S.tasks.filter(function(t){return !t.done||(t.kind==='hearing'&&t.hearingResultStatus);});save();render();toast('Выполненные задачи удалены');}break;}
    case 'demo': demo();closeSheet();break;
    case 'new-task': editTask(null,S.ui.tab==='cal'&&S.ui.calSel?{due:S.ui.calSel}:{due:today()});break;
    case 'intro': showIntro();break;
    case 'wipe': wipeAll();break;
    case 'skip': closeSheet();S.settings.seen=true;S.settings.dismissed=true;save();break;
  }
});
document.addEventListener('change',function(e){
  if(e.target&&e.target.tagName==='SELECT'&&e.target.id) syncPremiumSelectButton(e.target.id);
  if(e.target.id==='e-hjudge-choice'&&ED){
    var jv=e.target.value, ji=$('#e-hjudge');
    if(jv){ED.hearingJudge=jv;if(ji)ji.value=jv;applyKnownJudgeCourt(jv,'hearing');vib(5);}
    e.target.value=''; return;
  }
  if(e.target.id==='e-court-choice'&&ED){
    var cv=e.target.value, ci=$('#e-place');
    if(cv){ED.place=cv;if(ci)ci.value=cv;applyKnownCourtJudge(cv,'hearing');vib(5);}
    e.target.value=''; return;
  }
  if(e.target.id==='m-court-choice'){
    var mv=e.target.value, mi=$('#m-court');
    if(mv){
      if(mi)mi.value=mv;
      if(MED){
        MED.court=mv;
        if(MED.judge&&!judgeAllowedForCourt(MED.judge,mv,MED.type||'',MED.stage||''))MED.judge='';
      }
      applyKnownCourtJudge(mv,'matter');
      renderMatterDynamic();
      vib(5);
    }
    e.target.value=''; return;
  }
  if(e.target.id==='m-basis'){
    if(!MED)return;
    pullMatterDraft();
    MED.basis=e.target.value||'agreement';
    var allowedStages=matterStageList(MED.type||'other',MED.basis||'');
    if(MED.stage!=='Завершено'&&allowedStages.indexOf(MED.stage)<0){
      MED.stage=allowedStages[0]||'';
      MED.court='';MED.judge='';MED.investigator='';MED.role='';MED.restraint='';
      MED.executionIssue='';MED.executionInstitution='';
    }
    MED=sanitizeMatterByType(MED);
    renderMatterDynamic();
    vib(5);
    return;
  }
  if(e.target.id==='m-type'){
    var oldType=(MED&&MED.type)||'other';
    pullMatterDraft();
    var newType=e.target.value||'other';
    MED.type=newType;
    if(oldType!==newType){
      // Тип производства меняет смысл зависимых реквизитов. Не переносим
      // судью из уголовного дела в КоАП, статью УК в другую категорию и т.п.
      MED.court='';MED.judge='';MED.investigator='';MED.article='';MED.role='';MED.restraint='';MED.opponent='';
      MED.executionIssue='';MED.executionInstitution='';
    }
    MED=sanitizeMatterByType(MED);
    renderMatterDynamic();
    vib(5);
    return;
  }
  if(e.target.id==='m-stage'){
    if(!MED)return;
    var oldStage=MED.stage||'',oldMode=matterStageMode(MED.type||'other',oldStage,MED.court||'');
    pullMatterDraft();
    var newStage=e.target.value||MED.stage||'',newCtx=matterPlaceContext(MED.type||'other',newStage,MED.court||'');
    MED.stage=newStage;
    if(oldStage!==newStage){
      // При смене стадии не сохраняем процессуальный статус, который на новой
      // стадии невозможен. Пользователь выбирает актуальный статус доверителя заново.
      MED.role=normalizeMatterClientRole(MED.type||'other',MED.role||'',newStage,MED.executionIssue||'');
      if((MED.type||'other')==='criminal'&&(newStage==='Материал проверки'||newStage==='Исполнение приговора')) MED.restraint='';
      if(newCtx.mode==='judicial'){
        MED.court=''; MED.judge=''; MED.investigator='';
      }else if(newCtx.mode==='investigation'){
        MED.judge='';
        var allowed=matterInvestigationOrgList(newStage).map(function(o){return o.value;});
        if(MED.court&&allowed.indexOf(MED.court)<0)MED.court='';
        if(oldMode!=='investigation'||oldStage!==newStage)MED.investigator='';
      }else if(newCtx.mode==='execution'){
        // Новая стадия исполнения имеет собственную подсудность/орган исполнения.
        // Старый суд, судья или следователь из предыдущей стадии не переносится.
        MED.court=''; MED.judge=''; MED.investigator='';
      }else if(oldMode==='judicial'||oldMode==='investigation'||oldMode==='execution'){
        if(MED.type==='criminal'){MED.executionIssue='';MED.executionInstitution='';}
        MED.court=''; MED.judge=''; MED.investigator='';
      }
    }
    MED=sanitizeMatterByType(MED);
    renderMatterDynamic(); vib(5); return;
  }
  if(e.target.id==='m-execution-issue'){
    if(!MED)return;
    pullMatterDraft(); MED.executionIssue=e.target.value||'';
    MED.role=normalizeMatterClientRole(MED.type||'other',MED.role||'',MED.stage||'',MED.executionIssue||'');
    MED.court=''; MED.judge=''; MED.executionInstitution='';
    renderMatterDynamic(); vib(5); return;
  }
  if(e.target.id==='m-restraint-choice'){ var rr=e.target.value, i3=$('#m-restraint'); if(rr&&i3){ i3.value=rr; MED&& (MED.restraint=rr); vib(5);} e.target.value=''; return; }
  if(e.target.id==='m-judge-choice'){ var jv=e.target.value, ji=$('#m-judge'); if(jv){ if(ji)ji.value=jv; MED&& (MED.judge=jv); applyKnownJudgeCourt(jv,'matter'); vib(5);} e.target.value=''; return; }
  if(e.target.id==='e-deadline-code'){
    ED.deadlineCode=e.target.value;
    var rs=legalDeadlineRules(ED.deadlineCode),sel=$('#e-deadline-rule');
    ED.deadlineRuleId=(rs[0]||{}).id||'';
    if(sel){sel.innerHTML=legalDeadlineRuleOptions(ED.deadlineCode,ED.deadlineRuleId);sel.value=ED.deadlineRuleId;syncPremiumSelectButton('e-deadline-rule');}
    applyDeadlineRuleFromDom(); return;
  }
  if(e.target.id==='e-deadline-rule'||e.target.id==='e-source'||e.target.id==='e-source-time'){pullEditor();applyDeadlineRuleFromDom();return;}
  if(e.target.id&&e.target.id.indexOf('e-')===0){
    pullEditor();
    if(e.target.id==='e-mid' && ED && ED.kind==='hearing'){
      var st=$('#hearing-standalone'); if(st) st.style.display=ED.mid?'none':'';
      if(ED.mid){
        ED.place=hearingCourt(ED.mid);
        var pl=$('#e-place'); if(pl && ED.place) pl.value=ED.place;
        var pm=matter(ED.mid), linkedJudge=(pm&&(pm.judge||pm.investigator))||'';
        if(linkedJudge){
          ED.hearingJudge=linkedJudge;
          var hj=$('#e-hjudge'); if(hj)hj.value=linkedJudge;
          var hp=$('#e-hjudge-choice'); if(hp)hp.value='';
        }
      }
    }
  }
  if(e.target.id==='pt-mid'){
    var pm=matter(e.target.value), pp=$('#pt-place'), pr=$('#pt-rate');
    if(pp) pp.value=(pm&&pm.court)||'';
    if(pr && !pr.value) pr.value=(pm&&pm.dayRate)||S.settings.dayRate||'';
  }
});
document.addEventListener('input',function(e){
  if(e.target.id==='premium-list-search'&&LIST_PICKER){LIST_PICKER.query=e.target.value;renderPremiumListPicker();var q=$('#premium-list-search');if(q){q.focus({preventScroll:true});try{q.setSelectionRange(q.value.length,q.value.length);}catch(_){}}return;}
  if(e.target.id==='q'){S.ui.q=e.target.value;renderTaskList();}
  if(e.target.id==='matter-q'){S.ui.matterQ=e.target.value;renderMatters();return;}
  if(e.target.id==='gq'){GQ=e.target.value;renderGlobalSearch();}
  if(e.target.id==='e-hjudge'&&ED&&ED.kind==='hearing'){
    ED.hearingJudge=e.target.value.trim(); applyKnownJudgeCourt(ED.hearingJudge,'hearing');
  }
  if(e.target.id==='e-place'&&ED&&ED.kind==='hearing'){
    ED.place=e.target.value.trim(); var cc=commonCourtByValue(ED.place); if(cc&&cc.judge)applyKnownCourtJudge(ED.place,'hearing');
  }
  if(e.target.id==='m-judge'){ applyKnownJudgeCourt(e.target.value.trim(),'matter'); }
  if(e.target.id==='m-court'){
    var mcv=e.target.value.trim(),mc=commonCourtByValue(mcv),prevCourt=(MED&&MED.court)||'';
    if(MED){
      MED.court=mcv;
      // При ручной замене суда/органа старый судья не должен оставаться
      // привязанным к новому месту рассмотрения.
      if(prevCourt!==mcv&&MED.judge) MED.judge='';
    }
    if(mc&&mc.judge)applyKnownCourtJudge(mcv,'matter');
  }
  if(e.target.id==='m-phone'){
    var rawPhone=e.target.value||'',rawPos=e.target.selectionStart==null?rawPhone.length:e.target.selectionStart;
    var before=phoneDigitCountBefore(rawPhone,rawPos),rawDigits=String(rawPhone).replace(/\D/g,'');
    /* При вводе номера без 7/8 форматтер добавляет код страны сам — учитываем его в позиции курсора. */
    if(rawDigits&&rawDigits.charAt(0)!=='7'&&rawDigits.charAt(0)!=='8')before++;
    var masked=formatRussianPhone(rawPhone);
    if(e.target.value!==masked)e.target.value=masked;
    if(MED)MED.phone=masked;
    var caret=phoneCaretAfterDigits(masked,before);
    try{e.target.setSelectionRange(caret,caret);}catch(_){ }
  }
});
document.addEventListener('keydown',function(e){
  if(handlePhoneDeleteKey(e))return;
  if(e.key==='Enter'&&e.target.id==='e-title'){e.preventDefault();saveTask();}
});
document.querySelectorAll('.tab').forEach(function(b){b.onclick=function(){if(!unlocked)return;go(b.dataset.tab);vib(5);};});
$('#fab').onclick=function(){if(!unlocked)return;vib(); if(S.ui.tab==='matters' && !$('#page').classList.contains('open')){ closeSheet(); editMatter(null); } else sheetQuickAdd();};
$('#scrim').onclick=function(){if($('#page').classList.contains('open')&&$('#sheet').classList.contains('open'))closeSheet();else closeAll();};
$('#lock-pad').onclick=function(e){var b=e.target.closest('button');if(b&&b.dataset.n)pinPress(b.dataset.n);};
$('#file').onchange=function(e){
  var f=e.target.files[0];if(!f)return;var r=new FileReader();
  r.onload=async function(){
    try{
      var obj=JSON.parse(r.result),pass='';
      if(obj&&obj.encrypted){pass=prompt('Введите пароль резервной копии');if(pass===null){e.target.value='';return;}}
      await restoreBackupObject(obj,pass);
    }catch(err){toast('Не удалось восстановить: неверный пароль или повреждённый файл');}
    e.target.value='';
  };
  r.readAsText(f);
};
document.addEventListener('gesturestart',function(e){e.preventDefault();});

/* =====================================================================
   iPhone-style edge swipe: left edge -> right = Back
   ===================================================================== */
var EDGE_SWIPE={on:false,x:0,y:0,dx:0,dy:0,moved:false};
document.addEventListener('touchstart',function(e){
  if(!unlocked || !e.touches || e.touches.length!==1) return;
  var t=e.touches[0];
  // На основных вкладках горизонтальный жест теперь переключает страницы.
  // Системный edge-swipe «Назад» оставляем только внутри открытых экранов/панелей.
  var overlayOpen=$('#page').classList.contains('open')||$('#sheet').classList.contains('open')||!!LIST_PICKER||!!TIME_PICKER||!!DATE_PICKER;
  EDGE_SWIPE.on = overlayOpen && t.clientX <= 44;
  EDGE_SWIPE.x=t.clientX; EDGE_SWIPE.y=t.clientY; EDGE_SWIPE.dx=0; EDGE_SWIPE.dy=0; EDGE_SWIPE.moved=false;
},{passive:true,capture:true});
document.addEventListener('touchmove',function(e){
  if(!EDGE_SWIPE.on || !e.touches || e.touches.length!==1) return;
  var t=e.touches[0]; EDGE_SWIPE.dx=t.clientX-EDGE_SWIPE.x; EDGE_SWIPE.dy=t.clientY-EDGE_SWIPE.y;
  if(EDGE_SWIPE.dx>12 && Math.abs(EDGE_SWIPE.dx)>Math.abs(EDGE_SWIPE.dy)*1.25){
    EDGE_SWIPE.moved=true;
    if(e.cancelable) e.preventDefault();
  }
},{passive:false,capture:true});
document.addEventListener('touchend',function(){
  if(!EDGE_SWIPE.on) return;
  var ok=EDGE_SWIPE.moved && EDGE_SWIPE.dx>=68 && Math.abs(EDGE_SWIPE.dy)<=70 && EDGE_SWIPE.dx>Math.abs(EDGE_SWIPE.dy)*1.35;
  EDGE_SWIPE.on=false;
  if(ok) appBack();
},{passive:true,capture:true});
document.addEventListener('touchcancel',function(){EDGE_SWIPE.on=false;},{passive:true,capture:true});

/* =====================================================================
   Swipe по задачам / встречам / срокам / прошедшим заседаниям — 4.0.45
   Свайп справа налево открывает «Быстрые действия».
   Для заседания после наступления времени свайп сразу ведёт к фиксации результата.
   Вертикальная прокрутка имеет приоритет; короткий случайный жест ничего не делает.
   ===================================================================== */
var TASK_TOUCH={on:false,row:null,id:'',sx:0,sy:0,dx:0,dy:0,horizontal:false};
function taskTouchReset(animate){
  var row=TASK_TOUCH.row;
  if(row){
    if(animate) row.classList.add('swipe-snap');
    row.style.removeProperty('transform');
    row.classList.remove('swipe-left','swipe-ready');
    if(animate) setTimeout(function(){row.classList.remove('swipe-snap');},190);
  }
  TASK_TOUCH.on=false;TASK_TOUCH.row=null;TASK_TOUCH.id='';TASK_TOUCH.dx=0;TASK_TOUCH.dy=0;TASK_TOUCH.horizontal=false;
}
function finishTaskSwipe(openActions){
  var id=TASK_TOUCH.id;
  taskTouchReset(true);
  if(!openActions || !id) return;
  SWIPE_CLICK_BLOCK_UNTIL=Date.now()+520;
  vib(7);
  setTimeout(function(){sheetTaskActions(id);},40);
}
document.addEventListener('touchstart',function(e){
  if(!unlocked || S.ui.tab!=='tasks' || !e.touches || e.touches.length!==1) return;
  var row=e.target.closest('#tasklist .pt-row');
  if(!row || e.target.closest('[data-act="toggle"]')) return;
  var id=row.dataset.id||'';
  var rec=S.tasks.filter(function(x){return x.id===id;})[0];
  var swipeKindOk=rec && (['task','meeting','deadline'].indexOf(rec.kind)>=0 || (rec.kind==='hearing'&&hearingNeedsResult(rec)));
  if(!swipeKindOk) return;
  var t=e.touches[0];
  if(t.clientX<=44) return; // не конфликтуем с системным свайпом «Назад»
  TASK_TOUCH.on=true;TASK_TOUCH.row=row;TASK_TOUCH.id=id;
  TASK_TOUCH.sx=t.clientX;TASK_TOUCH.sy=t.clientY;TASK_TOUCH.dx=0;TASK_TOUCH.dy=0;TASK_TOUCH.horizontal=false;
  row.classList.remove('swipe-snap');
},{passive:true,capture:true});
document.addEventListener('touchmove',function(e){
  if(!TASK_TOUCH.on || !TASK_TOUCH.row || !e.touches || e.touches.length!==1) return;
  var t=e.touches[0];
  TASK_TOUCH.dx=t.clientX-TASK_TOUCH.sx;TASK_TOUCH.dy=t.clientY-TASK_TOUCH.sy;
  if(!TASK_TOUCH.horizontal){
    if(Math.abs(TASK_TOUCH.dy)>14 && Math.abs(TASK_TOUCH.dy)>Math.abs(TASK_TOUCH.dx)*1.15){taskTouchReset(true);return;}
    if(TASK_TOUCH.dx<-14 && Math.abs(TASK_TOUCH.dx)>Math.abs(TASK_TOUCH.dy)*1.20) TASK_TOUCH.horizontal=true;
  }
  if(!TASK_TOUCH.horizontal) return;
  if(e.cancelable)e.preventDefault();
  var x=Math.max(-108,Math.min(0,TASK_TOUCH.dx));
  TASK_TOUCH.row.style.setProperty('transform','translate3d('+x+'px,0,0)','important');
  TASK_TOUCH.row.classList.toggle('swipe-left',x<=-30);
  TASK_TOUCH.row.classList.toggle('swipe-ready',x<=-78);
},{passive:false,capture:true});
document.addEventListener('touchend',function(){
  if(!TASK_TOUCH.on) return;
  var intentional=TASK_TOUCH.horizontal && TASK_TOUCH.dx<=-78 && Math.abs(TASK_TOUCH.dy)<=70 && Math.abs(TASK_TOUCH.dx)>Math.abs(TASK_TOUCH.dy)*1.25;
  finishTaskSwipe(intentional);
},{passive:true,capture:true});
document.addEventListener('touchcancel',function(){
  if(!TASK_TOUCH.on) return;
  var intentional=TASK_TOUCH.horizontal && TASK_TOUCH.dx<=-88 && Math.abs(TASK_TOUCH.dy)<=70;
  finishTaskSwipe(intentional);
},{passive:true,capture:true});

/* =====================================================================
   Swipe прошедшего заседания на экране «Сегодня» — 4.0.48
   Свайп справа налево сразу открывает фиксацию результата.
   ===================================================================== */
var TODAY_HEARING_TOUCH={on:false,row:null,id:'',sx:0,sy:0,dx:0,dy:0,horizontal:false};
function todayHearingTouchReset(animate){
  var row=TODAY_HEARING_TOUCH.row;
  if(row){
    if(animate) row.classList.add('swipe-snap');
    row.style.removeProperty('transform');
    row.classList.remove('swipe-left','swipe-ready');
    if(animate) setTimeout(function(){row.classList.remove('swipe-snap');},190);
  }
  TODAY_HEARING_TOUCH.on=false;TODAY_HEARING_TOUCH.row=null;TODAY_HEARING_TOUCH.id='';TODAY_HEARING_TOUCH.dx=0;TODAY_HEARING_TOUCH.dy=0;TODAY_HEARING_TOUCH.horizontal=false;
}
function resetAllTodayHearingSwipes(){
  $$('#sc-today .today-hearing-swipe-row').forEach(function(row){
    row.classList.add('swipe-snap');
    row.style.removeProperty('transform');
    row.classList.remove('swipe-left','swipe-ready');
    setTimeout(function(){row.classList.remove('swipe-snap');},190);
  });
}
function finishTodayHearingSwipe(openResult){
  var id=TODAY_HEARING_TOUCH.id;
  todayHearingTouchReset(true);
  if(!openResult || !id) return;
  SWIPE_CLICK_BLOCK_UNTIL=Date.now()+520;
  vib(7);
  setTimeout(function(){sheetHearingResult(id);},40);
}
document.addEventListener('touchstart',function(e){
  if(!unlocked || S.ui.tab!=='today' || !e.touches || e.touches.length!==1) return;
  var row=e.target.closest('#sc-today .today-hearing-swipe-row');
  if(!row) return;
  var id=row.dataset.id||'',rec=S.tasks.filter(function(x){return x.id===id;})[0];
  if(!rec || rec.kind!=='hearing' || !hearingNeedsResult(rec)) return;
  var t=e.touches[0];
  if(t.clientX<=44) return;
  TODAY_HEARING_TOUCH.on=true;TODAY_HEARING_TOUCH.row=row;TODAY_HEARING_TOUCH.id=id;
  TODAY_HEARING_TOUCH.sx=t.clientX;TODAY_HEARING_TOUCH.sy=t.clientY;TODAY_HEARING_TOUCH.dx=0;TODAY_HEARING_TOUCH.dy=0;TODAY_HEARING_TOUCH.horizontal=false;
  row.classList.remove('swipe-snap');
},{passive:true,capture:true});
document.addEventListener('touchmove',function(e){
  if(!TODAY_HEARING_TOUCH.on || !TODAY_HEARING_TOUCH.row || !e.touches || e.touches.length!==1) return;
  var t=e.touches[0];
  TODAY_HEARING_TOUCH.dx=t.clientX-TODAY_HEARING_TOUCH.sx;TODAY_HEARING_TOUCH.dy=t.clientY-TODAY_HEARING_TOUCH.sy;
  if(!TODAY_HEARING_TOUCH.horizontal){
    if(Math.abs(TODAY_HEARING_TOUCH.dy)>14 && Math.abs(TODAY_HEARING_TOUCH.dy)>Math.abs(TODAY_HEARING_TOUCH.dx)*1.15){todayHearingTouchReset(true);return;}
    if(TODAY_HEARING_TOUCH.dx<-14 && Math.abs(TODAY_HEARING_TOUCH.dx)>Math.abs(TODAY_HEARING_TOUCH.dy)*1.20) TODAY_HEARING_TOUCH.horizontal=true;
  }
  if(!TODAY_HEARING_TOUCH.horizontal) return;
  if(e.cancelable)e.preventDefault();
  var x=Math.max(-104,Math.min(0,TODAY_HEARING_TOUCH.dx));
  TODAY_HEARING_TOUCH.row.style.setProperty('transform','translate3d('+x+'px,0,0)','important');
  TODAY_HEARING_TOUCH.row.classList.toggle('swipe-left',x<=-30);
  TODAY_HEARING_TOUCH.row.classList.toggle('swipe-ready',x<=-72);
},{passive:false,capture:true});
document.addEventListener('touchend',function(){
  if(!TODAY_HEARING_TOUCH.on) return;
  var intentional=TODAY_HEARING_TOUCH.horizontal && TODAY_HEARING_TOUCH.dx<=-72 && Math.abs(TODAY_HEARING_TOUCH.dy)<=70 && Math.abs(TODAY_HEARING_TOUCH.dx)>Math.abs(TODAY_HEARING_TOUCH.dy)*1.25;
  finishTodayHearingSwipe(intentional);
},{passive:true,capture:true});
document.addEventListener('touchcancel',function(){
  if(!TODAY_HEARING_TOUCH.on) return;
  var intentional=TODAY_HEARING_TOUCH.horizontal && TODAY_HEARING_TOUCH.dx<=-92 && Math.abs(TODAY_HEARING_TOUCH.dy)<=70;
  finishTodayHearingSwipe(intentional);
},{passive:true,capture:true});

/* =====================================================================
   iPhone-style bottom sheet: pull the top area down = Close
   ===================================================================== */
var SHEET_SWIPE={on:false,x:0,y:0,dx:0,dy:0,moved:false};
document.addEventListener('touchstart',function(e){
  if(!unlocked || !e.touches || e.touches.length!==1) return;
  var s=$('#sheet');
  if(!s || !s.classList.contains('open') || s.classList.contains('full')) return;
  var t=e.touches[0],r=s.getBoundingClientRect();
  // The whole visual handle/header zone is draggable, not just the 4px grabber.
  if(t.clientY < r.top || t.clientY > r.top+108) return;
  SHEET_SWIPE.on=true;SHEET_SWIPE.x=t.clientX;SHEET_SWIPE.y=t.clientY;
  SHEET_SWIPE.dx=0;SHEET_SWIPE.dy=0;SHEET_SWIPE.moved=false;
},{passive:true,capture:true});
document.addEventListener('touchmove',function(e){
  if(!SHEET_SWIPE.on || !e.touches || e.touches.length!==1) return;
  var t=e.touches[0];
  SHEET_SWIPE.dx=t.clientX-SHEET_SWIPE.x;SHEET_SWIPE.dy=t.clientY-SHEET_SWIPE.y;
  if(SHEET_SWIPE.dy>10 && SHEET_SWIPE.dy>Math.abs(SHEET_SWIPE.dx)*1.15){
    SHEET_SWIPE.moved=true;
    if(e.cancelable) e.preventDefault();
  }
},{passive:false,capture:true});
document.addEventListener('touchend',function(){
  if(!SHEET_SWIPE.on) return;
  var ok=SHEET_SWIPE.moved && SHEET_SWIPE.dy>=64 && SHEET_SWIPE.dy>Math.abs(SHEET_SWIPE.dx)*1.2;
  SHEET_SWIPE.on=false;
  if(ok){vib(5);closeSheet();}
},{passive:true,capture:true});
document.addEventListener('touchcancel',function(){SHEET_SWIPE.on=false;},{passive:true,capture:true});

/* =====================================================================
   4.0.70 — поиск на странице «Задачи» приведён к шапке «Сегодня»
   По принятой в приложении логике пользователя:
   свайп слева направо = предыдущая вкладка, свайп справа налево = следующая.
   Вертикальная прокрутка, формы, горизонтальные ленты и локальные свайпы
   карточек всегда имеют приоритет.
   ===================================================================== */
var MAIN_TAB_ORDER=['today','tasks','matters','cal','more'];
var PAGE_SWIPE={on:false,sx:0,sy:0,dx:0,dy:0,horizontal:false};
function pageSwipeReset(){
  PAGE_SWIPE.on=false;PAGE_SWIPE.sx=0;PAGE_SWIPE.sy=0;PAGE_SWIPE.dx=0;PAGE_SWIPE.dy=0;PAGE_SWIPE.horizontal=false;
}
function hasHorizontalScrollAncestor(target){
  var n=target;
  while(n && n!==document.body){
    if(n.classList && n.classList.contains('screen')) break;
    if(n.scrollWidth>n.clientWidth+8){
      var cs=window.getComputedStyle?getComputedStyle(n):null;
      var ox=cs?cs.overflowX:'';
      if(ox==='auto'||ox==='scroll') return true;
    }
    n=n.parentElement;
  }
  return false;
}
function pageSwipeTargetAllowed(target){
  if(!target || !target.closest) return false;
  if($('#sheet').classList.contains('open')||$('#page').classList.contains('open')||LIST_PICKER||TIME_PICKER||DATE_PICKER) return false;
  if(target.closest('#lock,.tabbar,#fab,.timerpill,input,textarea,select,[contenteditable="true"]')) return false;
  // Здесь уже существуют собственные горизонтальные жесты — не перехватываем их.
  if(target.closest('#tasklist .pt-row,#sc-today .today-hearing-swipe-row')) return false;
  if(hasHorizontalScrollAncestor(target)) return false;
  return true;
}
function finishPageSwipe(){
  if(!PAGE_SWIPE.on) return;
  var dx=PAGE_SWIPE.dx,dy=PAGE_SWIPE.dy;
  var intentional=PAGE_SWIPE.horizontal && Math.abs(dx)>=72 && Math.abs(dy)<=76 && Math.abs(dx)>Math.abs(dy)*1.28;
  pageSwipeReset();
  if(!intentional) return;
  var idx=MAIN_TAB_ORDER.indexOf(S.ui.tab);
  if(idx<0) return;
  // Естественная навигация: слева направо — назад, справа налево — вперёд.
  var nextIdx=dx>0?idx-1:idx+1;
  if(nextIdx<0 || nextIdx>=MAIN_TAB_ORDER.length){vib(3);return;}
  SWIPE_CLICK_BLOCK_UNTIL=Date.now()+520;
  vib(6);
  go(MAIN_TAB_ORDER[nextIdx],false,dx>0?'prev':'next');
}
document.addEventListener('touchstart',function(e){
  if(!unlocked || !e.touches || e.touches.length!==1) return;
  if(!pageSwipeTargetAllowed(e.target)) return;
  var t=e.touches[0];
  PAGE_SWIPE.on=true;PAGE_SWIPE.sx=t.clientX;PAGE_SWIPE.sy=t.clientY;PAGE_SWIPE.dx=0;PAGE_SWIPE.dy=0;PAGE_SWIPE.horizontal=false;
},{passive:true,capture:true});
document.addEventListener('touchmove',function(e){
  if(!PAGE_SWIPE.on || !e.touches || e.touches.length!==1) return;
  var t=e.touches[0];
  PAGE_SWIPE.dx=t.clientX-PAGE_SWIPE.sx;PAGE_SWIPE.dy=t.clientY-PAGE_SWIPE.sy;
  if(!PAGE_SWIPE.horizontal){
    if(Math.abs(PAGE_SWIPE.dy)>14 && Math.abs(PAGE_SWIPE.dy)>Math.abs(PAGE_SWIPE.dx)*1.12){pageSwipeReset();return;}
    if(Math.abs(PAGE_SWIPE.dx)>16 && Math.abs(PAGE_SWIPE.dx)>Math.abs(PAGE_SWIPE.dy)*1.22) PAGE_SWIPE.horizontal=true;
  }
  if(PAGE_SWIPE.horizontal && e.cancelable) e.preventDefault();
},{passive:false,capture:true});
document.addEventListener('touchend',finishPageSwipe,{passive:true,capture:true});
document.addEventListener('touchcancel',pageSwipeReset,{passive:true,capture:true});

/* =====================================================================
   BOOT
   ===================================================================== */
var APP_STARTED=false,hiddenAt=0;
function afterUnlock(){
  if(!unlocked)return;
  if(!APP_STARTED){
    S.ui.tab='today';
    S.ui.q='';
    S.ui._sq=false;
    NAV_TABS=[];
    closeAll();
    save();
  }
  render();schedule();scheduleThemeBoundary();
  if(!APP_STARTED){
    APP_STARTED=true;setInterval(schedule,15*60*1000);
    var hearingSig=S.tasks.filter(hearingNeedsResult).map(function(t){return t.id;}).sort().join('|');
    setInterval(function(){if(!unlocked)return;var sig=S.tasks.filter(hearingNeedsResult).map(function(t){return t.id;}).sort().join('|');if(sig!==hearingSig){hearingSig=sig;render();}},30000);
    if(!S.settings.seen||(noData()&&!S.settings.dismissed)){S.settings.seen=true;save();setTimeout(showIntro,500);}
  }
}
async function boot(){
  META=getMeta();drawPad();
  if(pinEnabled()){lockShow('Введите PIN для расшифровки базы');return;}
  try{await bootLoadDevice();afterUnlock();}
  catch(e){
    // If IndexedDB is unavailable, keep an in-memory empty workspace rather than failing to start.
    S=mergeState(DEF);unlocked=true;afterUnlock();toast('Хранилище браузера недоступно: работает временный режим');
  }
}
boot();

document.addEventListener('visibilitychange',function(){
  if(document.hidden){hiddenAt=Date.now();flushSave();return;}
  var wasAway=hiddenAt&&Date.now()-hiddenAt>1200;
  if(pinEnabled()&&S.settings.lockOnReturn&&hiddenAt&&Date.now()-hiddenAt>60000){
    S=clone(DEF);SESSION_KEY=null;unlocked=false;lockShow('Введите PIN после возврата в приложение');return;
  }
  if(unlocked){
    if(wasAway){
      closeAll();
      NAV_TABS=[];
      S.ui.tab='today';
      S.ui.q='';
      S.ui._sq=false;
      save();
    }
    render();schedule();scheduleThemeBoundary();
  }
});
if('serviceWorker' in navigator){
  window.addEventListener('load',function(){
    var reloading=false;
    navigator.serviceWorker.addEventListener('controllerchange',function(){
      if(reloading)return; reloading=true; window.location.reload();
    });
    navigator.serviceWorker.register('./sw.js', {updateViaCache:'none'}).then(function(reg){
      try{ reg.update(); }catch(e){}
      reg.update().catch(function(){});
      if(reg.waiting)reg.waiting.postMessage('SKIP_WAITING');
      reg.addEventListener('updatefound',function(){
        var w=reg.installing;if(!w)return;
        w.addEventListener('statechange',function(){
          if(w.state==='installed' && navigator.serviceWorker.controller) w.postMessage('SKIP_WAITING');
        });
      });
    }).catch(function(){});
  });
}
if(navigator.storage&&navigator.storage.persist){navigator.storage.persist().catch(function(){});}
window.addEventListener('pagehide',function(){ if(unlocked) flushSave(); });
window.addEventListener('offline',function(){if(unlocked)toast('Офлайн-режим: ежедневник продолжает работать');});
window.addEventListener('online',function(){if(unlocked)toast('Подключение восстановлено');});
