import { getFinancialSummary } from '../domain/rental.mjs';
import { createInspection } from '../domain/inspection.mjs';
import { createRentalWithBilling } from '../domain/daily-billing.mjs';
import { can } from '../domain/auth.mjs';
import { brDateTimeToIso, closeModal, date, esc, friendlyId, modal, money, rentalStatusLabel, toast } from './common.mjs';
import { openRentalPayment } from './payments.mjs';
import { openInspectionEditor } from './p1.mjs';

export function renderReservas(view,ctx){
  const {snapshot,sessionUser,navigate}=ctx,rows=[...snapshot.rentals].sort((a,b)=>new Date(a.pickupAt)-new Date(b.pickupAt)),summary=getFinancialSummary(snapshot);
  const contextual=[
    can(sessionUser,'inspection.read')?['vistorias','Histórico de vistorias']:null,
    can(sessionUser,'contracts.read')?['contratos','Contratos']:null,
    can(sessionUser,'documents.read')?['documentos','Arquivo de documentos']:null
  ].filter(Boolean);
  view.innerHTML=`<div class="heading"><div><small>OPERAÇÃO</small><h1>Locações</h1></div>${can(sessionUser,'rental.write')?'<button id="new-rental" class="primary">Nova locação</button>':''}</div>
  ${contextual.length?`<div class="context-links">${contextual.map(([id,label])=>`<button type="button" data-rental-context="${id}">${label}</button>`).join('')}</div>`:''}
  <div class="cards"><article><small>Receita prevista</small><strong>${money(summary.grossRevenue)}</strong></article><article><small>Recebido</small><strong>${money(summary.paidAmount)}</strong></article><article><small>Em aberto</small><strong>${money(summary.openAmount)}</strong></article><article><small>Locações</small><strong>${rows.length}</strong></article></div>
  <section class="panel"><div class="panel-title"><h2>Agenda</h2><span>Retiradas e devoluções em ordem de atendimento.</span></div><div class="agenda">${renderAgenda(rows,snapshot)}</div></section>
  <section class="panel"><div class="panel-title"><h2>Locações</h2></div><div class="table-wrap"><table><thead><tr><th>Referência</th><th>Cliente</th><th>Veículo</th><th>Retirada</th><th>Devolução</th><th>Status</th><th>Total</th><th>Ações</th></tr></thead><tbody>${rows.map(r=>rentalRow(r,snapshot,sessionUser)).join('')||'<tr><td colspan="8" class="empty">Nenhuma locação cadastrada.</td></tr>'}</tbody></table></div></section>`;
  view.querySelector('#new-rental')?.addEventListener('click',()=>showRentalForm(ctx));
  view.querySelectorAll('[data-rental-context]').forEach(button=>button.onclick=()=>navigate?.(button.dataset.rentalContext));
  view.querySelectorAll('[data-rental-inspection]').forEach(button=>button.onclick=()=>openRentalInspection(ctx,button.dataset.rentalInspection,button.dataset.kind));
  view.querySelectorAll('[data-contract]').forEach(button=>button.onclick=()=>printContract(button.dataset.contract,snapshot));
  view.querySelectorAll('[data-rental-payment]').forEach(button=>button.onclick=()=>openRentalPayment(ctx,button.dataset.rentalPayment));
}

function renderAgenda(rows,snapshot){
  if(!rows.length)return'<div class="empty">A agenda ficará aqui assim que a primeira locação for criada.</div>';
  return rows.map(r=>{const vehicle=snapshot.vehicles.find(x=>x.id===r.vehicleId),customer=snapshot.customers.find(x=>x.id===r.customerId),end=r.returnAt?date(r.returnAt):'Contínua';return`<div class="agenda-item"><span class="dot status-${r.status}"></span><div><strong>${esc(vehicle?.model||r.vehicleId)} · ${esc(customer?.name||r.customerId)}</strong><small>${date(r.pickupAt)} → ${esc(end)}</small></div><b>${esc(rentalStatusLabel(r.status))}</b></div>`;}).join('');
}

function rentalRow(r,snapshot,sessionUser){
  const vehicle=snapshot.vehicles.find(x=>x.id===r.vehicleId),customer=snapshot.customers.find(x=>x.id===r.customerId),writable=can(sessionUser,'rental.write'),checkout=snapshot.inspections.find(item=>item.rentalId===r.id&&item.kind==='checkout'),returned=snapshot.inspections.find(item=>item.rentalId===r.id&&item.kind==='return');
  let operation='';
  if(writable&&['reserva','retirada'].includes(r.status))operation=`<button class="primary" data-rental-inspection="${esc(r.id)}" data-kind="checkout">${checkout?'Continuar retirada':'Fazer retirada'}</button>`;
  else if(writable&&r.status==='em_uso')operation=`<button class="primary" data-rental-inspection="${esc(r.id)}" data-kind="return">${returned?'Continuar devolução':'Registrar devolução'}</button>`;
  const canReceive=r.billingMode==='daily'?can(sessionUser,'billing.write'):can(sessionUser,'finance.write'),payment=canReceive&&r.paymentStatus!=='pago'?`<button data-rental-payment="${esc(r.id)}">Receber pagamento</button>`:'';
  return `<tr><td><strong>${friendlyId(r.id)}</strong></td><td>${esc(customer?.name||'-')}</td><td>${esc(vehicle?.model||'-')}<small>${esc(vehicle?.plate||'')}</small></td><td>${date(r.pickupAt)}</td><td>${r.returnAt?date(r.returnAt):'<span class="badge">Contínua</span>'}</td><td><span class="badge">${esc(rentalStatusLabel(r.status))}</span></td><td>${money(r.total)}</td><td class="actions">${operation}${payment}<button data-contract="${esc(r.id)}">Documentos</button></td></tr>`;
}

