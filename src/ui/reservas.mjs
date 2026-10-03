import { getFinancialSummary, moveRental } from '../domain/rental.mjs';
import { createInspection } from '../domain/inspection.mjs';
import { closeContinuousDailyRental, createRentalWithBilling } from '../domain/daily-billing.mjs';
import { can } from '../domain/auth.mjs';
import { closeModal, date, esc, modal, money, toast } from './common.mjs';
import { openRentalPayment } from './payments.mjs';

function localInput(value=new Date()){const d=value instanceof Date?value:new Date(value);const local=new Date(d.getTime()-d.getTimezoneOffset()*60_000);return local.toISOString().slice(0,16);}
function rentalStatusLabel(status){return({reserva:'Locação',retirada:'Retirada',em_uso:'Em uso',devolucao:'Devolvida'}[status]||String(status||'').replaceAll('_',' '));}

export function renderReservas(view, ctx) {
  const { snapshot, sessionUser, save } = ctx;
  const rows=[...snapshot.rentals].sort((a,b)=>new Date(a.pickupAt)-new Date(b.pickupAt));
  const summary=getFinancialSummary(snapshot);
  view.innerHTML=`<div class="heading"><div><small>OPERAÇÃO</small><h1>Locações</h1></div>${can(sessionUser,'rental.write')?'<button id="new-rental" class="primary">Nova locação</button>':''}</div>
  <div class="cards"><article><small>Receita prevista</small><strong>${money(summary.grossRevenue)}</strong></article><article><small>Recebido</small><strong>${money(summary.paidAmount)}</strong></article><article><small>Em aberto</small><strong>${money(summary.openAmount)}</strong></article><article><small>Locações</small><strong>${rows.length}</strong></article></div>
  <section class="panel"><div class="panel-title"><h2>Agenda</h2><span>Disponibilidade calculada por período, não por status global.</span></div><div class="agenda">${renderAgenda(rows,snapshot)}</div></section>
  <section class="panel"><div class="panel-title"><h2>Locações</h2></div><div class="table-wrap"><table><thead><tr><th>Locação</th><th>Cliente</th><th>Veículo</th><th>Retirada</th><th>Devolução</th><th>Status</th><th>Total</th><th>Ações</th></tr></thead><tbody>${rows.map(r=>rentalRow(r,snapshot,sessionUser)).join('')||'<tr><td colspan="8" class="empty">Nenhuma locação cadastrada.</td></tr>'}</tbody></table></div></section>`;
  view.querySelector('#new-rental')?.addEventListener('click',()=>showRentalForm(ctx));
  view.querySelectorAll('[data-rental-inspection]').forEach(b=>b.onclick=()=>openRentalInspection(ctx,b.dataset.rentalInspection,b.dataset.kind));
  view.querySelectorAll('[data-rental-finish]').forEach(b=>b.onclick=()=>finishRentalTask(ctx,b.dataset.rentalFinish,b.dataset.target));
  view.querySelectorAll('[data-close-continuous]').forEach(b=>b.onclick=()=>showContinuousClose(ctx,b.dataset.closeContinuous));
  view.querySelectorAll('[data-contract]').forEach(b=>b.onclick=()=>printContract(b.dataset.contract,snapshot));
  view.querySelectorAll('[data-rental-payment]').forEach(b=>b.onclick=()=>openRentalPayment(ctx,b.dataset.rentalPayment));
}

function renderAgenda(rows,snapshot) {
  if(!rows.length) return '<div class="empty">A agenda ficará aqui assim que a primeira locação for criada.</div>';
  return rows.map(r=>{const v=snapshot.vehicles.find(x=>x.id===r.vehicleId);const c=snapshot.customers.find(x=>x.id===r.customerId);const end=r.returnAt?date(r.returnAt):'Contínua';return `<div class="agenda-item"><span class="dot status-${r.status}"></span><div><strong>${esc(v?.model||r.vehicleId)} · ${esc(c?.name||r.customerId)}</strong><small>${date(r.pickupAt)} → ${esc(end)}</small></div><b>${esc(rentalStatusLabel(r.status))}</b></div>`}).join('');
}

