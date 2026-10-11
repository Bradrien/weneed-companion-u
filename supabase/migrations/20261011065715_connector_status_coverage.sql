-- Owner API calls this through service_role. No private cursor or raw provider error is returned.
create or replace function public.api_owner_connector_status()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'source',s.source,'last_attempt_at',s.last_started_at,'last_success_at',case when s.cursor->>'sync_version'='2' then
      case when s.cursor->>'watermark_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.-]+Z$'
        then s.cursor->'watermark_at' else 'null'::jsonb end
      else to_jsonb(s.last_success_at) end,'updated_at',s.updated_at,
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
    'limited_count',case when r.metadata->>'limited' ~ '^[0-9]{1,9}$' then (r.metadata->>'limited')::integer end,
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
        'drive_profile_missing','drive_text_too_large','drive_file_changed_during_read','invalid_drive_file','raw_event_write_failed',
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
