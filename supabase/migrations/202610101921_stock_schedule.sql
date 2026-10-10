-- Apply only after a complete initial stock scan has succeeded.
select cron.schedule('weneed-stock-monitor-5min','*/5 * * * *',$job$
 select net.http_post(
  url:='https://gcirlrghjvumhkekrtmf.supabase.co/functions/v1/stock-monitor',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
   (select decrypted_secret from vault.decrypted_secrets where name='weneed_stock_monitor_cron_token')),
  body:='{}'::jsonb,timeout_milliseconds:=120000);
$job$);
