-- Run in a transaction and ROLLBACK. No fixtures may reach the Mac bridge.
do $$
declare actor uuid; rid uuid:=gen_random_uuid(); result jsonb; replay jsonb; v_task_id uuid; version timestamptz; suggestion uuid:=gen_random_uuid(); extra uuid; title text;
begin
 select u.actor into actor from private.owner_task_actors u join public.app_access_users a on u.email=a.email where a.role='owner' and a.is_active limit 1;
 assert actor is not null,'owner fixture required';
 assert not has_function_privilege('anon','public.api_owner_task_mutate(uuid,uuid,text,uuid,timestamptz,jsonb)','EXECUTE'),'anon mutation forbidden';
 assert not has_function_privilege('authenticated','public.api_owner_tasks_list(text,uuid,text,integer)','EXECUTE'),'direct authenticated list forbidden';
 result:=public.api_owner_task_mutate(rid,actor,'create',null,null,jsonb_build_object('title','Integration task '||rid::text,'description','Synthetic test','due_at','2026-10-12T08:00:00Z'));
 assert (result->>'ok')::boolean and not (result->>'duplicate')::boolean,'create';v_task_id:=(result->>'task_id')::uuid;
 assert exists(select 1 from public.reminder_outbox where task_id=v_task_id and sync_status='PENDING' and desired_action='CREATE_OR_UPDATE'),'manual outbox queued';
 replay:=public.api_owner_task_mutate(rid,actor,'create',null,null,jsonb_build_object('title','Integration task '||rid::text,'description','Synthetic test','due_at','2026-10-12T08:00:00Z'));
 assert replay=result,'idempotent retry must return same result';
 replay:=public.api_owner_task_mutate(rid,actor,'create',null,null,jsonb_build_object('title','Different payload'));
 assert replay->>'error'='idempotency_conflict','request id reuse forbidden';
 replay:=public.api_owner_task_mutate(gen_random_uuid(),actor,'create',null,null,jsonb_build_object('title','Integration task '||rid::text));
 assert (replay->>'duplicate')::boolean and (replay->>'task_id')::uuid=v_task_id,'exact duplicate prevented';
 select updated_at into version from public.tasks where id=v_task_id;
 replay:=public.api_owner_task_mutate(gen_random_uuid(),actor,'edit',v_task_id,version-interval '1 second',jsonb_build_object('due_at','2026-10-13T08:00:00Z'));
 assert replay->>'error'='task_conflict','stale edit forbidden';
 result:=public.api_owner_task_mutate(gen_random_uuid(),actor,'edit',v_task_id,version,jsonb_build_object('due_at','2026-10-13T08:00:00Z'));
 assert (result->>'ok')::boolean,'defer';
 assert exists(select 1 from public.tasks where id=v_task_id and due_at='2026-10-13T08:00:00Z'::timestamptz),'new due date saved';
 assert exists(select 1 from public.reminder_outbox ro where ro.task_id=v_task_id and ro.due_at='2026-10-13T08:00:00Z'::timestamptz),'due propagated atomically';
 select updated_at into version from public.tasks where id=v_task_id;
 result:=public.api_owner_task_mutate(gen_random_uuid(),actor,'complete',v_task_id,version);
 assert (result->>'ok')::boolean,'complete';
 assert exists(select 1 from public.tasks where id=v_task_id and status='DONE' and completed_at is not null),'completed timestamp';
 insert into public.tasks(id,title,status,is_suggested,confidence) values(suggestion,'Synthetic suggestion '||rid::text,'OPEN',true,0.4);
 assert exists(select 1 from public.reminder_outbox ro where ro.task_id=suggestion and ro.sync_status='IGNORED'),'unconfirmed not sent';
 select updated_at into version from public.tasks where id=suggestion;
 result:=public.api_owner_task_mutate(gen_random_uuid(),actor,'approve',suggestion,version);
 assert (result->>'ok')::boolean,'approve';
 assert exists(select 1 from public.reminder_outbox ro where ro.task_id=suggestion and ro.sync_status='PENDING'),'explicit approval queued';
 assert (public.api_owner_tasks_list('DONE',null,'Integration task '||rid::text)->>'total')::integer=1,'done filter';
 -- Owner creation explicitly accepts an existing suggestion instead of silently losing the reminder.
 title:='Synthetic duplicate suggestion '||rid::text;
 insert into public.tasks(title,status,is_suggested,confidence) values(title,'OPEN',true,0.4) returning id into extra;
 result:=public.api_owner_task_mutate(gen_random_uuid(),actor,'create',null,null,jsonb_build_object('title',title,'due_at','2026-10-14T08:00:00Z'));
 assert (result->>'existing_suggestion_approved')::boolean and (result->>'task_id')::uuid=extra,'manual entry accepts exact suggestion';
 assert exists(select 1 from public.reminder_outbox ro where ro.task_id=extra and sync_status='PENDING'),'accepted duplicate queued';
 -- Editing an older accepted extraction explicitly takes responsibility for it.
 insert into public.tasks(title,status,is_suggested,confidence) values('Synthetic old action '||rid::text,'OPEN',false,0.4) returning id into extra;
 select updated_at into version from public.tasks where id=extra;
 result:=public.api_owner_task_mutate(gen_random_uuid(),actor,'edit',extra,version,jsonb_build_object('due_at','2026-10-15T08:00:00Z'));
 assert (result->>'ok')::boolean,'old action defer';
 assert exists(select 1 from public.reminder_outbox ro where ro.task_id=extra and sync_status='PENDING'),'explicitly deferred old action queued';
 -- Retry an Apple failure without recreating the task or changing its requested action.
 update public.reminder_outbox set sync_status='ERROR',last_error='synthetic failure' where task_id=extra;
 select updated_at into version from public.tasks where id=extra;
 result:=public.api_owner_task_mutate(gen_random_uuid(),actor,'resync',extra,version);
 assert (result->>'ok')::boolean,'manual Apple retry';
 assert exists(select 1 from public.reminder_outbox ro where ro.task_id=extra and sync_status='PENDING' and last_error is null),'Apple retry queued';
end;
$$;
