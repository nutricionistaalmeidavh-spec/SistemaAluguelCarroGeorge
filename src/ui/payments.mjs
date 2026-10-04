import { can } from '../domain/auth.mjs';
import { registerPayment } from '../domain/rental.mjs';
import { dailyBillingSummary,recordDailyPaymentAmount } from '../domain/daily-billing.mjs';
import { dailyPaymentReceiptPdf } from '../domain/documents.mjs';
import { closeModal,date,esc,friendlyId,modal,money,toast } from './common.mjs';

function pdf(name,bytes){const blob=new Blob([bytes],{type:'application/pdf'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}

export function openRentalPayment(ctx,rentalId){
  const rental=ctx?.snapshot?.rentals?.find(item=>item.id===rentalId);
  if(!rental){toast('Locação não encontrada.');return;}
  return rental.billingMode==='daily'?showDailyPayment(ctx,rentalId):showTotalPayment(ctx,rentalId);
}

function showTotalPayment(ctx,rentalId){
  const {snapshot,sessionUser,save}=ctx;
  if(!can(sessionUser,'finance.write')){toast('Sem permissão para registrar recebimentos.');return;}
  const rental=snapshot.rentals.find(r=>r.id===rentalId),received=(rental?.payments??[]).reduce((sum,item)=>sum+Number(item.amount||0),0),balance=Math.max(0,Number(rental?.total||0)-received);
  if(!rental||balance<=0){toast('Esta locação não possui saldo em aberto.');return;}
  modal('Receber pagamento',`<form id="rental-payment-form" class="form-grid"><p class="full hint">${friendlyId(rental.id,'Locação')}</p><label>Saldo<input value="${balance.toFixed(2)}" disabled></label><label>Valor recebido<input name="amount" type="number" min="0.01" max="${balance}" step="0.01" value="${balance.toFixed(2)}" required></label><label>Forma<select name="method"><option>PIX</option><option>Dinheiro</option><option>Crédito</option><option>Débito</option><option>Boleto</option></select></label><div class="full modal-actions"><button type="button" data-close>Cancelar</button><button class="primary">Confirmar recebimento</button></div></form>`,()=>{
    const form=document.querySelector('#rental-payment-form');
    form.onsubmit=event=>{event.preventDefault();const fd=Object.fromEntries(new FormData(form));try{save(registerPayment(snapshot,rentalId,Number(fd.amount),fd.method,sessionUser.id));closeModal();toast('Recebimento registrado.');}catch(error){toast(error.message)}};
  });
}

function showDailyPayment(ctx,rentalId){
  const {snapshot,sessionUser,save}=ctx;
  if(!can(sessionUser,'billing.read')){toast('Sem permissão para visualizar cobranças.');return;}
  const rental=snapshot.rentals.find(r=>r.id===rentalId),summary=dailyBillingSummary(snapshot,rentalId,new Date().toISOString()),writable=can(sessionUser,'billing.write');
  if(!rental||summary.openAmount<=0){toast('Esta locação não possui saldo em aberto.');return;}
  const customer=snapshot.customers.find(c=>c.id===rental.customerId),vehicle=snapshot.vehicles.find(v=>v.id===rental.vehicleId),dailyRate=Number(rental.dailyRate||0),defaultAmount=Math.min(summary.openAmount,dailyRate||summary.openAmount);
  const quick=[1,2,3].filter(count=>dailyRate>0&&dailyRate*count<=summary.openAmount+.001).map(count=>`<button type="button" data-payment-quick="${Math.min(summary.openAmount,dailyRate*count).toFixed(2)}">${count} ${count===1?'diária':'diárias'}</button>`).join('');
  const rows=summary.rows.map(row=>{const receipts=(row.payments??[]).map((payment,index)=>`<button type="button" data-daily-receipt-installment="${esc(row.installmentId)}" data-daily-receipt-payment="${esc(payment.id)}">Recibo ${index+1}</button>`).join(' '),status=({paid:'Pago',partial:'Parcial',overdue:'Atrasado',pending:'Pendente'})[row.status]||row.status;return`<tr><td>${row.sequence}</td><td>${date(row.dueAt)}</td><td>${money(row.amount)}</td><td>${money(row.paidAmount)}</td><td>${money(row.openAmount)}</td><td>${esc(status)}</td><td>${receipts||'-'}</td></tr>`;}).join('');
  modal('Receber pagamento',`<form id="daily-payment-form" class="form-grid"><div class="full payment-context"><strong>${esc(customer?.name||'-')} · ${esc(vehicle?.model||'-')} ${esc(vehicle?.plate||'')}</strong><small>${friendlyId(rental.id,'Locação')}</small></div><div class="full cards"><article><small>Saldo</small><strong>${money(summary.openAmount)}</strong></article><article><small>Diária</small><strong>${money(dailyRate)}</strong></article><article><small>Já recebido</small><strong>${money(summary.received)}</strong></article></div>${writable?`<div class="full payment-quick">${quick}<button type="button" data-payment-quick="${summary.openAmount.toFixed(2)}">Quitar saldo</button></div><label>Valor recebido<input name="amount" type="number" min="0.01" max="${summary.openAmount}" step="0.01" value="${defaultAmount.toFixed(2)}" required></label><label>Forma<select name="method"><option>PIX</option><option>Dinheiro</option><option>Crédito</option><option>Débito</option><option>Boleto</option></select></label>`:''}<details class="full payment-history"><summary>Ver detalhes das diárias</summary><div class="table-wrap"><table><thead><tr><th>Diária</th><th>Vencimento</th><th>Valor</th><th>Pago</th><th>Saldo</th><th>Situação</th><th>Recibos</th></tr></thead><tbody>${rows}</tbody></table></div></details><div class="full modal-actions"><button type="button" data-close>${writable?'Cancelar':'Fechar'}</button>${writable?'<button class="primary">Confirmar recebimento</button>':''}</div></form>`,()=>{
    const form=document.querySelector('#daily-payment-form'),amount=form.elements.amount;
    form.querySelectorAll('[data-payment-quick]').forEach(button=>button.onclick=()=>{amount.value=button.dataset.paymentQuick;amount.focus();});
    form.querySelectorAll('[data-daily-receipt-payment]').forEach(button=>button.onclick=()=>{try{pdf(`recibo-diaria-${button.dataset.dailyReceiptPayment}.pdf`,dailyPaymentReceiptPdf(snapshot,button.dataset.dailyReceiptInstallment,button.dataset.dailyReceiptPayment));}catch(error){toast(error.message)}});
    if(writable)form.onsubmit=event=>{event.preventDefault();const fd=Object.fromEntries(new FormData(form));try{save(recordDailyPaymentAmount(snapshot,rentalId,{amount:Number(fd.amount),method:fd.method},sessionUser.id));closeModal();toast('Recebimento registrado.');}catch(error){toast(error.message)}};
  });
}
