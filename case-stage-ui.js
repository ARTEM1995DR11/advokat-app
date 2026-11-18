/* Stage transition wizard. Views are isolated in one sheet; no changes to the
   established Today/Tasks/Calendar/Cases layouts or to the approved case folders. */
'use strict';
var STAGE_WIZARD=null;
var STAGE_WIZARD_STEPS=['Завершение этапа','Новая стадия','Перенос задач','Расчёт оплаты','Подтверждение'];
function stageNextSuggested(m){
  var arr=MATTER_STAGE_MAP[m.type]||MATTER_STAGE_MAP.other;
  var at=arr.indexOf(m.stage);return arr[Math.min(Math.max(at+1,0),arr.length-1)]||m.stage;
}
function stageTaskLabel(t){return ({hearing:'Судебное заседание',meeting:'Встреча',investigation:'Следственное действие',deadline:'Процессуальный срок',task:'Задача'})[t.kind]||'Запись';}
function stageWizardStart(id){
  var m=matter(id);
  if(!m||m.archived||m.stageClosed){toast('Продолжить можно только действующий этап');return;}
  var pending=stageEligibleTasks(m);
  STAGE_WIZARD={operationId:'stage-op-'+uid(),sourceId:String(m.id),step:0,closeDate:today(),startDate:today(),result:'',note:'',
    stage:stageNextSuggested(m),stageBase:stageNextSuggested(m),stageCustom:'',basis:m.basis,place:'',copyNotes:true,copyPosition:false,
    moveIds:pending.filter(function(t){return ['task','meeting'].includes(t.kind);}).map(function(t){return String(t.id);}),
    acknowledgeRemaining:false,acknowledgeCritical:false,confirm:false,
    payment:{category:'',lines:m.basis==='assigned'?appointmentFeeDays(m,today()).map(function(x){return {date:x.date,rate:0,included:x.source==='participation',alreadyClaimed:false,verified:false,proof:'',dayType:appointmentFeeSuggestedDayType(x.date)};}):[],note:''}};
  stageWizardRender();
}
function stageStepTitle(){return STAGE_WIZARD_STEPS[STAGE_WIZARD.step];}
function stageWizardCapture(){
  var d=STAGE_WIZARD;if(!d)return;
  var get=function(id){var x=document.getElementById(id);return x?x.value:null;};
  var check=function(id){var x=document.getElementById(id);return !!(x&&x.checked);};
  if(d.step===0){
    d.closeDate=get('st-close-date')||d.closeDate;
    d.result=(get('st-close-result')||'').trim();
    d.note=(get('st-close-note')||'').trim();
    if(d.startDate<d.closeDate)d.startDate=d.closeDate;
  }
  if(d.step===1){
    d.stage=get('st-new-stage')||d.stage;d.stageCustom=(get('st-new-custom')||'').trim();d.stageBase=get('st-new-base-stage')||d.stageBase;
    d.startDate=get('st-new-date')||d.startDate;d.place=(get('st-new-place')||'').trim();
    d.basis=get('st-new-basis')||d.basis;d.copyNotes=check('st-copy-notes');
    d.copyPosition=check('st-copy-position');
  }
  if(d.step===2){
    d.moveIds=[].slice.call(document.querySelectorAll('#sheet input[data-stage-move]'))
      .filter(function(x){return x.checked;}).map(function(x){return x.dataset.stageMove;});
    d.acknowledgeRemaining=check('st-ack-remaining');d.acknowledgeCritical=check('st-ack-critical');
  }
  if(d.step===3&&matter(d.sourceId).basis==='assigned'){
    d.payment.category=appointmentFeeCategory(get('st-payment-category'));
    d.payment.lines=[].slice.call(document.querySelectorAll('#sheet [data-fee-date]')).map(function(el){
      var date=el.dataset.feeDate,find=function(q){return el.querySelector(q);};
      return {date:date,rate:find('[data-fee-rate]').value,
       included:find('[data-fee-include]').checked,
       alreadyClaimed:find('[data-fee-claimed]').checked,
       verified:find('[data-fee-verified]').checked,
       dayType:find('[data-fee-type]').value,
       proof:find('[data-fee-proof]').value.trim()};
    });
    d.payment.note=get('st-payment-note')||'';
  }
  if(d.step===4)d.confirm=check('st-confirm');
}
function stageWizardValidateStep(){
  var d=STAGE_WIZARD,m=matter(d.sourceId),step=d.step;
  if(!m||m.archived||m.stageClosed)return 'Дело уже архивировано или не найдено';
  if(step===0){
    if(!stageISODateValid(d.closeDate)||d.closeDate>today())return 'Проверьте дату завершения';
    if(!d.result||!d.note)return 'Укажите результат и заключительную запись';
    if(!stageClosureOutcomeOptions(m).some(function(x){return x[0]===d.result;}))return 'Выберите фактический результат текущей стадии';
    if(stageUnresolvedHearings(m).length)return 'Сначала укажите результат всех прошедших заседаний';
  }
  if(step===1){
    if(!stageISODateValid(d.startDate)||d.startDate<d.closeDate)return 'Дата следующего этапа не может быть раньше завершения предыдущего';
    if(d.stage==='__other__'){if(d.stageCustom.length<3)return 'Укажите название другого этапа';if(!stageAllowedStage(m,d.stageBase))return 'Выберите процессуальный тип новой стадии';}
    else if(!stageAllowedStage(m,d.stage))return 'Выберите стадию из списка';
    if(!MATTER_BASIS[d.basis])return 'Укажите основание участия';
  }
  if(step===2){
    var all=stageEligibleTasks(m),picked=new Set(d.moveIds.map(String));
    if(all.some(function(t){return !picked.has(String(t.id));})&&!d.acknowledgeRemaining)return 'Подтвердите судьбу оставшихся незавершённых записей';
    if(all.some(function(t){return picked.has(String(t.id))&&['deadline','hearing','investigation'].includes(t.kind);})&&!d.acknowledgeCritical)
      return 'Отдельно подтвердите перенос сроков, заседаний и следственных действий';
    if(all.some(function(t){return picked.has(String(t.id))&&t.kind==='investigation';})&&
      !stageInvestigationApplicable({type:m.type,stage:d.stage==='__other__'?d.stageBase:d.stage}))
      return 'Следственное действие нельзя переносить в судебную стадию; оставьте его в истории';
  }
  if(step===3&&m.basis==='assigned'){
    for(var line of d.payment.lines){
      if(!stageISODateValid(line.date)||line.date>d.closeDate)return 'Проверьте дату дня участия';
      if(!Number.isFinite(+line.rate)||+line.rate<0||+line.rate>100000000)return 'Проверьте сумму за день';
      if(String(line.proof||'').length>500)return 'Сократите описание подтверждения';
    }
  }
  if(step===4&&!d.confirm)return 'Подтвердите завершение этапа и создание новой папки';
  return '';
}
function stageWizardNext(){
  if(!STAGE_WIZARD)return;
  stageWizardCapture();var err=stageWizardValidateStep();if(err){toast(err);return;}
  if(STAGE_WIZARD.step<4){var m=matter(STAGE_WIZARD.sourceId);STAGE_WIZARD.step+=(STAGE_WIZARD.step===2&&m.basis!=='assigned')?2:1;stageWizardRender();}
}
function stageWizardPrev(){
  if(!STAGE_WIZARD)return;
  if(STAGE_WIZARD.step===0){var id=STAGE_WIZARD.sourceId;STAGE_WIZARD=null;sheetMatterFinishChoice(id);return;}
  stageWizardCapture();var m=matter(STAGE_WIZARD.sourceId);STAGE_WIZARD.step-=(STAGE_WIZARD.step===4&&m.basis!=='assigned')?2:1;stageWizardRender();
}
function stageWizardHead(){
  var d=STAGE_WIZARD,m=matter(d.sourceId),assigned=m.basis==='assigned';
  var steps=assigned?STAGE_WIZARD_STEPS:STAGE_WIZARD_STEPS.filter(function(x){return x!=='Расчёт оплаты';});
  var at=assigned?d.step:(d.step===4?3:d.step);
  var first=d.step===0;
  var count=at+1,total=steps.length;
  // The approved gold badge belongs exclusively to the first, navy/ivory
  // folder. Later steps keep the legacy sheet until their design phase.
  var header=first
    ?'<header class="stage-wizard-header stage-wizard-header-premium">'+
      '<button class="stage-wizard-back" type="button" data-act="stage-wizard-prev" aria-label="Назад к выбору завершения">'+ico('left','s')+'</button>'+
      '<div class="stage-wizard-head-copy"><div class="stage-wizard-eyebrow"><small>ДЕЙСТВИЯ ПО ДЕЛУ</small><i aria-hidden="true"></i></div>'+
      '<h2>'+esc(stageStepTitle())+'</h2><p>'+esc(m.client||m.title||'Дело')+'</p></div>'+
      '<span class="stage-wizard-step-pill" aria-label="Шаг '+count+' из '+total+'">Шаг '+count+' из '+total+'</span></header>'
    :'<header class="stage-wizard-header"><button class="stage-wizard-back" type="button" data-act="stage-wizard-prev" aria-label="Предыдущий шаг">'+ico('left','s')+'</button><div><small>ДЕЙСТВИЯ ПО ДЕЛУ · ШАГ '+count+' / '+total+'</small><h2>'+esc(stageStepTitle())+'</h2><p>'+esc(m.client||m.title||'Дело')+'</p></div></header>';
  return header+'<div class="stage-wizard-progress" role="progressbar" aria-label="Этапы завершения дела" aria-valuemin="1" aria-valuemax="'+total+'" aria-valuenow="'+count+'" style="grid-template-columns:repeat('+total+',minmax(0,1fr))">'+
    steps.map(function(x,i){return '<i class="'+(i<=at?'passed':'')+'" aria-hidden="true"></i>';}).join('')+'</div>';
}
/* 5.0.1297.41.47 — refined step-3 information card and
   form fields. No changes to transition data or workflow validation. */
