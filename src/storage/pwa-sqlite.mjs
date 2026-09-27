const DB_FILE='locadora.sqlite';
const SQLITE_JS='./vendor/sqlite/sql-wasm.js';
const SQLITE_WASM='./vendor/sqlite/sql-wasm.wasm';
const IDB_NAME='artisys-locadora-web';
const IDB_STORE='kv';

function loadScript(src){
  return new Promise((resolve,reject)=>{
    if(globalThis.initSqlJs)return resolve();
    const existing=document.querySelector(`script[data-sqlite-wasm="${src}"]`);
    if(existing){existing.addEventListener('load',resolve,{once:true});existing.addEventListener('error',reject,{once:true});return;}
    const script=document.createElement('script');
    script.src=src;script.async=true;script.dataset.sqliteWasm=src;
    script.onload=resolve;script.onerror=()=>reject(new Error('Não foi possível carregar o runtime SQLite da interface web.'));
    document.head.appendChild(script);
  });
}

function openIndexedDb(){
  return new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB){reject(new Error('Este navegador não oferece armazenamento local compatível.'));return;}
    const request=indexedDB.open(IDB_NAME,1);
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(IDB_STORE))db.createObjectStore(IDB_STORE);};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('Falha ao abrir armazenamento local.'));
  });
}

async function createIndexedDbStore(){
  const db=await openIndexedDb();
  const txRequest=(mode,operation)=>new Promise((resolve,reject)=>{
    const tx=db.transaction(IDB_STORE,mode),store=tx.objectStore(IDB_STORE),request=operation(store);
    request.onsuccess=()=>resolve(request.result??null);
    request.onerror=()=>reject(request.error||new Error('Falha no armazenamento local.'));
    tx.onabort=()=>reject(tx.error||new Error('Operação local cancelada.'));
  });
  return Object.freeze({
    kind:'indexeddb-web',
    fileName:null,
    get:(key)=>txRequest('readonly',store=>store.get(String(key))),
    set:async(key,value)=>{await txRequest('readwrite',store=>store.put(String(value),String(key)));return true;},
    remove:async(key)=>{await txRequest('readwrite',store=>store.delete(String(key)));return true;},
    flush:async()=>true,
    close:()=>db.close()
  });
}

async function createOpfsSqliteStore(){
  await loadScript(SQLITE_JS);
  const SQL=await globalThis.initSqlJs({locateFile:(name)=>name.endsWith('.wasm')?SQLITE_WASM:`./vendor/sqlite/${name}`});
  const root=await navigator.storage.getDirectory();
  const handle=await root.getFileHandle(DB_FILE,{create:true});
  const file=await handle.getFile();
  const bytes=file.size?new Uint8Array(await file.arrayBuffer()):null;
  const db=bytes?.length?new SQL.Database(bytes):new SQL.Database();
  db.run(`CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)`);
  let queue=Promise.resolve();

  async function persist(){
    const exported=db.export();
    queue=queue.catch(()=>{}).then(async()=>{const writable=await handle.createWritable();await writable.write(exported);await writable.close();});
    return queue;
  }
  function get(key){
    const stmt=db.prepare('SELECT value FROM kv WHERE key=?');
    try{stmt.bind([String(key)]);return stmt.step()?stmt.getAsObject().value:null;}finally{stmt.free();}
  }
  async function set(key,value){
    db.run(`INSERT INTO kv(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,[String(key),String(value),new Date().toISOString()]);
    await persist();return true;
  }
  async function remove(key){db.run('DELETE FROM kv WHERE key=?',[String(key)]);await persist();return true;}
  await persist();
  return Object.freeze({kind:'sqlite-opfs',fileName:DB_FILE,get,set,remove,flush:()=>queue,close:()=>db.close()});
}

export async function createPwaSqliteStore(){
  if(globalThis.isSecureContext&&navigator.storage?.getDirectory){
    try{return await createOpfsSqliteStore();}catch(error){console.warn('SQLite/OPFS indisponível; usando IndexedDB local.',error);}
  }
  return createIndexedDbStore();
}
