const CACHE_PREFIX='artisys-locadora-george-';
const CACHE=`${CACHE_PREFIX}0.7.0-data-safety-1`;
const SHELL=['./','./index.html','./styles.css','./styles-p1.css','./styles-p2.css','./manifest.webmanifest','./assets/icon.svg','./vendor/sqlite/sql-wasm.js','./vendor/sqlite/sql-wasm.wasm','./src/app.mjs','./src/domain/auth.mjs','./src/domain/rental.mjs','./src/domain/backup.mjs','./src/domain/p1.mjs','./src/domain/inspection.mjs','./src/domain/maintenance.mjs','./src/domain/alerts.mjs','./src/domain/reports.mjs','./src/domain/documents.mjs','./src/domain/sync.mjs','./src/domain/offline.mjs','./src/domain/commercial.mjs','./src/domain/commercial-finance.mjs','./src/storage/pwa-sqlite.mjs','./src/storage/repository.mjs','./src/sync/client.mjs','./src/ui/common.mjs','./src/ui/reservas.mjs','./src/ui/cadastros.mjs','./src/ui/financeiro.mjs','./src/ui/system.mjs','./src/ui/p1.mjs','./src/ui/p2.mjs','./src/ui/commercial.mjs'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);if(url.pathname.startsWith('/api/'))return;if(event.request.method!=='GET')return;
  if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put('./index.html',copy));return response;}).catch(()=>caches.match('./index.html')));return;}
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{if(response.ok&&url.origin===location.origin){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}return response;})));
});
