export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SAMPLE_STATUSES=['PLANNED','SENT','RECEIVED','FEEDBACK','WON','LOST','CANCELLED'];
const instant=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(x)&&Number.isFinite(Date.parse(x));
export function validateSampleMutation(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['request_id','action','sample_id','expected_version','payload'].includes(k))||
  !UUID.test(body.request_id||'')||!['create','edit','move'].includes(body.action))throw Error('invalid_request');
 if(body.action!=='create'&&(!UUID.test(body.sample_id||'')||!instant(body.expected_version)))throw Error('invalid_version');
 if(body.action==='create'&&(body.sample_id!=null||body.expected_version!=null))throw Error('invalid_request');
 const p=body.payload;
 if(!p||typeof p!=='object'||Array.isArray(p))throw Error('invalid_payload');
 const allowed=body.action==='move'?['status']:['products','goal','notes','tracking','follow_up_at',...(body.action==='create'?['client_id']:[])];
 if(Object.keys(p).some(k=>!allowed.includes(k))||!Object.keys(p).length)throw Error('invalid_payload');
 if(body.action==='create'&&!UUID.test(p.client_id||''))throw Error('invalid_client');
 if(body.action==='move'&&!SAMPLE_STATUSES.includes(p.status))throw Error('invalid_status');
 if(body.action==='create'&&(typeof p.products!=='string'||!p.products.trim()))throw Error('invalid_products');
 for(const [k,max]of [['products',2000],['goal',1000],['notes',5000],['tracking',500]]){
  if(k in p&&(typeof p[k]!=='string'||p[k].length>max||k==='products'&&!p[k].trim()))throw Error('invalid_'+k);
 }
 if('follow_up_at'in p&&p.follow_up_at!==null&&!instant(p.follow_up_at))throw Error('invalid_follow_up');
 return {p_request_id:body.request_id,p_action:body.action,p_sample_id:body.sample_id??null,p_expected_version:body.expected_version??null,p_payload:p};
}
