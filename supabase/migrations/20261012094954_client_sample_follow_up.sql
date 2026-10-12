-- User-recorded samples. No stock, order, notification or message is written.
create table private.client_samples (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id),
 status text not null default 'PLANNED' check(status in ('PLANNED','SENT','RECEIVED','FEEDBACK','WON','LOST','CANCELLED')),
 products text not null check(length(btrim(products)) between 1 and 2000),
 goal text not null default '' check(length(goal)<=1000), notes text not null default '' check(length(notes)<=5000),
 tracking text not null default '' check(length(tracking)<=500), follow_up_at timestamptz,
 sent_at timestamptz, received_at timestamptz,
 created_by uuid not null references auth.users(id), updated_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default clock_timestamp(),
 check(received_at is null or sent_at is not null),
 check(status not in ('SENT','RECEIVED','FEEDBACK','WON','LOST') or sent_at is not null)
);
create index client_samples_client_status on private.client_samples(client_id,status);
create index client_samples_follow_up on private.client_samples(follow_up_at) where status in ('PLANNED','SENT','RECEIVED','FEEDBACK');
create table private.sample_operations (
 request_id uuid primary key, actor uuid not null references auth.users(id), request_body jsonb not null,
 result jsonb not null, created_at timestamptz not null default now()
);
alter table private.client_samples enable row level security;
alter table private.sample_operations enable row level security;
revoke all on private.client_samples,private.sample_operations from public,anon,authenticated;
grant select,insert,update on private.client_samples to service_role;
grant select,insert on private.sample_operations to service_role;

create function public.api_owner_samples_list(p_actor uuid,p_status text default 'ACTIVE',p_client_id uuid default null,p_query text default '',p_offset integer default 0)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from private.owner_task_actors u join public.app_access_users a on u.email=a.email
  where u.actor=p_actor and a.role='owner' and a.is_active) then return jsonb_build_object('error','owner_only'); end if;
 if p_status not in ('ACTIVE','OVERDUE','ALL','PLANNED','SENT','RECEIVED','FEEDBACK','WON','LOST','CANCELLED') or
  p_status is null or p_offset is null or p_offset<0 or p_offset>100000 or length(coalesce(p_query,''))>120
 then return jsonb_build_object('error','invalid_filter'); end if;
 return (
 with scoped as (
  select s.id,s.client_id,c.canonical_name as client_name,s.status,s.products,s.goal,s.notes,s.tracking,
   s.follow_up_at,s.sent_at,s.received_at,s.created_at,s.updated_at
  from private.client_samples s join public.clients c on c.id=s.client_id
  where (p_client_id is null or s.client_id=p_client_id) and
   (coalesce(p_query,'')='' or position(lower(p_query) in lower(c.canonical_name||' '||s.products||' '||s.goal))>0)
 ), selected as (
  select * from scoped where p_status='ALL' or p_status=status or
   p_status='ACTIVE' and status in ('PLANNED','SENT','RECEIVED','FEEDBACK') or
   p_status='OVERDUE' and status in ('PLANNED','SENT','RECEIVED','FEEDBACK') and follow_up_at<=now()
 ), rows as (
  select * from selected order by follow_up_at asc nulls last,created_at desc,id limit 50 offset p_offset
 ) select jsonb_build_object('version','client_samples_v1','scope','owner_recorded_samples','limit',50,'offset',p_offset,
  'checked_at',now(),'total',(select count(*) from selected),
  'counts',jsonb_build_object('active',(select count(*) from scoped where status in ('PLANNED','SENT','RECEIVED','FEEDBACK')),
   'overdue',(select count(*) from scoped where status in ('PLANNED','SENT','RECEIVED','FEEDBACK') and follow_up_at<=now()),
   'won',(select count(*) from scoped where status='WON')),
  'samples',coalesce((select jsonb_agg(to_jsonb(rows)) from rows),'[]'::jsonb))
 );
