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
function stageAllowedStage(m,stage){return !!(m&&((MATTER_STAGE_MAP[m.type]||MATTER_STAGE_MAP.other)||[]).includes(stage));}
function stagePrepareNewMatter(src,d,id,now){
  var custom=d.stage==='__other__'?String(d.stageCustom||'').trim():'',stage=d.stage==='__other__'?d.stageBase:d.stage;
  var out={id:id,type:src.type,basis:d.basis,client:src.client||'',phone:src.phone||'',number:'',
    stage:stage,stageInstanceLabel:custom||stage,article:src.article||'',role:src.role||'',
    court:String(d.place||'').trim(),investigator:'',judge:'',opponent:src.opponent||'',
    restraint:src.restraint||'',executionIssue:'',executionInstitution:'',
    notes:d.copyNotes?String(src.notes||''):'',position:d.copyPosition?clone(src.position||{}):{},
    dayRate:+src.dayRate||0,archived:false,created:now,
    caseGroupId:stageCaseGroupId(src),previousStageId:String(src.id),
    stageInstanceId:id,stageIndex:stageRelatedCases(src).reduce(function(n,x){return Math.max(n,+x.stageIndex||0);},0)+1,
    stageStartedAt:d.startDate,stageClosed:null,nextStageIds:[]};
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
    if(!String(d.result||'').trim()||!String(d.note||'').trim())throw new Error('Заполните результат и заключительную запись');
    if(!MATTER_BASIS[d.basis])throw new Error('Выберите основание участия в новом этапе');
    if(d.stage==='__other__'){
      if(String(d.stageCustom||'').trim().length<3)throw new Error('Введите название нового этапа');
      if(!stageAllowedStage(src,d.stageBase))throw new Error('Укажите процессуальный тип нового этапа');
    }else if(!stageAllowedStage(src,d.stage))throw new Error('Выбрана недопустимая стадия');
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
    addJournal(src.id,'Этап завершён: '+String(d.result).trim()+'. '+String(d.note).trim(),d.closeDate,'closure',true);
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
