import { buildDashboard } from '../../domain/reports.mjs';
import { esc,money } from './common.mjs';

export function overviewHtml(snapshot){
  const dashboard=buildDashboard(snapshot);
  const performance=dashboard.vehiclePerformance.map(item=>`<article class="card cloud-performance"><div><strong>${esc(item.model)}</strong><small>${esc(item.plate)}</small></div><div class="kpi-lines"><p><span>Locações</span><b>${item.rentalCount}</b></p><p><span>Receita</span><b>${money(item.revenue)}</b></p><p><span>Custos</span><b>${money(item.expenses)}</b></p><p><span>Margem</span><b>${money(item.margin)}</b></p></div></article>`).join('');
  return `<div class="heading"><div><small>VISÃO GERAL</small><h1>Dashboard</h1></div></div>
  <div class="cards cloud-cards six" data-test="pwa-dashboard-kpis">
    <article><small>Ocupação</small><strong>${dashboard.occupancyRate}%</strong></article>
    <article><small>Locações abertas</small><strong>${dashboard.openRentals}</strong></article>
    <article><small>Em atraso</small><strong>${dashboard.overdueRentals}</strong></article>
    <article><small>Recebido</small><strong>${money(dashboard.received)}</strong></article>
    <article><small>Em aberto</small><strong>${money(dashboard.openAmount)}</strong></article>
    <article><small>Caixa líquido</small><strong>${money(dashboard.netCash)}</strong></article>
  </div>
  <div class="cloud-grid"><section class="panel"><h2>Frota</h2><div class="kpi-lines"><p><span>Total</span><b>${dashboard.fleetTotal}</b></p><p><span>Disponíveis</span><b>${dashboard.availableVehicles}</b></p><p><span>Em manutenção</span><b>${dashboard.maintenanceVehicles}</b></p><p><span>Ticket médio</span><b>${money(dashboard.averageTicket)}</b></p></div></section><section class="panel"><h2>Rentabilidade por veículo</h2><div class="cloud-card-list">${performance||'<div class="empty">Sem dados financeiros por veículo.</div>'}</div></section></div>`;
}
