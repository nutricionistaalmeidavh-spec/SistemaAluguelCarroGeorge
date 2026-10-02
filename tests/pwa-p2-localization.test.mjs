import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { brDateToIso,brDateValue,brDateTimeToIso,emptyStateHtml,frequencyLabel,statusLabel } from '../src/cloud/ui/common.mjs';
import { customersHtml } from '../src/cloud/ui/customers.mjs';
import { vehiclesHtml } from '../src/cloud/ui/vehicles.mjs';
import { rentalsHtml } from '../src/cloud/ui/rentals.mjs';
import { inspectionsHtml } from '../src/cloud/ui/inspections.mjs';
import { financeHtml } from '../src/cloud/ui/finance.mjs';
import { billingHtml } from '../src/cloud/ui/billing.mjs';
import { contractsHtml } from '../src/cloud/ui/contracts.mjs';
import { documentsHtml } from '../src/cloud/ui/documents.mjs';
import { maintenanceHtml } from '../src/cloud/ui/maintenance.mjs';

const admin={id:'USR-1',role:'admin',active:true};
const empty={
  users:[],customers:[],vehicles:[],rentals:[],expenses:[],inspections:[],maintenance:[],ledger:[],audit:[],
  contractTemplates:[],issuedContracts:[],billingPlans:[],billingInstallments:[],billingPayments:[],collectionActions:[],attachments:[],alertState:{},settings:{}
};

test('P2: datas brasileiras convertem sem alterar o formato persistido',()=>{
  assert.equal(brDateValue('2026-10-02'),'02/10/2026');
  assert.equal(brDateToIso('02/10/2026'),'2026-10-02');
  assert.equal(brDateToIso('2026-10-02'),'2026-10-02');
  const parsed=new Date(brDateTimeToIso('02/10/2026 14:30',{required:true}));
  assert.equal(parsed.getFullYear(),2026);
  assert.equal(parsed.getMonth(),9);
  assert.equal(parsed.getDate(),2);
  assert.equal(parsed.getHours(),14);
  assert.equal(parsed.getMinutes(),30);
  assert.throws(()=>brDateToIso('31/02/2026'),/Data inválida/);
});

test('P2: rótulos técnicos ficam em português operacional',()=>{
  assert.equal(statusLabel('scheduled'),'Agendada');
  assert.equal(statusLabel('in_progress'),'Em andamento');
  assert.equal(statusLabel('disponivel'),'Disponível');
  assert.equal(frequencyLabel('daily'),'Diária');
  assert.equal(frequencyLabel('monthly'),'Mensal');
});

test('P2: estado vazio padronizado orienta e oferece CTA quando aplicável',()=>{
  const html=emptyStateHtml({title:'Nenhum cliente cadastrado',description:'Cadastre o primeiro cliente.',actionLabel:'Cadastrar cliente',action:'customer-create'});
  assert.match(html,/empty-state/);
  assert.match(html,/Cadastre o primeiro cliente/);
  assert.match(html,/data-empty-action="customer-create"/);
});

test('P2: módulos principais deixam de mostrar vazio sem orientação',()=>{
  assert.match(customersHtml(empty,admin),/Nenhum cliente cadastrado/);
  assert.match(customersHtml(empty,admin),/Cadastrar cliente/);
  assert.match(vehiclesHtml(empty,admin),/Nenhum veículo cadastrado/);
  assert.match(rentalsHtml(empty,admin),/Nenhuma locação cadastrada/);
  assert.match(inspectionsHtml(empty,admin),/Nenhuma vistoria concluída/);
  assert.match(financeHtml(empty,admin),/Nenhuma conta a receber/);
  assert.match(billingHtml(empty,admin),/Nenhuma parcela gerada/);
  assert.match(contractsHtml(empty,admin),/Nenhum modelo de contrato/);
  assert.match(documentsHtml(empty),/Nenhum documento de locação/);
  assert.match(maintenanceHtml(empty,admin),/Nenhuma manutenção registrada/);
});

test('P2: formulários do PWA não dependem do placeholder de data do navegador',async()=>{
  const files=['customers.mjs','vehicles.mjs','rentals.mjs','finance.mjs','billing.mjs','maintenance.mjs','administration.mjs'];
  for(const file of files){
    const source=await readFile(new URL(`../src/cloud/ui/${file}`,import.meta.url),'utf8');
    assert.doesNotMatch(source,/type="date"|datetime-local/,`${file} ainda usa formato de data dependente do navegador`);
  }
  const joined=await Promise.all(files.map(file=>readFile(new URL(`../src/cloud/ui/${file}`,import.meta.url),'utf8')));
  assert.ok(joined.some(source=>source.includes('dd/mm/aaaa')),'campos de data devem orientar no padrão brasileiro');
});
