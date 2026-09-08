/* =====================================================================
   Ежедневник адвоката — личный помощник
   Vanilla JS, офлайн, данные только на устройстве
   ===================================================================== */
'use strict';

var APP_VERSION='4.0.17';
var APP_BUILD='4017';

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
    showArch:false, matterType:'', matterBasis:'', matterStage:'', matterScope:'active', taskGroupOpen:{}
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
  out.matters = Array.isArray(d.matters)?d.matters:[];
  out.tasks = Array.isArray(d.tasks)?d.tasks:[];
  out.tasks.forEach(function(t){
    if(!t) return;
    if(t.kind==='call' || t.kind==='doc') t.kind='task';
    if(t.done && !t.doneAt) t.doneAt=new Date().toISOString();
  });
  out.participation = Array.isArray(d.participation)?d.participation:[];
  out.journal = Array.isArray(d.journal)?d.journal:[];
  out.time = Array.isArray(d.time)?d.time:[];
  // Migration: hourly-rate fields become day-rate defaults; old time logs become participation days.
  out.matters.forEach(function(m){
    if(m.dayRate==null) m.dayRate = 0;
    if(!m.type) m.type = 'other';
    if(!m.stage) m.stage = 'Первая инстанция';
    if(typeof m.basis!=='string') m.basis = '';
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
  {id:'gpk-simple-appeal',code:'GPK',name:'Апелляция — упрощённое производство',article:'ч. 8 ст. 232.4 ГПК РФ',unit:'workdays',n:15,dateLabel:'Дата принятия решения / окончательной формы',note:'15 рабочих дней; при составлении мотивированного решения по заявлению — со дня принятия решения в окончательной форме.'},
  {id:'gpk-private',code:'GPK',name:'Частная жалоба на определение',article:'ст. 332 ГПК РФ',unit:'workdays',n:15,dateLabel:'Дата вынесения определения',note:'15 рабочих дней, если иной срок прямо не установлен ГПК РФ.'},
  {id:'gpk-order',code:'GPK',name:'Возражения на судебный приказ',article:'ст. 128 ГПК РФ',unit:'workdays',n:10,dateLabel:'Дата получения судебного приказа',note:'10 рабочих дней со дня получения судебного приказа.'},
  {id:'gpk-default',code:'GPK',name:'Отмена заочного решения',article:'ч. 1 ст. 237 ГПК РФ',unit:'workdays',n:7,dateLabel:'Дата вручения копии заочного решения',note:'7 рабочих дней со дня вручения копии заочного решения.'},
  {id:'gpk-cass',code:'GPK',name:'Кассационная жалоба',article:'ст. 376.1 ГПК РФ',unit:'months',n:3,dateLabel:'Дата вступления акта в силу / мотивированного апелляционного определения',note:'3 месяца. Если акт был обжалован в апелляции — срок исчисляется со дня изготовления мотивированного апелляционного определения.'},
  {id:'gpk-supervision',code:'GPK',name:'Надзорная жалоба',article:'ч. 2 ст. 391.2 ГПК РФ',unit:'months',n:3,dateLabel:'Дата вступления судебного постановления в законную силу',note:'3 месяца со дня вступления судебного постановления в законную силу.'},
  {id:'gpk-costs',code:'GPK',name:'Заявление о судебных расходах',article:'ст. 103.1 ГПК РФ',unit:'months',n:3,dateLabel:'Дата вступления в силу последнего судебного акта',note:'3 месяца со дня вступления в законную силу последнего судебного акта, которым закончено рассмотрение дела.'},
  {id:'gpk-simple-motive',code:'GPK',name:'Заявление о мотивированном решении — упрощённое',article:'ч. 3 ст. 232.4 ГПК РФ',unit:'workdays',n:5,dateLabel:'Дата подписания резолютивной части',note:'5 рабочих дней со дня подписания резолютивной части решения.'},

  /* АПК РФ */
  {id:'apk-appeal',code:'APK',name:'Апелляционная жалоба на решение',article:'ч. 1 ст. 259 АПК РФ',unit:'months',n:1,dateLabel:'Дата принятия решения',note:'1 месяц после принятия решения, если иной срок не установлен АПК РФ.'},
  {id:'apk-simple-appeal',code:'APK',name:'Апелляция — упрощённое производство',article:'ч. 4 ст. 229 АПК РФ',unit:'workdays',n:15,dateLabel:'Дата принятия решения / решения в полном объёме',note:'15 рабочих дней; при составлении мотивированного решения — со дня принятия решения в полном объёме.'},
  {id:'apk-ruling',code:'APK',name:'Жалоба на определение суда',article:'ч. 3 ст. 188 АПК РФ',unit:'months',n:1,dateLabel:'Дата вынесения определения',note:'Не более 1 месяца со дня вынесения определения, если иной срок не установлен АПК РФ.'},
  {id:'apk-cass',code:'APK',name:'Кассационная жалоба',article:'ч. 1 ст. 276 АПК РФ',unit:'months',n:2,dateLabel:'Дата вступления судебного акта в законную силу',note:'Не более 2 месяцев со дня вступления обжалуемого судебного акта в законную силу.'},
  {id:'apk-costs',code:'APK',name:'Заявление о судебных расходах',article:'ч. 2 ст. 112 АПК РФ',unit:'months',n:3,dateLabel:'Дата вступления в силу последнего судебного акта',note:'3 месяца со дня вступления в законную силу последнего судебного акта.'},
  {id:'apk-simple-motive',code:'APK',name:'Заявление о мотивированном решении — упрощённое',article:'ч. 2 ст. 229 АПК РФ',unit:'workdays',n:5,dateLabel:'Дата размещения решения в сети Интернет',note:'5 рабочих дней со дня размещения решения, принятого в упрощённом производстве.'},

  /* КАС РФ */
  {id:'kas-appeal',code:'KAS',name:'Апелляционная жалоба',article:'ч. 1 ст. 298 КАС РФ',unit:'months',n:1,dateLabel:'Дата принятия решения в окончательной форме',note:'1 месяц со дня принятия решения суда в окончательной форме, если КАС РФ не установлен специальный срок.'},
  {id:'kas-private',code:'KAS',name:'Частная жалоба на определение',article:'ч. 1 ст. 314 КАС РФ',unit:'workdays',n:15,dateLabel:'Дата вынесения определения',note:'15 рабочих дней, если специальный срок не установлен ст. 314 КАС РФ.'},
  {id:'kas-cass',code:'KAS',name:'Кассационная жалоба',article:'ч. 2 ст. 318 КАС РФ',unit:'months',n:6,dateLabel:'Дата вступления судебного акта в законную силу',note:'6 месяцев со дня вступления судебного акта в законную силу при соблюдении условий кассационного обжалования.'},
  {id:'kas-supervision',code:'KAS',name:'Надзорная жалоба',article:'ч. 2 ст. 333 КАС РФ',unit:'months',n:3,dateLabel:'Дата вступления судебного акта в законную силу',note:'3 месяца со дня вступления судебного акта в законную силу.'},
  {id:'kas-costs',code:'KAS',name:'Заявление о судебных расходах',article:'ст. 114.1 КАС РФ',unit:'months',n:3,dateLabel:'Дата вступления в силу последнего судебного акта',note:'3 месяца со дня вступления в законную силу последнего судебного акта.'},
  {id:'kas-claim-general',code:'KAS',name:'Административный иск — общий срок',article:'ч. 1 ст. 219 КАС РФ',unit:'months',n:3,dateLabel:'Дата, когда стало известно о нарушении права',note:'3 месяца со дня, когда стало известно о нарушении прав, если специальный срок не установлен.'},
  {id:'kas-bailiff',code:'KAS',name:'Иск об оспаривании действий / бездействия пристава',article:'ч. 3 ст. 219 КАС РФ',unit:'workdays',n:10,dateLabel:'Дата, когда стало известно о нарушении права',note:'10 рабочих дней со дня, когда стало известно о нарушении права.'},

  /* УПК РФ */
  {id:'upk-appeal',code:'UPK',name:'Апелляционная жалоба — общий случай',article:'ч. 1 ст. 389.4 УПК РФ',unit:'caldays',n:15,dateLabel:'Дата постановления приговора / вынесения решения',note:'15 суток. Нерабочие дни входят в срок; если последний день нерабочий — окончание переносится на следующий рабочий день.'},
  {id:'upk-appeal-custody',code:'UPK',name:'Апелляция — осуждённый под стражей',article:'ч. 1 ст. 389.4 УПК РФ',unit:'caldays',n:15,dateLabel:'Дата вручения копии приговора / решения осуждённому',note:'15 суток со дня вручения копии осуждённому, содержащемуся под стражей.'},
  {id:'upk-cass',code:'UPK',name:'Кассационная жалоба — сплошная кассация',article:'ч. 4 ст. 401.3 УПК РФ',unit:'months',n:6,dateLabel:'Дата вступления итогового судебного решения в законную силу',note:'6 месяцев для жалоб, рассматриваемых в порядке ст. 401.7 и 401.8 УПК РФ.'},
  {id:'upk-cass-custody',code:'UPK',name:'Кассация — осуждённый под стражей',article:'ч. 4 ст. 401.3 УПК РФ',unit:'months',n:6,dateLabel:'Дата вручения копии вступившего в силу решения',note:'6 месяцев со дня вручения осуждённому под стражей копии вступившего в силу итогового судебного решения.'},

  /* КоАП РФ */
  {id:'koap-appeal',code:'KOAP',name:'Жалоба на постановление по делу об АП',article:'ч. 1 ст. 30.3 КоАП РФ',unit:'caldays',n:10,dateLabel:'Дата вручения / получения копии постановления',note:'10 календарных дней; начало — со следующего дня, последний нерабочий день переносится на следующий рабочий.'},
  {id:'koap-appeal-election',code:'KOAP',name:'Жалоба по отдельным избирательным составам',article:'ч. 3 ст. 30.3 КоАП РФ',unit:'caldays',n:5,dateLabel:'Дата вручения / получения копии постановления',note:'5 календарных дней для составов, прямо перечисленных в ч. 3 ст. 30.3 КоАП РФ.'},
  {id:'koap-followup',code:'KOAP',name:'Жалоба на решение по жалобе',article:'ст. 30.9 во взаимосвязи со ст. 30.3 КоАП РФ',unit:'caldays',n:10,dateLabel:'Дата вручения / получения копии решения',note:'Последующая жалоба подаётся в порядке и сроки, установленные ст. 30.2–30.8 КоАП РФ.'},

  /* Исполнительное производство */
  {id:'fssp-complaint',code:'FSSP',name:'Жалоба на постановление / действие пристава',article:'ст. 122, ч. 2 ст. 15 Закона № 229-ФЗ',unit:'workdays',n:10,dateLabel:'Дата постановления / действия / установления бездействия',note:'10 рабочих дней. Для лица, не извещённого о действии, — со дня, когда оно узнало или должно было узнать.'}
];
function legalDeadlineCode(id){ return LEGAL_DEADLINE_CODES.filter(function(x){return x.id===id;})[0]||LEGAL_DEADLINE_CODES[0]; }
function legalDeadlineRule(id){ return LEGAL_DEADLINE_RULES.filter(function(x){return x.id===id;})[0]||null; }
function legalDeadlineRules(code){ return LEGAL_DEADLINE_RULES.filter(function(x){return x.code===code;}); }
function legalDeadlineCodeOptions(value){
  return LEGAL_DEADLINE_CODES.map(function(c){return '<option value="'+c.id+'"'+(c.id===value?' selected':'')+'>'+esc(c.name)+'</option>';}).join('');
}
function legalDeadlineRuleOptions(code,value){
  var a=legalDeadlineRules(code); return a.map(function(r){return '<option value="'+r.id+'"'+(r.id===value?' selected':'')+'>'+esc(r.name)+'</option>';}).join('');
}
function legalDeadlineTerm(r){
  if(!r)return '';
  if(r.unit==='months') return r.n+' '+plural(r.n,'месяц','месяца','месяцев');
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
function calculateLegalDeadline(rule,from){
  if(!rule||!from)return null;
  var raw,end,start=addD(from,1),shifted=false;
  if(rule.unit==='workdays') raw=addWorkingDaysLegal(from,rule.n);
  else if(rule.unit==='months') raw=addM(from,rule.n);
  else raw=addD(from,rule.n);
  end=raw;
  if(rule.unit!=='workdays'&&isNonWorkingDate(end)){end=nextWorkingDate(end);shifted=end!==raw;}
  var yr=parseD(from).getFullYear(),ey=parseD(end).getFullYear();
  return {from:from,start:start,raw:raw,end:end,shifted:shifted,calendarExact:(yr===2026&&ey===2026)};
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
  if(!res)return '<div class="deadline-calc-empty"><b>'+esc(rule.dateLabel)+'</b><br>Укажите исходную дату — крайний срок рассчитается автоматически.</div>';
  var note=res.shifted?'<div class="deadline-calc-shift">Последний день пришёлся на нерабочий день — срок перенесён с '+fmtD(res.raw,true)+' на следующий рабочий день.</div>':'';
  var warn=!res.calendarExact?'<div class="deadline-calc-warn">Для дат вне 2026 года учитываются выходные и федеральные праздники, но переносы выходных Правительством могут требовать обновления календаря.</div>':'';
  return '<div class="deadline-calc-result"><small>Крайний срок подачи</small><b>'+fmtD(res.end,true)+'</b><em>'+cap(DOW[parseD(res.end).getDay()])+'</em><div class="deadline-calc-law"><strong>'+esc(rule.article)+'</strong><span>'+esc(legalDeadlineTerm(rule))+'</span></div><p>'+esc(rule.note)+'</p>'+note+warn+'</div>';
}
function applyDeadlineRuleFromDom(){
  if(!ED||ED.kind!=='deadline')return null;
  var ce=$('#e-deadline-code'),re=$('#e-deadline-rule'),se=$('#e-source');
  if(ce)ED.deadlineCode=ce.value;
  if(re)ED.deadlineRuleId=re.value;
  if(se)ED.sourceDate=se.value;
  var rule=legalDeadlineRule(ED.deadlineRuleId),res=calculateLegalDeadline(rule,ED.sourceDate);
  if(rule){
    ED.title=rule.name; ED.ruleCode=legalDeadlineCode(rule.code).name; ED.ruleArticle=rule.article; ED.rule=rule.article; ED.pri='high';
    if(res)ED.due=res.end;
  }
  var out=$('#e-deadline-result'); if(out)out.innerHTML=deadlineCalcResultHTML(rule,res);
  var lab=$('#e-source-label'); if(lab&&rule)lab.textContent=rule.dateLabel;
  return {rule:rule,res:res};
}
function inferDeadlineRuleParts(t){
  var r=deadlineRuleFromTask(t); if(r)return {code:r.code,article:r.article,ruleId:r.id};
  return {code:'GPK',article:(t&&t.rule)||'',ruleId:''};
}
var PRI = { high:{n:'Срочно',c:'red'}, mid:{n:'Обычный',c:'yel'}, low:{n:'Низкий',c:''} };
var STAGE = ['Консультация','Досудебная работа','Дознание / следствие','Первая инстанция','Апелляция','Кассация','Надзор','Исполнение','Завершено'];
var MATTER_TYPES = {
  criminal:{n:'Уголовное',short:'УК',c:'#E15B57'}, civil:{n:'Гражданское',short:'ГПК',c:'#4E86C6'},
  admin:{n:'Административное (КАС)',short:'КАС',c:'#35A996'}, koap:{n:'КоАП',short:'КоАП',c:'#D98A2B'},
  other:{n:'Иное',short:'Иное',c:'#7A8FA6'}
};
var MATTER_BASIS = {
  agreement:{n:'По соглашению',short:'Соглашение',c:'#2FA08E'},
  assigned:{n:'По назначению',short:'Назначение',c:'#8A6AD8'}
};
var PART_KINDS = { hearing:'Судебное заседание',investigation:'Следственное действие',visit:'Выезд / посещение',meeting:'Встреча',other:'Иное участие' };

var MATTER_STAGE_MAP = {
  criminal:['Консультация','Досудебная работа','Проверка сообщения','Дознание / следствие','Первая инстанция','Апелляция','Кассация','Надзор','Исполнение','Завершено'],
  civil:['Консультация','Досудебная работа','Первая инстанция','Апелляция','Кассация','Надзор','Исполнение','Завершено'],
  admin:['Консультация','Досудебная работа','Первая инстанция','Апелляция','Кассация','Надзор','Исполнение','Завершено'],
  koap:['Консультация','Проверка / административное расследование','Первая инстанция','Пересмотр / апелляция','Исполнение','Завершено'],
  other:STAGE.slice()
};
var MATTER_ROLE_MAP = {
  criminal:['подозреваемый','обвиняемый','подсудимый','осужденный','потерпевший','свидетель','гражданский истец','гражданский ответчик'],
  civil:['истец','ответчик','третье лицо','заявитель','заинтересованное лицо','представитель'],
  admin:['административный истец','административный ответчик','заявитель','заинтересованное лицо','представитель'],
  koap:['лицо, привлекаемое к административной ответственности','потерпевший','законный представитель','защитник','представитель'],
  other:['заявитель','истец','ответчик','представитель']
};
var MATTER_RESTRAINT_MAP = {
  criminal:['подписка о невыезде','запрет определённых действий','личное поручительство','залог','домашний арест','заключение под стражу','наблюдение командования воинской части']
};
var MATTER_ARTICLE_HINTS = {
  criminal:'Например: ч. 2 ст. 228 УК РФ',
  koap:'Например: ч. 1 ст. 12.8 КоАП РФ',
  other:'Статья, договор, основание спора — при необходимости'
};
function matterStageList(type){ return (MATTER_STAGE_MAP[type]||STAGE).slice(); }
function matterRoleList(type){ return (MATTER_ROLE_MAP[type]||MATTER_ROLE_MAP.other).slice(); }
function matterRestraintList(type){ return (MATTER_RESTRAINT_MAP[type]||[]).slice(); }
function matterChoiceOptions(list,current,emptyLabel){
  return '<option value="">'+esc(emptyLabel||'— выбрать —')+'</option>'+list.map(function(x){ return '<option value="'+esc(x)+'"'+(current===x?' selected':'')+'>'+esc(x)+'</option>'; }).join('');
}
function matterChoiceDatalist(id,list){ return '<datalist id="'+id+'">'+list.map(function(x){ return '<option value="'+esc(x)+'"></option>'; }).join('')+'</datalist>'; }
function inlineMatterChoiceField(inputId,selectId,value,placeholder,list,emptyLabel,listId){
  listId=listId||('list-'+inputId);
  return inlineChoiceField(inputId,selectId,value,placeholder,matterChoiceOptions(list,value,emptyLabel),listId)+matterChoiceDatalist(listId,list);
}
function matterMeta(type){
  var t=type||'other';
  var base={
    numberLabel:'Номер дела / материала', courtLabel:'Суд / орган / ведомство', judgeLabel:'Судья', investigatorLabel:'Следователь / дознаватель',
    clientLabel:'Доверитель', clientPlaceholder:'ФИО / организация', titlePlaceholder:'Иванов И.И. — взыскание долга',
    roleLabel:'Статус лица', opponentLabel:'Оппонент / другая сторона', opponentPlaceholder:'ФИО / организация',
    showJudge:true, showInvestigator:false, showArticle:false, showRestraint:false, showOpponent:true,
    stageList:matterStageList(t), roleList:matterRoleList(t), restraintList:matterRestraintList(t), articlePlaceholder:MATTER_ARTICLE_HINTS[t]||''
  };
  if(t==='criminal') return Object.assign(base,{
    numberLabel:'Номер дела / материала', courtLabel:'Суд / следственный орган / ведомство', clientLabel:'Подзащитный / доверитель',
    clientPlaceholder:'ФИО подзащитного / доверителя', titlePlaceholder:'Иванов И.И. — защита по уголовному делу',
    roleLabel:'Процессуальный статус', opponentLabel:'Потерпевший / иной участник', opponentPlaceholder:'Потерпевший, гражданский истец…',
    showJudge:true, showInvestigator:true, showArticle:true, showRestraint:true, showOpponent:true
  });
  if(t==='civil') return Object.assign(base,{
    numberLabel:'Номер дела', courtLabel:'Суд / орган / ведомство', clientLabel:'Доверитель', titlePlaceholder:'Иванов И.И. — взыскание долга',
    roleLabel:'Процессуальный статус', opponentLabel:'Ответчик / другая сторона', opponentPlaceholder:'Ответчик, истец по встречному иску…',
    showJudge:true, showInvestigator:false, showArticle:false, showRestraint:false, showOpponent:true
  });
  if(t==='admin') return Object.assign(base,{
    numberLabel:'Номер дела', courtLabel:'Суд / административный орган', clientLabel:'Доверитель', titlePlaceholder:'Иванов И.И. — административный иск',
    roleLabel:'Процессуальный статус', opponentLabel:'Административный ответчик / орган', opponentPlaceholder:'Орган, должностное лицо…',
    showJudge:true, showInvestigator:false, showArticle:false, showRestraint:false, showOpponent:true
  });
  if(t==='koap') return Object.assign(base,{
    numberLabel:'Номер дела / протокола', courtLabel:'Суд / орган / должностное лицо', clientLabel:'Лицо / доверитель', titlePlaceholder:'Иванов И.И. — дело по КоАП',
    judgeLabel:'Судья / должностное лицо', roleLabel:'Статус лица', opponentLabel:'Орган / потерпевший', opponentPlaceholder:'Отдел МВД, инспектор, потерпевший…',
    showJudge:true, showInvestigator:false, showArticle:true, showRestraint:false, showOpponent:true
  });
  return Object.assign(base,{
    titlePlaceholder:'Иванов И.И. — рабочее дело', roleLabel:'Статус / роль', showJudge:true, showInvestigator:false,
    showArticle:true, showRestraint:false, showOpponent:true
  });
}
function pullMatterDraft(){
  if(!MED)return;
  var map={type:'#m-type',basis:'#m-basis',title:'#m-title',client:'#m-client',phone:'#m-phone',number:'#m-number',stage:'#m-stage',court:'#m-court',judge:'#m-judge',investigator:'#m-investigator',article:'#m-article',role:'#m-role',restraint:'#m-restraint',opponent:'#m-opponent',dayRate:'#m-dayrate',notes:'#m-notes'};
  Object.keys(map).forEach(function(k){ var e=$(map[k]); if(!e)return; MED[k]=(k==='dayRate'?(+e.value||0):e.value.trim()); });
}
function matterDynamicFields(){
  var cfg=matterMeta((MED&&MED.type)||'other');
  var stageField=inlineMatterChoiceField('m-stage','m-stage-choice',MED.stage||cfg.stageList[0]||'','Укажите стадию',cfg.stageList,'— выбрать стадию —','m-stage-list');
  var judgeField=cfg.showJudge?inlineMatterChoiceField('m-judge','m-judge-choice',MED.judge||'','Фамилия И.О.',judgeDirectory().map(function(x){return x.judge;}),'— выбрать судью —','m-judge-list'):'';
  var roleField=inlineMatterChoiceField('m-role','m-role-choice',MED.role||'','Введите или выберите статус',cfg.roleList,'— выбрать статус —','m-role-list');
  var restraintField=cfg.showRestraint?inlineMatterChoiceField('m-restraint','m-restraint-choice',MED.restraint||'','Введите или выберите меру',cfg.restraintList,'— выбрать меру —','m-restraint-list'):'';
  var html=''+
    '<div class="fld"><label>Название дела *</label><input id="m-title" placeholder="'+esc(cfg.titlePlaceholder)+'" value="'+esc(MED.title)+'"></div>'+
    '<div class="two"><div class="fld"><label>'+esc(cfg.clientLabel)+'</label><input id="m-client" value="'+esc(MED.client)+'" placeholder="'+esc(cfg.clientPlaceholder)+'"></div><div class="fld"><label>Телефон</label><input id="m-phone" type="tel" value="'+esc(MED.phone)+'" placeholder="+7 900 000-00-00"></div></div>'+
    '<div class="two"><div class="fld"><label>'+esc(cfg.numberLabel)+'</label><input id="m-number" value="'+esc(MED.number)+'"></div><div class="fld"><label>Стадия</label>'+stageField+'</div></div>'+
    '<div class="fld matter-court-field"><label>'+esc(cfg.courtLabel)+'</label>'+inlineChoiceField('m-court','m-court-choice',MED.court||'','Введите или выберите суд / орган',courtChoiceOptions(MED.court||''),'court-options-m')+'<datalist id="court-options-m">'+COMMON_KINESHMA_COURTS.map(function(c){return '<option value="'+esc(c.value)+'">'+esc(c.short)+'</option>';}).join('')+'</datalist></div>';

  if(cfg.showJudge&&cfg.showInvestigator){
    html += '<div class="two"><div class="fld"><label>'+esc(cfg.judgeLabel)+'</label>'+judgeField+'</div><div class="fld"><label>'+esc(cfg.investigatorLabel)+'</label><input id="m-investigator" value="'+esc(MED.investigator||'')+'" placeholder="Фамилия И.О."></div></div>';
  }else if(cfg.showJudge){
    html += '<div class="fld"><label>'+esc(cfg.judgeLabel)+'</label>'+judgeField+'</div>';
  }else if(cfg.showInvestigator){
    html += '<div class="fld"><label>'+esc(cfg.investigatorLabel)+'</label><input id="m-investigator" value="'+esc(MED.investigator||'')+'" placeholder="Фамилия И.О."></div>';
  }

  if(cfg.showArticle){
    html += '<div class="two"><div class="fld"><label>Статья / квалификация</label><input id="m-article" value="'+esc(MED.article||'')+'" placeholder="'+esc(cfg.articlePlaceholder||'')+'"></div><div class="fld"><label>'+esc(cfg.roleLabel)+'</label>'+roleField+'</div></div>';
  }else{
    html += '<div class="fld"><label>'+esc(cfg.roleLabel)+'</label>'+roleField+'</div>';
  }

  if(cfg.showRestraint){
    html += '<div class="fld"><label>Мера пресечения</label>'+restraintField+'</div>';
  }
  if(cfg.showOpponent){
    html += '<div class="fld"><label>'+esc(cfg.opponentLabel)+'</label><input id="m-opponent" value="'+esc(MED.opponent||'')+'" placeholder="'+esc(cfg.opponentPlaceholder||'')+'"></div>';
  }
  html += '<div class="fld"><label>Ставка за день участия, '+esc(S.settings.cur)+'</label><input id="m-dayrate" type="number" inputmode="numeric" value="'+esc(MED.dayRate||'')+'" placeholder="'+(S.settings.dayRate||'')+'"></div>'+
    '<div class="fld"><label>Суть дела / рабочая заметка</label><textarea id="m-notes" rows="4" placeholder="Ключевые обстоятельства, позиция, что важно не забыть…">'+esc(MED.notes||'')+'</textarea></div>';
  return html;
}
function renderMatterDynamic(){ var box=$('#matter-dynamic'); if(box) box.innerHTML=matterDynamicFields(); }
function sanitizeMatterByType(o){
  var cfg=matterMeta(o.type||'other');
  if(!cfg.showInvestigator) o.investigator='';
  if(!cfg.showArticle) o.article='';
  if(!cfg.showRestraint) o.restraint='';
  if(!cfg.showJudge) o.judge='';
  if(!cfg.showOpponent) o.opponent='';
  if(!cfg.stageList.filter(function(x){ return x===o.stage; }).length) o.stage=cfg.stageList[0]||o.stage||'';
  if(typeof o.basis!=='string') o.basis='';
  return o;
}
function matterDossierRows(m){
  var cfg=matterMeta(m&&m.type), rows=[];
  function push(icon,label,val){ if(val) rows.push([icon,label,val]); }
  push('user',cfg.clientLabel,m.client);
  push('phone','Телефон',m.phone);
  push('folder',cfg.numberLabel,m.number);
  push('gavel',cfg.courtLabel,m.court);
  if(cfg.showJudge) push('user',cfg.judgeLabel,m.judge);
  if(cfg.showInvestigator) push('user',cfg.investigatorLabel,m.investigator);
  if(cfg.showArticle) push('lock','Статья / квалификация',m.article);
  push('user',cfg.roleLabel,m.role);
  if(cfg.showRestraint) push('lock','Мера пресечения',m.restraint);
  if(cfg.showOpponent) push('user',cfg.opponentLabel,m.opponent);
  push('doc','Основание ведения',matterBasisLabel(m.basis));
  push('clock','Стадия',m.stage);
  push('doc','Суть / рабочая заметка',m.notes);
  return rows;
}

function matterType(m){ return MATTER_TYPES[m&&m.type]||MATTER_TYPES.other; }
function matterBasisMeta(v){ return MATTER_BASIS[v]||null; }
function matterBasisLabel(v){ var x=matterBasisMeta(v); return x?x.n:''; }
function participationOf(id){ return S.participation.filter(function(p){ return p.mid===id; }); }
function journalOf(id){ return S.journal.filter(function(j){ return j.mid===id; }); }


function matter(id){ return S.matters.filter(function(m){ return m.id===id; })[0]; }
function tasksOf(id){ return S.tasks.filter(function(t){ return t.mid===id; }); }
function activeM(){ return S.matters.filter(function(m){ return !m.archived; }); }

var HEARING_RESULTS={
  held:{label:'Состоялось',tone:'held'},
  postponed:{label:'Отложено',tone:'postponed'},
  break:{label:'Объявлен перерыв',tone:'break'},
  completed:{label:'Рассмотрение завершено',tone:'completed'},
  cancelled:{label:'Не состоялось / снято',tone:'cancelled'}
};
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
  s.classList.remove('quick-sheet','task-editor-sheet','hearing-result-sheet','filter-premium-sheet','task-filter-premium','matter-filter-premium','matter-editor-sheet','task-actions-premium','matter-actions-premium');
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
}
function openPage(html){ var p = $('#page'); p.innerHTML = html; p._mid = null; p._navType = 'page';
  p.classList.add('open'); $('#scrim').classList.add('open'); p.scrollTop = 0; }
function closeAll(){ $('#sheet').classList.remove('open'); $('#page').classList.remove('open');
  $('#page')._mid=null; $('#page')._navType=''; $('#scrim').classList.remove('open'); }
function closeSheet(){ $('#sheet').classList.remove('open');
  if(!$('#page').classList.contains('open')) $('#scrim').classList.remove('open'); }

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
  return '<button class="today-row hearing-row hearing-result-row kind-hearing" data-act="hearing-result" data-id="'+t.id+'">'+
    '<span class="today-time mono">'+esc(t.time||'—:—')+'</span><span class="today-row-main"><b>'+esc(hearingCaption(t,m))+'</b>'+
    '<small class="today-kindline"><span class="today-kind-badge hearing">Заседание</span>'+(context?'<span class="today-kind-context">'+esc(context)+'</span>':'')+'</small>'+
    (meta?'<small class="hearing-meta">'+meta+'</small>':'')+
    '<small class="hearing-court">'+esc(place||'Суд не указан')+'</small>'+
    '<em class="hearing-result-call">Указать результат · '+esc(when)+' →</em></span>'+ico('chev','s')+'</button>';
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
  return q[((day%q.length)+q.length)%q.length];
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
    '<div class="today-brand"><div class="today-brand-left"><span class="today-logo"><img src="scale-gold.png?v=4017" alt="Весы правосудия"></span><div><b>Ежедневник адвоката</b><small>Больше, чем календарь</small></div></div>'+
      '<button class="today-bell" data-act="notify-sheet" aria-label="Уведомления">'+ico('bell')+'</button></div>'+
    '<div class="today-head"><div><h1>Сегодня</h1><p>'+d.getDate()+' '+MON[d.getMonth()]+' '+d.getFullYear()+' · '+cap(new Intl.DateTimeFormat('ru-RU',{weekday:'long'}).format(d))+'</p></div>'+
      '<div class="today-actions"><button class="iconbtn" data-act="global-search" title="Поиск">'+ico('search')+'</button></div></div>'+
    '<div class="today-quote"><div><b>'+quote[0]+'</b><span>'+quote[1]+'</span></div></div>';

  html += block('danger','flag','Просроченные процессуальные сроки',overdueDeadlines,todayDeadlineRow);
  html += block('danger','flag','Процессуальные сроки сегодня',deadlinesToday,todayDeadlineRow);
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
  if(confirm((t.kind==='hearing'?'Удалить заседание?':'Удалить задачу?'))){
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
  var t=S.tasks.filter(function(x){return x.id===HR.id;})[0]; if(!t)return;
  var choices=Object.keys(HEARING_RESULTS).map(function(k){
    var r=HEARING_RESULTS[k], ic=hearingResultIcon(k);
    return '<button class="hearing-result-choice '+r.tone+(HR.status===k?' on':'')+'" data-act="hearing-result-pick" data-v="'+k+'">'+
      '<span class="hearing-result-choice-icon">'+ico(ic)+'</span>'+
      '<span class="hearing-result-choice-text">'+esc(r.label)+'</span>'+
    '</button>';
  }).join('');
  var follow=(HR.status==='postponed'||HR.status==='break')
    ? '<div class="hearing-followup"><div class="hearing-followup-title">Следующее заседание</div><div class="two"><div class="fld"><label>Дата</label><input id="hr-next-date" type="date" value="'+esc(HR.nextDate||'')+'"></div><div class="fld"><label>Время</label><input id="hr-next-time" type="time" value="'+esc(HR.nextTime||'')+'"></div></div><small>Если новая дата уже известна, приложение создаст следующее заседание с тем же делом, судом и судьёй.</small></div>' : '';
  openSheet('<div class="hearing-result-head"><span class="hearing-result-head-icon">'+ico('gavel')+'</span><div><h2>Результат заседания</h2><p>'+esc(fmtD(t.due,true)+(t.time?' · '+t.time:'')+(hearingContextText(t)?' · '+hearingContextText(t):''))+'</p></div></div>'+ 
    '<div class="hearing-result-options">'+choices+'</div>'+follow+
    '<div class="fld hearing-result-note-field"><label>Итог / примечание</label><textarea id="hr-note" rows="4" placeholder="Например: допрошен свидетель, исследованы материалы, суд отложил рассмотрение…">'+esc(HR.note||'')+'</textarea></div>'+ 
    '<div class="hint hearing-result-hint">После сохранения заседание уйдёт с главной страницы и останется в истории. Для связанного дела результат автоматически попадёт в журнал.</div>'+ 
    '<button class="btn" data-act="hearing-result-save">Сохранить результат</button>');
  $('#sheet').classList.add('hearing-result-sheet');
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
  var isFollow=HR.status==='postponed'||HR.status==='break';
  if(isFollow && ((HR.nextDate&&!HR.nextTime)||(!HR.nextDate&&HR.nextTime))){toast('Для следующего заседания укажите дату и время');return;}
  var now=new Date().toISOString(),ri=HEARING_RESULTS[HR.status];
  t.hearingResultStatus=HR.status;
  t.hearingResultText=HR.note||'';
  t.hearingResultAt=now;
  t.hearingNextDate=HR.nextDate||'';
  t.hearingNextTime=HR.nextTime||'';
  t.done=true;t.doneAt=now;
  var next=null;
  if(isFollow&&HR.nextDate&&HR.nextTime){
    next={id:uid(),title:'Судебное заседание',mid:t.mid||'',note:'',due:HR.nextDate,time:HR.nextTime,place:t.place||'',pri:'mid',kind:'hearing',sourceDate:'',rule:'',ruleCode:'',ruleArticle:'',deadlineCode:'GPK',deadlineRuleId:'gpk-appeal',hearingClient:t.hearingClient||'',hearingNumber:t.hearingNumber||'',hearingJudge:t.hearingJudge||'',done:false,doneAt:null,steps:[],created:now,hearingPreviousId:t.id};
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
  var rows='<label class="task-action-premium-row date">'+
      '<span class="task-action-premium-icon">'+ico('cal')+'</span><span class="task-action-premium-copy"><b>Изменить дату</b><small>'+(t.due?('Сейчас: '+fmtD(t.due,true)):'Дата не установлена')+'</small></span><span class="task-action-premium-tail">'+ico('chev','s')+'</span>'+ 
      '<input class="task-date-native" type="date" value="'+esc(cur)+'" data-task-date-id="'+t.id+'" aria-label="Выбрать новую дату"></label>'+ 
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
    var hay=(t.title+' '+(t.note||'')+' '+(t.hearingClient||'')+' '+(t.hearingNumber||'')+' '+(t.hearingJudge||'')+' '+(t.hearingResultText||'')+' '+(t.hearingResultStatus||'')+' '+(m?m.title+' '+(m.client||'')+' '+(m.number||''):'')).toLowerCase();
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
function renderTasks(){
  var u=S.ui;
  if(['','late','today','week','later','nodue','done'].indexOf(u.taskChip)<0) u.taskChip='';
  if(['','task','hearing','meeting','deadline'].indexOf(u.taskType||'')<0) u.taskType='';
  var c=taskProjectCounts(), tt=taskTypeMeta();
  var html='<div class="tasks-project">'+
    '<div class="today-brand"><div class="today-brand-left"><span class="today-logo"><img src="scale-gold.png?v=4017" alt="Весы правосудия"></span><div><b>Ежедневник адвоката</b><small>Больше, чем календарь</small></div></div>'+
      '<div class="today-actions">'+
        '<button class="iconbtn'+(u.q?' on':'')+'" data-act="search" title="Поиск">'+ico('search')+'</button>'+
      '</div></div>'+
    '<div class="today-head tasks-title-head"><div><h1>Задачи</h1><p>'+c.work+' '+plural(c.work,'запись','записи','записей')+' в работе</p></div></div>'+
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
  return '<div class="pt-item" data-id="'+t.id+'">'+
    '<div class="pt-swipe-bg"><span></span><span class="pt-swipe-more">Ещё'+ico('more','s')+'</span></div>'+ 
    '<div class="pt-row'+(t.done?' done':'')+(hearingHasResult(t)?' hearing-result-done':'')+(hearingNeedsResult(t)?' needs-result':'')+(t.kind==='deadline'?' deadline-record':'')+'" data-id="'+t.id+'">'+
      leadIcon+
      '<div class="pt-main">'+
        '<button class="pt-open" data-act="task" data-id="'+t.id+'"><b>'+title+'</b></button>'+ 
        (m?'<button class="pt-link" data-act="task-matter" data-id="'+m.id+'">'+esc(context)+'</button>':'')+
        (t.kind==='hearing'&&(hclient||hjudge)?'<div class="pt-hearing-meta">'+(hclient?'<span class="hearing-client">'+esc(hclient)+'</span>':'')+(hclient&&hjudge?'<span class="hearing-dot"> · </span>':'')+(hjudge?'<span class="hearing-judge">'+esc(hjudge)+'</span>':'')+'</div>':'')+
        (t.kind==='hearing'&&t.place?'<small class="pt-hearing-court">'+esc(t.place)+'</small>':'')+
        (hearingHasResult(t)&&t.hearingResultText?'<small class="pt-hearing-result-text">'+esc(t.hearingResultText)+'</small>':(t.note?'<small class="pt-note">'+esc(t.note)+'</small>':''))+
        due+
      '</div>'+ 
      '<div class="pt-side">'+right+'</div><span class="pt-chev">'+ico('chev','s')+'</span></div></div>';
}
function renderTaskList(){
  var box=$('#tasklist');if(!box)return;
  var list=taskFilter();
  if(!list.length){
    box.innerHTML=empty('list',S.ui.q?'Ничего не найдено':'Задач пока нет',S.ui.q?'Измените поисковый запрос или фильтр.':'Новые задачи появятся здесь после добавления.',S.ui.q?null:[{act:'new-task',t:'Добавить задачу'}]);
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
  var late = open.filter(function(x){ return (x.kind==='task'||x.kind==='deadline') && x.due && dd(x.due)<0; }).length;
  var done = t.filter(function(x){ return x.done || meetingOccurred(x); }).length;
  var nh = t.filter(function(x){ return !x.done && x.kind==='hearing' && x.due && dd(x.due)>=0; }).sort(sortT)[0];
  var parts = participationOf(m.id).slice().sort(function(a,b){ return a.date<b.date?1:-1; });
  var rate = +m.dayRate || +S.settings.dayRate || 0;
  var sum = parts.reduce(function(a,e){ return a + (+e.rate||rate); },0);
  return { open:open.length, done:done, all:t.length, late:late, next:nh,
           days:parts.length, sum:sum, parts:parts };
}
function matterStageTone(m){
  if(m.archived || m.stage==='Завершено') return 'slate';
  if(m.stage==='Апелляция' || m.stage==='Кассация' || m.stage==='Надзор') return 'blue';
  if(m.stage==='Консультация' || m.stage==='Досудебная работа') return 'gold';
  if(m.stage==='Дознание / следствие') return 'violet';
  return 'green';
}
function matterTypeCardLabel(m){
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
  var rows=[], client=m.client||'', role=m.role||'', court=m.court||'', judge=m.judge||'', inv=m.investigator||'', opp=m.opponent||'';
  function add(icon,label,value,sub){ if(value) rows.push(matterCardInfoRow(icon,label,value,sub)); }
  if(m.type==='criminal'){
    add('user','Подзащитный / доверитель',client,role);
    add('lock','Статья / квалификация',m.article||'','');
    var pretrial=/провер|дозн|следств/i.test(m.stage||'');
    if(pretrial && inv) add('user','Следователь / дознаватель',inv,court);
    else if(court) add('gavel','Суд / орган',court,judge);
    else if(inv) add('user','Следователь / дознаватель',inv,'');
    if(m.restraint) add('lock','Мера пресечения',m.restraint,'');
  }else if(m.type==='civil'){
    add('user','Доверитель',client,role);
    add('gavel','Суд',court,judge);
    if(opp) add('user','Другая сторона',opp,'');
  }else if(m.type==='admin'){
    add('user','Доверитель',client,role);
    add('gavel','Суд / административный орган',court,judge);
    if(opp) add('user','Административный ответчик / орган',opp,'');
  }else if(m.type==='koap'){
    add('user','Лицо / доверитель',client,role);
    add('lock','Статья КоАП',m.article||'','');
    add('gavel','Суд / орган',court,judge);
  }else{
    add('user','Доверитель',client,role);
    add('gavel','Суд / орган',court,judge);
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
function matterCard(m){
  var mt=matterType(m), basis=matterBasisMeta(m.basis);
  var iconName=matterCardIconName(m);
  var title=matterCardTitle(m);
  var number=m.number||'без номера';
  var client=m.client||'доверитель не указан';
  var basisChip=basis?'<span class="matter-compact-basis '+(m.basis==='agreement'?'agreement':'assigned')+'">'+esc(basis.short||basis.n)+'</span>':'';
  return '<article class="matter-compact-card ultra'+(m.archived?' archived':'')+'" style="--case:'+mt.c+'" data-act="matter" data-id="'+m.id+'">'+
    '<span class="matter-compact-icon">'+ico(iconName)+'</span>'+
    '<div class="matter-compact-copy">'+
      '<div class="matter-ultra-kicker"><span class="matter-compact-type">'+esc(matterTypeCardLabel(m))+'</span>'+basisChip+'</div>'+
      '<b class="matter-compact-title">'+esc(title)+'</b>'+
      '<div class="matter-ultra-meta"><span>№ '+esc(number)+'</span><i></i><span>'+esc(client)+'</span></div>'+
    '</div>'+
    '<span class="matter-compact-chevron">'+ico('chev','s')+'</span>'+
  '</article>';
}
function sheetMatterFilters(){
  var typeCounts={all:S.matters.length}; Object.keys(MATTER_TYPES).forEach(function(k){ typeCounts[k]=S.matters.filter(function(m){return m.type===k;}).length; });
  var basisCounts={all:S.matters.length}; Object.keys(MATTER_BASIS).forEach(function(k){ basisCounts[k]=S.matters.filter(function(m){return m.basis===k;}).length; });
  function mr(act,v,icon,title,sub,count,tone,on){
    return '<button class="filter-premium-row'+(on?' selected':'')+'" style="--tone:'+tone+'" data-act="'+act+'" data-v="'+v+'"><span class="filter-premium-icon">'+ico(icon)+'</span><span class="filter-premium-copy"><b>'+title+'</b><small>'+sub+'</small></span><span class="filter-premium-count">'+count+'</span><span class="filter-premium-tail">'+ico(on?'check':'chev','s')+'</span></button>';
  }
  var typeRows=mr('m-filter','','folder','Все производства','Показывать дела всех типов',typeCounts.all,'#B88C2D',S.ui.matterType==='')+
    Object.keys(MATTER_TYPES).map(function(k){var t=MATTER_TYPES[k];return mr('m-filter',k,'brief',esc(t.n),esc(t.short),typeCounts[k]||0,t.c,S.ui.matterType===k);}).join('');
  var basisRows=mr('m-basis-filter','','doc','Все основания','Соглашение и дела по назначению',basisCounts.all,'#B88C2D',S.ui.matterBasis==='')+
    Object.keys(MATTER_BASIS).map(function(k){var t=MATTER_BASIS[k];return mr('m-basis-filter',k,k==='agreement'?'doc':'user',esc(t.n),esc(t.short),basisCounts[k]||0,t.c,S.ui.matterBasis===k);}).join('');
  openSheet('<div class="filter-premium-head"><span class="filter-premium-head-icon">'+ico('folder')+'</span><div><h2>Фильтр дел</h2><p>Быстрый отбор по типу и основанию</p></div></div><div class="filter-premium-section"><div class="filter-premium-label">Тип производства</div><div class="filter-premium-card">'+typeRows+'</div></div><div class="filter-premium-section"><div class="filter-premium-label">Основание ведения</div><div class="filter-premium-card">'+basisRows+'</div></div>');
  $('#sheet').classList.add('filter-premium-sheet','matter-filter-premium');
}
function renderMatters(){
  var scope=S.ui.matterScope||'active';
  if(['all','active','archive'].indexOf(scope)<0) scope='active';
  var allCount=S.matters.length, activeCount=activeM().length, archCount=S.matters.filter(function(m){return m.archived;}).length;
  var list=S.matters.filter(function(m){
    if(scope==='active' && m.archived) return false;
    if(scope==='archive' && !m.archived) return false;
    if(S.ui.matterType && m.type!==S.ui.matterType) return false;
    if(S.ui.matterBasis && (m.basis||'')!==S.ui.matterBasis) return false;
    return true;
  });
  list.sort(function(a,b){
    if(a.archived!==b.archived) return a.archived?1:-1;
    var A=matterStats(a),B=matterStats(b);
    if(!!A.late!==!!B.late) return A.late?-1:1;
    var an=A.next?A.next.due:'9999',bn=B.next?B.next.due:'9999';
    if(an!==bn) return an<bn?-1:1;
    return B.open-A.open;
  });
  var typeName=S.ui.matterType?(MATTER_TYPES[S.ui.matterType]||MATTER_TYPES.other).short:'';
  var basisName=S.ui.matterBasis?(MATTER_BASIS[S.ui.matterBasis]||{short:'Основание'}).short:'';
  var filterName=[typeName,basisName].filter(Boolean).join(' · ')||'Фильтр';
  var html='<div class="matters-project">'+
    '<div class="today-brand"><div class="today-brand-left"><span class="today-logo"><img src="scale-gold.png?v=4017" alt="Весы правосудия"></span><div><b>Ежедневник адвоката</b><small>Больше, чем календарь</small></div></div>'+
      '<div class="today-actions"><button class="iconbtn" data-act="global-search" title="Поиск">'+ico('search')+'</button></div></div>'+
    '<div class="today-head matters-title-head"><div><h1>Дела</h1><p>'+activeCount+' '+plural(activeCount,'дело','дела','дел')+' в производстве</p></div></div>'+
    '<div class="matters-scope">'+
      '<button class="'+(scope==='all'?'on':'')+'" data-act="matter-scope" data-v="all"><span>Все</span><em>'+allCount+'</em></button>'+
      '<button class="'+(scope==='active'?'on':'')+'" data-act="matter-scope" data-v="active"><span>В работе</span><em>'+activeCount+'</em></button>'+
      '<button class="'+(scope==='archive'?'on':'')+'" data-act="matter-scope" data-v="archive"><span>Архив</span><em>'+archCount+'</em></button>'+
      '<button class="matter-filter-btn'+((S.ui.matterType||S.ui.matterBasis)?' on':'')+'" data-act="matter-filter-sheet" title="Фильтр дел">'+ico('list','s')+'<span>'+filterName+'</span></button></div>'+
    '<div class="matters-list">';
  html+=list.length?list.map(matterCard).join(''):
    empty('folder',scope==='archive'?'Архив пуст':'Дел пока нет',scope==='archive'?'Завершённые дела появятся здесь после отправки в архив.':'Создайте первое дело и ведите задачи, заседания и историю в одном месте.',scope==='archive'?null:[{act:'new-matter',t:'Завести дело'}]);
  html+='</div></div>';
  $('#sc-matters').innerHTML=html;
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
    '<div class="today-brand"><div class="today-brand-left"><span class="today-logo"><img src="scale-gold.png?v=4017" alt="Весы правосудия"></span><div><b>Ежедневник адвоката</b><small>Больше, чем календарь</small></div></div><div class="today-actions"><button class="iconbtn" data-act="global-search" title="Поиск">'+ico('search')+'</button></div></div>'+
    '<div class="today-head calendar-title-head"><div><h1>Календарь</h1><p>'+fmtD(u.calSel,true)+' · '+cap(DOW[parseD(u.calSel).getDay()])+'</p></div></div>'+
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
    '<div class="today-brand"><div class="today-brand-left"><span class="today-logo"><img src="scale-gold.png?v=4017" alt="Весы правосудия"></span><div><b>Ежедневник адвоката</b><small>Больше, чем календарь</small></div></div><div class="today-actions"><button class="iconbtn" data-act="global-search" title="Поиск">'+ico('search')+'</button></div></div>'+
    '<div class="today-head more-title-head"><div><h1>Настройки</h1><p>'+esc(offlineStatusText())+'</p></div></div>'+
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
function render(){
  ['today','tasks','matters','cal','more'].forEach(function(k){
    $('#sc-'+k).classList.toggle('hide', S.ui.tab!==k); });
  ({today:renderToday,tasks:renderTasks,matters:renderMatters,cal:renderCal,more:renderMore})[S.ui.tab]();
  document.querySelectorAll('.tab').forEach(function(b){ b.classList.toggle('on', b.dataset.tab===S.ui.tab); });
  var hideFab=(S.ui.tab==='more');
  $('#fab').classList.toggle('fab-context-hide',hideFab);
  $('#fab').style.display=hideFab?'none':'flex';
  $('#sc-'+S.ui.tab).classList.add('fadein');
  setTimeout(function(){ var e=$('#sc-'+S.ui.tab); if(e) e.classList.remove('fadein'); },340);
  applyTheme();
}
var NAV_TABS=[];
function go(tab,replaceHistory){
  var cur=S.ui.tab;
  if(tab!==cur && !replaceHistory){
    if(!NAV_TABS.length || NAV_TABS[NAV_TABS.length-1]!==cur) NAV_TABS.push(cur);
    if(NAV_TABS.length>12) NAV_TABS.shift();
  }
  S.ui.tab = tab; S.ui.q=''; S.ui._sq=false; save(); render();
  var e = $('#sc-'+tab); if(e) e.scrollTop = 0;
}
function appBack(){
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
function commonCourtByValue(value){
  return COMMON_KINESHMA_COURTS.filter(function(c){return c.value===value;})[0]||null;
}
function judgeDirectory(){
  var cityCourt=(COMMON_KINESHMA_COURTS.filter(function(c){return c.main;})[0]||{}).value||'Кинешемский городской суд Ивановской области';
  var rows=KINESHMA_CITY_JUDGES.map(function(j){return {judge:j,court:cityCourt,label:j};});
  COMMON_KINESHMA_COURTS.filter(function(c){return !c.main&&c.judge;}).forEach(function(c){
    rows.push({judge:c.judge,court:c.value,label:c.short+' — '+c.judge});
  });
  return rows;
}
function normLookup(v){
  return String(v||'').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/gi,'').trim();
}
function knownJudgeEntry(value){
  var q=normLookup(value); if(!q)return null;
  var rows=judgeDirectory(), exact=rows.filter(function(x){return normLookup(x.judge)===q;});
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
function judgeChoiceOptions(current){
  var selected=current||'';
  return '<option value="">— выбрать судью —</option>'+judgeDirectory().map(function(x){
    return '<option value="'+esc(x.judge)+'"'+(x.judge===selected?' selected':'')+'>'+esc(x.label)+'</option>';
  }).join('');
}
function courtDatalist(){
  return '<datalist id="court-options">'+COMMON_KINESHMA_COURTS.map(function(c){return '<option value="'+esc(c.value)+'">'+esc(c.short)+'</option>';}).join('')+'</datalist>';
}
function judgeDatalist(){
  return '<datalist id="judge-options">'+judgeDirectory().map(function(x){return '<option value="'+esc(x.judge)+'">'+esc(x.label)+'</option>';}).join('')+'</datalist>';
}
function inlineChoiceField(inputId,selectId,value,placeholder,optionsHtml,listId){
  return '<div class="inline-choice-wrap"><input id="'+inputId+'"'+(listId?' list="'+listId+'"':'')+' value="'+esc(value||'')+'" placeholder="'+esc(placeholder||'')+'" autocomplete="off">'+
    '<span class="inline-choice-arrow">'+ico('chev','s')+'</span><select id="'+selectId+'" class="inline-choice-select" aria-label="Выбрать из списка">'+optionsHtml+'</select></div>';
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
    : Object.assign({ id:null,title:'',mid:'',note:'',due:'',time:'',place:'',pri:'mid',kind:'task',sourceDate:'',rule:'',ruleCode:'',ruleArticle:'',deadlineCode:'GPK',deadlineRuleId:'gpk-appeal',hearingClient:'',hearingNumber:'',hearingJudge:'',
        done:false,steps:[] }, preset||{});
  if(EDITOR_KINDS.indexOf(ED.kind)<0) ED.kind='task';
  syncHearingCourt(false);
  drawEditor();
}
function drawEditor(){
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
  var deadlineRes=t.kind==='deadline'?calculateLegalDeadline(deadlineRule,t.sourceDate):null;

  openSheet(
  '<div class="task-editor-brand"><img src="scale-gold.png?v=4017" alt="Весы правосудия"><div><b>Ежедневник адвоката</b><small>Больше, чем календарь</small></div></div>'+
  '<div class="shhead task-editor-head"><button class="task-editor-back" data-act="close" aria-label="Назад">'+ico('left')+'</button><h2>'+title+'</h2><span class="task-editor-head-spacer"></span></div>'+
  '<div class="fld task-editor-type"><label>Тип</label><div class="chips task-kind-chips">'+kinds+'</div></div>'+
  (!hearing&&t.kind!=='deadline'?'<div class="fld task-editor-title-field"><label>'+(meeting?'Тема встречи':'Что нужно сделать')+'</label><input id="e-title" placeholder="'+(meeting?'Встреча с доверителем':'Подготовить апелляционную жалобу')+'" value="'+esc(t.title)+'" autocomplete="off"></div>':'')+
  '<div class="fld editor-select-field"><label>'+(hearing?'Дело (необязательно)':(meeting?'Дело / доверитель (необязательно)':'Дело / доверитель'))+'</label><select id="e-mid">'+opts+'</select></div>'+
  (hearing?'<div id="hearing-standalone" class="hearing-standalone"'+(t.mid?' style="display:none"':'')+'><div class="two hearing-party-grid"><div class="fld"><label>Доверитель / подзащитный</label><input id="e-hclient" placeholder="Фамилия или ФИО" value="'+esc(t.hearingClient||'')+'"></div><div class="fld"><label>№ дела / материала</label><input id="e-hnumber" placeholder="Например: 1-123/2026" value="'+esc(t.hearingNumber||'')+'"></div></div><div class="fld hearing-judge-field"><label>Судья / председательствующий</label>'+inlineChoiceField('e-hjudge','e-hjudge-choice',t.hearingJudge||'','Фамилия И.О.',judgeChoiceOptions(t.hearingJudge||''),'judge-options')+'<small class="fieldhint">Можно выбрать судью стрелкой справа или напечатать фамилию вручную. Для известного судьи суд подставится автоматически.</small>'+judgeDatalist()+'</div></div>':'')+
  (t.kind!=='deadline'?('<div class="two task-datetime'+(hearing?' hearing-datetime':'')+'">'+
    '<div class="fld"><label>Дата'+(timedEvent?' *':'')+'</label><input id="e-due" type="date" value="'+esc(t.due)+'"></div>'+
    '<div class="fld"><label>Время'+(timedEvent?' *':'')+'</label><input id="e-time" type="time" value="'+esc(t.time)+'"></div>'+
  '</div>'+
  '<div class="chips task-quick-dates">'+quickDates.map(function(x){
      return '<button class="chip" data-act="e-quick" data-v="'+x[0]+'">'+x[1]+'</button>'; }).join('')+'</div>'):'')+
  (!hearing&&!meeting&&t.kind!=='deadline'?'<div class="fld task-priority-field"><label>Приоритет</label><div class="chips task-priority-chips">'+pris+'</div></div>':'')+
  (hearing
    ? '<div class="fld hearing-court-field"><label>Суд / место заседания *</label>'+inlineChoiceField('e-place','e-court-choice',t.place||'','Суд или место заседания',courtChoiceOptions(t.place||''),'court-options')+'<small class="fieldhint">Можно выбрать Кинешемский городской суд или мировой участок стрелкой справа либо ввести любой другой суд вручную.</small>'+courtDatalist()+'</div>'
    : (meeting?'<div class="fld hearing-court-field"><label>Место встречи</label><input id="e-place" placeholder="Офис, СИЗО, адрес, кафе" value="'+esc(t.place||'')+'"></div>':''))+
  (t.kind==='deadline' ? '<div class="deadline-calculator">'+
    '<div class="deadline-calculator-title"><span>'+ico('clock','s')+'</span><div><b>Юридический калькулятор срока</b><small>Правила расчёта встроены по выбранной норме</small></div></div>'+
    '<div class="two deadline-calc-grid"><div class="fld"><label>Производство / кодекс</label><select id="e-deadline-code">'+legalDeadlineCodeOptions(t.deadlineCode||'GPK')+'</select></div>'+
    '<div class="fld"><label>Что рассчитываем</label><select id="e-deadline-rule">'+legalDeadlineRuleOptions(t.deadlineCode||'GPK',t.deadlineRuleId)+'</select></div></div>'+
    '<div class="fld deadline-source-field"><label id="e-source-label">'+esc(deadlineRule?deadlineRule.dateLabel:'Исходная дата')+'</label><input id="e-source" type="date" value="'+esc(t.sourceDate||today())+'"></div>'+
    '<div id="e-deadline-result">'+deadlineCalcResultHTML(deadlineRule,deadlineRes)+'</div>'+
    '<div class="deadline-calc-footnote">Расчёт учитывает правило начала срока со следующего дня, способ исчисления по соответствующему кодексу и перенос окончания с нерабочего дня. Производственный календарь 2026 учтён полностью.</div>'+
    '</div>' : '')+
  '<div class="fld task-editor-note-field"><label>'+(hearing?'Примечание (необязательно)':(meeting?'Комментарий':'Примечание'))+'</label>'+
    '<textarea id="e-note" class="task-note-editor" rows="5" placeholder="'+(hearing?'Например: зал 3, взять оригиналы документов':(meeting?'Например: обсудить позицию, взять документы':'Нормы права, документы, что взять с собой…'))+'">'+esc(t.note||'')+'</textarea></div>'+
  '<button class="btn task-editor-save" data-act="e-save"><span class="save-icon">'+ico('save','s')+'</span>'+(hearing?'Сохранить заседание':(meeting?'Сохранить встречу':'Сохранить'))+'</button>'+
  (isNew?'':((hearing||meeting||t.kind==='deadline')?'<button class="btn ghost" data-act="ics-task" data-id="'+t.id+'" style="margin-top:8px">Добавить в календарь iPhone</button>':'')+
   '<button class="btn danger task-editor-delete" data-act="e-del">'+ico('trash','s')+'Удалить</button>'));
  $('#sheet').classList.add('task-editor-sheet');
  var editorSheet=$('#sheet'), editorBody=editorSheet&&editorSheet.querySelector('.shbody');
  if(editorSheet) editorSheet.scrollLeft=0;
  if(editorBody) editorBody.scrollLeft=0;
  if(isNew && !hearing) setTimeout(function(){ var e=$('#e-title'); if(e) e.focus(); },340);
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
  if(g('#e-deadline-code')!==undefined) ED.deadlineCode = $('#e-deadline-code').value;
  if(g('#e-deadline-rule')!==undefined) ED.deadlineRuleId = $('#e-deadline-rule').value;
  if(ED.kind==='deadline'){
    var dr=legalDeadlineRule(ED.deadlineRuleId),dres=calculateLegalDeadline(dr,ED.sourceDate);
    if(dr){ED.title=dr.name;ED.ruleCode=legalDeadlineCode(dr.code).name;ED.ruleArticle=dr.article;ED.rule=dr.article;ED.pri='high';}
    if(dres)ED.due=dres.end;
  }
  if(g('#e-note')!==undefined) ED.note = $('#e-note').value.trim();
}
function saveTask(){
  pullEditor();
  var hearing=ED.kind==='hearing', meeting=ED.kind==='meeting';
  if(hearing){
    if(!ED.due){ toast('Укажите дату заседания'); return; }
    if(!ED.time){ toast('Укажите время заседания'); return; }
    if(!ED.place) syncHearingCourt(false);
    if(!ED.place){ toast('Укажите суд / место заседания'); var pe=$('#e-place'); if(pe)pe.focus(); return; }
    ED.title='Судебное заседание'; ED.pri='mid'; ED.steps=[];
  }else if(meeting){
    if(!ED.title){ toast('Введите тему встречи'); var me=$('#e-title'); if(me) me.focus(); return; }
    if(!ED.due){ toast('Укажите дату встречи'); var de=$('#e-due'); if(de) de.focus(); return; }
    if(!ED.time){ toast('Укажите время встречи'); var te=$('#e-time'); if(te) te.focus(); return; }
    ED.pri='mid'; ED.steps=[];
  }else if(ED.kind==='deadline'){
    var dc=applyDeadlineRuleFromDom();
    if(!dc||!dc.rule){toast('Выберите процессуальное действие');return;}
    if(!ED.sourceDate){toast('Укажите исходную дату');var se=$('#e-source');if(se)se.focus();return;}
    if(!dc.res){toast('Не удалось рассчитать срок');return;}
    ED.due=dc.res.end;ED.title=dc.rule.name;ED.rule=dc.rule.article;ED.ruleCode=legalDeadlineCode(dc.rule.code).name;ED.ruleArticle=dc.rule.article;ED.pri='high';ED.time='';ED.steps=[];
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
    else if(ED.kind==='deadline') label='Поставлен процессуальный срок: '+ED.title+(ED.due?' — '+fmtD(ED.due,true):'');
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
  return esc([matterType(m).n,matterBasisLabel(m.basis),m.client].filter(Boolean).join(' · ') || 'Карточка дела');
}
function matterSegment(label,count,active){
  return '<span class="matter-detail-seg'+(active?' on':'')+'">'+esc(label)+(count>0?'<em>'+count+'</em>':'')+'</span>';
}
function matterNextHearingCard(t,m){
  if(!t) return '';
  var title=t.kind==='meeting'?'Ближайшая встреча':'Следующее заседание';
  var place=t.kind==='hearing' ? hearingPlace(t).replace(/<br>/g,' · ') : (t.place||'');
  var judge=t.kind==='hearing' ? hearingJudgeName(t,m) : '';
  var subtitle=[place,judge].filter(Boolean).join(' · ');
  return '<button class="matter-next-card" data-act="'+(hearingNeedsResult(t)?'hearing-result':'task')+'" data-id="'+t.id+'">'+
    '<span class="matter-next-icon">'+ico(t.kind==='meeting'?'user':'cal','s')+'</span>'+
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
  var rows=''+
    row('m-hearing','#4E8FF2','cal','Заседание','Назначить судебное заседание')+
    row('m-deadline','#D5A13D','clock','Процессуальный срок','Добавить контролируемый срок')+
    row('m-journal','#4AA89B','doc','Запись в журнал','Зафиксировать действие по делу')+
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
    '<div class="matter-project-topcard">'+
      '<div class="matter-project-topline"><div class="matter-project-headcopy"><h1>'+matterDisplayTitle(m)+'</h1><p>'+matterDisplaySubtitle(m)+'</p></div><span class="matter-project-status '+matterStatusClass(m)+'">'+esc(matterStatusText(m))+'</span></div>'+
      '<div class="matter-project-tabs">'+
        matterSegment('Общее',0,true)+matterSegment('Сроки',activeDeadlines.length,false)+matterSegment('Задачи',activeFlow.length,false)+matterSegment('События',js.length,false)+
      '</div>'+
    '</div>'+
    (mainRows.length?'<div class="matter-dossier-panel matter-dossier-panel-project">'+mainRows.map(function(r){ return matterPanelRow(r[0],r[1],r[2],{chev:false}); }).join('')+'</div>':'')+
    matterNextHearingCard(nextEvent,m)+
    (activeDeadlines.length?'<div class="matter-premium-section" id="matter-sec-deadlines"><div class="matter-premium-section-head"><h2>Процессуальные сроки</h2><button class="matter-section-link" data-act="m-deadline" data-id="'+id+'">Добавить</button></div><div class="matter-deadline-list">'+activeDeadlines.slice(0,6).map(matterCompactDeadlineRow).join('')+'</div></div>':'')+
    '<div class="matter-premium-section" id="matter-sec-flow"><div class="matter-premium-section-head"><h2>Задачи и события</h2><button class="matter-section-link" data-act="m-add" data-id="'+id+'">'+activeFlow.length+'</button></div>'+
      (activeFlow.length?'<div class="matter-events-list matter-events-list-compact">'+activeFlow.map(function(t){ return matterPremiumTaskRow(t,m); }).join('')+'</div>':'<div class="card"><div class="hint">Добавьте по делу первую задачу, заседание или встречу.</div></div>')+
    '</div>'+
    '<div class="matter-premium-section" id="matter-sec-journal"><div class="matter-premium-section-head"><h2>Недавние действия</h2><button class="matter-section-link" data-act="m-journal" data-id="'+id+'">Новая запись</button></div>'+
      (js.length?'<div class="matter-journal-list matter-journal-list-card">'+js.slice(0,8).map(matterJournalRow).join('')+'</div>':'<div class="hint">Записи журнала помогут быстро восстановить ход работы по делу.</div>')+
    '</div>'+
    (noteRow&&noteRow[2]?matterNoteCard(noteRow[2]):'')+
    (done.length?'<div class="matter-premium-section"><div class="matter-premium-section-head"><h2>Выполнено</h2><span class="matter-section-link static">'+done.length+'</span></div><div class="matter-events-list matter-events-list-compact done-list">'+done.slice(0,4).map(function(t){ return matterPremiumTaskRow(t,m); }).join('')+'</div></div>':'')+
    '<div class="matter-bottom-actions">'+
      '<button class="matter-bottom-btn primary" data-act="m-add" data-id="'+id+'">'+ico('folder','s')+' <span>Добавить задачу</span></button>'+
      '<button class="matter-bottom-btn" data-act="m-moremenu" data-id="'+id+'">'+ico('more','s')+' <span>Ещё действия</span></button>'+
    '</div>'+
    '<div style="height:18px"></div>'+
  '</div>');
  $('#page')._mid=id; $('#page')._navType='matter';
}
function infoRow(i,l,v){ return '<div class="row">'+ico(i)+'<span class="rl">'+l+'<small>'+esc(v)+'</small></span></div>'; }

function editMatter(m){
  MED = m ? clone(m) : {id:null,title:'',type:'civil',basis:'agreement',client:'',phone:'',number:'',court:'',judge:'',investigator:'',article:'',role:'',restraint:'',opponent:'',stage:'Первая инстанция',dayRate:'',notes:'',archived:false};
  MED = sanitizeMatterByType(MED);
  openSheet(
  '<h2>'+(m?'Изменить досье':'Новое дело')+'</h2><p class="sh-sub">Основная карточка доверителя и производства.</p>'+
  '<div class="two"><div class="fld"><label>Тип производства</label><select id="m-type">'+Object.keys(MATTER_TYPES).map(function(k){return '<option value="'+k+'"'+(MED.type===k?' selected':'')+'>'+MATTER_TYPES[k].n+'</option>';}).join('')+'</select></div>'+
  '<div class="fld"><label>Основание ведения</label><select id="m-basis"><option value="">— не выбрано —</option>'+Object.keys(MATTER_BASIS).map(function(k){return '<option value="'+k+'"'+(MED.basis===k?' selected':'')+'>'+MATTER_BASIS[k].n+'</option>';}).join('')+'</select></div></div>'+
  '<div id="matter-dynamic"></div>'+
  '<button class="btn" data-act="m-save">Сохранить</button>');
  $('#sheet').classList.add('matter-editor-sheet');
  renderMatterDynamic();
  setTimeout(function(){ if(!m){ var e=$('#m-title'); if(e)e.focus(); } },340);
}
function saveMatter(){
  pullMatterDraft();
  var title=(MED&&MED.title||'').trim(); if(!title){toast('Введите название дела');return;}
  var o={title:title,type:MED.type||'other',basis:MED.basis||'',client:MED.client||'',phone:MED.phone||'',number:MED.number||'',stage:MED.stage||'',court:MED.court||'',judge:MED.judge||'',investigator:MED.investigator||'',article:MED.article||'',role:MED.role||'',restraint:MED.restraint||'',opponent:MED.opponent||'',dayRate:+MED.dayRate||0,notes:(($('#m-notes')&&$('#m-notes').value)||MED.notes||'').trim()};
  o=sanitizeMatterByType(o);
  var wasNew=!MED.id;
  if(MED.id) Object.assign(matter(MED.id),o); else {o.id=uid();o.archived=false;o.created=new Date().toISOString();S.matters.unshift(o);MED.id=o.id;}
  addJournal(MED.id,wasNew?'Досье создано':'Досье обновлено',today(),'system',true);
  save(); closeSheet(); if($('#page').classList.contains('open'))openMatter(MED.id); render(); toast('Дело сохранено');
}

function addJournal(mid,text,date,type,silent){
  if(!mid||!text)return; S.journal.unshift({id:uid(),mid:mid,date:date||today(),text:text,type:type||'note',created:new Date().toISOString()}); if(!silent)save();
}
function sheetJournal(mid){
  openSheet('<h2>Запись в журнал дела</h2><p class="sh-sub">Краткая хронология работы и процессуальных событий.</p>'+
    (!mid?'<div class="fld"><label>Дело</label><select id="j-mid-select"><option value="">— выбрать дело —</option>'+activeM().map(function(m){return '<option value="'+m.id+'">'+esc(m.title)+'</option>';}).join('')+'</select></div>':'')+
    '<div class="fld"><label>Дата</label><input id="j-date" type="date" value="'+today()+'"></div>'+
    '<div class="fld"><label>Событие / заметка</label><textarea id="j-text" rows="5" placeholder="Подано ходатайство, получены документы, заседание перенесено…"></textarea></div>'+
    '<input type="hidden" id="j-mid" value="'+esc(mid)+'"><button class="btn" data-act="j-save">Добавить в журнал</button>');
}
function sheetParticipation(mid){
  var m=mid?matter(mid):null;
  openSheet('<h2>День участия</h2><p class="sh-sub">Любое фактическое участие считается как 1 день, даже если оно длилось несколько минут.</p>'+
    '<div class="two"><div class="fld"><label>Дата</label><input id="pt-date" type="date" value="'+today()+'"></div><div class="fld"><label>Вид участия</label><select id="pt-kind">'+Object.keys(PART_KINDS).map(function(k){return '<option value="'+k+'">'+PART_KINDS[k]+'</option>';}).join('')+'</select></div></div>'+
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
  openSheet('<div class="quickintro"><h2>Быстрая запись</h2><p class="sh-sub">Добавьте нужное действие без перехода по разделам.</p></div><div class="quickgrid quickgrid-core">'+
    quickItem('gavel','Заседание','qa-hearing','blue')+
    quickItem('user','Встреча','qa-meeting','purple')+
    quickItem('flag','Процессуальный срок','qa-deadline','red')+
    quickItem('check','Задача','qa-task','green')+
    quickItem('doc','Запись в журнал','qa-journal','gold')+
  '</div>');
  $('#sheet').classList.add('quick-sheet');
}
function quickItem(i,t,act,tone){return '<button class="quickitem q-'+(tone||'slate')+'" data-act="'+act+'"><span class="qico">'+ico(i,'l')+'</span><b>'+t+'</b></button>';}

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
  GQ=''; openSheet('<h2>Глобальный поиск</h2><p class="sh-sub">Доверители, номера дел, суды, статьи, задачи и журнал.</p>'+
    '<div class="fld"><input id="gq" placeholder="Например: Ошарин, 81 УК, Ивановский суд" autocomplete="off"></div><div id="gresults">'+
    '<div class="hint">Введите фамилию, номер дела, суд, статью или часть заметки.</div></div>');
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
  var info='<table>'+[
    ['Тип',matterType(m).n],['Основание ведения',matterBasisLabel(m.basis)],['Доверитель',m.client],['Номер дела / материала',m.number],['Суд / орган',m.court],['Судья',m.judge],['Следователь',m.investigator],['Статья / квалификация',m.article],['Статус',m.role],['Мера пресечения',m.restraint],['Оппонент',m.opponent],['Стадия',m.stage]
  ].filter(function(r){return r[1];}).map(function(r){return '<tr><td style="width:38%;color:#555">'+r[0]+'</td><td><b>'+esc(r[1])+'</b></td></tr>';}).join('')+
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
  var st = ('Notification' in window) ? Notification.permission : 'unsupported';
  openSheet('<h2>Напоминания</h2><p class="sh-sub">Локальное напоминание за 10 минут до задачи и за час до заседания.</p>'+
   '<div class="hint">'+(st==='unsupported'
     ? 'Этот браузер не поддерживает уведомления. На iPhone они работают, только когда приложение <b>установлено на экран «Домой»</b> (iOS 16.4 и новее).'
     : st==='denied' ? 'Уведомления запрещены в настройках. Разрешите их: Настройки → Safari (или иконка приложения) → Уведомления.'
     : S.settings.notify ? 'Напоминания включены. На iPhone они срабатывают только пока веб-приложение активно; iOS может приостанавливать его в фоне.'
     : 'Нажмите «Включить» и разрешите уведомления. На iPhone предварительно добавьте приложение на экран «Домой».')+'</div>'+
   '<button class="btn'+(S.settings.notify?' ghost':'')+'" data-act="notify">'+
     (S.settings.notify?'Выключить напоминания':'Включить напоминания')+'</button>'+
   '<div class="hint" style="margin-top:12px;font-size:12px">Для судебных заседаний и критичных процессуальных сроков дополнительно используйте системный «Календарь» или «Напоминания» iPhone: полностью автономное PWA не может надёжно запускать фоновые таймеры после выгрузки системой.</div>');
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
  await clearSecureStorage();S.settings.seen=false;S.ui.q='';S.ui.taskChip='';S.ui.taskType='';S.ui.showArch=false;S.ui.matterType='';S.ui.matterBasis='';save();closeAll();go('today');toast('Все данные удалены');setTimeout(showIntro,320);
}

function demo(){
  if(S.matters.length||S.tasks.length||S.participation.length||S.journal.length){if(!confirm('Примеры будут добавлены к текущей базе. Продолжить?'))return;}
  var m1={id:uid(),title:'Ошарин А.С. — освобождение по болезни',type:'criminal',client:'Ошарин Александр Сергеевич',number:'материал 4/17-2026',court:'Ивановский районный суд',article:'ст. 81 УК РФ',role:'осужденный',stage:'Первая инстанция',dayRate:10000,notes:'Оспаривается полнота медицинского освидетельствования. Контроль медицинских документов и процессуальных сроков.',archived:false,created:new Date().toISOString()};
  var m2={id:uid(),title:'Наследственный спор — признание свидетельств недействительными',type:'civil',client:'Иванова А.С.',number:'2-1438/2026',court:'Кинешемский городской суд',judge:'Судья Петрова Н.В.',stage:'Первая инстанция',dayRate:10000,notes:'Фактическое принятие наследства, спор о составе наследственной массы.',archived:false,created:new Date().toISOString()};
  var m3={id:uid(),title:'Песков — спор о квалификации',type:'criminal',client:'Песков Д.С.',number:'УД-88/2026',court:'Районный суд',article:'ч. 2 ст. 228 УК РФ / обвинение в покушении на сбыт',role:'подсудимый',stage:'Первая инстанция',dayRate:10000,archived:false,created:new Date().toISOString()};
  S.matters=[m1,m2,m3].concat(S.matters);
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
    case 'journal-open': closeSheet(); if(matter(id))openMatter(id); break;
    case 'reschedule': {var ov=overdue();if(!ov.length)break;if(confirm('Перенести '+ov.length+' просроченных задач на сегодня?')){ov.forEach(function(t){t.due=today();});save();render();toast('Перенесено: '+ov.length);}break;}
    case 'f-late': go('tasks');S.ui.taskSeg='open';S.ui.taskChip='late';S.ui.taskType='';save();renderTasks();break;
    case 'f-today': go('tasks');S.ui.taskSeg='open';S.ui.taskChip='today';S.ui.taskType='';save();renderTasks();break;
    case 'f-hear': go('tasks');S.ui.taskSeg='open';S.ui.taskChip='';S.ui.taskType='hearing';save();renderTasks();break;
    case 'today-more-tasks': go('tasks');S.ui.taskSeg='open';S.ui.taskChip='today';S.ui.taskType='';save();renderTasks();break;
    case 'today-more-hearings': go('tasks');S.ui.taskSeg='open';S.ui.taskChip='';S.ui.taskType='hearing';save();renderTasks();break;
    case 'f-deadline': go('tasks');S.ui.taskSeg='open';S.ui.taskChip='';S.ui.taskType='deadline';save();renderTasks();break;
    case 'seg': S.ui.taskSeg=v;save();renderTasks();break;
    case 'chip': S.ui.taskChip=v;save();renderTasks();break;
    case 'search': S.ui._sq=!S.ui._sq;if(!S.ui._sq)S.ui.q='';renderTasks();break;
    case 'task-type-sheet': sheetTaskTypeFilters();break;
    case 'task-type-filter': S.ui.taskType=v||'';save();closeSheet();renderTasks();break;
    case 'arch': S.ui.showArch=!S.ui.showArch;S.ui.matterScope=S.ui.showArch?'archive':'active';save();renderMatters();break;
    case 'matter-scope': S.ui.matterScope=v||'active';S.ui.showArch=S.ui.matterScope==='archive';save();renderMatters();break;
    case 'matter-filter-sheet': sheetMatterFilters();break;
    case 'm-filter': S.ui.matterType=v||'';save();closeSheet();renderMatters();break;
    case 'm-basis-filter': S.ui.matterBasis=v||'';save();closeSheet();renderMatters();break;

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
    case 'e-kind': {pullEditor();var prevKind=ED.kind;ED.kind=v;if(v==='hearing'){ED.pri='mid';ED.steps=[];if(prevKind!=='hearing')syncHearingCourt(true);}if(v==='meeting'){ED.pri='mid';ED.steps=[];ED.due=ED.due||today();}if(v==='deadline'){ED.pri='high';ED.deadlineCode=ED.deadlineCode||'GPK';ED.deadlineRuleId=legalDeadlineRule(ED.deadlineRuleId)?ED.deadlineRuleId:((legalDeadlineRules(ED.deadlineCode)[0]||{}).id||'gpk-appeal');ED.sourceDate=ED.sourceDate||today();var rr=legalDeadlineRule(ED.deadlineRuleId),cr=calculateLegalDeadline(rr,ED.sourceDate);if(rr){ED.title=rr.name;ED.rule=rr.article;ED.ruleArticle=rr.article;}if(cr)ED.due=cr.end;}if(prevKind==='deadline'&&(v==='task'||v==='meeting')){ED.title='';ED.rule='';ED.ruleArticle='';ED.ruleCode='';ED.due=ED.due||today();}drawEditor();break;}
    case 'e-pri': ED.pri=v;pullEditor();drawEditor();break;
    case 'e-quick': pullEditor();ED.due=v===''?'':addD(today(),+v);drawEditor();break;
    case 'e-save': saveTask();break;
    case 'e-del': {var edt=ED&&ED.id?S.tasks.filter(function(x){return x.id===ED.id;})[0]:null;if(edt&&edt.kind==='hearing'&&(hearingNeedsResult(edt)||hearingHasResult(edt))){toast('Прошедшее заседание сохраняется в истории');break;}if(confirm(ED&&ED.kind==='hearing'?'Удалить заседание?':(ED&&ED.kind==='meeting'?'Удалить встречу?':'Удалить задачу?'))){S.tasks=S.tasks.filter(function(x){return x.id!==ED.id;});save();closeSheet();render();if($('#page').classList.contains('open'))openMatter($('#page')._mid);toast('Удалено');}break;}

    /* matters */
    case 'new-matter': closeSheet();editMatter(null);break;
    case 'matter': if(matter(id)){closeSheet();openMatter(id);}break;
    case 'm-edit': {var me=matter($('#page')._mid);if(me)editMatter(me);break;}
    case 'm-moremenu': sheetMatterMore(id||$('#page')._mid); break;
    case 'm-save': saveMatter();break;
    case 'm-add': editTask(null,{mid:id,due:today()});break;
    case 'm-hearing': editTask(null,{mid:id,kind:'hearing',pri:'mid',due:'',time:''});break;
    case 'm-deadline': sheetDeadline(id);break;
    case 'm-tpl': sheetTemplates(id);break;
    case 'm-part': sheetParticipation(id);break;
    case 'm-journal': sheetJournal(id);break;
    case 'm-print': if(matter($('#page')._mid))printMatter($('#page')._mid);break;
    case 'm-arch': {var mm=matter(id);if(!mm)break;mm.archived=!mm.archived;addJournal(id,mm.archived?'Дело отправлено в архив':'Дело возвращено в работу',today(),'system',true);save();closeAll();render();toast(mm.archived?'Дело в архиве':'Дело возвращено в работу');break;}
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
    if(mv){if(mi)mi.value=mv;applyKnownCourtJudge(mv,'matter');vib(5);}
    e.target.value=''; return;
  }
  if(e.target.id==='m-type'){
    pullMatterDraft();
    MED.type=e.target.value||'other';
    MED=sanitizeMatterByType(MED);
    renderMatterDynamic();
    vib(5);
    return;
  }
  if(e.target.id==='m-stage-choice'){ var s=e.target.value, i=$('#m-stage'); if(s&&i){ i.value=s; MED&& (MED.stage=s); vib(5);} e.target.value=''; return; }
  if(e.target.id==='m-role-choice'){ var r=e.target.value, i2=$('#m-role'); if(r&&i2){ i2.value=r; MED&& (MED.role=r); vib(5);} e.target.value=''; return; }
  if(e.target.id==='m-restraint-choice'){ var rr=e.target.value, i3=$('#m-restraint'); if(rr&&i3){ i3.value=rr; MED&& (MED.restraint=rr); vib(5);} e.target.value=''; return; }
  if(e.target.id==='m-judge-choice'){ var jv=e.target.value, ji=$('#m-judge'); if(jv){ if(ji)ji.value=jv; MED&& (MED.judge=jv); applyKnownJudgeCourt(jv,'matter'); vib(5);} e.target.value=''; return; }
  if(e.target.id==='e-deadline-code'){
    ED.deadlineCode=e.target.value;
    var rs=legalDeadlineRules(ED.deadlineCode),sel=$('#e-deadline-rule');
    ED.deadlineRuleId=(rs[0]||{}).id||'';
    if(sel){sel.innerHTML=legalDeadlineRuleOptions(ED.deadlineCode,ED.deadlineRuleId);sel.value=ED.deadlineRuleId;}
    applyDeadlineRuleFromDom(); return;
  }
  if(e.target.id==='e-deadline-rule'||e.target.id==='e-source'){pullEditor();applyDeadlineRuleFromDom();return;}
  if(e.target.classList&&e.target.classList.contains('task-date-native')){
    var tid=e.target.dataset.taskDateId, val=e.target.value;
    if(tid&&val){ closeSheet(); moveTaskToDate(tid,val,'Дата изменена'); }
    return;
  }
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
  if(e.target.id==='q'){S.ui.q=e.target.value;renderTaskList();}
  if(e.target.id==='gq'){GQ=e.target.value;renderGlobalSearch();}
  if(e.target.id==='e-hjudge'&&ED&&ED.kind==='hearing'){
    ED.hearingJudge=e.target.value.trim(); applyKnownJudgeCourt(ED.hearingJudge,'hearing');
  }
  if(e.target.id==='e-place'&&ED&&ED.kind==='hearing'){
    ED.place=e.target.value.trim(); var cc=commonCourtByValue(ED.place); if(cc&&cc.judge)applyKnownCourtJudge(ED.place,'hearing');
  }
  if(e.target.id==='m-judge'){ applyKnownJudgeCourt(e.target.value.trim(),'matter'); }
  if(e.target.id==='m-court'){ var mc=commonCourtByValue(e.target.value.trim()); if(mc&&mc.judge)applyKnownCourtJudge(e.target.value.trim(),'matter'); }
});
document.addEventListener('keydown',function(e){
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
  EDGE_SWIPE.on = t.clientX <= 44;
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
   Swipe по задачам — 3.1.27
   Завершение: только кружок слева.
   Свайп справа налево: быстрые действия только после осознанного жеста
   и отпускания пальца. Микросвайпы ничего не открывают.
   ===================================================================== */
var TASK_TOUCH={on:false,row:null,id:'',sx:0,sy:0,dx:0,dy:0,horizontal:false};
function taskTouchReset(animate){
  var row=TASK_TOUCH.row;
  if(row){
    if(animate) row.classList.add('swipe-snap');
    row.style.transform='';
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
  var t=e.touches[0];
  if(t.clientX<=44) return;
  TASK_TOUCH.on=true;TASK_TOUCH.row=row;TASK_TOUCH.id=row.dataset.id||'';
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
  var x=Math.max(-104,Math.min(0,TASK_TOUCH.dx));
  TASK_TOUCH.row.style.transform='translate3d('+x+'px,0,0)';
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
