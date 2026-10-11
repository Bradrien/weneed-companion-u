import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.58.0";
import {validUuid,validChat,cursor,wavDuration} from './core.mjs';
const SOURCE='whatsapp_business_ios_2026_10_08';
const LIMIT=8_000_000;
const hex=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
const decode=(s:string)=>{if(typeof s!=='string'||s.length>LIMIT||!/^[A-Za-z0-9+/]*={0,2}$/.test(s))throw Error('invalid_audio');return Uint8Array.from(atob(s),c=>c.charCodeAt(0));};
function checked(r:any){if(r.error)throw Error('database_unavailable');return r.data;}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin');const headers:any={'cache-control':'no-store','vary':'Origin','access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'authorization,apikey,content-type'};
 if(origin==='https://bradrien.github.io')headers['access-control-allow-origin']=origin;
 const reply=(body:any,status=200)=>Response.json(body,{status,headers});
 if(origin&&origin!=='https://bradrien.github.io')return reply({ok:false,error:'origin_not_allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(!['GET','POST'].includes(req.method))return reply({ok:false,error:'method_not_allowed'},405);
 try{
  const jwt=req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if(!jwt)return reply({ok:false,error:'missing_user_token'},401);
  const url=Deno.env.get('SUPABASE_URL')!,keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
  const sb=createClient(url,keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const auth=await sb.auth.getUser(jwt);const user=auth.data.user;
  if(auth.error||!user?.email_confirmed_at||!user.email||user.is_anonymous)return reply({ok:false,error:'invalid_session'},401);
  const access=checked(await sb.from('app_access_users').select('role,is_active').eq('email',user.email.toLowerCase()).maybeSingle());
  if(access?.role!=='owner'||!access.is_active)return reply({ok:false,error:'owner_only'},403);
  const endpoint=new URL(req.url),sp=endpoint.searchParams;
  let input:any={};
  if(req.method==='POST'){
   if(Number(req.headers.get('content-length')||0)>LIMIT)return reply({ok:false,error:'request_too_large'},413);
   const raw=await req.text();if(new TextEncoder().encode(raw).length>LIMIT)return reply({ok:false,error:'request_too_large'},413);
   try{input=JSON.parse(raw)}catch{return reply({ok:false,error:'invalid_json'},400)}
  }
  const action=req.method==='GET'?(sp.get('action')||'summary'):input.action;
  if(action==='summary'){
   return reply({ok:true,...checked(await sb.rpc('whatsapp_archive_summary_v2'))});
  }
  if(action==='conversations'){
   const offset=Number(sp.get('offset')||0);
   const limit=Number(sp.get('limit')||500); // Previous previews received up to 500 conversations in one response.
   if(!Number.isSafeInteger(offset)||offset<0||offset>50000)return reply({ok:false,error:'invalid_offset'},400);
   if(!Number.isSafeInteger(limit)||limit<1||limit>500)return reply({ok:false,error:'invalid_limit'},400);
   if(sp.has('client_id')&&!validUuid(sp.get('client_id')))return reply({ok:false,error:'invalid_client'},400);
   const page=checked(await sb.rpc('whatsapp_archive_conversations_page',{p_client_id:sp.get('client_id')||null,p_offset:offset,p_limit:limit}));
   const clients=checked(await sb.from('clients').select('id,canonical_name').order('canonical_name').limit(1000));
   return reply({ok:true,...page,clients});
  }
  if(action==='messages'){
   const client=sp.get('client_id'),batch=sp.get('batch_id'),chat=sp.get('chat_pk'),before=cursor(sp.get('cursor'));
   if((client&&!validUuid(client))||(!client&&(!validUuid(batch)||!validChat(chat)))||before===false)return reply({ok:false,error:'invalid_query'},400);
   const rows=checked(await sb.rpc('whatsapp_archive_messages',{p_client_id:client||null,p_batch_id:batch||null,p_chat_pk:chat?Number(chat):null,p_query:(sp.get('q')||'').slice(0,120),p_before_at:before?.at||null,p_before_pk:before?.pk||null}));
   const messages=rows.slice(0,60),last=messages.at(-1);
   return reply({ok:true,messages,next_cursor:rows.length>60?JSON.stringify({at:last.occurred_at,pk:last.local_message_pk}):null});
  }
  if(action==='audio'){
   const id=sp.get('audio_id');if(!validUuid(id))return reply({ok:false,error:'invalid_audio'},400);
   const a=checked(await sb.from('whatsapp_import_audio_assets').select('staged_message_id,storage_bucket,storage_path,archive_status').eq('id',id!).maybeSingle());
   if(!a||a.archive_status!=='verified')return reply({ok:false,error:'audio_unavailable'},404);
   const m=checked(await sb.from('whatsapp_import_staging').select('batch_id,chat_pk').eq('id',a.staged_message_id).single());
   const c=checked(await sb.from('whatsapp_archive_conversations').select('chat_pk').eq('batch_id',m.batch_id).eq('chat_pk',m.chat_pk).maybeSingle());
   const excluded=checked(await sb.from('whatsapp_import_exclusions').select('chat_pk').eq('source_key',SOURCE).eq('chat_pk',m.chat_pk).maybeSingle());
   if(!c||excluded)return reply({ok:false,error:'audio_unavailable'},404);
   const signed=checked(await sb.storage.from(a.storage_bucket).createSignedUrl(a.storage_path,900));
   return reply({ok:true,url:signed.signedUrl,expires_in:900});
  }
  if(action==='link'&&req.method==='POST'){
   if(!validUuid(input.batch_id)||!validChat(input.chat_pk)||!validUuid(input.client_id))return reply({ok:false,error:'invalid_link'},400);
   const client=checked(await sb.from('clients').select('id').eq('id',input.client_id).maybeSingle());
   if(!client)return reply({ok:false,error:'client_not_found'},404);
   const c=checked(await sb.from('whatsapp_archive_conversations').select('client_id').eq('batch_id',input.batch_id).eq('chat_pk',input.chat_pk).maybeSingle());
   if(!c||c.client_id)return reply({ok:false,error:'conversation_already_linked'},409);
   const excluded=checked(await sb.from('whatsapp_import_exclusions').select('chat_pk').eq('source_key',SOURCE).eq('chat_pk',input.chat_pk).maybeSingle());
   if(excluded)return reply({ok:false,error:'excluded_conversation'},403);
   const updated=checked(await sb.from('whatsapp_archive_conversations').update({client_id:client.id,link_state:'manual',linked_by:user.id,link_evidence:{kind:'owner_selection',at:new Date().toISOString()}}).eq('batch_id',input.batch_id).eq('chat_pk',input.chat_pk).is('client_id',null).select('chat_pk'));
   if(updated.length!==1)return reply({ok:false,error:'conversation_already_linked'},409);
   return reply({ok:true});
  }
  if(['register_audio','upload','assets'].includes(action)){
   if(!validUuid(input.batch_id))return reply({ok:false,error:'invalid_batch'},400);
   const batch=checked(await sb.from('whatsapp_import_batches').select('source_key,status').eq('id',input.batch_id).maybeSingle());
   if(!batch||batch.source_key!==SOURCE||!['under_review','ready_for_manual_import'].includes(batch.status))return reply({ok:false,error:'batch_not_ready'},409);
   if(action==='register_audio'){
    const r=checked(await sb.rpc('whatsapp_import_register_audio',{p_batch_id:input.batch_id,p_assets:input.assets}));return reply(r,r.ok?200:409);
   }
   if(action==='assets'){
    const offset=Number(input.offset||0);if(!Number.isSafeInteger(offset)||offset<0)return reply({ok:false,error:'invalid_offset'},400);
    const rows=checked(await sb.from('whatsapp_import_audio_assets').select('id,source_filename,original_sha256,expected_byte_size,archive_status,transcription_status,metadata,whatsapp_import_staging!inner(batch_id)').eq('whatsapp_import_staging.batch_id',input.batch_id).order('source_filename').range(offset,offset+499));return reply({ok:true,assets:rows});
   }
   if(!Array.isArray(input.files)||!input.files.length||input.files.length>20||input.files.some((x:any)=>!validUuid(x.id))||new Set(input.files.map((x:any)=>x.id)).size!==input.files.length)return reply({ok:false,error:'invalid_audio_chunk'},400);
   const assets=checked(await sb.from('whatsapp_import_audio_assets').select('id,original_sha256,expected_byte_size,storage_bucket,storage_path,archive_status,whatsapp_import_staging!inner(batch_id)').eq('whatsapp_import_staging.batch_id',input.batch_id).in('id',input.files.map((x:any)=>x.id)));
   const validated=[];
   for(const file of input.files){const a=assets.find((x:any)=>x.id===file.id);if(!a)return reply({ok:false,error:'audio_not_in_batch'},400);const bytes=decode(file.base64);
    if(bytes.length!==a.expected_byte_size||String.fromCharCode(...bytes.slice(0,4))!=='OggS'||await hex(bytes)!==a.original_sha256)return reply({ok:false,error:'audio_hash_mismatch'},409);
    validated.push({a,bytes});
   }
   // Bound storage work and reuse immutable objects on a resumed upload.
   let verified=0;
   for(let start=0;start<validated.length;start+=4)await Promise.all(validated.slice(start,start+4).map(async({a,bytes})=>{
    if(a.archive_status!=='verified'){
     const uploaded=await sb.storage.from(a.storage_bucket).upload(a.storage_path,bytes,{contentType:'audio/ogg',upsert:false});
     if(uploaded.error){const existing=checked(await sb.storage.from(a.storage_bucket).download(a.storage_path));if(await hex(new Uint8Array(await existing.arrayBuffer()))!==a.original_sha256)throw Error('stored_audio_hash_mismatch');}
     checked(await sb.from('whatsapp_import_audio_assets').update({archive_status:'verified',archived_at:new Date().toISOString()}).eq('id',a.id));
    }verified++;
   }));
   return reply({ok:true,verified});
  }
  if(action==='pilot_jobs'){
   const jobs=checked(await sb.from('whatsapp_archive_transcription_jobs').select('audio_id,status').order('audio_id').limit(100));return reply({ok:true,jobs});
  }
  if(action==='transcribe'&&req.method==='POST'){
   if(!validUuid(input.audio_id))return reply({ok:false,error:'invalid_audio'},400);
   const apiKey=Deno.env.get('OPENAI_API_KEY');if(!apiKey)return reply({ok:false,error:'transcription_not_configured'},503);
   const a=checked(await sb.from('whatsapp_import_audio_assets').select('metadata').eq('id',input.audio_id).maybeSingle());
   if(!a)return reply({ok:false,error:'audio_not_found'},404);
   const wav=decode(input.wav_base64),duration=wavDuration(wav),expected=Number(a.metadata.duration_seconds);
   if(!duration||!Number.isFinite(expected)||Math.abs(duration-expected)>Math.max(0.25,expected*0.02))return reply({ok:false,error:'wav_duration_mismatch'},400);
   const reservation=checked(await sb.rpc('whatsapp_archive_reserve_transcription',{p_audio_id:input.audio_id}));
   if(!reservation.ok)return reply(reservation,409);
   let transcript='',usage=null,errorCode='';
   try{
    const form=new FormData();form.append('model',reservation.model);form.append('file',new Blob([wav],{type:'audio/wav'}),'archive.wav');
    const res=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{authorization:'Bearer '+apiKey},body:form,signal:AbortSignal.timeout(65000)});
    if(!res.ok)throw Error('transcription_http_'+res.status);
    const body=await res.json();transcript=typeof body.text==='string'?body.text.trim():'';usage=body.usage||null;
    if(!transcript||transcript.length>100000)throw Error('empty_or_invalid_transcript');
   }catch(e){errorCode=e instanceof Error&&/^transcription_http_\d+$|^empty_or_invalid_transcript$/.test(e.message)?e.message:'transcription_failed';}
   if(errorCode){
    checked(await sb.from('whatsapp_import_audio_assets').update({transcription_status:'error',transcription_error:errorCode}).eq('id',input.audio_id));
    checked(await sb.from('whatsapp_archive_transcription_jobs').update({status:'error',finished_at:new Date().toISOString(),error_code:errorCode}).eq('audio_id',input.audio_id));
    return reply({ok:false,error:errorCode,reservation_consumed:true},502);
   }
   checked(await sb.from('whatsapp_import_audio_assets').update({transcription_status:'done',transcript_text:transcript,transcription_model:reservation.model,transcription_error:null,transcribed_at:new Date().toISOString()}).eq('id',input.audio_id));
   checked(await sb.from('whatsapp_archive_transcription_jobs').update({status:'done',finished_at:new Date().toISOString(),usage}).eq('audio_id',input.audio_id));
   return reply({ok:true,audio_id:input.audio_id,transcribed:true});
  }
  return reply({ok:false,error:'unknown_action'},400);
 }catch(e){const code=e instanceof Error&&['invalid_audio','stored_audio_hash_mismatch'].includes(e.message)?e.message:'archive_unavailable';console.error('archive_error',code);return reply({ok:false,error:code},500);}
});
