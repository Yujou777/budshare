const C='bs-v22-1792405044';
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(['/manifest.json'])).catch(()=>{}))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!='GET'||u.origin!=location.origin||u.pathname.startsWith('/api')||e.request.mode=='navigate')return;
 e.respondWith(fetch(e.request,{cache:'no-cache'}).then(r=>{if(r.ok&&r.type=='basic'){const c=r.clone();caches.open(C).then(x=>x.put(e.request,c))}return r}).catch(()=>caches.match(e.request)))});
self.addEventListener('push',e=>{let d={};try{d=e.data.json()}catch(x){d={title:'Bud Share',body:e.data&&e.data.text()}}
 e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{const vis=cs.some(c=>c.visibilityState=='visible'&&d.url&&c.url.endsWith(d.url));if(vis)return;
  return self.registration.showNotification(d.title||'Bud Share',{body:d.body||'',tag:d.tag||undefined,renotify:!!d.tag,icon:'/icon-192.png',badge:'/icon-maskable-192.png',data:{url:d.url||''},timestamp:d.ts||Date.now()})}))});
self.addEventListener('notificationclick',e=>{e.notification.close();const u=new URL('/'+(e.notification.data&&e.notification.data.url||''),self.location.origin).href;
 e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{for(const c of cs){if('focus' in c){c.navigate?c.navigate(u).catch(()=>{}):0;return c.focus()}}return self.clients.openWindow(u)}))});
