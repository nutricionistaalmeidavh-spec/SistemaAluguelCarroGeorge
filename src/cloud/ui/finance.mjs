import { can } from '../../domain/auth.mjs';
import { buildDashboard } from '../../domain/reports.mjs';
import { financialReceivables } from '../../domain/commercial-finance.mjs';
import { brDateToIso,brDateValue,emptyStateHtml,esc,money,pageControls,shortDate } from './common.mjs';
import { collectLedgerPayment,collectRentalPayment } from './payment-flow.mjs';

const round=value=>Math.round((Number(value||0)+Number.EPSILON)*100)/100;
function balance(item){return round(Math.max(0,Number(item.amount||0)-Number(item.paidAmount||0)));}

export function groupFinancialReceivables(snapshot){
  if((snapshot.financeReceivables??[]).length)return snapshot.financeReceivables.map(group=>({
    ...group,
    rental:group.rentalId?{id:group.rentalId,billingMode:group.billingMode}:null,
    customer:group.customerName?{name:group.customerName}:null,
    vehicle:group.vehicleModel||group.vehiclePlate?{model:group.vehicleModel,plate:group.vehiclePlate}:null,
    entries:group.fallbackLedgerId?[{id:group.fallbackLedgerId,description:group.customerName||'Conta a receber'}]:[],
    entryCount:Number(group.openCount)||0
  }));
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
  const fallback=group.entries?.[0],title=group.customer?.name||group.customerName||fallback?.description||group.rentalId||fallback?.id||'Conta a receber';
  const fallbackId=group.fallbackLedgerId||fallback?.id,action=group.rentalId?`<button class="primary" data-payment-rental="${esc(group.rentalId)}">Receber pagamento</button>`:fallbackId?`<button class="primary" data-payment-ledger="${esc(fallbackId)}">Receber pagamento</button>`:'';
  return `<article class="card cloud-entity-card"${group.rentalId?` data-receivable-rental="${esc(group.rentalId)}"`:''}><div><strong>${esc(title)}</strong>${vehicleLabel?`<small>${esc(vehicleLabel)}</small>`:''}<small>${esc(openLabel)} · total ${money(group.amount)} · recebido ${money(group.paidAmount)} · Saldo ${money(group.balance)}</small><small>Próximo vencimento: ${shortDate(group.nextDueAt)}</small></div>${writable&&group.balance>0?`<div class="actions">${action}</div>`:''}</article>`;
}

export function financeHtml(snapshot,user,{pagination={}}={}){
  const d=snapshot.financeSummary??buildDashboard(snapshot),writable=can(user,'finance.write'),today=new Date();today.setHours(0,0,0,0);
  const expenses=(snapshot.expenses??[]).map(e=>`<article class="card cloud-entity-card"><div><strong>${esc(e.description)}</strong><small>${esc(e.category||'Despesa')} · ${money(e.amount)} · ${e.paid?'paga':'em aberto'} · ${shortDate(e.dueAt)}</small></div>${writable?`<div class="actions"><button data-expense-edit="${esc(e.id)}">Editar</button><button data-expense-delete="${esc(e.id)}" data-version="${Number(e.version||1)}">Excluir</button></div>`:''}</article>`).join('');
  const receivableGroups=groupFinancialReceivables(snapshot),receivables=receivableGroups.map(group=>receivableCard(group,writable)).join(''),overdue=snapshot.financeSummary?.overdue??financialReceivables(snapshot).filter(item=>balance(item)>0&&item.dueAt&&new Date(String(item.dueAt).length<=10?`${item.dueAt}T12:00:00`:item.dueAt)<today).reduce((sum,item)=>round(sum+balance(item)),0),rp=pagination.financeReceivables??{},receivablePager=`<div class="server-pagebar"><form class="server-search" data-finance-search><input name="q" type="search" value="${esc(rp.q??'')}" placeholder="Cliente, veículo ou locação"><button type="submit" class="secondary">Buscar</button></form><div class="server-pager"><button type="button" class="secondary" data-finance-page="${Math.max(0,Number(rp.offset||0)-Number(rp.limit||30))}" ${Number(rp.offset||0)<=0?'disabled':''}>Anterior</button><span>Página ${Math.floor(Number(rp.offset||0)/Math.max(1,Number(rp.limit||30)))+1}</span><button type="button" class="secondary" data-finance-page="${Number(rp.offset||0)+Number(rp.limit||30)}" ${rp.hasMore?'':'disabled'}>Próxima</button></div></div>`,expensePager=pageControls('expenses',pagination.expenses??{},{search:true,placeholder:'Buscar despesa'});
  return `<div class="heading"><div><small>CAIXA E CONTAS A RECEBER</small><h1>Financeiro</h1></div></div><div class="finance-subnav"><button type="button" class="secondary" data-finance-subview="billing">Parcelas e planos</button><button type="button" class="secondary" data-finance-subview="delinquency">Em atraso</button></div><div class="cards finance-kpis"><article><small>A receber</small><strong>${money(d.openAmount)}</strong></article><article><small>Recebido</small><strong>${money(d.received)}</strong></article><article><small>Em atraso</small><strong>${money(overdue)}</strong></article><article><small>Despesas pagas</small><strong>${money(d.expensesPaid)}</strong></article></div><div class="finance-secondary-metrics"><span>Caixa líquido <strong>${money(d.netCash)}</strong></span><span>Ticket médio <strong>${money(d.averageTicket)}</strong></span></div><section class="panel" id="cloud-receivables" data-section="receivables"><div class="panel-title"><div><h2>Contas a receber</h2><span>Uma locação por card · baixa unificada</span></div></div><div class="cloud-card-list">${receivables||emptyStateHtml({title:'Nenhuma conta a receber',description:'Quando uma locação gerar cobrança, ela aparecerá aqui para baixa e acompanhamento.',actionLabel:writable?'Abrir locações':'',action:writable?'finance-rentals':''})}</div>${receivablePager}</section>${writable?`<details class="panel cloud-create-panel" data-expense-editor><summary>+ Nova despesa</summary><form id="cloud-expense-form" class="cloud-form cloud-inline-form"><input type="hidden" name="id"><input type="hidden" name="version"><label>Descrição<input name="description" required></label><label>Categoria<input name="category"></label><label>Veículo<select name="vehicleId"><option value="">Geral</option>${(snapshot.vehicles??[]).map(v=>`<option value="${esc(v.id)}">${esc(v.model)} · ${esc(v.plate)}</option>`).join('')}</select></label><label>Valor<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Vencimento<input name="dueAt" inputmode="numeric" placeholder="dd/mm/aaaa"></label><label><input name="paid" type="checkbox" value="1"> Já paga</label><button class="primary full">Salvar despesa</button></form></details>`:''}<section class="panel"><div class="panel-title"><div><h2>Despesas</h2><span>${snapshot.expenses.length} registro(s)</span></div></div><div class="cloud-card-list">${expenses||emptyStateHtml({title:'Nenhuma despesa registrada',description:'Registre despesas para acompanhar o caixa líquido da locadora.',actionLabel:writable?'Registrar despesa':'',action:writable?'expense-create':''})}</div>${expensePager}</section>`;
}

