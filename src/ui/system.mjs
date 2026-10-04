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
    <h2>Sincronização e dispositivos</h2>
    <p class="hint">Os dados deste computador e do celular são sincronizados automaticamente quando há internet.</p>
    <div class="stack"><button id="cloud-sync-now" class="primary">Sincronizar agora</button></div>
    <hr>
    <h3>Dispositivos conectados</h3>
    <p class="hint">Você pode encerrar o acesso de outro computador ou celular sem afetar este dispositivo.</p>
    <div id="cloud-device-list"><p>Carregando dispositivos…</p></div>
    <button id="cloud-revoke-other-sessions">Encerrar acessos em outros dispositivos</button>
    <details class="advanced-diagnostics">
      <summary>Diagnóstico avançado</summary>
      <div class="advanced-diagnostics-body">
        <p id="plan03-status">Carregando diagnóstico…</p>
        <p class="hint">Dados estruturados usam D1; fotos e documentos usam R2. A réplica local do PC usa SQLite.</p>
        <button id="plan03-refresh">Atualizar diagnóstico</button>
        <div id="cloud-conflict-list"></div>
        <hr>
        <h3>Migração e recuperação da nuvem</h3>
        <p id="cloud-migration-status">Verificando estado da migração…</p>
        <p class="hint">Antes de substituir uma base local, o sistema gera e verifica uma cópia de segurança.</p>
        <div class="stack"><button id="cloud-migration-seed" class="primary" hidden>Enviar dados deste PC</button><button id="cloud-migration-adopt" hidden>Usar dados da nuvem neste PC</button></div>
      </div>
    </details>
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

  const status=view.querySelector('#plan03-status'),conflictList=view.querySelector('#cloud-conflict-list'),deviceList=view.querySelector('#cloud-device-list'),migrationNode=view.querySelector('#cloud-migration-status'),seedButton=view.querySelector('#cloud-migration-seed'),adoptButton=view.querySelector('#cloud-migration-adopt');
  function migrationLabel(migration){
    const mode=migration?.mode??'pending';
    if(mode==='ready')return'Nuvem principal pronta. Este PC já usa a réplica cloud.';
    if(mode==='seed-cloud')return'A nuvem está vazia e este PC possui dados. É possível enviar esta base com segurança.';
    if(mode==='seed-pending')return`Dados estruturados enviados; ${Number(migration.pendingFiles||0)} arquivo(s) ainda aguardam R2.`;
    if(mode==='blocked')return'Este PC e a nuvem possuem dados. Nenhuma base será escolhida sem uma ação explícita do administrador.';
    if(mode==='new-device')return'PC novo detectado. Os dados serão reconstruídos a partir de D1/R2.';
    if(mode==='offline')return`Não foi possível validar a migração agora${migration.error?`: ${migration.error}`:''}.`;
    return'Validação de migração pendente.';
  }
  async function refresh(){
    if(!status)return;
    try{
      const [d,cloud,conflicts,devicesResult,migration]=await Promise.all([
        window.locadoraDesktop.getOperationalDiagnostics(),
        window.locadoraDesktop.cloudSyncStatus?.()??null,
        window.locadoraDesktop.cloudSyncConflicts?.()??[],
        window.locadoraDesktop.cloudDevicesList?.().catch(()=>null)??null,
        window.locadoraDesktop.migrationStatus?.().catch(()=>null)??null
      ]),r=d.replica||{},pending=(cloud?.pending||0)+(cloud?.sending||0)+(cloud?.failed||0);
      const cloudLabel=!cloud?.authenticated?'sessão necessária':cloud?.conflict?`${cloud.conflict} conflito(s)`:pending?`${pending} pendência(s)`:'sincronizada';
      status.textContent=`Backup: ${d.backupValid??d.localBackup?.valid?'OK':'atenção'} · Nuvem: ${cloudLabel} · Cursor: ${r.cursor??0} · Geração: ${r.restoreGeneration??0} · Última réplica: ${r.lastSuccessAt?date(r.lastSuccessAt):'nunca'}${r.lastError?` · Erro: ${r.lastError}`:''}`;
      if(conflictList)conflictList.innerHTML=(conflicts||[]).length?`<h3>Conflitos pendentes</h3>${conflicts.map(item=>`<article class="card"><strong>${esc(item.kind)}</strong><p class="hint">Local</p><pre>${esc(JSON.stringify(item.payload,null,2))}</pre><p class="hint">Nuvem</p><pre>${esc(JSON.stringify(item.lastError?.details?.current??null,null,2))}</pre><button data-cloud-conflict="${esc(item.id)}">Aceitar dados da nuvem</button></article>`).join('')}`:'';
      conflictList?.querySelectorAll('[data-cloud-conflict]').forEach(button=>button.onclick=async()=>{try{await window.locadoraDesktop.cloudSyncResolveConflict(button.dataset.cloudConflict,{strategy:'accept-cloud'});toast('Versão da nuvem aplicada.');await refresh();}catch(error){toast(`Falha ao resolver conflito: ${error.message}`);}});

      if(deviceList){
        const current=devicesResult?.currentDeviceId,devices=devicesResult?.devices??[];
        deviceList.innerHTML=devices.length?devices.map(device=>`<article class="card"><strong>${esc(device.name||device.id)}</strong><p class="hint">${esc(device.kind||'dispositivo')} · ${device.active?'ativo':'revogado'} · ${Number(device.sessionCount||0)} sessão(ões)${device.lastSeenAt?` · visto ${date(device.lastSeenAt)}`:''}</p>${device.id===current?'<small>Este PC</small>':device.active?`<button data-device-revoke="${esc(device.id)}">Revogar dispositivo</button>`:''}</article>`).join(''):'<p class="hint">Nenhum dispositivo listado.</p>';
        deviceList.querySelectorAll('[data-device-revoke]').forEach(button=>button.onclick=async()=>{if(!confirm('Revogar este dispositivo e encerrar as sessões dele?'))return;try{await window.locadoraDesktop.cloudDeviceRevoke(button.dataset.deviceRevoke);toast('Dispositivo revogado.');await refresh();}catch(error){toast(`Falha ao revogar dispositivo: ${error.message}`);}});
      }

      if(migrationNode){migrationNode.textContent=migrationLabel(migration);const mode=migration?.mode;seedButton.hidden=!['seed-cloud','seed-pending'].includes(mode);adoptButton.hidden=mode!=='blocked';}
    }catch(error){status.textContent=`Diagnóstico indisponível: ${error.message}`;}
  }

  view.querySelector('#cloud-sync-now')?.addEventListener('click',async()=>{
    try{await window.locadoraDesktop.cloudSyncNow();toast('Sincronização da nuvem concluída.');await refresh();}
    catch(error){toast(`Nuvem indisponível: ${error.message}`);}
  });
  view.querySelector('#plan03-refresh')?.addEventListener('click',refresh);
  view.querySelector('#cloud-revoke-other-sessions')?.addEventListener('click',async()=>{if(!confirm('Encerrar todas as outras sessões desta conta?'))return;try{await window.locadoraDesktop.cloudSessionsRevokeOthers();toast('Outras sessões revogadas.');await refresh();}catch(error){toast(`Falha ao revogar sessões: ${error.message}`);}});
  seedButton?.addEventListener('click',async()=>{if(!confirm('Enviar a base deste PC para a nuvem? Um backup verificado será criado antes da migração.'))return;seedButton.disabled=true;try{const result=await window.locadoraDesktop.migrationSeed();toast(result.mode==='seeded'?'Dados enviados para a nuvem.':'Migração iniciada; arquivos pendentes continuarão sendo enviados.');await refresh();}catch(error){toast(`Falha na migração: ${error.message}`);}finally{seedButton.disabled=false;}});
  adoptButton?.addEventListener('click',async()=>{if(!confirm('Usar os dados já existentes na nuvem neste PC? A base atual deste PC será preservada em um backup verificado antes da troca.'))return;adoptButton.disabled=true;try{await window.locadoraDesktop.migrationAdoptCloud();toast('Base da nuvem aplicada neste PC.');await refresh();}catch(error){toast(`Falha ao aplicar a nuvem: ${error.message}`);}finally{adoptButton.disabled=false;}});
  void refresh();
}
