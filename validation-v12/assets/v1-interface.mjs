const remembered=new Map();
const el=(tag,cls='',text)=>{const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=String(text);return n};
export function resetInterface(){remembered.clear()}
export function disclosure(key,title,children,{open=false}={}){
 const d=el('details','v1-disclosure');d.dataset.disclosure=key;d.open=remembered.has(key)?remembered.get(key):open;
 const summary=el('summary','',title),body=el('div','v1-disclosure-body');body.append(...children);d.append(summary,body);
 d.addEventListener('toggle',()=>{if(d.isConnected)remembered.set(key,d.open)});return d;
}
export function contactActions(contacts){
 const row=el('div','v1-contact-actions'),seen=new Set();
 const add=(href,label,contact,value,external=false)=>{
  if(seen.has(href))return;seen.add(href);
  const link=el('a','v1-action-link',label);link.href=href;
  link.setAttribute('aria-label',label+' · '+(contact.name?contact.name+' · ':'')+value);
  if(external){link.target='_blank';link.rel='noopener noreferrer'}row.append(link);
 };
 for(const c of contacts)for(const channel of c.channels||[]){
  const value=String(channel.value||'').trim(),kind=String(channel.type||'').toLowerCase();
  if(/mail/.test(kind)&&/^[a-z0-9.!$'*+/=_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,63}$/i.test(value))add('mailto:'+value,'E-mail',c,value);
  else if(/phone|tel|mobile|whatsapp/.test(kind)){
   const number=value.replace(/[\s().-]/g,'');
   const international=number.startsWith('+')?number.slice(1):number.startsWith('00')?number.slice(2):null;
   const validInternational=international&&/^[1-9]\d{7,14}$/.test(international);
   if(international!==null?!validInternational:!/^\d{8,15}$/.test(number))continue;
   const dial=validInternational?'+'+international:number;
   // WhatsApp requires an explicit country code; never guess one for a local number.
   if(validInternational&&/whatsapp|mobile/.test(kind))add('https://wa.me/'+international,'WhatsApp',c,value,true);
   add('tel:'+dial,'Appeler',c,value);
  }
 }
 return row;
}
export function compactSourceInfo(panel,key,title){
 const paragraphs=[...panel.children].filter(n=>n.tagName==='P'&&n.classList.contains('commission-month-detail')&&
  /^(La commande confirmée|Aucune déduction de retour renseignée|Ces pièces sont déduites|Déductions enregistrées uniquement|Avoirs attribués|La lecture se lance)/.test(n.textContent));
 if(paragraphs.length)panel.append(disclosure(key,title,paragraphs));return panel;
}
export function compactClientSections(root){
 const fold=(section,key,title)=>{const next=section.nextSibling,wrapper=disclosure(key,title,[section]);root.insertBefore(wrapper,next)};
 for(const section of [...root.children]){
  if(section.classList.contains('client-memory-digest')){fold(section,'client-memory','Mémoire et contexte');continue}
  if(!section.classList.contains('client-section'))continue;
  const title=section.querySelector('h3')?.textContent||'';
  if(title==='Actions en cours'||title==='Contacts')continue;
  const key='client-'+(section.classList.contains('client-odoo')?'sales':title);
  fold(section,key,title);
 }
}
