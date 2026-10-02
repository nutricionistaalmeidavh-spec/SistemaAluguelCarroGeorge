import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(relative){return readFile(new URL(`../${relative}`,import.meta.url),'utf8');}

test('P0: UI de sincronização não expõe cursor nem versão nula como conflito ao usuário',async()=>{
  const app=await source('src/cloud-app.mjs');
  assert.doesNotMatch(app,/Sessão validada pelo servidor[^\n]*cursor/);
  assert.doesNotMatch(app,/Versão atual da nuvem/);
  assert.match(app,/1 item precisa de atenção/);
  assert.match(app,/Detalhes técnicos/);
  assert.match(app,/data-cloud-retry/);
  assert.match(app,/data-cloud-discard/);
});

test('P0: atalho flutuante legado de Segurança não é injetado nos assets',async()=>{
  const prepare=await source('scripts/prepare-cloud-assets.mjs');
  assert.doesNotMatch(prepare,/cloud-security-console/);
  assert.doesNotMatch(prepare,/position:fixed;right:16px;bottom:16px/);
});

test('P1: clientes e frota priorizam lista, busca e criação sob demanda',async()=>{
  const [customers,vehicles]=await Promise.all([source('src/cloud/ui/customers.mjs'),source('src/cloud/ui/vehicles.mjs')]);
  assert.match(customers,/cloud-create-panel/);
  assert.match(customers,/data-customer-search/);
  assert.match(customers,/\+ Novo cliente/);
  assert.match(vehicles,/cloud-create-panel/);
  assert.match(vehicles,/data-vehicle-search/);
  assert.match(vehicles,/\+ Novo veículo/);
  assert.match(vehicles,/<legend>Identificação<\/legend>/);
  assert.match(vehicles,/<legend>Documentos<\/legend>/);
});

test('P1: financeiro compacta KPIs e formulários operacionais têm blocos claros',async()=>{
  const [finance,rentals,inspections,maintenance,billing]=await Promise.all([
    source('src/cloud/ui/finance.mjs'),source('src/cloud/ui/rentals.mjs'),source('src/cloud/ui/inspections.mjs'),source('src/cloud/ui/maintenance.mjs'),source('src/cloud/ui/billing.mjs')
  ]);
  assert.match(finance,/finance-kpis/);
  assert.doesNotMatch(finance,/cards six/);
  assert.match(finance,/\+ Nova despesa/);
  assert.match(rentals,/<legend>Cliente e veículo<\/legend>/);
  assert.match(rentals,/<legend>Cobrança<\/legend>/);
  assert.match(inspections,/<legend>Checklist<\/legend>/);
  assert.match(inspections,/<legend>Avarias e observações<\/legend>/);
  assert.match(maintenance,/\+ Agendar manutenção/);
  assert.match(billing,/\+ Criar plano de cobrança/);
});

test('P1: Administração é dividida em Empresa, Segurança, Backup e Auditoria',async()=>{
  const admin=await source('src/cloud/ui/administration.mjs');
  for(const name of ['company','security','backup','audit'])assert.match(admin,new RegExp(`data-admin-tab="${name}"`));
  assert.match(admin,/Segurança avançada/);
  assert.match(admin,/\.\/security\.html/);
  assert.match(admin,/admin-cleanup-known-fixtures/);
  assert.match(admin,/Excluir dados de teste identificados/);
});
