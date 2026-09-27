import { date, esc, toast } from './common.mjs';

export function renderSync(view,ctx){
  const {syncClient,syncInfo,syncNow,replaceSnapshot}=ctx;
  const meta=syncClient.load();
  const offline=syncClient.offlineState();
  const conflict=syncClient.getConflict();
  const pairUrls=syncInfo?.pairingUrls??[];
  const isDesktop=Boolean(syncInfo?.available);
  const online=navigator.onLine!==false;
  view.innerHTML=`<div class="heading"><div><small>PC ↔ MOBILE</small><h1>Sincronização local</h1></div><span class="badge">${isDesktop?'PC servidor':'Web / Mobile'}</span></div>
  <div class="sync-grid">
    <section class="panel"><h2>Configuração</h2><p class="mobile-note">A sincronização funciona pela mesma rede Wi-Fi/LAN. O PC mantém o ponto de encontro dos dados e o navegador no celular mantém os dados locais.</p>
      ${!isDesktop?`<div class="pair-import"><label>Link de pareamento<input id="pair-link" placeholder="Cole aqui o link exibido no PC"></label><button type="button" class="secondary" id="apply-pair">Aplicar link</button></div>`:''}
      <form id="sync-form" class="form-grid">
        <label>Nome deste dispositivo<input name="deviceName" value="${esc(meta.deviceName|| (isDesktop?'PC':'Celular'))}" placeholder="Ex.: Celular pátio"></label>
        <label>Servidor do PC<input name="serverUrl" value="${esc(meta.serverUrl||syncInfo?.localUrl||'')}" ${isDesktop?'readonly':''} placeholder="http://192.168.0.10:4174"></label>
        <label class="full">Token de pareamento<input name="token" value="${esc(meta.token||syncInfo?.token||'')}" ${isDesktop?'readonly':''} autocomplete="off"></label>
        <label class="check"><input name="enabled" type="checkbox" ${meta.enabled?'checked':''}> Sincronização habilitada</label>
        <label class="check"><input name="autoSync" type="checkbox" ${meta.autoSync?'checked':''}> Sincronizar automaticamente</label>
        <div class="full sync-actions"><button class="primary">Salvar</button><button type="button" class="secondary" id="sync-now">Sincronizar agora</button></div>
      </form>
      ${conflict?`<div class="sync-warning"><strong>Cópia local preservada após conflito</strong><p class="mobile-note">Uma versão mais recente veio do outro dispositivo. A versão local anterior foi guardada para recuperação manual.</p><button id="restore-conflict" class="secondary">Restaurar cópia local</button></div>`:''}
    </section>
    <section class="panel"><h2>Status</h2><div class="sync-status">
      <p><span>Rede</span><strong class="${online?'sync-ok':'sync-error'}">${online?'Disponível':'Offline'}</strong></p>
      <p><span>Alterações pendentes</span><strong class="${offline.dirty?'sync-error':'sync-ok'}">${offline.pending.length}</strong></p>
      <p><span>Estado</span><strong class="${meta.lastError?'sync-error':'sync-ok'}">${meta.enabled?(meta.lastError?'Aguardando PC / offline':'Ativo'):'Desativado'}</strong></p>
      <p><span>Revisão</span><strong>${meta.revision}</strong></p>
      <p><span>Última sincronização</span><strong>${meta.lastSyncAt?date(meta.lastSyncAt):'Nunca'}</strong></p>
      <p><span>Última direção</span><strong>${esc(meta.lastDirection||'-')}</strong></p>
      ${offline.dirtySince?`<p><span>Pendente desde</span><strong>${date(offline.dirtySince)}</strong></p>`:''}
      ${meta.lastError?`<p><span>Erro</span><strong class="sync-error">${esc(meta.lastError)}</strong></p>`:''}
      <p><span>Device ID</span><code>${esc(meta.deviceId)}</code></p>
    </div></section>
  </div>
  ${isDesktop?`<section class="panel"><h2>Abrir no celular</h2><p class="mobile-note">Com o celular conectado à mesma rede Wi-Fi/LAN do PC, abra um dos links abaixo no navegador. O sistema abre direto na versão web responsiva e faz o pareamento automaticamente pelo token do link.</p><div class="pair-list">${pairUrls.length?pairUrls.map((url,i)=>`<div class="pair-link"><code>${esc(url)}</code><button data-copy="${esc(url)}">Copiar ${i+1}</button></div>`).join(''):'<div class="empty">Nenhum endereço LAN detectado. Verifique a conexão de rede do PC.</div>'}</div><p class="mobile-note">Para acessar e sincronizar com o PC, mantenha o celular na mesma rede local.</p></section>`:''}`;

  const form=view.querySelector('#sync-form');
  form.onsubmit=e=>{e.preventDefault();const fd=new FormData(form);syncClient.configure({deviceName:fd.get('deviceName'),serverUrl:fd.get('serverUrl'),token:fd.get('token'),enabled:form.elements.enabled.checked,autoSync:form.elements.autoSync.checked});toast('Configuração de sincronização salva.');renderSync(view,ctx);};
  view.querySelector('#apply-pair')?.addEventListener('click',()=>{try{const raw=view.querySelector('#pair-link').value.trim();const url=new URL(raw);const token=url.searchParams.get('pair');if(!token)throw new Error('Link sem token de pareamento.');syncClient.configure({serverUrl:url.origin,token,enabled:true,autoSync:true,deviceName:meta.deviceName||'Celular'});toast('Pareamento aplicado. Sincronize agora.');renderSync(view,ctx);}catch(error){toast(error.message||'Link de pareamento inválido.');}});
  view.querySelector('#sync-now').onclick=async()=>{toast('Sincronizando...');const result=await syncNow();toast(result?.ok?'Sincronização concluída.':(result?.error?.message||'Não foi possível sincronizar.'));};
  view.querySelector('#restore-conflict')?.addEventListener('click',async()=>{const saved=syncClient.getConflict();if(!saved)return;try{await replaceSnapshot(saved);syncClient.clearConflict();await syncClient.flush();toast('Cópia local restaurada e marcada como pendente.');}catch(error){toast(`Falha ao restaurar: ${error.message}`);}});
  view.querySelectorAll('[data-copy]').forEach(button=>button.onclick=async()=>{try{await navigator.clipboard.writeText(button.dataset.copy);toast('Link copiado.');}catch{toast('Não foi possível copiar automaticamente.');}});
}
