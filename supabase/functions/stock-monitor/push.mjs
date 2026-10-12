import webpush from 'npm:web-push@3.6.7';
import {notificationBody} from './watch.mjs';
export function validSubscription(value){
 try{
  const u=new URL(value.endpoint);
  return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&
   ['web.push.apple.com','fcm.googleapis.com','updates.push.services.mozilla.com'].includes(u.hostname)&&
   value.endpoint.length<=2048&&/^[A-Za-z0-9_-]{87}$/.test(value.keys?.p256dh)&&/^[A-Za-z0-9_-]{22}$/.test(value.keys?.auth);
 }catch{return false}
}
export async function vapid(sb){
 const generated=webpush.generateVAPIDKeys();
 const {data,error}=await sb.rpc('stock_push_vapid',{p_public:generated.publicKey,p_private:generated.privateKey});
 if(error||!data?.publicKey||!data?.privateKey)throw Error('push_configuration_failed');
 return data;
}
export async function sendPush(subscription,payload,keys){
 if(!validSubscription(subscription))return 'expired';
 try{
  const request=webpush.generateRequestDetails(subscription,JSON.stringify(payload),{
   TTL:1800,urgency:'normal',vapidDetails:{subject:'https://bradrien.github.io/weneed-companion-u/',publicKey:keys.publicKey,privateKey:keys.privateKey}
  });
  const response=await fetch(request.endpoint,{method:request.method,headers:request.headers,body:request.body,
   signal:AbortSignal.timeout(12000),redirect:'error'});
  if(response.status===404||response.status===410)return 'expired';
  return response.ok?'sent':'send_failed';
 }catch{return 'send_failed'}
}
let encryptionChecked=false;
export function checkEncryption(keys){
 const recipient=webpush.generateVAPIDKeys();
 const details=webpush.generateRequestDetails({endpoint:'https://web.push.apple.com/encryption-fixture',keys:{p256dh:recipient.publicKey,auth:'AAAAAAAAAAAAAAAAAAAAAA'}},'fixture',{TTL:60,vapidDetails:{subject:'https://bradrien.github.io/weneed-companion-u/',publicKey:keys.publicKey,privateKey:keys.privateKey}});
 if(!details.body?.length||!details.headers?.Authorization&&!details.headers?.authorization)throw Error('push_encryption_unavailable');
 return true;
}
export async function dispatch(sb){
 const keys=await vapid(sb);
 if(!encryptionChecked){checkEncryption(keys);encryptionChecked=true}
 const {data:items,error}=await sb.rpc('stock_push_claim');if(error)throw Error('push_claim_failed');
 const groups=new Map();
 for(const item of items||[]){const id=item.device_id+'|'+item.company+'|'+item.scan_id;
  if(!groups.has(id))groups.set(id,[]);groups.get(id).push(item);
 }
 let sent=0,failed=0;
 // Never print the browser subscription or encryption keys.
 for(const rows of groups.values()){
  const first=rows[0];
  const result=await sendPush({endpoint:first.endpoint,keys:first.keys},{title:`Stocks ${first.company}`,
   body:notificationBody(rows),tag:'stock-'+first.company},keys);
  const {error:saveError}=await sb.rpc('stock_push_finish',{p_lease:first.lease,p_device:first.device_id,p_alerts:rows.map(r=>r.alert_id),p_result:result});
  if(result==='sent'&&!saveError)sent+=rows.length;else failed+=rows.length;
 }
 return {sent,failed};
}
