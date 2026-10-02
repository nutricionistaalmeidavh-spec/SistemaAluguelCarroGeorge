import { can } from './domain/auth.mjs';
import { createRuntimeRepository } from './storage/repository.mjs';
import { createOfflineBlobStore } from './storage/offline-blob-store.mjs';
import { runOutbox } from './sync/outbox-runner.mjs';
import { buildCloudSnapshot,esc,navigationFor,navHtml } from './cloud/ui/common.mjs';
import { overviewHtml } from './cloud/ui/overview.mjs';
import { customersHtml,bindCustomers } from './cloud/ui/customers.mjs';
import { vehiclesHtml,bindVehicles } from './cloud/ui/vehicles.mjs';
import { rentalsHtml,bindRentals } from './cloud/ui/rentals.mjs';
import { inspectionsHtml,bindInspections } from './cloud/ui/inspections.mjs';
import { financeHtml,bindFinance } from './cloud/ui/finance.mjs';
import { billingHtml,bindBilling } from './cloud/ui/billing.mjs';
import { delinquencyHtml,bindDelinquency } from './cloud/ui/delinquency.mjs';
import { contractsHtml,bindContracts } from './cloud/ui/contracts.mjs';
import { documentsHtml,bindDocuments } from './cloud/ui/documents.mjs';
import { alertsHtml,bindAlerts } from './cloud/ui/alerts.mjs';
import { maintenanceHtml,bindMaintenance } from './cloud/ui/maintenance.mjs';
import { administrationHtml,bindAdministration } from './cloud/ui/administration.mjs';
import { rentalContractPdf,rentalReceiptPdf,inspectionPdf,issuedContractPdf } from './domain/documents.mjs';

const RESOURCE_PERMISSIONS=Object.freeze({
  customers:'customer.read',vehicles:'vehicle.read',rentals:'rental.read',appSettings:'rental.read',
  rentalPayments:'finance.read',expenses:'finance.read',ledger:'finance.read',
  inspections:'inspection.read',inspectionItems:'inspection.read',maintenance:'maintenance.read',
  billingPlans:'billing.read',billingInstallments:'billing.read',billingPayments:'billing.read',collectionActions:'billing.read',
  contractTemplates:'contracts.read',issuedContracts:'contracts.read',attachments:'documents.read',alertState:'alerts.read'
});
export const VIEW_RESOURCES=Object.freeze({
  overview:Object.freeze(['customers','vehicles','rentals','maintenance','ledger','alertState']),
  customers:Object.freeze(['customers']),
  vehicles:Object.freeze(['vehicles']),
  rentals:Object.freeze(['customers','vehicles','rentals','rentalPayments','billingInstallments','billingPayments','ledger']),
  inspections:Object.freeze(['customers','vehicles','rentals','inspections','inspectionItems','attachments']),
  finance:Object.freeze(['customers','vehicles','rentals','rentalPayments','expenses','ledger','maintenance','billingPlans','billingInstallments','billingPayments']),
  billing:Object.freeze(['customers','vehicles','rentals','billingPlans','billingInstallments','billingPayments']),
  delinquency:Object.freeze(['customers','billingInstallments','collectionActions']),
  contracts:Object.freeze(['customers','vehicles','rentals','contractTemplates','issuedContracts','appSettings']),
  documents:Object.freeze(['customers','vehicles','rentals','rentalPayments','billingInstallments','billingPayments','inspections','inspectionItems','attachments','issuedContracts','appSettings']),
  alerts:Object.freeze(['customers','vehicles','rentals','maintenance','alertState']),
  maintenance:Object.freeze(['vehicles','maintenance']),
  administration:Object.freeze([])
});
const DEVICE_KEY='cloud:device-id',CLOUD_INSTALLATION_ID='LOCADORA-GEORGE',GEORGE_LOGIN_EMAIL='georgedaut.adm@gmail.com';
const uiState={view:'overview',editingCustomerId:null,editingVehicleId:null};
let flash='',viewRefreshSequence=0;

