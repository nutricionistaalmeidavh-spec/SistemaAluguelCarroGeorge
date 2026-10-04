import { can } from './domain/auth.mjs';
import { createRuntimeRepository } from './storage/repository.mjs';
import { createOfflineBlobStore } from './storage/offline-blob-store.mjs';
import { runOutbox } from './sync/outbox-runner.mjs';
import { buildCloudSnapshot,esc,navigationFor,navHtml } from './cloud/ui/common.mjs';
import { overviewHtml,bindOverview } from './cloud/ui/overview.mjs';
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
  overview:Object.freeze([]),
  customers:Object.freeze(['customers']),
  vehicles:Object.freeze(['vehicles']),
  rentals:Object.freeze(['customers','vehicles','rentals','inspections']),
  inspections:Object.freeze(['customers','vehicles','rentals','inspections','inspectionItems','attachments']),
  finance:Object.freeze(['vehicles','expenses']),
  billing:Object.freeze(['customers','vehicles','rentals','billingPlans','billingInstallments']),
  delinquency:Object.freeze(['customers','billingInstallments','collectionActions']),
  contracts:Object.freeze(['customers','vehicles','rentals','contractTemplates','issuedContracts','appSettings']),
  documents:Object.freeze(['customers','vehicles','rentals','rentalPayments','billingInstallments','billingPayments','inspections','inspectionItems','attachments','issuedContracts','appSettings']),
  alerts:Object.freeze(['customers','vehicles','rentals','maintenance','alertState']),
  maintenance:Object.freeze(['vehicles','maintenance']),
  administration:Object.freeze([])
});
export const MUTATION_REFRESH=Object.freeze({
  'rental.create':Object.freeze(['rentals','ledger','billingPlans','billingInstallments']),
  'rental.advance':Object.freeze(['rentals','vehicles']),
  'rental.closeContinuous':Object.freeze(['rentals','billingPlans','billingInstallments','ledger']),
  'rental.payment':Object.freeze(['rentals','rentalPayments','ledger']),
  'billing.payment':Object.freeze(['billingInstallments','billingPayments','rentals','ledger']),
  'billing.plan.create':Object.freeze(['billingPlans','billingInstallments','ledger']),
  'expense.create':Object.freeze(['expenses','ledger']),
  'expense.update':Object.freeze(['expenses','ledger']),
  'expense.delete':Object.freeze(['expenses','ledger']),
  'inspection.create':Object.freeze(['inspections','inspectionItems','attachments']),
  'maintenance.create':Object.freeze(['maintenance']),
  'maintenance.start':Object.freeze(['maintenance','vehicles']),
  'maintenance.complete':Object.freeze(['maintenance','vehicles','expenses','ledger']),
  'contract.template.create':Object.freeze(['contractTemplates']),
  'contract.template.update':Object.freeze(['contractTemplates']),
  'contract.template.duplicate':Object.freeze(['contractTemplates']),
  'contract.template.deactivate':Object.freeze(['contractTemplates']),
  'contract.issue':Object.freeze(['issuedContracts']),
  'collectionAction.create':Object.freeze(['collectionActions']),
  'alert.acknowledge':Object.freeze(['alertState']),
  'alert.dismiss':Object.freeze(['alertState'])
});
export function resourcesForMutation(kind,user){const allowed=new Set(allowedResources(user));return (MUTATION_REFRESH[String(kind)]??[]).filter(resource=>allowed.has(resource));}
const DEVICE_KEY='cloud:device-id',CLOUD_INSTALLATION_ID='LOCADORA-GEORGE';
const uiState={view:'overview',editingCustomerId:null,editingVehicleId:null,inspectionPreset:null,maintenancePreset:null,rentalDocumentId:null,financeReceivables:{limit:30,offset:0,q:''}};
let flash='',viewRefreshSequence=0;

