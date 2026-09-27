import { can } from '../domain/auth.mjs';
import { buildDashboard } from '../domain/reports.mjs';
import { buildOperationalAlerts, acknowledgeAlert, dismissAlert } from '../domain/alerts.mjs';
import { createInspection, setInspectionItem, addInspectionPhoto, completeInspection, inspectionProgress } from '../domain/inspection.mjs';
import { scheduleMaintenance, startMaintenance, completeMaintenance, maintenanceDue } from '../domain/maintenance.mjs';
import { rentalContractPdf, rentalReceiptPdf, inspectionPdf } from '../domain/documents.mjs';
import { closeModal, date, esc, modal, money, toast } from './common.mjs';

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
  const d=buildDashboard(snapshot);
  view.innerHTML=`<div class="heading"><div><small>VISÃO GERAL</small><h1>Dashboard</h1></div></div>
  <div class="cards six"><article><small>Ocupação</small><strong>${d.occupancyRate}%</strong></article><article><small>Locações abertas</small><strong>${d.openRentals}</strong></article><article><small>Em atraso</small><strong>${d.overdueRentals}</strong></article><article><small>Recebido</small><strong>${money(d.received)}</strong></article><article><small>Em aberto</small><strong>${money(d.openAmount)}</strong></article><article><small>Caixa líquido</small><strong>${money(d.netCash)}</strong></article></div>
  <div class="split"><section class="panel"><h2>Frota</h2><div class="kpi-lines"><p><span>Total</span><b>${d.fleetTotal}</b></p><p><span>Disponíveis</span><b>${d.availableVehicles}</b></p><p><span>Em manutenção</span><b>${d.maintenanceVehicles}</b></p><p><span>Ticket médio</span><b>${money(d.averageTicket)}</b></p></div></section><section class="panel"><h2>Rentabilidade por veículo</h2><div class="table-wrap"><table><thead><tr><th>Veículo</th><th>Locações</th><th>Receita</th><th>Custos</th><th>Margem</th></tr></thead><tbody>${d.vehiclePerformance.map(v=>`<tr><td>${esc(v.model)}<small>${esc(v.plate)}</small></td><td>${v.rentalCount}</td><td>${money(v.revenue)}</td><td>${money(v.expenses)}</td><td><b>${money(v.margin)}</b></td></tr>`).join('')||'<tr><td colspan="5" class="empty">Sem dados.</td></tr>'}</tbody></table></div></section></div>`;
}

export function renderVistorias(view,ctx){
  const {snapshot,sessionUser,save,repository}=ctx;const writable=can(sessionUser,'inspection.write');
  view.innerHTML=`<div class="heading"><div><small>CHECKLIST E EVIDÊNCIAS</small><h1>Vistorias</h1></div></div>
  <section class="panel"><h2>Locações</h2><div class="table-wrap"><table><thead><tr><th>Locação</th><th>Cliente</th><th>Veículo</th><th>Status</th><th>Ação</th></tr></thead><tbody>${snapshot.rentals.map(r=>{const c=snapshot.customers.find(x=>x.id===r.customerId),v=snapshot.vehicles.find(x=>x.id===r.vehicleId);return`<tr><td>${esc(r.id)}</td><td>${esc(c?.name||'-')}</td><td>${esc(v?.model||'-')}<small>${esc(v?.plate||'')}</small></td><td>${esc(r.status)}</td><td>${writable?`<button data-new-inspection="${esc(r.id)}" data-kind="checkout">Retirada</button> <button data-new-inspection="${esc(r.id)}" data-kind="return">Devolução</button>`:'-'}</td></tr>`}).join('')||'<tr><td colspan="5" class="empty">Nenhuma locação.</td></tr>'}</tbody></table></div></section>
  <section class="panel"><h2>Histórico de vistorias</h2><div class="table-wrap"><table><thead><tr><th>ID</th><th>Locação</th><th>Tipo</th><th>Progresso</th><th>KM</th><th>Fotos</th><th>Ações</th></tr></thead><tbody>${snapshot.inspections.map(i=>{const p=inspectionProgress(i);return`<tr><td>${esc(i.id)}</td><td>${esc(i.rentalId)}</td><td>${i.kind==='return'?'Devolução':'Retirada'}</td><td>${p.percent}%</td><td>${i.mileage??'-'}</td><td>${i.photos?.length??0}</td><td>${i.status==='draft'&&writable?`<button data-edit-inspection="${esc(i.id)}">Continuar</button>`:''}<button data-pdf-inspection="${esc(i.id)}">PDF</button></td></tr>`}).join('')||'<tr><td colspan="7" class="empty">Nenhuma vistoria.</td></tr>'}</tbody></table></div></section>`;

  const open=(inspectionId)=>{const current=snapshot.inspections.find(i=>i.id===inspectionId);if(!current)return;modal(`Vistoria ${current.id}`,`<form id="inspection-form" class="form-grid"><div class="full checklist-grid">${current.checklist.map(item=>`<label class="checkline"><input type="checkbox" name="item-${esc(item.id)}" ${item.done?'checked':''}> ${esc(item.label)}</label>`).join('')}</div><label>Quilometragem<input name="mileage" type="number" min="0" value="${current.mileage??''}" required></label><label>Combustível<select name="fuelLevel" required><option value="">Selecione</option>${['Reserva','1/4','1/2','3/4','Cheio'].map(x=>`<option ${current.fuelLevel===x?'selected':''}>${x}</option>`).join('')}</select></label><label class="full">Fotos<input name="photos" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple></label><label class="full">Avarias (uma por linha)<textarea name="damages">${esc((current.damages??[]).join('\n'))}</textarea></label><label class="full">Observações<textarea name="notes">${esc(current.notes||'')}</textarea></label><div class="full modal-actions"><button type="button" data-close>Cancelar</button><button class="primary">Concluir vistoria</button></div></form>`,()=>{const form=document.querySelector('#inspection-form');form.onsubmit=async e=>{e.preventDefault();const createdAttachments=[];try{
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
    save(working);closeModal();toast('Vistoria concluída.');
  }catch(err){for(const id of createdAttachments.reverse()){try{await repository?.attachments?.remove(id);}catch{}}toast(err.message)}};});};
  view.querySelectorAll('[data-new-inspection]').forEach(b=>b.onclick=()=>{try{const next=createInspection(snapshot,{rentalId:b.dataset.newInspection,kind:b.dataset.kind},sessionUser.id);save(next);setTimeout(()=>{const latest=next.inspections[0];document.querySelector('[data-nav="vistorias"]')?.click();setTimeout(()=>document.querySelector(`[data-edit-inspection="${latest.id}"]`)?.click(),0);},0);}catch(err){toast(err.message)}});
  view.querySelectorAll('[data-edit-inspection]').forEach(b=>b.onclick=()=>open(b.dataset.editInspection));
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