function operationId(prefix='OP'){return `${prefix}-${crypto.randomUUID()}`;}
function message(error){const code=String(error?.code??error?.message??'');if(code==='invalid_credentials'||error?.status===401)return'E-mail ou senha inválidos.';if(code==='weak_password')return'A nova senha precisa ter pelo menos 10 caracteres.';if(code==='password_change_required')return'É necessário concluir o primeiro acesso.';if(code==='version_conflict'||code==='command_conflict'||error?.status===409)return'Conflito detectado. A versão da nuvem não será sobrescrita automaticamente.';if(error?.status===403)return'Você não possui permissão para esta operação.';if(error instanceof TypeError||!navigator.onLine)return'Sem conexão. A operação permanece salva neste aparelho.';return error?.message&&error.message!==code?String(error.message):code||'Não foi possível concluir a operação.';}
async function deviceId(repository){let value=await repository.kv.get(DEVICE_KEY);if(value)return String(value);value=`WEB-${crypto.randomUUID()}`;await repository.kv.set(DEVICE_KEY,value);return value;}
function allowedResources(user){return Object.entries(RESOURCE_PERMISSIONS).filter(([,permission])=>can(user,permission)).map(([resource])=>resource);}
export function resourcesForView(view,user){const allowed=new Set(allowedResources(user));return (VIEW_RESOURCES[view]??VIEW_RESOURCES.overview).filter(resource=>allowed.has(resource));}
async function flushPending(repository,runtime){const pushed=repository.outbox?await runOutbox({outbox:repository.outbox,api:repository.api,blobs:runtime.blobs,baseRetryMs:1_500,maxRetryMs:60_000,limit:50}):null;const pulled=repository.cloudSync&&navigator.onLine?await repository.cloudSync.pullChanges():null;return{pushed,pulled};}
async function queueOperation(repository,runtime,{kind,payload,operationId:id=operationId(),optimistic=null}={}){const queued=await repository.outbox.enqueue({kind,payload,operationId:id});if(optimistic?.resource&&optimistic?.item)await repository.cache.upsertResourceItem(optimistic.resource,{...optimistic.item,_syncStatus:'pending'});if(navigator.onLine)await flushPending(repository,runtime).catch(()=>{});const current=await repository.outbox.get(queued.id);if(current?.status==='conflict')throw Object.assign(new Error(current.lastError?.code||'version_conflict'),{status:409,code:current.lastError?.code||'version_conflict',details:current.lastError});if(navigator.onLine&&current?.status==='failed'&&Number(current?.lastError?.status||0)>0&&Number(current.lastError.status)<500)throw Object.assign(new Error(current.lastError?.code||'operation_failed'),{status:Number(current.lastError.status),code:current.lastError?.code,details:current.lastError});return current;}
async function loadCloudState(repository,user,view){const resources=resourcesForView(view,user),[data,missing]=await Promise.all([repository.loadViewState(resources),repository.missingResources(resources)]),repositoryState=repository.status();return{resources,data,missing,online:navigator.onLine&&repositoryState.online!==false,lastError:repositoryState.lastError};}
function statusText(queue,online,session){const pending=queue.pending+queue.sending+queue.failed;if(queue.conflict)return'Conflito';if(!online&&pending)return'Salvo neste aparelho';if(session?._offlineSession)return'Sessão local';if(!online)return'Salvo neste aparelho';if(pending)return'Pendente de sincronização';return'Sincronizado';}
function conflictHtml(conflicts){if(!conflicts.length)return'';return `<section class="panel" data-test="cloud-conflicts"><h2>Conflitos de sincronização</h2><p>A alteração local ficou preservada. O sistema não sobrescreve uma versão mais nova da nuvem automaticamente.</p>${conflicts.map(item=>`<article class="card"><strong>${esc(item.kind)}</strong><p class="hint">Alteração deste aparelho</p><pre>${esc(JSON.stringify(item.payload,null,2))}</pre><p class="hint">Versão atual da nuvem</p><pre>${esc(JSON.stringify(item.lastError?.details?.current??null,null,2))}</pre><button type="button" class="secondary" data-cloud-accept="${esc(item.id)}">Usar versão da nuvem</button></article>`).join('')}</section>`;}
function downloadPdf(name,bytes){const blob=new Blob([bytes],{type:'application/pdf'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),0);}
function successFor(kind,online){if(kind==='customer.create')return online?'Cliente salvo e sincronizado.':'Cliente salvo neste aparelho.';if(kind==='vehicle.create')return online?'Veículo salvo e sincronizado.':'Veículo salvo neste aparelho.';if(kind==='rental.create')return online?'Locação salva e sincronizada.':'Locação salva neste aparelho.';if(kind==='inspection.create')return online?'Vistoria e evidência salvas.':'Vistoria e foto salvas neste aparelho.';if(kind==='billing.payment'||kind==='rental.payment')return online?'Recebimento sincronizado.':'Recebimento salvo neste aparelho.';return online?'Alteração salva e sincronizada.':'Alteração salva neste aparelho.';}

