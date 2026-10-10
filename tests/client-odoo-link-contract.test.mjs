import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=()=>readFileSync(new URL('../supabase/functions/client-odoo-link/index.ts',import.meta.url),'utf8');
test('Link writes require verified owner, explicit confirmation and source order ownership',()=>{
 const s=read();
 for(const token of ['sb.auth.getUser(token)',"owner?.role!=='owner'","owner?.is_active!==true",
  "input.confirmation!=='CONFIRMER_LIAISON'","input.confirmation!=='REVOQUER_LIAISON'",
  "['partner_id','=',partnerId]","['user_id','=',uid]",'contact_evidence_not_confirmed',
  'partner_name_mismatch','existing_client_or_partner_link'])
   assert.ok(s.includes(token),token);
});
test('Link endpoint does not modify source Odoo and allows only POST',()=>{
 const s=read();
 assert.match(s,/req.method!=='POST'&&req.method!=='GET'/);
 assert.match(s,/crm_odoo_partner_links/);
 assert.match(s,/res\.partner/);
 assert.doesNotMatch(s,/['"](?:write|unlink|create)['"]\s*,/);
 assert.match(s,/status:'revoked'/);
 assert.match(s,/cache-control':'no-store'/);
});

test('Candidate discovery is GET and must scope Odoo matches to the salesperson and exact partner name',()=>{
 const s=read();
 assert.match(s,/req.method==='GET'/);
 assert.ok(s.includes("['partner_id.name','=',exactName]"));
 assert.ok(s.includes("['user_id','=',uid]"));
 assert.match(s,/matching:'exact_partner_name_and_salesperson_orders'/);
 assert.match(s,/complete:false,verified:false/);
});
