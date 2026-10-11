-- Owner mutations are transactional and callable only by the authenticated Edge service.
grant usage on schema private to service_role;
create table private.owner_task_actors(actor uuid primary key references auth.users(id),email text not null);
alter table private.owner_task_actors enable row level security;
revoke all on private.owner_task_actors from public,anon,authenticated;
grant select on private.owner_task_actors to service_role;
insert into private.owner_task_actors select u.id,lower(u.email) from auth.users u join public.app_access_users a on lower(u.email)=a.email where a.role='owner' and a.is_active and u.email_confirmed_at is not null;
create table private.owner_task_operations (
 request_id uuid primary key, actor uuid not null references auth.users(id),
 request_hash text not null, result jsonb not null, created_at timestamptz not null default now()
);
alter table private.owner_task_operations enable row level security;
revoke all on private.owner_task_operations from public,anon,authenticated;
grant all on private.owner_task_operations to service_role;

create or replace function public.task_reminder_eligibility(p_task_id uuid)
returns table(eligible boolean,reason text) language sql security invoker set search_path='' as $$
 select reason='eligible',reason from (
  select case
   when t.id is null then 'task_not_found'
   when t.status<>'OPEN' then 'task_not_open'
   when t.is_suggested then 'suggested_task'
   when t.metadata->>'owner_confirmed'='true' and exists (
    select 1 from private.owner_task_actors u join public.app_access_users a on u.email=a.email
    where u.actor::text=t.metadata->>'owner_auth_uid' and a.role='owner' and a.is_active
   ) then 'eligible'
   when coalesce(t.confidence,0)<0.90 then 'confidence_below_0_90'
   when e.id is null then 'missing_source_event'
   when e.occurred_at is null then 'missing_event_time'
   when e.occurred_at<now()-interval '14 days' then 'historical_backfill'
   when coalesce(t.metadata->>'extractor_version','')='commercial_v1' then 'legacy_extractor'
   when not (e.client_id is not null or e.source='google_chat' or (e.source='gmail' and e.sender_identity ~* '@(weneedweed\.eu|trimrocket\.cz|gtaswiss\.com)$')) then 'not_commercially_linked'
   else 'eligible' end reason
  from (select * from public.tasks where id=p_task_id) t
  left join public.events e on e.id=t.source_event_id right join (select 1) anchor on true
 ) reasons;
$$;
revoke all on function public.task_reminder_eligibility(uuid) from public,anon,authenticated;
grant execute on function public.task_reminder_eligibility(uuid) to service_role;

-- Keep explicit owner assignments; automatic resolution remains for extracted tasks.
create or replace function public.trigger_resolve_task_client_from_text()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.client_id is null and coalesce(new.metadata->>'origin','')<>'owner_manual' then
  perform public.resolve_task_client_from_text(new.id);
 end if;
 return new;
end;
$$;
revoke all on function public.trigger_resolve_task_client_from_text() from public,anon,authenticated;
grant execute on function public.trigger_resolve_task_client_from_text() to service_role;

-- Legacy reference-based deduplication must not silently merge owner-created actions.
create or replace function public.set_task_dedupe_key()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.metadata->>'origin'='owner_manual' then new.dedupe_key:='owner:'||new.id::text;
 else new.dedupe_key:=public.compute_task_dedupe_key(new.title,new.client_id,new.source_event_id); end if;
 return new;
end;
$$;
revoke all on function public.set_task_dedupe_key() from public,anon,authenticated;
grant execute on function public.set_task_dedupe_key() to service_role;

create function public.api_owner_tasks_list(p_status text default 'OPEN',p_client_id uuid default null,p_query text default '',p_offset integer default 0)
returns jsonb language sql security invoker set search_path='' as $$
 with selected as (
  select t.id,t.client_id,c.canonical_name as client_name,t.title,t.description,t.due_at,t.status,
   t.is_suggested,t.confidence,t.updated_at,t.created_at,t.completed_at,t.duplicate_of_task_id,
   ro.sync_status as reminder_sync_status,ro.desired_action as reminder_action,ro.synced_at as reminder_synced_at,
   el.eligible as reminder_eligible,el.reason as reminder_reason
  from public.tasks t left join public.clients c on c.id=t.client_id
  left join public.reminder_outbox ro on ro.task_id=t.id
  left join lateral public.task_reminder_eligibility(t.id) el on true
  where t.status<>'SUPERSEDED' and (p_status='ALL' or t.status=p_status)
   and (p_client_id is null or t.client_id=p_client_id)
   and (coalesce(p_query,'')='' or position(lower(p_query) in lower(t.title||' '||coalesce(c.canonical_name,'')))>0)
 ), rows as (
  select * from selected order by is_suggested,due_at asc nulls last,created_at desc,id limit 200 offset greatest(0,least(p_offset,100000))
 ) select jsonb_build_object('tasks',coalesce((select jsonb_agg(to_jsonb(rows)) from rows),'[]'::jsonb),
  'total',(select count(*) from selected),'limit',200,'checked_at',now());
