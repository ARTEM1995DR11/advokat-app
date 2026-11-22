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
  STAGE_HEARING_NAV=null;
  var m=matter(id);
  if(!m||m.archived||m.stageClosed){toast('Продолжить можно только действующий этап');return;}
  if(!MATTER_BASIS[m.basis]){toast('Сначала укажите основание ведения в разделе «Редактировать дело»');return;}
  var pending=stageEligibleTasks(m);
  STAGE_WIZARD={operationId:'stage-op-'+uid(),sourceId:String(m.id),step:0,closeDate:today(),startDate:today(),result:'',note:'',
    stage:'',stageBase:'',stageCustom:'',stageReason:'',routeVerified:false,basis:m.basis,sourceBasisAtStart:m.basis,place:'',
    moveIds:pending.filter(function(t){return ['task','meeting'].includes(t.kind);}).map(function(t){return String(t.id);}),
    acknowledgeRemaining:false,acknowledgeCritical:false,confirm:false,
    payment:{category:'',lines:m.basis==='assigned'?appointmentFeeDays(m,today()).map(function(x){return {date:x.date,rate:0,included:x.source==='participation',alreadyClaimed:false,verified:false,proof:'',dayType:appointmentFeeSuggestedDayType(x.date)};}):[],note:''}};
  stageWizardRender();
}
/* Only meaningful steps are displayed. No empty transfer page for a case
   with no pending work; payment is reserved for appointed representation. */
