import { can } from '../../domain/auth.mjs';
import { DEFAULT_INSPECTION_ITEMS } from '../../domain/inspection.mjs';
import { emptyStateHtml,esc,pageControls,shortDate,statusLabel } from './common.mjs';

function eligibleRental(r,kind){
  if(kind==='pickup')return ['reserva','retirada'].includes(r.status);
  if(!['em_uso','devolucao'].includes(r.status))return false;
  return !(r.periodMode==='continuous'&&!r.continuousClosedAt&&r.status==='em_uso');
}
function optionRentals(snapshot,kind,selected=''){
  return snapshot.rentals.filter(r=>eligibleRental(r,kind)||String(r.id)===String(selected)).map(r=>{
    const v=snapshot.vehicles.find(x=>x.id===r.vehicleId),c=snapshot.customers.find(x=>x.id===r.customerId);
    return `<option value="${esc(r.id)}" ${String(r.id)===String(selected)?'selected':''}>${esc(v?.plate||r.vehicleId)} · ${esc(c?.name||r.customerId)}</option>`;
  }).join('');
}
export function inspectionsHtml(snapshot,user,{pagination={},inspectionPreset=null}={}){
  const writable=can(user,'inspection.write'),presetKind=inspectionPreset?.kind==='return'?'return':'pickup',presetRental=inspectionPreset?.rentalId??'',allowPendingContinuousClose=Boolean(inspectionPreset?.allowPendingContinuousClose);
  const cards=(snapshot.inspections??[]).map(i=>{const rental=snapshot.rentals.find(r=>r.id===i.rentalId),vehicle=snapshot.vehicles.find(v=>v.id===(i.vehicleId||rental?.vehicleId));const completed=(i.checklist??[]).filter(x=>x.done).length,total=(i.checklist??[]).length;const photos=(snapshot.attachments??[]).filter(a=>a.entityType==='inspection'&&a.entityId===i.id);return `<article class="card cloud-entity-card"><div><strong>${i.kind==='return'?'Devolução':'Retirada'} · ${esc(vehicle?.plate||i.vehicleId||'-')}</strong><small>${esc(statusLabel(i.status))} · ${completed}/${total||DEFAULT_INSPECTION_ITEMS.length} itens · ${photos.length} foto(s)</small><small>${Number(i.mileage||0).toLocaleString('pt-BR')} km · combustível ${esc(i.fuelLevel||'-')} · ${shortDate(i.completedAt)}</small><small>${esc((i.damages??[]).join(', ')||'Sem avarias registradas')}</small></div><div class="actions"><button data-inspection-pdf="${esc(i.id)}">PDF</button></div></article>`}).join('');
  return `<div class="heading"><div><small>ETAPA DA LOCAÇÃO</small><h1>${presetKind==='return'?'Registrar devolução':'Fazer retirada'}</h1></div></div><div class="cloud-grid">${writable?`<form id="cloud-inspection-form" class="panel cloud-form cloud-form-sections" data-test="inspection-form"><h2>${presetKind==='return'?'Vistoria de devolução':'Vistoria de retirada'}</h2><fieldset><legend>Locação</legend><label>Tipo<select name="kind"><option value="pickup" ${presetKind==='pickup'?'selected':''}>Retirada</option><option value="return" ${presetKind==='return'?'selected':''}>Devolução</option></select></label><label>Locação<select name="rentalId" required><option value="">Selecione</option>${optionRentals(snapshot,presetKind,presetRental,allowPendingContinuousClose)}</select></label></fieldset><fieldset><legend>Checklist</legend><div class="full checklist-grid" data-test="inspection-checklist">${DEFAULT_INSPECTION_ITEMS.map(([id,label])=>`<label class="checkline"><input type="checkbox" name="check-${esc(id)}" checked required> ${esc(label)}</label>`).join('')}</div></fieldset><fieldset><legend>Condição do veículo</legend><label>Quilometragem<input name="mileage" type="number" min="0" required></label><label>Combustível<select name="fuelLevel" required><option>Reserva</option><option>1/4</option><option>1/2</option><option selected>3/4</option><option>Cheio</option></select></label><label class="full cloud-photo-picker"><span>Fotos</span><span class="file-button">Selecionar fotos<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple required></span><small data-photo-selection aria-live="polite">Nenhuma foto selecionada</small></label></fieldset><fieldset><legend>Avarias e observações</legend><label class="full">Avarias (uma por linha)<textarea name="damages"></textarea></label><label class="full">Observações<textarea name="notes"></textarea></label></fieldset><button class="primary full">${presetKind==='return'?'Concluir devolução':'Concluir retirada'}</button></form>`:''}<section class="panel"><h2>Histórico de vistorias</h2>${pageControls('inspections',pagination.inspections??{},{search:true,placeholder:'ID, tipo, status ou observação'})}<div class="cloud-card-list">${cards||emptyStateHtml({title:String(pagination.inspections?.q||'').trim()?'Nenhuma vistoria encontrada':'Nenhuma vistoria concluída',description:snapshot.rentals.length?'Faça a primeira vistoria ou ajuste a busca.':'Crie uma locação antes de iniciar a primeira vistoria.',actionLabel:writable&&snapshot.rentals.length?'Iniciar vistoria':'',action:writable&&snapshot.rentals.length?'inspection-create':''})}</div></section></div>`;
}

