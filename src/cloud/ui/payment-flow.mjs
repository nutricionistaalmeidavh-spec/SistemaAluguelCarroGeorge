import { esc,money } from './common.mjs';

const round=value=>Math.round((Number(value||0)+Number.EPSILON)*100)/100;
const balanceOf=item=>round(Math.max(0,Number(item?.amount||0)-Number(item?.paidAmount||0)));
const paidDirect=rental=>round((rental?.payments??[]).reduce((sum,item)=>sum+Number(item?.amount||0),0));

function rentalOf(snapshot,rentalId){return (snapshot?.rentals??[]).find(item=>String(item.id)===String(rentalId))??null;}
function installmentRows(snapshot,rentalId){return (snapshot?.billingInstallments??[])
  .filter(item=>String(item.rentalId)===String(rentalId)&&item.status!=='cancelled')
  .sort((a,b)=>Number(a.sequence||0)-Number(b.sequence||0)||String(a.dueAt||'').localeCompare(String(b.dueAt||'')));}

export function rentalPaymentState(snapshot,rentalOrId){
  const rental=typeof rentalOrId==='object'?rentalOrId:rentalOf(snapshot,rentalOrId);
  if(!rental)return null;
  const installments=installmentRows(snapshot,rental.id),installmentPaid=round(installments.reduce((sum,item)=>sum+Number(item.paidAmount||0),0)),directPaid=paidDirect(rental),paid=round(directPaid+installmentPaid);
  const scheduledBalance=round(installments.reduce((sum,item)=>sum+balanceOf(item),0));
  const totalBalance=round(Math.max(0,Number(rental.total||0)-paid));
  return{rental,installments,directPaid,installmentPaid,paid,balance:installments.length?Math.min(totalBalance||scheduledBalance,scheduledBalance):totalBalance,scheduledBalance};
}

export function paymentPlanForRental(snapshot,rentalId,{amount,method='PIX',paidAt=new Date().toISOString()}={}){
  const state=rentalPaymentState(snapshot,rentalId);if(!state)throw Object.assign(new Error('rental_not_found'),{code:'rental_not_found'});
  const requested=round(amount);if(!(requested>0))throw Object.assign(new Error('invalid_amount'),{code:'invalid_amount'});
  if(requested>state.balance+0.001)throw Object.assign(new Error('payment_exceeds_balance'),{code:'payment_exceeds_balance'});
  const open=state.installments.filter(item=>balanceOf(item)>0);
  if(open.length){
    let remaining=requested;const plan=[];
    for(const item of open){if(remaining<=0)break;const portion=round(Math.min(balanceOf(item),remaining));if(portion<=0)continue;plan.push({kind:'billing.payment',payload:{installmentId:item.id,amount:portion,method,paidAt}});remaining=round(remaining-portion);}
    if(remaining>0.001)throw Object.assign(new Error('payment_exceeds_balance'),{code:'payment_exceeds_balance'});
    return plan;
  }
  return[{kind:'rental.payment',payload:{rentalId:state.rental.id,amount:requested,method,paidAt}}];
}

export function paymentTargetForLedger(snapshot,item){
  const entry=item??{},balance=balanceOf(entry),rentalId=String(entry.rentalId??'');
  const installment=(snapshot?.billingInstallments??[]).find(row=>String(row.id)===String(entry.installmentId??'')&&row.status!=='cancelled');
  if(installment)return{kind:'billing.payment',id:String(installment.id),balance,rentalId:String(installment.rentalId??rentalId)};
  return{kind:'rental.payment',id:rentalId,balance,rentalId};
}

function equivalentText(amount,dailyRate){
  if(!(dailyRate>0)||!(amount>0))return'';
  const days=amount/dailyRate,rounded=Math.round(days),label=Math.abs(days-rounded)<0.001?String(rounded):days.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:2});
  return `${label} ${Math.abs(days-1)<0.001?'diária':'diárias'}`;
}

export function paymentDialogHtml({title='Dar baixa',subtitle='',balance=0,dailyRate=0,defaultAmount=balance}={}){
  const safeBalance=round(balance),safeRate=round(dailyRate),initial=round(Math.min(Math.max(0,Number(defaultAmount||0)),safeBalance));
  const quick=safeRate>0?[1,2,3].filter(count=>safeRate*count<=safeBalance+0.001).map(count=>`<button type="button" class="secondary" data-payment-quick="${round(Math.min(safeBalance,safeRate*count))}">${count} ${count===1?'diária':'diárias'}</button>`).join(''):'';
  return `<div class="modal-overlay" data-payment-overlay><form class="modal payment-modal" data-payment-form><div class="modal-head"><div><small>RECEBIMENTO</small><h2>${esc(title)}</h2>${subtitle?`<p class="hint">${esc(subtitle)}</p>`:''}</div><button type="button" aria-label="Fechar" data-payment-cancel>×</button></div><div class="payment-summary"><div><small>Saldo atual</small><strong>${money(safeBalance)}</strong></div>${safeRate>0?`<div><small>Valor da diária</small><strong>${money(safeRate)}</strong></div>`:''}<div><small>Saldo após baixa</small><strong data-payment-after>${money(round(safeBalance-initial))}</strong></div></div>${quick?`<div class="payment-quick">${quick}<button type="button" class="secondary" data-payment-quick="${safeBalance}">Quitar saldo</button></div>`:''}<div class="form-grid"><label>Valor recebido<input name="amount" type="number" min="0.01" max="${safeBalance}" step="0.01" value="${initial.toFixed(2)}" required></label><label>Forma de pagamento<select name="method"><option>PIX</option><option>Dinheiro</option><option>Cartão</option></select></label></div><p class="payment-equivalent" data-payment-equivalent>${esc(equivalentText(initial,safeRate))}</p><div class="modal-actions"><button type="button" data-payment-cancel>Cancelar</button><button type="submit" class="primary">Confirmar baixa</button></div></form></div>`;
}

