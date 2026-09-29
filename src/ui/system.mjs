import {createBackupEnvelope,restoreBackupEnvelope,isLegacyBackupPayload} from '../domain/backup.mjs';
import {migrateLegacySnapshot} from '../domain/rental.mjs';
import {ensureP1Snapshot} from '../domain/p1.mjs';
import {can} from '../domain/auth.mjs';
import {date,download,esc,toast} from './common.mjs';

export function renderAuditoria(view,{snapshot}){
  view.innerHTML=`<div class="heading"><div><small>HISTÓRICO</small><h1>Auditoria</h1></div></div><section class="panel"><div class="table-wrap"><table><thead><tr><th>Data</th><th>Usuário</th><th>Ação</th><th>Entidade</th><th>ID</th></tr></thead><tbody>${snapshot.audit.map(a=>`<tr><td>${date(a.at)}</td><td>${esc(snapshot.users.find(u=>u.id===a.actorId)?.name||a.actorId)}</td><td>${esc(a.action)}</td><td>${esc(a.entityType)}</td><td>${esc(a.entityId)}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">Nenhuma ação auditada.</td></tr>'}</tbody></table></div></section>`;
}

export function renderBackup(view,ctx){
  const{snapshot,replaceSnapshot,save,sessionUser}=ctx;
  const canCreate=can(sessionUser,'backup.create'),admin=sessionUser.role==='admin',desktop=Boolean(window.locadoraDesktop?.getOperationalDiagnostics);
  const cloudPanel=admin&&desktop?`<section class="panel" id="plan03-ops">
    <h2>Nuvem e recuperação</h2>
    <p id="plan03-status">Carregando diagnóstico…</p>
    <p class="hint">Dados estruturados sincronizam com D1 e fotos/documentos com R2. Não é necessário parear computador e celular.</p>
    <div class="stack"><button id="cloud-sync-now" class="primary">Sincronizar nuvem agora</button><button id="plan03-refresh">Atualizar diagnóstico</button></div>
    <div id="cloud-conflict-list"></div>
  </section>`:'';

  view.innerHTML=`<div class="heading"><div><small>SEGURANÇA DOS DADOS</small><h1>Backup e configurações</h1></div></div><div class="split"><section class="panel"><h2>Backup verificável</h2><p>O arquivo v3 inclui SHA-256 e é validado antes da restauração.</p><div class="stack">${canCreate?'<button id="backup-create" class="primary">Gerar backup</button>':''}${desktop&&canCreate?'<button id="backup-local-create">Backup físico do PC agora</button>':''}${admin?'<label class="file-button">Restaurar backup<input id="backup-file" type="file" accept="application/json"></label><small>Aceita backups P0/v2 e snapshot legado 0.1.5, migrando automaticamente para v3.</small>':''}</div></section>${admin?`<section class="panel"><h2>Empresa</h2><form id="settings-form" class="form-grid"><label>Nome<input name="companyName" value="${esc(snapshot.settings.companyName)}"></label><label>CPF/CNPJ<input name="document" value="${esc(snapshot.settings.document)}"></label><label>Telefone<input name="phone" value="${esc(snapshot.settings.phone)}"></label><label>Endereço<input name="address" value="${esc(snapshot.settings.address)}"></label><div class="full"><button class="primary">Salvar configurações</button></div></form></section>`:''}${cloudPanel}</div>`;

  view.querySelector('#backup-create')?.addEventListener('click',async()=>{
    const raw=await createBackupEnvelope(snapshot);
    download(`backup-locadora-${new Date().toISOString().slice(0,10)}.json`,raw);
    toast('Backup com integridade gerado.');
  });

  view.querySelector('#backup-local-create')?.addEventListener('click',async()=>{
    try{await window.locadoraDesktop.createLocalBackup();toast('Backup físico verificado e salvo no PC.');}
    catch(error){toast(`Falha no backup físico: ${error.message}`);}
  });

  const file=view.querySelector('#backup-file');
  if(file)file.onchange=async e=>{
    const selected=e.target.files?.[0];if(!selected)return;
    const raw=await selected.text();
    try{
      let restored;
      if(isLegacyBackupPayload(raw))restored=migrateLegacySnapshot(raw);else restored=await restoreBackupEnvelope(raw);
      await replaceSnapshot(ensureP1Snapshot(restored));
      toast('Backup restaurado.');
    }catch(err){toast(`Falha ao restaurar: ${err.message}`);}
  };

  const settings=view.querySelector('#settings-form');
  if(settings)settings.onsubmit=e=>{
    e.preventDefault();
    const fd=Object.fromEntries(new FormData(e.currentTarget));
    save({...snapshot,settings:{...snapshot.settings,...fd},updatedAt:new Date().toISOString()});
    toast('Configurações salvas.');
  };

  const status=view.querySelector('#plan03-status'),conflictList=view.querySelector('#cloud-conflict-list');
  async function refresh(){
    if(!status)return;
    try{
      const [d,cloud,conflicts]=await Promise.all([
        window.locadoraDesktop.getOperationalDiagnostics(),
        window.locadoraDesktop.cloudSyncStatus?.()??null,
        window.locadoraDesktop.cloudSyncConflicts?.()??[]
      ]),r=d.replica||{},pending=(cloud?.pending||0)+(cloud?.sending||0)+(cloud?.failed||0);
      const cloudLabel=!cloud?.authenticated?'sessão necessária':cloud?.conflict?`${cloud.conflict} conflito(s)`:pending?`${pending} pendência(s)`:'sincronizada';
      status.textContent=`Backup: ${d.backupValid??d.localBackup?.valid?'OK':'atenção'} · Nuvem: ${cloudLabel} · Cursor: ${r.cursor??0} · Geração: ${r.restoreGeneration??0} · Última réplica: ${r.lastSuccessAt?date(r.lastSuccessAt):'nunca'}${r.lastError?` · Erro: ${r.lastError}`:''}`;
      if(conflictList)conflictList.innerHTML=(conflicts||[]).length?`<h3>Conflitos pendentes</h3>${conflicts.map(item=>`<article class="card"><strong>${esc(item.kind)}</strong><p class="hint">Local</p><pre>${esc(JSON.stringify(item.payload,null,2))}</pre><p class="hint">Nuvem</p><pre>${esc(JSON.stringify(item.lastError?.details?.current??null,null,2))}</pre><button data-cloud-conflict="${esc(item.id)}">Aceitar dados da nuvem</button></article>`).join('')}`:'';
      conflictList?.querySelectorAll('[data-cloud-conflict]').forEach(button=>button.onclick=async()=>{try{await window.locadoraDesktop.cloudSyncResolveConflict(button.dataset.cloudConflict,{strategy:'accept-cloud'});toast('Versão da nuvem aplicada.');await refresh();}catch(error){toast(`Falha ao resolver conflito: ${error.message}`);}});
    }catch(error){status.textContent=`Diagnóstico indisponível: ${error.message}`;}
  }

  view.querySelector('#cloud-sync-now')?.addEventListener('click',async()=>{
    try{await window.locadoraDesktop.cloudSyncNow();toast('Sincronização da nuvem concluída.');await refresh();}
    catch(error){toast(`Nuvem indisponível: ${error.message}`);}
  });
  view.querySelector('#plan03-refresh')?.addEventListener('click',refresh);
  void refresh();
}
