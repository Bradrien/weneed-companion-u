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

test('Odoo login diagnostic distinguishes pin mismatch without logging user IDs or secrets',()=>{
 const source=readFileSync(new URL('../supabase/functions/commission-catalog-review/index.ts',import.meta.url),'utf8');
 assert.match(source,/reason:pinMismatch\?'uid_pin_mismatch':'credentials_rejected'/);
 assert.match(source,/console\.error\('commission_odoo_auth_reason',JSON\.stringify\(\{/);
 assert.match(source,/const credentialsAccepted=Number\.isSafeInteger\(uid\)&&uid>0/);
 assert.doesNotMatch(source,/console\.error\('commission_odoo_auth_reason',[^;]*\buid\b/);
});

test('catalogue gateway only suggests bracket-prefixed SKUs when official Odoo SKU is missing',()=>{
 const source=readFileSync(new URL('../supabase/functions/commission-catalog-review/index.ts',import.meta.url),'utf8');
 assert.match(source,/function candidateFromDescription\(company,productName,catalog\)/);
 assert.match(source,/catalog\.byKey\.get\(k\)/);
 assert.match(source,/status:'found'/);
 assert.match(source,/if\(catalog_match\.status==='missing_sku'\)/);
 assert.match(source,/catalog_match\.candidate=candidate/);
 assert.match(source,/matching\[catalog_match\.status\]\+\+/);
 assert.match(source,/verified_commissions_eur:null,commissions_are_calculated:false/);
});

test('Odoo commission gateway double-checks source states before returning official report',()=>{
 const source=readFileSync(new URL('../supabase/functions/commission-catalog-review/index.ts',import.meta.url),'utf8');
 assert.match(source,/const latest=await readPages\(cfg,uid,'sale\.order'/);
 assert.match(source,/orders\.some\(order=>states\.get\(order\.id\)!==order\.state\)/);
 assert.match(source,/new SafeError\('odoo_order_state_changed',409\)/);
 assert.match(source,/new SafeError\('odoo_order_status_unverifiable',409\)/);
 assert.match(source,/source_order_status_rechecked:true,source_order_status_checked_at:statusCheckedAt/);
});

test('Odoo partner-history API is owner-only and cannot mutate Odoo or bind CRM identities',()=>{
 const api=readFileSync(new URL('../supabase/functions/client-odoo-history/index.ts',import.meta.url),'utf8');
 assert.match(api,/auth\.getUser\(jwt\)/);
 assert.match(api,/acl\?\.role!=='owner'/);
 assert.match(api,/acl\?\.is_active!==true/);
 assert.match(api,/req\.method!=='GET'/);
 assert.match(api,/partner_id/);
 assert.match(api,/odoo_order_state_changed/);
 assert.match(api,/identity_verified:false/);
 assert.ok(api.includes("['partner_id','=',partnerId]"));
 assert.ok(api.includes("['user_id','=',uid]"));
 assert.doesNotMatch(api,/\\b(create|write|unlink)\\b['"]\\s*,/);
});

test('Owner-scoped Odoo history retrieves partner identity only if sales are present',()=>{
 const api=readFileSync(new URL('../supabase/functions/client-odoo-history/index.ts',import.meta.url),'utf8');
 assert.match(api,/if\(!hasOrders\)return \{partner:null,diagnostic:'no_accessible_orders'\}/);
 assert.match(api,/res\.partner/);
 assert.match(api,/partner_diagnostic\}=await getPartnerIdentity\(c,uid,partnerId,orders\.length>0\)/);
 assert.match(api,/identity_verified:false/);
});

test('Partner Odoo fallback limits exposed fields and returns safe diagnostics without Odoo raw errors',()=>{
 const api=readFileSync(new URL('../supabase/functions/client-odoo-history/index.ts',import.meta.url),'utf8');
 assert.match(api,/for\(const mode of modes\)/);
 assert.match(api,/code:'name_only' as const/);
 assert.match(api,/diagnostic:rejected\?'odoo_partner_read_rejected':'not_visible'/);
 assert.match(api,/checked_at:new Date\(\)\.toISOString\(\),orders,partner,partner_diagnostic/);
 assert.doesNotMatch(api,/JSON\.stringify\(\{code,status,.*error/);
});
