import {sourceTime,sourceCount} from './source-state-d34.mjs';
export const connectorNames=Object.freeze({gmail:'Gmail',google_chat:'Google Chat',google_drive:'Google Drive'});
const countFields=['fetched_count','processed_count','failed_count','inserted_count','duplicate_count','skipped_count','limited_count','pages_count'];
export function normalizeConnectorStatus(data){
 if(!Array.isArray(data)||data.length>30)throw Error('invalid_connector_status');
 const bySource=new Map();
 for(const row of data){
  if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.source!=='string')throw Error('invalid_connector_status');
  if(!Object.hasOwn(connectorNames,row.source))continue;
  if(bySource.has(row.source)||typeof row.sync_in_progress!=='boolean'||typeof row.continuation_pending!=='boolean'||
   ![null,'success','failed','partial','running','skipped'].includes(row.last_run_status))throw Error('invalid_connector_status');
  const counts=Object.fromEntries(countFields.map(key=>[key,row[key]==null?null:sourceCount(row[key])]));
  const coverageFrom=sourceTime(row.coverage_from),watermark=sourceTime(row.watermark_at),lastSuccess=sourceTime(row.last_success_at);
  // A legacy last-success timestamp is not proof that an entire dated window was read.
  const completeAt=watermark||lastSuccess;
  if(coverageFrom&&watermark&&Date.parse(coverageFrom)>Date.parse(watermark))throw Error('invalid_connector_status');
  bySource.set(row.source,{source:row.source,available:true,coverageFrom,watermark,completeAt,
   coverageKnown:!!(coverageFrom&&watermark),inProgress:row.sync_in_progress,pending:row.continuation_pending,
   lastRunStatus:row.last_run_status,startedAt:sourceTime(row.last_run_started_at),finishedAt:sourceTime(row.last_run_finished_at),
   error:typeof row.last_error==='string'&&row.last_error?row.last_error:null,counts});
 }
 return Object.keys(connectorNames).map(source=>bySource.get(source)||{source,available:false,coverageKnown:false,completeAt:null,counts:{}});
}
export function connectorHealth(row,now=Date.now()){
 if(!row.available)return {kind:'missing',label:'Aucun état reçu pour cette source'};
 const dates=[row.completeAt,row.coverageFrom,row.startedAt,row.finishedAt].filter(Boolean).map(Date.parse);
 if(!Number.isFinite(now)||dates.some(t=>t>now+300_000))return {kind:'clock',label:'Dates incohérentes : état à vérifier'};
 if(row.inProgress)return {kind:'running',label:'Passage en cours'};
 if(row.pending||row.lastRunStatus==='partial')return {kind:'pending',label:'Passage incomplet : reprise en attente'};
 if(row.counts.failed_count>0)return {kind:'failed',label:'Des éléments n’ont pas pu être collectés'};
 if(row.lastRunStatus==='failed'||row.error&&row.error!=='drive_text_too_large')return {kind:'failed',label:'Dernier passage en échec'};
 if(!row.completeAt)return {kind:'waiting',label:'Aucun passage complet enregistré'};
 if(now-Date.parse(row.completeAt)>900_000)return {kind:'late',label:'Contrôle en retard : actualisation à vérifier'};
 if(row.lastRunStatus!=='success')return {kind:'waiting',label:'Dernier état à vérifier'};
 if(!row.coverageKnown)return {kind:'unknown',label:'Passage terminé · couverture historique non précisée'};
 return {kind:'current',label:row.counts.limited_count>0||row.error==='drive_text_too_large'?'Passage terminé · lecture de certains documents limitée':'Dernier passage terminé'};
}
export function connectorIncident(code){
 if(!code)return null;
 if(code==='drive_text_too_large')return 'Un document dépasse la taille lisible. Ses informations sont conservées ; son texte reste indisponible.';
 if(code==='drive_search_incomplete')return 'Google signale une recherche incomplète. La fenêtre reste à reprendre.';
 if(/oauth|token_refresh/.test(code))return 'La connexion Google doit être vérifiée avant la prochaine synchronisation.';
 if(code==='google_chat_space_not_configured')return 'L’espace Google Chat à lire doit être configuré.';
 return 'La source n’a pas pu terminer sa lecture. Les éléments déjà enregistrés sont conservés.';
}
