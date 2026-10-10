-- Owner archive access is mediated by an authenticated Edge Function.
create table public.whatsapp_archive_conversations (
 batch_id uuid not null references public.whatsapp_import_batches(id),
 chat_pk bigint not null, client_id uuid references public.clients(id),
 display_name text not null, chat_jid text not null, phone_e164 text,
 link_state text not null default 'needs_review' check(link_state in ('needs_review','verified','manual')),
 link_evidence jsonb not null default '{}'::jsonb,
 message_count integer not null, audio_count integer not null,
 first_message_at timestamptz not null, last_message_at timestamptz not null,
 activated_at timestamptz not null default now(), linked_by uuid,
 primary key(batch_id,chat_pk)
);
alter table public.whatsapp_archive_conversations enable row level security;
revoke all on public.whatsapp_archive_conversations from public,anon,authenticated;
grant all on public.whatsapp_archive_conversations to service_role;
create index whatsapp_archive_client_idx on public.whatsapp_archive_conversations(client_id,last_message_at desc);
create index whatsapp_archive_messages_idx on public.whatsapp_import_staging(batch_id,chat_pk,occurred_at desc,local_message_pk desc);

create table public.whatsapp_archive_pilots (
 id uuid primary key default gen_random_uuid(), batch_id uuid not null references public.whatsapp_import_batches(id),
 authorized_by uuid not null, authorized_at timestamptz not null default now(),
 hard_limit_usd numeric not null check(hard_limit_usd > 0 and hard_limit_usd <= 1),
 reserve_limit_usd numeric not null check(reserve_limit_usd > 0 and reserve_limit_usd <= 0.60),
 reserved_usd numeric not null default 0 check(reserved_usd >= 0 and reserved_usd <= reserve_limit_usd),
 model text not null default 'gpt-transcribe' check(model='gpt-transcribe'),
 notes text not null, unique(batch_id)
);
create table public.whatsapp_archive_transcription_jobs (
 audio_id uuid primary key references public.whatsapp_import_audio_assets(id),
 pilot_id uuid not null references public.whatsapp_archive_pilots(id),
 status text not null default 'pending' check(status in ('pending','processing','done','error')),
 reserved_usd numeric not null default 0, started_at timestamptz, finished_at timestamptz,
 error_code text, usage jsonb
);
alter table public.whatsapp_archive_pilots enable row level security;
alter table public.whatsapp_archive_transcription_jobs enable row level security;
create index whatsapp_archive_jobs_pilot_idx on public.whatsapp_archive_transcription_jobs(pilot_id);
revoke all on public.whatsapp_archive_pilots,public.whatsapp_archive_transcription_jobs from public,anon,authenticated;
grant all on public.whatsapp_archive_pilots,public.whatsapp_archive_transcription_jobs to service_role;

create or replace function public.whatsapp_archive_messages(p_client_id uuid default null,p_batch_id uuid default null,p_chat_pk bigint default null,p_query text default '',p_before_at timestamptz default null,p_before_pk bigint default null)
returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(r) order by occurred_at desc,local_message_pk desc),'[]'::jsonb) from (
 select s.id,s.batch_id,s.chat_pk,s.local_message_pk,s.occurred_at,s.is_outbound,s.text_body,s.contact_name,
 c.display_name,c.client_id,s.dedupe_status,
 a.id as audio_id,a.archive_status,a.transcription_status,a.transcript_text,(a.metadata->>'duration_seconds')::numeric as duration_seconds
 from public.whatsapp_import_staging s
 join public.whatsapp_archive_conversations c on c.batch_id=s.batch_id and c.chat_pk=s.chat_pk
 left join public.whatsapp_import_audio_assets a on a.staged_message_id=s.id
 where ((p_client_id is not null and c.client_id=p_client_id) or (p_client_id is null and c.batch_id=p_batch_id and c.chat_pk=p_chat_pk))
 and not exists(select 1 from public.whatsapp_import_exclusions x join public.whatsapp_import_batches b on b.source_key=x.source_key where b.id=s.batch_id and x.chat_pk=s.chat_pk)
 and (coalesce(p_query,'')='' or strpos(lower(coalesce(s.text_body,'')||' '||coalesce(a.transcript_text,'')),lower(left(p_query,120)))>0)
 and (p_before_at is null or (s.occurred_at,s.local_message_pk)<(p_before_at,p_before_pk))
 order by s.occurred_at desc,s.local_message_pk desc limit 61
 ) r;
$$;
revoke all on function public.whatsapp_archive_messages(uuid,uuid,bigint,text,timestamptz,bigint) from public,anon,authenticated;
grant execute on function public.whatsapp_archive_messages(uuid,uuid,bigint,text,timestamptz,bigint) to service_role;

create or replace function public.whatsapp_archive_reserve_transcription(p_audio_id uuid)
returns jsonb language plpgsql set search_path='' as $$
declare j public.whatsapp_archive_transcription_jobs%rowtype;p public.whatsapp_archive_pilots%rowtype;a public.whatsapp_import_audio_assets%rowtype;cost numeric;
begin
 select * into j from public.whatsapp_archive_transcription_jobs where audio_id=p_audio_id for update;
 if not found or j.status<>'pending' then return jsonb_build_object('ok',false,'error','job_not_pending');end if;
 select * into p from public.whatsapp_archive_pilots where id=j.pilot_id for update;
 select * into a from public.whatsapp_import_audio_assets where id=p_audio_id for update;
 if a.archive_status<>'verified' or a.transcription_status='done' or not exists(
  select 1 from public.whatsapp_import_staging s join public.whatsapp_archive_conversations c on c.batch_id=s.batch_id and c.chat_pk=s.chat_pk
  where s.id=a.staged_message_id and s.batch_id=p.batch_id and c.client_id is not null
  and not exists(select 1 from public.whatsapp_import_exclusions x join public.whatsapp_import_batches b on b.source_key=x.source_key where b.id=s.batch_id and x.chat_pk=s.chat_pk)
 ) then return jsonb_build_object('ok',false,'error','audio_not_ready');end if;
 -- Each request is reserved once, even on failure. No automatic retry.
 cost:=ceil((a.metadata->>'duration_seconds')::numeric/60)*0.0045*2;
 if cost<=0 or p.reserved_usd+cost>p.reserve_limit_usd then return jsonb_build_object('ok',false,'error','pilot_budget_reached');end if;
 update public.whatsapp_archive_pilots set reserved_usd=reserved_usd+cost where id=p.id;
 update public.whatsapp_archive_transcription_jobs set status='processing',reserved_usd=cost,started_at=now() where audio_id=a.id;
 update public.whatsapp_import_audio_assets set transcription_status='processing' where id=a.id;
 return jsonb_build_object('ok',true,'audio_id',a.id,'duration_seconds',a.metadata->'duration_seconds','model',p.model,'reserved_usd',cost);
end $$;
revoke all on function public.whatsapp_archive_reserve_transcription(uuid) from public,anon,authenticated;
grant execute on function public.whatsapp_archive_reserve_transcription(uuid) to service_role;
