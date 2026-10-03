import { can } from '../domain/auth.mjs';
import { registerPayment } from '../domain/rental.mjs';
import { dailyBillingSummary,nextDailyInstallment,recordDailyPaymentAmount,recordNextDailyPayment } from '../domain/daily-billing.mjs';
import { dailyPaymentReceiptPdf } from '../domain/documents.mjs';
import { closeModal,date,esc,modal,money,toast } from './common.mjs';

function pdf(name,bytes){const blob=new Blob([bytes],{type:'application/pdf'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}

export function openRentalPayment(ctx,rentalId){
  const rental=ctx?.snapshot?.rentals?.find(item=>item.id===rentalId);
  if(!rental){toast('Locação não encontrada.');return;}
  if(rental.billingMode==='daily')return showDailyPaymentControl(ctx,rentalId);
  return showTotalPayment(ctx,rentalId);
}

function showTotalPayment(ctx,rentalId){
  const {snapshot,sessionUser,save}=ctx;
  if(!can(sessionUser,'finance.write')){toast('Sem permissão para registrar recebimentos.');return;}
  const rental=snapshot.rentals.find(r=>r.id===rentalId),received=(rental?.payments??[]).reduce((sum,item)=>sum+Number(item.amount||0),0),balance=Math.max(0,Number(rental?.total||0)-received);
  if(!rental||balance<=0){toast('Esta locação não possui saldo em aberto.');return;}
  modal('Receber pagamento',`<form id="rental-payment-form" class="form-grid"><label>Saldo<input value="${balance.toFixed(2)}" disabled></label><label>Valor recebido<input name="amount" type="number" min="0.01" max="${balance}" step="0.01" value="${balance.toFixed(2)}" required></label><label>Forma<select name="method"><option>PIX</option><option>Dinheiro</option><option>Crédito</option><option>Débito</option><option>Boleto</option></select></label><div class="full modal-actions"><button type="button" data-close>Cancelar</button><button class="primary">Confirmar recebimento</button></div></form>`,()=>{
    const form=document.querySelector('#rental-payment-form');
    form.onsubmit=event=>{event.preventDefault();const fd=Object.fromEntries(new FormData(form));try{save(registerPayment(snapshot,rentalId,Number(fd.amount),fd.method,sessionUser.id));closeModal();toast('Recebimento registrado.');}catch(error){toast(error.message)}};
  });
}

function showDailyPaymentControl(ctx,rentalId){
  const {snapshot,sessionUser}=ctx;
  if(!can(sessionUser,'billing.read')){toast('Sem permissão para visualizar cobranças.');return;}
  const rental=snapshot.rentals.find(r=>r.id===rentalId),summary=dailyBillingSummary(snapshot,rentalId,new Date().toISOString()),next=nextDailyInstallment(snapshot,rentalId),writable=can(sessionUser,'billing.write'),statusLabel={paid:'Pago',partial:'Parcial',overdue:'Atrasado',pending:'Pendente'},nextBalance=next?Math.max(0,Number(next.amount||0)-Number(next.paidAmount||0)):0;
  const actions=writable&&next?`<div class="actions"><button id="receive-next-daily" class="primary">Receber próxima diária</button><button id="receive-multiple-daily">Receber outro valor</button></div>`:'';
  const conflict=summary.conflictCount?`<p class="error"><b>Atenção:</b> ${summary.conflictCount} recebimento(s) concorrente(s) foram bloqueados para evitar duplicidade. Confira o histórico antes de qualquer ajuste manual.</p>`:'';
  modal('Receber pagamento',`<div class="cards"><article><small>Diárias</small><strong>${summary.totalCount}</strong></article><article><small>Pagas</small><strong>${summary.paidCount}</strong></article><article><small>Recebido</small><strong>${money(summary.received)}</strong></article><article><small>A receber</small><strong>${money(summary.openAmount)}</strong></article></div>${conflict}${next?`<section class="panel"><div class="panel-title"><div><small>PRÓXIMA DIÁRIA</small><h2>Diária ${next.sequence} · ${date(next.dueAt)}</h2></div><strong>${money(nextBalance)}</strong></div>${actions}</section>`:'<section class="panel"><div class="empty">Todas as diárias estão quitadas.</div></section>'}<section class="panel"><div class="panel-title"><h2>${esc(rental?.id||rentalId)}</h2><span>${summary.pendingCount} pendente(s)</span></div><div class="table-wrap"><table><thead><tr><th>Diária</th><th>Vencimento</th><th>Valor</th><th>Pago</th><th>Saldo</th><th>Situação</th><th>Recibos</th></tr></thead><tbody>${summary.rows.map(row=>{const receipts=(row.payments??[]).map((payment,index)=>`<button data-daily-receipt-installment="${esc(row.installmentId)}" data-daily-receipt-payment="${esc(payment.id)}">Recibo ${index+1}</button>`).join(' ');const status=row.paymentConflicts?.length?`${statusLabel[row.status]||esc(row.status)} · conflito sync`:statusLabel[row.status]||esc(row.status);return`<tr><td>${row.sequence}</td><td>${date(row.dueAt)}</td><td>${money(row.amount)}</td><td>${money(row.paidAmount)}</td><td>${money(row.openAmount)}</td><td><span class="badge">${status}</span></td><td>${receipts||'-'}</td></tr>`}).join('')||'<tr><td colspan="7" class="empty">Nenhuma diária gerada.</td></tr>'}</tbody></table></div></section><div class="modal-actions"><button type="button" data-close>Fechar</button></div>`,()=>{
    document.querySelector('#receive-next-daily')?.addEventListener('click',()=>{closeModal();showNextDailyPayment(ctx,rentalId);});
    document.querySelector('#receive-multiple-daily')?.addEventListener('click',()=>{closeModal();showDailyAmountPayment(ctx,rentalId);});
    document.querySelectorAll('[data-daily-receipt-payment]').forEach(button=>button.addEventListener('click',()=>{try{pdf(`recibo-diaria-${button.dataset.dailyReceiptPayment}.pdf`,dailyPaymentReceiptPdf(snapshot,button.dataset.dailyReceiptInstallment,button.dataset.dailyReceiptPayment));}catch(error){toast(error.message)}}));
  });
}

function showNextDailyPayment(ctx,rentalId){
  const {snapshot,sessionUser,save}=ctx;
  if(!can(sessionUser,'billing.write')){toast('Sem permissão para registrar recebimentos.');return;}
  const item=nextDailyInstallment(snapshot,rentalId);
  if(!item){toast('Todas as diárias estão quitadas.');return;}
  const balance=Math.max(0,Number(item.amount||0)-Number(item.paidAmount||0));
  modal('Receber pagamento',`<form id="daily-payment-form" class="form-grid"><label>Diária<input value="${item.sequence} · ${esc(date(item.dueAt))}" disabled></label><label>Saldo<input value="${balance.toFixed(2)}" disabled></label><label>Valor recebido<input name="amount" type="number" min="0.01" max="${balance}" step="0.01" value="${balance.toFixed(2)}" required></label><label>Forma<select name="method"><option>PIX</option><option>Dinheiro</option><option>Crédito</option><option>Débito</option><option>Boleto</option></select></label><div class="full modal-actions"><button type="button" data-close>Cancelar</button><button class="primary">Confirmar recebimento</button></div></form>`,()=>{
    const form=document.querySelector('#daily-payment-form');
    form.onsubmit=event=>{event.preventDefault();const fd=Object.fromEntries(new FormData(form));try{save(recordNextDailyPayment(snapshot,rentalId,{amount:Number(fd.amount),method:fd.method},sessionUser.id));closeModal();toast('Recebimento registrado.');}catch(error){toast(error.message)}};
  });
}

function showDailyAmountPayment(ctx,rentalId){
  const {snapshot,sessionUser,save}=ctx;
  if(!can(sessionUser,'billing.write')){toast('Sem permissão para registrar recebimentos.');return;}
  const summary=dailyBillingSummary(snapshot,rentalId,new Date().toISOString());
  if(summary.openAmount<=0){toast('Todas as diárias estão quitadas.');return;}
  modal('Receber pagamento',`<form id="daily-bulk-payment-form" class="form-grid"><label>Saldo total<input value="${summary.openAmount.toFixed(2)}" disabled></label><label>Valor recebido<input name="amount" type="number" min="0.01" max="${summary.openAmount}" step="0.01" required></label><label>Forma<select name="method"><option>PIX</option><option>Dinheiro</option><option>Crédito</option><option>Débito</option><option>Boleto</option></select></label><div class="full"><small>O valor será distribuído automaticamente nas diárias pendentes, da mais antiga para a mais recente.</small></div><div class="full modal-actions"><button type="button" data-close>Cancelar</button><button class="primary">Confirmar recebimento</button></div></form>`,()=>{
    const form=document.querySelector('#daily-bulk-payment-form');
    form.onsubmit=event=>{event.preventDefault();const fd=Object.fromEntries(new FormData(form));try{save(recordDailyPaymentAmount(snapshot,rentalId,{amount:Number(fd.amount),method:fd.method},sessionUser.id));closeModal();toast('Recebimento registrado.');}catch(error){toast(error.message)}};
  });
}