function operationId(prefix='OP'){return `${prefix}-${crypto.randomUUID()}`;}
function message(error){const code=String(error?.code??error?.message??'');if(code==='invalid_credentials'||error?.status===401)return'E-mail ou senha inválidos.';if(code==='weak_password')return'A nova senha precisa ter pelo menos 10 caracteres.';if(code==='password_change_required')return'É necessário concluir o primeiro acesso.';if(code==='version_conflict'||code==='command_conflict'||error?.status===409)return'Conflito detectado. A versão da nuvem não será sobrescrita automaticamente.';if(error?.status===403)return'Você não possui permissão para esta operação.';if(error instanceof TypeError||!navigator.onLine)return'Sem conexão. A operação permanece salva neste aparelho.';return error?.message&&error.message!==code?String(error.message):code||'Não foi possível concluir a operação.';}
async function deviceId(repository){let value=await repository.kv.get(DEVICE_KEY);if(value)return String(value);value=`WEB-${crypto.randomUUID()}`;await repository.kv.set(DEVICE_KEY,value);return value;}
function allowedResources(user){return Object.entries(RESOURCE_PERMISSIONS).filter(([,permission])=>can(user,permission)).map(([resource])=>resource);}
export function resourcesForView(view,user){const allowed=new Set(allowedResources(user));return (VIEW_RESOURCES[view]??VIEW_RESOURCES.overview).filter(resource=>allowed.has(resource));}
async function flushPending(repository,runtime){if(!navigator.onLine)return{pushed:null,pulled:null};const pushed=repository.outbox?await runOutbox({outbox:repository.outbox,api:repository.api,blobs:runtime.blobs,baseRetryMs:1_500,maxRetryMs:60_000,limit:50}):null;const pulled=repository.cloudSync?await repository.cloudSync.pullChanges():null;return{pushed,pulled};}
async function queueOperation(repository,runtime,{kind,payload,operationId:id=operationId(),optimistic=null}={}){const queued=await repository.outbox.enqueue({kind,payload,operationId:id});if(optimistic?.resource&&optimistic?.item)await repository.cache.upsertResourceItem(optimistic.resource,{...optimistic.item,_syncStatus:'pending'});if(navigator.onLine)await flushPending(repository,runtime).catch(()=>{});const current=await repository.outbox.get(queued.id);if(current?.status==='conflict')throw Object.assign(new Error(current.lastError?.code||'version_conflict'),{status:409,code:current.lastError?.code||'version_conflict',details:current.lastError});if(navigator.onLine&&current?.status==='failed'&&Number(current?.lastError?.status||0)>0&&Number(current.lastError.status)<500)throw Object.assign(new Error(current.lastError?.code||'operation_failed'),{status:Number(current.lastError.status),code:current.lastError?.code,details:current.lastError});return current;}
async function loadCloudState(repository,user,view){
  const resources=resourcesForView(view,user),[data,missing,metas]=await Promise.all([
    repository.loadViewState(resources),
    repository.missingResources(resources),
    Promise.all(resources.map(async resource=>[resource,await repository.cache.getResourceMeta(resource)]))
  ]),repositoryState=repository.status(),pagination=Object.fromEntries(metas.map(([resource,meta])=>[resource,meta?.pagination??{}]));
  if(view==='overview')data.overviewSummary=await repository.cache.getResource('overviewSummary');
  if(view==='finance'){data.financeSummary=await repository.cache.getResource('financeSummary');data.financeReceivables=await repository.cache.getResource('financeReceivables');pagination.financeReceivables=(await repository.cache.getResourceMeta('financeReceivables'))?.pagination??{};}
  if(navigator.onLine){
    try{
      if(view==='overview'){
        const summary=await repository.api.getOverviewSummary();data.overviewSummary=[summary];await repository.cache.replaceResource('overviewSummary',[summary],{hydratedAt:new Date().toISOString()});
      }
      if(view==='finance'){
        const [summary,receivables]=await Promise.all([
          repository.api.getFinanceSummary(),
          repository.api.getFinanceReceivables(uiState.financeReceivables)
        ]);
        data.financeSummary=[summary];data.financeReceivables=receivables.items;pagination.financeReceivables=receivables.pagination;
        await repository.cache.replaceResources([
          {resource:'financeSummary',items:[summary],meta:{hydratedAt:new Date().toISOString()}},
          {resource:'financeReceivables',items:receivables.items,meta:{hydratedAt:new Date().toISOString(),pagination:receivables.pagination}}
        ]);
      }
    }catch{}
  }
  return{resources,data,missing,pagination,online:navigator.onLine&&repositoryState.online!==false,lastError:repositoryState.lastError};
}
function statusText(queue,online,session){const pending=queue.pending+queue.sending,attention=queue.conflict+queue.failed;if(!online&&(pending||attention))return'Salvo neste aparelho';if(session?._offlineSession)return'Sessão local';if(!online)return'Salvo neste aparelho';if(attention)return attention===1?'1 item precisa de atenção':`${attention} itens precisam de atenção`;if(pending)return'Sincronizando…';return'Sincronizado';}
function syncKindLabel(kind){return({'billing.payment':'Recebimento de parcela','rental.payment':'Recebimento de locação','customer.update':'Alteração de cliente','vehicle.update':'Alteração de veículo','settings.update':'Configurações da empresa'})[String(kind)]??'Alteração pendente';}
function syncFailureText(code){return({payment_exceeds_balance:'O valor não pôde ser registrado porque o saldo desta cobrança mudou ou ela já foi quitada.',installment_cancelled:'Esta parcela foi cancelada e não aceita novos recebimentos.',reservation_conflict:'O veículo ficou indisponível para o período escolhido.',vehicle_unavailable:'O veículo não está disponível para esta operação.',command_conflict:'Os dados mudaram enquanto a operação era processada. Revise antes de tentar novamente.'})[String(code)]??'Não foi possível concluir esta alteração. Revise os dados antes de tentar novamente.';}
function syncSummary(item){const payload=item?.payload??{},parts=[];if(Number(payload.amount)>0)parts.push(Number(payload.amount).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}));if(payload.method)parts.push(String(payload.method).toUpperCase());if(payload.paidAt){const date=new Date(payload.paidAt);if(Number.isFinite(date.getTime()))parts.push(date.toLocaleString('pt-BR'));}return parts.join(' · ');}
function technicalDetails(item,cloud=null){return `<details class="sync-technical"><summary>Detalhes técnicos</summary><p><strong>Operação:</strong> ${esc(item.kind)}</p><pre>${esc(JSON.stringify(item.payload,null,2))}</pre>${cloud!=null?`<p><strong>Dados atuais da nuvem</strong></p><pre>${esc(JSON.stringify(cloud,null,2))}</pre>`:''}</details>`;}
function syncIssuesHtml(conflicts,failed){const items=[];for(const item of conflicts??[]){const cloud=item.lastError?.details?.current??null;if(cloud==null)continue;items.push(`<article class="sync-issue-card sync-issue-conflict"><div><small>DADOS ALTERADOS EM OUTRO DISPOSITIVO</small><strong>${esc(syncKindLabel(item.kind))}</strong><p>A alteração deste aparelho foi preservada. Use os dados da nuvem somente se quiser descartar esta alteração local.</p></div><div class="sync-issue-actions"><button type="button" class="secondary" data-cloud-accept="${esc(item.id)}">Usar dados da nuvem</button></div>${technicalDetails(item,cloud)}</article>`);}for(const item of failed??[]){const code=String(item.lastError?.code??''),summary=syncSummary(item),target=item.kind==='billing.payment'?'billing':item.kind==='rental.payment'?'finance':'';items.push(`<article class="sync-issue-card"><div><small>PRECISA DE REVISÃO</small><strong>${esc(syncKindLabel(item.kind))}</strong>${summary?`<p class="sync-issue-summary">${esc(summary)}</p>`:''}<p>${esc(syncFailureText(code))}</p></div><div class="sync-issue-actions">${target?`<button type="button" class="primary" data-cloud-open="${target}">Revisar</button>`:''}<button type="button" class="secondary" data-cloud-retry="${esc(item.id)}">Tentar novamente</button><button type="button" class="secondary" data-cloud-discard="${esc(item.id)}">Descartar tentativa</button></div>${technicalDetails(item)}</article>`);}if(!items.length)return'';return `<section class="panel sync-issues" data-test="cloud-sync-issues"><div class="panel-title"><div><small>SINCRONIZAÇÃO</small><h2>${items.length===1?'1 item precisa de atenção':`${items.length} itens precisam de atenção`}</h2></div></div><p class="hint">Nada é descartado automaticamente. Revise somente os itens abaixo.</p><div class="sync-issue-list">${items.join('')}</div></section>`;}
function downloadPdf(name,bytes){const blob=new Blob([bytes],{type:'application/pdf'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),0);}
function successFor(kind,online){if(kind==='customer.create')return online?'Cliente salvo e sincronizado.':'Cliente salvo neste aparelho.';if(kind==='vehicle.create')return online?'Veículo salvo e sincronizado.':'Veículo salvo neste aparelho.';if(kind==='rental.create')return online?'Locação salva e sincronizada.':'Locação salva neste aparelho.';if(kind==='inspection.create')return online?'Vistoria e evidência salvas.':'Vistoria e foto salvas neste aparelho.';if(kind==='billing.payment'||kind==='rental.payment')return online?'Recebimento sincronizado.':'Recebimento salvo neste aparelho.';return online?'Alteração salva e sincronizada.':'Alteração salva neste aparelho.';}

