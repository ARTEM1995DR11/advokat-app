/* Stage-linked dossiers — introduced in 5.0.1297.41.10.
   Historical cases are left unchanged: the root case ID becomes the group ID
   only when the owner explicitly starts another stage. */
'use strict';
function stageCaseGroupId(m){return String((m&&(m.caseGroupId||m.id))||'');}
function stageRelatedCases(m){
  if(!m)return [];
  var gid=stageCaseGroupId(m);
  return S.matters.filter(function(x){return x&&stageCaseGroupId(x)===gid;})
    .slice().sort(function(a,b){return (+a.stageIndex||0)-(+b.stageIndex||0)||String(a.created||'').localeCompare(String(b.created||''));});
}
function stageCaseHasLinks(m){return !!(m&&stageRelatedCases(m).length>1);}
function stageCaseHeading(m){return String((m&&(m.stageInstanceLabel||m.stage))||'Этап производства');}
function stageEligibleTasks(m){return m?tasksOf(m.id).filter(isActiveRecord):[];}
function stageUnresolvedHearings(m){return m?tasksOf(m.id).filter(function(t){return t.kind==='hearing'&&hearingNeedsResult(t);}):[];}
function stagePaymentDrafts(m){return m&&m.basis==='assigned'?(S.stagePayments||[]).filter(function(x){return x&&x.mode==='assigned'&&sameRecordId(x.mid,m.id);}):[];}
function stageISODateValid(iso){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(iso||''))return false;
  var a=iso.split('-').map(Number),d=new Date(Date.UTC(a[0],a[1]-1,a[2]));
  return d.getUTCFullYear()===a[0]&&d.getUTCMonth()+1===a[1]&&d.getUTCDate()===a[2];
}
/* 6464: procedural routes are recommendations with real restrictions, not a linear
   numeric ordering. The final choice remains with counsel, but a completed
   first-instance lawsuit can never go back to pre-trial through this wizard. */
