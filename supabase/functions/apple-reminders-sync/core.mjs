const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export class BridgeInputError extends Error {
  constructor(code = 'invalid_bridge_request') { super(code); this.code = code; }
}

function array(value, max) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) throw new BridgeInputError();
  return value;
}

function id(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new BridgeInputError();
  return value.toLowerCase();
}

function optionalText(value, limit) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > limit || /\u0000/.test(value)) {
    throw new BridgeInputError();
  }
  return value || null;
}

// Retry only errors whose message explicitly denotes a temporary failure.
// Authorization, calendar access, malformed input and unknown errors remain visible.
export function retryableBridgeError(value) {
  if (typeof value !== 'string') return false;
  if (/permission|authori[sz]|denied|refus|read.?only|not permitted|non autoris/i.test(value)) return false;
  return /temporar|timed?\s*out|timeout|service.{0,30}unavailable|server.{0,20}busy|network.{0,20}lost|connection.{0,20}lost|connexion.{0,20}interromp/i.test(value);
}

export function parseBridgeRequest(body) {
  if (!object(body)) throw new BridgeInputError();
  const seenAck = new Set(), seenTask = new Set();
  const acknowledgements = array(body.acknowledgements, 50).map(a => {
    if (!object(a) || typeof a.ok !== 'boolean') throw new BridgeInputError();
    const outbox_id = id(a.outbox_id);
    if (seenAck.has(outbox_id)) throw new BridgeInputError('duplicate_acknowledgement');
    seenAck.add(outbox_id);
    const error = optionalText(a.error, 1000);
    return { outbox_id, ok: a.ok, apple_reminder_id: optionalText(a.apple_reminder_id, 512),
      error: a.ok ? null : (error || 'apple_bridge_operation_failed'),
      retryable: !a.ok && retryableBridgeError(error) };
  });
  const local_states = array(body.local_states, 200).map(s => {
    if (!object(s) || typeof s.completed !== 'boolean' || typeof s.missing !== 'boolean') {
      throw new BridgeInputError();
    }
    const task_id = id(s.task_id);
    if (seenTask.has(task_id)) throw new BridgeInputError('duplicate_local_state');
    seenTask.add(task_id);
    const apple_reminder_id = optionalText(s.apple_reminder_id, 512);
    if (!apple_reminder_id || (s.completed && s.missing)) throw new BridgeInputError();
    const date = optionalText(s.completed_at, 40);
    if (date && (!/^\d{4}-\d{2}-\d{2}T/.test(date) || !Number.isFinite(Date.parse(date)))) {
      throw new BridgeInputError();
    }
    return { task_id, apple_reminder_id, completed: s.completed, missing: s.missing,
      completed_at: s.completed && date ? new Date(date).toISOString() : null };
  });
  return { acknowledgements, local_states };
}

export async function readBridgeBody(req) {
  const length = Number(req.headers.get('content-length'));
  if (Number.isFinite(length) && length > 200000) throw new BridgeInputError('bridge_request_too_large');
  if (!req.body) return {};
  const reader = req.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 200000) { await reader.cancel(); throw new BridgeInputError('bridge_request_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return size ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) : {}; }
  catch { throw new BridgeInputError('invalid_bridge_json'); }
}