function renderLogin(app,repository,runtime,{error='',firstAccess=false,username=GEORGE_LOGIN_EMAIL,currentPassword=''}={}){app.innerHTML=`<div class="login-wrap"><form id="cloud-login" class="login-card"><div class="brand big"><span class="brandmark">LV</span><div><small>ARTISYS</small><strong>Sistema Locadora George</strong></div></div><h1>${firstAccess?'Primeiro acesso':'Acesso online'}</h1><label>E-mail<input name="username" type="email" autocomplete="username" value="${esc(username)}" required></label><label>${firstAccess?'Senha atual':'Senha'}<input name="password" type="password" autocomplete="current-password" value="${esc(currentPassword)}" required></label>${firstAccess?'<label>Nova senha<input name="newPassword" type="password" autocomplete="new-password" minlength="10" required></label>':''}<button class="primary">${firstAccess?'Definir senha e entrar':'Entrar'}</button><p class="hint">A sessão é validada pelo servidor. Operações offline ficam salvas neste aparelho.</p><p id="cloud-login-error" class="error">${esc(error)}</p></form></div>`;app.querySelector('#cloud-login').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,fd=new FormData(form),identity={installationId:CLOUD_INSTALLATION_ID,username:String(fd.get('username')??'').trim().toLowerCase()},password=String(fd.get('password')??''),errorNode=app.querySelector('#cloud-login-error');errorNode.textContent='';form.querySelector('button').disabled=true;try{const id=await deviceId(repository),result=firstAccess?await repository.api.firstAccess({...identity,currentPassword:password,newPassword:String(fd.get('newPassword')??''),deviceId:id}):await repository.api.login({...identity,password,deviceId:id});const live={...result,_offlineSession:false};await repository.setSession(live);await renderCloudHome(app,repository,runtime,live,'overview');}catch(loginError){if(loginError?.code==='password_change_required')return renderLogin(app,repository,runtime,{firstAccess:true,username:identity.username,currentPassword:password});errorNode.textContent=message(loginError);form.querySelector('button').disabled=false;}};}

function viewModule(view){return({
  overview:{html:(snapshot,user)=>overviewHtml(snapshot,user),bind:null},
  customers:{html:(snapshot,user)=>customersHtml(snapshot,user,{editingId:uiState.editingCustomerId}),bind:bindCustomers},
  vehicles:{html:(snapshot,user)=>vehiclesHtml(snapshot,user,{editingId:uiState.editingVehicleId}),bind:bindVehicles},
  rentals:{html:rentalsHtml,bind:bindRentals},inspections:{html:inspectionsHtml,bind:bindInspections},finance:{html:financeHtml,bind:bindFinance},billing:{html:billingHtml,bind:bindBilling},delinquency:{html:delinquencyHtml,bind:bindDelinquency},contracts:{html:contractsHtml,bind:bindContracts},documents:{html:documentsHtml,bind:bindDocuments},alerts:{html:alertsHtml,bind:bindAlerts},maintenance:{html:maintenanceHtml,bind:bindMaintenance},administration:{html:administrationHtml,bind:bindAdministration}
})[view]??null;}