function stageTransitionOptions(m,outcome){
  if(!m)return [];
  var type=m.type||'other',stage=m.stage||'',v=String(outcome||'');
  var choices=[];
  if(type==='civil'||type==='admin'){
    if(stage==='Досудебная работа')choices=['Первая инстанция'];
    else if(stage==='Первая инстанция'){
      if(/оставлено без рассмотрения/i.test(v))choices=['Первая инстанция','Апелляция','Кассация'];
      else if(/судебный приказ/i.test(v))choices=['Исполнение','Первая инстанция'];
      else if(/прекращено/i.test(v))choices=['Апелляция','Кассация'];
      else choices=['Апелляция','Кассация','Исполнение'];
    }else if(stage==='Апелляция'){
      choices=/жалоба оставлена без рассмотрения/i.test(v)?['Апелляция','Кассация']:['Кассация','Исполнение'];
    }else if(stage==='Кассация'){
      choices=/новое рассмотрение/i.test(v)?['Первая инстанция','Апелляция','Кассация']:['Кассация','Надзор','Исполнение'];
    }else if(stage==='Надзор'){
      choices=/новое рассмотрение/i.test(v)?['Первая инстанция','Апелляция','Кассация']:['Исполнение'];
    }else if(stage==='Исполнение')choices=['Исполнение'];
  }else if(type==='criminal'){
    if(stage==='Материал проверки'){
      if(/частное обвинение/i.test(v))choices=['Первая инстанция'];
      else if(/возбуждено уголовное дело/i.test(v))choices=['Дознание','Следствие МВД','Следствие СК'];
      else if(/отменён отказ|проверка возобновлена|передано по подследственности/i.test(v))choices=['Материал проверки','Дознание','Следствие МВД','Следствие СК'];
      else choices=['Материал проверки','Первая инстанция'];
    }else if(['Дознание','Следствие МВД','Следствие СК'].includes(stage)){
      if(/направлено в суд/i.test(v))choices=['Первая инстанция'];
      else if(/передано по подследственности/i.test(v))choices=['Дознание','Следствие МВД','Следствие СК'];
      else choices=['Дознание','Следствие МВД','Следствие СК','Первая инстанция'];
    }else if(stage==='Первая инстанция'){
      if(/возвращено прокурору/i.test(v))choices=['Дознание','Следствие МВД','Следствие СК'];
      else if(/передано по подсудности/i.test(v))choices=['Первая инстанция'];
      else choices=['Апелляция','Кассация','Исполнение приговора'];
    }else if(stage==='Апелляция'){
      choices=/новое рассмотрение/i.test(v)?['Первая инстанция','Кассация','Исполнение приговора']:['Кассация','Исполнение приговора'];
    }else if(stage==='Кассация'){
      choices=/новое рассмотрение/i.test(v)?['Первая инстанция','Апелляция','Кассация']:['Кассация','Надзор','Исполнение приговора'];
    }else if(stage==='Надзор')choices=/новое рассмотрение/i.test(v)?['Первая инстанция','Апелляция','Кассация']:['Исполнение приговора'];
    else if(stage==='Исполнение приговора')choices=['Исполнение приговора','Апелляция','Кассация'];
  }else if(type==='koap'){
    if(stage==='Проверка / административное расследование')choices=['Первая инстанция','Проверка / административное расследование'];
    else if(stage==='Первая инстанция'){
      if(/возвращён|возвращен/i.test(v))choices=['Проверка / административное расследование','Первая инстанция'];
      else if(/подведомственности/i.test(v))choices=['Первая инстанция'];
      else choices=['Пересмотр / апелляция','Исполнение'];
    }else if(stage==='Пересмотр / апелляция')choices=/новое рассмотрение|подведомственности/i.test(v)?['Первая инстанция','Пересмотр / апелляция']:['Пересмотр / апелляция','Исполнение'];
    else if(stage==='Исполнение')choices=['Исполнение','Пересмотр / апелляция'];
  }else{
    var all=MATTER_STAGE_MAP.other||[];
    var start=all.indexOf(stage);
    choices=all.filter(function(x,i){return i>=start&&x!==stage;});
    if(!choices.length)choices=[stage];
  }
  var possible=(typeof matterStageList==='function'?matterStageList(type,m.basis):(MATTER_STAGE_MAP[type]||MATTER_STAGE_MAP.other));
  return choices.filter(function(x,i){return choices.indexOf(x)===i&&possible.includes(x);});
}
function stageTransitionActualStage(d){return d.stage==='__other__'?d.stageBase:d.stage;}
function stageAllowedTransition(m,outcome,nextStage){return stageTransitionOptions(m,outcome).includes(nextStage);}
function stageCustomLabelValid(m,custom,base){
  var label=String(custom||'').trim().toLowerCase().replace(/ё/g,'е');
  if(!label)return false;
  var stages=(MATTER_STAGE_MAP[m.type]||MATTER_STAGE_MAP.other);
  if(stages.some(function(x){return x.toLowerCase().replace(/ё/g,'е')===label&&x!==base;}))return false;
  // The free-form label must not disguise a forbidden procedural rollback.
  if(['civil','admin'].includes(m.type)&&m.stage!=='Досудебная работа'&&/досудебн|претензионн/i.test(label))return false;
  return true;
}
function stageTransitionReview(m,outcome,nextStage){
  if(!m||!nextStage)return '';
  if(['civil','admin'].includes(m.type)&&m.stage==='Первая инстанция'&&nextStage==='Кассация')
    return 'Прямая кассация возможна только при соблюдении процессуальных условий. Проверьте вступление акта в силу и исчерпание доступных способов обжалования.';
  if(['civil','admin'].includes(m.type)&&m.stage==='Первая инстанция'&&nextStage==='Исполнение')
    return 'Проверьте вступление судебного акта в силу, возможность немедленного исполнения и наличие исполнительного документа.';
  if(nextStage==='Надзор')return 'Надзор не является обычной очередной инстанцией. Проверьте, допускается ли пересмотр именно этого судебного акта.';
  if(m.type==='criminal'&&m.stage==='Исполнение приговора'&&['Апелляция','Кассация'].includes(nextStage))
    return 'Проверьте, что обжалуется именно постановление по вопросу исполнения приговора и выбран правильный порядок пересмотра.';
  return '';
}
function stageAllowedStage(m,stage){return !!(m&&((MATTER_STAGE_MAP[m.type]||MATTER_STAGE_MAP.other)||[]).includes(stage));}
/* The result describes WHAT HAPPENED during the stage, never WHETHER
   there will be a next stage: this wizard always creates a linked folder.
   Keep non-standard outcomes available without inventing a procedural fact. */