function renderRecovery(app,repository,runtime,{error='',username=''}={}){
  app.innerHTML=`<div class="login-wrap"><form id="cloud-recovery" class="login-card"><div class="brand big"><span class="brandmark">LV</span><div><small>ARTISYS</small><strong>Sistema Locadora George</strong></div></div><h1>Recuperar acesso</h1><p class="hint">Use o código de recuperação gerado anteriormente em Configurações → Segurança. O código é de uso único.</p><label>E-mail<input name="username" type="email" autocomplete="username" value="${esc(username)}" required></label><label>Código de recuperação<input name="recoveryCode" autocomplete="off" spellcheck="false" required></label><label>Nova senha<input name="newPassword" type="password" autocomplete="new-password" minlength="10" required></label><button class="primary">Redefinir senha</button><button type="button" class="secondary" id="cloud-recovery-back">Voltar ao acesso</button><p id="cloud-recovery-error" class="error" role="alert" aria-live="assertive">${esc(error)}</p></form></div>`;
  app.querySelector('#cloud-recovery-back').onclick=()=>renderLogin(app,repository,runtime,{username});
  app.querySelector('#cloud-recovery').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,fd=new FormData(form),identity=String(fd.get('username')??'').trim().toLowerCase(),button=form.querySelector('button.primary'),errorNode=app.querySelector('#cloud-recovery-error');button.disabled=true;errorNode.textContent='';try{await repository.api.recoverAccess({installationId:CLOUD_INSTALLATION_ID,username:identity,recoveryCode:String(fd.get('recoveryCode')??'').trim(),newPassword:String(fd.get('newPassword')??'')});renderLogin(app,repository,runtime,{username:identity,notice:'Senha redefinida. Entre com a nova senha.'});}catch(recoveryError){errorNode.textContent=recoveryError?.code==='recovery_code_invalid'?'Código de recuperação inválido, expirado ou já utilizado.':message(recoveryError);button.disabled=false;}};
}
function renderLogin(app,repository,runtime,{error='',notice='',firstAccess=false,username='',currentPassword=''}={}){
  app.innerHTML=`<div class="login-wrap"><form id="cloud-login" class="login-card"><div class="brand big"><span class="brandmark">LV</span><div><small>ARTISYS</small><strong>Sistema Locadora George</strong></div></div><h1>${firstAccess?'Primeiro acesso':'Acesso online'}</h1><label>E-mail<input name="username" type="email" autocomplete="username" value="${esc(username)}" required></label><label>${firstAccess?'Senha atual':'Senha'}<input name="password" type="password" autocomplete="current-password" value="${esc(currentPassword)}" required></label>${firstAccess?'<label>Nova senha<input name="newPassword" type="password" autocomplete="new-password" minlength="10" required></label>':''}<button class="primary">${firstAccess?'Definir senha e entrar':'Entrar'}</button>${!firstAccess?'<button type="button" class="secondary" id="cloud-recover-access">Recuperar acesso</button>':''}<p class="hint">A sessão é validada pelo servidor. Operações offline ficam salvas neste aparelho.</p>${notice?`<p class="notice" role="status" aria-live="polite">${esc(notice)}</p>`:''}<p id="cloud-login-error" class="error" role="alert" aria-live="assertive">${esc(error)}</p></form></div>`;
  app.querySelector('#cloud-recover-access')?.addEventListener('click',()=>renderRecovery(app,repository,runtime,{username:String(app.querySelector('#cloud-login input[name="username"]')?.value??'')}));
  app.querySelector('#cloud-login').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,fd=new FormData(form),identity={installationId:CLOUD_INSTALLATION_ID,username:String(fd.get('username')??'').trim().toLowerCase()},password=String(fd.get('password')??''),errorNode=app.querySelector('#cloud-login-error');errorNode.textContent='';form.querySelector('button.primary').disabled=true;try{const id=await deviceId(repository),result=firstAccess?await repository.api.firstAccess({...identity,currentPassword:password,newPassword:String(fd.get('newPassword')??''),deviceId:id}):await repository.api.login({...identity,password,deviceId:id});const live={...result,_offlineSession:false};await repository.setSession(live);await renderCloudHome(app,repository,runtime,live,'overview');}catch(loginError){if(loginError?.code==='password_change_required')return renderLogin(app,repository,runtime,{firstAccess:true,username:identity.username,currentPassword:password});errorNode.textContent=message(loginError);form.querySelector('button.primary').disabled=false;}};
}

