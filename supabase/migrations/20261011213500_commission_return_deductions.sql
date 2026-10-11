-- Explicit commission deductions, separate from invoice HT and sales-line estimates.
-- Source rows are private and imported separately; no commercial data is in this migration.
create table if not exists private.commission_return_deductions (
 id uuid primary key default gen_random_uuid(),
 month date not null check (extract(day from month)=1),
 company text not null check (company in ('GTA','TR')),
 reference text not null check (length(reference) between 1 and 120),
 description text not null default '' check (length(description)<=1000),
 currency text not null default 'EUR' check (currency='EUR'),
 commission_cents bigint not null check (commission_cents between 1 and 100000000),
 kind text not null default 'excel_explicit_return' check (kind='excel_explicit_return'),
 source_fingerprint text not null check (source_fingerprint ~ '^[a-f0-9]{64}$'),
 source_file text not null check (length(source_file) between 1 and 500),
 source_sheet text not null check (length(source_sheet) between 1 and 120),
 amount_cell text not null check (amount_cell ~ '^[A-Z]{1,3}[1-9][0-9]{0,4}$'),
 net_formula_cell text not null check (net_formula_cell ~ '^[A-Z]{1,3}[1-9][0-9]{0,4}$'),
 net_formula text not null check (length(net_formula) between 1 and 1000),
 verified_at timestamptz not null default now(),
 unique(source_fingerprint,source_sheet,amount_cell)
);
alter table private.commission_return_deductions enable row level security;
revoke all on private.commission_return_deductions from public,anon,authenticated;
grant usage on schema private to service_role;
grant select,insert,update,delete on private.commission_return_deductions to service_role;
create or replace function public.api_owner_commission_returns(p_month text)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_month date; v_total integer;
begin
 if p_month is null or p_month !~ '^(20[0-9]{2})-(0[1-9]|1[0-2])$' then
  raise exception 'invalid_month';
 end if;
 v_month := (p_month||'-01')::date;
 select count(*) into v_total from private.commission_return_deductions where month=v_month;
 if v_total>500 then raise exception 'return_deduction_scope_limit'; end if;
 return jsonb_build_object('version','commission_returns_v1','month',p_month,
  'scope','recorded_deductions_only','read_at',now(),'total',v_total,
  'deductions',coalesce((select jsonb_agg(jsonb_build_object(
   'id',id,'month',p_month,'company',company,'reference',reference,'description',description,
   'currency',currency,'commission_cents',commission_cents,'kind',kind,
   'source_fingerprint',source_fingerprint,'source_file',source_file,'source_sheet',source_sheet,
   'amount_cell',amount_cell,'net_formula_cell',net_formula_cell,'net_formula',net_formula,
   'verified_at',verified_at) order by company,reference,id)
   from private.commission_return_deductions where month=v_month),'[]'::jsonb));
end;
$$;
revoke all on function public.api_owner_commission_returns(text) from public,anon,authenticated;
grant execute on function public.api_owner_commission_returns(text) to service_role;
