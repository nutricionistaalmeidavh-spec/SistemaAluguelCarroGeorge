import { can } from '../../domain/auth.mjs';
import { brDateTimeToIso,brDateTimeValue,emptyStateHtml,esc,money,pageControls,shortDate,statusLabel } from './common.mjs';
import { collectRentalPayment } from './payment-flow.mjs';
import { rentalStatusLabel } from '../../ui/semantics.mjs';

function options(items,label){return (items??[]).map(item=>`<option value="${esc(item.id)}">${esc(label(item))}</option>`).join('');}
function inspectionFor(snapshot,rentalId,kind){return (snapshot.inspections??[]).find(item=>String(item.rentalId)===String(rentalId)&&item.kind===kind);}
function openContinuousCloseDialog(defaultValue=brDateTimeValue(new Date().toISOString())){
  return new Promise(resolve=>{
    const host=document.createElement('div');
    const returnFocus=document.activeElement;host.innerHTML=`<div class="modal-overlay" data-close-rental-overlay><form class="modal" role="dialog" aria-modal="true" aria-label="Informar devolução" data-close-rental-form><div class="modal-head"><div><small>ENCERRAR LOCAÇÃO CONTÍNUA</small><h2>Informar devolução</h2></div><button type="button" aria-label="Fechar" data-cancel>×</button></div><label>Data e hora de devolução<input name="returnAt" inputmode="numeric" value="${esc(defaultValue)}" placeholder="dd/mm/aaaa hh:mm" required></label><div class="modal-actions"><button type="button" data-cancel>Cancelar</button><button class="primary">Continuar</button></div></form></div>`;
    const overlay=host.firstElementChild,form=overlay.querySelector('[data-close-rental-form]');document.body.append(overlay);
    const close=value=>{overlay.remove();returnFocus?.focus?.();resolve(value);};
    overlay.querySelectorAll('[data-cancel]').forEach(button=>button.onclick=()=>close(null));
    overlay.onclick=event=>{if(event.target===overlay)close(null);};overlay.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();close(null);}};
    form.onsubmit=event=>{event.preventDefault();try{close(brDateTimeToIso(form.elements.returnAt.value,{required:true}));}catch(error){form.elements.returnAt.setCustomValidity(error.message);form.elements.returnAt.reportValidity();form.elements.returnAt.setCustomValidity('');}};
    form.elements.returnAt.focus();
  });
}

export function rentalsHtml(snapshot,user,{pagination={}}={}){
  const writable=can(user,'rental.write'),finance=can(user,'finance.write');
  const rows=(snapshot.rentals??[]).map(r=>{
    const customer=snapshot.customers.find(x=>x.id===r.customerId),vehicle=snapshot.vehicles.find(x=>x.id===r.vehicleId),pickup=inspectionFor(snapshot,r.id,'pickup'),returned=inspectionFor(snapshot,r.id,'return'),canPay=finance&&Number(r.total||0)>0&&String(r.paymentStatus||'aberto')!=='pago';
    let operation='';
    if(writable&&['reserva','retirada'].includes(r.status)&&!pickup)operation=`<button class="primary" data-rental-inspection="${esc(r.id)}" data-kind="pickup">Fazer retirada</button>`;
    else if(writable&&r.status==='em_uso'&&r.periodMode==='continuous'&&!r.continuousClosedAt)operation=`<button data-rental-close="${esc(r.id)}">Encerrar locação contínua</button>`;
    else if(writable&&r.status==='em_uso'&&!returned)operation=`<button class="primary" data-rental-inspection="${esc(r.id)}" data-kind="return">Registrar devolução</button>`;
    return `<article class="card cloud-entity-card"><div><strong>${esc(vehicle?.model||r.vehicleId)} · ${esc(customer?.name||r.customerId)}</strong><small>${esc(rentalStatusLabel(r.status))} · ${r.periodMode==='continuous'?'contínua':`${shortDate(r.pickupAt)} → ${shortDate(r.returnAt)}`}</small><small>${money(r.total)} · ${esc(r.billingMode==='daily'?'por diária':'total')} · ${esc(statusLabel(r.paymentStatus||'aberto'))}</small><small>${esc(r.priority||'Média')} · ${esc(r.notes||'Sem observações')}</small></div><div class="actions">${operation}${canPay?`<button data-payment-rental="${esc(r.id)}">Receber pagamento</button>`:''}<button data-rental-documents="${esc(r.id)}">Documentos</button></div></article>`;
  }).join('');
  return `<div class="heading"><div><small>CICLO COMPLETO</small><h1>Locações</h1></div></div><div class="cloud-grid">${writable?`<form id="cloud-rental-form" class="panel cloud-form cloud-form-sections" data-test="rental-form"><h2>Nova locação</h2><fieldset><legend>Cliente e veículo</legend><label>Cliente<select name="customerId" required><option value="">Selecione</option>${options(snapshot.customers,x=>x.name)}</select></label><label>Veículo<select name="vehicleId" required><option value="">Selecione</option>${options(snapshot.vehicles.filter(v=>v.availability!=='manutencao'),x=>`${x.model} · ${x.plate}`)}</select></label></fieldset><fieldset><legend>Período</legend><label>Retirada<input name="pickupAt" inputmode="numeric" placeholder="dd/mm/aaaa hh:mm" required></label><label>Período<select name="periodMode"><option value="fixed">Com devolução prevista</option><option value="continuous">Sem prazo / contínua</option></select></label><label data-return-field>Devolução<input name="returnAt" inputmode="numeric" placeholder="dd/mm/aaaa hh:mm"></label></fieldset><fieldset><legend>Cobrança</legend><label>Diária<input name="dailyRate" type="number" min="0.01" step="0.01" required></label><label>Cobrança<select name="billingMode"><option value="daily">Por diária</option><option value="total">Total</option></select></label><label>Prioridade<select name="priority"><option>Baixa</option><option selected>Média</option><option>Alta</option></select></label></fieldset><details class="form-advanced full"><summary>+ Observações</summary><label class="full">Observações<textarea name="notes"></textarea></label></details><button class="primary full">Criar locação</button></form>`:''}<section class="panel"><h2>Locações</h2>${pageControls('rentals',pagination.rentals??{},{search:true,placeholder:'ID, status, prioridade ou observação'})}<div class="cloud-card-list">${rows||emptyStateHtml({title:String(pagination.rentals?.q||'').trim()?'Nenhuma locação encontrada':'Nenhuma locação cadastrada',description:String(pagination.rentals?.q||'').trim()?'Ajuste a busca para encontrar outra locação.':snapshot.customers.length&&snapshot.vehicles.length?'Crie a primeira locação para iniciar o controle de retirada, cobrança e devolução.':'Cadastre pelo menos um cliente e um veículo antes de criar a primeira locação.',actionLabel:writable&&snapshot.customers.length&&snapshot.vehicles.length?'Criar primeira locação':'',action:writable&&snapshot.customers.length&&snapshot.vehicles.length?'rental-create':''})}</div></section></div>`;
}

