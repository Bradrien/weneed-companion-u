import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWhatsappBrief,normalizeWhatsappOverview,whatsappTopicLabel} from '../assets/whatsapp-brief-model.mjs';
const id='d4522538-54d8-497f-a80d-15a1cf214189';
const msg={chat_pk:381,message_pk:123,stanza_id:'wamid.123',at:'2026-10-08T08:00:00Z',
  direction:'incoming',excerpt:'Commande en cours <img src=x onerror=alert(1)>',category:'commande_ou_prix'};
const sample={client_id:id,status:'available',method:'deterministic_keywords_v1_not_ai_summary',
  scope:'verified_clients_and_approved_text_only',coverage:{message_count:40,conversation_count:2,
    incoming_count:22,outgoing_count:18,first_at:'2025-09-01T00:00:00Z',last_at:msg.at},
  recent:[msg],highlights:[msg]};
test('private WhatsApp brief preserves source evidence without interpreting payments',()=>{
 const v=normalizeWhatsappBrief(sample,id);
 assert.equal(v.coverage.messageCount,40);
 assert.equal(v.recent[0].messagePk,123);
 assert.match(v.recent[0].excerpt,/<img/);
 assert.equal(v.recent[0].category,'commande_ou_prix');
 assert.match(whatsappTopicLabel.paiement_ou_facture,/mentionné/);
});
test('wrong client and unsourced archive are rejected',()=>{
 assert.throws(()=>normalizeWhatsappBrief({...sample,client_id:'00000000-0000-4000-8000-000000000000'},id));
 assert.throws(()=>normalizeWhatsappBrief({...sample,scope:'unverified'},id));
 assert.throws(()=>normalizeWhatsappBrief({...sample,method:'ai_verified'},id));
});
test('invalid message records and unknown labels are not trusted',()=>{
 const out=normalizeWhatsappBrief({...sample,recent:[{...msg,at:'N/A'}, {...msg,category:'payment_confirmed'}]},id);
 assert.equal(out.recent.length,1);
 assert.equal(out.recent[0].category,null);
});
test('the overview is client-ID keyed and trims malformed entries',()=>{
 const rows=normalizeWhatsappOverview([{client_id:id,client_name:'Green Purple',text_count:300,last_at:msg.at,
   conversation_count:1,last_message:msg},{client_id:'not-a-uuid',client_name:'Bad',last_at:msg.at}]);
 assert.equal(rows.length,1);assert.equal(rows[0].clientName,'Green Purple');
});
