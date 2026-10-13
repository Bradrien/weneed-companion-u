const views=new Set(['home','orders','clients','commissions','stocks','archives','strategy','tasks','settings']);
const clientId=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)?value:null;
// Only view names and opaque client IDs enter history. No credentials or client names.
export function createNavigation({win=window,onRestore}){
 let initialized=false,revision=0;
 const read=()=>{const url=new URL(win.location.href),view=url.searchParams.get('view');return views.has(view)?view:'home'};
 function write(view,client=null,{replace=false}={}){
  if(!views.has(view))return;revision++;
  const previous=win.history.state?.companion;
  if(initialized&&previous)win.history.replaceState({...win.history.state,companion:{...previous,scroll:win.scrollY}},'',win.location.href);
  const route={view,client:view==='clients'?clientId(client):null,scroll:0},url=new URL(win.location.href);url.searchParams.set('view',view);
  const same=previous?.view===route.view&&previous?.client===route.client;
  win.history[replace||!initialized||same?'replaceState':'pushState']({companion:route},'',url.href);initialized=true;
 }
 win.addEventListener('popstate',async()=>{
  const view=read(),saved=win.history.state?.companion,route={view,client:view==='clients'?clientId(saved?.client):null,scroll:saved?.view===view&&Number.isFinite(saved?.scroll)?saved.scroll:0};
  const ticket=++revision;await onRestore(route,()=>ticket===revision);
 });
 return {write,reset(){revision++;initialized=false;win.history.replaceState(null,'',win.location.href)}};
}
