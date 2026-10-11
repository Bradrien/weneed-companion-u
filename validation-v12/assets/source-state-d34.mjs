const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
export function sourceTime(value){
 if(value===null||value===undefined)return null;
 if(typeof value!=='string'||!ISO.test(value)||!Number.isFinite(Date.parse(value)))throw Error('invalid_source_time');
 const [year,month,day]=value.slice(0,10).split('-').map(Number);
 const [hour,minute,second]=value.slice(11,19).split(':').map(Number);
 if(month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate()||hour>23||minute>59||second>59)throw Error('invalid_source_time');
 return value;
}
export function sourceCount(value,max=1_000_000){
 if(!Number.isSafeInteger(value)||value<0||value>max)throw Error('invalid_source_count');
 return value;
}
export function sourceText(value,max,{empty=false}={}){
 if(typeof value!=='string'||value.length>max||(!empty&&!value.trim()))throw Error('invalid_source_text');
 return value;
}