function stageWizardFirstIcon(kind){
  var paths={
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 10.7v5"/><circle cx="12" cy="7.5" r=".85" fill="currentColor" stroke="none"/>',
    calendar:'<rect x="3.5" y="5" width="17" height="16" rx="2.1"/><path d="M7.8 3v4.1M16.2 3v4.1M3.5 9.6h17M7.7 13.1h2.1M12.2 13.1h2.1M7.7 16.7h2.1M12.2 16.7h2.1"/>',
    result:'<circle cx="12" cy="12" r="9"/><path d="m7.2 12.1 3.25 3.15 6.45-6.5"/>',
    note:'<rect x="5" y="2.8" width="14" height="18.4" rx="1.65"/><path d="M8.3 7.5h7.4M8.3 11h7.4M8.3 14.5h5.2M8.3 18h3.4"/>',
    arrow:'<path d="m9 5 7 7-7 7"/>',
    warning:'<circle cx="12" cy="12" r="9"/><path d="M12 7.2v6.5"/><circle cx="12" cy="17.2" r=".8" fill="currentColor" stroke="none"/>'
  };
  return '<svg class="stage-first-glyph stage-first-glyph-'+kind+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+paths[kind]+'</svg>';
}
function stageWizardFirstFieldHeading(kind,title){
  return '<span class="stage-first-field-heading"><span class="stage-first-field-icon">'+stageWizardFirstIcon(kind)+'</span><span class="stage-first-field-caption">'+title+'</span></span>';
}
function stageWizardClosureHTML(d,m){
  var n=stageUnresolvedHearings(m).length;
  return '<div class="stage-first-notice" role="note"><span class="stage-first-notice-icon">'+stageWizardFirstIcon('info')+'</span>'+
    '<span class="stage-first-notice-rule" aria-hidden="true"></span>'+
    '<p class="stage-first-notice-text">Завершится только текущая стадия. <strong>В этом сценарии создание новой связанной папки обязательно.</strong> Если поручение заканчивается без продолжения, используйте «Завершить дело полностью».</p></div>'+
    '<label class="stage-wizard-field stage-first-field">'+stageWizardFirstFieldHeading('calendar','Дата завершения')+
      '<span class="stage-first-date-wrap"><input id="st-close-date" type="date" max="'+today()+'" value="'+esc(d.closeDate)+'">'+
      '<span class="stage-first-date-icon" aria-hidden="true">'+stageWizardFirstIcon('calendar')+'</span></span></label>'+
    '<label class="stage-wizard-field stage-first-field stage-first-outcome-field">'+stageWizardFirstFieldHeading('result','Фактический результат завершённого этапа')+
      '<span class="stage-first-result-wrap"><select id="st-close-result">'+stageClosureOutcomeOptions(m)
        .map(function(x){return '<option value="'+esc(x[0])+'"'+(x[0]===d.result?' selected':'')+'>'+esc(x[1])+'</option>';}).join('')+'</select>'+
      '<span class="stage-first-result-arrow">'+stageWizardFirstIcon('arrow')+'</span></span></label>'+
    '<label class="stage-wizard-field stage-first-field stage-first-note-field">'+stageWizardFirstFieldHeading('note','Заключительная запись')+
      '<textarea id="st-close-note" rows="3" placeholder="Что сделано, результат и дальнейшие действия">'+esc(d.note)+'</textarea></label>'+
    (n?'<div class="stage-wizard-alert stage-first-hearing-alert" role="alert">'+
       '<span class="stage-first-hearing-icon">'+stageWizardFirstIcon('warning')+'</span>'+
       '<span class="stage-first-hearing-rule" aria-hidden="true"></span>'+
       '<p>Не указаны результаты '+n+' прошедших заседаний. Перед переходом их необходимо завершить.</p></div>':'');
}
function stageWizardNextHTML(d,m){
  var stages=(MATTER_STAGE_MAP[m.type]||MATTER_STAGE_MAP.other);
  var isOther=d.stage==='__other__';
  return '<p class="stage-wizard-sub">Новая папка наследует сведения доверителя и ссылку на предыдущий этап, но получает собственные события и расчёт оплаты.</p>'+
    '<label class="stage-wizard-field">Стадия производства<select id="st-new-stage">'+stages.map(function(v){return '<option value="'+esc(v)+'"'+(d.stage===v?' selected':'')+'>'+esc(v)+'</option>';}).join('')+'<option value="__other__"'+(isOther?' selected':'')+'>Иной этап — собственное название</option></select></label>'+
    '<label class="stage-wizard-field" id="st-new-custom-wrap"'+(isOther?'':' style="display:none"')+'>Название иного этапа<input id="st-new-custom" maxlength="100" value="'+esc(d.stageCustom)+'" placeholder="Например, повторное рассмотрение"></label>'+ 
    '<label class="stage-wizard-field" id="st-new-base-wrap"'+(isOther?'':' style="display:none"')+'>Процессуальный тип для полей новой папки<select id="st-new-base-stage">'+stages.map(function(v){return '<option value="'+esc(v)+'"'+(d.stageBase===v?' selected':'')+'>'+esc(v)+'</option>';}).join('')+'</select></label>'+
    '<label class="stage-wizard-field">Дата начала новой стадии<input id="st-new-date" type="date" value="'+esc(d.startDate)+'"></label>'+
    '<label class="stage-wizard-field">Суд или орган новой стадии (при наличии)<input id="st-new-place" value="'+esc(d.place)+'" placeholder="Можно заполнить позднее"></label>'+
    '<label class="stage-wizard-field">Основание участия<select id="st-new-basis">'+Object.keys(MATTER_BASIS).map(function(k){return '<option value="'+k+'"'+(d.basis===k?' selected':'')+'>'+esc(MATTER_BASIS[k].n)+'</option>';}).join('')+'</select></label>'+
    '<label class="stage-wizard-check"><input type="checkbox" id="st-copy-notes"'+(d.copyNotes?' checked':'')+'><span>Перенести рабочие заметки и правовую позицию</span></label>'+
    '<label class="stage-wizard-check"><input type="checkbox" id="st-copy-position"'+(d.copyPosition?' checked':'')+'><span>Перенести проект позиции по делу (отдельная копия)</span></label>'+
    '<div class="stage-wizard-info">Номер дела, судья, следователь и прошедшие события <b>не дублируются</b>. При необходимости их заполните в новой карточке.</div>';
}
function stageWizardTasksHTML(d,m){
  var items=stageEligibleTasks(m),selected=new Set(d.moveIds.map(String));
  return '<p class="stage-wizard-sub">Отметьте записи, которые остаются в работе. Перенесённая запись появится в календаре только один раз — уже в новой папке.</p>'+
    (items.length?'<div class="stage-wizard-task-list">'+items.map(function(t){
       return '<label class="stage-wizard-task"><input type="checkbox" data-stage-move="'+esc(t.id)+'"'+(selected.has(String(t.id))?' checked':'')+'><span><b>'+esc(t.title||stageTaskLabel(t))+'</b><small>'+esc(stageTaskLabel(t))+(t.due?' · '+esc(fmtD(t.due,true)):'')+'</small></span>'+(['deadline','hearing','investigation'].includes(t.kind)?'<em>Проверить срок/заседание</em>':'')+'</label>';
    }).join('')+'</div>':'<div class="stage-wizard-info">Незавершённых записей нет. Можно сразу продолжить.</div>')+
    '<label class="stage-wizard-check"><input id="st-ack-remaining" type="checkbox"'+(d.acknowledgeRemaining?' checked':'')+'><span>Проверил(а): неперенесённые записи останутся в истории и не будут показываться в активных списках</span></label>'+
    '<label class="stage-wizard-check"><input id="st-ack-critical" type="checkbox"'+(d.acknowledgeCritical?' checked':'')+'><span>Отдельно проверил(а) юридическую актуальность выбранных сроков, заседаний и следственных действий</span></label>';
}
function appointmentFeeRowsHTML(lines,days){
 var byDate=Object.create(null);(lines||[]).forEach(function(x){byDate[x.date]=x;});
 return (days||[]).map(function(day){var x=byDate[day.date]||{date:day.date,included:true,dayType:appointmentFeeSuggestedDayType(day.date),rate:0};
   return '<section class="appointment-fee-day" data-fee-date="'+esc(day.date)+'">'+
    '<div class="appointment-fee-date"><b>'+esc(fmtD(day.date,true))+'</b><small>'+esc(day.desc||'День участия')+'</small>'+(day.source==='calendar'?'<em class="appointment-fee-hint">Только событие календаря — требуется подтверждение фактического участия</em>':'')+'</div>'+ 
    '<label class="stage-wizard-check"><input type="checkbox" data-fee-include '+(x.included!==false?'checked':'')+'><span>Включить день в расчёт</span></label>'+ 
    '<label class="stage-wizard-field">Условия дня<select data-fee-type>'+[['regular','Обычный день'],['night','Ночное время'],['nonworking','Выходной / нерабочий праздничный']].map(function(o){return '<option value="'+o[0]+'"'+(x.dayType===o[0]?' selected':'')+'>'+o[1]+'</option>';}).join('')+'</select></label>'+ 
    '<label class="stage-wizard-field">Ставка за день, ₽<input data-fee-rate inputmode="decimal" type="number" min="0" max="100000000" step="0.01" value="'+esc(x.rate||0)+'"></label>'+ 
    '<label class="stage-wizard-field">Подтверждающий документ / основание<input data-fee-proof maxlength="500" value="'+esc(x.proof||'')+'" placeholder="Протокол, отметка, заявление…"></label>'+ 
    '<label class="stage-wizard-check"><input data-fee-verified type="checkbox" '+(x.verified?'checked':'')+'><span>Проверил(а) документы и ставку</span></label>'+ 
    '<label class="stage-wizard-check"><input data-fee-claimed type="checkbox" '+(x.alreadyClaimed?'checked':'')+'><span>Этот день уже заявлен к оплате — исключить из итога</span></label>'+ 
    '</section>';
 }).join('');
}
function stageWizardPaymentHTML(d,m){
  if(m.basis!=='assigned')return '<div class="stage-wizard-info">Расчёт вознаграждения не производится для дел по соглашению.</div>';
  var days=appointmentFeeDays(m,d.closeDate),p=d.payment;
  return '<p class="stage-wizard-sub">Предварительный расчёт <b>только по назначению</b>. За одну дату по одному делу учитывается один день, независимо от числа действий. При отсутствии подтверждений итог остаётся черновиком.</p>'+ 
    (m.type==='criminal'?'<label class="stage-wizard-field">Категория сложности по п. 22(1) ПП РФ № 1240<select id="st-payment-category"><option value="">Выберите после проверки обстоятельств</option>'+Object.keys(APPOINTMENT_CRIMINAL_CATEGORIES).map(function(k){return '<option value="'+k+'"'+(p.category===k?' selected':'')+'>'+esc(APPOINTMENT_CRIMINAL_CATEGORIES[k])+'</option>';}).join('')+'</select></label>':'')+ 
    (m.type==='criminal'?'<button class="appointment-fee-apply" type="button" data-act="stage-payment-apply-rates">Подставить ставки ПП № 1191 (01.10.2025–31.12.2026)</button>':
      '<div class="stage-wizard-info">Для этого вида производства уголовные ставки автоматически не применяются: укажите проверенную ставку вручную.</div>')+
    (days.length?'<div class="appointment-fee-days">'+appointmentFeeRowsHTML(p.lines,days)+'</div>':
      '<div class="stage-wizard-alert">Дней фактического участия пока нет. Внесите их в журнал участия; переход возможен с пустым расчётом.</div>')+
    '<div class="stage-wizard-info">Для каждой даты действует <b>свой режим и своя ставка</b>: изменение режима одного дня не меняет остальные. Выходной по дню недели — только подсказка; праздничные и перенесённые дни проверяются вручную. Периоды до 01.10.2025 и после 2026 года требуют проверки ставки.</div>'+ 
    '<div class="appointment-fee-summary"><small>Предварительно, без уже заявленных дней</small><strong id="stage-wizard-pay-total">'+esc(money(appointmentFeeLineTotal(p.lines)))+'</strong></div>'+ 
    '<label class="stage-wizard-field">Примечание к расчёту<textarea id="st-payment-note" rows="2" placeholder="Решение о категории сложности, дополнительные документы">'+esc(p.note||'')+'</textarea></label>';
}
function stageWizardApplyRates(){
  var m=STAGE_WIZARD&&matter(STAGE_WIZARD.sourceId);if(!m||m.basis!=='assigned'||m.type!=='criminal')return;
  var cat=document.getElementById('st-payment-category');cat=cat&&cat.value;
  if(!appointmentFeeCategory(cat)){toast('Выберите категорию сложности после проверки');return;}
  var available=0,missing=0;
  document.querySelectorAll('#sheet [data-fee-date]').forEach(function(el){
    var date=el.dataset.feeDate,rate=appointmentFeeRate(m,date,cat,el.querySelector('[data-fee-type]').value);
    if(rate!=null){el.querySelector('[data-fee-rate]').value=rate;available++;}
    else {missing++;}
    el.querySelector('[data-fee-verified]').checked=false;
  });
  stageWizardUpdatePaymentTotal();
  toast(available?'Ставки предложены для '+available+' дн.; проверьте основания':'Нет подтверждённых тарифов для этих дат');
}
function stageWizardConfirmHTML(d,m){
  var items=stageEligibleTasks(m),picked=new Set(d.moveIds.map(String));
  var stageName=d.stage==='__other__'?d.stageCustom:d.stage;
  return '<div class="stage-wizard-summary">'+
    '<div><small>Завершаемая папка</small><b>'+esc(stageCaseHeading(m))+'</b><span>'+esc(fmtD(d.closeDate,true))+' · будет в архиве</span></div>'+
    '<div><small>Новая папка</small><b>'+esc(stageName)+'</b><span>'+esc(fmtD(d.startDate,true))+' · '+esc(matterBasisLabel(d.basis))+'</span></div>'+
    '<div><small>Перенос записей</small><b>'+picked.size+' из '+items.length+'</b><span>Выбранные записи останутся активны без дублирования</span></div>'+
    (m.basis==='assigned'?'<div><small>Расчёт оплаты · по назначению</small><b>'+esc(money(appointmentFeeLineTotal(d.payment.lines)))+'</b><span>'+d.payment.lines.filter(function(x){return x.included&&!x.alreadyClaimed;}).length+' дней к расчёту. Ставка и режим проверяются отдельно по каждой дате; результат — черновик.</span></div>':'')+
    '</div><label class="stage-wizard-check stage-wizard-confirm"><input type="checkbox" id="st-confirm"'+(d.confirm?' checked':'')+'><span>Проверил(а) сведения, выбранные задачи и расчёт. Подтверждаю завершение этапа и создание новой папки.</span></label>';
}
/* Step 1 only: the navy folder shell changes to ivory below its curved
   inner paper. SVG paths are shared with approved action screens, so the
   two-tone gradient is attached to this instance only, never globally. */
