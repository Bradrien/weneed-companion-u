// Cursor contains provider IDs and opaque page tokens only, never message/file contents.
export class SyncError extends Error {
  constructor(code, status = 502) { super(code); this.code = code; this.status = status; }
}
export class InvalidPageTokenError extends SyncError {
  constructor() { super('google_page_token_invalid'); }
}
const iso = value => {
  const n = Date.parse(value);
  if (!Number.isFinite(n)) throw new SyncError('invalid_sync_timestamp', 500);
  return new Date(n).toISOString();
};
export function initializeCursor(state, now, scope) {
  const previous = state?.cursor || {};
  if (previous.sync_version === 2 && previous.scope !== scope)
    throw new SyncError('connector_scope_changed', 409);
  if (previous.sync_version === 2 && previous.window) {
    const result = structuredClone(previous);
    const w = result.window;
    if (Date.parse(iso(w.since)) >= Date.parse(iso(w.until)) ||
        ![null, 'string'].includes(w.page_token === null ? null : typeof w.page_token) ||
        !(w.pending === null || (Array.isArray(w.pending) && w.pending.every(x => typeof x === 'string'))))
      throw new SyncError('invalid_sync_cursor', 500);
    return result;
  }
  const until = iso(now);
  // Legacy last_success_at cannot establish coverage. Start in the current ten-minute
  // window only; any wider catch-up needs a separate authorized operation.
  const watermark = previous.sync_version === 2 ? previous.watermark_at : null;
  const since = new Date(watermark ? Date.parse(iso(watermark)) - 600_000 : Date.parse(until) - 600_000).toISOString();
  if (Date.parse(since) >= Date.parse(until)) throw new SyncError('sync_watermark_in_future', 500);
  return {
    sync_version: 2, scope,
    coverage_from: previous.sync_version === 2 ? previous.coverage_from || since : since,
    initial_window_minutes: previous.initial_window_minutes || 10,
    watermark_at: watermark || null,
    // Preserve a previously configured Chat space without putting it in source code.
    ...(previous.space ? { space: previous.space } : {}),
    window: { since, until, page_token: null, pending: null, next_page_token: null },
  };
}
export function queryFor(source, window) {
  const since = iso(window.since), until = iso(window.until);
  if (source === 'gmail')
    return `after:${Math.max(0, Math.floor(Date.parse(since) / 1000) - 1)} before:${Math.ceil(Date.parse(until) / 1000)} -in:spam -in:trash`;
  if (source === 'google_chat') return `createTime > "${since}" AND createTime < "${until}"`;
  if (source === 'google_drive') return `trashed = false and modifiedTime > '${since}' and modifiedTime < '${until}'`;
  throw new SyncError('unknown_connector', 500);
}
export function pageItems(payload, field, idField) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new SyncError('invalid_google_list_response');
  const items = payload[field] ?? [];
  if (!Array.isArray(items) || items.some(x => !x || typeof x[idField] !== 'string' || !x[idField]))
    throw new SyncError('invalid_google_list_response');
  if (payload.nextPageToken != null && typeof payload.nextPageToken !== 'string')
    throw new SyncError('invalid_google_list_response');
  return { items: items.map(x => x[idField]), nextPageToken: payload.nextPageToken || null };
}
// Every successful item is committed before its ID is removed from the durable queue.
// Replaying after a failed checkpoint is safe because provider IDs are unique in raw_events.
export async function runWindow({ cursor, fetchPage, processItem, checkpoint,
  clock = Date.now, budgetMs = 80_000, maxItems = 200, maxPages = 10 }) {
  cursor = structuredClone(cursor);
  const metrics = { fetched: 0, processed: 0, inserted: 0, duplicates: 0, skipped: 0, limited: 0, failed: 0, pages: 0, page_token_resets: 0 };
  const deadline = clock() + budgetMs;
  const save = async () => checkpoint(structuredClone(cursor));
  await save();
  try {
    while (cursor.window) {
      const w = cursor.window;
      // Finalize/advance an exhausted page before applying the budget; otherwise maxItems
      // at a page boundary would leave a completed window looking incomplete.
      if (Array.isArray(w.pending) && w.pending.length === 0) {
        if (!w.next_page_token) {
          cursor.watermark_at = w.until;
          cursor.window = null;
          break;
        }
        if (w.next_page_token === w.page_token) throw new SyncError('google_page_token_loop');
        w.page_token = w.next_page_token;
        w.next_page_token = null;
        w.pending = null;
        await save();
      }
      if (clock() >= deadline || metrics.processed >= maxItems || (w.pending === null && metrics.pages >= maxPages)) break;
      if (w.pending === null) {
        let page;
        try { page = await fetchPage(structuredClone(w)); }
        catch (error) {
          if (!(error instanceof InvalidPageTokenError) || !w.page_token || metrics.page_token_resets >= 1) throw error;
          // Restart the SAME bounded window; never skip ahead after an expired token.
          w.page_token = null;
          w.next_page_token = null;
          w.pending = null;
          metrics.page_token_resets++;
          await save();
          continue;
        }
        if (!Array.isArray(page.items) || page.items.some(id => typeof id !== 'string' || !id))
          throw new SyncError('invalid_google_list_response');
        metrics.fetched += page.items.length;
        metrics.pages++;
        w.pending = [...page.items];
        w.next_page_token = page.nextPageToken || null;
        await save();
        continue;
      }
      const itemResult = await processItem(w.pending[0]);
      const outcome = typeof itemResult === 'string' ? itemResult : itemResult?.outcome;
      if (!['inserted', 'duplicate', 'skipped'].includes(outcome)) throw new SyncError('invalid_processing_result', 500);
      if (itemResult?.limitation === 'drive_text_too_large') metrics.limited++;
      metrics.processed++;
      metrics[outcome === 'duplicate' ? 'duplicates' : outcome]++;
      w.pending.shift();
      await save();
    }
    return { cursor, metrics, complete: cursor.window === null, error: null };
  } catch (error) {
    metrics.failed++;
    return { cursor, metrics, complete: false, error: error instanceof SyncError ? error : new SyncError('connector_sync_failed', 500) };
  }
}
export async function googleFetch(url, accessToken, { fetchImpl = fetch, pageToken = null, allowMissing = false } = {}) {
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetchImpl(url, {
        headers: { Authorization: 'Bearer ' + accessToken },
        redirect: 'error', signal: AbortSignal.timeout(10_000),
      });
    } catch {
      if (attempt === 1) throw new SyncError('google_request_failed');
      continue;
    }
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 1) break;
    await response.body?.cancel();
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  if (allowMissing && [404, 410].includes(response.status)) return null;
  if (!response.ok) {
    await response.body?.cancel();
    if (pageToken && [400, 410].includes(response.status)) throw new InvalidPageTokenError();
    throw new SyncError('google_http_' + response.status);
  }
  return response;
}
export async function googleJson(url, accessToken, options) {
  const response = await googleFetch(url, accessToken, options);
  if (!response) return null;
  try { return await response.json(); }
  catch { throw new SyncError('invalid_google_response'); }
}