end;
$$;
revoke all on function public.api_owner_samples_list(uuid,text,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.api_owner_samples_list(uuid,text,uuid,text,integer) to service_role;

create function public.api_owner_sample_mutate(p_request_id uuid,p_actor uuid,p_action text,p_sample_id uuid default null,
 p_expected_version timestamptz default null,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_old private.client_samples%rowtype; v_op private.sample_operations%rowtype; v_request jsonb; v_result jsonb;
 v_id uuid; v_client uuid; v_status text; v_updated timestamptz; v_follow timestamptz; v_key text;
begin
 if p_request_id is null or not exists(select 1 from private.owner_task_actors u join public.app_access_users a on u.email=a.email
  where u.actor=p_actor and a.role='owner' and a.is_active)
 then return jsonb_build_object('ok',false,'error','owner_only'); end if;
 if p_action is null or p_action not in ('create','edit','move') or p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload='{}'::jsonb
 then return jsonb_build_object('ok',false,'error','invalid_payload'); end if;
 for v_key in select jsonb_object_keys(p_payload) loop
  if not (p_action='move' and v_key='status' or p_action in ('create','edit') and v_key in ('products','goal','notes','tracking','follow_up_at') or p_action='create' and v_key='client_id')
  then return jsonb_build_object('ok',false,'error','invalid_payload'); end if;
 end loop;
 for v_key in select unnest(array['products','goal','notes','tracking']) loop
  if p_payload ? v_key and (jsonb_typeof(p_payload->v_key)<>'string' or
   length(p_payload->>v_key)>case v_key when 'products' then 2000 when 'goal' then 1000 when 'notes' then 5000 else 500 end or
   v_key='products' and length(btrim(p_payload->>v_key))=0)
  then return jsonb_build_object('ok',false,'error','invalid_'||v_key); end if;
 end loop;
 if p_payload ? 'follow_up_at' and p_payload->'follow_up_at'<>'null'::jsonb then
  if jsonb_typeof(p_payload->'follow_up_at')<>'string' or p_payload->>'follow_up_at' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$'
  then return jsonb_build_object('ok',false,'error','invalid_follow_up'); end if;
  begin v_follow:=(p_payload->>'follow_up_at')::timestamptz;
  exception when others then return jsonb_build_object('ok',false,'error','invalid_follow_up'); end;
 end if;
 v_request:=jsonb_build_object('actor',p_actor,'action',p_action,'sample',p_sample_id,'version',p_expected_version,'payload',p_payload);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
 select * into v_op from private.sample_operations where request_id=p_request_id;
 if found then
  if v_op.actor<>p_actor or v_op.request_body<>v_request then return jsonb_build_object('ok',false,'error','idempotency_conflict'); end if;
  return v_op.result;
 end if;
 if p_action='create' then
  if p_sample_id is not null or p_expected_version is not null or not (p_payload ? 'products') or
   p_payload->>'client_id' is null or p_payload->>'client_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return jsonb_build_object('ok',false,'error','invalid_client'); end if;
  v_client:=(p_payload->>'client_id')::uuid;
  if not exists(select 1 from public.clients where id=v_client) then return jsonb_build_object('ok',false,'error','client_not_found'); end if;
  insert into private.client_samples(client_id,products,goal,notes,tracking,follow_up_at,created_by,updated_by)
  values(v_client,btrim(p_payload->>'products'),coalesce(p_payload->>'goal',''),coalesce(p_payload->>'notes',''),
   coalesce(p_payload->>'tracking',''),v_follow,p_actor,p_actor) returning id,updated_at into v_id,v_updated;
 else
  select * into v_old from private.client_samples where id=p_sample_id for update;
  if not found then return jsonb_build_object('ok',false,'error','sample_not_found'); end if;
  if p_expected_version is null or p_expected_version<>v_old.updated_at then return jsonb_build_object('ok',false,'error','sample_conflict'); end if;
  v_id:=v_old.id;v_updated:=greatest(clock_timestamp(),v_old.updated_at+interval '1 microsecond');
  if p_action='edit' then
   update private.client_samples set products=coalesce(p_payload->>'products',products),goal=coalesce(p_payload->>'goal',goal),
    notes=coalesce(p_payload->>'notes',notes),tracking=coalesce(p_payload->>'tracking',tracking),
    follow_up_at=case when p_payload ? 'follow_up_at' then v_follow else follow_up_at end,updated_by=p_actor,updated_at=v_updated where id=v_id;
  else
   v_status:=p_payload->>'status';
   if v_status is null or not (v_old.status='PLANNED' and v_status in ('SENT','CANCELLED') or
    v_old.status='SENT' and v_status in ('RECEIVED','FEEDBACK','WON','LOST','CANCELLED') or
    v_old.status='RECEIVED' and v_status in ('FEEDBACK','WON','LOST','CANCELLED') or
    v_old.status='FEEDBACK' and v_status in ('WON','LOST','CANCELLED'))
   then return jsonb_build_object('ok',false,'error','invalid_transition'); end if;
   update private.client_samples set status=v_status,updated_by=p_actor,updated_at=v_updated,
    sent_at=case when v_status='SENT' then clock_timestamp() else sent_at end,
    received_at=case when v_status='RECEIVED' then clock_timestamp() else received_at end where id=v_id;
  end if;
 end if;
 v_result:=jsonb_build_object('ok',true,'sample_id',v_id,'updated_at',v_updated);
 insert into private.sample_operations(request_id,actor,request_body,result) values(p_request_id,p_actor,v_request,v_result);
 return v_result;
end;
$$;
revoke all on function public.api_owner_sample_mutate(uuid,uuid,text,uuid,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.api_owner_sample_mutate(uuid,uuid,text,uuid,timestamptz,jsonb) to service_role;
