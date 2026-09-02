/* =====================================================================
   Ежедневник адвоката — личный помощник
   Vanilla JS, офлайн, данные только на устройстве
   ===================================================================== */
'use strict';

/* ------------------------- state + encrypted local storage ------------------------- */
var KEY = 'advokat_pro_v1'; // legacy localStorage key (migration only)
var META_KEY = 'advokat_secure_meta_v3';
var DB_NAME = 'advokat_secure_v3';
var DB_STORE = 'vault';
var DB_VER = 1;

var DEF = {
  matters: [], tasks: [], participation: [], journal: [], time: [],
  settings: {
    theme:'dark', name:'', dayRate:0, cur:'₽', notify:false,
    seen:false, dismissed:false, backupEveryDays:7, lastBackup:'',
    lockOnReturn:true, version:3
  },
  ui: {
    tab:'today', taskSeg:'open', taskChip:'', q:'', calM:null, calSel:null,
    showArch:false, matterType:'', matterStage:''
  }
};
var S = JSON.parse(JSON.stringify(DEF)), mem = null;
var DBP = null, META = null, SESSION_KEY = null, saveTimer = null, unlocked = false;

function clone(x){ return JSON.parse(JSON.stringify(x)); }
function mergeState(d){
  d = d || {};
  var out = Object.assign(clone(DEF), d);
  out.settings = Object.assign({}, DEF.settings, d.settings||{});
  delete out.settings.pin; delete out.settings.rate;
  out.ui = Object.assign({}, DEF.ui, d.ui||{});
  out.matters = Array.isArray(d.matters)?d.matters:[];
  out.tasks = Array.isArray(d.tasks)?d.tasks:[];
  out.participation = Array.isArray(d.participation)?d.participation:[];
  out.journal = Array.isArray(d.journal)?d.journal:[];
  out.time = Array.isArray(d.time)?d.time:[];
  // Migration: hourly-rate fields become day-rate defaults; old time logs become participation days.
  out.matters.forEach(function(m){
    if(m.dayRate==null) m.dayRate = 0;
    if(!m.type) m.type = 'other';
    if(!m.stage) m.stage = 'Первая инстанция';
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
async function loadForSecret(secret){
  META = getMeta();
  var key=await deriveKey(secret,META.salt);
  var payload=await idbGet('state');
  if(payload){
    var d=await decryptObj(payload,key); S=mergeState(d); SESSION_KEY=key; unlocked=true; return S;
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
  deadline:{n:'Проц. срок',  i:'flag'}
};
var PRI = { high:{n:'Срочно',c:'red'}, mid:{n:'Обычный',c:'yel'}, low:{n:'Низкий',c:''} };
var STAGE = ['Консультация','Досудебная работа','Дознание / следствие','Первая инстанция','Апелляция','Кассация','Надзор','Исполнение','Завершено'];
var MATTER_TYPES = {
  criminal:{n:'Уголовное',short:'УК',c:'#8B7BD8'}, civil:{n:'Гражданское',short:'ГПК',c:'#4E86C6'},
  admin:{n:'Административное (КАС)',short:'КАС',c:'#3FA9A0'}, koap:{n:'КоАП',short:'КоАП',c:'#D9724A'},
  enforcement:{n:'Исполнительное',short:'ФССП',c:'#2FA36B'}, other:{n:'Иное',short:'Иное',c:'#7A8FA6'}
};
var PART_KINDS = { hearing:'Судебное заседание',investigation:'Следственное действие',visit:'Выезд / посещение',meeting:'Встреча',other:'Иное участие' };
function matterType(m){ return MATTER_TYPES[m&&m.type]||MATTER_TYPES.other; }
function participationOf(id){ return S.participation.filter(function(p){ return p.mid===id; }); }
function journalOf(id){ return S.journal.filter(function(j){ return j.mid===id; }); }


function matter(id){ return S.matters.filter(function(m){ return m.id===id; })[0]; }
function tasksOf(id){ return S.tasks.filter(function(t){ return t.mid===id; }); }
function activeM(){ return S.matters.filter(function(m){ return !m.archived; }); }
function overdue(){ return S.tasks.filter(function(t){ return !t.done && t.due && dd(t.due)<0; }); }
function dueToday(){ return S.tasks.filter(function(t){ return !t.done && t.due===today(); }); }
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
function openPage(html){ var p = $('#page'); p.innerHTML = html; p._mid = null;
  p.classList.add('open'); $('#scrim').classList.add('open'); p.scrollTop = 0; }
function closeAll(){ $('#sheet').classList.remove('open'); $('#page').classList.remove('open');
  $('#scrim').classList.remove('open'); }
function closeSheet(){ $('#sheet').classList.remove('open');
  if(!$('#page').classList.contains('open')) $('#scrim').classList.remove('open'); }

/* =====================================================================
   TASK CARD
   ===================================================================== */
function dueTag(t){
  if(!t.due) return '';
  var n = dd(t.due), c = t.done ? '' : (n<0?'red':n<=1?'yel':n<=6?'':'');
  var s = t.done ? fmtShort(t.due) : relD(t.due);
  return '<span class="tag '+c+'">'+ico('cal','s')+esc(s)+'</span>';
}
function taskCard(t,opts){
  opts = opts||{};
  var m = t.mid ? matter(t.mid) : null;
  var sd = stepsDone(t), st = (t.steps||[]).length;
  return '<div class="task p-'+t.pri+' k-'+t.kind+(t.done?' done':'')+'" data-act="task" data-id="'+t.id+'">'+
    '<button class="chk" data-act="toggle" data-id="'+t.id+'">'+ico('check')+'</button>'+
    '<div class="tbody">'+
      '<div class="trow">'+
        (t.time?'<span class="ttime mono">'+esc(t.time)+'</span>':'')+
        '<div class="tt">'+esc(t.title)+'</div>'+
      '</div>'+
      '<div class="meta">'+
        (t.kind!=='task' ? '<span class="tag">'+ico(KIND[t.kind].i,'s')+KIND[t.kind].n+'</span>' : '')+
        (opts.noMatter||!m ? '' : '<span class="tag dot" style="color:'+mColor(m.id)+'">'+esc(m.title)+'</span>')+
        (opts.noDue ? '' : dueTag(t))+
        (t.pri==='high' && !t.done ? '<span class="tag red">'+ico('flag','s')+'Срочно</span>' : '')+
        (t.place?'<span class="tag">'+esc(t.place)+'</span>':'')+
      '</div>'+
      (t.note?'<div class="note">'+esc(t.note.length>140?t.note.slice(0,140)+'…':t.note)+'</div>':'')+
      (st?'<div class="steps"><div class="mini"><i style="width:'+(sd/st*100)+'%"></i></div>'+sd+' из '+st+' этапов</div>':'')+
    '</div></div>';
}
function groupList(list,opts){
  if(!list.length) return '';
  var buckets = [['Просрочено',[],'red'],['Сегодня',[]],['Завтра',[]],['Ближайшая неделя',[]],['Позже',[]],['Без срока',[]],['Выполнено',[]]];
  list.forEach(function(t){
    var i = t.done ? 6 : !t.due ? 5 : dd(t.due)<0 ? 0 : dd(t.due)===0 ? 1 : dd(t.due)===1 ? 2 : dd(t.due)<=7 ? 3 : 4;
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

function renderToday(){
  var od = overdue(), td = dueToday();
  var hear = S.tasks.filter(function(t){ return !t.done && t.kind==='hearing' && t.due && dd(t.due)>=0 && dd(t.due)<=7; }).sort(sortT);
  var dls = deadlineTasks().filter(function(t){ return dd(t.due)<=14; });
  var todayAll = od.concat(td).filter(function(t,i,a){ return a.indexOf(t)===i; }).sort(sortT);
  var timed = todayAll.filter(function(t){ return t.time; });
  var untimed = todayAll.filter(function(t){ return !t.time; });
  var doneToday = S.tasks.filter(function(t){ return t.done && t.doneAt && t.doneAt.slice(0,10)===today(); }).length;
  var total = todayAll.length + doneToday;
  var pct = total ? Math.round(doneToday/total*100) : (S.tasks.length?100:0);
  var d = new Date();
  var nh = S.tasks.filter(function(t){ return !t.done && t.kind==='hearing' && t.due && dd(t.due)>=0; }).sort(sortT)[0];
  var brief = od.length
    ? '<b>'+od.length+' '+plural(od.length,'просроченная задача','просроченные задачи','просроченных задач')+'</b>. Сначала закройте критичное.'
    : td.length ? '<b>'+td.length+' '+plural(td.length,'задача','задачи','задач')+' на сегодня</b>. Контроль сроков включён.'
    : noData() ? '<b>Рабочее пространство пусто.</b> Создайте первое досье или задачу.'
    : '<b>Критичных задач на сегодня нет.</b> Проверьте ближайшие сроки и заседания.';

  var html = brandLine()+
  '<div class="top"><div><div class="eyebrow">'+greet()+(S.settings.name?', '+esc(S.settings.name):'')+'</div>'+
    '<h1>Сегодня</h1><div class="sub">'+d.getDate()+' '+MON[d.getMonth()]+' · '+cap(new Intl.DateTimeFormat('ru-RU',{weekday:'long'}).format(d))+'</div></div>'+
    '<div class="topacts">'+
      '<button class="iconbtn" data-act="global-search" title="Глобальный поиск">'+ico('search')+'</button>'+
      '<button class="iconbtn" data-act="print-day" title="План дня">'+ico('doc')+'</button>'+
      '<button class="iconbtn'+(S.settings.notify?' on':'')+'" data-act="notify-sheet">'+ico('bell')+'</button>'+
    '</div></div>'+
  (backupDue() ? '<button class="backupwarn" data-act="backup-sheet">'+ico('lock','s')+'<span><b>Нужна резервная копия</b><small>'+(S.settings.lastBackup?'Последняя — '+backupAge()+' дн. назад':'Ещё не создавалась')+'</small></span>'+ico('chev','s')+'</button>' : '')+
  '<div class="hero"><div class="ringrow">'+ring(pct)+'<div class="rt"><div class="quote">'+brief+'</div></div></div></div>'+
  '<div class="kpis">'+
    kpi(od.length,'Просроч.','red','f-late')+
    kpi(td.length,'Сегодня','gold','f-today')+
    kpi(hear.length,'Заседан.','blue','f-hear')+
    kpi(dls.length,'Сроков','ok','f-deadline')+
  '</div>';

  if(nh){
    var nm = nh.mid?matter(nh.mid):null;
    html += '<div class="sec"><h2>Ближайшее заседание</h2><button class="link" data-act="task" data-id="'+nh.id+'">Открыть</button></div>'+
      '<div class="focuscard hearingfocus"><div class="focusdate"><b>'+fmtShort(nh.due)+'</b><span>'+(nh.time||'время не задано')+'</span></div><div class="focusbody"><b>'+esc(nh.title)+'</b>'+
      '<span>'+esc([nm&&nm.title,nh.place].filter(Boolean).join(' · '))+'</span></div><button class="iconbtn" data-act="ics-task" data-id="'+nh.id+'" title="В календарь iPhone">'+ico('cal')+'</button></div>';
  }
  if(dls.length){
    html += '<div class="sec"><h2>Процессуальные сроки</h2><button class="link" data-act="deadline">Рассчитать</button></div>'+
      dls.slice(0,3).map(function(t){ return taskCard(t); }).join('');
  }
  if(timed.length){
    html += '<div class="sec"><h2>Расписание дня</h2></div>' + timed.map(function(t){ return taskCard(t,{noDue:true}); }).join('');
  }
  if(od.length){
    html += '<div class="sec"><h2 style="color:var(--dang)">Просрочено</h2><button class="link" data-act="reschedule">Перенести на сегодня</button></div>'+
      od.filter(function(t){ return !t.time; }).map(function(t){ return taskCard(t); }).join('');
  }
  var restToday = untimed.filter(function(t){ return t.due===today(); });
  if(restToday.length) html += '<div class="sec"><h2>На сегодня</h2></div>'+restToday.map(function(t){ return taskCard(t,{noDue:true}); }).join('');
  if(!todayAll.length && !nh && !dls.length){
    html += '<div class="card">'+empty('scale',noData()?'Рабочее пространство пусто':'На сегодня всё под контролем',
      noData()?'Создайте досье доверителя, заседание или процессуальный срок — они будут собраны на этом экране.'
        :'Срочных действий нет. Можно перейти к делам или запланировать следующую работу.',
      noData()?[{act:'new-matter',t:'Завести дело'},{act:'quick-add',t:'Быстрая запись',ghost:1}]:null)+'</div>';
  }
  var soon = S.tasks.filter(function(t){ return !t.done && t.due && dd(t.due)>=1 && dd(t.due)<=7 && t.kind!=='deadline' && t!==nh; }).sort(sortT).slice(0,5);
  if(soon.length) html += '<div class="sec"><h2>Ближайшая неделя</h2><button class="link" data-act="go-tasks">Все задачи</button></div>'+soon.map(function(t){ return taskCard(t); }).join('');
  var mlist = activeM().slice().sort(function(a,b){ var sa=matterStats(a),sb=matterStats(b); if(sb.late!==sa.late)return sb.late-sa.late; var na=sa.next?dd(sa.next.due):9999,nb=sb.next?dd(sb.next.due):9999; return na-nb; });
  if(mlist.length) html += '<div class="sec"><h2>Дела в работе</h2><button class="link" data-act="go-matters">Все</button></div>'+mlist.slice(0,3).map(matterCard).join('');
  $('#sc-today').innerHTML = html;
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
   SCREEN: ЗАДАЧИ
   ===================================================================== */
function renderTasks(){
  var u = S.ui;

  var chips = [['','Все'],['today','Сегодня'],['high','Срочные'],['late','Просроченные'],['week','На неделю'],['hearing','Заседания'],['deadline','Сроки'],['nodue','Без срока']];
  var open = S.tasks.filter(function(t){ return !t.done; }).length;
  var html = brandLine()+
  '<div class="top"><div><div class="eyebrow">Всего '+open+' в работе</div><h1>Задачи</h1></div>'+
    '<div class="topacts"><button class="iconbtn'+(u.q?' on':'')+'" data-act="search">'+ico('search')+'</button></div></div>'+
    (u.q!==''||u._sq ? '<div class="fld"><input id="q" placeholder="Поиск по задачам, делам, доверителям" value="'+esc(u.q)+'" autocomplete="off"></div>' : '')+
  '<div class="segbtns">'+
    ['open','all','done'].map(function(k,i){ return '<button data-act="seg" data-v="'+k+'"'+(u.taskSeg===k?' class="on"':'')+'>'+
      ['В работе','Все','Выполнено'][i]+'</button>'; }).join('')+
  '</div>'+
  '<div class="chips" style="margin-bottom:14px">'+chips.map(function(c){
    return '<button class="chip'+(u.taskChip===c[0]?' on':'')+'" data-act="chip" data-v="'+c[0]+'">'+c[1]+'</button>'; }).join('')+'</div>';

  html += '<div id="tasklist"></div>';
  $('#sc-tasks').innerHTML = html;
  renderTaskList();
  if(u._sq){ var el = $('#q'); if(el){ el.focus(); el.setSelectionRange(el.value.length,el.value.length); } }
}
function taskFilter(){
  var u = S.ui, q = u.q.toLowerCase().trim();
  return S.tasks.filter(function(t){
    if(q){ var m = t.mid?matter(t.mid):null;
      var hay = (t.title+' '+(t.note||'')+' '+(m?m.title+' '+(m.client||'')+' '+(m.number||''):'')).toLowerCase();
      if(hay.indexOf(q)<0) return false; }
    if(u.taskSeg==='open' && t.done) return false;
    if(u.taskSeg==='done' && !t.done) return false;
    if(u.taskChip==='today' && !(t.due && dd(t.due)<=0 && !t.done)) return false;
    if(u.taskChip==='high' && t.pri!=='high') return false;
    if(u.taskChip==='late' && !(t.due && dd(t.due)<0 && !t.done)) return false;
    if(u.taskChip==='week' && !(t.due && dd(t.due)>=0 && dd(t.due)<=7)) return false;
    if(u.taskChip==='nodue' && t.due) return false;
    if(u.taskChip==='hearing' && t.kind!=='hearing') return false;
    if(u.taskChip==='deadline' && t.kind!=='deadline') return false;
    return true;
  }).sort(sortT);
}
function renderTaskList(){
  var box = $('#tasklist'); if(!box) return;
  var list = taskFilter();
  box.innerHTML = list.length ? groupList(list)
    : empty('list', S.ui.q ? 'Ничего не найдено' : 'Задач пока нет',
        S.ui.q ? 'Измените поисковый запрос или фильтр.'
          : 'Задача может быть заседанием, звонком, документом или процессуальным сроком — всё с напоминанием и сроком.',
        S.ui.q ? null
          : [{act:'new-task',t:'Добавить задачу'},{act:'templates',t:'Шаблон чек-листа',ghost:1}]);
}

/* =====================================================================
   SCREEN: ДЕЛА
   ===================================================================== */
function matterStats(m){
  var t = tasksOf(m.id), open = t.filter(function(x){ return !x.done; });
  var late = open.filter(function(x){ return x.due && dd(x.due)<0; }).length;
  var nh = t.filter(function(x){ return !x.done && x.kind==='hearing' && x.due && dd(x.due)>=0; }).sort(sortT)[0];
  var parts = participationOf(m.id).slice().sort(function(a,b){ return a.date<b.date?1:-1; });
  var rate = +m.dayRate || +S.settings.dayRate || 0;
  var sum = parts.reduce(function(a,e){ return a + (+e.rate||rate); },0);
  return { open:open.length, done:t.length-open.length, all:t.length, late:late, next:nh,
           days:parts.length, sum:sum, parts:parts };
}
function matterCard(m){
  var st = matterStats(m), mt = matterType(m), c = mColor(m.id);
  var badge = st.late ? '<span class="badge red">'+st.late+' просроч.</span>' :
    st.next&&dd(st.next.due)<=3 ? '<span class="badge gold">заседание '+relD(st.next.due)+'</span>' : '';
  return '<div class="matter" data-act="matter" data-id="'+m.id+'">'+badge+
    '<div class="mt"><div class="avatar" style="background:'+c+'">'+initials(m.client||m.title)+'</div>'+
    '<div style="flex:1;min-width:0"><div class="mtype" style="color:'+mt.c+'">'+mt.n+' · '+esc(m.stage||'Без стадии')+'</div>'+
    '<h3>'+esc(m.title)+'</h3>'+
    '<div class="cl">'+esc([m.client,m.number].filter(Boolean).join(' · ')||'Без номера')+'</div></div></div>'+
    '<div class="stats"><div><b>'+st.open+'</b>в работе</div><div><b>'+st.done+'</b>готово</div>'+
    '<div><b>'+st.days+'</b>'+plural(st.days,'день участия','дня участия','дней участия')+'</div>'+
    (st.next?'<div><b>'+fmtShort(st.next.due)+'</b>заседание</div>':'')+
    '</div></div>';
}
function renderMatters(){
  var list = S.matters.filter(function(m){
    if(S.ui.showArch ? !m.archived : m.archived) return false;
    if(S.ui.matterType && m.type!==S.ui.matterType) return false;
    return true;
  });
  list.sort(function(a,b){
    var A = matterStats(a), B = matterStats(b);
    if(!!A.late !== !!B.late) return A.late?-1:1;
    var an = A.next?A.next.due:'9999', bn = B.next?B.next.due:'9999';
    if(an!==bn) return an<bn?-1:1;
    return B.open-A.open;
  });
  var arch = S.matters.filter(function(m){ return m.archived; }).length;
  var typeChips = [['','Все']].concat(Object.keys(MATTER_TYPES).map(function(k){ return [k,MATTER_TYPES[k].short]; }));
  var html = brandLine()+
  '<div class="top"><div><div class="eyebrow">'+activeM().length+' в производстве</div><h1>Дела</h1></div>'+
    '<div class="topacts"><button class="iconbtn" data-act="global-search" title="Поиск">'+ico('search')+'</button>'+
    '<button class="iconbtn'+(S.ui.showArch?' on':'')+'" data-act="arch">'+ico('arch')+'</button>'+
    '<button class="iconbtn" data-act="new-matter">'+ico('plus')+'</button></div></div>'+
  '<div class="chips scroll matterfilters" style="margin:-4px 0 14px">'+typeChips.map(function(c){
    return '<button class="chip'+(S.ui.matterType===c[0]?' on':'')+'" data-act="m-filter" data-v="'+c[0]+'">'+c[1]+'</button>'; }).join('')+'</div>';
  html += list.length ? list.map(matterCard).join('')
    : empty('folder', S.ui.showArch?'Архив пуст':'Дел пока нет',
        S.ui.showArch?'Завершённые дела можно отправлять в архив из карточки дела.'
          :'Создайте досье: тип производства, доверитель, суд/орган, стадия, задачи, участие и журнал событий.',
        S.ui.showArch?null:[{act:'new-matter',t:'Завести дело'},{act:'templates',t:'Начать с шаблона',ghost:1}]);
  if(!S.ui.showArch && arch) html += '<button class="btn ghost" data-act="arch" style="margin-top:14px">Архив ('+arch+')</button>';
  $('#sc-matters').innerHTML = html;
}

/* =====================================================================
   SCREEN: КАЛЕНДАРЬ
   ===================================================================== */
function renderCal(){
  var u = S.ui;
  if(!u.calM) u.calM = today().slice(0,7);
  if(!u.calSel) u.calSel = today();
  var y = +u.calM.slice(0,4), mo = +u.calM.slice(5,7)-1;
  var first = new Date(y,mo,1), start = (first.getDay()+6)%7;
  var dim = new Date(y,mo+1,0).getDate(), dimPrev = new Date(y,mo,0).getDate();
  var cells = [];
  for(var i=0;i<start;i++) cells.push({d:iso(new Date(y,mo-1,dimPrev-start+i+1)),out:true});
  for(var j=1;j<=dim;j++) cells.push({d:iso(new Date(y,mo,j))});
  while(cells.length%7) cells.push({d:iso(new Date(y,mo+1,cells.length-start-dim+1)),out:true});

  var byDay = {};
  S.tasks.forEach(function(t){ if(t.due){ (byDay[t.due]=byDay[t.due]||[]).push(t); } });

  var grid = ['пн','вт','ср','чт','пт','сб','вс'].map(function(d){ return '<div class="cdow">'+d+'</div>'; }).join('');
  grid += cells.map(function(c){
    var its = (byDay[c.d]||[]).filter(function(t){ return !t.done; });
    var dots = [];
    if(its.some(function(t){ return t.kind==='hearing'; })) dots.push('var(--purple)');
    if(its.some(function(t){ return t.pri==='high'&&t.kind!=='hearing'; })) dots.push('var(--dang)');
    if(its.some(function(t){ return t.pri!=='high'&&t.kind!=='hearing'; })) dots.push('var(--gold)');
    var wd = parseD(c.d).getDay();
    return '<button class="cday'+(c.out?' out':'')+(c.d===today()?' today':'')+(c.d===u.calSel?' sel':'')+
      ((wd===0||wd===6)?' wk':'')+'" data-act="cday" data-v="'+c.d+'">'+parseD(c.d).getDate()+
      '<span class="cdots">'+dots.slice(0,3).map(function(x){ return '<i style="background:'+x+'"></i>'; }).join('')+'</span></button>';
  }).join('');

  var day = (byDay[u.calSel]||[]).sort(sortT);
  var html = brandLine()+
  '<div class="top"><div><div class="eyebrow">Планирование</div><h1>Календарь</h1></div>'+
   '<div class="topacts"><button class="iconbtn" data-act="global-search">'+ico('search')+'</button><button class="iconbtn" data-act="cal-today">'+ico('sun')+'</button></div></div>'+
  '<div class="card"><div class="calhead">'+
    '<button class="iconbtn" data-act="cal-m" data-v="-1">'+ico('left')+'</button>'+
    '<b>'+MONN[mo]+' '+y+'</b>'+
    '<button class="iconbtn" data-act="cal-m" data-v="1">'+ico('chev')+'</button></div>'+
    '<div class="cgrid">'+grid+'</div></div>'+
  '<div class="sec"><h2>'+fmtD(u.calSel,true)+' · '+cap(DOW[parseD(u.calSel).getDay()])+'</h2>'+
    '<button class="link" data-act="new-on-day">Добавить</button></div>'+
  (day.length ? day.map(function(t){ return taskCard(t,{noDue:true}); }).join('')
    : '<div class="card">'+empty('cal','Свободный день','На эту дату ничего не запланировано.',
        [{act:'new-on-day',t:'Запланировать на этот день'}])+'</div>');
  $('#sc-cal').innerHTML = html;
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
function renderMore(){
  var w=weekStats();
  var html=brandLine()+
  '<div class="top"><div><div class="eyebrow">Кабинет</div><h1>Ещё</h1></div><div class="topacts"><button class="iconbtn" data-act="global-search">'+ico('search')+'</button></div></div>'+
  '<div class="card"><div class="sec" style="margin:0 0 12px"><h2>За последние 7 дней</h2></div><div class="kpis" style="margin:0">'+
    '<div class="kpi ok"><b>'+w.done+'</b><span>выполнено</span></div><div class="kpi gold"><b>'+w.days+'</b><span>дней участия</span></div>'+
    '<div class="kpi blue"><b>'+Math.round(w.sum/1000)+'к</b><span>участие</span></div><div class="kpi"><b>'+S.tasks.filter(function(t){return !t.done;}).length+'</b><span>в работе</span></div></div></div>'+
  iphoneInstallHint()+
  (backupDue()?'<button class="backupwarn" data-act="backup-sheet">'+ico('lock','s')+'<span><b>Резервная копия просрочена</b><small>Рекомендуется сохранять копию не реже одного раза в '+(+S.settings.backupEveryDays||7)+' дней</small></span>'+ico('chev','s')+'</button>':'')+
  '<div class="sec"><h2>Инструменты</h2></div><div class="card pad0">'+
    row('search','Глобальный поиск','Дела, доверители, задачи, заметки и журнал','global-search')+
    row('tpl','Шаблоны чек-листов','Готовые планы по типовым поручениям','templates')+
    row('flag','Калькулятор сроков','Создание процессуального срока и подготовки','deadline')+
    row('gavel','Дни участия','Суд, следственные действия, выезды','participation-log')+
  '</div>'+
  '<div class="sec"><h2>Отчёты</h2></div><div class="card pad0">'+
    row('doc','Отчёты и печать','План дня и отчёт по выбранному делу','reports')+
    row('share','Экспорт списка','Отправить рабочий список в заметки или мессенджер','export')+
  '</div>'+
  '<div class="sec"><h2>Данные и безопасность</h2></div><div class="card pad0">'+
    row('doc','Зашифрованная резервная копия',S.settings.lastBackup?'Последняя: '+fmtD(S.settings.lastBackup.slice(0,10),true):'Копия ещё не создавалась','backup-sheet')+
    row('folder','Восстановить из копии','Загрузить зашифрованный файл','restore')+
    row('lock','Код доступа и шифрование',pinEnabled()?'PIN включён · база зашифрована ключом PIN':'База зашифрована локальным ключом устройства','pin')+
  '</div>'+
  '<div class="sec"><h2>Настройки</h2></div><div class="card pad0">'+
    row('user','Профиль и ставка',(S.settings.name||'Имя не указано')+' · '+(S.settings.dayRate?money(S.settings.dayRate)+'/день':'ставка не задана'),'profile')+
    rowSw('bell','Напоминания',S.settings.notify?'Включены':'Выключены','notify-sheet',S.settings.notify)+
    rowSw('sun','Оформление',S.settings.theme==='dark'?'Тёмное':'Светлое','theme',S.settings.theme==='light')+
    row('sun','Как пользоваться','Краткая инструкция по рабочему процессу','intro')+
  '</div>'+
  '<div class="sec"><h2>Обслуживание</h2></div><div class="card pad0">'+
    row('list','Загрузить примеры','Учебные дела и задачи','demo')+
    row('trash','Удалить выполненные','Очистить завершённые задачи','clearDone')+
    row('trash','Удалить все данные','Полностью очистить локальную базу','wipe')+
  '</div>'+
  '<div class="footnote">Ежедневник адвоката · iPhone Offline 3.0<br>'+esc(offlineStatusText())+'<br>Рабочая база хранится локально в зашифрованном виде.</div>';
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
  $('#sc-'+S.ui.tab).classList.add('fadein');
  setTimeout(function(){ var e=$('#sc-'+S.ui.tab); if(e) e.classList.remove('fadein'); },340);
  document.body.classList.toggle('light', S.settings.theme==='light');
}
function go(tab){ S.ui.tab = tab; S.ui.q=''; S.ui._sq=false; save(); render();
  var e = $('#sc-'+tab); if(e) e.scrollTop = 0; }

/* =====================================================================
   TASK EDITOR
   ===================================================================== */
var ED = null;
function editTask(t,preset){
  ED = t ? JSON.parse(JSON.stringify(t))
    : Object.assign({ id:null,title:'',mid:'',note:'',due:'',time:'',place:'',pri:'mid',kind:'task',sourceDate:'',rule:'',
        done:false,steps:[] }, preset||{});
  drawEditor();
}
function drawEditor(){
  var t = ED, isNew = !t.id;
  var opts = '<option value="">— без дела —</option>' + activeM().map(function(m){
    return '<option value="'+m.id+'"'+(t.mid===m.id?' selected':'')+'>'+esc(m.title)+'</option>'; }).join('');
  var kinds = Object.keys(KIND).map(function(k){
    return '<button class="chip'+(t.kind===k?' on':'')+'" data-act="e-kind" data-v="'+k+'">'+KIND[k].n+'</button>'; }).join('');
  var pris = Object.keys(PRI).map(function(k){
    return '<button class="chip'+(t.pri===k?' on':'')+'" data-act="e-pri" data-v="'+k+'">'+PRI[k].n+'</button>'; }).join('');
  var steps = (t.steps||[]).map(function(s,i){
    return '<div class="task" style="margin-bottom:6px;padding:9px 10px">'+
      '<button class="chk" data-act="e-step-t" data-v="'+i+'" style="'+(s.d?'background:var(--ok);border-color:var(--ok);color:#fff':'')+'">'+ico('check')+'</button>'+
      '<div class="tbody" style="font-size:14px;'+(s.d?'opacity:.5;text-decoration:line-through':'')+'">'+esc(s.t)+'</div>'+
      '<button data-act="e-step-d" data-v="'+i+'" style="color:var(--muted)">'+ico('trash','s')+'</button></div>'; }).join('');

  openSheet(
  '<div class="shhead"><h2>'+(isNew?'Новая запись':'Изменить')+'</h2>'+
    (isNew?'':'<button class="iconbtn" data-act="e-dup" title="Дублировать">'+ico('doc')+'</button>')+'</div>'+
  '<div class="fld"><label>Что нужно сделать</label>'+
    '<input id="e-title" placeholder="Подготовить апелляционную жалобу" value="'+esc(t.title)+'" autocomplete="off"></div>'+
  '<div class="fld"><label>Тип</label><div class="chips">'+kinds+'</div></div>'+
  '<div class="fld"><label>Дело / доверитель</label><select id="e-mid">'+opts+'</select></div>'+
  '<div class="two">'+
    '<div class="fld"><label>Дата</label><input id="e-due" type="date" value="'+esc(t.due)+'"></div>'+
    '<div class="fld"><label>Время</label><input id="e-time" type="time" value="'+esc(t.time)+'"></div>'+
  '</div>'+
  '<div class="chips" style="margin:-4px 0 14px">'+
    [['0','Сегодня'],['1','Завтра'],['3','+3 дня'],['7','Неделя'],['','Без даты']].map(function(x){
      return '<button class="chip" data-act="e-quick" data-v="'+x[0]+'">'+x[1]+'</button>'; }).join('')+'</div>'+
  '<div class="fld"><label>Приоритет</label><div class="chips">'+pris+'</div></div>'+
  (t.kind==='hearing'||t.kind==='meeting'
    ? '<div class="fld"><label>Место / суд</label><input id="e-place" placeholder="Арбитражный суд г. Москвы, зал 312" value="'+esc(t.place||'')+'"></div>' : '')+
  (t.kind==='deadline' ? '<div class="two"><div class="fld"><label>Дата события / отсчёта</label><input id="e-source" type="date" value="'+esc(t.sourceDate||'')+'"></div><div class="fld"><label>Основание / правило</label><input id="e-rule" value="'+esc(t.rule||'')+'" placeholder="ст. 321 ГПК РФ"></div></div>' : '')+
  '<div class="fld"><label>Этапы (чек-лист внутри задачи)</label>'+steps+
    '<div style="display:flex;gap:8px"><input id="e-step" placeholder="Добавить этап" autocomplete="off">'+
    '<button class="chip" data-act="e-step-a" style="padding:0 16px">'+ico('plus','s')+'</button></div></div>'+
  '<div class="fld"><label>Примечание</label>'+
    '<textarea id="e-note" rows="3" placeholder="Нормы права, документы, что взять с собой…">'+esc(t.note||'')+'</textarea></div>'+
  '<button class="btn" data-act="e-save">Сохранить</button>'+
  (isNew?'':((t.kind==='hearing'||t.kind==='deadline'||t.kind==='meeting')?'<button class="btn ghost" data-act="ics-task" data-id="'+t.id+'" style="margin-top:8px">Добавить в календарь iPhone</button>':'')+
   '<button class="btn danger" data-act="e-del">Удалить</button>'));
  if(isNew) setTimeout(function(){ var e=$('#e-title'); if(e) e.focus(); },340);
}
function pullEditor(){
  var g = function(id){ var e = $(id); return e ? e.value : undefined; };
  if(g('#e-title')!==undefined) ED.title = $('#e-title').value.trim();
  if(g('#e-mid')!==undefined) ED.mid = $('#e-mid').value;
  if(g('#e-due')!==undefined) ED.due = $('#e-due').value;
  if(g('#e-time')!==undefined) ED.time = $('#e-time').value;
  if(g('#e-place')!==undefined) ED.place = $('#e-place').value.trim();
  if(g('#e-source')!==undefined) ED.sourceDate = $('#e-source').value;
  if(g('#e-rule')!==undefined) ED.rule = $('#e-rule').value.trim();
  if(g('#e-note')!==undefined) ED.note = $('#e-note').value.trim();
}
function saveTask(){
  pullEditor();
  if(!ED.title){ toast('Введите текст задачи'); var e=$('#e-title'); if(e) e.focus(); return; }
  var isNew=!ED.id;
  if(ED.id){
    var t = S.tasks.filter(function(x){ return x.id===ED.id; })[0]; Object.assign(t, ED);
  } else {
    ED.id=uid();ED.created=new Date().toISOString();ED.done=false;S.tasks.unshift(ED);
  }
  if(ED.mid && (isNew || ED.kind==='hearing' || ED.kind==='deadline')){
    var label=ED.kind==='hearing'?'Назначено заседание: ':ED.kind==='deadline'?'Поставлен процессуальный срок: ':'Добавлена задача: ';
    addJournal(ED.mid,label+ED.title+(ED.due?' — '+fmtD(ED.due,true):''),today(),'task',true);
  }
  save();closeSheet();render();if($('#page').classList.contains('open')&&$('#page')._mid)openMatter($('#page')._mid);toast('Сохранено');schedule();
}

/* =====================================================================
   MATTER PAGE
   ===================================================================== */
var MED = null;
function openMatter(id){
  var m = matter(id); if(!m){ closeAll(); return; }
  var st = matterStats(m), c = mColor(m.id), mt=matterType(m);
  var ts = tasksOf(id).sort(sortT), open = ts.filter(function(t){ return !t.done; }), done=ts.filter(function(t){return t.done;});
  var parts = participationOf(id).slice().sort(function(a,b){ return a.date<b.date?1:-1; });
  var js = journalOf(id).slice().sort(function(a,b){ return (a.date||'')<(b.date||'')?1:-1; });
  var dossier = [
    ['user','Доверитель',m.client],['phone','Телефон',m.phone],['folder','Номер дела / материала',m.number],
    ['gavel','Суд / орган',m.court],['user','Судья / следователь',m.judge||m.investigator],
    ['lock','Статья / квалификация',m.article],['user','Процессуальный статус',m.role],['lock','Мера пресечения',m.restraint],
    ['user','Оппонент / другая сторона',m.opponent],['doc','Суть / рабочая заметка',m.notes]
  ].filter(function(x){return x[2];});

  openPage(
  '<div class="shhead"><button class="iconbtn" data-act="close">'+ico('left')+'</button><div style="flex:1"></div>'+
    '<button class="iconbtn" data-act="global-search">'+ico('search')+'</button><button class="iconbtn" data-act="m-print">'+ico('doc')+'</button><button class="iconbtn" data-act="m-edit">'+ico('edit')+'</button></div>'+
  '<div class="casehero"><div class="avatar big" style="background:'+c+'">'+initials(m.client||m.title)+'</div><div class="casehead"><div class="mtype" style="color:'+mt.c+'">'+mt.n+'</div><h2>'+esc(m.title)+'</h2><div class="sh-sub">'+esc(m.stage||'Без стадии')+(m.number?' · '+esc(m.number):'')+'</div></div></div>'+
  '<div class="kpis matterkpi">'+
    '<div class="kpi gold"><b>'+st.open+'</b><span>в работе</span></div><div class="kpi ok"><b>'+st.done+'</b><span>готово</span></div>'+
    '<div class="kpi blue"><b>'+st.days+'</b><span>дней участия</span></div><div class="kpi"><b>'+(st.sum?Math.round(st.sum/1000)+'к':'—')+'</b><span>участие</span></div></div>'+
  (dossier.length?'<div class="card pad0 dossier">'+dossier.map(function(r){
      if(r[1]==='Телефон') return '<a class="row" href="tel:'+esc(String(r[2]).replace(/[^0-9+]/g,''))+'" style="text-decoration:none;color:inherit">'+ico(r[0])+'<span class="rl">'+r[1]+'<small>'+esc(r[2])+'</small></span>'+ico('chev','s')+'</a>';
      return infoRow(r[0],r[1],r[2]); }).join('')+'</div>':'')+
  '<div class="chips scroll caseactions">'+
    '<button class="chip on" data-act="m-add" data-id="'+id+'">'+ico('plus','s')+' Задача</button>'+
    '<button class="chip" data-act="m-hearing" data-id="'+id+'">Заседание</button>'+
    '<button class="chip" data-act="m-deadline" data-id="'+id+'">Срок</button>'+
    '<button class="chip" data-act="m-part" data-id="'+id+'">+ День участия</button>'+
    '<button class="chip" data-act="m-journal" data-id="'+id+'">+ Запись</button>'+
    '<button class="chip" data-act="m-tpl" data-id="'+id+'">Шаблон</button></div>'+
  (open.length?'<div class="sec"><h2>Задачи по делу</h2><span class="link">'+open.length+'</span></div>'+open.map(function(t){return taskCard(t,{noMatter:true});}).join(''):
    '<div class="card">'+empty('check','Задач нет','Добавьте действие, заседание или процессуальный срок.',[{act:'m-add',t:'Добавить задачу',id:id},{act:'m-tpl',t:'Применить шаблон',ghost:1,id:id}])+'</div>')+
  '<div class="sec"><h2>Дни участия</h2><button class="link" data-act="m-part" data-id="'+id+'">Добавить</button></div>'+
  (parts.length?'<div class="card pad0">'+parts.slice(0,12).map(function(e){var rate=+e.rate||+m.dayRate||+S.settings.dayRate||0;return '<div class="row">'+ico('gavel')+'<span class="rl">'+esc(PART_KINDS[e.kind]||'Участие')+'<small>'+fmtD(e.date,true)+(e.place?' · '+esc(e.place):'')+(e.desc?' · '+esc(e.desc):'')+(rate?' · '+money(rate):'')+'</small></span><button data-act="part-del" data-id="'+e.id+'" style="color:var(--muted)">'+ico('trash','s')+'</button></div>';}).join('')+'</div>':
    '<div class="hint">Любое фактическое участие по делу учитывается как <b>1 день</b>, независимо от продолжительности.</div>')+
  '<div class="sec"><h2>Журнал дела</h2><button class="link" data-act="m-journal" data-id="'+id+'">Новая запись</button></div>'+
  (js.length?'<div class="timeline">'+js.slice(0,20).map(function(j){return '<div class="jitem"><i></i><div><b>'+fmtD(j.date||today(),true)+'</b><p>'+esc(j.text)+'</p></div><button data-act="journal-del" data-id="'+j.id+'">'+ico('trash','s')+'</button></div>';}).join('')+'</div>':
    '<div class="hint">Фиксируйте ход работы: документы получены, ходатайство подано, заседание перенесено, согласована позиция.</div>')+
  (done.length?'<div class="sec"><h2>Выполнено ('+done.length+')</h2></div>'+done.slice(0,8).map(function(t){return taskCard(t,{noMatter:true});}).join(''):'')+
  '<button class="btn ghost" data-act="m-arch" data-id="'+id+'" style="margin-top:18px">'+(m.archived?'Вернуть в работу':'Отправить в архив')+'</button>'+
  '<button class="btn danger" data-act="m-del" data-id="'+id+'">Удалить дело</button><div style="height:30px"></div>');
  $('#page')._mid=id;
}
function infoRow(i,l,v){ return '<div class="row">'+ico(i)+'<span class="rl">'+l+'<small>'+esc(v)+'</small></span></div>'; }

function editMatter(m){
  MED = m ? clone(m) : {id:null,title:'',type:'civil',client:'',phone:'',number:'',court:'',judge:'',investigator:'',article:'',role:'',restraint:'',opponent:'',stage:'Первая инстанция',dayRate:'',notes:'',archived:false};
  openSheet(
  '<h2>'+(m?'Изменить досье':'Новое дело')+'</h2><p class="sh-sub">Основная карточка доверителя и производства.</p>'+
  '<div class="fld"><label>Тип производства</label><select id="m-type">'+Object.keys(MATTER_TYPES).map(function(k){return '<option value="'+k+'"'+(MED.type===k?' selected':'')+'>'+MATTER_TYPES[k].n+'</option>';}).join('')+'</select></div>'+
  '<div class="fld"><label>Название дела *</label><input id="m-title" placeholder="Иванов И.И. — взыскание долга" value="'+esc(MED.title)+'"></div>'+
  '<div class="two"><div class="fld"><label>Доверитель</label><input id="m-client" value="'+esc(MED.client)+'" placeholder="ФИО / организация"></div><div class="fld"><label>Телефон</label><input id="m-phone" type="tel" value="'+esc(MED.phone)+'" placeholder="+7 900 000-00-00"></div></div>'+
  '<div class="two"><div class="fld"><label>Номер дела / материала</label><input id="m-number" value="'+esc(MED.number)+'"></div><div class="fld"><label>Стадия</label><select id="m-stage">'+STAGE.map(function(x){return '<option'+(MED.stage===x?' selected':'')+'>'+x+'</option>';}).join('')+'</select></div></div>'+
  '<div class="fld"><label>Суд / следственный орган / ведомство</label><input id="m-court" value="'+esc(MED.court||'')+'" placeholder="Кинешемский городской суд / СО ..."></div>'+
  '<div class="two"><div class="fld"><label>Судья</label><input id="m-judge" value="'+esc(MED.judge||'')+'"></div><div class="fld"><label>Следователь / дознаватель</label><input id="m-investigator" value="'+esc(MED.investigator||'')+'"></div></div>'+
  '<div class="two"><div class="fld"><label>Статья / квалификация</label><input id="m-article" value="'+esc(MED.article||'')+'" placeholder="ч. 2 ст. 228 УК РФ"></div><div class="fld"><label>Статус лица</label><input id="m-role" value="'+esc(MED.role||'')+'" placeholder="обвиняемый / истец / ответчик"></div></div>'+
  '<div class="two"><div class="fld"><label>Мера пресечения</label><input id="m-restraint" value="'+esc(MED.restraint||'')+'"></div><div class="fld"><label>Ставка за день участия, '+esc(S.settings.cur)+'</label><input id="m-dayrate" type="number" inputmode="numeric" value="'+esc(MED.dayRate||'')+'" placeholder="'+(S.settings.dayRate||'')+'"></div></div>'+
  '<div class="fld"><label>Оппонент / другая сторона</label><input id="m-opponent" value="'+esc(MED.opponent||'')+'"></div>'+
  '<div class="fld"><label>Суть дела / рабочая заметка</label><textarea id="m-notes" rows="4" placeholder="Ключевые обстоятельства, позиция, что важно не забыть…">'+esc(MED.notes||'')+'</textarea></div>'+
  '<button class="btn" data-act="m-save">Сохранить</button>');
  setTimeout(function(){ if(!m){ var e=$('#m-title'); if(e)e.focus(); } },340);
}
function saveMatter(){
  var v=function(id){var e=$(id);return e?e.value.trim():'';}, title=v('#m-title'); if(!title){toast('Введите название дела');return;}
  var o={title:title,type:v('#m-type')||'other',client:v('#m-client'),phone:v('#m-phone'),number:v('#m-number'),stage:v('#m-stage'),court:v('#m-court'),judge:v('#m-judge'),investigator:v('#m-investigator'),article:v('#m-article'),role:v('#m-role'),restraint:v('#m-restraint'),opponent:v('#m-opponent'),dayRate:+v('#m-dayrate')||0,notes:v('#m-notes')};
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
var DLS = [
 ['Апелляция на решение суда (ГПК)', 'm', 1, 'Месяц со дня изготовления мотивированного решения (ст. 321 ГПК РФ)'],
 ['Апелляция (АПК)', 'm', 1, 'Месяц со дня принятия решения (ст. 259 АПК РФ)'],
 ['Апелляция (КАС)', 'm', 1, 'Месяц со дня принятия решения (ст. 298 КАС РФ)'],
 ['Кассация (ГПК)', 'm', 3, 'Три месяца со дня вступления в законную силу (ст. 376.1 ГПК РФ)'],
 ['Кассация (АПК)', 'm', 2, 'Два месяца со дня вступления в законную силу (ст. 276 АПК РФ)'],
 ['Апелляция по уголовному делу', 'd', 15, '15 суток со дня постановления приговора (ст. 389.4 УПК РФ)'],
 ['Жалоба на постановление по делу об АП', 'd', 10, '10 суток со дня вручения копии постановления (ст. 30.3 КоАП РФ)'],
 ['Возражения на судебный приказ', 'd', 10, '10 дней со дня получения приказа (ст. 128 ГПК РФ)'],
 ['Претензионный порядок (АПК)', 'd', 30, '30 календарных дней с даты направления претензии (ч. 5 ст. 4 АПК РФ)'],
 ['Отзыв на иск / возражения', 'd', 14, 'Ориентировочный срок, уточняйте по определению суда']
];
function sheetDeadline(mid){
  openSheet('<h2>Калькулятор сроков</h2><p class="sh-sub">Выберите событие и дату — рассчитаю крайний день и поставлю задачу с запасом.</p>'+
  '<div class="fld"><label>Дата отсчёта (решение, вручение, направление)</label><input id="dl-date" type="date" value="'+today()+'"></div>'+
  '<div class="fld"><label>Событие</label><select id="dl-type">'+DLS.map(function(d,i){
    return '<option value="'+i+'">'+d[0]+'</option>'; }).join('')+'</select></div>'+
  '<div class="fld"><label>Дело</label><select id="dl-mid"><option value="">— без дела —</option>'+
    activeM().map(function(m){ return '<option value="'+m.id+'"'+(mid===m.id?' selected':'')+'>'+esc(m.title)+'</option>'; }).join('')+'</select></div>'+
  '<div class="hint" id="dl-out">Выберите параметры…</div>'+
  '<button class="btn" data-act="dl-add">Поставить задачу</button>'+
  '<div class="hint" style="margin-top:12px;font-size:12px">Расчёт справочный: не учитывает переносы с выходных и особенности исчисления. Всегда сверяйтесь с процессуальным кодексом и определением суда.</div>');
  calcDeadline();
}
function dlResult(){
  var d = $('#dl-date').value || today(), i = +$('#dl-type').value, t = DLS[i];
  var end = t[1]==='m' ? addM(d,t[2]) : addD(d,t[2]);
  return { end:end, t:t, from:d };
}
function calcDeadline(){
  var r = dlResult(), n = dd(r.end);
  $('#dl-out').innerHTML = '<b>Крайний срок: '+fmtD(r.end,true)+'</b> ('+cap(DOW[parseD(r.end).getDay()])+')<br>'+
    (n>=0?'Осталось '+n+' '+plural(n,'день','дня','дней'):'Срок истёк '+(-n)+' '+plural(-n,'день','дня','дней')+' назад')+
    '<br><span style="font-size:12px;color:var(--muted)">'+r.t[3]+'</span>';
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
  openSheet('<h2>Быстрая запись</h2><p class="sh-sub">Добавьте нужное действие без длинного маршрута по меню.</p><div class="quickgrid">'+
    quickItem('gavel','Заседание','qa-hearing')+quickItem('flag','Процессуальный срок','qa-deadline')+
    quickItem('check','Задача','qa-task')+quickItem('phone','Звонок','qa-call')+
    quickItem('folder','Новое дело','new-matter')+quickItem('doc','Запись в журнал','qa-journal')+
    quickItem('gavel','День участия','pt-new')+quickItem('tpl','Шаблон','templates')+
  '</div>');
}
function quickItem(i,t,act){return '<button class="quickitem" data-act="'+act+'">'+ico(i,'l')+'<b>'+t+'</b></button>';}

var GQ='';
function globalSearchData(q){
  q=(q||'').trim().toLowerCase(); if(!q)return {m:[],t:[],j:[]};
  function has(x){return String(x||'').toLowerCase().indexOf(q)>=0;}
  var ms=S.matters.filter(function(m){return [m.title,m.client,m.phone,m.number,m.court,m.judge,m.investigator,m.article,m.role,m.notes].some(has);}).slice(0,8);
  var ts=S.tasks.filter(function(t){var m=t.mid?matter(t.mid):null;return [t.title,t.note,t.place,t.rule,m&&m.title,m&&m.client,m&&m.number].some(has);}).sort(sortT).slice(0,12);
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
  var m=t.mid?matter(t.mid):null, title=t.title+(m?' — '+m.title:''), desc=[t.note,t.rule].filter(Boolean).join('\n');
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
function sheetBackup(){
  openSheet('<h2>Зашифрованная резервная копия</h2><p class="sh-sub">Файл содержит всю локальную базу. Для переноса на другой iPhone задайте отдельный пароль.</p>'+
    '<div class="fld"><label>Пароль копии (минимум 6 символов)</label><input id="bk-pass" type="password" autocomplete="new-password" placeholder="Не забудьте этот пароль"></div>'+
    '<div class="fld"><label>Повторите пароль</label><input id="bk-pass2" type="password" autocomplete="new-password"></div>'+
    '<div class="hint">Пароль не сохраняется в приложении. Без него восстановить эту копию невозможно.</div><button class="btn" data-act="backup-create">Создать зашифрованную копию</button>');
}
async function createBackupFile(){
  var a=$('#bk-pass').value,b=$('#bk-pass2').value;if(a.length<6){toast('Минимум 6 символов');return;}if(a!==b){toast('Пароли не совпадают');return;}
  try{
    var salt=randomB64(16),key=await deriveKey(a,salt),payload=await encryptObj(S,key);
    var wrap={app:'Ежедневник адвоката',version:3,encrypted:true,salt:salt,created:new Date().toISOString(),payload:payload};
    var txt=JSON.stringify(wrap); dl('advokat-backup-'+today()+'.advokat.json',txt,'application/json');
    S.settings.lastBackup=new Date().toISOString();save();closeSheet();render();toast('Зашифрованная копия создана');
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
    ['Тип',matterType(m).n],['Доверитель',m.client],['Номер дела / материала',m.number],['Суд / орган',m.court],['Судья',m.judge],['Следователь',m.investigator],['Статья / квалификация',m.article],['Статус',m.role],['Мера пресечения',m.restraint],['Оппонент',m.opponent],['Стадия',m.stage]
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
  openSheet('<h2>Ежедневник адвоката 3.0</h2><p class="sh-sub">Локальный рабочий кабинет для дел, заседаний, сроков и задач.</p>'+iphoneInstallHint()+
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
  await clearSecureStorage();S.settings.seen=false;S.ui.q='';S.ui.taskChip='';S.ui.showArch=false;S.ui.matterType='';save();closeAll();go('today');toast('Все данные удалены');setTimeout(showIntro,320);
}

function demo(){
  if(S.matters.length||S.tasks.length||S.participation.length||S.journal.length){if(!confirm('Примеры будут добавлены к текущей базе. Продолжить?'))return;}
  var m1={id:uid(),title:'Ошарин А.С. — освобождение по болезни',type:'criminal',client:'Ошарин Александр Сергеевич',number:'материал 4/17-2026',court:'Ивановский районный суд',article:'ст. 81 УК РФ',role:'осужденный',stage:'Первая инстанция',dayRate:10000,notes:'Оспаривается полнота медицинского освидетельствования. Контроль медицинских документов и процессуальных сроков.',archived:false,created:new Date().toISOString()};
  var m2={id:uid(),title:'Наследственный спор — признание свидетельств недействительными',type:'civil',client:'Иванова А.С.',number:'2-1438/2026',court:'Кинешемский городской суд',judge:'Судья Петрова Н.В.',stage:'Первая инстанция',dayRate:10000,notes:'Фактическое принятие наследства, спор о составе наследственной массы.',archived:false,created:new Date().toISOString()};
  var m3={id:uid(),title:'Песков — спор о квалификации',type:'criminal',client:'Песков Д.С.',number:'УД-88/2026',court:'Районный суд',article:'ч. 2 ст. 228 УК РФ / обвинение в покушении на сбыт',role:'подсудимый',stage:'Первая инстанция',dayRate:10000,archived:false,created:new Date().toISOString()};
  S.matters=[m1,m2,m3].concat(S.matters);
  var T=[
    [m1.id,'Подать апелляционную жалобу','deadline',4,'','high','','Срок обжалования постановления'],
    [m1.id,'Получить копию заключения медицинской комиссии','doc',0,'','high','',''],
    [m2.id,'Заседание по наследственному делу','hearing',1,'10:30','high','Кинешемский городской суд','Подготовить оригиналы документов'],
    [m2.id,'Подготовить вопросы свидетелям','task',0,'','mid','',''],
    [m3.id,'Подготовить Пескова к допросу','task',2,'','high','','Свободный рассказ + вопросы участников'],
    [m3.id,'Судебное заседание','hearing',5,'11:00','high','Районный суд',''],
    ['','Позвонить новому доверителю','call',0,'16:00','low','','']
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
document.addEventListener('click', function(ev){
  var el=ev.target.closest('[data-act]'); if(!el)return;
  var a=el.dataset.act,v=el.dataset.v,id=el.dataset.id; ev.stopPropagation();
  switch(a){
    /* navigation / dashboard */
    case 'go-matters': go('matters'); break;
    case 'go-tasks': go('tasks'); break;
    case 'go-more': go('more'); break;
    case 'close': closeAll(); break;
    case 'quick-add': sheetQuickAdd(); break;
    case 'global-search': sheetGlobalSearch(); break;
    case 'journal-open': closeSheet(); if(matter(id))openMatter(id); break;
    case 'reschedule': {var ov=overdue();if(!ov.length)break;if(confirm('Перенести '+ov.length+' просроченных задач на сегодня?')){ov.forEach(function(t){t.due=today();});save();render();toast('Перенесено: '+ov.length);}break;}
    case 'f-late': S.ui.tab='tasks';S.ui.taskSeg='open';S.ui.taskChip='late';save();render();break;
    case 'f-today': S.ui.tab='tasks';S.ui.taskSeg='open';S.ui.taskChip='today';save();render();break;
    case 'f-hear': S.ui.tab='tasks';S.ui.taskSeg='open';S.ui.taskChip='hearing';save();render();break;
    case 'f-deadline': S.ui.tab='tasks';S.ui.taskSeg='open';S.ui.taskChip='deadline';save();render();break;
    case 'seg': S.ui.taskSeg=v;save();renderTasks();break;
    case 'chip': S.ui.taskChip=v;save();renderTasks();break;
    case 'search': S.ui._sq=!S.ui._sq;if(!S.ui._sq)S.ui.q='';renderTasks();break;
    case 'arch': S.ui.showArch=!S.ui.showArch;save();renderMatters();break;
    case 'm-filter': S.ui.matterType=v||'';save();renderMatters();break;

    /* quick add */
    case 'qa-hearing': closeSheet();editTask(null,{kind:'hearing',pri:'high',due:today(),time:'10:00'});break;
    case 'qa-deadline': closeSheet();sheetDeadline('');break;
    case 'qa-task': closeSheet();editTask(null,{kind:'task',due:today()});break;
    case 'qa-call': closeSheet();editTask(null,{kind:'call',due:today()});break;
    case 'qa-journal': closeSheet();sheetJournal('');break;

    /* tasks */
    case 'toggle': {var t=S.tasks.filter(function(x){return x.id===id;})[0];if(!t)break;t.done=!t.done;t.doneAt=t.done?new Date().toISOString():null;if(t.mid)addJournal(t.mid,(t.done?'Выполнено: ':'Возвращено в работу: ')+t.title,today(),'task',true);vib(t.done?[10,40,14]:8);save();render();if($('#page').classList.contains('open'))openMatter($('#page')._mid);if(t.done)toast('Выполнено · '+t.title.slice(0,32));break;}
    case 'task': {var tk=S.tasks.filter(function(x){return x.id===id;})[0];if(tk)editTask(tk);break;}
    case 'ics-task': {var it=S.tasks.filter(function(x){return x.id===id;})[0];if(it)shareICS(it);break;}
    case 'e-kind': ED.kind=v;pullEditor();drawEditor();break;
    case 'e-pri': ED.pri=v;pullEditor();drawEditor();break;
    case 'e-quick': pullEditor();ED.due=v===''?'':addD(today(),+v);drawEditor();break;
    case 'e-step-a': {pullEditor();var i1=$('#e-step');if(i1&&i1.value.trim()){ED.steps=ED.steps||[];ED.steps.push({t:i1.value.trim(),d:false});drawEditor();setTimeout(function(){var se=$('#e-step');if(se)se.focus();},60);}break;}
    case 'e-step-t': pullEditor();ED.steps[+v].d=!ED.steps[+v].d;drawEditor();break;
    case 'e-step-d': pullEditor();ED.steps.splice(+v,1);drawEditor();break;
    case 'e-save': saveTask();break;
    case 'e-dup': {pullEditor();var cp=clone(ED);cp.id=null;cp.done=false;ED=cp;drawEditor();toast('Копия — измените и сохраните');break;}
    case 'e-del': if(confirm('Удалить задачу?')){S.tasks=S.tasks.filter(function(x){return x.id!==ED.id;});save();closeSheet();render();if($('#page').classList.contains('open'))openMatter($('#page')._mid);toast('Удалено');}break;

    /* matters */
    case 'new-matter': closeSheet();editMatter(null);break;
    case 'matter': if(matter(id)){closeSheet();openMatter(id);}break;
    case 'm-edit': {var me=matter($('#page')._mid);if(me)editMatter(me);break;}
    case 'm-save': saveMatter();break;
    case 'm-add': editTask(null,{mid:id,due:today()});break;
    case 'm-hearing': editTask(null,{mid:id,kind:'hearing',pri:'high',due:addD(today(),7),time:'10:00'});break;
    case 'm-deadline': sheetDeadline(id);break;
    case 'm-tpl': sheetTemplates(id);break;
    case 'm-part': sheetParticipation(id);break;
    case 'm-journal': sheetJournal(id);break;
    case 'm-print': if(matter($('#page')._mid))printMatter($('#page')._mid);break;
    case 'm-arch': {var mm=matter(id);if(!mm)break;mm.archived=!mm.archived;addJournal(id,mm.archived?'Дело отправлено в архив':'Дело возвращено в работу',today(),'system',true);save();closeAll();render();toast(mm.archived?'Дело в архиве':'Дело возвращено в работу');break;}
    case 'm-del': if(confirm('Удалить дело, связанные задачи, дни участия и журнал? Действие необратимо.')){S.tasks=S.tasks.filter(function(t){return t.mid!==id;});S.participation=S.participation.filter(function(e){return e.mid!==id;});S.journal=S.journal.filter(function(j){return j.mid!==id;});S.matters=S.matters.filter(function(m){return m.id!==id;});save();closeAll();render();toast('Дело удалено');}break;

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
    case 'dl-add': {var r=dlResult(),mid=$('#dl-mid').value;var prep=addD(r.end,-5);if(dd(prep)<0)prep=today();var main={id:uid(),mid:mid,title:r.t[0],kind:'deadline',due:r.end,time:'',pri:'high',note:r.t[3],sourceDate:r.from,rule:r.t[3],done:false,steps:[],created:new Date().toISOString()};S.tasks.unshift(main);S.tasks.unshift({id:uid(),mid:mid,title:'Подготовить документы: '+r.t[0],kind:'task',due:prep,time:'',pri:'high',note:'Крайний срок '+fmtD(r.end,true),done:false,steps:[],created:new Date().toISOString()});if(mid)addJournal(mid,'Поставлен процессуальный срок: '+r.t[0]+' — '+fmtD(r.end,true),today(),'deadline',true);save();closeSheet();render();toast('Срок и подготовка поставлены');break;}
    case 'reports': sheetReports();break;
    case 'notify-sheet': sheetNotify();break;
    case 'rep-back': if(REPORT&&REPORT.back&&matter(REPORT.back))openMatter(REPORT.back);else closeAll();break;
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
    case 'theme': S.settings.theme=S.settings.theme==='dark'?'light':'dark';save();render();document.querySelector('meta[name=theme-color]').content=S.settings.theme==='dark'?'#07111C':'#F4F6F9';break;
    case 'export': exportText();break;
    case 'backup-sheet': sheetBackup();break;
    case 'backup-create': createBackupFile();break;
    case 'restore': $('#file').click();break;
    case 'clearDone': {var n=S.tasks.filter(function(t){return t.done;}).length;if(!n){toast('Нет выполненных');break;}if(confirm('Удалить '+n+' выполненных задач?')){S.tasks=S.tasks.filter(function(t){return !t.done;});save();render();toast('Очищено');}break;}
    case 'demo': demo();closeSheet();break;
    case 'new-task': editTask(null,S.ui.tab==='cal'&&S.ui.calSel?{due:S.ui.calSel}:{due:today()});break;
    case 'intro': showIntro();break;
    case 'wipe': wipeAll();break;
    case 'skip': closeSheet();S.settings.seen=true;S.settings.dismissed=true;save();break;
  }
});
document.addEventListener('change',function(e){
  if(e.target.id==='dl-date'||e.target.id==='dl-type')calcDeadline();
  if(e.target.id&&e.target.id.indexOf('e-')===0)pullEditor();
});
document.addEventListener('input',function(e){
  if(e.target.id==='q'){S.ui.q=e.target.value;renderTaskList();}
  if(e.target.id==='gq'){GQ=e.target.value;renderGlobalSearch();}
  if(e.target.id==='dl-date'||e.target.id==='dl-type')calcDeadline();
});
document.addEventListener('keydown',function(e){
  if(e.key==='Enter'&&e.target.id==='e-step'){e.preventDefault();document.querySelector('[data-act="e-step-a"]').click();}
  if(e.key==='Enter'&&e.target.id==='e-title'){e.preventDefault();saveTask();}
});
document.querySelectorAll('.tab').forEach(function(b){b.onclick=function(){if(!unlocked)return;go(b.dataset.tab);vib(5);};});
$('#fab').onclick=function(){if(!unlocked)return;vib();sheetQuickAdd();};
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
   BOOT
   ===================================================================== */
var APP_STARTED=false,hiddenAt=0;
function afterUnlock(){
  if(!unlocked)return;
  render();schedule();
  if(!APP_STARTED){
    APP_STARTED=true;setInterval(schedule,15*60*1000);
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
  if(document.hidden){hiddenAt=Date.now();persistNow();return;}
  if(pinEnabled()&&S.settings.lockOnReturn&&hiddenAt&&Date.now()-hiddenAt>60000){
    S=clone(DEF);SESSION_KEY=null;unlocked=false;lockShow('Введите PIN после возврата в приложение');return;
  }
  if(unlocked){render();schedule();}
});
if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('./sw.js').then(function(reg){if(reg.waiting)reg.waiting.postMessage('SKIP_WAITING');}).catch(function(){});});}
if(navigator.storage&&navigator.storage.persist){navigator.storage.persist().catch(function(){});}
window.addEventListener('offline',function(){if(unlocked)toast('Офлайн-режим: ежедневник продолжает работать');});
window.addEventListener('online',function(){if(unlocked)toast('Подключение восстановлено');});