function viewModule(view){return({
  overview:{html:(snapshot,user)=>overviewHtml(snapshot,user),bind:bindOverview},
  customers:{html:(snapshot,user)=>customersHtml(snapshot,user,{editingId:uiState.editingCustomerId}),bind:bindCustomers},
  vehicles:{html:(snapshot,user)=>vehiclesHtml(snapshot,user,{editingId:uiState.editingVehicleId}),bind:bindVehicles},
  rentals:{html:rentalsHtml,bind:bindRentals},inspections:{html:inspectionsHtml,bind:bindInspections},finance:{html:financeHtml,bind:bindFinance},billing:{html:billingHtml,bind:bindBilling},delinquency:{html:delinquencyHtml,bind:bindDelinquency},contracts:{html:contractsHtml,bind:bindContracts},documents:{html:documentsHtml,bind:bindDocuments},alerts:{html:alertsHtml,bind:bindAlerts},maintenance:{html:maintenanceHtml,bind:bindMaintenance},administration:{html:administrationHtml,bind:bindAdministration}
})[view]??null;}

function ensureCloudShell(app,user){
  let shell=app.querySelector('.cloud-shell');
  if(shell)return shell;
  app.innerHTML=`<div class="app-shell cloud-shell"><aside class="sidebar"><div class="brand"><span class="brandmark">LV</span><div><small>ARTISYS</small><strong>Locadora George</strong></div></div><nav></nav><div class="sidebar-foot"><small>${esc(user.name||user.username||'Usuário')}</small><button id="cloud-logout" type="button">Sair</button></div></aside><main class="workspace"><header class="topbar cloud-syncbar"><div class="cloud-sync-summary"><strong id="cloud-sync-state" data-test="cloud-status" role="status" aria-live="polite">Preparando…</strong><small id="cloud-sync-detail">Verificando dados…</small></div><div class="actions"><button id="cloud-refresh" class="secondary" type="button">Atualizar dados</button><button id="cloud-sync" class="secondary" type="button">Sincronizar</button></div></header><div id="cloud-flash-slot" aria-live="polite"></div><div id="cloud-error-slot" role="alert" aria-live="assertive"></div><div id="cloud-conflict-slot"></div><section id="cloud-view"></section></main></div>`;
  return app.querySelector('.cloud-shell');
}
async function revalidateCloudView(app,repository,runtime,session,view,{forceFull=false,renderAfter=false,sequence=++viewRefreshSequence}={}){
  const user=session?.user;if(!user||!navigator.onLine)return;
  const resources=resourcesForView(view,user);let changed=Boolean(forceFull);
  try{
    const missing=forceFull?resources:await repository.missingResources(resources);
    if(missing.length){await repository.refresh(missing);changed=true;}
    const synced=await flushPending(repository,runtime);
    if(Number(synced?.pushed?.attempted||0)>0||Number(synced?.pulled?.applied||0)>0)changed=true;
  }catch(error){
    if(error?.status===401){await repository.clearSession();renderLogin(app,repository,runtime);return;}
    changed=true;
  }
  if(!renderAfter||!changed||sequence!==viewRefreshSequence||uiState.view!==view)return;
  await renderCloudHome(app,repository,runtime,session,view,{revalidate:false});
}

