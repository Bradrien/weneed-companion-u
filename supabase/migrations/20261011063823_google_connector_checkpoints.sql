-- Service-role-only checkpoint operations. Existing data and watermark are preserved.
alter table public.connector_state
  add column if not exists lease_owner uuid,
  add column if not exists lease_expires_at timestamptz;

create or replace function public.claim_connector_sync(p_source text, p_owner uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_previous_owner uuid; v_cursor jsonb; v_success timestamptz;
begin
  if p_source not in ('gmail','google_chat','google_drive') or p_owner is null then
    raise exception 'invalid_connector_claim';
  end if;
  insert into public.connector_state(source,cursor) values(p_source,'{}'::jsonb)
    on conflict(source) do nothing;
  select lease_owner into v_previous_owner from public.connector_state where source=p_source
    and lease_expires_at < clock_timestamp();
  update public.connector_state
    set lease_owner=p_owner,lease_expires_at=clock_timestamp()+interval '120 seconds',
      last_started_at=clock_timestamp(),updated_at=clock_timestamp()
    where source=p_source and (lease_owner is null or lease_expires_at is null or lease_expires_at<clock_timestamp())
    returning cursor,last_success_at into v_cursor,v_success;
  if not found then return null; end if;
  if v_previous_owner is not null then
    update public.connector_runs set status='failed',error='connector_lease_expired',finished_at=clock_timestamp()
      where id=v_previous_owner and status='running';
  end if;
  insert into public.connector_runs(id,source,status,started_at)
    values(p_owner,p_source,'running',clock_timestamp());
  return jsonb_build_object('cursor',coalesce(v_cursor,'{}'::jsonb),'last_success_at',v_success);
end $$;

create or replace function public.checkpoint_connector_sync(p_source text,p_owner uuid,p_cursor jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_cursor is null or jsonb_typeof(p_cursor)<>'object' then raise exception 'invalid_connector_cursor'; end if;
  update public.connector_state set cursor=p_cursor,last_error=null,updated_at=clock_timestamp(),
    lease_expires_at=clock_timestamp()+interval '120 seconds'
    where source=p_source and lease_owner=p_owner and lease_expires_at>clock_timestamp();
  return found;
end $$;

create or replace function public.finish_connector_sync(
  p_source text,p_owner uuid,p_cursor jsonb,p_status text,p_error text,p_watermark timestamptz,p_metrics jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_status not in ('success','partial','failed') then raise exception 'invalid_connector_status'; end if;
  if p_status='success' and (p_watermark is null or p_cursor is null or p_cursor->'window' is distinct from 'null'::jsonb) then
    raise exception 'unfinished_connector_window';
  end if;
  update public.connector_state set cursor=coalesce(p_cursor,cursor),
    last_success_at=case when p_status='success' then greatest(last_success_at,p_watermark) else last_success_at end,
    last_error=p_error,updated_at=clock_timestamp(),lease_owner=null,lease_expires_at=null
    where source=p_source and lease_owner=p_owner and lease_expires_at>clock_timestamp();
  if not found then return false; end if;
  update public.connector_runs set status=p_status,finished_at=clock_timestamp(),error=p_error,
    fetched_count=coalesce((p_metrics->>'fetched')::integer,0),
    processed_count=coalesce((p_metrics->>'processed')::integer,0),
    failed_count=coalesce((p_metrics->>'failed')::integer,0),metadata=coalesce(p_metrics,'{}'::jsonb)
    where id=p_owner and source=p_source;
  return true;
end $$;

revoke all on function public.claim_connector_sync(text,uuid) from public,anon,authenticated;
revoke all on function public.checkpoint_connector_sync(text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.finish_connector_sync(text,uuid,jsonb,text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.claim_connector_sync(text,uuid) to service_role;
grant execute on function public.checkpoint_connector_sync(text,uuid,jsonb) to service_role;
grant execute on function public.finish_connector_sync(text,uuid,jsonb,text,text,timestamptz,jsonb) to service_role;
-- Owner API calls this through service_role. No private cursor or raw provider error is returned.
create or replace function public.api_owner_connector_status()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'source',s.source,'last_attempt_at',s.last_started_at,'last_success_at',s.last_success_at,'updated_at',s.updated_at,
    'coverage_from',case when s.cursor->>'coverage_from' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.-]+Z$' then s.cursor->>'coverage_from' end,
    'watermark_at',case when s.cursor->>'watermark_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.-]+Z$' then s.cursor->>'watermark_at' end,
    'initial_replay_days',case when s.cursor->>'initial_replay_days' ~ '^[0-9]{1,3}$' then (s.cursor->>'initial_replay_days')::integer end,
    'continuation_pending',coalesce(jsonb_typeof(s.cursor->'window')='object',false),
    'sync_in_progress',s.lease_owner is not null and s.lease_expires_at>now(),
    'last_run_status',r.status,'last_run_started_at',r.started_at,'last_run_finished_at',r.finished_at,
    'fetched_count',r.fetched_count,'processed_count',r.processed_count,'failed_count',r.failed_count,
    'inserted_count',case when r.metadata->>'inserted' ~ '^[0-9]{1,9}$' then (r.metadata->>'inserted')::integer end,
    'duplicate_count',case when r.metadata->>'duplicates' ~ '^[0-9]{1,9}$' then (r.metadata->>'duplicates')::integer end,
    'skipped_count',case when r.metadata->>'skipped' ~ '^[0-9]{1,9}$' then (r.metadata->>'skipped')::integer end,
    'pages_count',case when r.metadata->>'pages' ~ '^[0-9]{1,9}$' then (r.metadata->>'pages')::integer end,
    'last_error',case
      when s.last_error is null then null
      when s.last_error ~ '^google_http_[0-9]{3}$' or s.last_error in (
        'google_request_failed','google_oauth_unreachable','google_oauth_invalid_response','google_token_refresh_failed',
        'invalid_google_oauth_json','incomplete_google_oauth_json','invalid_google_response','invalid_google_list_response',
        'google_page_token_invalid','google_page_token_loop','connector_scope_changed','invalid_sync_timestamp',
        'invalid_sync_cursor','sync_watermark_in_future','connector_checkpoint_unavailable','connector_lease_lost',
        'connector_lease_expired','connector_sync_failed','gmail_profile_missing','invalid_gmail_message',
        'google_chat_space_not_configured','invalid_google_item_id','invalid_chat_message','drive_search_incomplete',
        'drive_text_too_large','drive_file_changed_during_read','invalid_drive_file','raw_event_write_failed',
        'raw_event_write_unverifiable','normalized_event_unavailable','document_write_failed',
        'gmail_sync_failed','google_drive_sync_failed','one_or_more_raw_events_failed'
      ) then s.last_error
      else 'connector_sync_failed' end
  ) order by s.source),'[]'::jsonb)
  from public.connector_state s
  left join lateral (
    select status,started_at,finished_at,fetched_count,processed_count,failed_count,metadata
      from public.connector_runs where source=s.source order by started_at desc limit 1
  ) r on true;
$$;
revoke all on function public.api_owner_connector_status() from public,anon,authenticated;
grant execute on function public.api_owner_connector_status() to service_role;
