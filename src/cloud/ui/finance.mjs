import { can } from '../../domain/auth.mjs';
import { buildDashboard } from '../../domain/reports.mjs';
import { financialReceivables } from '../../domain/commercial-finance.mjs';
import { esc,money,shortDate } from './common.mjs';
import { collectLedgerPayment,collectRentalPayment } from './payment-flow.mjs';

const round=value=>Math.round((Number(value||0)+Number.EPSILON)*100)/100;
function balance(item){return round(Math.max(0,Number(item.amount||0)-Number(item.paidAmount||0)));}

export function groupFinancialReceivables(snapshot){
  const grouped=new Map();
  for(const item of financialReceivables(snapshot)){
    const rentalId=String(item.rentalId??''),key=rentalId?`rental:${rentalId}`:`ledger:${String(item.id)}`,open=balance(item);
    let group=grouped.get(key);
    if(!group){group={key,rentalId:rentalId||null,entries:[],amount:0,paidAmount:0,balance:0,openCount:0,nextDueAt:null};grouped.set(key,group);}
    group.entries.push(item);
    group.amount=round(group.amount+Number(item.amount||0));
    group.paidAmount=round(group.paidAmount+Number(item.paidAmount||0));
    group.balance=round(group.balance+open);
    if(open>0){group.openCount+=1;const due=String(item.dueAt??'');if(due&&(!group.nextDueAt||due<group.nextDueAt))group.nextDueAt=due;}
  }
  return [...grouped.values()].map(group=>{
    const rental=(snapshot.rentals??[]).find(item=>String(item.id)===String(group.rentalId))??null;
    const customer=(snapshot.customers??[]).find(item=>String(item.id)===String(rental?.customerId))??null;
    const vehicle=(snapshot.vehicles??[]).find(item=>String(item.id)===String(rental?.vehicleId))??null;
    return{...group,rental,customer,vehicle,entryCount:group.entries.length};
  }).sort((a,b)=>String(a.customer?.name??a.entries[0]?.description??a.key).localeCompare(String(b.customer?.name??b.entries[0]?.description??b.key),'pt-BR')||String(a.nextDueAt??'9999-12-31').localeCompare(String(b.nextDueAt??'9999-12-31')));
}

function receivableCard(group,writable){
  const daily=group.rental?.billingMode==='daily';
  const openLabel=daily?`${group.openCount} ${group.openCount===1?'diária em aberto':'diárias em aberto'}`:`${group.openCount} ${group.openCount===1?'recebível em aberto':'recebíveis em aberto'}`;
  const vehicleLabel=group.vehicle?[group.vehicle.model,group.vehicle.plate].filter(Boolean).join(' · '):'';
  const fallback=group.entries[0],title=group.customer?.name||fallback?.description||group.rentalId||fallback?.id||'Conta a receber';
  const action=group.rentalId?`<button class="primary" data-payment-rental="${esc(group.rentalId)}">Dar baixa</button>`:fallback?`<button class="primary" data-payment-ledger="${esc(fallback.id)}">Dar baixa</button>`:'';
  return `<article class="card cloud-entity-card"${group.rentalId?` data-receivable-rental="${esc(group.rentalId)}"`:''}><div><strong>${esc(title)}</strong>${vehicleLabel?`<small>${esc(vehicleLabel)}</small>`:''}<small>${esc(openLabel)} · total ${money(group.amount)} · recebido ${money(group.paidAmount)} · Saldo ${money(group.balance)}</small><small>Próximo vencimento: ${shortDate(group.nextDueAt)}</small></div>${writable&&group.balance>0?`<div class="actions">${action}</div>`:''}</article>`;
}