function ensureCloudShell(app,user){
  let shell=app.querySelector('.cloud-shell');
  if(shell)return shell;
  app.innerHTML=`<div class="app-shell cloud-shell"><aside class="sidebar"><div class="brand"><span class="brandmark">LV</span><div><small>ARTISYS</small><strong>Locadora George</strong></div></div><nav></nav><div class="sidebar-foot"><small>${esc(user.name||user.username||'Usuário')}</small><button id="cloud-logout" type="button">Sair</button></div></aside><main class="workspace"><header class="topbar"><div><strong id="cloud-sync-state" data-test="cloud-status">Preparando…</strong><small id="cloud-sync-detail"></small></div><div class="actions"><button id="cloud-refresh" type="button">Atualizar</button><button id="cloud-sync" type="button">Sincronizar</button></div></header><div id="cloud-flash-slot"></div><div id="cloud-error-slot"></div><div id="cloud-conflict-slot"></div><section id="cloud-view"></section></main></div>`;
  return app.querySelector('.cloud-shell');
}
function cachedDataVisible(data){return Object.values(data??{}).some(value=>Array.isArray(value)&&value.length>0);}
async function revalidateCloudView(app,repository,runtime,session,view,{forceFull=false,sequence=++viewRefreshSequence}={}){
  const user=session?.user;if(!user||!navigator.onLine)return;
  const resources=resourcesForView(view,user);
  try{
    const missing=forceFull?resources:await repository.missingResources(resources);
    if(missing.length)await repository.refresh(missing);
    await flushPending(repository,runtime);
  }catch(error){
    if(error?.status===401){await repository.clearSession();renderLogin(app,repository,runtime);return;}
  }
  if(sequence!==viewRefreshSequence||uiState.view!==view)return;
  await renderCloudHome(app,repository,runtime,session,view,{revalidate:false});
}

