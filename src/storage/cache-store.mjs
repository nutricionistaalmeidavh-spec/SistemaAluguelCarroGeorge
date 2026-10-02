const DEFAULT_NAMESPACE='cloud-cache:v1';

function parse(value,fallback=null){if(value==null)return fallback;try{return JSON.parse(String(value));}catch{return fallback;}}
function resourceName(value){const name=String(value??'').trim();if(!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(name))throw new Error('invalid_resource');return name;}
function clone(value){return value==null?value:structuredClone(value);}

export function createCacheStore({store,namespace=DEFAULT_NAMESPACE}={}){
  if(!store?.get||!store?.set||!store?.remove)throw new TypeError('cache_store_required');
  const prefix=String(namespace||DEFAULT_NAMESPACE);
  const key=(kind,name='')=>`${prefix}:${kind}${name?`:${name}`:''}`;

  async function getResource(resource){const name=resourceName(resource),value=parse(await store.get(key('resource',name)),[]);return Array.isArray(value)?clone(value):[];}
  async function getResourceMeta(resource){const name=resourceName(resource);return clone(parse(await store.get(key('meta',name)),null));}
  async function replaceResources(entries=[]){
    const normalized=(Array.isArray(entries)?entries:Object.entries(entries).map(([resource,value])=>({resource,items:value?.items??value,meta:value?.meta??null}))).map(entry=>{
      const name=resourceName(entry?.resource),safe=Array.isArray(entry?.items)?clone(entry.items):[];
      return{name,safe,meta:entry?.meta??null};
    });
    const writes=normalized.flatMap(({name,safe,meta})=>[
      {key:key('resource',name),value:JSON.stringify(safe)},
      {key:key('meta',name),value:meta==null?null:JSON.stringify(meta)}
    ]);
    if(typeof store.setMany==='function')await store.setMany(writes);
    else for(const entry of writes){if(entry.value==null)await store.remove(entry.key);else await store.set(entry.key,entry.value);}
    return Object.fromEntries(normalized.map(({name,safe})=>[name,clone(safe)]));
  }
  async function replaceResource(resource,items,meta=null){
    const name=resourceName(resource),result=await replaceResources([{resource:name,items,meta}]);return result[name];
  }
  async function upsertResourceItem(resource,item){
    const name=resourceName(resource);if(!item?.id)throw new Error('cache_item_id_required');
    const items=await getResource(name),index=items.findIndex(row=>String(row?.id)===String(item.id));
    if(index>=0){
      const current=items[index],currentVersion=Number(current?.version??0),nextVersion=Number(item?.version??0);
      if(currentVersion>nextVersion&&nextVersion>0)return clone(current);
      items[index]=clone(item);
    }else items.push(clone(item));
    await store.set(key('resource',name),JSON.stringify(items));return clone(item);
  }
  async function removeResourceItem(resource,id){
    const name=resourceName(resource),items=await getResource(name),next=items.filter(row=>String(row?.id)!==String(id));
    await store.set(key('resource',name),JSON.stringify(next));return next.length!==items.length;
  }
  async function setSession(session){if(session==null)return clearSession();await store.set(key('session'),JSON.stringify(session));return clone(session);}
  async function getSession(){return clone(parse(await store.get(key('session')),null));}
  async function clearSession(){await store.remove(key('session'));return true;}

  return Object.freeze({kind:`cache:${store.kind??'kv'}`,getResource,getResourceMeta,replaceResource,replaceResources,upsertResourceItem,removeResourceItem,setSession,getSession,clearSession});
}
