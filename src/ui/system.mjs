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
  const replicaPanel=admin&&desktop?`<section class="panel" id="plan03-ops">
    <h2>Réplica e recuperação</h2>
    <p id="plan03-status">Carregando diagnóstico…</p>
    <form id="plan03-replica-config" class="form-grid">
      <label>URL cloud<input name="baseUrl" type="url" placeholder="https://seu-dominio.com" required></label>
      <label>Credencial do PC<input name="deviceToken" type="password" autocomplete="off" minlength="32" placeholder="Cole a credencial gerada no painel web" required></label>
      <div class="full"><button class="primary">Configurar réplica e sincronizar</button><small>Gere uma credencial revogável no painel web <strong>/security.html</strong>. A credencial é cifrada pelo armazenamento seguro do Windows/Electron.</small></div>
    </form>
    <div class="stack"><button id="replica-sync-now">Sincronizar réplica agora</button><button id="plan03-refresh">Atualizar diagnóstico</button></div>
  </section>`:'';

  view.innerHTML=`<div class="heading"><div><small>SEGURANÇA DOS DADOS</small><h1>Backup e configurações</h1></div></div><div class="split"><section class="panel"><h2>Backup verificável</h2><p>O arquivo v3 inclui SHA-256 e é validado antes da restauração.</p><div class="stack">${canCreate?'<button id="backup-create" class="primary">Gerar backup</button>':''}${desktop&&canCreate?'<button id="backup-local-create">Backup físico do PC agora</button>':''}${admin?'<label class="file-button">Restaurar backup<input id="backup-file" type="file" accept="application/json"></label><small>Aceita backups P0/v2 e snapshot legado 0.1.5, migrando automaticamente para v3.</small>':''}</div></section>${admin?`<section class="panel"><h2>Empresa</h2><form id="settings-form" class="form-grid"><label>Nome<input name="companyName" value="${esc(snapshot.settings.companyName)}"></label><label>CPF/CNPJ<input name="document" value="${esc(snapshot.settings.document)}"></label><label>Telefone<input name="phone" value="${esc(snapshot.settings.phone)}"></label><label>Endereço<input name="address" value="${esc(snapshot.settings.address)}"></label><div class="full"><button class="primary">Salvar configurações</button></div></form></section>`:''}${replicaPanel}</div>`;

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

  const status=view.querySelector('#plan03-status');
  async function refresh(){
    if(!status)return;
    try{
      const d=await window.locadoraDesktop.getOperationalDiagnostics(),r=d.replica||{};
      status.textContent=`Backup: ${d.backupValid??d.localBackup?.valid?'OK':'atenção'} · Cloud: ${d.cloudConfigured??d.cloud?.configured?'configurada':'não configurada'} · Cursor: ${r.cursor??0} · Geração: ${r.restoreGeneration??0} · Última réplica: ${r.lastSuccessAt?date(r.lastSuccessAt):'nunca'}${r.lastError?` · Erro: ${r.lastError}`:''}`;
    }catch(error){status.textContent=`Diagnóstico indisponível: ${error.message}`;}
  }

  const replicaForm=view.querySelector('#plan03-replica-config');
  if(replicaForm)replicaForm.onsubmit=async event=>{
    event.preventDefault();
    const fd=new FormData(replicaForm),baseUrl=String(fd.get('baseUrl')||'').trim(),deviceToken=String(fd.get('deviceToken')||'').trim();
    try{
      await window.locadoraDesktop.replicaConfigure({baseUrl,deviceToken});
      replicaForm.querySelector('[name="deviceToken"]').value='';
      toast('Réplica configurada. O PC está reconstruindo/sincronizando os dados cloud.');
      await refresh();
    }catch(error){toast(`Falha ao configurar réplica: ${error.message}`);}
  };

  view.querySelector('#replica-sync-now')?.addEventListener('click',async()=>{
    try{await window.locadoraDesktop.replicaSyncNow();toast('Réplica sincronizada.');await refresh();}
    catch(error){toast(`Réplica indisponível: ${error.message}`);}
  });
  view.querySelector('#plan03-refresh')?.addEventListener('click',refresh);
  void refresh();
}