async function renderCloudHome(app,repository,runtime,session,view=uiState.view,{revalidate=true}={}){
  const user=session?.user;if(!user)return renderLogin(app,repository,runtime);const allowed=navigationFor(user),safeView=allowed.some(item=>item.id===view)?view:'overview';uiState.view=safeView;
  const state=await loadCloudState(repository,user,safeView),snapshot=buildCloudSnapshot(state.data),[queue,conflicts,cursor,currentDeviceId]=await Promise.all([repository.outbox.summary(),repository.outbox.list({statuses:['conflict']}),repository.cloudSync?repository.cloudSync.getCursor():0,deviceId(repository)]),pending=queue.pending+queue.sending+queue.failed,status=statusText(queue,state.online,session),module=viewModule(safeView),shell=ensureCloudShell(app,user);
  const nav=shell.querySelector('.sidebar nav');nav.innerHTML=navHtml(user,safeView);
  shell.querySelector('#cloud-sync-state').textContent=status;
  shell.querySelector('#cloud-sync-detail').textContent=`${session?._offlineSession?'Sessão local · aguardando validação':'Sessão validada pelo servidor'} · cursor ${cursor}${pending?` · ${pending} pendente(s)`:''}`;
  const flashSlot=shell.querySelector('#cloud-flash-slot'),errorSlot=shell.querySelector('#cloud-error-slot'),conflictSlot=shell.querySelector('#cloud-conflict-slot'),viewNode=shell.querySelector('#cloud-view');
  flashSlot.innerHTML=flash?`<div class="notice" data-test="cloud-flash">${esc(flash)}</div>`:'';
  errorSlot.innerHTML=state.lastError?`<div class="notice error">${esc(state.lastError)}</div>`:'';
  conflictSlot.innerHTML=conflictHtml(conflicts);
  const firstHydration=state.missing.length>0&&!cachedDataVisible(state.data)&&safeView!=='administration';
  viewNode.innerHTML=firstHydration?'<div class="panel" data-test="cloud-view-loading"><strong>Carregando dados desta área…</strong><p class="hint">A navegação permanece disponível enquanto os dados são atualizados.</p></div>':module?.html(snapshot,user)??'<div class="panel">Tela indisponível.</div>';
  flash='';
  const rerender=target=>renderCloudHome(app,repository,runtime,session,target??safeView);
  const actions={
    currentDeviceId,
    async queue(kind,payload,prefix='OP'){try{const result=await queueOperation(repository,runtime,{kind,payload,operationId:operationId(prefix)});flash=successFor(kind,navigator.onLine&&result?.status==='synced');return result;}catch(error){flash=message(error);throw error;}},
    async createEntity(resource,data){const entity=resource==='customers'?'customer':'vehicle',id=`${entity==='customer'?'CUS':'VEI'}-${crypto.randomUUID()}`,payload={id,...data};await queueOperation(repository,runtime,{kind:`${entity}.create`,payload,operationId:operationId(entity==='customer'?'CUS':'VEI'),optimistic:{resource,item:{...payload,version:0}}});flash=successFor(`${entity}.create`,navigator.onLine);},
    async updateEntity(resource,id,data,expectedVersion){const entity=resource==='customers'?'customer':'vehicle';await queueOperation(repository,runtime,{kind:`${entity}.update`,payload:{id,data,expectedVersion},operationId:operationId(entity==='customer'?'CUS':'VEI')});flash=navigator.onLine?'Alteração salva e sincronizada.':'Alteração salva neste aparelho.';},
    async deleteEntity(resource,id,expectedVersion){const entity=resource==='customers'?'customer':'vehicle';await queueOperation(repository,runtime,{kind:`${entity}.delete`,payload:{id,expectedVersion},operationId:operationId(entity==='customer'?'CUS':'VEI')});flash=navigator.onLine?'Registro removido e sincronizado.':'Remoção salva neste aparelho.';},
    async uploadFile(file,entityType,entityId){const id=`ATT-${crypto.randomUUID()}`;await runtime.blobs.put(id,file,{entityType,entityId,mimeType:file.type||'application/octet-stream',fileName:file.name||'arquivo'});await queueOperation(repository,runtime,{kind:'attachment.upload',payload:{attachmentId:id},operationId:operationId('ATT')});return id;},
    async flush(){return flushPending(repository,runtime);},async refresh(target=safeView){return renderCloudHome(app,repository,runtime,session,target,{revalidate:false});},
    async getAdminAudit(filters){return repository.api.getAdminAudit(filters);},async getAdminSettings(){return repository.api.getAdminSettings();},async updateAdminSettings(data,expectedVersion){return repository.api.updateAdminSettings(data,{expectedVersion});},async listCloudBackups(){return repository.api.listCloudBackups();},async createCloudBackup(){return repository.api.createCloudBackup();},
    async restoreCloudBackup(id,password){const result=await repository.api.restoreCloudBackup(id,{password,confirmation:'RESTAURAR'});await repository.clearSession();alert(`Restauração concluída. Nova geração: ${Number(result?.restoreGeneration||0)}. Entre novamente para continuar.`);renderLogin(app,repository,runtime);return result;},
    async listDevices(){return repository.api.listDevices();},async revokeDevice(id){const result=await repository.api.revokeDevice(id);if(String(id)===String(currentDeviceId)){await repository.clearSession();alert('Este dispositivo foi revogado. Entre novamente para continuar.');renderLogin(app,repository,runtime);}return result;},async revokeOtherSessions(){return repository.api.revokeOtherSessions();},async revokeAllSessions(){const result=await repository.api.revokeAllSessions();await repository.clearSession();alert('Todas as sessões foram encerradas. Entre novamente para continuar.');renderLogin(app,repository,runtime);return result;},
    downloadRentalContract(id,snap=snapshot){downloadPdf(`contrato-${id}.pdf`,rentalContractPdf(snap,id));},downloadRentalReceipt(id,snap=snapshot){downloadPdf(`recibo-${id}.pdf`,rentalReceiptPdf(snap,id));},downloadInspectionPdf(id,snap=snapshot){downloadPdf(`vistoria-${id}.pdf`,inspectionPdf(snap,id));},downloadIssuedPdf(id,snap=snapshot){downloadPdf(`contrato-emitido-${id}.pdf`,issuedContractPdf(snap,id));}
  };
  for(const button of nav.querySelectorAll('[data-cloud-nav]'))button.onclick=()=>{viewRefreshSequence++;void rerender(button.dataset.cloudNav);};
  for(const button of conflictSlot.querySelectorAll('[data-cloud-accept]'))button.onclick=async()=>{try{await repository.outbox.resolveConflict(button.dataset.cloudAccept,{strategy:'accept-cloud'});if(repository.cloudSync&&navigator.onLine)await repository.cloudSync.pullChanges();flash='Versão da nuvem aplicada.';}catch(error){flash=message(error);}await rerender(safeView);};
  shell.querySelector('#cloud-refresh').onclick=()=>{const sequence=++viewRefreshSequence;void revalidateCloudView(app,repository,runtime,session,safeView,{forceFull:true,sequence});};
  shell.querySelector('#cloud-sync').onclick=async()=>{try{await flushPending(repository,runtime);flash='Sincronização concluída.';}catch(error){flash=message(error);}await rerender(safeView);};
  shell.querySelector('#cloud-logout').onclick=async()=>{viewRefreshSequence++;try{await repository.api.logout();}catch{}await repository.clearSession();renderLogin(app,repository,runtime);};
  if(!firstHydration){try{module?.bind?.(viewNode,{snapshot,user,actions,state:uiState});}catch(error){flash=message(error);}}
  if(revalidate&&navigator.onLine){const sequence=++viewRefreshSequence;void revalidateCloudView(app,repository,runtime,session,safeView,{sequence});}
}

