import { prepareSnapshotRestore } from './domain/backup.mjs';
import { authenticate,can } from './domain/auth.mjs';
import { getFinancialSummary } from './domain/commercial-finance.mjs';
import { ensureOpenDailyRentals } from './domain/daily-billing.mjs';
import { buildOperationalAlerts } from './domain/alerts.mjs';
import { createRepository,isCloudRuntime } from './storage/repository.mjs';
import { esc,money,toast } from './ui/common.mjs';
import { renderReservas } from './ui/reservas.mjs';
import { renderClientes,renderFrota } from './ui/cadastros.mjs';
import { renderFinanceiro } from './ui/financeiro.mjs';
import { renderAuditoria,renderBackup } from './ui/system.mjs';
import { renderDashboard,renderVistorias,renderManutencao,renderAlertas,renderDocumentos } from './ui/p1.mjs';
import { renderContracts,renderBilling,renderDelinquency } from './ui/commercial.mjs';

let repository=null,snapshot=null,sessionUser=null,active='dashboard',restoring=false,cloudFirstAccess=null,replicaUnsubscribe=null,cloudRefreshTimer=null;
let cloudState={authenticated:false,total:0,pending:0,sending:0,synced:0,conflict:0,failed:0};
let cloudConflicts=[];
const app=document.querySelector('#app');

function scheduleCloudStatus(delay=250){clearTimeout(cloudRefreshTimer);cloudRefreshTimer=setTimeout(()=>{void refreshCloudStatus();},delay);}
function save(next){try{snapshot=repository.save(next);render();scheduleCloudStatus();return snapshot;}catch(error){toast(`Falha ao salvar localmente: ${error.message}`);throw error;}}
async function replaceSnapshot(next){if(restoring)throw new Error('Uma restauração já está em andamento.');restoring=true;try{snapshot=repository.save(prepareSnapshotRestore(next,snapshot));await repository.flush();await syncCloudNow({silent:true});render();return snapshot;}finally{restoring=false;}}
function context(){return{snapshot,sessionUser,save,replaceSnapshot,repository,syncCloudNow};}
function accrueDailySchedules(asOf=new Date().toISOString()){if(!snapshot||!repository)return false;const before=(snapshot.billingInstallments??[]).length,next=ensureOpenDailyRentals(snapshot,asOf,'SYSTEM');if((next.billingInstallments??[]).length===before)return false;snapshot=repository.save(next);scheduleCloudStatus();return true;}

function cloudLabel(){if(cloudState.conflict>0)return`Nuvem: conflito (${cloudState.conflict})`;if(navigator.onLine===false)return'Nuvem: offline';const pending=(cloudState.pending||0)+(cloudState.sending||0)+(cloudState.failed||0);if(pending>0)return`Nuvem: ${pending} pendente${pending===1?'':'s'}`;return cloudState.authenticated?'Nuvem: sincronizada':'Nuvem: sessão local';}
function conflictPanel(){if(!cloudConflicts.length)return'';return`<section class="panel" id="cloud-conflicts"><div class="section-head"><div><h2>Conflitos de sincronização</h2><p>A versão da nuvem não será sobrescrita automaticamente. Compare os dados e aceite a versão canônica quando estiver correto.</p></div></div>${cloudConflicts.map(item=>{const current=item.lastError?.details?.current??null;return`<article class="card"><strong>${esc(item.kind)}</strong><p class="hint">Alteração local</p><pre>${esc(JSON.stringify(item.payload,null,2))}</pre><p class="hint">Versão atual da nuvem</p><pre>${esc(JSON.stringify(current,null,2))}</pre><button class="secondary" data-accept-cloud="${esc(item.id)}">Usar versão da nuvem</button></article>`;}).join('')}</section>`;}

async function refreshCloudStatus({rerender=true}={}){if(!window.locadoraDesktop?.cloudSyncStatus)return cloudState;try{cloudState=await window.locadoraDesktop.cloudSyncStatus();cloudConflicts=window.locadoraDesktop.cloudSyncConflicts?await window.locadoraDesktop.cloudSyncConflicts():[];}catch{cloudState={...cloudState,authenticated:Boolean(cloudState.authenticated)};}if(rerender&&sessionUser)render();return cloudState;}
async function syncCloudNow({silent=false}={}){try{await repository?.flush?.();if(window.locadoraDesktop?.cloudSyncNow)await window.locadoraDesktop.cloudSyncNow();await refreshCloudStatus({rerender:false});if(!silent&&sessionUser)render();return{ok:true,...cloudState};}catch(error){if(!silent)toast(navigator.onLine===false?'Sem internet. As alterações continuam salvas neste computador.':`Falha ao sincronizar com a nuvem: ${error.message}`);await refreshCloudStatus({rerender:false});if(!silent&&sessionUser)render();return{ok:false,error,...cloudState};}}
async function acceptCloudConflict(id){if(!window.locadoraDesktop?.cloudSyncResolveConflict)return;try{await window.locadoraDesktop.cloudSyncResolveConflict(id,{strategy:'accept-cloud'});await repository.flush();snapshot=await repository.reload();await refreshCloudStatus({rerender:false});render();toast('Versão da nuvem aplicada.');}catch(error){toast(`Não foi possível resolver o conflito: ${error.message}`);}}

