import {reactivationProfile} from './reactivation-v2.mjs';
// Commercial strategy V1: financial metrics only from verified Odoo partner identities.
// Relationship signals are explicitly activity indicators, not customer sentiment.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const money=x=>Math.round(x*100)/100;
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}/.test(x)?x.slice(0,10):'';
const nonneg=x=>finite(x)&&x>=0?x:null;
export const validPeriods=new Set([3,6,12]);
function ageDays(value,now){
 const a=Date.parse(date(value)+'T00:00:00Z'),b=Date.parse(date(now)+'T00:00:00Z');
 return Number.isFinite(a)&&Number.isFinite(b)?Math.max(0,Math.floor((b-a)/86400000)):null;
}
function daysBetween(a,b){
 const x=Date.parse(a+'T00:00:00Z'),y=Date.parse(b+'T00:00:00Z');
 return Math.round(Math.abs(y-x)/86400000);
}
const norm=x=>typeof x==='string'?x.normalize('NFKC').toLocaleLowerCase('fr-FR').trim().replace(/\s+/g,' '):'';
function cadence(orders){
 const dates=[...new Set(orders.map(o=>date(o.date)).filter(Boolean))].sort();
 if(dates.length<2)return {meanGapDays:null,medianGapDays:null,observations:0};
 const gaps=dates.slice(1).map((x,i)=>daysBetween(dates[i],x));
 const sorted=[...gaps].sort((a,b)=>a-b),center=(sorted.length-1)/2;
 const mid=sorted.length%2?sorted[Math.floor(center)]:(sorted[Math.floor(center)]+sorted[Math.ceil(center)])/2;
 return {meanGapDays:Math.round(gaps.reduce((a,b)=>a+b,0)/gaps.length*10)/10,
  medianGapDays:mid,observations:gaps.length};
}
function monthsStart(today,count){
 const d=new Date(date(today)+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()-count);
 return d.toISOString().slice(0,10);
}
export function marginScenario({price,cost,newPrice,quantity,expectedQuantity}){
 const x={price:Number(price),cost:Number(cost),newPrice:Number(newPrice),
  quantity:Number(quantity),expectedQuantity:Number(expectedQuantity)};
 if(!Object.values(x).every(Number.isFinite)||x.price<=0||x.cost<0||x.newPrice<=0||
  x.quantity<=0||x.expectedQuantity<=0) return {ok:false,reason:'invalid_inputs'};
 if(x.newPrice>=x.price)return {ok:false,reason:'not_a_discount'};
 if(x.cost>=x.price)return {ok:false,reason:'baseline_no_positive_margin'};
 if(x.newPrice<=x.cost)return {ok:false,reason:'below_cost'};
 const before=(x.price-x.cost)*x.quantity;
 const after=(x.newPrice-x.cost)*x.expectedQuantity;
 const minQuantity=Math.ceil((before/(x.newPrice-x.cost))*100)/100;
 return {ok:true,baselineGrossMargin:money(before),scenarioGrossMargin:money(after),
  requiredQuantity:minQuantity,requiredUpliftPct:money((minQuantity/x.quantity-1)*100),
  expectedUpliftPct:money((x.expectedQuantity/x.quantity-1)*100),
  marginDelta:money(after-before),revenueBefore:money(x.price*x.quantity),
  revenueAfter:money(x.newPrice*x.expectedQuantity),
  discountPct:money((1-x.newPrice/x.price)*100),provisional:true};
}
export function normalizeStrategyPayload(v){
 if(!v||v.version!=='strategy_verified_v1'||!Array.isArray(v.clients)||
  !Array.isArray(v.verified_links)||!Array.isArray(v.whatsapp)||!Array.isArray(v.memories)||
  !v.odoo||typeof v.odoo!=='object'||!Array.isArray(v.odoo.orders))
  throw Error('invalid_portfolio_payload');
 if(v.clients.length>200||v.verified_links.length>200||v.odoo.orders.length>1200)
  throw Error('unexpected_portfolio_size');
 return v;
}
function interpret(p,now){
 const rec=[],hasOrder=p.verifiedOrderCount>0,activeAge=ageDays(p.lastOrderAt,now);
 const waAge=ageDays(p.lastWhatsappAt,now);
 const last90=p.salesRecent90,prior90=p.salesPrior90;
 if(!p.verifiedOdooLink||!p.odooAvailable){
  rec.push({priority:1,type:'verify',title:!p.odooAvailable?'Rétablir les données commerciales Odoo':'Vérifier le rattachement Odoo',
   detail:'Ne pas calculer de panier ni de rétention sans liaison client–partenaire confirmée. Examiner les candidats Odoo et leurs coordonnées avant validation.',
   evidence:!p.odooAvailable?'Connexion ou données Odoo indisponibles.':'Aucune liaison Odoo validée pour cette fiche.'});
 }
 if(p.verifiedOdooLink&&p.odooAvailable&&!hasOrder)
  rec.push({priority:1,type:'verify',title:'Vérifier le parcours d’achat',
   detail:'Aucune commande positive confirmée dans la fenêtre analysée. Rechercher des commandes plus anciennes ou d’autres partenaires avant de qualifier ce client de perdu.',
   evidence:'0 commande positive vérifiée dans la période couverte ; historique antérieur inconnu.'});
 if(hasOrder&&p.cadence.medianGapDays!==null&&activeAge!==null&&activeAge>Math.max(30,p.cadence.medianGapDays*1.65)){
  rec.push({priority:1,type:'recover',title:'Réanimer une cadence d’achat ralentie',
   detail:'Contacter le client pour comprendre le stock restant, la rotation en boutique et les obstacles à la prochaine commande. Proposer ensuite une offre test limitée si l’objection est le prix.',
   evidence:'Dernière commande '+activeAge+' j · intervalle médian habituel '+p.cadence.medianGapDays+' j.'});
 }else if(hasOrder&&p.cadence.observations===0)
  rec.push({priority:2,type:'repeat',title:'Construire la deuxième commande',
   detail:'Demander un retour produit et proposer un réassort calé sur la rotation réellement observée, sans remise automatique.',
   evidence:'Une seule date d’achat positive observée ; cadence non calculable.'});
 if(hasOrder&&prior90>0&&last90<prior90*0.7)
  rec.push({priority:1,type:'recover',title:'Diagnostiquer le recul du chiffre d’affaires',
   detail:'Comparer les volumes par référence, la concurrence, les ruptures, les avis clients et les coûts logistiques. Ne négocier qu’après avoir identifié la cause.',
   evidence:'CA HT positif sur 90 j : '+money(last90)+' € contre '+money(prior90)+' € sur les 90 j précédents.'});
 if(hasOrder&&p.verifiedOrderCount>=2&&p.shareGTA!==null&&
  (p.shareGTA>0.88||p.shareGTA<0.12)){
  const other=p.shareGTA>0.88?'TR':'GTA';
  rec.push({priority:2,type:'cross_sell',title:'Tester une ouverture '+other,
   detail:'Proposer une seule référence complémentaire adaptée à la clientèle du shop, avec échantillon ou petit lot. Vérifier l’intérêt avant une remise de gamme.',
   evidence:'Part de CA '+(p.shareGTA>0.88?'GTA':'TR')+' supérieure à 88 % sur les commandes attribuées.'});
 }
 if(hasOrder&&p.verifiedOrderCount>=3&&prior90>0&&last90>prior90*1.25)
  rec.push({priority:2,type:'expand',title:'Accompagner la hausse des commandes',
   detail:'Discuter du prochain palier de volume et d’un engagement de réassort. Tester une remise conditionnelle au volume uniquement si la marge contributive reste supérieure.',
   evidence:'CA HT récent supérieur d’au moins 25 % aux 90 jours précédents.'});
 if(waAge!==null&&waAge<=14){
  rec.push({priority:3,type:'relationship',title:'Échange WhatsApp récent à exploiter',
   detail:'Relire les derniers messages et les engagements avant une approche personnalisée. La fréquence des messages ne prouve pas l’intention d’achat.',
   evidence:'Dernier texte WhatsApp approuvé : '+waAge+' j.'});
 }else if(waAge!==null&&waAge>45)
  rec.push({priority:3,type:'relationship',title:'Reprendre des nouvelles sans présumer du désintérêt',
   detail:'Relancer sur un retour de produit précis, plutôt que d’envoyer immédiatement une baisse de tarif.',
   evidence:'Dernier texte WhatsApp approuvé : '+waAge+' j.'});
 if(!rec.length)rec.push({priority:3,type:'discovery',title:'Qualifier la prochaine opportunité',
  detail:'Documenter assortiment, budget d’achat, rythme de réassort et décideur. Aucun engagement ou attrait particulier n’est déduit de l’absence de données.',
  evidence:'Sources trop limitées pour une recommandation de reconquête ou de prix ciblée.'});
 return rec.sort((a,b)=>a.priority-b.priority).slice(0,5);
}
export function buildStrategy(data,months=12,now=new Date().toISOString()){
 const v=normalizeStrategyPayload(data);
 if(!validPeriods.has(months))throw Error('invalid_period');
 const lower=monthsStart(now,months),recent90=new Date(Date.parse(date(now)+'T00:00:00Z')-90*86400000).toISOString().slice(0,10),
 prior180=new Date(Date.parse(date(now)+'T00:00:00Z')-180*86400000).toISOString().slice(0,10);
 const verifiedByPartner=new Map();
 for(const l of v.verified_links){
  if(UUID.test(l.client_id)&&Number.isSafeInteger(l.partner_odoo_id)&&l.partner_odoo_id>0)
    verifiedByPartner.set(l.partner_odoo_id,l.client_id);
 }
 const waMap=new Map(v.whatsapp.map(x=>[x.client_id,x]));
 const memMap=new Map(v.memories.map(x=>[x.client_id,x]));
 const byClient=new Map(),unlinked=new Map();
 const odooAvailable=v.odoo.available===true;
 for(const o of odooAvailable?v.odoo.orders:[]){
  if(!Number.isSafeInteger(o.partner_id)||!['GTA','TR'].includes(o.company))continue;
  if(!['sale','done'].includes(o.state)||o.currency!=='EUR'||
     nonneg(o.amount_ht)===null)continue;
  const d=date(o.date);
  if(!d||d<lower||d>date(now))continue;
  const id=verifiedByPartner.get(o.partner_id);
  if(id){if(!byClient.has(id))byClient.set(id,[]);byClient.get(id).push(o);}
  else {
   if(!unlinked.has(o.partner_id))unlinked.set(o.partner_id,{partnerId:o.partner_id,
    partnerName:String(o.partner_name||'Partenaire Odoo').slice(0,140),orderCount:0,
    amountHT:0,lastAt:null,lastOrderId:null,orders:[]});
   const u=unlinked.get(o.partner_id);if(o.amount_ht>0){u.orderCount++;u.amountHT+=o.amount_ht;u.orders.push(o);
    if(!u.lastAt||d>u.lastAt){u.lastAt=d;u.lastOrderId=Number.isSafeInteger(o.odoo_id)&&o.odoo_id>0?o.odoo_id:null;}}
  }
 }
 const clients=v.clients.filter(c=>UUID.test(c.id)).map(c=>{
  const rows=byClient.get(c.id)||[],positive=rows.filter(o=>o.amount_ht>0)
   .sort((a,b)=>date(b.date).localeCompare(date(a.date))),sum=positive.reduce((x,o)=>x+o.amount_ht,0),
  gta=positive.filter(o=>o.company==='GTA').reduce((x,o)=>x+o.amount_ht,0),
  tr=sum-gta,wa=waMap.get(c.id),mem=memMap.get(c.id),
  hasLink=[...verifiedByPartner.values()].includes(c.id);
  const candidateOdooPartners=!hasLink?[...unlinked.values()].filter(u=>
   norm(u.partnerName)===norm(c.canonical_name)).slice(0,5).map(u=>({
    partnerId:u.partnerId,partnerName:u.partnerName,proposedOnly:true})):[];
  const p={id:c.id,name:String(c.canonical_name||'Client sans nom').slice(0,150),
   candidateOdooPartners,
   crmStatus:String(c.status||''),verifiedOdooLink:hasLink,odooAvailable,
   verifiedOrderCount:positive.length,nonPositiveOrderCount:rows.length-positive.length,
   revenueHT:odooAvailable&&hasLink?money(sum):null,
   gtaHT:odooAvailable&&hasLink?money(gta):null,trHT:odooAvailable&&hasLink?money(tr):null,
   shareGTA:sum>0?gta/sum:null,
   avgBasketHT:positive.length?money(sum/positive.length):null,
   purchaseDates:[...new Set(positive.map(x=>date(x.date)))].length,
   cadence:cadence(positive),lastOrderAt:positive[0]?date(positive[0].date):null,
   salesRecent90:positive.filter(o=>date(o.date)>=recent90).reduce((s,o)=>s+o.amount_ht,0),
   salesPrior90:positive.filter(o=>date(o.date)<recent90&&date(o.date)>=prior180)
     .reduce((s,o)=>s+o.amount_ht,0),
   lastWhatsappAt:date(wa?.last_at),whatsappTexts:wa?.text_count??0,
   whatsappConversations:wa?.conversation_count??0,
   memory:mem?.summary?String(mem.summary).slice(0,850):'',
   objections:Array.isArray(mem?.objections)?mem.objections.slice(0,3):[],
   opportunities:Array.isArray(mem?.opportunities)?mem.opportunities.slice(0,3):[],
   orders:positive.slice(0,25).map(o=>({reference:String(o.reference||''),
    amountHT:money(o.amount_ht),date:date(o.date),company:o.company})),
   evidenceStrength:odooAvailable&&hasLink&&positive.length>=3?'verified_sales_partial_relationship':
    odooAvailable&&hasLink?'limited_verified_sales':'relationship_only_no_verified_sales',
   motivationLabel:'Non évaluée — nécessite une revue qualitative des échanges',
   volumeStatus:'Volume non disponible : unités et lignes produit non consolidées',
   windowFrom:lower,windowTo:date(now)};
  p.recommendations=interpret(p,now);
  p.reactivation=reactivationProfile(p,{generatedAt:v.checked_at,now});
  return p;
 });
 clients.sort((a,b)=>(a.recommendations[0]?.priority??9)-(b.recommendations[0]?.priority??9)||
   (b.revenueHT??-1)-(a.revenueHT??-1)||a.name.localeCompare(b.name,'fr'));
 const attributable=clients.filter(c=>c.verifiedOdooLink&&c.odooAvailable);
 const sum=col=>money(attributable.reduce((a,c)=>a+(c[col]??0),0));
 const unmatched=[...unlinked.values()].filter(o=>o.orderCount).sort((a,b)=>b.amountHT-a.amountHT)
  .map(({orders,...u})=>({...u,amountHT:money(u.amountHT),cadence:cadence(orders),
   reactivation:reactivationProfile({odooAvailable,verifiedOdooLink:true,verifiedOrderCount:u.orderCount,lastOrderAt:u.lastAt,cadence:cadence(orders)},
    {generatedAt:v.checked_at,now})}));
 return {clients,unmatched,meta:{windowFrom:lower,windowTo:date(now),generatedAt:v.checked_at,
  odooAvailable,odooError:v.odoo.error||null,crmClients:clients.length,
  attributedClients:attributable.length,withPositiveOrders:attributable.filter(x=>x.verifiedOrderCount).length,
  revenueHT:odooAvailable?sum('revenueHT'):null,gtaHT:odooAvailable?sum('gtaHT'):null,
  trHT:odooAvailable?sum('trHT'):null,positiveOrderCount:attributable.reduce((a,c)=>a+c.verifiedOrderCount,0),
  unmatchedPartnerCount:unmatched.length,unmatchedRevenueHT:odooAvailable?
   money(unmatched.reduce((x,u)=>x+u.amountHT,0)):null,
  archivedWhatsAppClients:clients.filter(c=>c.whatsappTexts>0).length,
  excludedCurrencies:'Only EUR, only confirmed sale/done, positive amount for purchase metrics',
  exclusions:'Unmatched Odoo partners never joined by name; no totals for clients without verified links.'}};
}
