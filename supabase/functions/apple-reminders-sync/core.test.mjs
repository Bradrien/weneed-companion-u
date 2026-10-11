import test from 'node:test';
import assert from 'node:assert/strict';
import { BridgeInputError, parseBridgeRequest, readBridgeBody, retryableBridgeError } from './core.mjs';

const uuid = '8b9bdd34-d43b-4ecf-ae46-7ec3829a3b83';
const ack = { outbox_id: uuid, ok: true, apple_reminder_id: 'fixture.apple.id' };
const state = { task_id: uuid, apple_reminder_id: 'fixture.apple.id', completed: true,
  completed_at: '2026-10-11T08:00:00+02:00', missing: false };

test('installed Swift protocol remains accepted without payload_hash', () => {
  const parsed = parseBridgeRequest({ acknowledgements: [ack], local_states: [state] });
  assert.equal(parsed.acknowledgements[0].outbox_id, uuid);
  assert.equal(parsed.local_states[0].completed_at, '2026-10-11T06:00:00.000Z');
});
test('server computes retryability and ignores a caller supplied override', () => {
  const parsed = parseBridgeRequest({ acknowledgements: [{ ...ack, ok: false,
    error: 'Access denied', retryable: true }] });
  assert.equal(parsed.acknowledgements[0].retryable, false);
});
test('only explicitly temporary failures are retried', () => {
  assert.equal(retryableBridgeError('Service temporarily unavailable'), true);
  assert.equal(retryableBridgeError('Calendar server busy'), true);
  assert.equal(retryableBridgeError('Access denied after timeout'), false);
  assert.equal(retryableBridgeError('Unknown EventKit failure'), false);
});
test('duplicate acknowledgements cannot consume multiple attempts', () => {
  assert.throws(() => parseBridgeRequest({ acknowledgements: [ack, ack] }), /duplicate_acknowledgement/);
});
test('duplicate state reports and mutually exclusive states are rejected', () => {
  assert.throws(() => parseBridgeRequest({ local_states: [state, state] }), /duplicate_local_state/);
  assert.throws(() => parseBridgeRequest({ local_states: [{ ...state, missing: true }] }), BridgeInputError);
});
test('bounded arrays reject oversized batches rather than discarding commands', () => {
  assert.throws(() => parseBridgeRequest({ acknowledgements: Array(51).fill(ack) }), BridgeInputError);
  assert.throws(() => parseBridgeRequest({ local_states: Array(201).fill(state) }), BridgeInputError);
});
test('wrong identifier, boolean and date types are rejected before SQL', () => {
  assert.throws(() => parseBridgeRequest({ acknowledgements: [{ ...ack, outbox_id: 'not-a-uuid' }] }), BridgeInputError);
  assert.throws(() => parseBridgeRequest({ acknowledgements: [{ ...ack, ok: 'true' }] }), BridgeInputError);
  assert.throws(() => parseBridgeRequest({ local_states: [{ ...state, completed_at: 'yesterday' }] }), BridgeInputError);
});
test('oversized or NUL-containing Apple IDs cannot reach the database', () => {
  assert.throws(() => parseBridgeRequest({ acknowledgements: [{ ...ack, apple_reminder_id: 'x'.repeat(513) }] }), BridgeInputError);
  assert.throws(() => parseBridgeRequest({ local_states: [{ ...state, apple_reminder_id: 'a\u0000b' }] }), BridgeInputError);
});
test('empty initial poll is compatible, malformed body is rejected', async () => {
  assert.deepEqual(parseBridgeRequest(await readBridgeBody(new Request('https://fixture.invalid', { method: 'POST' }))),
    { acknowledgements: [], local_states: [] });
  await assert.rejects(readBridgeBody(new Request('https://fixture.invalid', { method: 'POST', body: '{' })), /invalid_bridge_json/);
});
test('body limit is enforced even without Content-Length', async () => {
  const req = new Request('https://fixture.invalid', { method: 'POST', body: ' '.repeat(200001) });
  await assert.rejects(readBridgeBody(req), /bridge_request_too_large/);
});
