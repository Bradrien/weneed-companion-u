import {sourceTime,sourceCount,sourceText} from './source-state-d34.mjs';
import {validClientId} from './clients-model-d14.mjs';
const id=x=>{if(!validClientId(x))throw Error('invalid_task_identity');return x};
const statuses=new Set(['OPEN','DONE','CANCELLED']);
const reminderStatuses=new Set(['SYNCED','PENDING','ERROR','IGNORED']);
const reasons=new Set(['eligible','task_not_found','task_not_open','suggested_task','confidence_below_0_90',
 'missing_source_event','missing_event_time','historical_backfill','legacy_extractor','not_commercially_linked']);
export function normalizeTaskPage(body,scope){
 const raw=body?.data;
 if(body?.ok!==true||!raw||typeof raw!=='object'||Array.isArray(raw)||!Array.isArray(raw.tasks)||raw.tasks.length>200||
  !['ALL','OPEN','DONE','CANCELLED'].includes(scope.status)||raw.limit!==undefined&&raw.limit!==200)throw Error('tasks_unavailable');
 if(scope.clientId!==null)id(scope.clientId);
 const offset=sourceCount(scope.offset,100000),total=sourceCount(raw.total),checked=sourceTime(raw.checked_at);
 if(!checked||raw.tasks.length!==Math.min(200,Math.max(0,total-offset)))throw Error('tasks_unavailable');
 const ids=new Set(),rows=raw.tasks.map(t=>{
  const taskId=id(t.id),clientId=t.client_id===null?null:id(t.client_id),updated=sourceTime(t.updated_at),
   synced=sourceTime(t.reminder_synced_at),due=sourceTime(t.due_at);
  if(ids.has(taskId)||!updated||!statuses.has(t.status)||typeof t.is_suggested!=='boolean'||
   scope.status!=='ALL'&&t.status!==scope.status||scope.clientId&&clientId!==scope.clientId||
   t.reminder_sync_status!=null&&!reminderStatuses.has(t.reminder_sync_status))throw Error('tasks_unavailable');
  ids.add(taskId);
  return {id:taskId,client_id:clientId,client_name:t.client_name==null?null:sourceText(t.client_name,1000,{empty:true}),
   title:sourceText(t.title,1000),description:t.description==null?null:sourceText(t.description,20000,{empty:true}),
   due_at:due,status:t.status,is_suggested:t.is_suggested,updated_at:updated,reminder_synced_at:synced,
   reminder_sync_status:t.reminder_sync_status||null,reminder_action:['UPSERT','DELETE'].includes(t.reminder_action)?t.reminder_action:null,
   reminder_reason:reasons.has(t.reminder_reason)?t.reminder_reason:null};
 });
 return {rows,total,checked};
}
export function normalizeTaskMutationReply(body,request){
 if(body?.ok!==true||!validClientId(body.task_id)||
  body.duplicate!==undefined&&typeof body.duplicate!=='boolean'||
  body.existing_suggestion_approved!==undefined&&typeof body.existing_suggestion_approved!=='boolean')throw Error('tasks_unavailable');
 if(request.action!=='create'&&body.task_id!==request.task_id&&
  !(request.action==='merge'&&body.task_id===request.payload?.target_id))throw Error('tasks_unavailable');
 if(request.action!=='create'&&(body.duplicate===true||body.existing_suggestion_approved===true))throw Error('tasks_unavailable');
 const updatedAt=sourceTime(body.updated_at);
 return {duplicate:body.duplicate===true,existing_suggestion_approved:body.existing_suggestion_approved===true,
  task_id:body.task_id,updated_at:updatedAt};
}
