import test from 'node:test';
import assert from 'node:assert/strict';
import { getFinancialSummary } from '../src/domain/commercial-finance.mjs';
import { ensureCommercialSnapshot, createContractTemplate, issueContract, createBillingPlan, delinquencySummary } from '../src/domain/commercial.mjs';
import { createRepository, STORE_KEY } from '../src/storage/repository.mjs';

function base(){return {version:3,updatedAt:'2026-09-14T10:00:00Z',customers:[{id:'CLI-1',name:'Ana',document:'123',phone:'1199',active:true}],vehicles:[{id:'VEI-1',model:'Onix',plate:'ABC1D23',availability:'disponivel'}],rentals:[{id:'LOC-1',customerId:'CLI-1',vehicleId:'VEI-1',attendantId:'USR-1',pickupAt:'2026-09-01T10:00:00Z',returnAt:'2026-10-01T10:00:00Z',total:300,dailyRate:100,status:'locado',payments:[]}],users:[{id:'USR-1',name:'Victor'}],ledger:[],audit:[],expenses:[],settings:{companyName:'Locadora X',document:'00.000.000/0001-00'}};}

test('repositório migra snapshot v3 carregado do SQLite para v4 comercial',async()=>{
  const map=new Map([[STORE_KEY,JSON.stringify(base())]]);
  const previous=globalThis.window;
  globalThis.window={locadoraDesktop:{dbGet:async key=>map.get(key)??null,dbSet:async(key,value)=>{map.set(key,String(value));return true;},dbRemove:async key=>{map.delete(key);return true;}}};
  try{
    const repository=await createRepository();
    const snapshot=repository.load();
    assert.equal(snapshot.version,4);
    for(const key of ['contractTemplates','issuedContracts','billingPlans','billingInstallments','collectionActions'])assert.deepEqual(snapshot[key],[],key);
  }finally{globalThis.window=previous;}
});

test('resumo financeiro inclui recebíveis recorrentes',()=>{
  const snapshot={ledger:[
    {kind:'receivable',amount:100,paidAmount:100},
    {kind:'billing_receivable',amount:50,paidAmount:20},
    {kind:'expense',amount:10,paidAmount:10}
  ]};
  const summary=getFinancialSummary(snapshot);
  assert.deepEqual(summary,{grossRevenue:150,paidAmount:120,openAmount:30,expensesAmount:10,netCash:110});
});

test('contrato não é emitido quando contém variável desconhecida',()=>{
  let snapshot=ensureCommercialSnapshot(base());
  snapshot=createContractTemplate(snapshot,{name:'Inválido',body:'Cliente {{cliente.nome}} - {{campo.inexistente}}',isDefault:true},'USR-1');
  assert.throws(()=>issueContract(snapshot,{templateId:snapshot.contractTemplates[0].id,rentalId:'LOC-1'},'USR-1'),/vari.*desconhecida/i);
});

test('inadimplência informa vencendo hoje e próximos sete dias',()=>{
  let snapshot=ensureCommercialSnapshot(base());
  snapshot=createBillingPlan(snapshot,{rentalId:'LOC-1',frequency:'weekly',firstDueAt:'2026-09-14',amount:100,occurrences:3},'USR-1');
  const summary=delinquencySummary(snapshot,'2026-09-14T12:00:00Z');
  assert.equal(summary.dueToday,100);
  assert.equal(summary.dueNext7Days,100);
});
