import { can } from '../../domain/auth.mjs';
import { buildDashboard } from '../../domain/reports.mjs';
import { emptyStateHtml,esc,money,shortDate } from './common.mjs';

function taskRows(snapshot){
  return (snapshot.rentals??[])
    .filter(item=>item.status!=='devolucao')
    .sort((a,b)=>String(a.pickupAt||'').localeCompare(String(b.pickupAt||'')))
    .slice(0,6);
}
export function overviewHtml(snapshot,user){
  const dashboard=snapshot.overviewSummary??buildDashboard(snapshot);
  const performance=(dashboard.vehiclePerformance??[]).map(item=>`<article class="card cloud-performance"><div><strong>${esc(item.model)}</strong><small>${esc(item.plate)}</small></div><div class="kpi-lines"><p><span>Locações</span><b>${item.rentalCount}</b></p><p><span>Receita</span><b>${money(item.revenue)}</b></p><p><span>Custos</span><b>${money(item.expenses)}</b></p><p><span>Margem</span><b>${money(item.margin)}</b></p></div></article>`).join('');
  const localRentals=taskRows(snapshot),rentals=(dashboard.nextActions??localRentals).slice(0,6),pickupCount=dashboard.pickupPending??localRentals.filter(item=>['reserva','retirada'].includes(item.status)).length,returnCount=dashboard.returnPending??localRentals.filter(item=>item.status==='em_uso').length;
  const tasks=rentals.map(item=>{const customer=snapshot.customers?.find(row=>row.id===item.customerId),vehicle=snapshot.vehicles?.find(row=>row.id===item.vehicleId),returning=item.status==='em_uso',vehicleText=[item.vehicleModel??vehicle?.model,item.vehiclePlate??vehicle?.plate].filter(Boolean).join(' · ')||item.vehicleId||'Veículo',customerText=item.customerName??customer?.name??item.customerId??'Cliente';return `<article class="card cloud-entity-card"><div><small>${returning?'DEVOLUÇÃO':'RETIRADA'}</small><strong>${esc(vehicleText)} · ${esc(customerText)}</strong><span>${shortDate(returning?item.returnAt:item.pickupAt)}</span></div><button type="button" class="primary" data-overview-nav="rentals">${returning?'Registrar devolução':'Fazer retirada'}</button></article>`;}).join('');
  return `<div class="heading"><div><small>O QUE PRECISA DE ATENÇÃO</small><h1>Hoje</h1></div></div>
  <section class="panel"><div class="panel-title"><div><h2>Próximas ações</h2><span>Comece pelo que precisa ser feito, não pelo módulo do sistema.</span></div></div>
    <div class="cards cloud-cards"><article><small>Retiradas</small><strong>${pickupCount}</strong><button type="button" class="secondary" data-overview-nav="rentals">Ver locações</button></article><article><small>Devoluções</small><strong>${returnCount}</strong><button type="button" class="secondary" data-overview-nav="rentals">Ver locações</button></article>${can(user,'finance.read')?`<article><small>Receber</small><strong>${money(dashboard.openAmount)}</strong><button type="button" class="secondary" data-overview-nav="finance">Abrir financeiro</button></article>`:''}</div>
    <div class="cloud-card-list">${tasks||emptyStateHtml({title:'Nenhuma retirada ou devolução pendente',description:'Quando houver uma locação aguardando retirada ou devolução, a próxima ação aparecerá aqui.'})}</div>
  </section>
  <div class="cards cloud-cards six" data-test="pwa-dashboard-kpis">
    <article><small>Ocupação</small><strong>${dashboard.occupancyRate}%</strong></article>
    <article><small>Locações abertas</small><strong>${dashboard.openRentals}</strong></article>
    <article><small>Em atraso</small><strong>${dashboard.overdueRentals}</strong></article>
    <article><small>Recebido</small><strong>${money(dashboard.received)}</strong></article>
    <article><small>Em aberto</small><strong>${money(dashboard.openAmount)}</strong></article>
    <article><small>Caixa líquido</small><strong>${money(dashboard.netCash)}</strong></article>
  </div>
  <details class="panel"><summary>Indicadores da frota</summary><div class="cloud-grid"><section><h2>Frota</h2><div class="kpi-lines"><p><span>Total</span><b>${dashboard.fleetTotal}</b></p><p><span>Disponíveis</span><b>${dashboard.availableVehicles}</b></p><p><span>Em manutenção</span><b>${dashboard.maintenanceVehicles}</b></p><p><span>Ticket médio</span><b>${money(dashboard.averageTicket)}</b></p></div></section><section><h2>Rentabilidade por veículo</h2><div class="cloud-card-list">${performance||emptyStateHtml({title:'Ainda não há dados de rentabilidade',description:'A rentabilidade por veículo aparecerá depois das primeiras locações e despesas registradas.'})}</div></section></div></details>`;
}
export function bindOverview(root,{actions}){root.querySelectorAll('[data-overview-nav]').forEach(button=>button.onclick=()=>actions.refresh(button.dataset.overviewNav));}
