import { initializeCursor, runWindow, SyncError } from './google-sync-core.mjs';

const reply = (body, status = 200) => Response.json(body, { status,
  headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
const sha256 = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
  .map(x => x.toString(16).padStart(2, '0')).join('');
export async function refreshGoogleAccessToken(env, fetchImpl = fetch) {
  let oauth;
  try { oauth = JSON.parse(env('GOOGLE_OAUTH_JSON') || '{}'); }
  catch { throw new SyncError('invalid_google_oauth_json', 503); }
  if (!oauth.client_id || !oauth.client_secret || !oauth.refresh_token)
    throw new SyncError('incomplete_google_oauth_json', 503);
  let response;
  try {
    response = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: oauth.client_id, client_secret: oauth.client_secret,
        refresh_token: oauth.refresh_token, grant_type: 'refresh_token' }),
    });
  } catch { throw new SyncError('google_oauth_unreachable'); }
  let data;
  try { data = await response.json(); } catch { throw new SyncError('google_oauth_invalid_response'); }
  if (!response.ok || typeof data.access_token !== 'string' || !data.access_token)
    throw new SyncError('google_token_refresh_failed');
  return data.access_token;
}
async function checkedRpc(sb, name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new SyncError('connector_checkpoint_unavailable', 503);
  return data;
}
export function createSyncHandler({ source, createClient, createProvider, env = key => Deno.env.get(key),
  now = () => new Date().toISOString(), uuid = () => crypto.randomUUID() }) {
  return async req => {
    if (req.method !== 'POST') return reply({ ok: false, error: 'method_not_allowed' }, 405);
    const trigger = req.headers.get('x-sync-token');
    if (!trigger) return reply({ ok: false, error: 'missing_sync_token' }, 401);
    let sb, runId, leased = false, result;
    try {
      let bag;
      try { bag = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}'); } catch { bag = {}; }
      const base = env('SUPABASE_URL'), key = bag.default || env('SUPABASE_SERVICE_ROLE_KEY');
      if (!base || !key) throw new SyncError('missing_supabase_server_credentials', 503);
      sb = createClient(base, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const purposes = source === 'google_chat'
        ? ['google_chat_sync_cron', 'google_chat_sync_test']
        : [source === 'gmail' ? 'gmail_sync_cron' : 'google_drive_sync_cron'];
      const { data: token, error: tokenError } = await sb.from('sync_trigger_tokens')
        .select('id,purpose').eq('token_hash', await sha256(trigger)).in('purpose', purposes)
        .is('used_at', null).gt('expires_at', now()).maybeSingle();
      if (tokenError) throw new SyncError('connector_auth_unavailable', 503);
      if (!token) return reply({ ok: false, error: 'invalid_or_expired_sync_token' }, 401);
      runId = uuid();
      const state = await checkedRpc(sb, 'claim_connector_sync', { p_source: source, p_owner: runId });
      if (!state) return reply({ ok: true, source, status: 'busy', complete: false }, 202);
      leased = true;
      if (token.purpose === 'google_chat_sync_test') {
        const { data: used, error } = await sb.from('sync_trigger_tokens').update({ used_at: now() })
          .eq('id', token.id).is('used_at', null).select('id').maybeSingle();
        if (error || !used) throw new SyncError('sync_token_already_used', 409);
      }
      const accessToken = await refreshGoogleAccessToken(env);
      const provider = await createProvider({ sb, accessToken, state, env });
      const cursor = initializeCursor(state, now(), provider.scope);
      result = await runWindow({ cursor, fetchPage: provider.fetchPage, processItem: provider.processItem,
        checkpoint: async next => {
          const ok = await checkedRpc(sb, 'checkpoint_connector_sync', {
            p_source: source, p_owner: runId, p_cursor: next,
          });
          if (!ok) throw new SyncError('connector_lease_lost', 409);
        },
      });
      const status = result.error ? (result.metrics.processed ? 'partial' : 'failed') : (result.complete ? 'success' : 'partial');
      const ok = await checkedRpc(sb, 'finish_connector_sync', {
        p_source: source, p_owner: runId, p_cursor: result.cursor,
        p_status: status, p_error: result.error?.code || (result.metrics.limited ? 'drive_text_too_large' : null),
        p_watermark: result.complete ? result.cursor.watermark_at : null, p_metrics: result.metrics,
      });
      if (!ok) throw new SyncError('connector_lease_lost', 409);
      leased = false;
      return reply({ ok: !result.error, source, status, complete: result.complete,
        fetched: result.metrics.fetched, processed: result.metrics.processed,
        inserted: result.metrics.inserted, duplicates: result.metrics.duplicates, skipped: result.metrics.skipped,
        limited: result.metrics.limited, ...(result.metrics.limited ? { warning: 'drive_text_too_large' } : {}),
        failed: result.metrics.failed, pages: result.metrics.pages,
        resume_pending: !result.complete, ...(result.error ? { error: result.error.code } : {}),
      }, result.error ? result.error.status : (result.complete ? 200 : 202));
    } catch (error) {
      const safe = error instanceof SyncError ? error : new SyncError('connector_sync_failed', 500);
      if (leased && sb && runId) {
        try {
          // NULL keeps the last successfully persisted checkpoint, including an unfinished page.
          await checkedRpc(sb, 'finish_connector_sync', {
            p_source: source, p_owner: runId, p_cursor: null, p_status: 'failed', p_error: safe.code,
            p_watermark: null, p_metrics: result?.metrics || {},
          });
        } catch { /* Expiring lease lets the next cron resume the durable checkpoint. */ }
      }
      console.error(source, safe.code);
      return reply({ ok: false, source, complete: false, error: safe.code }, safe.status);
    }
  };
}
// Return inserted versus replayed rows separately; overlap is normal, not new events.
export async function insertRawEvent(sb, row) {
  const { data, error } = await sb.from('raw_events')
    .upsert(row, { onConflict: 'source,external_id', ignoreDuplicates: true }).select('id');
  if (error) throw new SyncError('raw_event_write_failed', 503);
  if (!Array.isArray(data)) throw new SyncError('raw_event_write_unverifiable', 503);
  return data.length ? 'inserted' : 'duplicate';
}
