begin;
create table if not exists private.stock_monitor_state (
 id boolean primary key default true check(id),
 alert_mode text not null default 'availability' check(alert_mode in ('availability','all_changes')),
 lease uuid, lease_until timestamptz, last_started_at timestamptz, last_success_at timestamptz,
 last_success_scan uuid, last_error text, source_meta jsonb not null default '{}'::jsonb
);
insert into private.stock_monitor_state(id) values(true) on conflict do nothing;
create table if not exists private.stock_scans (
 id uuid primary key, started_at timestamptz not null default now(), finished_at timestamptz,
 status text not null check(status in('running','success','error')), products integer, alerts integer,error text
);
create table if not exists private.stock_products (
 company text not null check(company in('GTA','TR')), product_id bigint not null check(product_id>0),
 company_id bigint not null check(company_id>0), sku text not null,product_name text not null,unit text not null,
 quantity_basis text not null check(quantity_basis in('free_qty','qty_available')),
 available_quantity numeric not null,on_hand_quantity numeric not null,forecast_quantity numeric,
 last_scan uuid not null references private.stock_scans(id),checked_at timestamptz not null default now(),
 primary key(company,product_id)
);
create index if not exists stock_products_scan_company_idx on private.stock_products(last_scan,company,product_id);
create table if not exists private.stock_alerts (
 id uuid primary key default gen_random_uuid(),scan_id uuid not null references private.stock_scans(id),
 company text not null,product_id bigint not null,sku text not null,product_name text not null,unit text not null,
 kind text not null check(kind in('out_of_stock','back_in_stock','quantity_changed')),
 previous_quantity numeric not null,current_quantity numeric not null,created_at timestamptz not null default now(),
 delivery_state text not null default 'pending' check(delivery_state in('pending','sent','disabled')),
 unique(scan_id,company,product_id)
);
create index if not exists stock_alerts_pending_idx on private.stock_alerts(created_at,id) where delivery_state='pending';
alter table private.stock_monitor_state enable row level security;
alter table private.stock_scans enable row level security;
alter table private.stock_products enable row level security;
alter table private.stock_alerts enable row level security;
revoke all on private.stock_monitor_state,private.stock_scans,private.stock_products,private.stock_alerts from public,anon,authenticated;
grant all on private.stock_monitor_state,private.stock_scans,private.stock_products,private.stock_alerts to service_role;

do $$ begin
 if not exists(select 1 from vault.secrets where name='weneed_stock_monitor_cron_token') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'weneed_stock_monitor_cron_token');
 end if;
end $$;

create or replace function public.stock_validate_worker_token(p_token text) returns boolean
language sql security definer set search_path='' as $$
 select length(p_token)=64 and exists(select 1 from vault.decrypted_secrets
 where name='weneed_stock_monitor_cron_token' and
 extensions.digest(decrypted_secret,'sha256')=extensions.digest(p_token,'sha256'));
$$;
create or replace function public.stock_begin_scan() returns uuid
language plpgsql security definer set search_path='' as $$
declare s private.stock_monitor_state; scan uuid:=gen_random_uuid();
begin
 select * into s from private.stock_monitor_state where id=true for update;
 if s.lease_until>now() then return null; end if;
 if s.lease is not null then
  update private.stock_scans set status='error',error='lease_expired',finished_at=now() where id=s.lease and status='running';
 end if;
 insert into private.stock_scans(id,status) values(scan,'running');
 update private.stock_monitor_state set lease=scan,lease_until=now()+interval '4 minutes',last_started_at=now() where id=true;
 return scan;
