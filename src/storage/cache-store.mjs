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
  async function replaceResource(resource,items,meta=null){
    const name=resourceName(resource),safe=Array.isArray(items)?clone(items):[];
    await store.set(key('resource',name),JSON.stringify(safe));
    if(meta==null)await store.remove(key('meta',name));else await store.set(key('meta',name),JSON.stringify(meta));
    return safe;
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

  return Object.freeze({kind:`cache:${store.kind??'kv'}`,getResource,getResourceMeta,replaceResource,upsertResourceItem,removeResourceItem,setSession,getSession,clearSession});
}
