import {sourceTime,sourceCount,sourceText} from './source-state-d34.mjs';
import {validClientId} from './clients-model-d14.mjs';
export const sampleLabels={PLANNED:'À préparer',SENT:'Envoyé',RECEIVED:'Reçu',FEEDBACK:'Retour obtenu',WON:'Commande signalée',LOST:'Sans suite',CANCELLED:'Annulé'};
export const sampleTransitions={PLANNED:['SENT','CANCELLED'],SENT:['RECEIVED','FEEDBACK','WON','LOST','CANCELLED'],RECEIVED:['FEEDBACK','WON','LOST','CANCELLED'],FEEDBACK:['WON','LOST','CANCELLED'],WON:[],LOST:[],CANCELLED:[]};
const text=(v,max)=>sourceText(v,max,{empty:true});
export function normalizeSamplePage(body,scope){
 const d=body?.data;if(body?.ok!==true||!d||d.version!=='client_samples_v1'||d.scope!=='owner_recorded_samples'||d.limit!==50||d.offset!==scope.offset||
  !['ACTIVE','OVERDUE','ALL',...Object.keys(sampleLabels)].includes(scope.status)||scope.clientId!==null&&!validClientId(scope.clientId)||!Array.isArray(d.samples))throw Error('samples_unavailable');
 const total=sourceCount(d.total,100000),checked=sourceTime(d.checked_at),seen=new Set();
 if(!checked||d.samples.length!==Math.min(50,Math.max(0,total-scope.offset)))throw Error('samples_unavailable');
 const rows=d.samples.map(s=>{
  if(!validClientId(s.id)||!validClientId(s.client_id)||seen.has(s.id)||!Object.hasOwn(sampleLabels,s.status)||scope.clientId&&s.client_id!==scope.clientId||
   Object.hasOwn(sampleLabels,scope.status)&&s.status!==scope.status||['ACTIVE','OVERDUE'].includes(scope.status)&&!sampleTransitions[s.status].length)throw Error('samples_unavailable');
  seen.add(s.id);const updated=sourceTime(s.updated_at),created=sourceTime(s.created_at),follow=sourceTime(s.follow_up_at),sent=sourceTime(s.sent_at),received=sourceTime(s.received_at);
  if(!updated||!created||s.follow_up_at!==null&&!follow||s.sent_at!==null&&!sent||s.received_at!==null&&!received||scope.status==='OVERDUE'&&(!follow||Date.parse(follow)>Date.parse(checked)))throw Error('samples_unavailable');
  return {id:s.id,client_id:s.client_id,client_name:sourceText(s.client_name,1000),status:s.status,products:sourceText(s.products,2000),
   goal:text(s.goal,1000),notes:text(s.notes,5000),tracking:text(s.tracking,500),follow_up_at:follow,sent_at:sent,received_at:received,created_at:created,updated_at:updated};
 });
 const counts={active:sourceCount(d.counts?.active,100000),overdue:sourceCount(d.counts?.overdue,100000),won:sourceCount(d.counts?.won,100000)};
 if(counts.overdue>counts.active)throw Error('samples_unavailable');return {rows,total,checked,counts};
}
export function normalizeSampleReply(body,request){
 try{
  if(body?.ok!==true||!validClientId(body.sample_id)||request.action!=='create'&&body.sample_id!==request.sample_id||!sourceTime(body.updated_at))throw Error('samples_unavailable');
  return {id:body.sample_id,updated_at:body.updated_at};
 }catch{throw Error('samples_unavailable')}
}