function rentalRow(r,snapshot,sessionUser) {
  const v=snapshot.vehicles.find(x=>x.id===r.vehicleId),c=snapshot.customers.find(x=>x.id===r.customerId),writable=can(sessionUser,'rental.write');
  const checkout=snapshot.inspections.find(item=>item.rentalId===r.id&&item.kind==='checkout'),returned=snapshot.inspections.find(item=>item.rentalId===r.id&&item.kind==='return');
  const continuousOpen=r.periodMode==='continuous'&&!r.continuousClosedAt;
  let operation='';
  if(writable&&['reserva','retirada'].includes(r.status)){
    if(!checkout||checkout.status==='draft')operation=`<button class="primary" data-rental-inspection="${esc(r.id)}" data-kind="checkout">${checkout?'Continuar retirada':'Fazer retirada'}</button>`;
    else operation=`<button class="primary" data-rental-finish="${esc(r.id)}" data-target="em_uso">Concluir retirada</button>`;
  }else if(writable&&r.status==='em_uso'){
    if(!returned||returned.status==='draft')operation=`<button class="primary" data-rental-inspection="${esc(r.id)}" data-kind="return">${returned?'Continuar devolução':'Registrar devolução'}</button>`;
    else if(continuousOpen)operation=`<button class="primary" data-close-continuous="${esc(r.id)}">Concluir devolução</button>`;
    else operation=`<button class="primary" data-rental-finish="${esc(r.id)}" data-target="devolucao">Concluir devolução</button>`;
  }
  const canReceive=r.billingMode==='daily'?can(sessionUser,'billing.write'):can(sessionUser,'finance.write'),payment=canReceive&&r.paymentStatus!=='pago'?`<button data-rental-payment="${esc(r.id)}">Receber pagamento</button>`:'';
  return `<tr><td>${esc(r.id)}</td><td>${esc(c?.name||'-')}</td><td>${esc(v?.model||'-')}<small>${esc(v?.plate||'')}</small></td><td>${date(r.pickupAt)}</td><td>${r.returnAt?date(r.returnAt):'<span class="badge">Contínua</span>'}</td><td><span class="badge">${esc(rentalStatusLabel(r.status))}</span></td><td>${money(r.total)}</td><td class="actions">${operation}${payment}<button data-contract="${r.id}">Documentos</button></td></tr>`;
}

function openRentalInspection(ctx,rentalId,kind){
  const {snapshot,sessionUser,save}=ctx;
  try{
    const existing=snapshot.inspections.find(item=>item.rentalId===rentalId&&item.kind===kind);
    const next=existing?snapshot:createInspection(snapshot,{rentalId,kind},sessionUser.id);
    if(!existing)save(next);
    const id=(existing??next.inspections.find(item=>item.rentalId===rentalId&&item.kind===kind))?.id;
    setTimeout(()=>{document.querySelector('[data-nav="vistorias"]')?.click();setTimeout(()=>document.querySelector(`[data-edit-inspection="${id}"]`)?.click(),0);},0);
  }catch(error){toast(error.message);}
}

function finishRentalTask(ctx,rentalId,target){
  const {snapshot,sessionUser,save}=ctx;
  try{
    let working=structuredClone(snapshot),rental=working.rentals.find(item=>item.id===rentalId);
    if(!rental)throw new Error('Locação não encontrada.');
    if(target==='em_uso'&&rental.status==='reserva')working=moveRental(working,rentalId,'retirada',sessionUser.id);
    rental=working.rentals.find(item=>item.id===rentalId);
    if(target==='em_uso'&&rental.status==='retirada')working=moveRental(working,rentalId,'em_uso',sessionUser.id);
    else if(target==='devolucao'&&rental.status==='em_uso')working=moveRental(working,rentalId,'devolucao',sessionUser.id);
    save(working);toast(target==='devolucao'?'Devolução concluída.':'Retirada concluída.');
  }catch(error){toast(error.message);}
}

function showContinuousClose(ctx,rentalId){
  const {snapshot,sessionUser,save}=ctx;
  modal('Encerrar locação contínua',`<form id="continuous-close-form" class="form-grid"><label class="full">Devolução real<input name="returnAt" type="datetime-local" value="${localInput()}" required></label><p class="full hint">O sistema calcula a última diária pelo tempo real da locação. A devolução exige a vistoria de retorno concluída; eventual saldo financeiro permanece em aberto.</p><div class="full modal-actions"><button type="button" data-close>Cancelar</button><button class="primary">Encerrar locação</button></div></form>`,()=>{const form=document.querySelector('#continuous-close-form');form.onsubmit=e=>{e.preventDefault();const fd=Object.fromEntries(new FormData(form));try{save(closeContinuousDailyRental(snapshot,rentalId,{returnAt:fd.returnAt},sessionUser.id));closeModal();toast('Locação contínua encerrada.');}catch(err){toast(err.message)}};});
}

