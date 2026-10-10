begin;
create table if not exists private.stock_push_devices (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),
 endpoint text not null unique,keys jsonb not null,active boolean not null default true,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists private.stock_push_delivery (
 alert_id uuid not null references private.stock_alerts(id),device_id uuid not null references private.stock_push_devices(id),
 status text not null default 'pending' check(status in('pending','sent','failed')),attempts integer not null default 0,
 lease uuid,lease_until timestamptz,next_attempt timestamptz not null default now(),last_error text,
 primary key(alert_id,device_id)
);
alter table private.stock_push_devices enable row level security;
alter table private.stock_push_delivery enable row level security;
revoke all on private.stock_push_devices,private.stock_push_delivery from public,anon,authenticated;
grant all on private.stock_push_devices,private.stock_push_delivery to service_role;
create or replace function public.stock_push_vapid(p_public text,p_private text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(802140);
 if not exists(select 1 from vault.secrets where name='weneed_stock_push_public') then
  if length(p_public)<>87 or length(p_private)<>43 then raise exception 'invalid_vapid_keys';end if;
  perform vault.create_secret(p_public,'weneed_stock_push_public');
  perform vault.create_secret(p_private,'weneed_stock_push_private');
 end if;
 return jsonb_build_object('publicKey',(select decrypted_secret from vault.decrypted_secrets where name='weneed_stock_push_public'),
  'privateKey',(select decrypted_secret from vault.decrypted_secrets where name='weneed_stock_push_private'));
end $$;
create or replace function public.stock_push_register(p_owner uuid,p_endpoint text,p_keys jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare device uuid;
begin
 if not exists(select 1 from auth.users u join public.app_access_users a on lower(u.email)=lower(a.email)
  where u.id=p_owner and u.email_confirmed_at is not null and a.is_active and a.role='owner') then raise exception 'owner_only';end if;
 if length(p_endpoint)>2048 or jsonb_typeof(p_keys)<>'object' or length(p_keys->>'p256dh')<>87 or length(p_keys->>'auth')<>22
 then raise exception 'invalid_subscription';end if;
 insert into private.stock_push_devices(owner_id,endpoint,keys) values(p_owner,p_endpoint,p_keys)
 on conflict(endpoint) do update set owner_id=p_owner,keys=p_keys,active=true,updated_at=now() returning id into device;
 return device;
end $$;
create or replace function public.stock_push_unregister(p_owner uuid,p_endpoint text) returns void
language sql security definer set search_path='' as $$
 update private.stock_push_devices set active=false,updated_at=now() where owner_id=p_owner and endpoint=p_endpoint;
$$;
create or replace function public.stock_push_claim() returns jsonb
language plpgsql security definer set search_path='' as $$
declare batch uuid:=gen_random_uuid();result jsonb;
begin
 insert into private.stock_push_delivery(alert_id,device_id)
 select a.id,d.id from private.stock_alerts a cross join private.stock_push_devices d
 where d.active and a.created_at>=d.created_at and a.created_at>now()-interval '6 hours' and a.delivery_state='pending'
 on conflict do nothing;
 with candidates as(select q.alert_id,q.device_id from private.stock_push_delivery q join private.stock_push_devices d on d.id=q.device_id
  where d.active and q.status='pending' and q.attempts<5 and q.next_attempt<=now() and(q.lease_until is null or q.lease_until<now())
  order by q.next_attempt limit 100 for update of q skip locked)
 update private.stock_push_delivery q set lease=batch,lease_until=now()+interval '2 minutes',attempts=attempts+1
 from candidates c where q.alert_id=c.alert_id and q.device_id=c.device_id;
 select coalesce(jsonb_agg(x),'[]'::jsonb) into result from(select q.alert_id,q.device_id,q.lease,d.endpoint,d.keys,
 a.company,a.product_name,a.kind,a.current_quantity,a.unit,a.scan_id
 from private.stock_push_delivery q join private.stock_push_devices d on d.id=q.device_id join private.stock_alerts a on a.id=q.alert_id
 where q.lease=batch)x;
 return result;
end $$;
create or replace function public.stock_push_finish(p_lease uuid,p_device uuid,p_alerts uuid[],p_result text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_result not in('sent','expired','send_failed') then raise exception 'invalid_result';end if;
 update private.stock_push_delivery set status=case when p_result='sent' then 'sent' when p_result='expired' or attempts>=5 then 'failed' else 'pending' end,
 lease=null,lease_until=null,next_attempt=now()+interval '5 minutes',last_error=case when p_result='sent' then null else p_result end
 where lease=p_lease and device_id=p_device and alert_id=any(p_alerts);
 if p_result='expired' then update private.stock_push_devices set active=false,updated_at=now() where id=p_device;end if;
 update private.stock_alerts a set delivery_state='sent' where a.id=any(p_alerts)
 and exists(select 1 from private.stock_push_delivery q where q.alert_id=a.id and q.status='sent')
 and not exists(select 1 from private.stock_push_delivery q join private.stock_push_devices d on d.id=q.device_id
  where q.alert_id=a.id and d.active and q.status<>'sent');
end $$;
revoke all on function public.stock_push_vapid(text,text),public.stock_push_register(uuid,text,jsonb),public.stock_push_unregister(uuid,text),
 public.stock_push_claim(),public.stock_push_finish(uuid,uuid,uuid[],text) from public,anon,authenticated;
grant execute on function public.stock_push_vapid(text,text),public.stock_push_register(uuid,text,jsonb),public.stock_push_unregister(uuid,text),
 public.stock_push_claim(),public.stock_push_finish(uuid,uuid,uuid[],text) to service_role;
commit;
