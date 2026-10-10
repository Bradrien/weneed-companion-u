export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validUuid(v){return typeof v==='string'&&UUID.test(v)}
export function validChat(v){return Number.isSafeInteger(Number(v))&&Number(v)>0}
export function cursor(v){
 if(!v)return null;
 try{const r=JSON.parse(v);if(!r||!Number.isSafeInteger(r.pk)||r.pk<=0||typeof r.at!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(r.at)||!Number.isFinite(Date.parse(r.at)))return false;return r}catch{return false}
}
export function wavDuration(bytes){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const tag=(o)=>String.fromCharCode(...bytes.slice(o,o+4));
 if(bytes.length<44||tag(0)!=='RIFF'||tag(8)!=='WAVE'||v.getUint32(4,true)+8!==bytes.length)return null;
 let rate=0,data=0;
 for(let at=12;at+8<=bytes.length;){const size=v.getUint32(at+4,true),end=at+8+size;if(end>bytes.length)return null;
  if(tag(at)==='fmt '){if(size<16||v.getUint16(at+8,true)!==1||v.getUint16(at+10,true)!==1||v.getUint32(at+12,true)!==16000||v.getUint16(at+22,true)!==16)return null;rate=v.getUint32(at+16,true);if(rate!==32000)return null;}
  if(tag(at)==='data')data+=size;at=end+(size%2);
 }
 return rate&&data?data/rate:null;
}