end $$;
create or replace function public.stock_fail_scan(p_scan uuid,p_error text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from private.stock_monitor_state where id=true and lease=p_scan for update;
 if not found then return; end if;
 update private.stock_scans set status='error',error=left(p_error,80),finished_at=now() where id=p_scan and status='running';
 update private.stock_monitor_state set lease=null,lease_until=null,last_error=left(p_error,80) where id=true and lease=p_scan;
end $$;
create or replace function public.stock_commit_snapshot(p_scan uuid,p_rows jsonb,p_meta jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.stock_monitor_state;r record;prior private.stock_products;kind text;cnt integer:=0;alert_count integer:=0;
begin
 select * into s from private.stock_monitor_state where id=true for update;
 if s.lease is distinct from p_scan or s.lease_until<now() then raise exception 'stock_scan_lease_invalid';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)<2 or jsonb_array_length(p_rows)>10000
  or p_meta->>'complete' is distinct from 'true' then raise exception 'stock_snapshot_incomplete';end if;
 if (select count(distinct x->>'company') from jsonb_array_elements(p_rows)x where x->>'company' in('GTA','TR'))<>2
  or exists(select 1 from jsonb_array_elements(p_rows)x group by x->>'company',x->>'product_id' having count(*)>1)
  then raise exception 'stock_snapshot_scope_invalid';end if;
 for r in select * from jsonb_to_recordset(p_rows) as x(company text,company_id bigint,product_id bigint,sku text,
  product_name text,unit text,quantity_basis text,available_quantity numeric,on_hand_quantity numeric,forecast_quantity numeric)
 loop
  if r.company not in('GTA','TR') or r.company is null or r.product_id is null or r.product_id<=0 or r.company_id is null
   or r.company_id<=0 or r.product_name is null or r.unit is null or r.available_quantity is null or r.on_hand_quantity is null
   or r.available_quantity::text in('NaN','Infinity','-Infinity') or r.on_hand_quantity::text in('NaN','Infinity','-Infinity')
   or r.forecast_quantity::text in('NaN','Infinity','-Infinity')
   or length(r.sku)>200 or length(r.product_name)>500 or length(r.unit)>100
   then raise exception 'stock_snapshot_row_invalid';end if;
  select * into prior from private.stock_products where company=r.company and product_id=r.product_id;
  kind:=null;
  if found and prior.last_scan=s.last_success_scan and prior.quantity_basis=r.quantity_basis and prior.unit=r.unit then
   if prior.available_quantity>0 and r.available_quantity<=0 then kind:='out_of_stock';
   elsif prior.available_quantity<=0 and r.available_quantity>0 then kind:='back_in_stock';
   elsif s.alert_mode='all_changes' and abs(prior.available_quantity-r.available_quantity)>0.000001 then kind:='quantity_changed';end if;
  end if;
  if kind is not null then
   insert into private.stock_alerts(scan_id,company,product_id,sku,product_name,unit,kind,previous_quantity,current_quantity)
   values(p_scan,r.company,r.product_id,r.sku,r.product_name,r.unit,kind,prior.available_quantity,r.available_quantity);
   alert_count:=alert_count+1;
  end if;
  insert into private.stock_products(company,company_id,product_id,sku,product_name,unit,quantity_basis,
   available_quantity,on_hand_quantity,forecast_quantity,last_scan,checked_at)
  values(r.company,r.company_id,r.product_id,r.sku,r.product_name,r.unit,r.quantity_basis,
   r.available_quantity,r.on_hand_quantity,r.forecast_quantity,p_scan,now())
  on conflict(company,product_id) do update set company_id=excluded.company_id,sku=excluded.sku,
   product_name=excluded.product_name,unit=excluded.unit,quantity_basis=excluded.quantity_basis,
   available_quantity=excluded.available_quantity,on_hand_quantity=excluded.on_hand_quantity,
   forecast_quantity=excluded.forecast_quantity,last_scan=p_scan,checked_at=now();
  cnt:=cnt+1;
 end loop;
 update private.stock_scans set status='success',finished_at=now(),products=cnt,alerts=alert_count where id=p_scan;
 update private.stock_monitor_state set lease=null,lease_until=null,last_success_at=now(),last_success_scan=p_scan,
  last_error=null,source_meta=p_meta where id=true;
 return jsonb_build_object('products',cnt,'alerts',alert_count,'baseline',s.last_success_scan is null,'checked_at',now());
end $$;

create or replace function public.stock_read_dashboard(p_company text default 'ALL',p_query text default '',p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.stock_monitor_state;result jsonb;
begin
 if p_company not in('ALL','GTA','TR') or p_offset<0 or p_offset>10000 or length(p_query)>120 then raise exception 'invalid_query';end if;
 select * into s from private.stock_monitor_state where id=true;
 select jsonb_build_object('checked_at',s.last_success_at,'last_error',s.last_error,'source_meta',s.source_meta,'alert_mode',s.alert_mode,
 'scan_interval_minutes',5,'stale',s.last_success_at is null or s.last_success_at<now()-interval '12 minutes',
 'total',(select count(*) from private.stock_products where last_scan=s.last_success_scan and
  (p_company='ALL' or company=p_company) and (p_query='' or strpos(lower(product_name||' '||sku),lower(p_query))>0)),
 'summary',(select jsonb_agg(x) from(select company,count(*) as products,count(*)filter(where available_quantity<=0)as out_of_stock
   from private.stock_products where last_scan=s.last_success_scan group by company)x),
 'items',(select coalesce(jsonb_agg(x),'[]'::jsonb)from(select company,product_id,sku,product_name,unit,quantity_basis,
  available_quantity,on_hand_quantity,forecast_quantity,checked_at from private.stock_products where last_scan=s.last_success_scan and
  (p_company='ALL' or company=p_company)and(p_query=''or strpos(lower(product_name||' '||sku),lower(p_query))>0)
  order by company,product_name,product_id limit 50 offset p_offset)x),
 'alerts',(select coalesce(jsonb_agg(x),'[]'::jsonb)from(select id,company,sku,product_name,unit,kind,previous_quantity,current_quantity,
  created_at,delivery_state from private.stock_alerts where(p_company='ALL'or company=p_company)order by created_at desc,id limit 30)x)
 )into result;
 return result;
end $$;
revoke all on function public.stock_validate_worker_token(text),public.stock_begin_scan(),public.stock_fail_scan(uuid,text),
 public.stock_commit_snapshot(uuid,jsonb,jsonb),public.stock_read_dashboard(text,text,integer) from public,anon,authenticated;
grant execute on function public.stock_validate_worker_token(text),public.stock_begin_scan(),public.stock_fail_scan(uuid,text),
 public.stock_commit_snapshot(uuid,jsonb,jsonb),public.stock_read_dashboard(text,text,integer) to service_role;
commit;