export function bindFinance(root,{snapshot,user,actions}){
  const form=root.querySelector('#cloud-expense-form');
  root.querySelectorAll('[data-finance-subview]').forEach(button=>button.onclick=()=>actions.openFinanceSubview(button.dataset.financeSubview));
  root.querySelector('[data-empty-action="finance-rentals"]')?.addEventListener('click',()=>void actions.refresh('rentals'));
  root.querySelector('[data-empty-action="expense-create"]')?.addEventListener('click',()=>{const editor=root.querySelector('[data-expense-editor]');if(editor)editor.open=true;form?.elements.description?.focus();form?.scrollIntoView({behavior:'smooth',block:'start'});});
  if(!can(user,'finance.write'))return;
  if(form)form.onsubmit=async event=>{event.preventDefault();const fd=new FormData(form),id=String(fd.get('id')||''),version=Number(fd.get('version')||0),payload={description:String(fd.get('description')),category:String(fd.get('category')||''),vehicleId:String(fd.get('vehicleId')||'')||null,amount:Number(fd.get('amount')),dueAt:brDateToIso(fd.get('dueAt'))||null,paid:fd.get('paid')==='1'};if(id)await actions.queue('expense.update',{id,expectedVersion:version,...payload},'EXP');else await actions.queue('expense.create',{id:`DES-${crypto.randomUUID()}`,...payload},'EXP');await actions.refresh('finance');};
  root.querySelectorAll('[data-expense-edit]').forEach(button=>button.onclick=()=>{const item=snapshot.expenses.find(e=>e.id===button.dataset.expenseEdit);if(!item||!form)return;const editor=root.querySelector('[data-expense-editor]');if(editor)editor.open=true;form.elements.id.value=item.id;form.elements.version.value=String(item.version||1);for(const key of ['description','category','vehicleId','amount'])if(form.elements[key])form.elements[key].value=item[key]??'';if(form.elements.dueAt)form.elements.dueAt.value=brDateValue(item.dueAt);form.elements.paid.checked=Boolean(item.paid);form.scrollIntoView({behavior:'smooth',block:'start'});});
  root.querySelectorAll('[data-expense-delete]').forEach(button=>button.onclick=async()=>{await actions.queue('expense.delete',{id:button.dataset.expenseDelete,expectedVersion:Number(button.dataset.version||1)},'EXP');await actions.refresh('finance');});
  root.querySelectorAll('[data-payment-rental]').forEach(button=>button.onclick=async()=>{const fresh=actions.paymentContext?await actions.paymentContext(button.dataset.paymentRental):snapshot;return collectRentalPayment(fresh,button.dataset.paymentRental,actions,{refresh:'finance'});});
  root.querySelectorAll('[data-payment-ledger]').forEach(button=>button.onclick=async()=>{const fresh=actions.ledgerPaymentContext?await actions.ledgerPaymentContext(button.dataset.paymentLedger):snapshot;return collectLedgerPayment(fresh,button.dataset.paymentLedger,actions,{refresh:'finance'});});
}
