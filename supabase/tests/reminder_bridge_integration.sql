-- Run after companion_task_actions + reminder_bridge_versioned_ack.
-- These fixtures never reach the Mac: all changes are rolled back together.
BEGIN;
DO $test$
DECLARE
  tid uuid; cancel_tid uuid; retry_tid uuid; roid uuid;
  result jsonb; first_cmd jsonb; newer_cmd jsonb; retry_cmd jsonb; replay_cmd jsonb;
  current_hash text; state text; action text; attempts integer; next_attempt timestamptz;
  actor_id uuid; manual_metadata jsonb;
BEGIN
  IF has_function_privilege('anon','public.apple_reminder_bridge_exchange(jsonb,jsonb)','EXECUTE')
    OR has_function_privilege('authenticated','public.apple_reminder_bridge_exchange(jsonb,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'bridge RPC exposed';
  END IF;
  IF has_table_privilege('anon','public.reminder_bridge_deliveries','SELECT')
    OR has_table_privilege('authenticated','public.reminder_bridge_deliveries','SELECT') THEN
    RAISE EXCEPTION 'delivery table exposed';
  END IF;
  SELECT actor INTO actor_id FROM private.owner_task_actors LIMIT 1;
  IF actor_id IS NULL THEN RAISE EXCEPTION 'test requires existing authorized owner'; END IF;
  manual_metadata := jsonb_build_object('origin','owner_manual','owner_confirmed',true,'owner_auth_uid',actor_id);

  INSERT INTO public.tasks(title,description,status,confidence,is_suggested,metadata)
    VALUES('WN_FIXTURE_BRIDGE_CREATE_'||gen_random_uuid(),'fictitious bridge fixture','OPEN',1,false,manual_metadata)
    RETURNING id INTO tid;
  SELECT id INTO roid FROM public.reminder_outbox WHERE task_id=tid;
  result := public.apple_reminder_bridge_exchange();
  SELECT value INTO first_cmd FROM jsonb_array_elements(result->'commands') WHERE value->>'task_id'=tid::text;
  IF first_cmd IS NULL OR (first_cmd->>'id')::uuid=roid THEN RAISE EXCEPTION 'delivery id not versioned'; END IF;
  result := public.apple_reminder_bridge_exchange();
  SELECT value INTO replay_cmd FROM jsonb_array_elements(result->'commands') WHERE value->>'task_id'=tid::text;
  IF replay_cmd->>'id' <> first_cmd->>'id' THEN RAISE EXCEPTION 'unacknowledged poll not idempotent'; END IF;

  -- A legacy outbox-ID ack has no provable version and must not sync current data.
  result := public.apple_reminder_bridge_exchange(jsonb_build_array(jsonb_build_object(
    'outbox_id',roid,'ok',true,'apple_reminder_id','fixture.apple.a')));
  SELECT sync_status INTO state FROM public.reminder_outbox WHERE task_id=tid;
  IF state<>'PENDING' THEN RAISE EXCEPTION 'legacy ack overwrote latest'; END IF;

  -- Owner edits while the Mac is executing the original create.
  UPDATE public.tasks SET title=title||'_edited',due_at=now()+interval '1 day',updated_at=now() WHERE id=tid;
  SELECT payload_hash INTO current_hash FROM public.reminder_outbox WHERE task_id=tid;
  result := public.apple_reminder_bridge_exchange(jsonb_build_array(jsonb_build_object(
    'outbox_id',first_cmd->>'id','ok',true,'apple_reminder_id','fixture.apple.a')));
  SELECT sync_status INTO state FROM public.reminder_outbox WHERE task_id=tid;
  IF state<>'PENDING' OR (SELECT payload_hash FROM public.reminder_outbox WHERE task_id=tid)<>current_hash THEN
    RAISE EXCEPTION 'stale ack lost owner update';
  END IF;
  SELECT value INTO newer_cmd FROM jsonb_array_elements(result->'commands') WHERE value->>'task_id'=tid::text;
  IF newer_cmd->>'id'=first_cmd->>'id' OR newer_cmd->>'apple_reminder_id'<>'fixture.apple.a' THEN
    RAISE EXCEPTION 'new version lost Apple mapping';
  END IF;
  PERFORM public.apple_reminder_bridge_exchange(jsonb_build_array(jsonb_build_object(
    'outbox_id',newer_cmd->>'id','ok',true,'apple_reminder_id','fixture.apple.a')));
  IF (SELECT sync_status FROM public.reminder_outbox WHERE task_id=tid)<>'SYNCED' THEN RAISE EXCEPTION 'matching ack not synced'; END IF;
  result := public.apple_reminder_bridge_exchange(jsonb_build_array(jsonb_build_object(
    'outbox_id',first_cmd->>'id','ok',true,'apple_reminder_id','fixture.apple.a')));
  IF (result->'acknowledgements'->>'replayed')::integer<>1 THEN RAISE EXCEPTION 'ack replay not idempotent'; END IF;

  -- Feedback must match the association and must not bypass a pending owner edit.
  UPDATE public.tasks SET due_at=now()+interval '2 days',updated_at=now() WHERE id=tid;
  result := public.apple_reminder_bridge_exchange('[]',jsonb_build_array(jsonb_build_object(
    'task_id',tid,'apple_reminder_id','fixture.apple.a','completed',true,'missing',false)));
  IF (SELECT status FROM public.tasks WHERE id=tid)<>'OPEN' THEN RAISE EXCEPTION 'pending edit overwritten by sampled state'; END IF;
  SELECT value INTO newer_cmd FROM jsonb_array_elements(result->'commands') WHERE value->>'task_id'=tid::text;
  PERFORM public.apple_reminder_bridge_exchange(jsonb_build_array(jsonb_build_object(
    'outbox_id',newer_cmd->>'id','ok',true,'apple_reminder_id','fixture.apple.a')));
  PERFORM public.apple_reminder_bridge_exchange('[]',jsonb_build_array(jsonb_build_object(
    'task_id',tid,'apple_reminder_id','fixture.unrelated.id','completed',true,'missing',false)));
  IF (SELECT status FROM public.tasks WHERE id=tid)<>'OPEN' THEN RAISE EXCEPTION 'unrelated Apple id completed task'; END IF;
  PERFORM public.apple_reminder_bridge_exchange('[]',jsonb_build_array(jsonb_build_object(
    'task_id',tid,'apple_reminder_id','fixture.apple.a','completed',true,'missing',false)));
  SELECT status INTO state FROM public.tasks WHERE id=tid;
  IF state<>'DONE' THEN RAISE EXCEPTION 'matching Apple completion not returned'; END IF;

  -- Cancellation before a create ack must schedule deletion of the created reminder.
  INSERT INTO public.tasks(title,status,confidence,is_suggested,metadata)
    VALUES('WN_FIXTURE_BRIDGE_CANCEL_'||gen_random_uuid(),'OPEN',1,false,manual_metadata) RETURNING id INTO cancel_tid;
  result := public.apple_reminder_bridge_exchange();
  SELECT value INTO first_cmd FROM jsonb_array_elements(result->'commands') WHERE value->>'task_id'=cancel_tid::text;
  UPDATE public.tasks SET status='CANCELLED',updated_at=now() WHERE id=cancel_tid;
  result := public.apple_reminder_bridge_exchange(jsonb_build_array(jsonb_build_object(
    'outbox_id',first_cmd->>'id','ok',true,'apple_reminder_id','fixture.apple.cancel')));
  SELECT sync_status,desired_action INTO state,action FROM public.reminder_outbox WHERE task_id=cancel_tid;
  IF state<>'PENDING' OR action<>'DELETE' THEN RAISE EXCEPTION 'cancelled in-flight create orphaned reminder'; END IF;

  -- Transient errors back off twice, then stop after three failed attempts.
  INSERT INTO public.tasks(title,status,confidence,is_suggested,metadata)
    VALUES('WN_FIXTURE_BRIDGE_RETRY_'||gen_random_uuid(),'OPEN',1,false,manual_metadata) RETURNING id INTO retry_tid;
  result := public.apple_reminder_bridge_exchange();
  SELECT value INTO retry_cmd FROM jsonb_array_elements(result->'commands') WHERE value->>'task_id'=retry_tid::text;
  FOR attempts IN 1..3 LOOP
    result := public.apple_reminder_bridge_exchange(jsonb_build_array(jsonb_build_object(
      'outbox_id',retry_cmd->>'id','ok',false,'error','fixture temporary service unavailable','retryable',true)));
    SELECT sync_status,bridge_next_attempt_at INTO state,next_attempt FROM public.reminder_outbox WHERE task_id=retry_tid;
    IF state<>'ERROR' THEN RAISE EXCEPTION 'failure not visible'; END IF;
    IF attempts<3 THEN
      IF next_attempt IS NULL OR next_attempt<=now() THEN RAISE EXCEPTION 'backoff missing'; END IF;
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(result->'commands') WHERE value->>'task_id'=retry_tid::text) THEN
        RAISE EXCEPTION 'retry sent before backoff';
      END IF;
      UPDATE public.reminder_outbox SET bridge_next_attempt_at=now()-interval '1 second' WHERE task_id=retry_tid;
      result := public.apple_reminder_bridge_exchange();
      SELECT value INTO newer_cmd FROM jsonb_array_elements(result->'commands') WHERE value->>'task_id'=retry_tid::text;
      IF newer_cmd IS NULL OR newer_cmd->>'id'=retry_cmd->>'id' THEN RAISE EXCEPTION 'retry id reused'; END IF;
      retry_cmd := newer_cmd;
    ELSE
      IF next_attempt IS NOT NULL OR (SELECT bridge_error_retryable FROM public.reminder_outbox WHERE task_id=retry_tid) THEN
        RAISE EXCEPTION 'retry limit not enforced';
      END IF;
    END IF;
  END LOOP;
END;
$test$;
ROLLBACK;
