export function createConnectorStatus({request,isAuthenticated}){
 const root=document.getElementById('connector-status-root');let generation=0,rows=null,error='';
 const node=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n};
 const when=x=>x?new Date(x).toLocaleString('fr-FR'):'Aucun passage complet enregistré';
 function render(){if(!root)return;root.replaceChildren(node('h2','Synchronisation des sources'));
  const b=node('button','Actualiser les connexions ↻','inline-button');b.type='button';b.onclick=load;root.append(b);
  if(error)root.append(node('p',error,'error-text'));
  if(rows===null){root.append(node('p','Ouvre les paramètres pour vérifier les dernières synchronisations.','help'));return}
  const names={gmail:'Gmail',google_chat:'Google Chat',google_drive:'Google Drive'};
  for(const r of rows.filter(r=>names[r.source])){const card=node('section','','task-card');card.append(node('h3',names[r.source]));
   const status=r.sync_in_progress?'Passage en cours':r.continuation_pending?'Reprise en attente':r.last_run_status==='success'?'Dernier passage terminé':r.last_run_status==='failed'?'Dernier passage en échec':r.last_run_status==='partial'?'Passage partiel, reprise prévue':'En attente';
   card.append(node('p',status,'help'),node('p','Fenêtre entièrement traitée jusqu’au : '+when(r.last_success_at),'help'));
   if(r.coverage_from)card.append(node('p','Couverture depuis : '+when(r.coverage_from),'help'));
   if(r.last_run_started_at)card.append(node('p','Dernière tentative : '+when(r.last_run_started_at),'help'));
   if(Number.isSafeInteger(r.inserted_count))card.append(node('p',r.inserted_count+' nouveau(x) élément(s) · '+(r.duplicate_count||0)+' déjà présent(s) · '+(r.skipped_count||0)+' ignoré(s)','help'));
   if(r.last_error)card.append(node('p',r.last_error==='drive_text_too_large'?'Lecture limitée : un document dépasse la taille autorisée. Ses informations sont conservées, son texte reste indisponible.':'Incident : '+r.last_error,r.last_error==='drive_text_too_large'?'notice warn':'error-text'));
   if(r.limited_count)card.append(node('p',r.limited_count+' document(s) avec lecture limitée sur ce passage.','help'));
   root.append(card);
  }
  if(error&&rows.length)root.append(node('p','Dernière lecture conservée.','help'));
  root.append(node('p','Une source n’est considérée terminée qu’après toutes ses pages. Les fichiers Drive PDF restent sans analyse de contenu à ce stade.','help'));
 }
 async function load(){if(!isAuthenticated())return;const ticket=++generation;error='';try{const data=await request('/sync-status');if(ticket!==generation)return;if(!Array.isArray(data))throw Error();rows=data}catch{if(ticket===generation)error='État des connexions indisponible. Réessaie.'}finally{if(ticket===generation)render()}}
 render();return{open:load,reset(){generation++;rows=null;error='';render()}};
}
