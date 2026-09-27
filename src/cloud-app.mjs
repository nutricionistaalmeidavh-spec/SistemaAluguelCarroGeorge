import { can } from './domain/auth.mjs';
import { createRuntimeRepository } from './storage/repository.mjs';
import { createOfflineBlobStore } from './storage/offline-blob-store.mjs';
import { runOutbox } from './sync/outbox-runner.mjs';

const RESOURCE_PERMISSIONS=Object.freeze({customers:'customer.read',vehicles:'vehicle.read',rentals:'rental.read',expenses:'finance.read',inspections:'inspection.read',maintenance:'maintenance.read'});
const DEVICE_KEY='cloud:device-id';
const INSTALLATION_KEY='cloud:last-installation-id';

function esc(value){return String(value??'').replace(/[&<>"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]));}
function message(error){
  const code=String(error?.code??error?.message??'');
  if(code==='invalid_credentials'||error?.status===401)return'Usuário, senha ou instalação inválidos.';
  if(code==='weak_password')return'A nova senha precisa ter pelo menos 10 caracteres.';
  if(code==='first_access_conflict')return'O primeiro acesso já foi concluído em outro dispositivo. Entre novamente.';
  if(code==='network_error'||error instanceof TypeError)return'Sem conexão com o servidor. Os dados já armazenados neste aparelho continuam disponíveis.';
  return'Não foi possível concluir a operação.';
}
async function deviceId(repository){let value=await repository.kv.get(DEVICE_KEY);if(value)return String(value);value=`WEB-${crypto.randomUUID()}`;await repository.kv.set(DEVICE_KEY,value);return value;}
function allowedResources(user){return Object.entries(RESOURCE_PERMISSIONS).filter(([,permission])=>can(user,permission)).map(([resource])=>resource);}
async function flushPending(repository,runtime){
  const pushed=repository.outbox?await runOutbox({outbox:repository.outbox,api:repository.api,blobs:runtime.blobs,baseRetryMs:1_500,maxRetryMs:60_000,limit:20}):null;
  const pulled=repository.cloudSync?await repository.cloudSync.pullChanges():null;
  return{pushed,pulled};
}

async function loadCloudState(repository,user){
  const resources=allowedResources(user),data={};let online=true,lastError=null;
  for(const resource of resources){
    try{data[resource]=await repository.query(resource,{allowCachedOnError:true});}
    catch(error){if(error?.status===403){data[resource]=await repository.cache.getResource(resource);continue;}online=false;lastError=message(error);data[resource]=await repository.cache.getResource(resource);}
  }
  const status=repository.status();
  return{resources,data,online:online&&status.online!==false,lastError:lastError??status.lastError};
}

function renderLogin(app,repository,runtime,{error='',firstAccess=false,installationId='',username='admin',currentPassword=''}={}){
  app.innerHTML=`<div class="login-wrap"><form id="cloud-login" class="login-card"><div class="brand big"><span class="brandmark">LV</span><div><small>ARTISYS</small><strong>Sistema Locadora George</strong></div></div><h1>${firstAccess?'Primeiro acesso':'Acesso online'}</h1><label>Instalação<input name="installationId" autocomplete="organization" value="${esc(installationId)}" required></label><label>Usuário<input name="username" autocomplete="username" value="${esc(username)}" required></label><label>${firstAccess?'Senha atual':'Senha'}<input name="password" type="password" autocomplete="current-password" value="${esc(currentPassword)}" required></label>${firstAccess?'<label>Nova senha<input name="newPassword" type="password" autocomplete="new-password" minlength="10" required></label>':''}<button class="primary">${firstAccess?'Definir senha e entrar':'Entrar'}</button><p class="hint">A sessão é validada pelo servidor. Operações offline ficam salvas neste aparelho até confirmação do servidor.</p><p id="cloud-login-error" class="error">${esc(error)}</p></form></div>`;
  app.querySelector('#cloud-login').onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget,fd=new FormData(form),identity={installationId:String(fd.get('installationId')??'').trim(),username:String(fd.get('username')??'').trim()},password=String(fd.get('password')??'');
    const errorNode=app.querySelector('#cloud-login-error');errorNode.textContent='';form.querySelector('button').disabled=true;
    try{
      const id=await deviceId(repository),result=firstAccess?await repository.api.firstAccess({...identity,currentPassword:password,newPassword:String(fd.get('newPassword')??''),deviceId:id}):await repository.api.login({...identity,password,deviceId:id});
      await repository.kv.set(INSTALLATION_KEY,identity.installationId);await repository.setSession(result);await flushPending(repository,runtime).catch(()=>{});await renderCloudHome(app,repository,runtime,result);
    }catch(loginError){if(loginError?.code==='password_change_required')return renderLogin(app,repository,runtime,{firstAccess:true,installationId:identity.installationId,username:identity.username,currentPassword:password});errorNode.textContent=message(loginError);form.querySelector('button').disabled=false;}
  };
}

async function renderCloudHome(app,repository,runtime,session){
  const user=session?.user;if(!user)return renderLogin(app,repository,runtime);
  app.innerHTML='<div class="login-wrap"><div class="login-card"><strong>Carregando dados online…</strong></div></div>';
  const state=await loadCloudState(repository,user),queue=await repository.outbox.summary(),count=name=>(state.data[name]??[]).length,cursor=repository.cloudSync?await repository.cloudSync.getCursor():0;
  const connection=state.online?'Servidor conectado':'Modo offline com dados deste aparelho',pending=queue.pending+queue.sending+queue.failed;
  app.innerHTML=`<div class="shell cloud-shell"><aside class="sidebar"><div class="brand"><span class="brandmark">LV</span><div><small>SISTEMA</small><strong>LOCADORA GEORGE</strong></div></div><nav><button class="nav active">Visão geral</button></nav><div class="session"><strong>${esc(user.name||user.username)}</strong><small>${esc(user.role)}</small><button id="cloud-logout">Sair</button></div></aside><main><header class="topbar"><span>${esc(connection)}</span><span>${pending} pendência(s)</span><span>${queue.conflict} conflito(s)</span><span>Delta #${cursor}</span><span>Cache local ativo</span></header><section class="content"><div class="page-head"><div><h1>Dados operacionais</h1><p>O servidor é a autoridade online; alterações offline permanecem na fila deste aparelho até confirmação.</p></div><div><button id="cloud-sync" class="secondary" ${pending?'':'disabled'}>Sincronizar pendências</button> <button id="cloud-refresh" class="primary">Atualizar</button></div></div>${state.lastError?`<p class="hint">Última ocorrência: ${esc(state.lastError)}</p>`:''}<div class="cards"><article class="card"><small>Clientes</small><strong>${count('customers')}</strong></article><article class="card"><small>Veículos</small><strong>${count('vehicles')}</strong></article><article class="card"><small>Locações</small><strong>${count('rentals')}</strong></article><article class="card"><small>Despesas</small><strong>${count('expenses')}</strong></article><article class="card"><small>Vistorias</small><strong>${count('inspections')}</strong></article><article class="card"><small>Manutenções</small><strong>${count('maintenance')}</strong></article></div><div class="panel"><h2>Sincronização offline</h2><p>${pending?`${pending} operação(ões) aguardando confirmação do servidor.`:'Nenhuma operação pendente.'}${queue.conflict?` ${queue.conflict} conflito(s) exigem revisão; não são reenviados automaticamente.`:''}</p><p class="hint">Pagamentos mantêm a mesma chave de idempotência em cada retry; após o envio, apenas deltas posteriores ao cursor são aplicados no aparelho.</p></div></section></main></div>`;
  app.querySelector('#cloud-refresh').onclick=()=>void renderCloudHome(app,repository,runtime,session);
  app.querySelector('#cloud-sync').onclick=async()=>{const button=app.querySelector('#cloud-sync');button.disabled=true;await flushPending(repository,runtime).catch(()=>{});await renderCloudHome(app,repository,runtime,session);};
  app.querySelector('#cloud-logout').onclick=async()=>{try{await repository.api.logout();}catch{}await repository.clearSession();renderLogin(app,repository,runtime,{installationId:String(await repository.kv.get(INSTALLATION_KEY)??'')});};
}

export async function bootstrapCloudApp({app=document.querySelector('#app'),baseUrl=location.origin}={}){
  if(!app)throw new Error('app_root_missing');
  app.innerHTML='<div class="login-wrap"><div class="login-card"><strong>Inicializando acesso online…</strong><p class="hint">Preparando cache e fila offline deste aparelho.</p></div></div>';
  const repository=await createRuntimeRepository({mode:'cloud',baseUrl}),runtime={blobs:createOfflineBlobStore()};
  if('serviceWorker' in navigator&&globalThis.isSecureContext){try{await navigator.serviceWorker.register('./sw.js');}catch{}}
  window.addEventListener('online',()=>{void flushPending(repository,runtime);});
  const cached=await repository.session();
  try{
    const live=await repository.api.session();await repository.setSession(live);await flushPending(repository,runtime).catch(()=>{});return renderCloudHome(app,repository,runtime,live);
  }catch(error){
    if(error?.status===401){await repository.clearSession();return renderLogin(app,repository,runtime,{installationId:String(await repository.kv.get(INSTALLATION_KEY)??'')});}
    if(cached?.user)return renderCloudHome(app,repository,runtime,cached);
    return renderLogin(app,repository,runtime,{error:message(error),installationId:String(await repository.kv.get(INSTALLATION_KEY)??'')});
  }
}