export async function bootstrapCloudApp({app=document.querySelector('#app'),baseUrl=location.origin}={}){
  if(!app)throw new Error('app_required');app.innerHTML='<div class="login-wrap"><div class="login-card"><strong>Preparando aplicação…</strong><p>Preparando cache e fila offline.</p></div></div>';
  const repository=await createRuntimeRepository({mode:'cloud',baseUrl}),runtime={blobs:createOfflineBlobStore()};
  if('serviceWorker' in navigator&&globalThis.isSecureContext){try{await navigator.serviceWorker.register('./sw.js');}catch{}}
  const cached=await repository.session();
  async function restore(){if(navigator.onLine){try{const live=await repository.api.session();const session={...live,_offlineSession:false};await repository.setSession(session);await renderCloudHome(app,repository,runtime,session,uiState.view);return;}catch(error){if(error?.status===401){await repository.clearSession();renderLogin(app,repository,runtime);return;}if(cached?.user){await renderCloudHome(app,repository,runtime,{...cached,_offlineSession:true},uiState.view);return;}}}if(cached?.user){await renderCloudHome(app,repository,runtime,{...cached,_offlineSession:true},uiState.view);return;}renderLogin(app,repository,runtime);}
  window.addEventListener('online',()=>{void(async()=>{const local=await repository.session();if(!local?.user)return;try{const live=await repository.api.session();const session={...live,_offlineSession:false};await repository.setSession(session);await renderCloudHome(app,repository,runtime,session,uiState.view);}catch(error){if(error?.status===401){await repository.clearSession();renderLogin(app,repository,runtime);}else await renderCloudHome(app,repository,runtime,{...local,_offlineSession:true},uiState.view);}})();});
  window.addEventListener('offline',()=>{void(async()=>{const local=await repository.session();if(local?.user)await renderCloudHome(app,repository,runtime,{...local,_offlineSession:true},uiState.view);})();});
  await restore();return{repository,runtime};
}