function showRentalForm(ctx){
  const {snapshot,sessionUser,save}=ctx;
  if(!snapshot.customers.length||!snapshot.vehicles.length){toast('Cadastre ao menos um cliente e um veículo.');return;}
  modal('Nova locação',`<form id="rental-form" class="form-grid"><label>Cliente<select name="customerId">${snapshot.customers.filter(c=>c.active).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label><label>Veículo<select name="vehicleId">${snapshot.vehicles.filter(v=>v.availability!=='manutencao').map(v=>`<option value="${v.id}">${esc(v.model)} · ${esc(v.plate)}</option>`).join('')}</select></label><label>Retirada<input type="datetime-local" name="pickupAt" required></label><label>Período<select name="periodMode"><option value="fixed">Com devolução prevista</option><option value="continuous">Diária contínua / sem prazo</option></select></label><label id="return-at-label">Devolução<input type="datetime-local" name="returnAt" required></label><label>Diária<input type="number" name="dailyRate" min="0.01" step="0.01" required></label><label>Recebimento<select name="billingMode"><option value="total">Receber valor total</option><option value="daily">Receber por diária</option></select></label><label>Prioridade<select name="priority"><option>Media</option><option>Alta</option><option>Baixa</option></select></label><label class="full">Observações<textarea name="notes"></textarea></label><div class="full modal-actions"><button type="button" data-close>Cancelar</button><button class="primary">Salvar locação</button></div></form>`);
  const form=document.querySelector('#rental-form'),vehicleSelect=form.elements.vehicleId,period=form.elements.periodMode,billing=form.elements.billingMode,returnAt=form.elements.returnAt,returnLabel=document.querySelector('#return-at-label');
  const updateRate=()=>{const v=snapshot.vehicles.find(x=>x.id===vehicleSelect.value);form.elements.dailyRate.value=v?.dailyRate||''};
  const updatePeriod=()=>{const continuous=period.value==='continuous';returnAt.disabled=continuous;returnAt.required=!continuous;if(continuous){returnAt.value='';billing.value='daily';billing.disabled=true;returnLabel.querySelector('input').placeholder='Sem prazo';}else{billing.disabled=false;}};
  vehicleSelect.onchange=updateRate;period.onchange=updatePeriod;updateRate();updatePeriod();
  form.onsubmit=e=>{e.preventDefault();const fd=Object.fromEntries(new FormData(form));fd.periodMode=period.value;fd.billingMode=billing.value;if(fd.periodMode==='continuous')fd.returnAt=null;try{save(createRentalWithBilling(snapshot,{...fd,attendantId:sessionUser.id,dailyRate:Number(fd.dailyRate)},sessionUser.id));closeModal();toast(fd.periodMode==='continuous'?'Locação contínua e primeira diária criadas.':fd.billingMode==='daily'?'Locação e diárias criadas.':'Locação criada.');}catch(err){toast(err.message)}};
}

function printContract(id,snapshot){
  const r=snapshot.rentals.find(x=>x.id===id),c=snapshot.customers.find(x=>x.id===r.customerId),v=snapshot.vehicles.find(x=>x.id===r.vehicleId),w=window.open('','contrato','width=800,height=900');
  if(!w)return;
  const text=`${snapshot.settings.companyName}\n${snapshot.settings.document}\n${snapshot.settings.phone}\n${snapshot.settings.address}\n\nCONTRATO DE LOCAÇÃO ${r.id}\nCliente: ${c?.name} - ${c?.document}\nVeículo: ${v?.model} - ${v?.plate}\nRetirada: ${date(r.pickupAt)}\nDevolução: ${r.returnAt?date(r.returnAt):'Locação contínua'}\nValor acumulado: ${money(r.total)}\nStatus: ${rentalStatusLabel(r.status)}\n\nObservações: ${r.notes||'-'}`;
  w.document.write(`<pre style="font:14px/1.6 Arial;padding:32px;white-space:pre-wrap">${esc(text)}</pre>`);w.document.close();w.print();
}