async function renderCloudHome(app,repository,runtime,session,view=uiState.view,{revalidate=true}={}){
  const renderSequence=++viewRefreshSequence,user=session?.user;if(!user)return renderLogin(app,repository,runtime);const allowed=navigationFor(user),safeView=allowed.some(item=>item.id===view)?view:'overview';uiState.view=safeView;
  await repository.outbox.normalizeInvalidConflicts?.();
  const state=await loadCloudState(repository,user,safeView),snapshot=buildCloudSnapshot(state.data),[queue,conflicts,failed,currentDeviceId]=await Promise.all([repository.outbox.summary(),repository.outbox.list({statuses:['conflict']}),repository.outbox.list({statuses:['failed']}),deviceId(repository)]),pending=queue.pending+queue.sending,status=statusText(queue,state.online,session),module=viewModule(safeView),shell=ensureCloudShell(app,user);
  const nav=shell.querySelector('.sidebar nav');nav.innerHTML=navHtml(user,safeView);
  const mobileToggle=nav.querySelector('#cloud-mobile-menu'),mobileAppbar=nav.querySelector('.mobile-appbar');if(mobileToggle&&mobileAppbar){const syncExpanded=()=>mobileAppbar.setAttribute('aria-expanded',String(mobileToggle.checked));syncExpanded();mobileToggle.addEventListener('change',syncExpanded);mobileAppbar.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();mobileAppbar.click();}});}
  const syncState=shell.querySelector('#cloud-sync-state'),syncDetail=shell.querySelector('#cloud-sync-detail'),syncButton=shell.querySelector('#cloud-sync');syncState.textContent=status;syncState.dataset.state=queue.conflict+queue.failed?'attention':!state.online?'offline':pending?'pending':'synced';
  syncDetail.textContent=queue.conflict+queue.failed?'Revise o item abaixo.':!state.online?'As alterações ficam salvas neste aparelho.':pending?`${pending} alteração(ões) aguardando envio.`:'Dados atualizados automaticamente.';
  syncButton.hidden=state.online&&pending===0&&queue.conflict===0&&queue.failed===0;
  const flashSlot=shell.querySelector('#cloud-flash-slot'),errorSlot=shell.querySelector('#cloud-error-slot'),conflictSlot=shell.querySelector('#cloud-conflict-slot'),viewNode=shell.querySelector('#cloud-view');
  flashSlot.innerHTML=flash?`<div class="notice" data-test="cloud-flash">${esc(flash)}</div>`:'';
  errorSlot.innerHTML=state.lastError?`<div class="notice error">${esc(state.lastError)}</div>`:'';
  conflictSlot.innerHTML=syncIssuesHtml(conflicts,failed);
  const firstHydration=state.missing.length>0&&navigator.onLine&&safeView!=='administration';
  viewNode.innerHTML=firstHydration?'<div class="panel" data-test="cloud-view-loading"><strong>Carregando dados desta área…</strong><p class="hint">A navegação permanece disponível enquanto os dados são atualizados.</p></div>':module?.html(snapshot,user,{...uiState,pagination:state.pagination})??'<div class="panel">Tela indisponível.</div>';
  flash='';
  const rerender=target=>{const next=target??safeView;if(next!=='inspections')uiState.inspectionPreset=null;if(next!=='maintenance')uiState.maintenancePreset=null;if(next!=='documents')uiState.rentalDocumentId=null;return renderCloudHome(app,repository,runtime,session,next);};
  if(firstHydration){
    for(const button of nav.querySelectorAll('[data-cloud-nav]'))button.onclick=()=>void rerender(button.dataset.cloudNav);
    shell.querySelector('#cloud-logout').onclick=async()=>{viewRefreshSequence++;try{await repository.api.logout();}catch{}await repository.clearSession();renderLogin(app,repository,runtime);};
    try{await repository.refresh(state.missing);}catch(error){if(error?.status===401){await repository.clearSession();renderLogin(app,repository,runtime);return;}}
    if(renderSequence===viewRefreshSequence&&uiState.view===safeView)return renderCloudHome(app,repository,runtime,session,safeView,{revalidate:false});
    return;
  }
  const actions={
    currentDeviceId,
    async queue(kind,payload,prefix='OP'){try{const result=await queueOperation(repository,runtime,{kind,payload,operationId:operationId(prefix)});if(navigator.onLine&&result?.status==='synced'){const invalidated=resourcesForMutation(kind,user);if(invalidated.length)await repository.refresh(invalidated);}flash=successFor(kind,navigator.onLine&&result?.status==='synced');return result;}catch(error){flash=message(error);throw error;}},
    async createEntity(resource,data){const entity=resource==='customers'?'customer':'vehicle',id=`${entity==='customer'?'CUS':'VEI'}-${crypto.randomUUID()}`,payload={id,...data};await queueOperation(repository,runtime,{kind:`${entity}.create`,payload,operationId:operationId(entity==='customer'?'CUS':'VEI'),optimistic:{resource,item:{...payload,version:0}}});flash=successFor(`${entity}.create`,navigator.onLine);},
    async updateEntity(resource,id,data,expectedVersion){const entity=resource==='customers'?'customer':'vehicle';await queueOperation(repository,runtime,{kind:`${entity}.update`,payload:{id,data,expectedVersion},operationId:operationId(entity==='customer'?'CUS':'VEI')});flash=navigator.onLine?'Alteração salva e sincronizada.':'Alteração salva neste aparelho.';},
    async deleteEntity(resource,id,expectedVersion){const entity=resource==='customers'?'customer':'vehicle';await queueOperation(repository,runtime,{kind:`${entity}.delete`,payload:{id,expectedVersion},operationId:operationId(entity==='customer'?'CUS':'VEI')});flash=navigator.onLine?'Registro removido e sincronizado.':'Remoção salva neste aparelho.';},
    async uploadFile(file,entityType,entityId){const id=`ATT-${crypto.randomUUID()}`;await runtime.blobs.put(id,file,{entityType,entityId,mimeType:file.type||'application/octet-stream',fileName:file.name||'arquivo'});await queueOperation(repository,runtime,{kind:'attachment.upload',payload:{attachmentId:id},operationId:operationId('ATT')});return id;},
    async flush(){return flushPending(repository,runtime);},async refresh(target=safeView){return renderCloudHome(app,repository,runtime,session,target,{revalidate:false});},async notice(text){flash=String(text||'');},
    async openInspection(rentalId,kind='pickup',options={}){uiState.inspectionPreset={rentalId:String(rentalId),kind:kind==='return'?'return':'pickup',allowPendingContinuousClose:Boolean(options.allowPendingContinuousClose)};return renderCloudHome(app,repository,runtime,session,'inspections',{revalidate:false});},
    async openRentalDocuments(rentalId){uiState.rentalDocumentId=String(rentalId);return renderCloudHome(app,repository,runtime,session,'documents',{revalidate:false});},
    async openVehicleMaintenance(vehicleId){uiState.maintenancePreset={vehicleId:String(vehicleId)};return renderCloudHome(app,repository,runtime,session,'maintenance',{revalidate:false});},
    async openFinanceSubview(target){const view=target==='billing'?'billing':'delinquency';return renderCloudHome(app,repository,runtime,session,view,{revalidate:false});},
    async loadResourcePage(resource,options={}){const current=state.pagination?.[resource]??{},next={limit:Number(options.limit??current.limit)||undefined,offset:Number(options.offset??current.offset)||0,q:options.q??current.q??'',filters:options.filters??current.filters??{},from:options.from??current.from??'',to:options.to??current.to??''};await repository.page(resource,next);return renderCloudHome(app,repository,runtime,session,safeView,{revalidate:false});},
    async loadFinanceReceivables(options={}){uiState.financeReceivables={...uiState.financeReceivables,...options,offset:Number(options.offset??uiState.financeReceivables.offset)||0};return renderCloudHome(app,repository,runtime,session,'finance',{revalidate:false});},
    async getResource(resource,id){return repository.api.get(resource,id);},
    async fetchResourcePage(resource,options={}){return repository.api.listPage(resource,options);},
    async paymentContext(rentalId){
      const rental=await repository.api.get('rentals',rentalId);if(!rental)return snapshot;
      const [installments,rentalPayments,customer,vehicle]=await Promise.all([
        repository.api.listPage('billingInstallments',{limit:100,offset:0,filters:{rentalId}}).then(result=>result.items??[]),
        repository.api.listPage('rentalPayments',{limit:100,offset:0,filters:{rentalId}}).then(result=>result.items??[]),
        rental.customerId?repository.api.get('customers',rental.customerId):null,
        rental.vehicleId?repository.api.get('vehicles',rental.vehicleId):null
      ]);
      return buildCloudSnapshot({rentals:[rental],billingInstallments:installments,rentalPayments,customers:customer?[customer]:[],vehicles:vehicle?[vehicle]:[]});
    },
    async ledgerPaymentContext(ledgerId){
      const ledger=await repository.api.get('ledger',ledgerId);if(!ledger)return snapshot;
      const rental=ledger.rentalId?await repository.api.get('rentals',ledger.rentalId):null,installment=ledger.installmentId?await repository.api.get('billingInstallments',ledger.installmentId):null;
      const [rentalPayments,installments,customer,vehicle]=rental?await Promise.all([
        repository.api.listPage('rentalPayments',{limit:100,offset:0,filters:{rentalId:rental.id}}).then(result=>result.items??[]),
        repository.api.listPage('billingInstallments',{limit:100,offset:0,filters:{rentalId:rental.id}}).then(result=>result.items??[]),
        rental.customerId?repository.api.get('customers',rental.customerId):null,
        rental.vehicleId?repository.api.get('vehicles',rental.vehicleId):null
      ]):[[],installment?[installment]:[],null,null];
      return buildCloudSnapshot({ledger:[ledger],rentals:rental?[rental]:[],rentalPayments,billingInstallments:installments,customers:customer?[customer]:[],vehicles:vehicle?[vehicle]:[]});
    },
    async paymentContext(rentalId){const rental=await repository.api.get('rentals',rentalId);if(!rental)throw Object.assign(new Error('rental_not_found'),{code:'rental_not_found'});const [installmentsPage,paymentsPage,customer,vehicle]=await Promise.all([repository.api.listPage('billingInstallments',{limit:200,filters:{rentalId}}),repository.api.listPage('rentalPayments',{limit:200,filters:{rentalId}}),rental.customerId?repository.api.get('customers',rental.customerId):null,rental.vehicleId?repository.api.get('vehicles',rental.vehicleId):null]);return buildCloudSnapshot({rentals:[rental],billingInstallments:installmentsPage.items,rentalPayments:paymentsPage.items,customers:customer?[customer]:[],vehicles:vehicle?[vehicle]:[]});},
    async ledgerPaymentContext(ledgerId){const ledger=await repository.api.get('ledger',ledgerId);if(!ledger)throw Object.assign(new Error('ledger_not_found'),{code:'ledger_not_found'});if(ledger.rentalId){const context=await this.paymentContext(ledger.rentalId);context.ledger=[ledger];return context;}return buildCloudSnapshot({ledger:[ledger]});},
    async rentalDocumentContext(rentalId){const rental=await repository.api.get('rentals',rentalId);if(!rental)throw Object.assign(new Error('rental_not_found'),{code:'rental_not_found'});const [customer,vehicle,paymentsPage,settingsPage]=await Promise.all([rental.customerId?repository.api.get('customers',rental.customerId):null,rental.vehicleId?repository.api.get('vehicles',rental.vehicleId):null,repository.api.listPage('rentalPayments',{limit:250,filters:{rentalId}}),repository.api.listPage('appSettings',{limit:10})]);return buildCloudSnapshot({rentals:[rental],customers:customer?[customer]:[],vehicles:vehicle?[vehicle]:[],rentalPayments:paymentsPage.items,appSettings:settingsPage.items});},
    async inspectionDocumentContext(inspectionId){const inspection=await repository.api.get('inspections',inspectionId);if(!inspection)throw Object.assign(new Error('inspection_not_found'),{code:'inspection_not_found'});const [vehicle,itemsPage,attachmentsPage]=await Promise.all([inspection.vehicleId?repository.api.get('vehicles',inspection.vehicleId):null,repository.api.listPage('inspectionItems',{limit:250,filters:{inspectionId}}),repository.api.listPage('attachments',{limit:250,filters:{entityType:'inspection',entityId:inspectionId}})]);return buildCloudSnapshot({inspections:[inspection],vehicles:vehicle?[vehicle]:[],inspectionItems:itemsPage.items,attachments:attachmentsPage.items});},
    async issuedDocumentContext(issuedId){const item=await repository.api.get('issuedContracts',issuedId);if(!item)throw Object.assign(new Error('issued_contract_not_found'),{code:'issued_contract_not_found'});return buildCloudSnapshot({issuedContracts:[item]});},
    async getAdminAudit(filters){return repository.api.getAdminAudit(filters);},async getAdminSettings(){return repository.api.getAdminSettings();},async getAdminDataInventory(){return repository.api.getAdminDataInventory();},async cleanupKnownFixtures(){return repository.api.cleanupKnownFixtures();},async updateAdminSettings(data,expectedVersion){return repository.api.updateAdminSettings(data,{expectedVersion});},async listCloudBackups(){return repository.api.listCloudBackups();},async createCloudBackup(){return repository.api.createCloudBackup();},async createRecoveryCode(){return repository.api.issueRecoveryCode();},
    async restoreCloudBackup(id,password){const result=await repository.api.restoreCloudBackup(id,{password,confirmation:'RESTAURAR'});await repository.clearSession();alert(`Restauração concluída. Nova geração: ${Number(result?.restoreGeneration||0)}. Entre novamente para continuar.`);renderLogin(app,repository,runtime);return result;},
    async listDevices(){return repository.api.listDevices();},async revokeDevice(id){const result=await repository.api.revokeDevice(id);if(String(id)===String(currentDeviceId)){await repository.clearSession();alert('Este dispositivo foi revogado. Entre novamente para continuar.');renderLogin(app,repository,runtime);}return result;},async revokeOtherSessions(){return repository.api.revokeOtherSessions();},async revokeAllSessions(){const result=await repository.api.revokeAllSessions();await repository.clearSession();alert('Todas as sessões foram encerradas. Entre novamente para continuar.');renderLogin(app,repository,runtime);return result;},
    downloadRentalContract(id,snap=snapshot){downloadPdf(`contrato-${id}.pdf`,rentalContractPdf(snap,id));},downloadRentalReceipt(id,snap=snapshot){downloadPdf(`recibo-${id}.pdf`,rentalReceiptPdf(snap,id));},downloadInspectionPdf(id,snap=snapshot){downloadPdf(`vistoria-${id}.pdf`,inspectionPdf(snap,id));},downloadIssuedPdf(id,snap=snapshot){downloadPdf(`contrato-emitido-${id}.pdf`,issuedContractPdf(snap,id));}
  };
  for(const button of nav.querySelectorAll('[data-cloud-nav]'))button.onclick=()=>void rerender(button.dataset.cloudNav);
  for(const button of conflictSlot.querySelectorAll('[data-cloud-accept]'))button.onclick=async()=>{if(!confirm('Usar os dados atuais da nuvem e descartar esta alteração local?'))return;try{await repository.outbox.resolveConflict(button.dataset.cloudAccept,{strategy:'accept-cloud'});if(repository.cloudSync&&navigator.onLine)await repository.cloudSync.pullChanges();flash='Dados da nuvem aplicados.';}catch(error){flash=message(error);}await rerender(safeView);};
  for(const button of conflictSlot.querySelectorAll('[data-cloud-retry]'))button.onclick=async()=>{try{await repository.outbox.retry(button.dataset.cloudRetry,{resetAttempts:true});await flushPending(repository,runtime);flash='Tentativa de sincronização concluída.';}catch(error){flash=message(error);}await rerender(safeView);};
  for(const button of conflictSlot.querySelectorAll('[data-cloud-discard]'))button.onclick=async()=>{if(!confirm('Descartar somente esta tentativa pendente? Isso não remove pagamentos que já estejam registrados na nuvem.'))return;try{await repository.outbox.discard(button.dataset.cloudDiscard,{reason:'reviewed_by_user'});if(repository.cloudSync&&navigator.onLine)await repository.cloudSync.pullChanges();flash='Tentativa pendente descartada.';}catch(error){flash=message(error);}await rerender(safeView);};
  for(const button of conflictSlot.querySelectorAll('[data-cloud-open]'))button.onclick=()=>void rerender(button.dataset.cloudOpen);
  shell.querySelector('#cloud-refresh').onclick=()=>void revalidateCloudView(app,repository,runtime,session,safeView,{forceFull:true,renderAfter:true,sequence:renderSequence});
  shell.querySelector('#cloud-sync').onclick=async()=>{try{await flushPending(repository,runtime);flash='Sincronização concluída.';}catch(error){flash=message(error);}await rerender(safeView);};
  shell.querySelector('#cloud-logout').onclick=async()=>{viewRefreshSequence++;try{await repository.api.logout();}catch{}await repository.clearSession();renderLogin(app,repository,runtime);};
  if(!firstHydration){try{module?.bind?.(viewNode,{snapshot,user,actions,state:uiState,pagination:state.pagination});}catch(error){flash=message(error);}}
  for(const button of viewNode.querySelectorAll('[data-page-resource]'))button.onclick=()=>void actions.loadResourcePage(button.dataset.pageResource,{offset:Number(button.dataset.pageOffset||0)});
  for(const form of viewNode.querySelectorAll('[data-page-search]'))form.onsubmit=event=>{event.preventDefault();const fd=new FormData(form);void actions.loadResourcePage(form.dataset.pageSearch,{offset:0,q:String(fd.get('q')??'').trim()});};
  for(const button of viewNode.querySelectorAll('[data-finance-page]'))button.onclick=()=>void actions.loadFinanceReceivables({offset:Number(button.dataset.financePage||0)});
  for(const form of viewNode.querySelectorAll('[data-finance-search]'))form.onsubmit=event=>{event.preventDefault();const fd=new FormData(form);void actions.loadFinanceReceivables({offset:0,q:String(fd.get('q')??'').trim()});};
  if(revalidate&&navigator.onLine)void revalidateCloudView(app,repository,runtime,session,safeView,{renderAfter:false,sequence:renderSequence});
}