/* 41.43.7 — stage-one acceptance: an opaque, shape-matched ivory leaf.
   The old vertical two-tone SVG gradient caused pale bands at both side joins.
   Draw the navy silhouette first, then clip the ivory leaf inside the inner
   gold outline. No transparent transition passes through the side contours.
   This function is called ONLY for the first stage-wizard screen. */
function stageWizardFirstFolderPaint(panel){
  var svg=panel.querySelector(':scope > .matter-actions-outline');
  if(!svg)return;
  var ns='http://www.w3.org/2000/svg',defs=svg.querySelector('defs');
  var light=document.createElementNS(ns,'linearGradient');
  light.setAttribute('id','stageFirstIvory');
  light.setAttribute('x1','0');light.setAttribute('y1','0');
  light.setAttribute('x2','0');light.setAttribute('y2','1');
  [['0%','#fffefa'],['58%','#fffaf2'],['100%','#f9efe2']].forEach(function(item){
    var el=document.createElementNS(ns,'stop');
    el.setAttribute('offset',item[0]);el.setAttribute('stop-color',item[1]);
    light.appendChild(el);
  });
  defs.appendChild(light);
  var clip=document.createElementNS(ns,'clipPath');
  clip.setAttribute('id','stageFirstIvoryClip');
  clip.setAttribute('clipPathUnits','userSpaceOnUse');
  var clipPath=document.createElementNS(ns,'path');
  clip.appendChild(clipPath);defs.appendChild(clip);
  var ivory=document.createElementNS(ns,'path');
  ivory.classList.add('stage-first-ivory-fill');
  ivory.setAttribute('aria-hidden','true');
  ivory.setAttribute('clip-path','url(#stageFirstIvoryClip)');
  var foil=svg.querySelector('.ma6224-foil');
  svg.insertBefore(ivory,foil);
  // The ink line has no gradient, loose endpoints or partly transparent pixels.
  // It follows exactly the gap between the two existing gold contours.
  var rim=document.createElementNS(ns,'path');
  rim.classList.add('stage-first-lower-rim');
  rim.setAttribute('aria-hidden','true');rim.setAttribute('fill','none');
  var grip=svg.querySelector('.ma6224-grip');
  if(grip)svg.insertBefore(rim,grip);else svg.appendChild(rim);
  function repaint(){
    if(!panel.isConnected||!panel.classList.contains('stage-wizard-first-sheet')){
      if(panel._stageFirstPaintObserver){panel._stageFirstPaintObserver.disconnect();panel._stageFirstPaintObserver=null;}
      if(panel._stageFirstResizeFallback){window.removeEventListener('resize',panel._stageFirstResizeFallback);panel._stageFirstResizeFallback=null;}
      return;
    }
    var paper=panel.querySelector('.stage-wizard-first-paper');
    if(!paper)return;
    var rect=panel.getBoundingClientRect(),pr=paper.getBoundingClientRect();
    if(rect.height<100)return;
    var view=svg.viewBox.baseVal,w=view&&view.width||rect.width;
    var h=view&&view.height||rect.height;
    // Match the true top corners of the HTML paper. The ivory spreads to the
    // bottom gold rim below the corner, rather than fading across the rim.
    var top=pr.top-rect.top;
    var xL=Math.max(13,pr.left-rect.left+1);
    var xR=Math.min(w-13,pr.right-rect.left-1);
    var rad=Math.min(22,(xR-xL)/5);
    var innerEdge=11.35,rightEdge=w-innerEdge;
    var spread=top+60;
    ivory.setAttribute('d',
      'M '+(xL+rad)+' '+top+
      ' H '+(xR-rad)+' Q '+xR+' '+top+' '+xR+' '+(top+rad)+
      ' C '+xR+' '+(top+38)+' '+rightEdge+' '+(top+41)+' '+rightEdge+' '+spread+
      ' V '+h+' H '+innerEdge+' V '+spread+
      ' C '+innerEdge+' '+(top+41)+' '+xL+' '+(top+38)+' '+xL+' '+(top+rad)+
      ' Q '+xL+' '+top+' '+(xL+rad)+' '+top+' Z');
    var foilPath=svg.querySelector('.ma6224-foil');
    if(foilPath)clipPath.setAttribute('d',foilPath.getAttribute('d')||'');
    // A constant dark-navy accent, centred in the double-gold clearance.
    var edge=5.75,bottom=h-5.5,turn=bottom-27;
    var endLeft=31.8,endRight=w-endLeft,right=w-edge;
    rim.setAttribute('d','M '+edge+' 63 V '+turn+
      ' C '+edge+' '+(bottom-10)+' '+(edge+9)+' '+bottom+' '+endLeft+' '+bottom+
      ' H '+endRight+' C '+(right-9)+' '+bottom+' '+right+' '+(bottom-10)+' '+right+' '+turn+
      ' V 63');
  }
  if(panel._stageFirstPaintObserver){panel._stageFirstPaintObserver.disconnect();panel._stageFirstPaintObserver=null;}
  if(panel._stageFirstResizeFallback){window.removeEventListener('resize',panel._stageFirstResizeFallback);panel._stageFirstResizeFallback=null;}
  if(typeof ResizeObserver!=='undefined'){
    panel._stageFirstPaintObserver=new ResizeObserver(repaint);
    panel._stageFirstPaintObserver.observe(panel);
    var paper=panel.querySelector('.stage-wizard-first-paper');
    if(paper)panel._stageFirstPaintObserver.observe(paper);
  } else {
    // Older WebKit: repaint the ivory leaf together with the adaptive folder.
    panel._stageFirstResizeFallback=repaint;
    window.addEventListener('resize',repaint,{passive:true});
  }
  repaint();requestAnimationFrame(repaint);
}
function stageWizardRender(){
  var d=STAGE_WIZARD;if(!d)return;
  var m=matter(d.sourceId);if(!m||m.archived){toast('Дело уже закрыто');return;}
  var inner=[stageWizardClosureHTML,stageWizardNextHTML,stageWizardTasksHTML,stageWizardPaymentHTML,stageWizardConfirmHTML][d.step](d,m);
  // The approved step-one folder is a single surface: dark header, light form.
  // Later steps keep their existing sheet markup until their own design stages.
  var firstStep=d.step===0;
  var action='<button class="btn stage-wizard-primary" type="button" data-act="'+(d.step===4?'stage-wizard-commit':'stage-wizard-next')+'">'+(d.step===4?'Завершить этап и продолжить дело':'Продолжить')+'</button>';
  var html=firstStep
    ?'<section class="stage-wizard-card stage-wizard-first-card" aria-label="Завершение этапа — первый шаг">'+
      '<div class="stage-wizard-first-header">'+stageWizardHead()+'</div>'+
      '<div class="stage-wizard-first-paper"><div class="stage-wizard-body">'+inner+'</div>'+
      '<div class="stage-wizard-first-action">'+action+'</div></div></section>'
    :'<section class="stage-wizard-card">'+stageWizardHead()+'<div class="stage-wizard-body">'+inner+'</div></section>'+action;
  openSheet(html);
  var panel=$('#sheet');panel.classList.add('case-stage-sheet');
  if(firstStep){panel.classList.add('stage-wizard-first-sheet');mountMatterActionsOutline(panel);stageWizardFirstFolderPaint(panel);}
  if(d.step===3&&m.basis==='assigned')stageWizardUpdatePaymentTotal();
}
function stageWizardUpdatePaymentTotal(){
 var t=document.getElementById('stage-wizard-pay-total');if(!t)return;
 var lines=[].slice.call(document.querySelectorAll('#sheet [data-fee-date]')).map(function(el){return {
   included:el.querySelector('[data-fee-include]').checked,
   alreadyClaimed:el.querySelector('[data-fee-claimed]').checked,
   rate:el.querySelector('[data-fee-rate]').value};});
 t.textContent=money(appointmentFeeLineTotal(lines));
}
var STAGE_WIZARD_COMMIT_BUSY=false;
async function stageWizardCommit(){
  if(!STAGE_WIZARD||STAGE_WIZARD_COMMIT_BUSY)return;
  stageWizardCapture();var err=stageWizardValidateStep();if(err){toast(err);return;}
  var d=clone(STAGE_WIZARD),btn=document.querySelector('.stage-wizard-primary');
  STAGE_WIZARD_COMMIT_BUSY=true;
  if(btn){btn.disabled=true;btn.textContent='Сохраняется…';}
  try{
    var result=await stageCommitTransfer(d);
    STAGE_WIZARD=null;
    closeAll();S.ui.matterScope='active';S.ui.matterStatus='';
    go('matters');openMatter(result.newId,'general');
    toast('Новая стадия создана · перенесено записей: '+result.moved);
  }catch(e){toast(e&&e.message||'Не удалось сохранить переход');
    if(btn){btn.disabled=false;btn.textContent='Завершить этап и продолжить дело';}
  }finally{STAGE_WIZARD_COMMIT_BUSY=false;}
}
function stageHistoryButtonHTML(m){
  if(!m||!stageCaseHasLinks(m))return '';
  var related=stageRelatedCases(m),before=related.filter(function(x){return x.archived;}).length;
  return '<button type="button" class="stage-history-inline" data-act="stage-history" data-id="'+esc(m.id)+'"><span class="stage-history-inline-icon">'+ico('folder','s')+'</span><span><b>Этапы производства</b><small>'+related.length+' связанных папок · '+before+' завершено</small></span>'+ico('chev','s')+'</button>';
}
function stageHistorySheet(id){
  var m=matter(id);if(!m)return;
  var related=stageRelatedCases(m);
  openSheet('<section class="stage-history-sheet"><div class="stage-sheet-title"><button data-act="close" aria-label="Назад">'+ico('left')+'</button><div><small>ЕДИНОЕ ДЕЛО</small><h2>Этапы производства</h2></div></div><p class="stage-wizard-sub">Каждая папка имеет собственные задачи, журнал и расчёты; история всех стадий связана.</p>'+
    '<div class="stage-history-list">'+related.map(function(x,i){return '<button class="stage-history-row" data-act="stage-jump" data-id="'+esc(x.id)+'"><span class="stage-history-order">'+(i+1)+'</span><span><b>'+esc(stageCaseHeading(x))+'</b><small>'+esc(x.stageStartedAt?fmtD(x.stageStartedAt,true):'Начальная папка')+(x.stageClosed?' · до '+esc(fmtD(x.stageClosed.date,true)):'')+'</small></span><em>'+esc(x.archived?'Архив':'В работе')+'</em>'+ico('chev','s')+'</button>';}).join('')+'</div>'+ 
    (m.basis==='assigned'?'<button class="stage-history-payment-link" data-act="stage-payment-view" data-id="'+esc(id)+'">'+ico('doc','s')+' Расчёт оплаты этой стадии '+ico('chev','s')+'</button>':'')+'</section>');
  $('#sheet').classList.add('case-stage-sheet');
}
function stagePaymentSheet(id){
 var m=matter(id);if(!m||m.basis!=='assigned'){toast('Расчёт доступен только по делам по назначению');return;}
 var pays=stagePaymentDrafts(m);
 var html='<section class="stage-history-sheet"><div class="stage-sheet-title"><button data-act="stage-history" data-id="'+esc(m.id)+'" aria-label="К этапам">'+ico('left')+'</button><div><small>'+esc(stageCaseHeading(m))+'</small><h2>Оплата по назначению</h2></div></div>'+ 
 '<p class="stage-wizard-sub">Предварительный расчёт фактической занятости. Документы, ставку и отсутствие ранее заявленных дней проверяет адвокат.</p>'+
 (pays.length?pays.map(function(p){
  var lines=(p.lines||[]).slice().sort(function(a,b){return a.date.localeCompare(b.date);});
  var claimed=lines.filter(function(y){return y.alreadyClaimed;}).length;
  return '<div class="stage-payment-card"><div class="stage-payment-heading"><b>По назначению</b><span>Черновик · '+(p.needsReview?'есть непроверенные дни':'сведения проверены')+'</span></div>'+ 
   (p.category?'<p class="stage-wizard-sub">Категория: '+esc(p.category.toUpperCase())+' · п. 22(1) ПП № 1240</p>':'')+
   '<div class="stage-pay-lines">'+lines.map(function(line){return '<div><span>'+esc(fmtD(line.date,true))+' · '+esc(line.desc||PART_KINDS[line.kind]||'Участие')+(line.alreadyClaimed?' · уже заявлен':'')+(line.included===false?' · исключён':'')+'<br><small>'+esc(line.proof||'Подтверждение не указано')+'</small></span><b>'+esc(money(line.included!==false&&!line.alreadyClaimed?line.rate:0))+'</b></div>';}).join('')+'</div>'+ 
   '<div class="stage-payment-total">К заявлению: <strong>'+esc(money(p.total))+'</strong></div>'+ 
   (claimed?'<p class="stage-wizard-info">Исключено ранее заявленных дней: '+claimed+'</p>':'')+
   (p.needsReview?'<p class="stage-wizard-alert">В расчёте есть дни без подтверждения или проверенной ставки.</p>':'')+
   '<p class="stage-payment-disclaimer">'+esc(p.disclaimer||'Предварительный расчёт. Требует проверки.')+'</p>'+ 
   '<button class="stage-history-payment-link" data-act="stage-payment-edit" data-id="'+esc(p.id)+'">'+ico('edit','s')+' Проверить и изменить черновик</button>'+ 
   '<button class="stage-history-payment-link" data-act="stage-payment-print" data-id="'+esc(p.id)+'">'+ico('doc','s')+' Печать построчного расчёта</button>'+
   (m.type==='criminal'?'<button class="stage-history-payment-link" data-act="stage-payment-application" data-id="'+esc(p.id)+'">'+ico('doc','s')+' Проект заявления об оплате</button>':'')+'</div>';
 }).join(''):'<p class="stage-wizard-sub">По данной стадии расчёт ещё не создавался. Он формируется при завершении этапа.</p>')+'</section>';
 openSheet(html);$('#sheet').classList.add('case-stage-sheet');
}
function stagePaymentPrint(id){
 var p=(S.stagePayments||[]).find(function(x){return x.id===id&&x.mode==='assigned';});if(!p)return;
 var m=matter(p.mid);if(!m||m.basis!=='assigned')return;
 var rows=(p.lines||[]).slice().sort(function(a,b){return a.date.localeCompare(b.date);}).map(function(x){
  return '<tr><td>'+esc(fmtD(x.date,true))+'</td><td>'+esc(x.desc||PART_KINDS[x.kind]||'Участие')+'</td><td>'+esc(x.dayType==='night'?'Ночь':x.dayType==='nonworking'?'Выходной/праздник':'Обычно')+'</td><td>'+esc(x.proof||'Не указано')+'</td><td>'+esc(x.included===false?'Исключено':x.alreadyClaimed?'Ранее заявлено':'К расчёту')+'</td><td>'+esc(money(x.included!==false&&!x.alreadyClaimed?x.rate:0))+'</td></tr>';
 }).join('');
 printHTML('Предварительный расчёт оплаты по назначению',esc(m.client||'Дело')+' · '+esc(stageCaseHeading(m)),
 '<p><b>ЧЕРНОВИК. Не является постановлением об оплате и не подтверждает фактическую выплату.</b></p><p>Категория сложности: '+esc(p.category||'не указана')+'</p><table><thead><tr><th>Дата</th><th>Действие</th><th>Режим</th><th>Подтверждение</th><th>Статус</th><th>₽</th></tr></thead><tbody>'+rows+'</tbody></table><p><b>Итого: '+esc(money(p.total))+'</b></p><p>'+esc(p.note||'')+'</p>',
 'Проверьте применимую редакцию ПП РФ № 1240, категорию, подтверждённые дни, праздничные/выходные, северные коэффициенты и уже выплаченные суммы.');
}
function stagePaymentApplication(id){
 var p=(S.stagePayments||[]).find(function(x){return x&&x.id===id&&x.mode==='assigned';});if(!p)return;
 var m=matter(p.mid);if(!m||m.basis!=='assigned'||m.type!=='criminal')return;
 var name=(S.settings&&S.settings.name)||'[ФИО адвоката]';
 var recipient=m.court||'[наименование органа расследования / суда]';
 var claimable=(p.lines||[]).filter(function(x){return x.included!==false&&!x.alreadyClaimed;});
 var rows=claimable.map(function(x,i){return '<tr><td>'+(i+1)+'</td><td>'+esc(fmtD(x.date,true))+'</td><td>'+esc(x.desc||PART_KINDS[x.kind]||'Участие')+'</td><td>'+esc(x.proof||'подтверждение указать')+'</td><td>'+esc(money(x.rate))+'</td></tr>';}).join('');
 printHTML('Проект заявления о выплате вознаграждения адвокату по назначению',
   'Уголовное дело '+esc(m.number?'№ '+m.number:'№ [уточнить]')+' · '+esc(stageCaseHeading(m)),
   '<p style="text-align:right">В '+esc(recipient)+'<br>От адвоката '+esc(name)+'</p>'+ 
   '<h3 style="text-align:center">ЗАЯВЛЕНИЕ<br>о выплате вознаграждения адвокату</h3>'+ 
   '<p>В связи с участием в качестве защитника по назначению по уголовному делу '+esc(m.number?'№ '+m.number:'№ [указать]')+
   ' на основании ст. 131–132 УПК РФ и пунктов 22(1), 23, 25 Положения, утверждённого постановлением Правительства РФ № 1240, прошу рассмотреть вопрос об оплате фактически осуществлённой юридической помощи за следующие дни:</p>'+ 
   '<table><thead><tr><th>№</th><th>Дата</th><th>Действие</th><th>Подтверждение</th><th>₽</th></tr></thead><tbody>'+rows+'</tbody></table>'+ 
   '<p><b>Предварительно заявляемая сумма: '+esc(money(p.total))+'</b>.</p>'+ 
   '<p>Категория по п. 22(1): '+esc(p.category||'[указать после проверки]')+'. Данные о сложности дела, подтверждениях и специальных условиях: '+esc(p.note||'[уточнить]')+'.</p>'+ 
   '<p>Приложения: [копии документов, подтверждающих дни и объём участия; перечень указать].</p>'+ 
   '<p>Дата: _______________ &nbsp;&nbsp; Подпись: _______________</p>'+ 
   '<p><b>ВАЖНО: ЭТО ПРОЕКТ.</b> Перед подачей проверить адресата, категорию, ставки, уже заявленные/оплаченные даты, периоды и документальное подтверждение. Проект не означает вынесение постановления об оплате.</p>',
   'Заявление и приложения необходимо проверить и подписать перед подачей в уполномоченный орган.');
}
function stagePaymentEdit(id){
 var p=(S.stagePayments||[]).find(function(x){return x.id===id&&x.mode==='assigned';});if(!p)return;
 var m=matter(p.mid);if(!m||m.basis!=='assigned')return;
 var grouped=Object.create(null);
 (p.lines||[]).forEach(function(line){
  if(!stageISODateValid(line.date))return;
  var group=grouped[line.date];
  if(!group)group=grouped[line.date]={date:line.date,participationIds:[],kind:line.kind||'other',desc:line.desc||'',place:line.place||''};
  if(line.participationId)group.participationIds.push(line.participationId);
  if(Array.isArray(line.participationIds))group.participationIds.push.apply(group.participationIds,line.participationIds);
 });
 var days=Object.keys(grouped).sort().map(function(k){return grouped[k];});
 var html='<section class="stage-history-sheet"><div class="stage-sheet-title"><button data-act="stage-payment-view" data-id="'+esc(m.id)+'" aria-label="Назад к расчёту">'+ico('left')+'</button><div><small>'+esc(stageCaseHeading(m))+'</small><h2>Проверка дней оплаты</h2></div></div>'+ 
 '<p class="stage-wizard-sub">Отметьте только дни, подлежащие оплате. Ночное время и нерабочие дни проверьте отдельно. Нормативные ставки предлагаются только для уголовных дел за период 01.10.2025–31.12.2026.</p>'+ 
 (m.type==='criminal'?'<label class="stage-wizard-field">Категория сложности<select id="st-payment-category"><option value="">Не установлена</option>'+Object.keys(APPOINTMENT_CRIMINAL_CATEGORIES).map(function(k){return '<option value="'+k+'"'+(p.category===k?' selected':'')+'>'+esc(APPOINTMENT_CRIMINAL_CATEGORIES[k])+'</option>';}).join('')+'</select></label>':'')+ 
 (m.type==='criminal'?'<button class="appointment-fee-apply" type="button" data-act="stage-payment-editor-apply" data-id="'+esc(p.id)+'">Подставить ставки для выбранной категории</button>':'<div class="stage-wizard-info">Для неуголовных дел ставка вводится вручную по применимым правилам.</div>')+
 '<div class="appointment-fee-days">'+appointmentFeeRowsHTML(p.lines,days)+'</div>'+ 
 '<div class="appointment-fee-summary"><small>К расчёту, исключая уже заявленные дни</small><strong id="stage-wizard-pay-total">'+esc(money(appointmentFeeLineTotal(p.lines)))+'</strong></div>'+ 
 '<div class="stage-wizard-info">Дополнительный фактический день, отсутствующий в журнале участия, можно указать только как <b>неподтверждённую</b> строку черновика.</div>'+ 
 '<label class="stage-wizard-field">Дополнительная дата<input type="date" id="st-edit-extra-date" max="'+esc(p.periodEnd)+'"></label>'+ 
 '<label class="stage-wizard-field">Описание действия<input type="text" id="st-edit-extra-desc" maxlength="250" placeholder="Фактически выполненное действие"></label>'+ 
 '<label class="stage-wizard-field">Ставка дополнительного дня, ₽<input type="number" id="st-edit-extra-rate" min="0" max="100000000" step="0.01" inputmode="decimal" placeholder="Сумма"></label>'+ 
 '<label class="stage-wizard-field">Примечание к расчёту<input type="text" maxlength="1500" id="st-edit-note" value="'+esc(p.note||'')+'"></label>'+ 
 '<div class="stage-wizard-alert">Сохранение черновика не означает утверждение или выплату вознаграждения.</div></section>'+ 
 '<button class="btn stage-wizard-primary" type="button" data-act="stage-payment-save" data-id="'+esc(p.id)+'">Сохранить расчёт по назначению</button>';
 openSheet(html);$('#sheet').classList.add('case-stage-sheet');
}
function stagePaymentEditorApplyRates(id){
 var p=(S.stagePayments||[]).find(function(x){return x.id===id&&x.mode==='assigned';});if(!p)return;
 var m=matter(p.mid);if(!m||m.type!=='criminal'||m.basis!=='assigned')return;
 var category=document.getElementById('st-payment-category');category=category&&category.value;
 if(!appointmentFeeCategory(category)){toast('Сначала выберите категорию сложности');return;}
 var applied=0;
 document.querySelectorAll('#sheet [data-fee-date]').forEach(function(el){
  var rate=appointmentFeeRate(m,el.dataset.feeDate,category,el.querySelector('[data-fee-type]').value);
  if(rate!=null){el.querySelector('[data-fee-rate]').value=rate;el.querySelector('[data-fee-verified]').checked=false;applied++;}
 });
 stageWizardUpdatePaymentTotal();toast('Предложены ставки для '+applied+' дней; подтвердите их');
}
var STAGE_PAYMENT_SAVE_BUSY=false;
async function stagePaymentEditSave(id){
 if(STAGE_PAYMENT_SAVE_BUSY)return;
 var previous=(S.stagePayments||[]).find(function(x){return x.id===id&&x.mode==='assigned';});if(!previous)return;
 var m=matter(previous.mid);if(!m||m.basis!=='assigned')return;
 var note=document.getElementById('st-edit-note');note=note?note.value.trim():'';
 var category=document.getElementById('st-payment-category');category=appointmentFeeCategory(category&&category.value);
 var inputs=[].slice.call(document.querySelectorAll('#sheet [data-fee-date]'));
 var lines=inputs.map(function(el){
  var date=el.dataset.feeDate,find=function(sel){return el.querySelector(sel);},old=(previous.lines||[]).find(function(x){return x.date===date;})||{};
  return Object.assign({},old,{date:date,rate:Number(find('[data-fee-rate]').value),
     included:find('[data-fee-include]').checked,alreadyClaimed:find('[data-fee-claimed]').checked,
     verified:find('[data-fee-verified]').checked,dayType:find('[data-fee-type]').value,
     proof:find('[data-fee-proof]').value.trim(),requiresRateCheck:false});
 });
 if(lines.some(function(x){return !stageISODateValid(x.date)||x.date>previous.periodEnd||!Number.isFinite(x.rate)||x.rate<0||x.rate>100000000||x.proof.length>500})){toast('Проверьте ставки, даты и документы');return;}
 var extraDate=(document.getElementById('st-edit-extra-date')||{}).value||'',extraDesc=((document.getElementById('st-edit-extra-desc')||{}).value||'').trim(),extraRate=((document.getElementById('st-edit-extra-rate')||{}).value||'');
 if(extraDate||extraDesc||extraRate){
  if(!stageISODateValid(extraDate)||extraDate>previous.periodEnd||!extraDesc||extraRate===''||!Number.isFinite(+extraRate)||+extraRate<0||+extraRate>100000000){toast('Проверьте дополнительный день и ставку');return;}
  if(lines.some(function(x){return x.date===extraDate;})){toast('Этот день уже учтён');return;}
  lines.push({date:extraDate,kind:'other',desc:extraDesc,manual:true,participationIds:[],
    included:true,alreadyClaimed:false,dayType:appointmentFeeSuggestedDayType(extraDate),rate:appointmentFeeMoney(extraRate),proof:'',verified:false,requiresRateCheck:true});
 }
 lines.forEach(function(x){x.rate=appointmentFeeMoney(x.rate);x.requiresRateCheck=x.included!==false&&!x.alreadyClaimed&&(!x.rate||!x.proof||!x.verified);});
 lines.sort(function(a,b){return a.date.localeCompare(b.date);});
 STAGE_PAYMENT_SAVE_BUSY=true;var before=null,button=document.querySelector('[data-act="stage-payment-save"]');
 if(button){button.disabled=true;button.textContent='Сохранение…';}
 try{
  if(!(await flushSave()))throw new Error('Не удалось записать ожидающие данные');
  before=clone(S);var p=(S.stagePayments||[]).find(function(x){return x.id===id&&x.mode==='assigned';});
  if(!p)throw new Error('Черновик не найден');
  p.lines=lines;p.category=category;p.total=appointmentFeeLineTotal(lines);p.needsReview=appointmentFeeNeedsReview(lines);p.note=note;
  p.modifiedAt=new Date().toISOString();p.revisions=(+p.revisions||0)+1;
  addJournal(p.mid,'Уточнён черновик оплаты по назначению: '+money(p.total)+'. Проверка документов обязательна.',today(),'system',true);
  if(!(await persistNow()))throw new Error('Не удалось сохранить расчёт');
  closeSheet();stagePaymentSheet(p.mid);toast('Черновик оплаты сохранён');
 }catch(e){if(before){S=before;mem=clone(S);}toast(e.message||'Ошибка сохранения');if(button){button.disabled=false;button.textContent='Сохранить расчёт по назначению';}}
 finally{STAGE_PAYMENT_SAVE_BUSY=false;}
}
function stageWizardToggleCustom(){
  var select=document.getElementById('st-new-stage');if(!select)return;
  var active=select.value==='__other__';
  ['st-new-custom-wrap','st-new-base-wrap'].forEach(function(id){var el=document.getElementById(id);if(el)el.style.display=active?'block':'none';});
}
document.addEventListener('change',function(e){if(e.target&&e.target.id==='st-new-stage')stageWizardToggleCustom();});
document.addEventListener('input',function(e){if(e.target&&e.target.id==='st-new-stage')stageWizardToggleCustom();});

document.addEventListener('input',function(e){if(e.target&&e.target.closest&&e.target.closest('[data-fee-date]'))stageWizardUpdatePaymentTotal();});
document.addEventListener('change',function(e){
  if(!e.target||!e.target.closest)return;
  var day=e.target.closest('[data-fee-date]');if(!day)return;
  if(e.target.matches('[data-fee-type]')){
    var category=document.getElementById('st-payment-category'),m=null;
    if(STAGE_WIZARD&&document.getElementById('st-payment-note'))m=matter(STAGE_WIZARD.sourceId);
    if(!m){var saved=document.querySelector('[data-act="stage-payment-save"]');
      if(saved){var pd=(S.stagePayments||[]).find(function(x){return x.id===saved.dataset.id;});m=pd&&matter(pd.mid);}}
    if(m&&m.type==='criminal'&&category&&appointmentFeeCategory(category.value)){
      var suggested=appointmentFeeRate(m,day.dataset.feeDate,category.value,e.target.value);
      if(suggested!==null){day.querySelector('[data-fee-rate]').value=suggested;
        day.querySelector('[data-fee-verified]').checked=false;}
    }
  }
  stageWizardUpdatePaymentTotal();
});
