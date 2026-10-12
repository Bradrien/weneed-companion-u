import {sortReactivation} from './reactivation-v2.mjs';
import {buildStrategy,marginScenario,validPeriods} from './strategy-model.mjs?v=development-2';
const el=(tag,cls='',value)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=String(value);return n};
const cash=n=>typeof n==='number'&&Number.isFinite(n)?
 new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(n):'Non vérifié';
const fullCash=n=>typeof n==='number'&&Number.isFinite(n)?
 new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:2}).format(n):'—';
const date=x=>x?new Date(x).toLocaleDateString('fr-FR'):'Date inconnue';
const pct=n=>typeof n==='number'&&Number.isFinite(n)?new Intl.NumberFormat('fr-FR',{style:'percent',maximumFractionDigits:0}).format(n):'—';
const int=n=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}).format(n??0);
export function createStrategy({request,isAuthenticated,isActive,onClient,onPlan,onSamples}){
 let raw=null,derived=null,loading=false,error='',selected=null,months=12,search='',filter='all',epoch=0;
 const root=()=>document.getElementById('strategy-root');
 function reset(){epoch++;raw=null;derived=null;loading=false;error='';selected=null;months=12;search='';filter='all';root()?.replaceChildren()}
 async function open(force=false){
  if(!isAuthenticated()||loading)return;
  if(raw&&!force&&Date.now()-Date.parse(raw.checked_at)<=900000){render();return}
  const ticket=++epoch;loading=true;error='';render();
  try{
   const data=await request();
   if(ticket!==epoch||!isAuthenticated())return;
   raw=data;
   derived=buildStrategy(raw,months,new Date().toISOString());
  }catch{if(ticket===epoch)error='Les indicateurs stratégiques ne sont pas disponibles. Aucun chiffre n’a été extrapolé.'}
  finally{if(ticket===epoch){loading=false;render()}}
 }
 function recalc(){if(raw){try{derived=buildStrategy(raw,months,new Date().toISOString())}catch{error='Données de portefeuille incohérentes.'}}render()}
 function focus(id){selected=id;search='';filter='all';if(raw)recalc()}
 function card(label,value,sub){
  const box=el('article','strategy-stat');
  box.append(el('span','',label),el('strong','',value),el('small','',sub));
  return box;
 }
 function item(title,content){const c=el('div','strategy-fact');c.append(el('strong','',title),el('span','',content));return c}
 function quality(p){
  if(!p.odooAvailable)return 'Odoo indisponible : aucun CA confirmé';
  if(!p.verifiedOdooLink)return 'Pas de lien CRM–Odoo vérifié';
  if(!p.verifiedOrderCount)return 'Partenaire lié, aucune vente positive dans la période';
  return p.verifiedOrderCount+' commande(s) attribuées et confirmées';
 }
 function strategyRow(p){
  const button=el('button','strategy-client'+(selected===p.id?' chosen':''));button.type='button';
  button.append(el('strong','',p.name));
  const meta=el('span','strategy-client-meta');
  meta.textContent=[p.revenueHT===null?'CA inconnu':cash(p.revenueHT)+' HT vérifié',
   p.lastWhatsappAt?'WhatsApp '+date(p.lastWhatsappAt):'WhatsApp non relié'].join(' · ');
  button.append(meta);
  const recommendation=p.recommendations[0];
  button.append(el('small','',recommendation?.title||'À qualifier'));
  if(p.reactivation?.eligible)button.append(el('span','sample-overdue',p.reactivation.label));
  button.onclick=()=>{selected=p.id;render();root()?.querySelector('.strategy-detail')?.scrollIntoView({behavior:'smooth',block:'start'})};
  return button;
 }
 function simulator(){
  const area=el('section','strategy-simulator');
  area.append(el('h4','','Laboratoire de remise · marge avant / après'),
   el('p','strategy-note','Simulation hypothétique à renseigner avec prix et coût réellement comparables par même unité (ex. €/g), même produit et même période. Ne déduit ni commission, ni taxes, ni livraison, ni frais fixes.'));
  const fields=[
   ['Prix actuel / unité (€)','2.50','price'],
   ['Coût complet variable / unité (€)','1.50','cost'],
   ['Prix proposé / unité (€)','2.30','newPrice'],
   ['Volume de référence (unités)','1000','quantity'],
   ['Volume espéré après remise (unités)','1300','expectedQuantity']
  ];
  const form=el('div','strategy-input-grid'),refs={};
  for(const [label,placeholder,key]of fields){
   const wrap=el('label','strategy-input-field');
   wrap.append(el('span','',label));
   const input=el('input');
   input.type='number';input.min='0';input.step='any';input.placeholder=placeholder;
   input.inputMode='decimal';input.setAttribute('aria-label',label);
   refs[key]=input;wrap.append(input);form.append(wrap);
  }
  const outcome=el('div','strategy-outcome');
  const update=()=>{
   outcome.replaceChildren();
   if(fields.some(([, ,k])=>refs[k].value.trim()==='')){
    outcome.append(el('p','strategy-note','Renseigne les cinq champs pour connaître l’augmentation de volume nécessaire à la rentabilité de la remise.'));
    return;
   }
   const v=marginScenario(Object.fromEntries(fields.map(([, ,key])=>[key,refs[key].value])));
   if(!v.ok){
    const hints={invalid_inputs:'Valeurs positives obligatoires et volume supérieur à zéro.',
     not_a_discount:'Le nouveau prix doit être inférieur au prix actuel.',
     baseline_no_positive_margin:'Le prix actuel doit être supérieur au coût variable.',
     below_cost:'La remise ne doit pas faire passer le prix au niveau du coût ou en dessous.'};
    outcome.append(el('p','strategy-error',hints[v.reason]||'Scénario invalide.'));
    return;
   }
   const grid=el('div','strategy-sim-grid');
   grid.append(card('Hausse de volume nécessaire','+'+v.requiredUpliftPct+' %',
     int(v.requiredQuantity)+' unités pour préserver la marge brute'),
    card('Marge contributive simulée',fullCash(v.scenarioGrossMargin),
     (v.marginDelta>=0?'+':'')+fullCash(v.marginDelta)+' par rapport à l’actuel'));
   outcome.append(grid);
   const result=el('p','strategy-note',v.marginDelta>=0?
    'La hausse de volume saisie compense théoriquement la réduction du prix unitaire. Confirmer élasticité, capacité, délais et coûts réels avant toute offre.':
    'Le volume espéré ne compense pas la remise. Tester un palier plus élevé, une remise moindre ou une offre différente.');
   outcome.append(result);
   const options=el('details','strategy-tiers');
   options.append(el('summary','','Comparer des remises de 2, 4, 6 et 8 %'));
   const cost=Number(refs.cost.value),price=Number(refs.price.value);
   for(const discount of [2,4,6,8]){
      const offer=price*(1-discount/100);
      const marginUnit=offer-cost;
      if(marginUnit<=0)continue;
      const uplift=Math.ceil(((price-cost)/marginUnit-1)*10000)/100;
      options.append(item('-'+discount+' % · '+fullCash(offer)+'/unité',
       'Volume additionnel minimal : +'+uplift+' % pour préserver la marge brute unitaire totale.'));
   }
   outcome.append(options);
  };
  Object.values(refs).forEach(i=>i.addEventListener('input',update));
  area.append(form,outcome);update();return area;
 }
 function detail(p){
  const box=el('section','strategy-detail');
  const head=el('div','strategy-detail-head');
  head.append(el('h3','',p.name),el('small','',quality(p)));
  box.append(head);
  if(!p.odooAvailable)box.append(el('p','strategy-warn','Connexion Odoo inaccessible : les ventes ne peuvent pas être interprétées comme nulles. Cause technique : '+(derived?.meta.odooError||'non précisée')));
  if(!p.verifiedOdooLink)box.append(el('p','strategy-warn','Aucune correspondance Odoo confirmée : les ventes ne sont pas associées à cette fiche. Ne pas conclure à une perte de clientèle.'));
  if(p.candidateOdooPartners?.length){
    const candidates=el('section','strategy-candidates');
    candidates.append(el('h4','','Correspondance Odoo possible · NON vérifiée'));
    for(const c of p.candidateOdooPartners){
      candidates.append(el('p','strategy-note',
       'Nom identique : '+c.partnerName+' · partenaire Odoo #'+c.partnerId+
       '. Comparer e-mail et téléphone depuis la fiche CRM avant tout rattachement ; son chiffre d’affaires n’est pas inclus ici.'));
    }
    box.append(candidates);
  }
  const kpis=el('div','strategy-kpis');
  kpis.append(card('CA HT vérifié',cash(p.revenueHT),months+' mois glissants'),
   card('Panier moyen',cash(p.avgBasketHT),p.avgBasketHT!==null?'Commandes positives HT':'Non calculable'),
   card('Dernier achat',p.lastOrderAt?date(p.lastOrderAt):'Inconnu','Uniquement commande Odoo confirmée'),
   card('Rythme d’achat',p.cadence.medianGapDays!==null?
    p.cadence.medianGapDays+' jours':'Inconnu','Médiane des jours d’achat distincts'));
  box.append(kpis);
  if(p.reactivation?.eligible){const react=el('div','reactivation-cue');react.append(el('strong','',p.reactivation.label),el('p','',p.reactivation.evidence));box.append(react)}
  if(onSamples){const sample=el('button','primary-button','Préparer des échantillons');sample.type='button';sample.onclick=()=>onSamples(p.id,p.name);box.append(sample)}
  box.append(el('h4','','Répartition TR / GTA'));
  if(p.shareGTA!==null){
   const bar=el('div','strategy-split');
   const gta=el('div','strategy-split-gta');gta.style.width=(p.shareGTA*100)+'%';
   const tr=el('div','strategy-split-tr');tr.style.width=((1-p.shareGTA)*100)+'%';
   bar.append(gta,tr);box.append(bar);
   box.append(el('p','strategy-note','GTA '+pct(p.shareGTA)+' ('+cash(p.gtaHT)+') · TR '+
    pct(1-p.shareGTA)+' ('+cash(p.trHT)+') · uniquement commandes positives en EUR.'));
  }else box.append(el('p','strategy-note','Pas assez de données Odoo attribuées pour calculer le mix TR/GTA.'));
  box.append(item('Tendance récente',
   p.verifiedOdooLink&&p.odooAvailable?'CA 90 derniers jours '+cash(p.salesRecent90)+
   ' · 90 jours précédents '+cash(p.salesPrior90)+' (ne constitue pas une prévision)':'Indéterminée'),
   item('Activité relationnelle',p.lastWhatsappAt?
    p.whatsappTexts+' messages texte approuvés · dernier '+date(p.lastWhatsappAt):
    'Aucun texte WhatsApp vérifié relié à cette fiche'),
   item('Engagement / motivation','Non quantifié : nécessité de lire les objections, réponses et engagements réels. Le nombre de messages ne constitue pas un score de motivation.'),
   item('Volumes physiques','Non calculables à ce stade : unités SKU et quantité vendue par référence non consolidées.'));
  if(p.memory){
   const m=el('details','strategy-memory');m.append(el('summary','','Mémoire commerciale existante · à vérifier'));
   m.append(el('p','',p.memory));box.append(m);
  }
  const evidenceItems=[
    ['Objections mentionnées dans la mémoire CRM',p.objections],
    ['Opportunités mentionnées dans la mémoire CRM',p.opportunities]
  ];
  for(const [label,items] of evidenceItems){
    if(!items.length)continue;
    const area=el('details','strategy-memory');
    area.append(el('summary','',label+' · '+items.length));
    for(const x of items){
      const desc=(typeof x==='string'?x:typeof x?.text==='string'?x.text:
        typeof x?.description==='string'?x.description:typeof x?.title==='string'?x.title:'').slice(0,380);
      if(desc)area.append(el('p','',desc));
    }
    area.append(el('small','strategy-note','Synthèse CRM existante, non vérifiée indépendamment ; vérifier la source et l’actualité.'));
    box.append(area);
  }
  box.append(el('h4','','Plan d’action recommandé'));
  for(let i=0;i<p.recommendations.length;i++){
   const r=p.recommendations[i],entry=el('article','strategy-action');
   entry.append(el('strong','',String(i+1)+'. '+r.title),
    el('p','',r.detail),el('small','', 'Justification : '+r.evidence));
   if(onPlan){const action=el('button','','Préparer cette action');action.type='button';action.onclick=()=>onPlan(p.id,p.name,r);entry.append(action)}
   box.append(entry);
  }
  if(p.orders.length){
   const sales=el('details','strategy-orders');sales.append(el('summary','','Commandes Odoo retenues · '+p.verifiedOrderCount));
   for(const o of p.orders.slice(0,12))sales.append(item(o.reference+' · '+o.company,
    date(o.date)+' · '+cash(o.amountHT)+' HT'));
   box.append(sales);
  }
  const go=el('button','secondary-button','Ouvrir le dossier CRM de ce client');
  go.type='button';go.onclick=()=>onClient?.(p.id);box.append(go);
  box.append(simulator());
  box.append(el('p','strategy-note','Règles : seules les ventes Odoo sale/done, EUR, HT positif, partenaire vérifié sont utilisées pour la fréquence et le CA ; commandes annulées, devis et homonymes sont exclus. Le chiffre d’affaires n’est ni une marge ni un encaissement. Les coûts doivent être confirmés avant toute décision.'));
  return box;
 }
 function render(){
  if(!isActive())return;
  const host=root();if(!host)return;host.replaceChildren();
  const hero=el('section','strategy-hero');
  hero.append(el('h2','','Pilotage stratégique du portefeuille'),
   el('p','','Repérer les clients à relancer et les opportunités GTA / TR.'));
  const refresh=el('button','strategy-refresh','Actualiser Odoo et CRM');
  refresh.type='button';refresh.disabled=loading;refresh.onclick=()=>open(true);hero.append(refresh);
  host.append(hero);
  if(loading){host.append(el('p','strategy-loading','Lecture des historiques Odoo et CRM…'));return}
  if(error){host.append(el('p','strategy-warn',error));host.append(el('button','secondary-button','Réessayer'));host.lastChild.onclick=()=>open(true);return}
  if(!derived){host.append(el('p','strategy-loading','Ouvre cette rubrique pour charger le portefeuille.'));return}
  const meta=derived.meta;
  const options=el('div','strategy-periods');
  for(const value of [3,6,12]){
   const button=el('button','strategy-period'+(months===value?' active':''),value+' mois');
   button.type='button';button.onclick=()=>{months=value;recalc()};options.append(button);
  }host.append(options);
  const summary=el('div','strategy-kpis');
  summary.append(card('Clients CRM',int(meta.crmClients),'Fiches répertoriées'),
   card('CA attribué vérifié',cash(meta.revenueHT),'Ne concerne que '+meta.attributedClients+' clients liés'),
   card('Part GTA / TR',meta.revenueHT>0?pct(meta.gtaHT/meta.revenueHT)+' / '+pct(meta.trHT/meta.revenueHT):'Inconnue',
    'Mix sur chiffre d’affaires attribué seulement'),
   card('Ventes non attribuées',cash(meta.unmatchedRevenueHT),
    meta.unmatchedPartnerCount+' partenaires Odoo sans lien confirmé'));
  host.append(summary);
  host.append(el('p','strategy-warn',
   'Couverture financière incomplète : '+meta.attributedClients+' sur '+meta.crmClients+
   ' clients ont une liaison Odoo vérifiée. Les autres ventes restent séparées du CRM. Les montants d’ensemble ne représentent pas le CA total commercial.'));
  if(!meta.odooAvailable)host.append(el('p','strategy-warn','Données Odoo indisponibles ('+meta.odooError+'). Affichage CRM et WhatsApp uniquement. Aucun chiffre d’affaires égal à zéro supposé.'));
  const divider=el('section','strategy-panel');
  divider.append(el('h3','','Tous les clients · priorités et recommandations'));
  const searchInput=el('input');searchInput.type='search';searchInput.placeholder='Rechercher un client…';
  searchInput.value=search;searchInput.setAttribute('aria-label','Rechercher un client dans la stratégie');
  const filterSelect=el('select');filterSelect.setAttribute('aria-label','Filtrer le développement client');
  for(const [key,label]of [['all','Tous les clients'],['reactivate','À réactiver'],['second','Seconde commande'],['linked','Liaison Odoo vérifiée'],['unlinked','À rapprocher Odoo'],['risk','Rythme à diagnostiquer'],['growth','Développement et ventes croisées']]){
   const o=el('option','',label);o.value=key;filterSelect.append(o);
  }filterSelect.value=filter;
  const list=el('div','strategy-client-list'),counter=el('p','strategy-note');
  const draw=()=>{
   list.replaceChildren();
   const needle=search.toLocaleLowerCase('fr-FR').trim();
   let rows=derived.clients.filter(p=>
    (!needle||p.name.toLocaleLowerCase('fr-FR').includes(needle))&&
    (filter==='all'||filter==='reactivate'&&p.reactivation?.eligible||filter==='second'&&p.verifiedOdooLink&&p.odooAvailable&&p.verifiedOrderCount===1||filter==='linked'&&p.verifiedOdooLink||
     filter==='unlinked'&&!p.verifiedOdooLink||
     filter==='risk'&&p.recommendations.some(r=>r.type==='recover')||
     filter==='growth'&&p.recommendations.some(r=>['expand','cross_sell'].includes(r.type))));
   if(filter==='reactivate')rows=sortReactivation(rows);
   counter.textContent=rows.length+' client(s) · '+(filter==='reactivate'?'tri par retard puis CA vérifié':'tri par priorité puis CA vérifié');
   rows.forEach(p=>list.append(strategyRow(p)));
  };
  searchInput.oninput=()=>{search=searchInput.value;draw()};
  filterSelect.onchange=()=>{filter=filterSelect.value;draw()};
  divider.append(searchInput,filterSelect,counter,list);host.append(divider);draw();
  const found=derived.clients.find(p=>p.id===selected);
  if(found)host.append(detail(found));
  else host.append(el('p','strategy-note','Sélectionne une fiche pour lire son diagnostic détaillé et tester une remise.'));
  const unlinked=el('details','strategy-unlinked');
  unlinked.append(el('summary','','Ventes Odoo non attribuées · contrôle d’identité requis ('+meta.unmatchedPartnerCount+')'));
  unlinked.append(el('p','strategy-note','Ces partenaires Odoo ne sont pas rattachés automatiquement au CRM, même si leur nom semble correspondre. Les ventes ne sont pas attribuées aux 131 clients tant que l’identité n’est pas validée.'));
  for(const p of derived.unmatched.slice(0,50)){
   unlinked.append(item(p.partnerName+' · Odoo #'+p.partnerId,
    int(p.orderCount)+' commandes positives · '+cash(p.amountHT)+' HT'));
  }
  host.append(unlinked);
  host.append(el('p','strategy-note','Actualisé : '+date(meta.generatedAt)+'. Fenêtre Odoo bornée aux 365 derniers jours. Un produit à 0 €, un devis, un avoir ou une facture ne doit pas être requalifié en commande payée. Les prix simulés ne sont jamais écrits dans Odoo.'));
 }
 return {open,render,reset,focus};
}