export async function bootstrapCloudApp({app=document.querySelector('#app'),baseUrl=location.origin}={}){
  if(!app)throw new Error('app_required');app.innerHTML='<div class="login-wrap"><div class="login-card"><strong>Preparando aplicação…</strong><p>Preparando cache e fila offline.</p></div></div>';
  const repository=await createRuntimeRepository({mode:'cloud',baseUrl}),runtime={blobs:createOfflineBlobStore()};
  if('serviceWorker' in navigator&&globalThis.isSecureContext){try{await navigator.serviceWorker.register('./sw.js');}catch{}}
  const cached=await repository.session();
  async function restore(){if(navigator.onLine){try{const live=await repository.api.session();const session={...live,_offlineSession:false};await repository.setSession(session);await renderCloudHome(app,repository,runtime,session,uiState.view);return;}catch(error){if(error?.status===401){await repository.clearSession();renderLogin(app,repository,runtime);return;}if(cached?.user){await renderCloudHome(app,repository,runtime,{...cached,_offlineSession:true},uiState.view);return;}}}if(cached?.user){await renderCloudHome(app,repository,runtime,{...cached,_offlineSession:true},uiState.view);return;}renderLogin(app,repository,runtime);}
  window.addEventListener('online',()=>{void(async()=>{const local=await repository.session();if(!local?.user)return;try{const live=await repository.api.session();const session={...live,_offlineSession:false};await repository.setSession(session);await renderCloudHome(app,repository,runtime,session,uiState.view,{revalidate:false});await flushPending(repository,runtime);await renderCloudHome(app,repository,runtime,session,uiState.view,{revalidate:false});}catch(error){if(error?.status===401){await repository.clearSession();renderLogin(app,repository,runtime);}else await renderCloudHome(app,repository,runtime,{...local,_offlineSession:true},uiState.view,{revalidate:false});}})();});
  window.addEventListener('offline',()=>{void(async()=>{const local=await repository.session();if(local?.user)await renderCloudHome(app,repository,runtime,{...local,_offlineSession:true},uiState.view);})();});
  await restore();return{repository,runtime};
}
