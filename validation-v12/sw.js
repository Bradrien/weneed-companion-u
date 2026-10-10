// Push only: no caching of authenticated pages, responses, or business data.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
 let payload={};try{payload=event.data?.json()||{}}catch{}
 event.waitUntil(self.registration.showNotification(String(payload.title||'WeNeed Companion').slice(0,100),{
  body:String(payload.body||'Un changement de stock est disponible.').slice(0,250),tag:String(payload.tag||'stocks').slice(0,80),
  icon:'assets/icon-192.png',data:{url:new URL('./?view=stocks',self.registration.scope).href}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();const url=new URL('./?view=stocks',self.registration.scope).href;
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
  const page=windows.find(w=>w.url.startsWith(self.registration.scope));
  if(page){await page.navigate(url);return page.focus()}return self.clients.openWindow(url);
 }));
});