function stageClosureOutcomeOptions(m){
  return [['','Выберите фактический результат']].concat(stageOutcomeList(m).map(function(x){
    return [x.value,x.title];
  }));
}

function stagePrepareNewMatter(src,d,id,now){
  var custom=d.stage==='__other__'?String(d.stageCustom||'').trim():'',stage=d.stage==='__other__'?d.stageBase:d.stage;
  var out={id:id,type:src.type,basis:d.basis,client:src.client||'',phone:src.phone||'',number:'',
    stage:stage,stageInstanceLabel:custom||stage,article:src.article||'',role:src.role||'',
    court:String(d.place||'').trim(),investigator:'',judge:'',opponent:src.opponent||'',
    restraint:src.restraint||'',executionIssue:'',executionInstitution:'',
    notes:d.copyNotes?String(src.notes||''):'',position:{}, // новая самостоятельная позиция; прежняя доступна в связанной папке
    dayRate:+src.dayRate||0,archived:false,created:now,
    caseGroupId:stageCaseGroupId(src),previousStageId:String(src.id),
    stageInstanceId:id,stageIndex:stageRelatedCases(src).reduce(function(n,x){return Math.max(n,+x.stageIndex||0);},0)+1,
    stageStartedAt:d.startDate,stageClosed:null,nextStageIds:[],
    stageTransition:{from:String(src.id),outcome:String(d.result||''),reviewed:!!d.routeVerified,reason:String(d.stageReason||'').trim()}};
  out=sanitizeMatterByType(out);
  if(custom)out.stageInstanceLabel=custom;
  out.title=matterAutoTitle(out);
  return out;
}
function stageBuildPaymentDraft(src,d,now,operationId){
  // Stage 4: PAYMENT IS STRICTLY FOR APPOINTED COUNSEL. Never create
  // a claim, fee line or agreement receipt for contractual engagements.
  if(!src||src.basis!=='assigned')return null;
  var pay=d.payment||{},rows=[],sum=0,seen=new Set();
  var candidateDates=new Set(appointmentFeeDays(src,d.closeDate).map(function(x){return x.date;}));
  (Array.isArray(pay.lines)?pay.lines:[]).forEach(function(line){
    if(!candidateDates.has(line.date)||seen.has(line.date))return;
    seen.add(line.date);
    var rate=appointmentFeeMoney(line.rate),included=!!line.included,claimed=!!line.alreadyClaimed;
    var original=appointmentFeeDays(src,d.closeDate).find(function(x){return x.date===line.date;});
    if(included&&!claimed)sum+=rate;
    rows.push({date:line.date,kind:(original&&original.kind)||'other',
      desc:(original&&original.desc)||'',place:(original&&original.place)||'',
      participationIds:(original&&original.participationIds)||[],taskIds:(original&&original.taskIds)||[],source:(original&&original.source)||'participation',
      rate:rate,included:included,alreadyClaimed:claimed,
      dayType:appointmentFeeDayType(line.dayType,line.date),
      proof:String(line.proof||'').trim().slice(0,500),verified:!!line.verified,
      requiresRateCheck:included&&!claimed&&(!rate||!line.verified||!String(line.proof||'').trim())});
  });
  rows.sort(function(a,b){return a.date.localeCompare(b.date);});
  var active=rows.filter(function(x){return x.included&&!x.alreadyClaimed;});
  var requiresReview=!active.length||rows.some(function(x){return x.requiresRateCheck;});
  return {id:'stage-payment-'+uid(),mid:String(src.id),caseGroupId:stageCaseGroupId(src),
    operationId:operationId,basis:'assigned',mode:'assigned',status:'draft',
    createdAt:now,periodEnd:d.closeDate,lines:rows,
    category:appointmentFeeCategory(pay.category),
    rateSource:'ПП РФ № 1240, пп. 22(1), 23; ПП РФ № 1191 (с 01.10.2025). Категория и подтверждения выбирает адвокат.',
    total:appointmentFeeMoney(sum),needsReview:requiresReview,
    note:String(pay.note||'').trim().slice(0,1500),
    disclaimer:'Предварительный расчёт по назначению. Проверить дни занятости, категорию, подтверждения, выплаты и действовавшую редакцию ставок. Не является заявлением или документом о начислении.'};
}
/* One serialized encrypted snapshot: before closing the old dossier, check
   all inputs; on failed write roll state back (including journal/linked task IDs). */
