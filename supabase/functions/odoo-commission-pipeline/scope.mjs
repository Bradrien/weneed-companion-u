// D28: narrowly scoped, read-only Odoo order windows; no customer data or secrets.
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null;
function parseDay(s){
 if(!day(s))throw Error('invalid_period');
 const value=Date.parse(s+'T00:00:00.000Z');
 if(!Number.isFinite(value)||new Date(value).toISOString().slice(0,10)!==s)throw Error('invalid_period');
 return value;
}
export function monthPeriod(date=new Date()){
 if(!(date instanceof Date)||!Number.isFinite(date.getTime()))throw Error('invalid_period');
 const from=String(date.getUTCFullYear())+'-'+String(date.getUTCMonth()+1).padStart(2,'0')+'-01';
 const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).toISOString().slice(0,10);
 return {from,to:last};
}
export function parseOdooPeriod(url,now=new Date()){
 const params=new URL(url).searchParams;
 if(!params.size)return monthPeriod(now);
 if(params.size!==2||!params.has('from')||!params.has('to'))throw Error('unsupported_query');
 const from=params.get('from'),to=params.get('to');
 const first=parseDay(from),last=parseDay(to);
 if(last<first||last-first>93*86400000)throw Error('invalid_period');
 return {from,to};
}
export function odooPeriodDomain(uid,states,{from,to}){
 if(!Number.isSafeInteger(uid)||uid<1||!Array.isArray(states)||states.some(s=>!['draft','sent','sale','done'].includes(s))||
  !from||!to)throw Error('invalid_period');
 return [['user_id','=',uid],['state','in',states],
  ['date_order','>=',from+' 00:00:00'],['date_order','<=',to+' 23:59:59']];
}
