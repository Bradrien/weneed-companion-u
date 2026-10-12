begin;
create table private.stock_product_watches (
 owner_id uuid not null references auth.users(id),
 company text not null check(company in ('TR','GTA')),
 product_id bigint not null check(product_id > 0),
 enabled boolean not null default true,
 started_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(owner_id,company,product_id),
 foreign key(company,product_id) references private.stock_products(company,product_id)
);
alter table private.stock_product_watches enable row level security;
revoke all on private.stock_product_watches from public,anon,authenticated;
grant all on private.stock_product_watches to service_role;
-- Preserve the existing global subscriptions; new targeted subscriptions opt out explicitly.
alter table private.stock_push_devices add column notify_all boolean not null default true;

create function private.stock_owner_valid(p_owner uuid) returns boolean
language sql security definer set search_path='' as $$
 select exists(select 1 from auth.users u join public.app_access_users a on lower(u.email)=lower(a.email)
 where u.id=p_owner and u.email_confirmed_at is not null and a.is_active and a.role='owner');
$$;
revoke all on function private.stock_owner_valid(uuid) from public,anon,authenticated;
grant execute on function private.stock_owner_valid(uuid) to service_role;

create function public.stock_watch_set(p_owner uuid,p_company text,p_product bigint,p_enabled boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if not private.stock_owner_valid(p_owner) then raise exception 'owner_only';end if;
 if p_company is null or p_company not in('TR','GTA') or p_product is null or p_product<=0 or p_product>9007199254740991 or p_enabled is null then raise exception 'invalid_watch';end if;
 if p_enabled and not exists(select 1 from private.stock_products p join private.stock_monitor_state s on s.id=true
  where p.company=p_company and p.product_id=p_product and p.last_scan=s.last_success_scan) then raise exception 'stock_product_not_found';end if;
 if p_enabled then
  insert into private.stock_product_watches(owner_id,company,product_id) values(p_owner,p_company,p_product)
  on conflict(owner_id,company,product_id) do update set enabled=true,
   started_at=case when private.stock_product_watches.enabled then private.stock_product_watches.started_at else clock_timestamp() end,
   updated_at=clock_timestamp();
 else
  update private.stock_product_watches set enabled=false,updated_at=clock_timestamp()
   where owner_id=p_owner and company=p_company and product_id=p_product;
 end if;
 return jsonb_build_object('company',p_company,'product_id',p_product,'watching',p_enabled);
end $$;

create function public.stock_read_owner_dashboard(p_owner uuid,p_company text default 'ALL',p_query text default '',p_offset integer default 0) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if not private.stock_owner_valid(p_owner) then raise exception 'owner_only';end if;
 result:=public.stock_read_dashboard(p_company,p_query,p_offset);
 return result||jsonb_build_object('items',(select coalesce(jsonb_agg(item||jsonb_build_object('watching',exists(
  select 1 from private.stock_product_watches w where w.owner_id=p_owner and w.company=item->>'company'
   and w.product_id=(item->>'product_id')::bigint and w.enabled)) order by position),'[]'::jsonb)
  from jsonb_array_elements(result->'items') with ordinality x(item,position)));
end $$;

create function public.stock_push_register_scoped(p_owner uuid,p_endpoint text,p_keys jsonb,p_notify_all boolean) returns uuid
language plpgsql security invoker set search_path='' as $$
declare device uuid;
begin
 if not private.stock_owner_valid(p_owner) then raise exception 'owner_only';end if;
 if p_notify_all is null then raise exception 'invalid_scope';end if;
 device:=public.stock_push_register(p_owner,p_endpoint,p_keys);
 update private.stock_push_devices set notify_all=p_notify_all,updated_at=clock_timestamp() where id=device and owner_id=p_owner;
 return device;
end $$;
create function public.stock_push_status(p_owner uuid,p_endpoint text) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if not private.stock_owner_valid(p_owner) then raise exception 'owner_only';end if;
 return coalesce((select jsonb_build_object('active',active,'notify_all',notify_all) from private.stock_push_devices
  where owner_id=p_owner and endpoint=p_endpoint),jsonb_build_object('active',false,'notify_all',false));
end $$;

-- Check eligibility both when queuing and when retrying: cancelled watches must not be retried.
create or replace function public.stock_push_claim() returns jsonb
language plpgsql security definer set search_path='' as $$
declare batch uuid:=gen_random_uuid();result jsonb;
begin
 insert into private.stock_push_delivery(alert_id,device_id)
 select a.id,d.id from private.stock_alerts a cross join private.stock_push_devices d
 where d.active and private.stock_owner_valid(d.owner_id) and a.created_at>=d.created_at
  and a.created_at>now()-interval '6 hours' and a.delivery_state='pending'
  and (d.notify_all or (a.kind='back_in_stock' and exists(select 1 from private.stock_product_watches w
   where w.owner_id=d.owner_id and w.company=a.company and w.product_id=a.product_id and w.enabled and a.created_at>=w.started_at)))
 on conflict do nothing;
 with candidates as(select q.alert_id,q.device_id from private.stock_push_delivery q
  join private.stock_push_devices d on d.id=q.device_id join private.stock_alerts a on a.id=q.alert_id
  where d.active and private.stock_owner_valid(d.owner_id) and q.status='pending' and q.attempts<5
   and q.next_attempt<=now() and (q.lease_until is null or q.lease_until<now()) and a.created_at>now()-interval '6 hours'
   and (d.notify_all or (a.kind='back_in_stock' and exists(select 1 from private.stock_product_watches w
    where w.owner_id=d.owner_id and w.company=a.company and w.product_id=a.product_id and w.enabled and a.created_at>=w.started_at)))
  order by q.next_attempt limit 100 for update of q skip locked)
 update private.stock_push_delivery q set lease=batch,lease_until=now()+interval '2 minutes',attempts=attempts+1
 from candidates c where q.alert_id=c.alert_id and q.device_id=c.device_id;
 select coalesce(jsonb_agg(x),'[]'::jsonb) into result from(select q.alert_id,q.device_id,q.lease,d.endpoint,d.keys,
  a.company,a.product_id,a.product_name,a.kind,a.current_quantity,a.unit,a.scan_id
  from private.stock_push_delivery q join private.stock_push_devices d on d.id=q.device_id join private.stock_alerts a on a.id=q.alert_id
  where q.lease=batch)x;
 return result;
end $$;
revoke all on function public.stock_watch_set(uuid,text,bigint,boolean),public.stock_read_owner_dashboard(uuid,text,text,integer),
 public.stock_push_register_scoped(uuid,text,jsonb,boolean),public.stock_push_status(uuid,text),public.stock_push_claim() from public,anon,authenticated;
grant execute on function public.stock_watch_set(uuid,text,bigint,boolean),public.stock_read_owner_dashboard(uuid,text,text,integer),
 public.stock_push_register_scoped(uuid,text,jsonb,boolean),public.stock_push_status(uuid,text),public.stock_push_claim() to service_role;
commit;
