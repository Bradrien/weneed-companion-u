import {normalizeConnectorStatus,connectorNames,connectorHealth,connectorIncident} from './connector-status-model-d34.mjs';
export function createConnectorStatus({request,isAuthenticated,now=()=>Date.now()}){
 const root=document.getElementById('connector-status-root');let generation=0,rows=null,error='',busy=false,readAt=null;
 const node=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n};
 const when=x=>new Date(x).toLocaleString('fr-FR');
 function render(){
  if(!root)return;root.replaceChildren(node('h2','Synchronisation des sources'));
  const b=node('button',busy?'Lecture des connexions…':'Actualiser les connexions ↻','inline-button');b.type='button';b.disabled=busy;b.onclick=load;root.append(b);
  if(error)root.append(node('p',error,'error-text'));
  if(rows===null){root.append(node('p',busy?'Vérification des trois sources Google…':'Ouvre les paramètres pour vérifier les dernières synchronisations.','help'));return}
  if(readAt)root.append(node('p','État lu le '+when(readAt)+(busy?' · Actualisation en cours.':error?' · Dernière lecture conservée ; état actuel non confirmé.':''),'help'));
  for(const r of rows){
   const health=connectorHealth(r,now()),card=node('section','','task-card');card.dataset.source=r.source;card.dataset.health=health.kind;
   card.append(node('h3',connectorNames[r.source]),node('p',health.label,['late','clock','failed','missing'].includes(health.kind)?'notice warn':'help'));
   if(r.coverageKnown){
    card.append(node('p','Fenêtre entièrement traitée : du '+when(r.coverageFrom)+' au '+when(r.watermark)+'.','help'),
     node('p','Les échanges antérieurs à cette fenêtre ne sont pas garantis par cette synchronisation.','help'));
   }else{
    card.append(node('p','Couverture historique non précisée.','help'));
    if(r.completeAt)card.append(node('p','Dernier passage enregistré : '+when(r.completeAt),'help'));
   }
   if(r.startedAt)card.append(node('p','Dernière tentative : '+when(r.startedAt),'help'));
   if(r.counts.inserted_count!==null&&r.counts.inserted_count!==undefined){
    const parts=[r.counts.inserted_count+' nouveau(x) élément(s)'];
    for(const [key,label] of [['duplicate_count','déjà présent(s)'],['skipped_count','ignoré(s)'],['failed_count','en échec']])
     if(r.counts[key]!==null)parts.push(r.counts[key]+' '+label);
    card.append(node('p','Dernier passage : '+parts.join(' · '),'help'));
   }
   const incident=connectorIncident(r.error);if(incident)card.append(node('p',incident,r.error==='drive_text_too_large'?'notice warn':'error-text'));
   if(r.counts.limited_count>0)card.append(node('p',r.counts.limited_count+' document(s) avec lecture limitée sur ce passage.','help'));
   root.append(card);
  }
  root.append(node('p','Un passage est terminé après toutes ses pages, même sans nouvel élément. Le statut décrit la collecte des sources ; il ne confirme pas que chaque échange a été analysé ou transformé en tâche. Les PDF Drive restent sans analyse de contenu.','help'));
 }
 async function load(){
  if(!isAuthenticated()||busy)return;const ticket=++generation;busy=true;error='';render();
  try{const data=await request('/sync-status');if(ticket!==generation||!isAuthenticated())return;rows=normalizeConnectorStatus(data);readAt=now()}
  catch{if(ticket===generation)error='État des connexions indisponible. Réessaie.'}
  finally{if(ticket===generation){busy=false;render()}}
 }
 render();return {open:load,reset(){generation++;rows=null;error='';busy=false;readAt=null;render()}};
}