export function financeHtml(snapshot,user){
  const d=buildDashboard(snapshot),writable=can(user,'finance.write');
  const expenses=(snapshot.expenses??[]).map(e=>`<article class="card cloud-entity-card"><div><strong>${esc(e.description)}</strong><small>${esc(e.category||'Despesa')} · ${money(e.amount)} · ${e.paid?'paga':'em aberto'} · ${shortDate(e.dueAt)}</small></div>${writable?`<div class="actions"><button data-expense-edit="${esc(e.id)}">Editar</button><button data-expense-delete="${esc(e.id)}" data-version="${Number(e.version||1)}">Excluir</button></div>`:''}</article>`).join('');
  const receivables=groupFinancialReceivables(snapshot).map(group=>receivableCard(group,writable)).join('');
  return `<div class="heading"><div><small>CAIXA E CONTAS A RECEBER</small><h1>Financeiro</h1></div></div><div class="cards six"><article><small>Receita prevista</small><strong>${money(d.grossRevenue)}</strong></article><article><small>Recebido</small><strong>${money(d.received)}</strong></article><article><small>Em aberto</small><strong>${money(d.openAmount)}</strong></article><article><small>Despesas pagas</small><strong>${money(d.expensesPaid)}</strong></article><article><small>Caixa líquido</small><strong>${money(d.netCash)}</strong></article><article><small>Ticket médio</small><strong>${money(d.averageTicket)}</strong></article></div><section class="panel" id="cloud-receivables" data-section="receivables"><div class="panel-title"><h2>Contas a receber</h2><span>Uma locação por card · baixa unificada</span></div><div class="cloud-card-list">${receivables||'<div class="empty">Nenhum recebível.</div>'}</div></section><div class="cloud-grid">${writable?`<form id="cloud-expense-form" class="panel cloud-form"><h2>Nova despesa</h2><input type="hidden" name="id"><input type="hidden" name="version"><label>Descrição<input name="description" required></label><label>Categoria<input name="category"></label><label>Veículo<select name="vehicleId"><option value="">Geral</option>${(snapshot.vehicles??[]).map(v=>`<option value="${esc(v.id)}">${esc(v.model)} · ${esc(v.plate)}</option>`).join('')}</select></label><label>Valor<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Vencimento<input name="dueAt" type="date"></label><label><input name="paid" type="checkbox" value="1"> Já paga</label><button class="primary full">Salvar despesa</button></form>`:''}<section class="panel"><h2>Despesas</h2><div class="cloud-card-list">${expenses||'<div class="empty">Nenhuma despesa.</div>'}</div></section></div>`;
}

export function bindFinance(root,{snapshot,user,actions}){
  if(!can(user,'finance.write'))return;
  const form=root.querySelector('#cloud-expense-form');
  if(form)form.onsubmit=async event=>{event.preventDefault();const fd=new FormData(form),id=String(fd.get('id')||''),version=Number(fd.get('version')||0),payload={description:String(fd.get('description')),category:String(fd.get('category')||''),vehicleId:String(fd.get('vehicleId')||'')||null,amount:Number(fd.get('amount')),dueAt:String(fd.get('dueAt')||'')||null,paid:fd.get('paid')==='1'};if(id)await actions.queue('expense.update',{id,expectedVersion:version,...payload},'EXP');else await actions.queue('expense.create',{id:`DES-${crypto.randomUUID()}`,...payload},'EXP');await actions.refresh('finance');};
  root.querySelectorAll('[data-expense-edit]').forEach(button=>button.onclick=()=>{const item=snapshot.expenses.find(e=>e.id===button.dataset.expenseEdit);if(!item||!form)return;form.elements.id.value=item.id;form.elements.version.value=String(item.version||1);for(const key of ['description','category','vehicleId','amount','dueAt'])if(form.elements[key])form.elements[key].value=item[key]??'';form.elements.paid.checked=Boolean(item.paid);form.scrollIntoView({behavior:'smooth'});});
  root.querySelectorAll('[data-expense-delete]').forEach(button=>button.onclick=async()=>{await actions.queue('expense.delete',{id:button.dataset.expenseDelete,expectedVersion:Number(button.dataset.version||1)},'EXP');await actions.refresh('finance');});
  root.querySelectorAll('[data-payment-rental]').forEach(button=>button.onclick=()=>collectRentalPayment(snapshot,button.dataset.paymentRental,actions,{refresh:'finance'}));
  root.querySelectorAll('[data-payment-ledger]').forEach(button=>button.onclick=()=>collectLedgerPayment(snapshot,button.dataset.paymentLedger,actions,{refresh:'finance'}));
}
