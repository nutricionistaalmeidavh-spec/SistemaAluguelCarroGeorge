import { can } from '../domain/auth.mjs';
import { buildDashboard } from '../domain/reports.mjs';
import { moveRental } from '../domain/rental.mjs';
import { closeContinuousDailyRental } from '../domain/daily-billing.mjs';
import { buildOperationalAlerts, acknowledgeAlert, dismissAlert } from '../domain/alerts.mjs';
import { createInspection, setInspectionItem, addInspectionPhoto, completeInspection, inspectionProgress } from '../domain/inspection.mjs';
import { scheduleMaintenance, startMaintenance, completeMaintenance, maintenanceDue } from '../domain/maintenance.mjs';
import { rentalContractPdf, rentalReceiptPdf, inspectionPdf } from '../domain/documents.mjs';
import { brDateTimeToIso, brDateTimeValue, closeModal, date, esc, friendlyId, modal, money, rentalStatusLabel, toast } from './common.mjs';

function localDateTime(value=new Date()){const d=value instanceof Date?value:new Date(value);const local=new Date(d.getTime()-d.getTimezoneOffset()*60_000);return local.toISOString().slice(0,16);}
function pdf(name,bytes){const blob=new Blob([bytes],{type:'application/pdf'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}

const PHOTO_TYPES=new Set(['image/jpeg','image/png','image/webp']);
const PHOTO_MAX_BYTES=2_500_000;

function shaHex(buffer){return Array.from(new Uint8Array(buffer)).map(value=>value.toString(16).padStart(2,'0')).join('');}
function jpegName(name='foto.jpg'){const clean=String(name||'foto').replace(/\.[^.]+$/,'').trim()||'foto';return `${clean}.jpg`;}
async function canvasBlob(canvas,type='image/jpeg',quality=.72){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Não foi possível processar a foto.')),type,quality));}

async function preparePhotoAttachment(file){
  if(!(file instanceof Blob))throw new Error('Foto inválida.');
  let blob=file,name=file.name||'foto.jpg';
  try{
    const bitmap=await createImageBitmap(file);const max=1280,scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();blob=await canvasBlob(canvas);name=jpegName(name);
  }catch{
    if(!PHOTO_TYPES.has(String(file.type||'').toLowerCase()))throw new Error('Formato de foto não suportado. Use JPEG, PNG ou WebP.');
  }
  const mimeType=String(blob.type||file.type||'').toLowerCase();
  if(!PHOTO_TYPES.has(mimeType))throw new Error('Formato de foto não suportado. Use JPEG, PNG ou WebP.');
  const bytes=new Uint8Array(await blob.arrayBuffer());
  if(!bytes.byteLength)throw new Error('Foto vazia.');
  if(bytes.byteLength>PHOTO_MAX_BYTES)throw new Error('Foto excede o limite de 2,5 MB.');
  const sha256=shaHex(await crypto.subtle.digest('SHA-256',bytes));
  return{name,mimeType,bytes,sha256};
}

function attachmentId(){
  if(globalThis.crypto?.randomUUID)return `ATT-${crypto.randomUUID()}`;
  const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);return `ATT-${Array.from(bytes).map(v=>v.toString(16).padStart(2,'0')).join('')}`;
}

export function renderDashboard(view,{snapshot}){
  const d=buildDashboard(snapshot),open=(snapshot.rentals??[]).filter(item=>item.status!=='devolucao'),pickups=open.filter(item=>['reserva','retirada'].includes(item.status)),returns=open.filter(item=>item.status==='em_uso');
  const tasks=open.slice().sort((a,b)=>String(a.pickupAt||'').localeCompare(String(b.pickupAt||''))).slice(0,6).map(item=>{const customer=snapshot.customers.find(row=>row.id===item.customerId),vehicle=snapshot.vehicles.find(row=>row.id===item.vehicleId),returning=item.status==='em_uso';return `<article class="card"><div><small>${returning?'DEVOLUÇÃO':'RETIRADA'}</small><strong>${esc(vehicle?.model||item.vehicleId)} · ${esc(customer?.name||item.customerId)}</strong><small>${date(returning?item.returnAt:item.pickupAt)}</small></div><button class="primary" data-dashboard-nav="reservas">${returning?'Registrar devolução':'Fazer retirada'}</button></article>`;}).join('');
  view.innerHTML=`<div class="heading"><div><small>O QUE PRECISA DE ATENÇÃO</small><h1>Hoje</h1></div></div>
  <section class="panel"><div class="panel-title"><div><h2>Próximas ações</h2><span>Comece pelo trabalho que precisa ser feito.</span></div></div><div class="cards"><article><small>Retiradas</small><strong>${pickups.length}</strong><button class="secondary" data-dashboard-nav="reservas">Ver locações</button></article><article><small>Devoluções</small><strong>${returns.length}</strong><button class="secondary" data-dashboard-nav="reservas">Ver locações</button></article><article><small>Receber</small><strong>${money(d.openAmount)}</strong><button class="secondary" data-dashboard-nav="financeiro">Abrir financeiro</button></article></div><div class="cloud-card-list">${tasks||'<p class="empty">Nenhuma retirada ou devolução pendente.</p>'}</div></section>
  <details class="panel"><summary>Indicadores</summary><div class="cards six"><article><small>Ocupação</small><strong>${d.occupancyRate}%</strong></article><article><small>Locações abertas</small><strong>${d.openRentals}</strong></article><article><small>Em atraso</small><strong>${d.overdueRentals}</strong></article><article><small>Recebido</small><strong>${money(d.received)}</strong></article><article><small>Em aberto</small><strong>${money(d.openAmount)}</strong></article><article><small>Caixa líquido</small><strong>${money(d.netCash)}</strong></article></div>
  <div class="split"><section><h2>Frota</h2><div class="kpi-lines"><p><span>Total</span><b>${d.fleetTotal}</b></p><p><span>Disponíveis</span><b>${d.availableVehicles}</b></p><p><span>Em manutenção</span><b>${d.maintenanceVehicles}</b></p><p><span>Ticket médio</span><b>${money(d.averageTicket)}</b></p></div></section><section><h2>Rentabilidade por veículo</h2><div class="table-wrap"><table><thead><tr><th>Veículo</th><th>Locações</th><th>Receita</th><th>Custos</th><th>Margem</th></tr></thead><tbody>${d.vehiclePerformance.map(v=>`<tr><td>${esc(v.model)}<small>${esc(v.plate)}</small></td><td>${v.rentalCount}</td><td>${money(v.revenue)}</td><td>${money(v.expenses)}</td><td><b>${money(v.margin)}</b></td></tr>`).join('')||'<tr><td colspan="5" class="empty">Sem dados.</td></tr>'}</tbody></table></div></section></div></details>`;
  view.querySelectorAll('[data-dashboard-nav]').forEach(button=>button.onclick=()=>document.querySelector(`[data-nav="${button.dataset.dashboardNav}"]`)?.click());
}

export function openInspectionEditor(ctx,inspectionId){
  const {snapshot,sessionUser,save,repository,navigate}=ctx,current=snapshot.inspections.find(i=>i.id===inspectionId);if(!current)return;
  const rental=snapshot.rentals.find(item=>item.id===current.rentalId),continuousReturn=current.kind==='return'&&rental?.periodMode==='continuous'&&!rental?.continuousClosedAt;
  modal(current.kind==='return'?'Vistoria de devolução':'Vistoria de retirada',`<form id="inspection-form" class="form-grid"><div class="full checklist-grid">${current.checklist.map(item=>`<label class="checkline"><input type="checkbox" name="item-${esc(item.id)}" ${item.done?'checked':''}> ${esc(item.label)}</label>`).join('')}</div><label>Quilometragem<input name="mileage" type="number" min="0" value="${current.mileage??''}" required></label><label>Combustível<select name="fuelLevel" required><option value="">Selecione</option>${['Reserva','1/4','1/2','3/4','Cheio'].map(x=>`<option ${current.fuelLevel===x?'selected':''}>${x}</option>`).join('')}</select></label>${continuousReturn?`<label>Devolução real<input name="returnAt" inputmode="numeric" placeholder="dd/mm/aaaa hh:mm" value="${brDateTimeValue(new Date())}" required></label>`:''}<label class="full">Fotos<input name="photos" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple></label><label class="full">Avarias (uma por linha)<textarea name="damages">${esc((current.damages??[]).join('\n'))}</textarea></label><label class="full">Observações<textarea name="notes">${esc(current.notes||'')}</textarea></label><div class="full modal-actions"><button type="button" data-close>Cancelar</button><button class="primary">Concluir ${current.kind==='return'?'devolução':'retirada'}</button></div></form>`,()=>{const form=document.querySelector('#inspection-form');form.onsubmit=async e=>{e.preventDefault();const createdAttachments=[];try{
    let working=structuredClone(snapshot);
    for(const item of current.checklist)working=setInspectionItem(working,current.id,item.id,{done:form.elements[`item-${item.id}`].checked},sessionUser.id);
    for(const file of [...form.elements.photos.files]){
      if(!repository?.attachments)throw new Error('Armazenamento de fotos indisponível.');
      const prepared=await preparePhotoAttachment(file),id=attachmentId();
      await repository.attachments.put({id,entityType:'inspection',entityId:current.id,mimeType:prepared.mimeType,bytes:prepared.bytes,createdBy:sessionUser.id,name:prepared.name,sha256:prepared.sha256});
      createdAttachments.push(id);
      working=addInspectionPhoto(working,current.id,{attachmentId:id,name:prepared.name,mimeType:prepared.mimeType,sizeBytes:prepared.bytes.byteLength,sha256:prepared.sha256},sessionUser.id);
    }
    working=completeInspection(working,current.id,{mileage:form.elements.mileage.value,fuelLevel:form.elements.fuelLevel.value,notes:form.elements.notes.value,damages:form.elements.damages.value.split('\n').map(x=>x.trim()).filter(Boolean)},sessionUser.id);
    let rentalAfter=working.rentals.find(item=>item.id===current.rentalId);
    if(current.kind==='checkout'){
      if(rentalAfter?.status==='reserva')working=moveRental(working,current.rentalId,'retirada',sessionUser.id);
      rentalAfter=working.rentals.find(item=>item.id===current.rentalId);
      if(rentalAfter?.status==='retirada')working=moveRental(working,current.rentalId,'em_uso',sessionUser.id);
    }else if(current.kind==='return'){
      if(rentalAfter?.periodMode==='continuous'&&!rentalAfter?.continuousClosedAt)working=closeContinuousDailyRental(working,current.rentalId,{returnAt:brDateTimeToIso(form.elements.returnAt?.value,{required:true})},sessionUser.id);
      else if(rentalAfter?.status==='em_uso')working=moveRental(working,current.rentalId,'devolucao',sessionUser.id);
    }
    save(working);closeModal();toast(current.kind==='return'?'Devolução concluída. Locação finalizada.':'Retirada concluída. Veículo em uso.');navigate?.('reservas');
  }catch(err){for(const id of createdAttachments.reverse()){try{await repository?.attachments?.remove(id);}catch{}}toast(err.message)}};});
}

export function renderVistorias(view,ctx){
  const {snapshot}=ctx;
  view.innerHTML=`<div class="heading"><div><small>ARQUIVO</small><h1>Histórico de vistorias</h1></div><button type="button" data-back-rentals>Voltar para Locações</button></div><section class="panel"><p class="hint">Retiradas e devoluções são iniciadas exclusivamente na locação. Aqui ficam apenas os registros concluídos e seus PDFs.</p><div class="table-wrap"><table><thead><tr><th>Vistoria</th><th>Locação</th><th>Tipo</th><th>Status da locação</th><th>KM</th><th>Fotos</th><th></th></tr></thead><tbody>${snapshot.inspections.map(i=>{const rental=snapshot.rentals.find(r=>r.id===i.rentalId);return`<tr><td>${friendlyId(i.id,'Vistoria')}</td><td>${friendlyId(i.rentalId,'Locação')}</td><td>${i.kind==='return'?'Devolução':'Retirada'}</td><td>${esc(rentalStatusLabel(rental?.status))}</td><td>${i.mileage??'-'}</td><td>${i.photos?.length??0}</td><td><button data-pdf-inspection="${esc(i.id)}">PDF</button></td></tr>`}).join('')||'<tr><td colspan="7" class="empty">Nenhuma vistoria registrada.</td></tr>'}</tbody></table></div></section>`;
  view.querySelector('[data-back-rentals]')?.addEventListener('click',()=>ctx.navigate?.('reservas'));
  view.querySelectorAll('[data-pdf-inspection]').forEach(b=>b.onclick=()=>pdf(`vistoria-${b.dataset.pdfInspection}.pdf`,inspectionPdf(snapshot,b.dataset.pdfInspection)));
}

export function renderManutencao(view,ctx){
  const {snapshot,sessionUser,save}=ctx;const writable=can(sessionUser,'maintenance.write');
  view.innerHTML=`<div class="heading"><div><small>FROTA PREVENTIVA</small><h1>Manutenção</h1></div>${writable?'<button id="new-maintenance" class="primary">Agendar manutenção</button>':''}</div><section class="panel"><div class="table-wrap"><table><thead><tr><th>Veículo</th><th>Serviço</th><th>Limite</th><th>Status</th><th>Custo</th><th>Ações</th></tr></thead><tbody>${snapshot.maintenance.map(m=>{const v=snapshot.vehicles.find(x=>x.id===m.vehicleId),due=maintenanceDue(m,v);return`<tr><td>${esc(v?.model||m.vehicleId)}<small>${esc(v?.plate||'')}</small></td><td>${esc(m.type)}</td><td>${m.dueAt?date(m.dueAt):''}${m.dueMileage?`<small>${Number(m.dueMileage).toLocaleString('pt-BR')} km</small>`:''}</td><td><span class="badge ${due?'badge-warn':''}">${esc(m.status)}${due&&m.status!=='completed'?' · vencida':''}</span></td><td>${m.status==='completed'?money(m.cost):money(m.costEstimate)}</td><td>${writable&&m.status==='scheduled'?`<button data-start="${m.id}">Iniciar</button>`:''}${writable&&m.status==='in_progress'?`<button data-complete="${m.id}">Concluir</button>`:''}</td></tr>`}).join('')||'<tr><td colspan="6" class="empty">Nenhuma manutenção agendada.</td></tr>'}</tbody></table></div></section>`;
  view.querySelector('#new-maintenance')?.addEventListener('click',()=>modal('Agendar manutenção',`<form id="maintenance-form" class="form-grid"><label>Veículo<select name="vehicleId" required>${snapshot.vehicles.map(v=>`<option value="${esc(v.id)}">${esc(v.model)} · ${esc(v.plate)}</option>`).join('')}</select></label><label>Serviço<input name="type" required placeholder="Ex.: troca de óleo"></label><label>Data limite<input name="dueAt" type="date"></label><label>KM limite<input name="dueMileage" type="number" min="0"></label><label>Custo estimado<input name="costEstimate" type="number" min="0" step="0.01"></label><label class="full">Observações<textarea name="notes"></textarea></label><div class="full modal-actions"><button type="button" data-close>Cancelar</button><button class="primary">Agendar</button></div></form>`,()=>{const f=document.querySelector('#maintenance-form');f.onsubmit=e=>{e.preventDefault();try{save(scheduleMaintenance(snapshot,Object.fromEntries(new FormData(f)),sessionUser.id));closeModal();toast('Manutenção agendada.');}catch(err){toast(err.message)}};}));
  view.querySelectorAll('[data-start]').forEach(b=>b.onclick=()=>{try{save(startMaintenance(snapshot,b.dataset.start,sessionUser.id));toast('Veículo bloqueado para manutenção.');}catch(err){toast(err.message)}});
  view.querySelectorAll('[data-complete]').forEach(b=>b.onclick=()=>modal('Concluir manutenção',`<form id="complete-maintenance" class="form-grid"><label>Custo real<input name="cost" type="number" min="0" step="0.01"></label><label>KM atual<input name="mileage" type="number" min="0"></label><label class="full">Observações<textarea name="notes"></textarea></label><div class="full modal-actions"><button type="button" data-close>Cancelar</button><button class="primary">Concluir</button></div></form>`,()=>{const f=document.querySelector('#complete-maintenance');f.onsubmit=e=>{e.preventDefault();save(completeMaintenance(snapshot,b.dataset.complete,Object.fromEntries(new FormData(f)),sessionUser.id));closeModal();toast('Manutenção concluída.');};}));
}

export function renderAlertas(view,ctx){
  const {snapshot,sessionUser,save}=ctx;const alerts=buildOperationalAlerts(snapshot);const writable=can(sessionUser,'alerts.write');
  view.innerHTML=`<div class="heading"><div><small>PRAZOS E RISCOS</small><h1>Alertas</h1></div><span class="badge">${alerts.length} ativos</span></div><div class="alert-list">${alerts.map(a=>`<article class="alert-card ${a.severity}"><div><b>${esc(a.title)}</b><small>${a.dueAt?date(a.dueAt):''} · ${esc(a.status)}</small></div>${writable?`<div class="actions">${a.status!=='acknowledged'?`<button data-ack="${esc(a.id)}">Reconhecer</button>`:''}<button data-dismiss="${esc(a.id)}">Resolver</button></div>`:''}</article>`).join('')||'<div class="panel empty">Nenhum alerta operacional.</div>'}</div>`;
  view.querySelectorAll('[data-ack]').forEach(b=>b.onclick=()=>{save(acknowledgeAlert(snapshot,b.dataset.ack,sessionUser.id));toast('Alerta reconhecido.');});
  view.querySelectorAll('[data-dismiss]').forEach(b=>b.onclick=()=>{save(dismissAlert(snapshot,b.dataset.dismiss,sessionUser.id));toast('Alerta resolvido.');});
}

export function renderDocumentos(view,{snapshot}){
  view.innerHTML=`<div class="heading"><div><small>DOCUMENTOS</small><h1>Contratos, recibos e vistorias</h1></div></div><section class="panel"><h2>Locações</h2><div class="table-wrap"><table><thead><tr><th>Locação</th><th>Cliente</th><th>Veículo</th><th>Documentos</th></tr></thead><tbody>${snapshot.rentals.map(r=>{const c=snapshot.customers.find(x=>x.id===r.customerId),v=snapshot.vehicles.find(x=>x.id===r.vehicleId);return`<tr><td>${esc(r.id)}</td><td>${esc(c?.name||'-')}</td><td>${esc(v?.model||'-')}</td><td><button data-contract="${esc(r.id)}">Contrato PDF</button> <button data-receipt="${esc(r.id)}">Recibo PDF</button></td></tr>`}).join('')||'<tr><td colspan="4" class="empty">Nenhuma locação.</td></tr>'}</tbody></table></div></section><section class="panel"><h2>Vistorias</h2><div class="table-wrap"><table><thead><tr><th>ID</th><th>Locação</th><th>Tipo</th><th>Documento</th></tr></thead><tbody>${snapshot.inspections.map(i=>`<tr><td>${esc(i.id)}</td><td>${esc(i.rentalId)}</td><td>${i.kind==='return'?'Devolução':'Retirada'}</td><td><button data-inspection-doc="${esc(i.id)}">Vistoria PDF</button></td></tr>`).join('')||'<tr><td colspan="4" class="empty">Nenhuma vistoria.</td></tr>'}</tbody></table></div></section>`;
  view.querySelectorAll('[data-contract]').forEach(b=>b.onclick=()=>pdf(`contrato-${b.dataset.contract}.pdf`,rentalContractPdf(snapshot,b.dataset.contract)));
  view.querySelectorAll('[data-receipt]').forEach(b=>b.onclick=()=>pdf(`recibo-${b.dataset.receipt}.pdf`,rentalReceiptPdf(snapshot,b.dataset.receipt)));
  view.querySelectorAll('[data-inspection-doc]').forEach(b=>b.onclick=()=>pdf(`vistoria-${b.dataset.inspectionDoc}.pdf`,inspectionPdf(snapshot,b.dataset.inspectionDoc)));
}