var STAGE_COMMIT_BUSY=false;
async function stageCommitTransfer(d){
  if(STAGE_COMMIT_BUSY)throw new Error('Перенос уже выполняется');
  STAGE_COMMIT_BUSY=true;
  var before=null;
  try{
    var src=matter(d.sourceId);
    // A repeated request with the same token returns the already committed
    // result and never creates a second folder, fee draft or journal event.
    if(src&&src.stageClosed&&d.operationId&&src.stageClosed.operationId===d.operationId){
      var oldNext=matter(src.stageClosed.nextStageId);
      if(oldNext)return {newId:String(oldNext.id),operationId:d.operationId,
        moved:S.tasks.filter(function(t){return (t.stageTransfers||[]).some(function(x){return x.operationId===d.operationId;});}).length,
        paymentId:((S.stagePayments||[]).find(function(x){return x.operationId===d.operationId;})||{}).id||null,
        replayed:true};
    }
    if(!src||src.archived||src.stageClosed)throw new Error('Исходный этап уже завершён');
    if(d.confirm!==true)throw new Error('Не подтверждено завершение этапа');
    if(!stageISODateValid(d.closeDate)||d.closeDate>today())throw new Error('Укажите допустимую дату завершения');
    if(!stageISODateValid(d.startDate))throw new Error('Укажите дату начала новой стадии');
    if(d.startDate<d.closeDate)throw new Error('Новая стадия не может начинаться раньше даты завершения предыдущей');
    if(!String(d.result||'').trim())throw new Error('Укажите фактический результат завершённой стадии');
    if(d.result==='Иной результат'&&!String(d.note||'').trim())throw new Error('Уточните иной результат в заключительной записи');
    if(!stageClosureOutcomeOptions(src).some(function(x){return x[0]===d.result;}))throw new Error('Выбран недопустимый результат для текущей стадии');
    if(!MATTER_BASIS[d.basis])throw new Error('Выберите основание участия в новом этапе');
    if(d.stage==='__other__'){
      if(String(d.stageCustom||'').trim().length<3)throw new Error('Введите название нового этапа');
      if(!stageAllowedTransition(src,d.result,d.stageBase))throw new Error('Этот процессуальный тип не соответствует итогам предыдущей стадии');
      if(String(d.stageReason||'').trim().length<10)throw new Error('Поясните причину индивидуального маршрута (не менее 10 символов)');
      if(!stageCustomLabelValid(src,d.stageCustom,d.stageBase))throw new Error('Название индивидуального этапа противоречит выбранному процессуальному типу');
    }else if(!stageAllowedTransition(src,d.result,d.stage))throw new Error('Новая стадия не соответствует результату предыдущего этапа');
    if(stageTransitionReview(src,d.result,stageTransitionActualStage(d))&&!d.routeVerified)throw new Error('Подтвердите проверку процессуальных условий выбранного перехода');
    if(stageUnresolvedHearings(src).length)throw new Error('Укажите результат прошедших заседаний до завершения этапа');
    var eligible=stageEligibleTasks(src),eligibleIds=new Set(eligible.map(function(x){return String(x.id);}));
    var selection=new Set(Array.isArray(d.moveIds)?d.moveIds.map(String):[]);
    for(var id of selection){if(!eligibleIds.has(id))throw new Error('Список переноса устарел. Проверьте задачи заново');}
    if(eligible.some(function(t){return !selection.has(String(t.id));})&&!d.acknowledgeRemaining)
      throw new Error('Подтвердите судьбу незавершённых записей, оставленных в старой папке');
    if(eligible.some(function(t){return selection.has(String(t.id))&&['deadline','hearing','investigation'].includes(t.kind);})&&!d.acknowledgeCritical)
      throw new Error('Отдельно подтвердите перенос сроков, заседаний и следственных действий');
    if(eligible.some(function(t){return selection.has(String(t.id))&&t.kind==='investigation';})&&
       !stageInvestigationApplicable({type:src.type,stage:d.stage==='__other__'?d.stageBase:d.stage}))
      throw new Error('Следственное действие нельзя переносить в судебный этап: оставьте в истории или создайте задачу в новом этапе');
    if(!(await flushSave()))throw new Error('Не удалось сохранить последние изменения перед переносом');
    // Re-read the live record after any queued persistence has completed.
    src=matter(d.sourceId);
    if(!src||src.archived||src.stageClosed)throw new Error('Исходный этап был изменён');
    var liveEligible=stageEligibleTasks(src), liveIds=new Set(liveEligible.map(function(x){return String(x.id);}));
    for(var tid of selection){if(!liveIds.has(tid))throw new Error('Записи изменились во время подготовки перехода');}
    if(liveEligible.some(function(t){return !selection.has(String(t.id));})&&!d.acknowledgeRemaining)
      throw new Error('Подтвердите оставшиеся незавершённые записи');
    if(stageUnresolvedHearings(src).length)throw new Error('Не указаны результаты судебных заседаний');
    before=clone(S);
    var op=String(d.operationId||'stage-op-'+uid()),newId='stage-m-'+uid(),now=new Date().toISOString();
    if(S.matters.some(function(x){return x.stageClosed&&x.stageClosed.operationId===op;}))
      throw new Error('Эта операция завершения уже зарегистрирована');
    var next=stagePrepareNewMatter(src,d,newId,now);
    next.createdByStageOperationId=op;
    var moved=[];
    S.matters.unshift(next);
    src.caseGroupId=stageCaseGroupId(src);
    src.stageInstanceId=String(src.stageInstanceId||src.id);
    if(src.stageIndex==null)src.stageIndex=0;
    src.stageClosed={operationId:op,date:d.closeDate,result:String(d.result).trim(),note:String(d.note).trim(),nextStageId:newId,closedAt:now};
    src.nextStageIds=(src.nextStageIds||[]).concat(newId);
    src.closure={date:d.closeDate,outcome:'transferred',summary:d.note,recordedAt:now};
    src.archived=true;
    S.tasks.forEach(function(t){
      if(!t||!sameRecordId(t.mid,src.id)||!selection.has(String(t.id)))return;
      t.stageTransfers=(Array.isArray(t.stageTransfers)?t.stageTransfers:[]).concat({operationId:op,from:String(src.id),to:newId,at:now});
      t.mid=newId;
      // A judicial hearing may not stay classified as such in a pre-trial stage.
      if(t.kind==='hearing'&&!hearingMatterIsJudicial(next))normalizeHearingKindByMatter(t,next);
      moved.push(t);
    });
    S.stagePayments=S.stagePayments||[];
    var payment=stageBuildPaymentDraft(src,d,now,op);
    if(payment)S.stagePayments.unshift(payment);
    addJournal(src.id,'Этап завершён: '+String(d.result).trim()+'.'+(String(d.note||'').trim()?' '+String(d.note).trim():''),d.closeDate,'closure',true);
    addJournal(src.id,'Продолжение дела: «'+stageCaseHeading(next)+'». Перенесено записей: '+moved.length,d.closeDate,'system',true);
    addJournal(newId,'Создан новый этап из папки «'+stageCaseHeading(src)+'». Перенесено записей: '+moved.length,d.startDate,'system',true);
    moved.forEach(function(t){
      addJournal(src.id,'Передано в новый этап: '+(t.title||'Запись'),d.closeDate,'system',true);
      addJournal(newId,'Перенесено из прошлого этапа: '+(t.title||'Запись'),d.startDate,'system',true);
    });
    var ok=await persistNow();
    if(!ok)throw new Error('Не удалось записать изменения в защищённую базу');
    return {newId:newId,operationId:op,moved:moved.length,paymentId:payment?payment.id:null};
  }catch(e){if(before){S=before;mem=clone(S);}throw e;}
  finally{STAGE_COMMIT_BUSY=false;}
}
