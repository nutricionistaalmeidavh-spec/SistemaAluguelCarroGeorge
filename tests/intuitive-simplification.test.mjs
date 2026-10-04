import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  PWA_NAV,
  primaryNavigationFor,
  mobileNavigationGroups,
  navigationParentFor,
  navHtml
} from '../src/cloud/ui/common.mjs';

const admin={id:'USR',role:'admin',active:true};

async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('navegação principal representa as tarefas do George sem remover capacidades',()=>{
  assert.deepEqual(PWA_NAV.map(item=>item.id),[
    'overview','customers','vehicles','rentals','inspections','finance',
    'billing','delinquency','contracts','documents','alerts','maintenance','administration'
  ]);
  assert.deepEqual(primaryNavigationFor(admin).map(item=>item.id),[
    'overview','rentals','customers','vehicles','finance'
  ]);
  const groups=mobileNavigationGroups(admin);
  assert.deepEqual(groups.map(group=>group.items.map(item=>item.id)),[
    ['overview','rentals','customers','vehicles','finance'],
    ['administration']
  ]);
  const flat=groups.flatMap(group=>group.items.map(item=>item.id));
  assert.equal(new Set(flat).size,flat.length,'nenhum destino deve aparecer duas vezes');
  assert.equal(navigationParentFor('billing'),'finance');
  assert.equal(navigationParentFor('delinquency'),'finance');
  assert.equal(navigationParentFor('inspections'),'rentals');
  assert.equal(navigationParentFor('contracts'),'rentals');
  assert.equal(navigationParentFor('documents'),'rentals');
  assert.equal(navigationParentFor('maintenance'),'vehicles');
  assert.equal(navigationParentFor('alerts'),'overview');
});

test('navegação não transforma Dar baixa em destino e agrupa funções avançadas em Mais',()=>{
  const html=navHtml(admin,'billing');
  assert.match(html,/>Hoje</);
  assert.match(html,/<summary>Mais<\/summary>/);
  assert.doesNotMatch(html,/data-cloud-shortcut="payment"/);
  assert.doesNotMatch(html,/>Dar baixa<\/span>/);
  assert.match(html,/data-cloud-nav="finance"[^>]*active/);
});

test('locação oferece ações do trabalho e não estados técnicos como fluxo principal',async()=>{
  const rentals=await source('src/cloud/ui/rentals.mjs');
  assert.match(rentals,/data-rental-inspection/);
  assert.match(rentals,/Fazer retirada/);
  assert.match(rentals,/Registrar devolução/);
  assert.match(rentals,/Receber pagamento/);
  assert.doesNotMatch(rentals,/data-rental-advance/);
});

test('vistoria conclui o ciclo operacional e avança a locação automaticamente',async()=>{
  const inspections=await source('src/cloud/ui/inspections.mjs');
  assert.match(inspections,/rental\.advance/);
  assert.match(inspections,/inspectionKind==='pickup'/);
  assert.match(inspections,/inspectionKind==='return'/);
  assert.match(inspections,/actions\.refresh\('rentals'\)/);
});

test('financeiro concentra cobrança e inadimplência como subfluxos',async()=>{
  const finance=await source('src/cloud/ui/finance.mjs');
  assert.match(finance,/Parcelas e planos/);
  assert.match(finance,/Em atraso/);
  assert.match(finance,/data-finance-subview="billing"/);
  assert.match(finance,/data-finance-subview="delinquency"/);
});

test('cadastros priorizam dados essenciais e status do veículo é derivado',async()=>{
  const [customers,vehicles]=await Promise.all([
    source('src/cloud/ui/customers.mjs'),
    source('src/cloud/ui/vehicles.mjs')
  ]);
  assert.match(customers,/form-advanced/);
  assert.match(vehicles,/form-advanced/);
  assert.match(vehicles,/type="hidden" name="availability"/);
  assert.doesNotMatch(vehicles,/<select name="availability">/);
});

test('Hoje prioriza próximas ações operacionais',async()=>{
  const overview=await source('src/cloud/ui/overview.mjs');
  assert.match(overview,/Próximas ações/);
  assert.match(overview,/Retiradas/);
  assert.match(overview,/Devoluções/);
  assert.match(overview,/Receber/);
});

test('fluxos secundários não usam prompt sequencial na PWA',async()=>{
  const [maintenance,delinquency]=await Promise.all([
    source('src/cloud/ui/maintenance.mjs'),
    source('src/cloud/ui/delinquency.mjs')
  ]);
  assert.doesNotMatch(maintenance,/prompt\(/);
  assert.doesNotMatch(delinquency,/prompt\(/);
  assert.match(maintenance,/modal-overlay/);
  assert.match(delinquency,/modal-overlay/);
});



test('desktop centraliza recebimentos em um único fluxo compartilhado',async()=>{
  const [payments,rentals,finance]=await Promise.all([
    source('src/ui/payments.mjs'),
    source('src/ui/reservas.mjs'),
    source('src/ui/financeiro.mjs')
  ]);
  assert.match(payments,/export function openRentalPayment/);
  assert.match(rentals,/openRentalPayment/);
  assert.match(finance,/openRentalPayment/);
  assert.match(rentals,/Receber pagamento/);
  assert.match(finance,/Receber pagamento/);
  assert.doesNotMatch(finance,/data-open-billing/);
});

test('desktop usa retirada e devolução como tarefas, sem botão genérico Avançar',async()=>{
  const rentals=await source('src/ui/reservas.mjs');
  assert.match(rentals,/data-rental-inspection/);
  assert.match(rentals,/Fazer retirada/);
  assert.match(rentals,/Registrar devolução/);
  assert.doesNotMatch(rentals,/data-status=/);
  assert.doesNotMatch(rentals,/>Avançar<\/button>/);
  const inspections=await source('src/ui/p1.mjs');
  assert.match(inspections,/moveRental/);
  assert.match(inspections,/closeContinuousDailyRental/);
});

test('desktop também reduz navegação principal e agrupa o restante em Mais',async()=>{
  const app=await source('src/app.mjs');
  assert.match(app,/const primaryNav=/);
  assert.match(app,/Hoje/);
  assert.match(app,/<summary>Mais<\/summary>/);
  assert.match(app,/\['reservas','Locações'\]/);
  assert.match(app,/\['financeiro','Financeiro'\]/);
});