export function bindInspections(root,{snapshot,user,actions,state}){
  const form=root.querySelector('#cloud-inspection-form');
  root.querySelector('[data-empty-action="inspection-create"]')?.addEventListener('click',()=>{form?.scrollIntoView({behavior:'smooth',block:'start'});form?.elements.rentalId?.focus();});
  if(form){
    const kind=form.elements.kind,rental=form.elements.rentalId,photo=form.elements.photo,photoSelection=form.querySelector('[data-photo-selection]');
    const updatePhotoSelection=()=>{const count=photo?.files?.length??0;if(photoSelection)photoSelection.textContent=count?count===1?'1 foto selecionada':`${count} fotos selecionadas`:'Nenhuma foto selecionada';};
    if(photo)photo.onchange=updatePhotoSelection;updatePhotoSelection();
    kind.onchange=()=>{rental.innerHTML=`<option value="">Selecione</option>${optionRentals(snapshot,kind.value)}`;};
    form.onsubmit=async event=>{
      event.preventDefault();
      const files=[...form.elements.photo.files];if(!files.length)throw new Error('Inclua pelo menos uma foto.');
      const fd=new FormData(form),inspectionId=`VIS-${crypto.randomUUID()}`,items=DEFAULT_INSPECTION_ITEMS.map(([key,label])=>({key,label,done:Boolean(form.elements[`check-${key}`].checked),evidence:key==='photos'?`${files.length} foto(s)`:null}));
      if(items.some(item=>!item.done))throw new Error('Conclua todos os itens do checklist.');
      const rentalId=String(fd.get('rentalId')),inspectionKind=String(fd.get('kind')),sourceRental=snapshot.rentals.find(item=>String(item.id)===rentalId);
      if(inspectionKind==='return'&&sourceRental?.periodMode==='continuous'&&!sourceRental.continuousClosedAt&&!state?.inspectionPreset?.allowPendingContinuousClose)throw new Error('Encerre a locação contínua antes de registrar a devolução.');
      const payload={id:inspectionId,rentalId,kind:inspectionKind,mileage:Number(fd.get('mileage')),fuelLevel:String(fd.get('fuelLevel')),notes:String(fd.get('notes')||''),damages:String(fd.get('damages')||'').split('\n').map(x=>x.trim()).filter(Boolean),items};
      await actions.queue('inspection.create',payload,'VIS');
      for(const file of files)await actions.uploadFile(file,'inspection',inspectionId);
      await actions.flush();
      if(inspectionKind==='pickup'&&sourceRental?.status==='reserva')await actions.queue('rental.advance',{rentalId,status:'retirada'},'ADV');
      if(inspectionKind==='pickup'&&['reserva','retirada'].includes(sourceRental?.status))await actions.queue('rental.advance',{rentalId,status:'em_uso'},'ADV');
      if(inspectionKind==='return'&&sourceRental?.status==='em_uso')await actions.queue('rental.advance',{rentalId,status:'devolucao'},'ADV');
      await actions.flush();
      if(state)state.inspectionPreset=null;
      const online=navigator.onLine!==false;
      if(inspectionKind==='pickup')await actions.notice(online?'Retirada concluída. Veículo em uso.':'Retirada salva neste aparelho. Será sincronizada quando houver conexão.');
      else await actions.notice(online?'Devolução concluída. Locação encerrada.':'Devolução salva neste aparelho. Será sincronizada quando houver conexão.');
      await actions.refresh('rentals');
    };
  }
  root.querySelectorAll('[data-inspection-pdf]').forEach(button=>button.onclick=()=>actions.downloadInspectionPdf(button.dataset.inspectionPdf,snapshot));
}
