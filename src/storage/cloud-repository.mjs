import { ApiError } from '../api/client.mjs';

function message(error){return String(error?.code??error?.message??'unknown_error');}
function ensureResource(value){const name=String(value??'').trim();if(!name)throw new Error('resource_required');return name;}

export function createCloudRepository({api,cache,outbox=null}={}){
  if(!api||!cache)throw new TypeError('cloud_repository_dependencies_required');
  const state={online:true,lastError:null,requiresLogin:false,lastSuccessAt:null};
  const snapshotStatus=()=>Object.freeze({...state});
  const markSuccess=()=>{state.online=true;state.lastError=null;state.requiresLogin=false;state.lastSuccessAt=new Date().toISOString();};
  const markError=async(error)=>{
    state.online=false;state.lastError=message(error);
    if(error instanceof ApiError&&error.status===401||error?.status===401){state.requiresLogin=true;await cache.clearSession();}
  };

  async function query(resource,{allowCachedOnError=false,meta=null}={}){
    const name=ensureResource(resource);
    try{
      const items=await api.list(name);await cache.replaceResource(name,items,meta??{hydratedAt:new Date().toISOString()});markSuccess();return items;
    }catch(error){
      await markError(error);
      if(allowCachedOnError&&error?.status!==401)return cache.getResource(name);
      throw error;
    }
  }

  async function mutate(command){
    const type=String(command?.type??''),resource=ensureResource(command?.resource);
    try{
      let item=null;
      if(type==='create')item=await api.create(resource,command.data??{},{operationId:command.operationId});
      else if(type==='update')item=await api.update(resource,command.id,command.data??{},{expectedVersion:command.expectedVersion,operationId:command.operationId});
      else if(type==='delete'){
        await api.remove(resource,command.id,{expectedVersion:command.expectedVersion,operationId:command.operationId});
        await cache.removeResourceItem(resource,command.id);markSuccess();return null;
      }else throw new Error('unsupported_mutation');
      if(item)await cache.upsertResourceItem(resource,item);markSuccess();return item;
    }catch(error){await markError(error);throw error;}
  }

  async function loadViewState(resources=[]){
    const names=[...new Set((resources??[]).map(ensureResource))],pairs=await Promise.all(names.map(async name=>[name,await cache.getResource(name)]));return Object.fromEntries(pairs);
  }
  async function missingResources(resources=[]){
    const names=[...new Set((resources??[]).map(ensureResource))],pairs=await Promise.all(names.map(async name=>[name,await cache.getResourceMeta(name)]));return pairs.filter(([,meta])=>!meta?.hydratedAt).map(([name])=>name);
  }
  async function refresh(resources=[]){
    const names=[...new Set((resources??[]).map(ensureResource))];if(!names.length)return{};
    const settled=await Promise.all(names.map(async name=>{try{return{name,items:await api.list(name),error:null};}catch(error){return{name,items:null,error};}})),stamp=new Date().toISOString(),writes=settled.filter(item=>!item.error).map(item=>({resource:item.name,items:item.items,meta:{hydratedAt:stamp}}));
    if(writes.length)await cache.replaceResources(writes);
    const result={};let lastError=null;
    for(const item of settled){if(item.error){lastError=item.error;await markError(item.error);result[item.name]=await cache.getResource(item.name);}else result[item.name]=item.items;}
    if(!lastError)markSuccess();
    return result;
  }
  async function flush(){if(outbox?.flush)return outbox.flush();return true;}
  async function setSession(session){state.requiresLogin=false;return cache.setSession(session);}
  async function session(){return cache.getSession();}
  async function clearSession(){state.requiresLogin=true;return cache.clearSession();}

  return Object.freeze({kind:'cloud',query,mutate,loadViewState,missingResources,refresh,flush,status:snapshotStatus,setSession,session,clearSession,cache,outbox});
}