function render(){
  if(!snapshot)return;accrueDailySchedules();if(!sessionUser)return renderLogin();
  const summary=getFinancialSummary(snapshot),alerts=buildOperationalAlerts(snapshot);
  const nav=[['dashboard','Dashboard'],['reservas','Locações'],...(can(sessionUser,'customer.read')?[['clientes','Clientes']]:[]),...(can(sessionUser,'vehicle.read')?[['frota','Frota']]:[]),...(can(sessionUser,'inspection.read')||can(sessionUser,'inspection.write')?[['vistorias','Vistorias']]:[]),...(can(sessionUser,'maintenance.read')?[['manutencao','Manutenção']]:[]),...(can(sessionUser,'finance.read')?[['financeiro','Financeiro']]:[]),...(can(sessionUser,'billing.read')?[['cobrancas','Cobranças'],['inadimplencia','Inadimplência']]:[]),...(can(sessionUser,'contracts.read')?[['contratos','Contratos']]:[]),...(can(sessionUser,'alerts.read')?[['alertas',`Alertas${alerts.length?` (${alerts.length})`:''}`]]:[]),...(can(sessionUser,'documents.read')?[['documentos','Documentos']]:[]),...(sessionUser.role==='admin'?[['auditoria','Auditoria']]:[]),...(can(sessionUser,'backup.create')||sessionUser.role==='admin'?[['backup','Backup e Config.']]:[])];
  if(!nav.some(([id])=>id===active))active='dashboard';
  const storageLabel=repository.kind==='sqlite-desktop'?'SQLite PC':repository.kind==='sqlite-opfs'?'SQLite Web':'Armazenamento Web';
  app.innerHTML=`<div class="shell"><aside class="sidebar"><div class="brand"><span class="brandmark">LV</span><div><small>SISTEMA</small><strong>LOCADORA</strong></div></div><nav>${nav.map(([id,label])=>`<button data-nav="${id}" class="nav ${active===id?'active':''}">${label}</button>`).join('')}</nav><div class="session"><strong>${esc(sessionUser.name)}</strong><small>${esc(sessionUser.role)}</small><button id="logout">Sair</button></div></aside><main><header class="topbar"><span>${snapshot.rentals.filter(r=>r.status!=='devolucao').length} locações abertas</span><span>${snapshot.vehicles.length} veículos</span><span>${money(summary.openAmount)} em aberto</span><span>${alerts.length} alertas</span><button id="cloud-status" class="nav">${esc(cloudLabel())}</button><span>${storageLabel}</span></header><section id="view" class="content"></section><div class="content">${conflictPanel()}</div></main></div>`;
  app.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{active=b.dataset.nav;render();});
  app.querySelector('#cloud-status').onclick=()=>{void syncCloudNow();};
  app.querySelectorAll('[data-accept-cloud]').forEach(button=>button.onclick=()=>{void acceptCloudConflict(button.dataset.acceptCloud);});
  app.querySelector('#logout').onclick=async()=>{if(window.locadoraDesktop?.cloudAuthLogout)await window.locadoraDesktop.cloudAuthLogout().catch(()=>{});sessionUser=null;cloudFirstAccess=null;cloudState={authenticated:false,total:0,pending:0,sending:0,synced:0,conflict:0,failed:0};cloudConflicts=[];active='dashboard';render();};
  const views={dashboard:renderDashboard,reservas:renderReservas,clientes:renderClientes,frota:renderFrota,vistorias:renderVistorias,manutencao:renderManutencao,financeiro:renderFinanceiro,cobrancas:renderBilling,inadimplencia:renderDelinquency,contratos:renderContracts,alertas:renderAlertas,documentos:renderDocumentos,auditoria:renderAuditoria,backup:renderBackup};
  (views[active]??renderDashboard)(app.querySelector('#view'),context());
}