export function openPaymentDialog(options={}){
  const balance=round(options.balance),dailyRate=round(options.dailyRate);if(!(balance>0))return Promise.resolve(null);
  return new Promise(resolve=>{
    const host=document.createElement('div');host.innerHTML=paymentDialogHtml(options);const overlay=host.firstElementChild,form=overlay.querySelector('[data-payment-form]'),amount=form.elements.amount,after=overlay.querySelector('[data-payment-after]'),equivalent=overlay.querySelector('[data-payment-equivalent]');document.body.append(overlay);
    const close=value=>{overlay.remove();resolve(value);};
    const update=()=>{const value=round(Math.max(0,Math.min(balance,Number(amount.value||0))));after.textContent=money(round(balance-value));equivalent.textContent=equivalentText(value,dailyRate);};
    amount.addEventListener('input',update);overlay.querySelectorAll('[data-payment-quick]').forEach(button=>button.addEventListener('click',()=>{amount.value=Number(button.dataset.paymentQuick||0).toFixed(2);update();}));overlay.querySelectorAll('[data-payment-cancel]').forEach(button=>button.addEventListener('click',()=>close(null)));
    overlay.addEventListener('click',event=>{if(event.target===overlay)close(null);});
    form.addEventListener('submit',event=>{event.preventDefault();const value=round(Number(amount.value||0));if(!(value>0)||value>balance+0.001)return;close({amount:value,method:String(form.elements.method.value||'PIX'),paidAt:new Date().toISOString()});});
    amount.focus();amount.select();
  });
}

export async function runPaymentPlan(actions,plan,prefix='PAG'){
  for(const item of plan)await actions.queue(item.kind,item.payload,prefix);
}

export async function collectRentalPayment(snapshot,rentalId,actions,{refresh='rentals'}={}){
  const state=rentalPaymentState(snapshot,rentalId);if(!state||state.balance<=0)return false;const rental=state.rental,customer=(snapshot.customers??[]).find(item=>item.id===rental.customerId),vehicle=(snapshot.vehicles??[]).find(item=>item.id===rental.vehicleId);
  const input=await openPaymentDialog({title:'Dar baixa na locação',subtitle:[customer?.name,vehicle?.model,vehicle?.plate].filter(Boolean).join(' · '),balance:state.balance,dailyRate:Number(rental.dailyRate||0),defaultAmount:Number(rental.dailyRate||0)>0?Math.min(state.balance,Number(rental.dailyRate)):state.balance});if(!input)return false;
  await runPaymentPlan(actions,paymentPlanForRental(snapshot,rentalId,input),'PAG');await actions.refresh(refresh);return true;
}

export async function collectInstallmentPayment(snapshot,installmentId,actions,{refresh='billing'}={}){
  const item=(snapshot.billingInstallments??[]).find(row=>String(row.id)===String(installmentId));if(!item)return false;const balance=balanceOf(item);if(balance<=0)return false;const rental=rentalOf(snapshot,item.rentalId),customer=(snapshot.customers??[]).find(row=>row.id===item.customerId),input=await openPaymentDialog({title:`Dar baixa na diária #${Number(item.sequence||0)}`,subtitle:customer?.name||rental?.id||item.rentalId,balance,dailyRate:Number(rental?.dailyRate||item.amount||0),defaultAmount:balance});if(!input)return false;
  await runPaymentPlan(actions,[{kind:'billing.payment',payload:{installmentId:item.id,...input}}],'PAG');await actions.refresh(refresh);return true;
}

export async function collectLedgerPayment(snapshot,ledgerId,actions,{refresh='finance'}={}){
  const item=(snapshot.ledger??[]).find(row=>String(row.id)===String(ledgerId));if(!item)return false;const target=paymentTargetForLedger(snapshot,item);if(!(target.balance>0))return false;const rental=rentalOf(snapshot,target.rentalId),customer=(snapshot.customers??[]).find(row=>row.id===rental?.customerId),input=await openPaymentDialog({title:'Dar baixa no recebível',subtitle:[customer?.name,item.description].filter(Boolean).join(' · '),balance:target.balance,dailyRate:Number(rental?.dailyRate||0),defaultAmount:target.kind==='billing.payment'?target.balance:(Number(rental?.dailyRate||0)>0?Math.min(target.balance,Number(rental.dailyRate)):target.balance)});if(!input)return false;
  const plan=target.kind==='billing.payment'?[{kind:'billing.payment',payload:{installmentId:target.id,...input}}]:paymentPlanForRental(snapshot,target.rentalId,input);await runPaymentPlan(actions,plan,'PAG');await actions.refresh(refresh);return true;
}
