begin;
do $$
declare rows jsonb;scan uuid;result jsonb;before_scan uuid;err boolean:=false;
begin
 select jsonb_agg(x) into rows from(select company,company_id,product_id,sku,product_name,unit,quantity_basis,
  1::numeric as available_quantity,1::numeric as on_hand_quantity,1::numeric as forecast_quantity
  from (select distinct on(company) * from private.stock_products order by company,product_id)p)x;
 update private.stock_monitor_state set last_success_scan=null,lease=null,lease_until=null where id=true;
 scan:=public.stock_begin_scan();result:=public.stock_commit_snapshot(scan,rows,'{"complete":true}'::jsonb);
 if (result->>'alerts')::int<>0 or (result->>'baseline')::boolean is not true then raise exception 'baseline_test_failed';end if;
 scan:=public.stock_begin_scan();rows:=jsonb_set(rows,'{0,available_quantity}','0');
 result:=public.stock_commit_snapshot(scan,rows,'{"complete":true}');
 if(result->>'alerts')::int<>1 then raise exception 'rupture_test_failed';end if;
 scan:=public.stock_begin_scan();result:=public.stock_commit_snapshot(scan,rows,'{"complete":true}');
 if(result->>'alerts')::int<>0 then raise exception 'dedupe_test_failed';end if;
 scan:=public.stock_begin_scan();rows:=jsonb_set(rows,'{0,available_quantity}','5');
 result:=public.stock_commit_snapshot(scan,rows,'{"complete":true}');
 if(result->>'alerts')::int<>1 then raise exception 'restock_test_failed';end if;
 select last_success_scan into before_scan from private.stock_monitor_state where id=true;
 scan:=public.stock_begin_scan();
 begin perform public.stock_commit_snapshot(scan,jsonb_build_array(rows->0),'{}');
 exception when others then err:=true;end;
 if not err then raise exception 'partial_snapshot_not_rejected';end if;
 perform public.stock_fail_scan(scan,'integration_test');
 if (select last_success_scan from private.stock_monitor_state where id=true) is distinct from before_scan then raise exception 'failed_scan_lost_snapshot';end if;
 if has_function_privilege('anon','public.stock_read_dashboard(text,text,integer)','execute')
 or has_function_privilege('authenticated','public.stock_push_claim()','execute') then raise exception 'security_test_failed';end if;
end $$;
select 'passed: baseline, rupture, return, deduplication, partial scan rejected, last snapshot preserved, RPC access denied' as integration;
rollback;
