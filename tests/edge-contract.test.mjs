import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const api=readFileSync(new URL('../supabase/functions/companion-api/index.ts',import.meta.url),'utf8');

test('CRM Edge API checks a confirmed session and owner-only access',()=>{
 assert.match(api,/user\.email_confirmed_at/);
 assert.match(api,/access\.role !== "owner"/);
 assert.match(api,/access\?\.is_active/);
 const acl=api.indexOf('access.role !== "owner"');
 const route=api.indexOf('const route = ');
 assert.ok(acl>0&&acl<route,'Role validation must precede every data route');
});
test('CRM Edge API keeps optional query defaults rather than replacing them with minimum',()=>{
 assert.match(api,/value === null \|\| value\.trim\(\) === ""/);
 assert.match(api,/const attentionLimit = intParam\(u\.searchParams\.get\("attention_limit"\), 20, 1, 100\)/);
});
test('CRM search input is bounded and client identifiers are checked',()=>{
 assert.match(api,/\.trim\(\)\.slice\(0, 120\)/);
 assert.match(api,/UUID_RE\.test\(clientId\)/);
});
test('CRM API uses server-held credentials and never returns secret keys',()=>{
 assert.match(api,/SUPABASE_SECRET_KEYS/);
 assert.doesNotMatch(api,/json\(\{[^}]*serviceKey/);
 assert.doesNotMatch(api,/console\.log\(jwt\)/);
});

test('Kino reconciliation gateway logs only non-sensitive diagnostic codes',()=>{
 const source=readFileSync(new URL('../supabase/functions/commission-catalog-review/index.ts',import.meta.url),'utf8');
 assert.match(source,/commission_catalog_review_failed/);
 assert.match(source,/JSON\.stringify\(\{code,status\}\)/);
 assert.doesNotMatch(source,/console\.(?:error|log)\([^)]*(?:pass|token|jwt|email|orderData)/i);
});
