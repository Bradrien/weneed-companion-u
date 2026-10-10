/**
 * WeNeed Companion: minimal Odoo JSON-RPC reader.
 * Never accepts a client-provided model, method, domain or fields.
 * No data persistence and no mutation calls are implemented.
 */

export const ALLOWED_MODELS = Object.freeze({
  orders: Object.freeze({
    model: 'sale.order',
    fields: ['id', 'name', 'date_order', 'state', 'partner_id', 'user_id', 'company_id', 'amount_total', 'amount_untaxed', 'currency_id', 'write_date'],
  }),
  order_lines: Object.freeze({
    model: 'sale.order.line',
    fields: ['id', 'order_id', 'product_id', 'product_uom_qty', 'qty_delivered', 'price_unit', 'discount', 'price_subtotal', 'display_type', 'write_date'],
  }),
  products: Object.freeze({
    model: 'product.product',
    fields: ['id', 'name', 'default_code', 'write_date'],
  }),
});

export class OdooBridgeError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.name = 'OdooBridgeError';
    this.code = code;
    this.status = status;
  }
}

function positiveInt(str, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof str !== 'string' || !/^[1-9]\d*$/.test(str) || str.length > 15) return null;
  const value = Number(str);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

function isoDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(day + 'T00:00:00.000Z');
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === day;
}

export function configFromEnv(env) {
  const urlRaw = (env.ODOO_URL || '').trim();
  const db = (env.ODOO_DB || '').trim();
  const login = (env.ODOO_USERNAME || '').trim();
  const apiKey = env.ODOO_API_KEY || '';
  if (!urlRaw || !db || !login || !apiKey) throw new OdooBridgeError('odoo_not_configured', 503);
  let url;
  try { url = new URL(urlRaw); } catch { throw new OdooBridgeError('invalid_odoo_configuration', 503); }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      !hostname.includes('.') || hostname === 'localhost' || hostname.endsWith('.local') ||
      hostname.endsWith('.internal') || hostname.endsWith('.localhost') ||
      /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(':') ||
      url.port || /[\\]/.test(url.pathname)) {
    throw new OdooBridgeError('invalid_odoo_configuration', 503);
  }
  if (db.length > 128 || login.length > 256 || apiKey.length > 1024) {
    throw new OdooBridgeError('invalid_odoo_configuration', 503);
  }
  const uidPin = env.ODOO_UID_PIN ? positiveInt(env.ODOO_UID_PIN) : null;
  if (env.ODOO_UID_PIN && !uidPin) throw new OdooBridgeError('invalid_odoo_configuration', 503);
  const base = url.href.replace(/\/+$/, '');
  return { base, db, login, apiKey, uidPin };
}

export function parseReadRequest(urlString, now = new Date()) {
  const url = new URL(urlString);
  const known = new Set(['resource', 'from', 'to', 'limit', 'offset', 'order_id', 'ids']);
  for (const key of url.searchParams.keys()) {
    if (!known.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new OdooBridgeError('invalid_query', 400);
    }
  }
  const resource = url.searchParams.get('resource') || 'ping';
  if (resource === 'ping' || resource === 'orders_probe') {
    if (url.searchParams.size > 1) throw new OdooBridgeError('invalid_query', 400);
    return { resource };
  }
  if (!(resource in ALLOWED_MODELS)) throw new OdooBridgeError('unknown_resource', 400);
  const limitRaw = url.searchParams.get('limit') || '25';
  const offsetRaw = url.searchParams.get('offset') || '0';
  const limit = positiveInt(limitRaw, { max: 50 });
  const offset = offsetRaw === '0' ? 0 : positiveInt(offsetRaw, { max: 5000 });
  if (!limit || offset === null) throw new OdooBridgeError('invalid_pagination', 400);
  const domain = [];
  const keys = new Set(url.searchParams.keys());
  if (resource === 'orders') {
    const permitted = new Set(['resource', 'from', 'to', 'limit', 'offset']);
    if ([...keys].some((x) => !permitted.has(x))) throw new OdooBridgeError('invalid_query', 400);
    const yesterdayMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 31));
    const from = url.searchParams.get('from') || yesterdayMonth.toISOString().slice(0, 10);
    const to = url.searchParams.get('to') || now.toISOString().slice(0, 10);
    if (!isoDay(from) || !isoDay(to) || from > to ||
        (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) > 366 * 86400000) {
      throw new OdooBridgeError('invalid_date_range', 400);
    }
    domain.push(['date_order', '>=', from + ' 00:00:00']);
    domain.push(['date_order', '<=', to + ' 23:59:59']);
  } else if (resource === 'order_lines') {
    const permitted = new Set(['resource', 'order_id', 'limit', 'offset']);
    if ([...keys].some((x) => !permitted.has(x))) throw new OdooBridgeError('invalid_query', 400);
    const orderId = positiveInt(url.searchParams.get('order_id'));
    if (!orderId) throw new OdooBridgeError('order_id_required', 400);
    domain.push(['order_id', '=', orderId]);
  } else if (resource === 'products') {
    const permitted = new Set(['resource', 'ids', 'limit', 'offset']);
    if ([...keys].some((x) => !permitted.has(x))) throw new OdooBridgeError('invalid_query', 400);
    const raw = url.searchParams.get('ids') || '';
    const ids = raw.split(',').map((x) => positiveInt(x));
    if (!ids.length || ids.length > 50 || ids.some((x) => !x) || new Set(ids).size !== ids.length) {
      throw new OdooBridgeError('product_ids_required', 400);
    }
    domain.push(['id', 'in', ids]);
  }
  return { resource, model: ALLOWED_MODELS[resource].model, domain,
    fields: [...ALLOWED_MODELS[resource].fields], limit, offset };
}

