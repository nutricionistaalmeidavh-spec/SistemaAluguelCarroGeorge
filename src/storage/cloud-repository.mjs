import { ApiError } from '../api/client.mjs';

function message(error){return String(error?.code??error?.message??'unknown_error');}
function ensureResource(value){const name=String(value??'').trim();if(!name)throw new Error('resource_required');return name;}
const PAGE_LIMITS=Object.freeze({
  customers:100,vehicles:100,rentals:40,rentalPayments:100,expenses:50,ledger:100,
  inspections:40,inspectionItems:250,maintenance:50,billingPlans:50,billingInstallments:80,
  billingPayments:100,collectionActions:50,contractTemplates:50,issuedContracts:50,attachments:50,
  alertState:10,appSettings:10
});
function defaultLimit(resource){return PAGE_LIMITS[resource]??100;}

export function createCloudRepository({api,cache,outbox=null}={}){
  if(!api||!cache)throw new TypeError('cloud_repository_dependencies_required');
  const state={online:true,lastError:null,requiresLogin:false,lastSuccessAt:null};
  const snapshotStatus=()=>Object.freeze({...state});
  const markSuccess=()=>{state.online=true;state.lastError=null;state.requiresLogin=false;state.lastSuccessAt=new Date().toISOString();};
  const markError=async(error)=>{
    state.online=false;state.lastError=message(error);
    if(error instanceof ApiError&&error.status===401||error?.status===401){state.requiresLogin=true;await cache.clearSession();}
  };

  async function query(resource,{allowCachedOnError=false,meta=null,limit=null,offset=0,q='',filters={},from='',to=''}={}){
    const name=ensureResource(resource);
    try{
      const page=await api.listPage(name,{limit:limit??defaultLimit(name),offset,q,filters,from,to}),items=page.items??[];
      await cache.replaceResource(name,items,meta??{hydratedAt:new Date().toISOString(),pagination:page.pagination});
      markSuccess();return items;
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
  async function page(resource,{limit=null,offset=0,q='',filters={},from='',to=''}={}){
    const name=ensureResource(resource);
    try{
      const response=await api.listPage(name,{limit:limit??defaultLimit(name),offset,q,filters,from,to}),stamp=new Date().toISOString();
      await cache.replaceResource(name,response.items??[],{hydratedAt:stamp,pagination:response.pagination});
      markSuccess();return response;
    }catch(error){await markError(error);throw error;}
  }
  async function refresh(resources=[]){
    const names=[...new Set((resources??[]).map(ensureResource))];if(!names.length)return{};
    const settled=await Promise.all(names.map(async name=>{try{const response=await api.listPage(name,{limit:defaultLimit(name),offset:0});return{name,items:response.items??[],pagination:response.pagination,error:null};}catch(error){return{name,items:null,pagination:null,error};}})),stamp=new Date().toISOString(),writes=settled.filter(item=>!item.error).map(item=>({resource:item.name,items:item.items,meta:{hydratedAt:stamp,pagination:item.pagination}}));
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

  return Object.freeze({kind:'cloud',query,mutate,loadViewState,missingResources,page,refresh,flush,status:snapshotStatus,setSession,session,clearSession,cache,outbox});
}