function cloudAuthMessage(code){if(code==='invalid_credentials')return'E-mail ou senha inválidos.';if(code==='password_change_required')return'É necessário definir uma nova senha no primeiro acesso.';if(code==='weak_password')return'A nova senha precisa ter pelo menos 10 caracteres.';if(code==='secure_storage_unavailable')return'Não foi possível proteger a sessão neste computador.';if(code==='device_revoked')return'Este computador foi revogado. Entre em contato com o administrador.';return'Não foi possível autenticar na nuvem.';}
function renderLogin(){
  const cloud=Boolean(window.locadoraDesktop?.cloudAuthLogin),first=cloud&&Boolean(cloudFirstAccess),defaultUsername=cloud?(cloudFirstAccess?.username||'georgedaut.adm@gmail.com'):'admin';
  app.innerHTML=`<div class="login-wrap"><form id="login" class="login-card"><div class="brand big"><span class="brandmark">LV</span><div><small>ARTISYS</small><strong>Sistema Locadora</strong></div></div><h1>${first?'Primeiro acesso':'Acesso'}</h1><label>${cloud?'E-mail':'Usuário'}<input name="username" ${cloud?'type="email"':''} autocomplete="username" value="${esc(defaultUsername)}" required></label><label>${first?'Senha atual':'Senha'}<input name="password" type="password" autocomplete="current-password" required></label>${first?'<label>Nova senha<input name="newPassword" type="password" minlength="10" autocomplete="new-password" required></label>':''}<button class="primary">${first?'Definir senha e entrar':'Entrar'}</button><p class="hint">${cloud?'Use a mesma conta do celular/PWA. A sessão deste PC fica salva separadamente.':'Use as credenciais configuradas para esta instalação.'}</p><p id="login-error" class="error"></p></form></div>`;
  app.querySelector('#login').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,fd=new FormData(form),errorNode=app.querySelector('#login-error');errorNode.textContent='';form.querySelector('button').disabled=true;
    if(cloud){const username=String(fd.get('username')??'').trim().toLowerCase(),password=String(fd.get('password')??''),result=first?await window.locadoraDesktop.cloudAuthFirstAccess({username,currentPassword:password,newPassword:String(fd.get('newPassword')??'')}):await window.locadoraDesktop.cloudAuthLogin({username,password});if(!result?.ok){if(result?.error==='password_change_required'){cloudFirstAccess={username};form.querySelector('button').disabled=false;return renderLogin();}errorNode.textContent=cloudAuthMessage(result?.error);form.querySelector('button').disabled=false;return;}cloudFirstAccess=null;sessionUser=result.user;await refreshCloudStatus({rerender:false});render();return;}
    const user=await authenticate(snapshot.users,fd.get('username'),fd.get('password'));if(!user){errorNode.textContent='Usuário ou senha inválidos.';form.querySelector('button').disabled=false;return;}sessionUser=user;await refreshCloudStatus({rerender:false});render();};
}

async function refreshFromReplica(){try{await repository.flush();snapshot=await repository.reload();await refreshCloudStatus({rerender:false});render();}catch(error){toast(`Falha ao atualizar dados da nuvem: ${error.message}`);}}
function bindReplicaRefresh(){replicaUnsubscribe?.();replicaUnsubscribe=null;if(window.locadoraDesktop?.onReplicaChanged)replicaUnsubscribe=window.locadoraDesktop.onReplicaChanged(()=>{void refreshFromReplica();});}
function bindCloudLifecycle(){window.addEventListener('online',()=>{void syncCloudNow({silent:true});});window.addEventListener('offline',()=>{if(sessionUser)render();});setInterval(()=>{const accrued=accrueDailySchedules();if(accrued&&sessionUser)render();void refreshCloudStatus({rerender:Boolean(sessionUser)});},15000);}

async function bootstrap(){
  if(isCloudRuntime()){try{const { bootstrapCloudApp }=await import('./cloud-app.mjs');return await bootstrapCloudApp({app,baseUrl:location.origin});}catch(error){app.innerHTML=`<div class="login-wrap"><div class="login-card"><h1>Falha ao iniciar acesso online</h1><p class="error">${esc(error.message)}</p><p class="hint">O cache local não será usado para substituir silenciosamente o servidor.</p></div></div>`;return;}}
  app.innerHTML='<div class="login-wrap"><div class="login-card"><strong>Inicializando armazenamento local…</strong><p class="hint">Os dados permanecem neste dispositivo e sincronizam com a nuvem quando a conexão estiver disponível.</p></div></div>';
  try{
    repository=await createRepository({onPersistenceError:error=>toast(`Falha ao gravar no dispositivo: ${error.message}. Salve novamente após corrigir o armazenamento.`)});snapshot=repository.load();bindReplicaRefresh();bindCloudLifecycle();
    if(window.locadoraDesktop?.cloudAuthStatus){try{const cloud=await window.locadoraDesktop.cloudAuthStatus();if(cloud?.authenticated&&cloud.user)sessionUser=cloud.user;}catch{}}
    await refreshCloudStatus({rerender:false});render();
  }catch(error){app.innerHTML=`<div class="login-wrap"><div class="login-card"><h1>Falha ao iniciar</h1><p class="error">${esc(error.message)}</p><p class="hint">Use um navegador moderno com armazenamento local habilitado.</p></div></div>`;}
}
void bootstrap();
