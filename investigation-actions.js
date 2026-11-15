/* Stage 5: pretrial investigative events linked to a case, included in
   calendar and dossier. Only documented, occurred events are fee CANDIDATES;
   no automatic paid days are created. */
'use strict';
var STAGE_INV_TYPES=['Допрос','Очная ставка','Ознакомление с материалами','Предъявление обвинения','Следственный эксперимент','Проверка показаний на месте','Обыск','Выемка','Освидетельствование','Иное следственное действие'];
var STAGE_INV_SAVE_BUSY=false;
function stageInvestigationApplicable(m){return !!(m&&m.type==='criminal'&&['Материал проверки','Дознание','Следствие МВД','Следствие СК'].includes(m.stage));}
function stageInvestigationSheet(mid,taskId){
 var m=matter(mid),t=taskId?S.tasks.find(function(x){return x.id===taskId&&x.mid===mid&&x.kind==='investigation';}):null;
 if(!m||!stageInvestigationApplicable(m)){toast('Следственное действие доступно на досудебных стадиях уголовного дела');return;}
 if(m.archived){toast('Завершённая папка доступна только для просмотра');return;}
 var title=(t&&t.title)||'Допрос',status=t?(t.investigationStatus||'planned'):'planned';
 var type=STAGE_INV_TYPES.includes(title)?title:'Иное следственное действие';
 openSheet('<section class="stage-investigation-card">'+
  '<div class="stage-sheet-title"><button type="button" data-act="close" aria-label="Назад">'+ico('left')+'</button><div><small>СОБЫТИЯ ПО ДЕЛУ</small><h2>Следственное действие</h2></div></div>'+
  '<p class="stage-wizard-sub">Запись отображается в календаре и истории дела. Для оплаты по назначению состоявшееся действие потребуется подтвердить отдельно.</p>'+
  '<input id="inv-id" type="hidden" value="'+esc(t?t.id:'')+'"><input id="inv-mid" type="hidden" value="'+esc(mid)+'">'+
  '<label class="stage-wizard-field">Вид следственного действия<select id="inv-type">'+STAGE_INV_TYPES.map(function(v){return '<option value="'+esc(v)+'"'+(type===v?' selected':'')+'>'+esc(v)+'</option>';}).join('')+'</select></label>'+
  '<label class="stage-wizard-field">Уточнение, если нужно<input id="inv-other" maxlength="180" value="'+esc(type==='Иное следственное действие'&&t?title:'')+'" placeholder="Например, проверка показаний"></label>'+
  '<label class="stage-wizard-field">Дата<input id="inv-date" type="date" value="'+esc(t?t.due:today())+'"></label>'+
  '<label class="stage-wizard-field">Время (при наличии)<input id="inv-time" type="time" value="'+esc(t?t.time:'')+'"></label>'+
  '<label class="stage-wizard-field">Следственный орган / место<input id="inv-place" maxlength="220" value="'+esc(t?t.place:(m.court||''))+'" placeholder="СК, МВД, место проведения"></label>'+
  '<label class="stage-wizard-field">Результат<select id="inv-status">'+[['planned','Запланировано'],['held','Состоялось'],['cancelled','Отменено / не проводилось']].map(function(o){return '<option value="'+o[0]+'"'+(o[0]===status?' selected':'')+'>'+o[1]+'</option>';}).join('')+'</select></label>'+
  '<label class="stage-wizard-field">Примечание / документ<input id="inv-proof" maxlength="500" value="'+esc(t?t.note:'')+'" placeholder="Протокол, отметка, описание"></label>'+
  '<div class="stage-wizard-info">Отметка «Состоялось» сама по себе не является доказательством оплачиваемого дня. В расчёте этот день появится как предложение, не включённое без проверки.</div>'+
  '</section><button type="button" class="btn stage-wizard-primary" data-act="investigation-save">Сохранить следственное действие</button>');
 $('#sheet').classList.add('case-stage-sheet','stage-investigation-sheet');
}
async function stageInvestigationSave(){
 if(STAGE_INV_SAVE_BUSY)return;
 var val=function(id){return ((document.getElementById(id)||{}).value||'').trim();};
 var mid=val('inv-mid'),m=matter(mid),existing=val('inv-id'),date=val('inv-date'),time=val('inv-time'),type=val('inv-type'),status=val('inv-status');
 if(!m||m.archived||!stageInvestigationApplicable(m)){toast('Этап недоступен для изменения');return;}
 if(!stageISODateValid(date)){toast('Укажите корректную дату');return;}
 if(time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)){toast('Проверьте время');return;}
 if(!STAGE_INV_TYPES.includes(type)||!['planned','held','cancelled'].includes(status)){toast('Проверьте вид и результат');return;}
 var title=type==='Иное следственное действие'?(val('inv-other')||type):type;
 if(title.length>180){toast('Сократите название действия');return;}
 var target=existing?S.tasks.find(function(t){return t.id===existing&&t.mid===mid&&t.kind==='investigation';}):null;
 if(existing&&!target){toast('Запись не найдена');return;}
 STAGE_INV_SAVE_BUSY=true;var button=document.querySelector('[data-act="investigation-save"]'),before=null;
 if(button){button.disabled=true;button.textContent='Сохраняется…';}
 try{
  if(!(await flushSave()))throw new Error('Последние данные не сохранены');
  m=matter(mid);if(!m||m.archived||!stageInvestigationApplicable(m))throw new Error('Дело изменилось');
  target=existing?S.tasks.find(function(t){return t.id===existing&&t.mid===mid&&t.kind==='investigation';}):null;
  if(existing&&!target)throw new Error('Запись уже изменена');
  before=clone(S);
  var now=new Date().toISOString(),record={title:title,due:date,time:time,place:val('inv-place'),note:val('inv-proof'),
    kind:'investigation',mid:mid,pri:'mid',done:status==='held'||status==='cancelled',investigationStatus:status,updatedAt:now};
  if(target)Object.assign(target,record);
  else{record.id=uid();record.created=now;S.tasks.unshift(record);}
  addJournal(mid,(status==='held'?'Состоялось':status==='cancelled'?'Отменено':'Запланировано')+' следственное действие: '+title+' · '+fmtD(date,true),date,'task',true);
  if(!(await persistNow()))throw new Error('Не удалось сохранить запись');
  var parent=$('#page'),context=parent&&parent.classList.contains('open')&&parent._mid?{mid:parent._mid,tab:parent._matterTab||'events',scroll:parent.scrollTop}:null;
  closeSheet();renderPreservingCalendarPosition();
  if(context&&matter(context.mid)){openMatter(context.mid,context.tab);$('#page').scrollTop=context.scroll;}
  toast('Следственное действие сохранено');schedule();
 }catch(e){if(before){S=before;mem=clone(S);}toast(e.message||'Не удалось сохранить действие');if(button){button.disabled=false;button.textContent='Сохранить следственное действие';}}
 finally{STAGE_INV_SAVE_BUSY=false;}
}
