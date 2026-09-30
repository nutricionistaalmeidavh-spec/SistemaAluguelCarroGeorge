import { createApiClient } from './api/client.mjs';

const root=document.querySelector('#security-app');
const api=createApiClient({baseUrl:location.origin});
let oneTimeCredential=null;

function esc(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
function when(value){if(!value)return'Nunca';const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString('pt-BR'):String(value);}
function errorText(error){const code=String(error?.code??error?.message??'');if(error?.status===401)return'Sessão expirada. Entre novamente no sistema.';if(error?.status===403)return code==='invalid_credentials'?'Senha de administrador inválida.':'Esta área exige um usuário administrador.';return code||'Falha inesperada.';}

async function loadState(){
  const session=await api.session();
  if(session?.user?.role!=='admin')throw Object.assign(new Error('admin_required'),{status:403});
  const [devices,backups]=await Promise.all([api.listDevices(),api.listCloudBackups()]);
  return{session,devices,backups};
}

function devicesHtml(devices){
  return devices.map(device=>`<tr><td><strong>${esc(device.name||device.id)}</strong><br><small>${esc(device.kind||'dispositivo')}</small></td><td>${device.active?'Ativo':'Revogado'}</td><td>${esc(when(device.lastSeenAt||device.sessionLastSeenAt))}</td><td>${Number(device.sessionCount||0)}</td><td>${device.active?`<button type="button" data-revoke-device="${esc(device.id)}">Revogar</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="5">Nenhum dispositivo registrado.</td></tr>';
}
function backupsHtml(backups){
  return backups.map(item=>`<tr><td>${esc(item.id)}</td><td>${esc(item.status)}</td><td>${esc(when(item.createdAt))}</td><td>${Number(item.restoreGeneration||0)}</td><td>${item.status==='valid'?`<button type="button" data-restore-backup="${esc(item.id)}">Restaurar</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="5">Nenhum backup cloud registrado.</td></tr>';
}
function credentialHtml(){if(!oneTimeCredential)return'';return `<section class="panel" id="credential-result"><h2>Credencial gerada — copie agora</h2><p>Ela é exibida somente nesta tela. No PC, abra <strong>Backup e configurações → Réplica e recuperação</strong> e informe a URL e a credencial abaixo.</p><label>URL cloud<input readonly value="${esc(location.origin)}"></label><label>Credencial do dispositivo<textarea readonly rows="4">${esc(oneTimeCredential.token)}</textarea></label><p><small>Dispositivo: ${esc(oneTimeCredential.deviceId)} · expira em ${esc(when(oneTimeCredential.expiresAt))}</small></p></section>`;}

function render(state){
  root.innerHTML=`<div class="heading"><div><small>HARDENING E RECUPERAÇÃO</small><h1>Segurança</h1></div><a class="secondary" href="./">Voltar ao sistema</a></div><div class="split"><section class="panel"><h2>Dispositivos e sessões</h2><p>Revogar um aparelho invalida as sessões e credenciais persistentes ligadas a ele.</p><div class="stack"><button type="button" id="revoke-other-sessions">Encerrar outras sessões</button><button type="button" id="refresh-security">Atualizar</button></div><div class="table-wrap"><table><thead><tr><th>Dispositivo</th><th>Status</th><th>Último acesso</th><th>Sessões</th><th>Ação</th></tr></thead><tbody>${devicesHtml(state.devices)}</tbody></table></div></section><section class="panel"><h2>Preparar novo PC</h2><p>Gera uma credencial revogável para o agente de réplica. Nenhuma senha de usuário é gravada no computador.</p><form id="device-credential-form" class="form-grid"><label>ID do dispositivo<input name="deviceId" value="GEORGE-PC" required pattern="[A-Za-z0-9._:-]{1,160}"></label><label>Nome<input name="name" value="PC George" required></label><div class="full"><button class="primary">Gerar credencial do PC</button></div></form></section></div>${credentialHtml()}<section class="panel"><div class="heading"><div><h2>Backups cloud</h2><p>O backup só aparece como válido depois que os chunks e o manifesto com hashes foram concluídos.</p></div><button type="button" id="create-cloud-backup" class="primary">Criar backup cloud agora</button></div><div class="table-wrap"><table><thead><tr><th>ID</th><th>Status</th><th>Criado</th><th>Geração</th><th>Ação</th></tr></thead><tbody>${backupsHtml(state.backups)}</tbody></table></div></section><p id="security-message" class="hint"></p>`;
  bind();
}
function setMessage(text){const node=document.querySelector('#security-message');if(node)node.textContent=text;}

function bind(){
  document.querySelector('#refresh-security')?.addEventListener('click',()=>void refresh());
  document.querySelector('#revoke-other-sessions')?.addEventListener('click',async()=>{if(!confirm('Encerrar todas as outras sessões desta instalação?'))return;try{const result=await api.revokeOtherSessions();setMessage(`${Number(result?.revoked||0)} sessão(ões) encerrada(s).`);await refresh();}catch(error){setMessage(errorText(error));}});
  for(const button of document.querySelectorAll('[data-revoke-device]'))button.addEventListener('click',async()=>{const id=button.dataset.revokeDevice;if(!confirm(`Revogar o dispositivo ${id}? As sessões e credenciais dele serão invalidadas.`))return;try{await api.revokeDevice(id);setMessage(`Dispositivo ${id} revogado.`);await refresh();}catch(error){setMessage(errorText(error));}});
  document.querySelector('#device-credential-form')?.addEventListener('submit',async event=>{event.preventDefault();const fd=new FormData(event.currentTarget);try{const result=await api.request('/api/v1/devices/credentials',{method:'POST',body:{deviceId:String(fd.get('deviceId')||'').trim(),name:String(fd.get('name')||'').trim(),kind:'desktop'}});oneTimeCredential=result?.credential??null;await refresh({preserveCredential:true});}catch(error){setMessage(errorText(error));}});
  document.querySelector('#create-cloud-backup')?.addEventListener('click',async()=>{try{setMessage('Criando e verificando backup cloud…');await api.createCloudBackup();setMessage('Backup cloud concluído.');await refresh({preserveCredential:true});}catch(error){setMessage(errorText(error));}});
  for(const button of document.querySelectorAll('[data-restore-backup]'))button.addEventListener('click',async()=>{
    const id=button.dataset.restoreBackup;if(!confirm(`Restaurar o backup ${id}? Dispositivos e sessões atuais serão invalidados e os clientes antigos não poderão reenviar dados da geração anterior.`))return;
    const confirmation=prompt('Para confirmar, digite exatamente RESTAURAR.');if(confirmation!=='RESTAURAR'){setMessage('Restauração cancelada: confirmação inválida.');return;}
    const password=prompt('Digite novamente sua senha de administrador.');if(!password){setMessage('Restauração cancelada: senha obrigatória.');return;}
    try{const result=await api.restoreCloudBackup(id,{password,confirmation});alert(`Restore concluído. Nova geração: ${result.restoreGeneration}. Entre novamente e reprovisione o PC.`);location.href='./';}catch(error){setMessage(errorText(error));}
  });
}

async function refresh({preserveCredential=false}={}){if(!preserveCredential)oneTimeCredential=null;try{render(await loadState());}catch(error){root.innerHTML=`<section class="panel"><h1>Segurança indisponível</h1><p>${esc(errorText(error))}</p><a href="./">Voltar ao sistema</a></section>`;}}
void refresh();