export function bindRentals(root,{snapshot,user,actions}){
  const form=root.querySelector('#cloud-rental-form');
  root.querySelector('[data-empty-action="rental-create"]')?.addEventListener('click',()=>{form?.scrollIntoView({behavior:'smooth',block:'start'});form?.elements.customerId?.focus();});
  if(form){
    const period=form.elements.periodMode,returnField=form.querySelector('[data-return-field]'),billing=form.elements.billingMode;
    const toggle=()=>{const continuous=period.value==='continuous';returnField.hidden=continuous;form.elements.returnAt.required=!continuous;if(continuous)billing.value='daily';billing.querySelector('option[value="total"]').disabled=continuous;};
    period.onchange=toggle;toggle();
    form.onsubmit=async event=>{event.preventDefault();const fd=new FormData(form),continuous=fd.get('periodMode')==='continuous',payload={customerId:String(fd.get('customerId')),vehicleId:String(fd.get('vehicleId')),pickupAt:brDateTimeToIso(fd.get('pickupAt'),{required:true}),returnAt:continuous?null:brDateTimeToIso(fd.get('returnAt'),{required:true}),periodMode:continuous?'continuous':'fixed',dailyRate:Number(fd.get('dailyRate')),billingMode:continuous?'daily':String(fd.get('billingMode')),priority:String(fd.get('priority')||'Média'),notes:String(fd.get('notes')||'')};await actions.queue('rental.create',payload,'LOC');await actions.refresh('rentals');};
  }
  root.querySelectorAll('[data-rental-inspection]').forEach(button=>button.onclick=()=>actions.openInspection(button.dataset.rentalInspection,button.dataset.kind));
  root.querySelectorAll('[data-rental-documents]').forEach(button=>button.onclick=()=>actions.openRentalDocuments(button.dataset.rentalDocuments));
  root.querySelectorAll('[data-rental-close]').forEach(button=>button.onclick=async()=>{const returnAt=await openContinuousCloseDialog();if(!returnAt)return;await actions.queue('rental.closeContinuous',{rentalId:button.dataset.rentalClose,returnAt},'CLOSE');await actions.openInspection(button.dataset.rentalClose,'return',{allowPendingContinuousClose:true});});
  root.querySelectorAll('[data-payment-rental]').forEach(button=>button.onclick=async()=>{const fresh=actions.paymentContext?await actions.paymentContext(button.dataset.paymentRental):snapshot;return collectRentalPayment(fresh,button.dataset.paymentRental,actions,{refresh:'rentals'});});
}