export async function jsonRpc(cfg, service, method, args, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(cfg.base + '/jsonrpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: 1,
        params: { service, method, args } }),
    });
  } catch { throw new OdooBridgeError('odoo_unreachable', 502); }
  if (!response?.ok) throw new OdooBridgeError('odoo_http_error', 502);
  const length = Number(response.headers?.get('content-length') || 0);
  if (length > 1024 * 1024) throw new OdooBridgeError('odoo_response_too_large', 502);
  let body;
  try {
    const raw = await response.text();
    if (raw.length > 1024 * 1024) throw new Error('large');
    body = JSON.parse(raw);
  } catch { throw new OdooBridgeError('invalid_odoo_response', 502); }
  if (body?.error) throw new OdooBridgeError('odoo_remote_error', 502);
  if (!Object.hasOwn(body || {}, 'result')) throw new OdooBridgeError('invalid_odoo_response', 502);
  return body.result;
}

export async function performRead(cfg, parsed, fetchImpl = fetch) {
  const uid = await jsonRpc(cfg, 'common', 'authenticate', [cfg.db, cfg.login, cfg.apiKey, {}], fetchImpl);
  // Only owner-authenticated callers see a diagnostic category, never an Odoo ID.
  if (!Number.isSafeInteger(uid) || uid <= 0) {
    throw new OdooBridgeError('odoo_credentials_rejected', 502);
  }
  if (cfg.uidPin && cfg.uidPin !== uid) {
    throw new OdooBridgeError('odoo_uid_pin_mismatch', 502);
  }
  if (parsed.resource === 'ping') return { connected: true, mode: 'read_only', persisted: false };
  if (parsed.resource === 'orders_probe') {
    // Minimal permission check: fetch at most one opaque ID, never return records.
    const found = await jsonRpc(cfg, 'object', 'execute_kw', [
      cfg.db, uid, cfg.apiKey, 'sale.order', 'search_read', [[]],
      { fields: ['id'], limit: 1, offset: 0, order: 'id desc' },
    ], fetchImpl);
    if (!Array.isArray(found) || found.length > 1 ||
        found.some((item) => !Number.isSafeInteger(item?.id) || item.id <= 0)) {
      throw new OdooBridgeError('invalid_odoo_response', 502);
    }
    return { readable: true, has_accessible_orders: found.length > 0,
      mode: 'read_only', returned_order_data: false, persisted: false };
  }
  const result = await jsonRpc(cfg, 'object', 'execute_kw', [
    cfg.db, uid, cfg.apiKey, parsed.model, 'search_read', [parsed.domain],
    { fields: parsed.fields, limit: parsed.limit, offset: parsed.offset, order: 'id asc' },
  ], fetchImpl);
  if (!Array.isArray(result) || result.length > parsed.limit ||
      result.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new OdooBridgeError('invalid_odoo_response', 502);
  }
  const items = result.map((record) => Object.fromEntries(parsed.fields
    .filter((key) => Object.hasOwn(record, key)).map((key) => [key, record[key]])));
  return { resource: parsed.resource, count: items.length,
    items, limit: parsed.limit, offset: parsed.offset, persisted: false };
}

function responseJson(data, status = 200, cors = {}) {
  return new Response(JSON.stringify(data), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'vary': 'Origin', ...cors,
  } });
}

export function createHandler({ env, authenticateCaller, fetchImpl = fetch, now = () => new Date() }) {
  return async function handle(req) {
    const origin = req.headers.get('origin');
    const allowedOrigin = (env.ODOO_ALLOWED_ORIGIN || '').trim();
    // Temporary local HTML reader for the owner; production deployment must use an HTTPS origin.
    // Browser's file:// Origin is "null", but API requires a verified owner JWT for every read.
    const url = new URL(req.url);
    const localReadResources = new Set(['ping', 'orders_probe', 'orders', 'order_lines', 'products']);
    const localPing = origin === 'null' && localReadResources.has(url.searchParams.get('resource'));
    // Explicitly trust our hosted owner-only Companion origin, without broadening to wildcards.
    const companionOrigin = 'https://bradrien.github.io';
    const allowed = Boolean((origin && (origin === companionOrigin ||
      (allowedOrigin && origin === allowedOrigin))) || localPing);
    const cors = allowed ? { 'access-control-allow-origin': localPing ? 'null' : origin,
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info' } : {};
    if (req.method === 'OPTIONS') return allowed
      ? new Response(null, { status: 204, headers: cors })
      : responseJson({ ok: false, error: 'origin_not_allowed' }, 403);
    if (req.method !== 'GET') return responseJson({ ok: false, error: 'method_not_allowed' }, 405, cors);
    if (origin && !allowed) return responseJson({ ok: false, error: 'origin_not_allowed' }, 403);
    const token = req.headers.get('authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
    if (!token) return responseJson({ ok: false, error: 'authentication_required' }, 401, cors);
    let valid = false;
    try { valid = await authenticateCaller(token); } catch { /* fail closed */ }
    if (!valid) return responseJson({ ok: false, error: 'owner_only' }, 403, cors);
    try {
      const parsed = parseReadRequest(req.url, now());
      const cfg = configFromEnv(env);
      const data = await performRead(cfg, parsed, fetchImpl);
      return responseJson({ ok: true, data }, 200, cors);
    } catch (error) {
      const safe = error instanceof OdooBridgeError ? error : new OdooBridgeError('upstream_failure', 502);
      return responseJson({ ok: false, error: safe.code }, safe.status, cors);
    }
  };
}
