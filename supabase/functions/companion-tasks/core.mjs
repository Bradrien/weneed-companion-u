export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actions=new Set(['create','edit','complete','cancel','approve','merge','resync']);
export function validateMutation(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||!UUID.test(body.request_id||'')||!actions.has(body.action))throw Error('invalid_request');
 if(body.action!=='create'&&(!UUID.test(body.task_id||'')||typeof body.expected_version!=='string'||!Number.isFinite(Date.parse(body.expected_version))))throw Error('invalid_version');
 const p=body.payload??{};
 if(!p||typeof p!=='object'||Array.isArray(p))throw Error('invalid_payload');
 const allowed=new Set(body.action==='merge'?['target_id','target_version']:['create','edit'].includes(body.action)?['title','description','due_at','client_id']:[]);
 if(Object.keys(p).some(k=>!allowed.has(k)))throw Error('invalid_payload');
 if(body.action==='create'&&(typeof p.title!=='string'||!p.title.trim()))throw Error('invalid_title');
 if('title'in p&&(typeof p.title!=='string'||!p.title.trim()||p.title.trim().length>240))throw Error('invalid_title');
 if('description'in p&&p.description!==null&&(typeof p.description!=='string'||p.description.length>5000))throw Error('invalid_description');
 if('client_id'in p&&p.client_id!==null&&!UUID.test(p.client_id))throw Error('invalid_client_id');
 if('due_at'in p&&p.due_at!==null&&(typeof p.due_at!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(p.due_at)||!Number.isFinite(Date.parse(p.due_at))))throw Error('invalid_due_at');
 if(body.action==='merge'&&(!UUID.test(p.target_id||'')||p.target_id===body.task_id||!Number.isFinite(Date.parse(p.target_version))))throw Error('invalid_merge');
 return {p_request_id:body.request_id,p_action:body.action,p_task_id:body.task_id??null,p_expected_version:body.expected_version??null,p_payload:p};
}