function stageWizardVisibleSteps(m){
  var v=[0,1];
  if(stageEligibleTasks(m).length)v.push(2);
  if(m&&m.basis==='assigned')v.push(3);
  v.push(4);
  return v;
}
function stageWizardStepPosition(d,m){
  var visible=stageWizardVisibleSteps(m);
  var index=visible.indexOf(d.step);
  return {visible:visible,index:index<0?0:index,count:visible.length};
}
function stageStepTitle(){return STAGE_WIZARD_STEPS[STAGE_WIZARD.step];}
function stageWizardCapture(){
  var d=STAGE_WIZARD;if(!d)return;
  // The basis belongs to the case, not to this wizard's form.
  var source=matter(d.sourceId);if(source)d.basis=source.basis;
  var get=function(id){var x=document.getElementById(id);return x?x.value:null;};
  var check=function(id){var x=document.getElementById(id);return !!(x&&x.checked);};
  if(d.step===0){
    d.closeDate=get('st-close-date')||d.closeDate;
    d.result=(get('st-close-result')||'').trim();
    d.note=(get('st-close-note')||'').trim();
    if(d.startDate<d.closeDate)d.startDate=d.closeDate;
  }
  if(d.step===1){
    d.stage=get('st-new-stage')||'';d.stageCustom=(get('st-new-custom')||'').trim();d.stageBase=get('st-new-base-stage')||d.stageBase;
    d.stageReason=(get('st-new-reason')||'').trim();d.routeVerified=check('st-next-review');
    d.startDate=get('st-new-date')||d.startDate;d.place=(get('st-new-place')||'').trim();
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
  if(!MATTER_BASIS[m.basis])return 'Укажите основание ведения через «Редактировать дело»';
  if(d.sourceBasisAtStart&&m.basis!==d.sourceBasisAtStart)return 'Основание ведения изменилось. Откройте завершение этапа заново';
  if(step===0){
    if(!stageISODateValid(d.closeDate)||d.closeDate>today())return 'Проверьте дату завершения';
    if(!d.result)return 'Укажите фактический результат завершённой стадии';
    if(d.result==='Иной результат'&&!d.note)return 'Для иного результата уточните итог в заключительной записи';
    if(!stageClosureOutcomeOptions(m).some(function(x){return x[0]===d.result;}))return 'Выберите фактический результат текущей стадии';
    if(stageUnresolvedHearings(m).length)return 'Сначала укажите результат всех прошедших заседаний';
  }
  if(step===1){
    if(!stageISODateValid(d.startDate)||d.startDate<d.closeDate)return 'Дата следующего этапа не может быть раньше завершения предыдущего';
    if(d.stage==='__other__'){if(d.stageCustom.length<3)return 'Укажите название другого этапа';if(!stageAllowedTransition(m,d.result,d.stageBase))return 'Этот процессуальный тип не соответствует результату предыдущего этапа';if(d.stageReason.length<10)return 'Укажите основание индивидуального маршрута (не менее 10 символов)';if(!stageCustomLabelValid(m,d.stageCustom,d.stageBase))return 'Название этапа противоречит выбранной стадии';}
    else if(!stageAllowedTransition(m,d.result,d.stage))return 'Выберите стадию из допустимых вариантов';
    if(stageTransitionReview(m,d.result,stageTransitionActualStage(d))&&!d.routeVerified)return 'Подтвердите проверку условий выбранного перехода';
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
  stageWizardCapture();
  var d=STAGE_WIZARD,m=matter(d.sourceId);
  /* An unfinished task can be completed elsewhere while the wizard is open.
     Never strand the user on an empty, now-hidden transfer screen. */
  if(d.step===2&&m&&!stageEligibleTasks(m).length){
    d.moveIds=[];d.acknowledgeRemaining=false;d.acknowledgeCritical=false;
    d.step=m.basis==='assigned'?3:4;stageWizardRender();return;
  }
  var err=stageWizardValidateStep();if(err){toast(err);return;}
  var visible=stageWizardVisibleSteps(m),at=visible.indexOf(d.step);
  if(d.step===1){
    var currentIds=new Set(stageEligibleTasks(m).map(function(t){return String(t.id);}));
    d.moveIds=d.moveIds.filter(function(id){return currentIds.has(String(id));});
    if(!currentIds.size){d.moveIds=[];d.acknowledgeRemaining=false;d.acknowledgeCritical=false;}
  }
  if(at>=0&&at<visible.length-1){d.step=visible[at+1];stageWizardRender();}
}
function stageWizardPrev(){
  if(!STAGE_WIZARD)return;
  if(STAGE_WIZARD.step===0){var id=STAGE_WIZARD.sourceId;STAGE_WIZARD=null;STAGE_HEARING_NAV=null;sheetMatterFinishChoice(id);return;}
  stageWizardCapture();var d=STAGE_WIZARD,m=matter(d.sourceId),visible=stageWizardVisibleSteps(m),at=visible.indexOf(d.step);
  if(at<0&&d.step===2){d.moveIds=[];d.step=1;stageWizardRender();return;}
  if(at>0){d.step=visible[at-1];stageWizardRender();}
}
function stageWizardHead(){
  var d=STAGE_WIZARD,m=matter(d.sourceId),progress=stageWizardStepPosition(d,m);
  var at=progress.index,count=at+1,total=progress.count;
  var first=d.step<=4; // All visible steps use the approved navy/ivory folder.
  var steps=progress.visible.map(function(step){return STAGE_WIZARD_STEPS[step];});
  var header=first
    ?'<header class="stage-wizard-header stage-wizard-header-premium">'+
      '<button class="stage-wizard-back" type="button" data-act="stage-wizard-prev" aria-label="К предыдущему шагу">'+ico('left','s')+'</button>'+
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
  var artwork={calendar:'calendar',result:'check',note:'doc',stage:'flag',court:'court',basis:'brief'};
  if(artwork[kind]&&typeof advEmbossIcon==='function')return advEmbossIcon(artwork[kind]);
  var paths={
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 10.7v5"/><circle cx="12" cy="7.5" r=".85" fill="currentColor" stroke="none"/>',
    calendar:'<rect x="3.5" y="5" width="17" height="16" rx="2.1"/><path d="M7.8 3v4.1M16.2 3v4.1M3.5 9.6h17M7.7 13.1h2.1M12.2 13.1h2.1M7.7 16.7h2.1M12.2 16.7h2.1"/>',
    result:'<circle cx="12" cy="12" r="9"/><path d="m7.2 12.1 3.25 3.15 6.45-6.5"/>',
    note:'<rect x="5" y="2.8" width="14" height="18.4" rx="1.65"/><path d="M8.3 7.5h7.4M8.3 11h7.4M8.3 14.5h5.2M8.3 18h3.4"/>',
    arrow:'<path d="m9 5 7 7-7 7"/>',
    warning:'<circle cx="12" cy="12" r="9"/><path d="M12 7.2v6.5"/><circle cx="12" cy="17.2" r=".8" fill="currentColor" stroke="none"/>',
    stage:'<path d="M5 20V5l7-2 7 2v15"/><path d="M3 20h18M8.5 9h1M14.5 9h1M8.5 13h1M14.5 13h1M10 20v-4h4v4"/>',
    court:'<path d="m3 9 9-5 9 5M4 20h16M6 11v7M10 11v7M14 11v7M18 11v7M2 9h20"/>',
    basis:'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M8 11h8M8 15h6"/>'
  };
  return '<svg class="stage-first-glyph stage-first-glyph-'+kind+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+paths[kind]+'</svg>';
}
function stageWizardFirstFieldHeading(kind,title){
  return '<span class="stage-first-field-heading"><span class="stage-first-field-icon">'+stageWizardFirstIcon(kind)+'</span><span class="stage-first-field-caption">'+title+'</span></span>';
}
function stageWizardShortDate(value){
  if(!value||!stageISODateValid(value))return 'Выберите дату';
  var date=parseD(value);
  return new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',year:'numeric'}).format(date);
}
function stageWizardClosureHTML(d,m){
  var n=stageUnresolvedHearings(m).length;
  return '<div class="stage-first-notice" role="note"><span class="stage-first-notice-icon">'+stageWizardFirstIcon('info')+'</span>'+
    '<span class="stage-first-notice-rule" aria-hidden="true"></span>'+
    '<p class="stage-first-notice-text">Завершится только текущая стадия. <strong>В этом\nсценарии создание новой связанной папки\nобязательно.</strong> Если поручение заканчивается\nбез продолжения, используйте «Завершить\nдело полностью».</p></div>'+
    '<div class="stage-wizard-field stage-first-field">'+stageWizardFirstFieldHeading('calendar','Дата завершения')+
      '<span class="stage-first-date-wrap"><input id="st-close-date" type="hidden" value="'+esc(d.closeDate)+'">'+
      '<button class="stage-first-date-trigger" type="button" data-act="date-open" data-target="st-close-date" data-date-for="st-close-date" aria-haspopup="dialog" aria-label="Выбрать дату завершения">'+
      '<span class="premium-date-field-copy"><b>'+esc(stageWizardShortDate(d.closeDate))+'</b></span>'+
      '<span class="stage-first-date-icon" aria-hidden="true">'+stageWizardFirstIcon('calendar')+'</span></button></span></div>'+
    '<label class="stage-wizard-field stage-first-field stage-first-outcome-field">'+stageWizardFirstFieldHeading('result','Фактический результат завершённого этапа')+
      '<span class="stage-first-result-wrap"><select id="st-close-result">'+stageClosureOutcomeOptions(m)
        .map(function(x){return '<option value="'+esc(x[0])+'"'+(x[0]===d.result?' selected':'')+'>'+esc(x[1])+'</option>';}).join('')+'</select>'+
      '<span class="stage-first-result-arrow">'+stageWizardFirstIcon('arrow')+'</span></span></label>'+
    '<label class="stage-wizard-field stage-first-field stage-first-note-field">'+stageWizardFirstFieldHeading('note',d.result==='Иной результат'?'Заключительная запись (обязательно)':'Заключительная запись (необязательно)')+
      '<textarea id="st-close-note" rows="3" placeholder="Что сделано, результат и дальнейшие действия">'+esc(d.note)+'</textarea></label>'+
    (n?'<button type="button" class="stage-wizard-alert stage-first-hearing-alert stage-first-hearing-link" data-act="stage-hearings-open" aria-label="Открыть '+n+' судебных заседаний без результатов">'+
       '<span class="stage-first-hearing-icon">'+stageWizardFirstIcon('warning')+'</span>'+ 
       '<span class="stage-first-hearing-rule" aria-hidden="true"></span>'+ 
       '<span class="stage-first-hearing-copy"><span class="stage-first-hearing-text">'+
          (n===1?'Не указан результат 1 прошедшего заседания. Перед переходом его необходимо завершить.':
           'Не указаны результаты '+n+' прошедших заседаний. Перед переходом их необходимо завершить.')+
        '</span><span class="stage-first-hearing-open">Открыть незавершённые заседания '+stageWizardFirstIcon('arrow')+'</span></span></button>':'');
}
/* 41.66.11 — unresolved hearing drill-down from the first wizard step.
   Uses the existing hearing-result editor; never creates a separate record.
   Preserve the date, outcome and note while the advocate reviews hearings. */
var STAGE_HEARING_NAV=null;
function stageWizardHearingReleasePaint(){
  var panel=document.getElementById('sheet');if(!panel)return;
  if(panel._stageFirstPaintObserver){panel._stageFirstPaintObserver.disconnect();panel._stageFirstPaintObserver=null;}
  if(panel._stageFirstResizeFallback){window.removeEventListener('resize',panel._stageFirstResizeFallback);panel._stageFirstResizeFallback=null;}
}
/* 41.66.17: the review folder is a SECOND visual layer above the live
   first step.  Do not replace #sheet: that would expose the underlying case
   dossier instead of the step from which the user entered this flow. */
function stageWizardHearingOverlayRemove(){
  var overlay=document.getElementById('stage-hearings-overlay');
  if(overlay){
    if(overlay._maOutlineScrollHandler)overlay.removeEventListener('scroll',overlay._maOutlineScrollHandler);
    overlay.remove();
  }
  var veil=document.getElementById('stage-hearings-veil');if(veil)veil.remove();
  document.body.classList.remove('stage-hearings-overlay-active','stage-hearings-backdrop-open');
  var wizard=document.getElementById('sheet');
  if(wizard){wizard.inert=false;wizard.removeAttribute('aria-hidden');}
}
function stageWizardHearingRestoreFirstOutline(){
  var panel=document.getElementById('sheet');
  if(panel&&panel.classList.contains('stage-wizard-first-sheet')&&panel.classList.contains('open')){
    if(typeof mountMatterActionsOutline==='function')mountMatterActionsOutline(panel);
    if(typeof stageWizardFirstFolderPaint==='function')stageWizardFirstFolderPaint(panel);
  }
}
function stageWizardHearingOpen(){
  if(!STAGE_WIZARD||STAGE_WIZARD.step!==0)return;
  var m=matter(STAGE_WIZARD.sourceId);
  if(!m)return;
  stageWizardCapture();
  if(!stageUnresolvedHearings(m).length){stageWizardRender();return;}
  STAGE_HEARING_NAV={sourceId:String(m.id),mode:'list'};
  stageWizardHearingListRender();
}
function stageWizardHearingListRender(){
  var nav=STAGE_HEARING_NAV;
  if(!nav||!STAGE_WIZARD||STAGE_WIZARD.step!==0||String(STAGE_WIZARD.sourceId)!==nav.sourceId)return false;
  var m=matter(nav.sourceId);if(!m)return false;
  var hearings=stageUnresolvedHearings(m).slice().sort(function(a,b){
    return (a.due||'').localeCompare(b.due||'') || (a.time||'').localeCompare(b.time||'');
  });
  if(!hearings.length){stageWizardHearingOverlayRemove();STAGE_HEARING_NAV=null;stageWizardRender();return true;}
  nav.mode='list';
  var items=hearings.map(function(t){
    var date=t.due?fmtD(t.due,true):'Дата не указана';
    var time=t.time?' · '+t.time:'';
    var judge=t.hearingJudge?'Судья: '+t.hearingJudge:'';
    var place=t.place||'';
    return '<button class="stage-hearings-row" type="button" data-act="stage-hearing-edit" data-id="'+esc(t.id)+'" aria-label="Указать результат заседания '+esc(date+time)+'">'+
      '<span class="stage-hearings-row-icon">'+stageWizardFirstIcon('calendar')+'</span>'+
      '<span class="stage-hearings-row-copy"><b>'+esc(date+time)+'</b><span>'+esc(t.title||'Судебное заседание')+'</span>'+
      (judge?'<small>'+esc(judge)+'</small>':'')+
      (place&&place!==t.hearingJudge?'<small>'+esc(place)+'</small>':'')+
      '<em><span class="stage-hearings-status-dot" aria-hidden="true"></span>Требуется результат</em></span>'+
      '<span class="stage-hearings-row-arrow">'+stageWizardFirstIcon('arrow')+'</span></button>';
  }).join('');
  var markup='<section class="stage-hearings-card" aria-label="Заседания без результата">'+
    '<header class="stage-hearings-header"><button type="button" class="stage-hearings-back" data-act="stage-hearings-back" aria-label="Назад к завершению этапа">'+ico('left','s')+'</button>'+
    '<div class="stage-hearings-heading"><div class="stage-hearings-eyebrow"><small>ДЕЙСТВИЯ ПО ДЕЛУ</small><i aria-hidden="true"></i></div>'+
    '<h2>Заседания без результата</h2><p>'+esc(m.client||m.title||'Дело')+'</p></div>'+
    '<span class="stage-hearings-count" aria-label="Незавершённых заседаний: '+hearings.length+'" aria-live="polite">'+hearings.length+'</span></header>'+
    '<div class="stage-hearings-rule" aria-hidden="true"><i></i></div>'+
    '<div class="stage-hearings-intro"><span class="stage-hearings-intro-icon">'+stageWizardFirstIcon('info')+'</span><p>Выберите заседание и сохраните его фактический результат. После этого можно продолжить завершение этапа.</p></div>'+
    '<div class="stage-hearings-list" aria-label="Судебные заседания, требующие результата">'+items+'</div>'+
    '<div class="stage-hearings-hint"><span class="stage-hearings-hint-icon">'+stageWizardFirstIcon('info')+'</span><span>Заседания остаются в истории дела. Результаты сохраняются отдельно по каждому событию.</span></div>'+
    '<div class="stage-hearings-ornament" aria-hidden="true"><span></span><i></i><span></span></div>'+ 
    '<button type="button" class="stage-hearings-return" data-act="stage-hearings-back">'+stageWizardFirstIcon('arrow')+'<span>Вернуться к завершению этапа</span></button></section>';
  // Restore the actual first-step DOM when returning from the hearing editor.
  var wizardPanel=document.getElementById('sheet');
  if(!wizardPanel||!wizardPanel.classList.contains('stage-wizard-first-sheet')||!wizardPanel.classList.contains('open')){
    stageWizardRender();
    wizardPanel=document.getElementById('sheet');
  }
  if(!wizardPanel||!wizardPanel.classList.contains('stage-wizard-first-sheet'))return false;
  stageWizardHearingOverlayRemove();
  var veil=document.createElement('div');
  veil.id='stage-hearings-veil';
  veil.setAttribute('aria-hidden','true');
  veil.dataset.act='stage-hearings-back';
  var hearingPanel=document.createElement('section');
  hearingPanel.id='stage-hearings-overlay';
  hearingPanel.className='case-stage-sheet stage-hearings-sheet open';
  hearingPanel.setAttribute('role','dialog');
  hearingPanel.setAttribute('aria-modal','true');
  hearingPanel.setAttribute('aria-label','Заседания без результата');
  hearingPanel.innerHTML='<div class="grab" aria-hidden="true"></div>'+markup;
  document.body.appendChild(veil);
  document.body.appendChild(hearingPanel);
  document.body.classList.add('stage-hearings-overlay-active');
  wizardPanel.inert=true;wizardPanel.setAttribute('aria-hidden','true');
  // Decorate only the top folder. Underlying wizard and its form are retained.
  if(typeof mountMatterActionsOutline==='function')mountMatterActionsOutline(hearingPanel);
  return true;
}
function stageWizardHearingEdit(id){
  var nav=STAGE_HEARING_NAV;
  if(!nav||nav.mode!=='list')return;
  var m=matter(nav.sourceId);
  var t=S.tasks.find(function(x){return String(x.id)===String(id);});
  if(!m||!t||String(t.mid)!==nav.sourceId||!stageUnresolvedHearings(m).some(function(x){return String(x.id)===String(id);})){stageWizardHearingListRender();return;}
  nav.mode='editor';nav.hearingId=String(id);
  stageWizardHearingOverlayRemove();
  sheetHearingResult(t.id);
}
function stageWizardHearingIsEditing(t){
  return !!(STAGE_HEARING_NAV&&STAGE_HEARING_NAV.mode==='editor'&&t&&
    String(STAGE_HEARING_NAV.sourceId)===String(t.mid)&&String(STAGE_HEARING_NAV.hearingId)===String(t.id)&&
    STAGE_WIZARD&&STAGE_WIZARD.step===0);
}
function stageWizardHearingAfterSave(t){
  if(!stageWizardHearingIsEditing(t))return false;
  STAGE_HEARING_NAV.mode='list';STAGE_HEARING_NAV.hearingId='';
  stageWizardHearingListRender();
  return true;
}
/* Supports the in-sheet back arrow, close icon, background tap and swipe.
   The user's pending wizard form state is never discarded. */
function stageWizardHearingBack(){
  var nav=STAGE_HEARING_NAV,sh=document.getElementById('sheet');
  if(!nav||!sh||!sh.classList.contains('open'))return false;
  if(nav.mode==='editor'){
    HR=null;nav.mode='list';nav.hearingId='';stageWizardHearingListRender();return true;
  }
  if(nav.mode==='list'){
    stageWizardHearingOverlayRemove();
    STAGE_HEARING_NAV=null;
    stageWizardHearingRestoreFirstOutline();
    return true;
  }
  return false;
}
function stageWizardSecondField(kind,title,control){
  return '<div class="stage-second-field">'+
    stageWizardFirstFieldHeading(kind,esc(title))+
    '<div class="stage-second-field-control">'+control+'</div></div>';
}
function stageWizardNextHTML(d,m){
  var stages=stageTransitionOptions(m,d.result),isOther=false;
  if(d.stage==='__other__'){
    d.stage='';d.stageBase='';d.stageCustom='';d.stageReason='';d.routeVerified=false;
  }
  var currentStage=stageTransitionActualStage(d);
  var review=stageTransitionReview(m,d.result,currentStage);
  var currentAllowed=stages.includes(currentStage);
  return '<div class="stage-second-notice" role="note">'+
    '<span class="stage-second-notice-icon">'+stageWizardFirstIcon('info')+'</span>'+
    '<span class="stage-second-notice-rule" aria-hidden="true"></span>'+
    '<p>Следующая стадия подбирается по <strong>виду дела, завершённому этапу и его результату</strong>. ' +
    'Проверьте фактическое движение производства и выберите подходящий вариант. ' +
    'Если работа прекращается — используйте «Завершить дело полностью».</p></div>'+
    '<div class="stage-second-route-context"><b>Завершено: '+esc(m.stage)+'</b><span>Результат: '+esc(d.result||'Не указан')+'</span></div>'+
    stageWizardSecondField('stage','Следующая стадия производства',
      '<div class="stage-second-select"><select id="st-new-stage" aria-label="Следующая стадия производства">'+
        '<option value=""'+(!d.stage?' selected':'')+' disabled hidden>Выберите допустимую стадию</option>'+
        stages.map(function(v){return '<option value="'+esc(v)+'"'+(d.stage===v?' selected':'')+'>'+esc(v)+'</option>';}).join('')+
      '</select></div>')+
    '<div class="stage-second-custom" id="st-new-custom-wrap"'+(isOther?'':' style="display:none"')+'>'+
      stageWizardSecondField('note','Название иного этапа',
        '<input id="st-new-custom" maxlength="100" value="'+esc(d.stageCustom)+'" placeholder="Например, повторное рассмотрение">')+'</div>'+
    '<div class="stage-second-custom" id="st-new-base-wrap"'+(isOther?'':' style="display:none"')+'>'+
      stageWizardSecondField('stage','Процессуальный тип нового этапа',
        '<div class="stage-second-select"><select id="st-new-base-stage" aria-label="Процессуальный тип нового этапа">'+
        '<option value="">Выберите тип</option>'+
        stages.map(function(v){return '<option value="'+esc(v)+'"'+(d.stageBase===v?' selected':'')+'>'+esc(v)+'</option>';}).join('')+
        '</select></div>')+
      stageWizardSecondField('note','Почему необходим индивидуальный этап',
        '<input id="st-new-reason" maxlength="300" value="'+esc(d.stageReason||'')+'" placeholder="Например, дело возвращено на новое рассмотрение">')+'</div>'+
    '<div class="stage-second-route-review" id="st-next-review-wrap"'+(review&&currentAllowed?'':' style="display:none"')+'>'+
      '<p id="st-next-review-text">'+esc(review)+'</p>'+
      '<label class="stage-second-check"><input type="checkbox" id="st-next-review"'+(d.routeVerified&&review?' checked':'')+'><span class="stage-second-check-box" aria-hidden="true">'+ico('check','s')+'</span><span>Процессуальные условия проверены адвокатом</span></label></div>'+
    stageWizardSecondField('calendar','Дата начала новой стадии',
      '<div class="stage-second-date-wrap"><input id="st-new-date" type="hidden" value="'+esc(d.startDate)+'">'+
      '<button class="stage-second-date-trigger" type="button" data-act="date-open" data-target="st-new-date" data-date-for="st-new-date" aria-haspopup="dialog" aria-label="Выбрать дату начала новой стадии">'+
      '<span class="premium-date-field-copy"><b>'+esc(fmtD(d.startDate,true))+'</b></span>'+
      '<span class="stage-second-date-icon" aria-hidden="true">'+stageWizardFirstIcon('calendar')+'</span></button></div>')+
    stageWizardSecondField('court','Суд или орган новой стадии (при наличии)',
      '<input id="st-new-place" maxlength="300" value="'+esc(d.place)+'" placeholder="Можно заполнить позднее">')+
    '<div class="stage-second-hint">'+stageWizardFirstIcon('info')+
    '<span><strong>Суть дела и рабочие заметки</strong> перенесутся автоматически, без отдельного выбора. ' +
    'Незавершённые задачи, заседания и сроки при наличии можно выбрать на следующем шаге. ' +
    'Правовая позиция и прошедшие события останутся в завершённой папке.</span></div>';
}
function stageWizardTasksHTML(d,m){
  var items=stageEligibleTasks(m),selected=new Set(d.moveIds.map(String));
  var selectedCount=items.filter(function(t){return selected.has(String(t.id));}).length;
  var reviewCount=items.filter(function(t){return selected.has(String(t.id))&&['hearing','deadline','investigation'].includes(t.kind);}).length;
  var left=items.length-selectedCount;
  var groups=[{type:'routine',name:'Задачи и встречи',types:['task','meeting']},
              {type:'procedural',name:'Процессуальные записи',types:['deadline','hearing','investigation']}];
  return '<div class="stage-third-intro"><p>Выберите только те записи, по которым работа продолжится в новой стадии. '+
    'Завершённые задачи и прошедшие события остаются в истории дела.</p></div>'+
    '<div class="stage-third-overview" role="status" aria-live="polite"><span class="stage-third-overview-mark">'+
      (typeof advEmbossIcon==='function'?advEmbossIcon('folder'):ico('folder','s'))+'</span><span><b>Не завершено: '+items.length+'</b>'+ 
      '<small id="stage-third-count">Выбрано для переноса: '+selectedCount+'</small></span></div>'+
    '<div class="stage-third-list" role="group" aria-label="Записи для переноса">'+groups.map(function(g){
       var entries=items.filter(function(t){return g.types.includes(t.kind);});
       if(!entries.length)return '';
       return '<div class="stage-third-group"><h3>'+g.name+'</h3>'+entries.map(function(t){
         var chosen=selected.has(String(t.id)),important=['deadline','hearing','investigation'].includes(t.kind);
         var icon={task:'check',meeting:'user',deadline:'clock',hearing:'gavel',investigation:'doc'}[t.kind]||'doc';
         return '<label class="stage-third-item'+(chosen?' is-checked':'')+'"><input type="checkbox" data-stage-move="'+esc(t.id)+'"'+(chosen?' checked':'')+'>'+ 
           '<span class="stage-third-item-icon">'+(typeof advEmbossIcon==='function'?advEmbossIcon(icon):ico(icon,'s'))+'</span>'+ 
           '<span class="stage-third-item-copy"><b>'+esc(t.title||stageTaskLabel(t))+'</b><small>'+esc(stageTaskLabel(t))+(t.due?' · '+esc(fmtD(t.due,true)):'')+(t.time?' · '+esc(t.time):'')+(t.due&&t.due<today()?'<span class="stage-third-overdue"> · Просрочено</span>':'')+'</small></span>'+ 
           '<span class="stage-third-item-check" aria-hidden="true">'+ico('check','s')+'</span></label>';
       }).join('')+'</div>';
    }).join('')+'</div>'+
    '<div class="stage-third-notice"><span class="stage-third-notice-icon">'+stageWizardFirstIcon('info')+'</span><p>Перенос не создаёт копий: выбранные записи перейдут в новую папку и останутся в календаре <strong>один раз</strong>. Неперенесённые останутся в истории завершённого этапа.</p></div>'+
    '<div class="stage-third-confirmations" aria-label="Подтверждение переноса">'+
      '<label class="stage-third-ack" id="st-remaining-wrap"'+(left?'':' hidden')+'><input id="st-ack-remaining" type="checkbox"'+(d.acknowledgeRemaining?' checked':'')+'><span class="stage-third-ack-mark" aria-hidden="true">'+ico('check','s')+'</span><span>Проверил(а): <strong>неперенесённые записи</strong> останутся в истории и не будут показываться в активных списках.</span></label>'+ 
      '<label class="stage-third-ack" id="st-critical-wrap"'+(reviewCount?'':' hidden')+'><input id="st-ack-critical" type="checkbox"'+(d.acknowledgeCritical?' checked':'')+'><span class="stage-third-ack-mark" aria-hidden="true">'+ico('check','s')+'</span><span>Отдельно проверил(а) актуальность сроков, заседаний и следственных действий, выбранных для переноса.</span></label>'+ 
    '</div>';
}
function stageWizardUpdateTasksSelection(){
  var d=STAGE_WIZARD;if(!d||d.step!==2)return;
  var m=matter(d.sourceId),inputs=[].slice.call(document.querySelectorAll('#sheet input[data-stage-move]'));
  var chosen=inputs.filter(function(x){return x.checked;});
  var selected=new Set(chosen.map(function(x){return x.dataset.stageMove;}));
  d.moveIds=Array.from(selected);
  /* The user changed the transfer set: prior attestations are no longer sufficient. */
  d.acknowledgeRemaining=false;d.acknowledgeCritical=false;
  var ackRemaining=document.getElementById('st-ack-remaining'),ackCritical=document.getElementById('st-ack-critical');
  if(ackRemaining)ackRemaining.checked=false;
  if(ackCritical)ackCritical.checked=false;
  inputs.forEach(function(x){var row=x.closest('.stage-third-item');if(row)row.classList.toggle('is-checked',x.checked);});
  var el=document.getElementById('stage-third-count');if(el)el.textContent='Выбрано для переноса: '+chosen.length;
  var remaining=document.getElementById('st-remaining-wrap'),critical=document.getElementById('st-critical-wrap');
  if(remaining)remaining.hidden=chosen.length===inputs.length;
  if(critical)critical.hidden=!stageEligibleTasks(m).some(function(t){return selected.has(String(t.id))&&['deadline','hearing','investigation'].includes(t.kind);});
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
  return '<div class="stage-fourth-intro"><span class="stage-fourth-intro-icon">'+(typeof advEmbossIcon==='function'?advEmbossIcon('doc'):ico('doc','s'))+'</span><p>Предварительный расчёт <strong>по назначению</strong>. За одну дату по одному делу учитывается один день независимо от числа действий. Без подтверждений расчёт остаётся черновиком.</p></div>'+ 
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
  var items=stageEligibleTasks(m),picked=new Set(d.moveIds.map(String)),moving=items.filter(function(t){return picked.has(String(t.id));});
  var stageName=d.stage==='__other__'?d.stageCustom:d.stage;
  var left=items.length-moving.length;
  var critical=moving.filter(function(t){return ['deadline','hearing','investigation'].includes(t.kind);}).length;
  var overdue=moving.filter(function(t){return t.due&&t.due<today();}).length;
  var noun=function(n,one,few,many){return n%10===1&&n%100!==11?one:n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?few:many;};
  var icon=function(kind){return typeof advEmbossIcon==='function'?advEmbossIcon(kind):ico(kind==='court'?'scale':kind,'s');};
  return '<div class="stage-final-intro"><p>Проверьте сведения перед созданием связанной папки. Предыдущая стадия сохранится в истории, новая будет активной.</p></div>'+ 
    '<div class="stage-final-section">'+
      '<div class="stage-final-card"><span class="stage-final-card-icon">'+icon('folder')+'</span><span class="stage-final-card-copy"><small>Завершаемая стадия</small><b>'+esc(m.stage||'Текущая стадия')+'</b><span>'+esc(fmtD(d.closeDate,true))+' · перейдёт в архив</span></span></div>'+ 
      '<span class="stage-final-link" aria-hidden="true">'+ico('chev','s')+'</span>'+ 
      '<div class="stage-final-card is-new"><span class="stage-final-card-icon">'+icon('flag')+'</span><span class="stage-final-card-copy"><small>Новая стадия</small><b>'+esc(stageName)+'</b><span>'+esc(fmtD(d.startDate,true))+' · '+esc(matterBasisLabel(m.basis))+'</span>'+(d.place?'<span>'+esc(d.place)+'</span>':'')+'</span></div>'+ 
    '</div>'+ 
    '<section class="stage-final-review" aria-label="Результаты проверки">'+
      '<h3>Что произойдёт с записями</h3>'+ 
      '<div><span>Перенос в новую папку</span><strong>'+moving.length+'</strong></div>'+ 
      '<div><span>Незавершённые останутся в истории</span><strong>'+left+'</strong></div>'+ 
      (critical?'<p class="stage-final-warning">'+icon('clock')+' Актуальность '+critical+' '+noun(critical,'процессуальной записи','процессуальных записей','процессуальных записей')+' была подтверждена на предыдущем шаге.</p>':'')+
      (overdue?'<p class="stage-final-warning is-overdue">Внимание: '+overdue+' переносимых записей уже просрочены. Их даты не изменятся автоматически.</p>':'')+
      (!items.length?'<p class="stage-final-empty">Незавершённых записей нет. Перенос не требуется.</p>':'')+
    '</section>'+ 
    (d.routeVerified?'<div class="stage-final-note">Условия процессуального перехода проверены адвокатом.</div>':'')+
    (m.basis==='assigned'?'<div class="stage-final-payment">'+icon('doc')+'<span><b>Черновик расчёта по назначению</b><small>'+esc(money(appointmentFeeLineTotal(d.payment.lines)))+' · требуется проверка и подтверждение документов</small></span></div>':'')+
    '<div class="stage-final-note">После подтверждения предыдущая папка останется доступной в связанных стадиях. Дублировать задачи и события приложение не будет.</div>'+ 
    '<label class="stage-final-check"><input type="checkbox" id="st-confirm"'+(d.confirm?' checked':'')+'><span class="stage-final-mark" aria-hidden="true">'+ico('check','s')+'</span><span>Проверил(а) результат, следующую стадию, даты и перенос записей. Подтверждаю завершение этапа и создание новой папки.</span></label>';
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
  /* Scoped first-screen navy. Fill matches the approved dark-blue folder;
     geometry remains generated by mountMatterActionsOutline(). */
  var stageNavy=document.createElementNS(ns,'linearGradient');
  stageNavy.setAttribute('id','stageFirstNavyV6411');
  stageNavy.setAttribute('gradientUnits','userSpaceOnUse');
  stageNavy.setAttribute('x1','0');stageNavy.setAttribute('x2','0');
  stageNavy.setAttribute('y1','0');stageNavy.setAttribute('y2','430');
  [['0%','#0d2144'],['20%','#0c2043'],['32%','#0c1f3f'],['43%','#0c1b38'],['100%','#0a1832']].forEach(function(pair){
    var stop=document.createElementNS(ns,'stop');stop.setAttribute('offset',pair[0]);
    stop.setAttribute('stop-color',pair[1]);stageNavy.appendChild(stop);
  });
  defs.appendChild(stageNavy);
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
  d.basis=m.basis; // Always display the basis from the current case.
  var inner=[stageWizardClosureHTML,stageWizardNextHTML,stageWizardTasksHTML,stageWizardPaymentHTML,stageWizardConfirmHTML][d.step](d,m);
  // Steps 1–5 share the approved single-surface folder; each keeps
  // its own data bindings and validation.
  var premiumStep=d.step<=4;
  var action='<button class="btn stage-wizard-primary" type="button" data-act="'+(d.step===4?'stage-wizard-commit':'stage-wizard-next')+'">'+(d.step===4?'Создать новую папку':'Продолжить')+'</button>';
  var html=premiumStep
    ?'<section class="stage-wizard-card stage-wizard-first-card" aria-label="'+esc(stageStepTitle())+' — шаг '+(d.step+1)+'">'+
      '<div class="stage-wizard-first-header">'+stageWizardHead()+'</div>'+
      '<div class="stage-wizard-first-paper"><div class="stage-wizard-body">'+inner+'</div>'+
      '<div class="stage-wizard-first-action">'+action+'</div></div></section>'
    :'<section class="stage-wizard-card">'+stageWizardHead()+'<div class="stage-wizard-body">'+inner+'</div></section>'+action;
  openSheet(html);
  var panel=$('#sheet');
  panel.classList.remove('stage-wizard-first-sheet','stage-wizard-second-sheet','stage-wizard-third-sheet','stage-wizard-payment-sheet','stage-wizard-confirm-sheet');
  panel.classList.add('case-stage-sheet');
  if(premiumStep){
    panel.classList.add('stage-wizard-first-sheet');
    if(d.step===1)panel.classList.add('stage-wizard-second-sheet');
    if(d.step===2)panel.classList.add('stage-wizard-third-sheet');
    if(d.step===3)panel.classList.add('stage-wizard-payment-sheet');
    if(d.step===4)panel.classList.add('stage-wizard-confirm-sheet');
    mountMatterActionsOutline(panel);
    stageWizardFirstFolderPaint(panel);
    // Independent viewport background, below SVG folder and above old scrim.
    // Avoids the solid iOS home-screen strip beyond the page's 100lvh canvas.
    var bg=document.getElementById('stage-wizard-viewport-backdrop');
    if(!bg){
      bg=document.createElement('div');
      bg.id='stage-wizard-viewport-backdrop';
      bg.setAttribute('aria-hidden','true');
      document.body.appendChild(bg);
    }
  }
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
    STAGE_WIZARD=null;STAGE_HEARING_NAV=null;
    closeAll();S.ui.matterScope='active';S.ui.matterStatus='';
    go('matters');openMatter(result.newId,'general');
    toast('Новая стадия создана · перенесено записей: '+result.moved);
  }catch(e){toast(e&&e.message||'Не удалось сохранить переход');
    if(btn){btn.disabled=false;btn.textContent='Создать новую папку';}
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
  var select=document.getElementById('st-new-stage');if(!select||!STAGE_WIZARD)return;
  var active=select.value==='__other__';
  ['st-new-custom-wrap','st-new-base-wrap'].forEach(function(id){var el=document.getElementById(id);if(el)el.style.display=active?'block':'none';});
  var base=document.getElementById('st-new-base-stage');
  var stage=active?(base&&base.value||''):select.value;
  var review=stageTransitionReview(matter(STAGE_WIZARD.sourceId),STAGE_WIZARD.result,stage);
  var box=document.getElementById('st-next-review-wrap');
  if(box)box.style.display=review?'block':'none';
  var hint=document.getElementById('st-next-review-text');if(hint)hint.textContent=review;
  var checkbox=document.getElementById('st-next-review');if(checkbox)checkbox.checked=false;
}
document.addEventListener('change',function(e){if(e.target&&['st-new-stage','st-new-base-stage'].includes(e.target.id))stageWizardToggleCustom();});
document.addEventListener('input',function(e){if(e.target&&['st-new-stage','st-new-base-stage'].includes(e.target.id))stageWizardToggleCustom();});

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

/* Keep transfer badges current without reinstalling listeners on each render. */
document.addEventListener('change',function(event){
  if(event.target&&event.target.matches('#sheet input[data-stage-move]'))stageWizardUpdateTasksSelection();
});
