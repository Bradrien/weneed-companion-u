-- Versioned delivery IDs work with the installed Swift bridge, which echoes
-- command.id in acknowledgements but does not echo payload_hash.
ALTER TABLE public.reminder_outbox
  ADD COLUMN bridge_attempt_count integer NOT NULL DEFAULT 0 CHECK (bridge_attempt_count >= 0),
  ADD COLUMN bridge_retry_hash text,
  ADD COLUMN bridge_next_attempt_at timestamptz,
  ADD COLUMN bridge_error_retryable boolean NOT NULL DEFAULT false;

CREATE TABLE public.reminder_bridge_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id uuid NOT NULL REFERENCES public.reminder_outbox(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  payload_hash text NOT NULL,
  desired_action text NOT NULL CHECK (desired_action IN ('CREATE_OR_UPDATE','COMPLETE','DELETE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 day',
  acknowledged_at timestamptz,
  acknowledgement_ok boolean
);
CREATE INDEX reminder_bridge_deliveries_current_idx
  ON public.reminder_bridge_deliveries(outbox_id,payload_hash,desired_action)
  WHERE acknowledged_at IS NULL;
ALTER TABLE public.reminder_bridge_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reminder_bridge_deliveries FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.reminder_bridge_deliveries TO service_role;

CREATE OR REPLACE FUNCTION public.apple_reminder_bridge_exchange(
  p_acknowledgements jsonb DEFAULT '[]'::jsonb,
  p_local_states jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE
  a jsonb; s jsonb; t public.tasks%rowtype; ro public.reminder_outbox%rowtype;
  d public.reminder_bridge_deliveries%rowtype; candidate record;
  v_apple_id text; v_ok boolean; v_failures integer;
  v_commands jsonb := '[]'::jsonb; v_tracked jsonb;
  v_applied integer := 0; v_stale integer := 0; v_replayed integer := 0;
  v_rejected integer := 0; v_completed integer := 0; v_missing integer := 0;
  v_locked_task_ids uuid[];
BEGIN
  IF jsonb_typeof(p_acknowledgements) IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_local_states) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_acknowledgements) > 50
    OR jsonb_array_length(p_local_states) > 200 THEN
    RAISE EXCEPTION 'invalid_bridge_request' USING ERRCODE = '22023';
  END IF;

  -- Lock all tasks this exchange may touch in UUID order, matching two-task
  -- owner merges. Requests arriving during this exchange wait for the next poll.
  SELECT coalesce(array_agg(DISTINCT task_id),'{}'::uuid[]) INTO v_locked_task_ids FROM (
    SELECT dd.task_id FROM public.reminder_bridge_deliveries dd
      WHERE dd.id IN (SELECT (value->>'outbox_id')::uuid FROM jsonb_array_elements(p_acknowledgements))
    UNION
    SELECT (value->>'task_id')::uuid FROM jsonb_array_elements(p_local_states)
    UNION
    SELECT picked.task_id FROM (
      SELECT task_id FROM public.reminder_outbox
      WHERE sync_status='PENDING' OR (sync_status='ERROR' AND bridge_error_retryable
        AND bridge_attempt_count<3 AND bridge_retry_hash=payload_hash AND bridge_next_attempt_at<=now())
      ORDER BY updated_at,id LIMIT 50
    ) picked
  ) touched;
  PERFORM 1 FROM public.tasks WHERE id=ANY(v_locked_task_ids) ORDER BY id FOR UPDATE;

  FOR a IN SELECT value FROM jsonb_array_elements(p_acknowledgements) LOOP
    SELECT * INTO d FROM public.reminder_bridge_deliveries WHERE id=(a->>'outbox_id')::uuid;
    IF NOT FOUND THEN
      -- Old outbox-ID acknowledgements have no provable delivered version.
      -- Reject them; the next poll safely retries with a delivery ID.
      v_rejected := v_rejected+1; CONTINUE;
    END IF;
    -- Same lock order as task actions/triggers: task, outbox, delivery.
    SELECT * INTO t FROM public.tasks WHERE id=d.task_id FOR UPDATE;
    IF NOT FOUND THEN v_rejected := v_rejected+1; CONTINUE; END IF;
    SELECT * INTO ro FROM public.reminder_outbox WHERE id=d.outbox_id FOR UPDATE;
    IF NOT FOUND THEN v_rejected := v_rejected+1; CONTINUE; END IF;
    SELECT * INTO d FROM public.reminder_bridge_deliveries WHERE id=d.id FOR UPDATE;
    IF d.acknowledged_at IS NOT NULL THEN v_replayed := v_replayed+1; CONTINUE; END IF;
    v_ok := coalesce((a->>'ok')::boolean,false);
    v_apple_id := nullif(a->>'apple_reminder_id','');
    IF v_ok AND d.desired_action='CREATE_OR_UPDATE' AND v_apple_id IS NULL THEN
      v_rejected := v_rejected+1; CONTINUE;
    END IF;

    IF ro.payload_hash IS DISTINCT FROM d.payload_hash OR ro.desired_action <> d.desired_action THEN
      -- A create may succeed while its task is edited, completed or cancelled.
      -- Retain the newly created Apple ID and refresh the current intention so
      -- that a later COMPLETE/DELETE can clean it up instead of orphaning it.
      IF v_ok AND d.desired_action='CREATE_OR_UPDATE' AND v_apple_id IS NOT NULL
        AND ro.apple_reminder_id IS NULL THEN
        UPDATE public.reminder_outbox SET apple_reminder_id=v_apple_id WHERE id=ro.id;
        PERFORM public.refresh_reminder_outbox_for_task(t.id);
      END IF;
      UPDATE public.reminder_bridge_deliveries SET acknowledged_at=now(),acknowledgement_ok=v_ok WHERE id=d.id;
      v_stale := v_stale+1; CONTINUE;
    END IF;

    IF v_ok THEN
      UPDATE public.reminder_outbox SET sync_status='SYNCED',
        apple_reminder_id=CASE WHEN d.desired_action='DELETE' THEN NULL ELSE coalesce(v_apple_id,apple_reminder_id) END,
        last_error=NULL,last_attempt_at=now(),synced_at=now(),updated_at=now(),
        bridge_attempt_count=0,bridge_retry_hash=NULL,bridge_next_attempt_at=NULL,bridge_error_retryable=false
      WHERE id=ro.id;
    ELSE
      v_failures := CASE WHEN ro.bridge_retry_hash=d.payload_hash THEN ro.bridge_attempt_count ELSE 0 END + 1;
      UPDATE public.reminder_outbox SET sync_status='ERROR',
        last_error=left(coalesce(a->>'error','apple_bridge_operation_failed'),1000),
        last_attempt_at=now(),updated_at=now(),bridge_retry_hash=d.payload_hash,
        bridge_attempt_count=v_failures,
        bridge_error_retryable=coalesce((a->>'retryable')::boolean,false) AND v_failures<3,
        bridge_next_attempt_at=CASE
          WHEN coalesce((a->>'retryable')::boolean,false) AND v_failures<3
          THEN now()+CASE WHEN v_failures=1 THEN interval '2 minutes' ELSE interval '5 minutes' END
          ELSE NULL END
      WHERE id=ro.id;
    END IF;
    UPDATE public.reminder_bridge_deliveries SET acknowledged_at=now(),acknowledgement_ok=v_ok WHERE id=d.id;
    v_applied := v_applied+1;
  END LOOP;

  FOR s IN SELECT value FROM jsonb_array_elements(p_local_states) LOOP
    SELECT * INTO t FROM public.tasks WHERE id=(s->>'task_id')::uuid FOR UPDATE;
    IF NOT FOUND OR t.status <> 'OPEN' THEN CONTINUE; END IF;
    SELECT * INTO ro FROM public.reminder_outbox WHERE task_id=t.id FOR UPDATE;
    -- A sampled Apple state must refer to the currently associated reminder,
    -- with no owner update waiting to be delivered. Never trust task_id alone.
    IF NOT FOUND OR ro.sync_status <> 'SYNCED' OR ro.desired_action <> 'CREATE_OR_UPDATE'
      OR ro.apple_reminder_id IS DISTINCT FROM s->>'apple_reminder_id' THEN CONTINUE; END IF;
    IF coalesce((s->>'completed')::boolean,false) THEN
      UPDATE public.tasks SET status='DONE',
        completed_at=coalesce((s->>'completed_at')::timestamptz,now()),updated_at=now(),
        metadata=metadata || jsonb_build_object('completion_source','apple_reminders','apple_reminder_id',ro.apple_reminder_id)
      WHERE id=t.id AND status='OPEN';
      v_completed := v_completed+1;
    ELSIF coalesce((s->>'missing')::boolean,false) THEN
      PERFORM public.refresh_reminder_outbox_for_task(t.id);
      UPDATE public.reminder_outbox SET sync_status='PENDING',
        last_error='apple_reminder_missing_locally',updated_at=now()
      WHERE task_id=t.id AND desired_action='CREATE_OR_UPDATE';
      v_missing := v_missing+1;
    END IF;
  END LOOP;

  FOR candidate IN
    SELECT id,task_id FROM public.reminder_outbox
    WHERE task_id=ANY(v_locked_task_ids) AND (sync_status='PENDING' OR (sync_status='ERROR' AND bridge_error_retryable
      AND bridge_attempt_count<3 AND bridge_retry_hash=payload_hash AND bridge_next_attempt_at<=now()))
    ORDER BY updated_at,id LIMIT 50
  LOOP
    SELECT * INTO t FROM public.tasks WHERE id=candidate.task_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT * INTO ro FROM public.reminder_outbox WHERE id=candidate.id FOR UPDATE;
    IF NOT FOUND OR (ro.sync_status<>'PENDING' AND NOT (ro.sync_status='ERROR'
      AND ro.bridge_error_retryable AND ro.bridge_attempt_count<3
      AND ro.bridge_retry_hash=ro.payload_hash AND ro.bridge_next_attempt_at<=now())) THEN CONTINUE; END IF;
    IF ro.payload_hash IS NULL THEN CONTINUE; END IF;
    IF ro.bridge_retry_hash IS DISTINCT FROM ro.payload_hash THEN
      UPDATE public.reminder_outbox SET bridge_attempt_count=0,bridge_retry_hash=NULL,
        bridge_next_attempt_at=NULL,bridge_error_retryable=false WHERE id=ro.id;
    END IF;
    IF ro.sync_status='ERROR' THEN
      UPDATE public.reminder_outbox SET sync_status='PENDING',bridge_next_attempt_at=NULL WHERE id=ro.id;
    END IF;
    SELECT * INTO d FROM public.reminder_bridge_deliveries
      WHERE outbox_id=ro.id AND payload_hash=ro.payload_hash AND desired_action=ro.desired_action
        AND acknowledged_at IS NULL AND expires_at>now()
      ORDER BY created_at DESC LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO public.reminder_bridge_deliveries(outbox_id,task_id,payload_hash,desired_action)
        VALUES(ro.id,t.id,ro.payload_hash,ro.desired_action) RETURNING * INTO d;
    END IF;
    v_commands := v_commands || jsonb_build_array(jsonb_build_object(
      'id',d.id,'outbox_id',ro.id,'task_id',ro.task_id,'desired_action',ro.desired_action,
      'title',ro.title,'notes',ro.notes,'due_at',ro.due_at,'apple_reminder_id',ro.apple_reminder_id,
      'payload_hash',ro.payload_hash,'updated_at',ro.updated_at));
  END LOOP;

  SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO v_tracked FROM (
    SELECT r.task_id,r.apple_reminder_id,r.title,r.due_at
    FROM public.reminder_outbox r JOIN public.tasks tt ON tt.id=r.task_id
    WHERE r.sync_status='SYNCED' AND r.desired_action='CREATE_OR_UPDATE'
      AND r.apple_reminder_id IS NOT NULL AND tt.status='OPEN'
    ORDER BY r.updated_at,r.id LIMIT 200
  ) x;
  RETURN jsonb_build_object('ok',true,'protocol_version',2,'commands',v_commands,'tracked',v_tracked,
    'acknowledgements',jsonb_build_object('applied',v_applied,'stale',v_stale,'replayed',v_replayed,'rejected',v_rejected),
    'local_updates',jsonb_build_object('completed',v_completed,'missing',v_missing));
END;
$function$;
REVOKE ALL ON FUNCTION public.apple_reminder_bridge_exchange(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apple_reminder_bridge_exchange(jsonb,jsonb) TO service_role;
