import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeCursor, queryFor, pageItems, runWindow, InvalidPageTokenError, SyncError, googleJson } from './google-sync-core.mjs';

const now = '2026-10-11T08:00:00.000Z';
const seed = () => initializeCursor({ cursor: { sync_version: 2, scope: 'test', watermark_at: '2026-10-11T07:55:00.000Z', window: null } }, now, 'test');
const copy = x => structuredClone(x);

test('first v2 window covers only the current ten minutes and ignores legacy success', () => {
  const cursor = initializeCursor({ last_success_at: '2026-10-11T07:55:00.000Z' }, now, 'test');
  assert.equal(cursor.window.since, '2026-10-11T07:50:00.000Z');
  assert.equal(cursor.coverage_from, '2026-10-11T07:50:00.000Z');
  assert.equal(cursor.initial_window_minutes, 10);
  assert.equal(cursor.initial_replay_days, undefined);
  assert.equal(cursor.watermark_at, null);
  assert.equal(cursor.window.until, now);
});
test('completed v2 window resumes from its validated watermark with 10-minute overlap', () => {
  assert.equal(seed().window.since, '2026-10-11T07:45:00.000Z');
});
test('a persisted window keeps exactly the same bounds and page/IDs after an interruption', () => {
  const cursor = seed();
  cursor.window.page_token = 'p2';
  cursor.window.pending = ['message-remaining'];
  const resumed = initializeCursor({ cursor }, '2026-10-12T08:00:00Z', 'test');
  assert.deepEqual(resumed, cursor);
  assert.throws(() => initializeCursor({ cursor }, now, 'another-account'), /scope_changed/);
});
test('every provider query fixes both window bounds', () => {
  const w = seed().window;
  assert.match(queryFor('gmail', w), /after:\d+ before:\d+ -in:spam -in:trash/);
  assert.match(queryFor('google_chat', w), /createTime > .* AND createTime </);
  assert.match(queryFor('google_drive', w), /modifiedTime > .* and modifiedTime </);
});
test('Google empty lists are valid; malformed lists/tokens are not silently accepted', () => {
  assert.deepEqual(pageItems({}, 'messages', 'id'), { items: [], nextPageToken: null });
  assert.throws(() => pageItems({ messages: {} }, 'messages', 'id'), /invalid_google_list/);
  assert.throws(() => pageItems({ messages: [{ id: '' }] }, 'messages', 'id'), /invalid_google_list/);
  assert.throws(() => pageItems({ nextPageToken: 25 }, 'messages', 'id'), /invalid_google_list/);
});
for (const [source, count, pageSize] of [['gmail', 225, 25], ['google_chat', 275, 100], ['google_drive', 425, 25]]) {
  test(source + ' drains multiple pages beyond the previous cap across invocations', async () => {
    let cursor = seed(), durable, iterations = 0, inserted = 0;
    const visited = new Set(), bounds = [];
    while (cursor.window) {
      const result = await runWindow({
        cursor, maxItems: 80, maxPages: 5,
        checkpoint: async value => { durable = copy(value); },
        fetchPage: async w => {
          bounds.push([w.since, w.until]);
          const offset = Number(w.page_token || 0);
          return { items: Array.from({ length: Math.min(pageSize, count - offset) }, (_, i) => 'id-' + (offset + i)),
            nextPageToken: offset + pageSize < count ? String(offset + pageSize) : null };
        },
        processItem: async id => {
          assert.equal(visited.has(id), false);
          visited.add(id); return 'inserted';
        },
      });
      assert.equal(result.error, null);
      inserted += result.metrics.inserted;
      if (!result.complete) { assert.notEqual(result.cursor.watermark_at, now); cursor = durable; }
      else cursor = result.cursor;
      assert.ok(++iterations < 20);
    }
    assert.equal(visited.size, count);
    assert.equal(inserted, count);
    assert.ok(bounds.every(([from, to]) => from === bounds[0][0] && to === now));
    assert.equal(cursor.watermark_at, now);
  });
}
test('failed item stays queued; success watermark cannot advance', async () => {
  let durable;
  const processed = [];
  const result = await runWindow({ cursor: seed(), checkpoint: async c => { durable = copy(c); },
    fetchPage: async () => ({ items: ['a','b','c'], nextPageToken: null }),
    processItem: async id => { if (id === 'b') throw new SyncError('database_unavailable'); processed.push(id); return 'inserted'; },
  });
  assert.equal(result.complete, false);
  assert.deepEqual(durable.window.pending, ['b','c']);
  assert.notEqual(durable.watermark_at, now);
  const retry = await runWindow({ cursor: durable, checkpoint: async () => {},
    fetchPage: async () => { throw Error('must resume queue without refetch'); },
    processItem: async id => { processed.push(id); return 'inserted'; },
  });
  assert.equal(retry.complete, true);
  assert.deepEqual(processed, ['a','b','c']);
});
test('crash after event commit but before checkpoint safely replays as duplicate', async () => {
  let durable, saves = 0;
  const written = new Set();
  const processItem = async id => { const exists = written.has(id); written.add(id); return exists ? 'duplicate' : 'inserted'; };
  const result = await runWindow({ cursor: seed(), fetchPage: async () => ({ items: ['a','b'], nextPageToken: null }),
    processItem, checkpoint: async c => {
      if (++saves === 3) throw new SyncError('checkpoint_unavailable');
      durable = copy(c);
    },
  });
  assert.equal(result.complete, false);
  assert.deepEqual(durable.window.pending, ['a','b']);
  const resumed = await runWindow({ cursor: durable, checkpoint: async () => {},
    fetchPage: async () => { throw Error('refetch'); }, processItem });
  assert.equal(resumed.metrics.duplicates, 1);
  assert.equal(resumed.metrics.inserted, 1);
  assert.equal(written.size, 2);
  assert.equal(resumed.complete, true);
});
test('invalid page token restarts the same window and deduplicates earlier pages', async () => {
  const cursor = seed();
  cursor.window.page_token = 'expired';
  const seen = new Set(['a']);
  const queries = [];
  const result = await runWindow({ cursor, checkpoint: async () => {},
    fetchPage: async w => {
      queries.push([w.since,w.until]);
      if (w.page_token === 'expired') throw new InvalidPageTokenError();
      return { items: ['a','b'], nextPageToken: null };
    },
    processItem: async id => { const duplicate = seen.has(id); seen.add(id); return duplicate ? 'duplicate' : 'inserted'; },
  });
  assert.equal(result.complete, true);
  assert.equal(result.metrics.page_token_resets, 1);
  assert.equal(result.metrics.duplicates, 1);
  assert.equal(result.metrics.inserted, 1);
  assert.deepEqual(queries[0], queries[1]);
});
test('runtime budget preserves the remaining item queue and cannot mark the window successful', async () => {
  let tick = 0, durable;
  const result = await runWindow({ cursor: seed(), budgetMs: 5, clock: () => tick,
    checkpoint: async c => { durable = copy(c); }, fetchPage: async () => ({ items: ['a','b'], nextPageToken: null }),
    processItem: async () => { tick += 10; return 'inserted'; },
  });
  assert.equal(result.complete, false);
  assert.deepEqual(durable.window.pending, ['b']);
});
test('maxItems exactly at final page end completes the window', async () => {
  const result = await runWindow({ cursor: seed(), maxItems: 1, checkpoint: async () => {},
    fetchPage: async () => ({ items: ['a'], nextPageToken: null }), processItem: async () => 'inserted' });
  assert.equal(result.complete, true);
});
test('lease loss prevents processing any new event', async () => {
  let calls = 0;
  await assert.rejects(runWindow({ cursor: seed(), checkpoint: async () => { throw new SyncError('connector_lease_lost'); },
    fetchPage: async () => { calls++; return { items: [], nextPageToken: null }; }, processItem: async () => 'inserted' }), /lease_lost/);
  assert.equal(calls, 0);
});
test('a repeated page token is a failure, not a successful truncated sync', async () => {
  const cursor = seed(); cursor.window.page_token = 'same';
  const result = await runWindow({ cursor, checkpoint: async () => {},
    fetchPage: async () => ({ items: [], nextPageToken: 'same' }), processItem: async () => 'inserted' });
  assert.equal(result.complete, false);
  assert.match(result.error.code, /token_loop/);
});
test('HTTP error details containing secrets are never exposed', async () => {
  await assert.rejects(googleJson('https://example.test', 'test-token', {
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'secret-user-data' } }), { status: 403 }),
  }), error => error.code === 'google_http_403' && !error.message.includes('secret-user-data'));
});
test('deleted resources are acknowledged as missing without treating 403 as missing', async () => {
  assert.equal(await googleJson('https://example.test', 'test-token', {
    allowMissing: true, fetchImpl: async () => new Response('', { status: 404 }),
  }), null);
});
