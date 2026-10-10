const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isObj=x=>x&&typeof x==='object'&&!Array.isArray(x);
const str=(x,max=750)=>typeof x==='string'?x.slice(0,max):'';
const boundedInt=(x,max=1000000)=>Number.isSafeInteger(x)&&x>=0&&x<=max?x:0;
const when=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))?x:'';
const CATEGORY=new Set(['retour_ou_probleme','paiement_ou_facture','commande_ou_prix','expedition_ou_livraison','produit_ou_opportunite']);
export const whatsappTopicLabel={
 retour_ou_probleme:'Retour ou problème mentionné',
 paiement_ou_facture:'Paiement ou facture mentionné',
 commande_ou_prix:'Commande ou prix mentionné',
 expedition_ou_livraison:'Expédition ou livraison mentionnée',
 produit_ou_opportunite:'Produit ou opportunité mentionné'
};
function normalizeMsg(v){
 if(!isObj(v)||!Number.isSafeInteger(v.message_pk)||v.message_pk<=0||
  !Number.isSafeInteger(v.chat_pk)||v.chat_pk<=0||!when(v.at))return null;
 const excerpt=str(v.excerpt).trim();
 if(!excerpt)return null;
 return {chatPk:v.chat_pk,messagePk:v.message_pk,stanzaId:str(v.stanza_id,220),
  at:v.at,direction:v.direction==='outgoing'?'outgoing':'incoming',
  excerpt,category:CATEGORY.has(v.category)?v.category:null};
}
export function normalizeWhatsappBrief(data,expectedId){
 if(!UUID.test(expectedId)||!isObj(data)||data.client_id!==expectedId||
  data.method!=='deterministic_keywords_v1_not_ai_summary' ||
  data.scope!=='verified_clients_and_approved_text_only' ||
  !['available','no_approved_text','no_verified_archive'].includes(data.status)||
  !isObj(data.coverage)||!Array.isArray(data.recent)||!Array.isArray(data.highlights))
  throw Error('invalid_whatsapp_brief');
 const rows=(x,max)=>x.slice(0,max).map(normalizeMsg).filter(Boolean);
 const recent=rows(data.recent,25),highlights=rows(data.highlights,18);
 return {status:data.status,method:data.method,
  coverage:{messageCount:boundedInt(data.coverage.message_count),
   conversationCount:boundedInt(data.coverage.conversation_count,150),
   firstAt:when(data.coverage.first_at),lastAt:when(data.coverage.last_at),
   incomingCount:boundedInt(data.coverage.incoming_count),
   outgoingCount:boundedInt(data.coverage.outgoing_count)},
  recent,highlights};
}
export function normalizeWhatsappOverview(data){
 if(!Array.isArray(data))throw Error('invalid_whatsapp_overview');
 return data.slice(0,150).map(v=>{
  if(!isObj(v)||!UUID.test(v.client_id))return null;
  return {clientId:v.client_id,clientName:str(v.client_name,150),
   textCount:boundedInt(v.text_count),lastAt:when(v.last_at),
   conversationCount:boundedInt(v.conversation_count,150),
   lastMessage:normalizeMsg(v.last_message)};
 }).filter(x=>x&&x.clientName&&x.lastAt);
}