$$;
revoke all on function public.api_owner_tasks_list(text,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.api_owner_tasks_list(text,uuid,text,integer) to service_role;

create function public.api_owner_task_mutate(p_request_id uuid,p_actor uuid,p_action text,p_task_id uuid default null,
 p_expected_version timestamptz default null,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 v_old public.tasks%rowtype; v_target public.tasks%rowtype; v_op private.owner_task_operations%rowtype;
 v_hash text; v_result jsonb; v_id uuid; v_client uuid; v_title text; v_description text; v_due timestamptz;
 v_duplicate uuid; v_norm text;
begin
 if p_request_id is null or not exists(select 1 from private.owner_task_actors u join public.app_access_users a on u.email=a.email
  where u.actor=p_actor and a.role='owner' and a.is_active)
 then return jsonb_build_object('ok',false,'error','owner_only'); end if;
 if p_action not in ('create','edit','complete','cancel','approve','merge','resync') or jsonb_typeof(p_payload)<>'object'
 then return jsonb_build_object('ok',false,'error','invalid_request'); end if;
 v_hash:=encode(extensions.digest(jsonb_build_object('actor',p_actor,'action',p_action,'task',p_task_id,'version',p_expected_version,'payload',p_payload)::text,'sha256'),'hex');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
 select * into v_op from private.owner_task_operations where request_id=p_request_id;
 if found then
  if v_op.actor<>p_actor or v_op.request_hash<>v_hash then return jsonb_build_object('ok',false,'error','idempotency_conflict'); end if;
  return v_op.result;
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('owner-tasks:'||p_actor::text,2));
 if p_action<>'create' then
  -- Lock in a consistent order for two-task merges.
  if p_action='merge' then
   if p_payload->>'target_id' is null or p_payload->>'target_version' is null then return jsonb_build_object('ok',false,'error','invalid_merge'); end if;
   perform 1 from public.tasks where id in (p_task_id,(p_payload->>'target_id')::uuid) order by id for update;
  end if;
  select * into v_old from public.tasks where id=p_task_id for update;
  if not found then return jsonb_build_object('ok',false,'error','task_not_found'); end if;
  if p_expected_version is null or v_old.updated_at<>p_expected_version then return jsonb_build_object('ok',false,'error','task_conflict'); end if;
  if v_old.status='SUPERSEDED' then return jsonb_build_object('ok',false,'error','task_superseded'); end if;
 end if;
 v_id:=coalesce(p_task_id,gen_random_uuid());
 v_title:=case when p_payload?'title' then btrim(p_payload->>'title') else v_old.title end;
 v_description:=case when p_payload?'description' then p_payload->>'description' else v_old.description end;
 v_client:=case when p_payload?'client_id' then (p_payload->>'client_id')::uuid else v_old.client_id end;
 v_due:=case when p_payload?'due_at' then (p_payload->>'due_at')::timestamptz else v_old.due_at end;
 if p_action in ('create','edit') then
  if v_title is null or length(v_title)<1 or length(v_title)>240 or length(coalesce(v_description,''))>5000 then return jsonb_build_object('ok',false,'error','invalid_payload'); end if;
  if v_client is not null and not exists(select 1 from public.clients where id=v_client) then return jsonb_build_object('ok',false,'error','client_not_found'); end if;
  if p_action='create' or v_title is distinct from v_old.title or v_client is distinct from v_old.client_id then
  v_norm:=coalesce(nullif(public.normalize_task_text(v_title),''),lower(btrim(v_title)));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(coalesce(v_client::text,'unscoped')||'|'||v_norm,1));
  select id into v_duplicate from public.tasks where id<>v_id and status='OPEN' and client_id is not distinct from v_client
   and coalesce(nullif(public.normalize_task_text(title),''),lower(btrim(title)))=v_norm order by is_suggested,created_at,id limit 1;
  if v_duplicate is not null then
   if p_action='edit' then return jsonb_build_object('ok',false,'error','task_duplicate','task_id',v_duplicate); end if;
   if exists(select 1 from public.tasks where id=v_duplicate and is_suggested) then
    update public.tasks set is_suggested=false,title=v_title,description=case when p_payload?'description' then v_description else description end,
     due_at=case when p_payload?'due_at' then v_due else due_at end,updated_at=clock_timestamp(),
     metadata=metadata||jsonb_build_object('owner_confirmed',true,'owner_auth_uid',p_actor,'owner_confirmed_at',now()) where id=v_duplicate;
    v_result:=jsonb_build_object('ok',true,'duplicate',false,'existing_suggestion_approved',true,'task_id',v_duplicate);
   else v_result:=jsonb_build_object('ok',true,'duplicate',true,'task_id',v_duplicate); end if;
   insert into private.owner_task_operations values(p_request_id,p_actor,v_hash,v_result,now());
   return v_result;
  end if;
  end if;
 end if;
 if p_action='create' then
  insert into public.tasks(id,client_id,title,description,due_at,status,confidence,is_suggested,metadata)
   values(v_id,v_client,v_title,v_description,v_due,'OPEN',1,false,jsonb_build_object('origin','owner_manual','owner_confirmed',true,'owner_auth_uid',p_actor,'owner_confirmed_at',now()));
 elsif p_action='edit' then
  update public.tasks set client_id=v_client,title=v_title,description=v_description,due_at=v_due,updated_at=clock_timestamp(),
   metadata=case when is_suggested then metadata else metadata||jsonb_build_object('owner_confirmed',true,'owner_auth_uid',p_actor,'owner_confirmed_at',now()) end where id=v_id;
 elsif p_action='resync' then
  update public.reminder_outbox set sync_status='PENDING',last_error=null,bridge_attempt_count=0,bridge_retry_hash=null,
   bridge_next_attempt_at=null,bridge_error_retryable=false,updated_at=clock_timestamp() where task_id=v_id and sync_status='ERROR';
  if not found then return jsonb_build_object('ok',false,'error','invalid_transition'); end if;
  update public.tasks set updated_at=clock_timestamp() where id=v_id;
 elsif p_action='approve' then
  if p_action='approve' and (v_old.status<>'OPEN' or not v_old.is_suggested) then return jsonb_build_object('ok',false,'error','invalid_transition'); end if;
  select id into v_duplicate from public.tasks where id<>v_id and status='OPEN' and not is_suggested
   and client_id is not distinct from v_old.client_id and public.normalize_task_text(title)=public.normalize_task_text(v_old.title) limit 1;
  if v_duplicate is not null then return jsonb_build_object('ok',false,'error','task_duplicate','task_id',v_duplicate); end if;
  update public.tasks set status='OPEN',is_suggested=false,completed_at=null,updated_at=clock_timestamp(),
   metadata=metadata||jsonb_build_object('owner_confirmed',true,'owner_auth_uid',p_actor,'owner_confirmed_at',now()) where id=v_id;
 elsif p_action in ('complete','cancel') then
  update public.tasks set status=case when p_action='complete' then 'DONE' else 'CANCELLED' end,
   completed_at=case when p_action='complete' then now() else null end,updated_at=clock_timestamp() where id=v_id;
 elsif p_action='merge' then
  select * into v_target from public.tasks where id=(p_payload->>'target_id')::uuid;
  if not found or v_target.id=v_id or v_target.status<>'OPEN' or v_target.is_suggested or v_old.status<>'OPEN'
   or v_target.updated_at<>(p_payload->>'target_version')::timestamptz then return jsonb_build_object('ok',false,'error','merge_conflict'); end if;
  if v_old.client_id is distinct from v_target.client_id then return jsonb_build_object('ok',false,'error','merge_client_mismatch'); end if;
  update public.tasks set updated_at=clock_timestamp(),metadata=metadata||jsonb_build_object('owner_confirmed',true,'owner_auth_uid',p_actor,'owner_confirmed_at',now()) where id=v_target.id;
  update public.tasks set status='SUPERSEDED',duplicate_of_task_id=v_target.id,updated_at=clock_timestamp(),
   metadata=metadata||jsonb_build_object('dedupe_reason','owner_confirmed_merge','owner_auth_uid',p_actor) where id=v_id;
 end if;
 v_result:=jsonb_build_object('ok',true,'duplicate',false,'task_id',v_id,'updated_at',(select updated_at from public.tasks where id=v_id));
 insert into private.owner_task_operations values(p_request_id,p_actor,v_hash,v_result,now());
 return v_result;
end;
$$;
revoke all on function public.api_owner_task_mutate(uuid,uuid,text,uuid,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.api_owner_task_mutate(uuid,uuid,text,uuid,timestamptz,jsonb) to service_role;