function openRentalInspection(ctx,rentalId,kind){
  const {snapshot,sessionUser,save}=ctx;
  try{
    const existing=snapshot.inspections.find(item=>item.rentalId===rentalId&&item.kind===kind),next=existing?snapshot:createInspection(snapshot,{rentalId,kind},sessionUser.id);
    if(!existing)save(next);
    const current=existing??next.inspections.find(item=>item.rentalId===rentalId&&item.kind===kind);
    queueMicrotask(()=>openInspectionEditor({...ctx,snapshot:next},current.id));
  }catch(error){toast(error.message);}
}

function showRentalForm(ctx){
  const {snapshot,sessionUser,save}=ctx;
  if(!snapshot.customers.length||!snapshot.vehicles.length){toast('Cadastre ao menos um cliente e um veículo.');return;}
  modal('Nova locação',`<form id="rental-form" class="form-grid"><label>Cliente<select name="customerId">${snapshot.customers.filter(c=>c.active).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label><label>Veículo<select name="vehicleId">${snapshot.vehicles.filter(v=>v.availability!=='manutencao').map(v=>`<option value="${v.id}">${esc(v.model)} · ${esc(v.plate)}</option>`).join('')}</select></label><label>Retirada<input name="pickupAt" inputmode="numeric" placeholder="dd/mm/aaaa hh:mm" required></label><label>Período<select name="periodMode"><option value="fixed">Com devolução prevista</option><option value="continuous">Sem prazo definido</option></select></label><label id="return-at-label">Devolução prevista<input name="returnAt" inputmode="numeric" placeholder="dd/mm/aaaa hh:mm" required></label><label>Valor da diária<input type="number" name="dailyRate" min="0.01" step="0.01" required></label><details class="form-advanced full rental-advanced"><summary>Opções de cobrança e observações</summary><div class="form-grid"><label>Forma de cobrança<select name="billingMode"><option value="total">Valor total</option><option value="daily">Por diária</option></select></label><label class="full">Observações<textarea name="notes"></textarea></label></div></details><input type="hidden" name="priority" value="Media"><div class="full modal-actions"><button type="button" data-close>Cancelar</button><button class="primary">Salvar locação</button></div></form>`);
  const form=document.querySelector('#rental-form'),vehicleSelect=form.elements.vehicleId,period=form.elements.periodMode,billing=form.elements.billingMode,returnAt=form.elements.returnAt,returnLabel=document.querySelector('#return-at-label');
  const updateRate=()=>{const vehicle=snapshot.vehicles.find(x=>x.id===vehicleSelect.value);form.elements.dailyRate.value=vehicle?.dailyRate||'';};
  const updatePeriod=()=>{const continuous=period.value==='continuous';returnAt.disabled=continuous;returnAt.required=!continuous;if(continuous){returnAt.value='';billing.value='daily';billing.disabled=true;returnLabel.hidden=true;}else{billing.disabled=false;returnLabel.hidden=false;}};
  vehicleSelect.onchange=updateRate;period.onchange=updatePeriod;updateRate();updatePeriod();
  form.onsubmit=e=>{e.preventDefault();try{const fd=Object.fromEntries(new FormData(form)),periodMode=period.value,billingMode=billing.value,payload={...fd,pickupAt:brDateTimeToIso(fd.pickupAt,{required:true}),returnAt:periodMode==='continuous'?null:brDateTimeToIso(fd.returnAt,{required:true}),periodMode,billingMode,attendantId:sessionUser.id,dailyRate:Number(fd.dailyRate)};save(createRentalWithBilling(snapshot,payload,sessionUser.id));closeModal();toast(periodMode==='continuous'?'Locação contínua criada.':billingMode==='daily'?'Locação e diárias criadas.':'Locação criada.');}catch(err){toast(err.message);}};
}

function printContract(id,snapshot){
  const rental=snapshot.rentals.find(x=>x.id===id),customer=snapshot.customers.find(x=>x.id===rental.customerId),vehicle=snapshot.vehicles.find(x=>x.id===rental.vehicleId),win=window.open('','contrato','width=800,height=900');
  if(!win)return;
  const text=`${snapshot.settings.companyName}\n${snapshot.settings.document}\n${snapshot.settings.phone}\n${snapshot.settings.address}\n\nCONTRATO ${friendlyId(rental.id,'LOCAÇÃO')}\nCliente: ${customer?.name} - ${customer?.document}\nVeículo: ${vehicle?.model} - ${vehicle?.plate}\nRetirada: ${date(rental.pickupAt)}\nDevolução: ${rental.returnAt?date(rental.returnAt):'Locação contínua'}\nValor acumulado: ${money(rental.total)}\nStatus: ${rentalStatusLabel(rental.status)}\n\nObservações: ${rental.notes||'-'}`;
  win.document.write(`<pre style="font:14px/1.6 Arial;padding:32px;white-space:pre-wrap">${esc(text)}</pre>`);win.document.close();win.print();
}
