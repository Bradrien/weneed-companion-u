import {cents} from './commission-integrity-d24.mjs';
import {sourceTime,sourceText} from './source-state-d34.mjs';
import {validClientId} from './clients-model-d14.mjs';
export const COMMISSION_RULE_STATUS=Object.freeze({
 payable:false,unitsVerified:false,historicalCostsVerified:false,spiffEnabled:false,
 creditNotesVerified:false,paymentVerified:false,
 trigger:'confirmed_order',triggerVerified:true,returnsPolicy:'subtract_return_commission',returnsPolicyVerified:true,
 explanation:'Déclenchement confirmé : commande confirmée. Retours : leur commission est retirée du total final. Coûts historiques, SPIFF et exhaustivité des déductions restent à vérifier.'
});
export function normalizeReturnDeductions(body,month){
 const d=body?.data;
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||body?.ok!==true||!d||d.version!=='commission_returns_v1'||
  d.month!==month||d.scope!=='recorded_deductions_only'||!Array.isArray(d.deductions)||d.deductions.length>500||
  d.total!==d.deductions.length||!sourceTime(d.read_at))throw Error('return_deductions_unavailable');
 const ids=new Set(),sources=new Set();
 const deductions=d.deductions.map(r=>{
  if(!validClientId(r.id)||ids.has(r.id)||r.month!==month||!['GTA','TR'].includes(r.company)||
   r.currency!=='EUR'||r.kind!=='excel_explicit_return'||!Number.isSafeInteger(r.commission_cents)||
   r.commission_cents<=0||r.commission_cents>100000000||
   !/^[a-f0-9]{64}$/.test(r.source_fingerprint)||
   !/^[A-Z]{1,3}[1-9][0-9]{0,4}$/.test(r.amount_cell)||
   !/^[A-Z]{1,3}[1-9][0-9]{0,4}$/.test(r.net_formula_cell)||!sourceTime(r.verified_at))
   throw Error('return_deductions_unavailable');
  const key=JSON.stringify([r.source_fingerprint,r.source_sheet,r.amount_cell]);
  if(sources.has(key))throw Error('return_deductions_unavailable');ids.add(r.id);sources.add(key);
  return {...r,reference:sourceText(r.reference,120),source_file:sourceText(r.source_file,500),
   source_sheet:sourceText(r.source_sheet,120),net_formula:sourceText(r.net_formula,1000),
   description:r.description==null?'':sourceText(r.description,1000,{empty:true})};
 });
 return {month,readAt:d.read_at,deductions,scope:d.scope};
}
export function commissionAfterReturns(confirmed,source,{month,company='all',query='',fresh=false}={}){
 if(!source||source.month!==month||!confirmed||!['all','GTA','TR'].includes(company))
  return {available:false,reason:'source_unavailable'};
 const rows=source.deductions.filter(r=>company==='all'||r.company===company);
 let deductionCents=0;
 for(const r of rows){deductionCents+=r.commission_cents;if(!Number.isSafeInteger(deductionCents))throw Error('invalid_return_total')}
 const base={rows,deductionCents,complete:false};
 if(!fresh)return {...base,available:false,reason:'source_not_rechecked'};
 if(query.trim())return {...base,available:false,reason:'search_scope'};
 const grossCents=confirmed.count===0?0:cents(confirmed.forecast);
 if(grossCents===null)return {...base,available:false,reason:'gross_unavailable'};
 const netCents=grossCents-deductionCents;
 if(!Number.isSafeInteger(netCents))throw Error('invalid_return_total');
 return {...base,available:true,grossCents,netCents,partial:confirmed.unavailableCount>0||confirmed.partialCount>0};
}
