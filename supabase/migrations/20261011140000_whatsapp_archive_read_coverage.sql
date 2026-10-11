-- Read approved archives through the owner Edge Function. Existing exclusions apply to every count and page.
begin;
create or replace function public.whatsapp_archive_summary_v2()
returns jsonb language sql stable security invoker set search_path='' as $$
 with conversations as (
  select c.* from public.whatsapp_archive_conversations c
  join public.whatsapp_import_batches b on b.id=c.batch_id
  where b.source_key='whatsapp_business_ios_2026_10_08'
   and not exists(select 1 from public.whatsapp_import_exclusions x where x.source_key=b.source_key and x.chat_pk=c.chat_pk)
 ),audio as (
  select a.* from public.whatsapp_import_audio_assets a
  join public.whatsapp_import_staging s on s.id=a.staged_message_id
  join conversations c on c.batch_id=s.batch_id and c.chat_pk=s.chat_pk
 ),pilots as (
  select p.authorized_at,p.hard_limit_usd,p.reserve_limit_usd,p.reserved_usd,
   count(j.audio_id) as jobs,
   count(j.audio_id) filter(where j.status='pending') as pending,
   count(j.audio_id) filter(where j.status='processing') as processing,
   count(j.audio_id) filter(where j.status='done') as done,
   count(j.audio_id) filter(where j.status='error') as errors
  from public.whatsapp_archive_pilots p
  join public.whatsapp_import_batches b on b.id=p.batch_id
  left join public.whatsapp_archive_transcription_jobs j on j.pilot_id=p.id and j.audio_id in(select id from audio)
  where b.source_key='whatsapp_business_ios_2026_10_08'
  group by p.id
 )
 select jsonb_build_object('version','whatsapp_archive_summary_v2','scope','approved_archives_only_exclusions_applied',
  'read_at',now(), 'conversations',count(*),'linked_conversations',count(client_id),
  'needs_review',count(*) filter(where client_id is null),'messages',coalesce(sum(message_count),0),
  'audio',coalesce(sum(audio_count),0),'first_message_at',min(first_message_at),'last_message_at',max(last_message_at),
  'audio_available',(select count(*) from audio where archive_status='verified'),
  'transcribed',(select count(*) from audio where archive_status='verified' and transcription_status='done'),
  'pilots',(select coalesce(jsonb_agg(to_jsonb(p) order by authorized_at desc),'[]'::jsonb) from pilots p))
 from conversations;
$$;

create or replace function public.whatsapp_archive_conversations_page(p_client_id uuid default null,p_offset integer default 0,p_limit integer default 100)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_offset is null or p_offset<0 or p_offset>50000 then raise exception 'invalid_archive_offset';end if;
 if p_limit is null or p_limit<1 or p_limit>500 then raise exception 'invalid_archive_limit';end if;
 with filtered as (
  select c.batch_id,c.chat_pk,c.client_id,c.display_name,c.phone_e164,c.link_state,c.message_count,c.audio_count,c.first_message_at,c.last_message_at
  from public.whatsapp_archive_conversations c join public.whatsapp_import_batches b on b.id=c.batch_id
  where b.source_key='whatsapp_business_ios_2026_10_08' and(p_client_id is null or c.client_id=p_client_id)
   and not exists(select 1 from public.whatsapp_import_exclusions x where x.source_key=b.source_key and x.chat_pk=c.chat_pk)
 ),page as (
  select * from filtered order by last_message_at desc,batch_id,chat_pk limit p_limit offset p_offset
 )
 select jsonb_build_object('version','whatsapp_archive_conversations_v2','scope','approved_archives_only_exclusions_applied',
  'conversations',(select coalesce(jsonb_agg(to_jsonb(p) order by last_message_at desc,batch_id,chat_pk),'[]'::jsonb) from page p),
  'total',count(*),'offset',p_offset,'limit',p_limit,'next_offset',case when p_offset+p_limit<count(*) then p_offset+p_limit else null end)
 into result from filtered;
 return result;
end $$;
revoke all on function public.whatsapp_archive_summary_v2(),public.whatsapp_archive_conversations_page(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.whatsapp_archive_summary_v2(),public.whatsapp_archive_conversations_page(uuid,integer,integer) to service_role;
commit;
