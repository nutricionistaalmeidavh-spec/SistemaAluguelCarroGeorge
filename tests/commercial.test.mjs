import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureCommercialSnapshot, createContractTemplate, renderContractTemplate, issueContract,
  createBillingPlan, installmentBalance, recordInstallmentPayment,
  delinquencySummary, recordCollectionAction, cancelBillingPlan, billingAlerts,
  filteredDelinquency, vehicleDelinquencyReport
} from '../src/domain/commercial.mjs';
import { mergeSnapshots } from '../src/domain/sync.mjs';

function base(){return {version:3,updatedAt:'2026-09-14T10:00:00Z',customers:[{id:'CLI-1',name:'Ana',document:'123',phone:'1199',active:true}],vehicles:[{id:'VEI-1',model:'Onix',plate:'ABC1D23',availability:'disponivel'}],rentals:[{id:'LOC-1',customerId:'CLI-1',vehicleId:'VEI-1',attendantId:'USR-1',pickupAt:'2026-09-01T10:00:00Z',returnAt:'2026-10-01T10:00:00Z',total:3000,dailyRate:100,status:'locado'}],users:[{id:'USR-1',name:'Victor'}],ledger:[],audit:[],expenses:[],settings:{companyName:'Locadora X',document:'00.000.000/0001-00'}};}

test('contrato: cria template, resolve variáveis e congela histórico emitido',()=>{
  let s=ensureCommercialSnapshot(base());
  s=createContractTemplate(s,{name:'Padrão',body:'{{cliente.nome}} aluga {{veiculo.placa}} por {{locacao.valor_total}}',isDefault:true},'USR-1');
  const t=s.contractTemplates[0];
  assert.equal(renderContractTemplate(s,t.id,'LOC-1').includes('Ana aluga ABC1D23'),true);
  s=issueContract(s,{templateId:t.id,rentalId:'LOC-1'},'USR-1');
  assert.equal(s.issuedContracts.length,1);
  assert.match(s.issuedContracts[0].renderedText,/Ana aluga ABC1D23/);
});

test('cobrança: mensal preserva fim do mês e pagamento parcial',()=>{
  let s=ensureCommercialSnapshot(base());
  s=createBillingPlan(s,{rentalId:'LOC-1',frequency:'monthly',firstDueAt:'2026-01-31',amount:500,occurrences:3,finePercent:2,interestMonthlyPercent:1},'USR-1');
  assert.deepEqual(s.billingInstallments.map(i=>i.dueAt.slice(0,10)),['2026-01-31','2026-02-28','2026-03-31']);
  const id=s.billingInstallments[0].id;
  s=recordInstallmentPayment(s,id,{amount:200,method:'PIX',paidAt:'2026-01-20T12:00:00Z'},'USR-1');
  assert.equal(s.billingInstallments.find(i=>i.id===id).status,'partial');
  assert.equal(installmentBalance(s.billingInstallments.find(i=>i.id===id),'2026-01-20T12:00:00Z').balance,300);
});

test('inadimplência: calcula aging, multa/juros e registra régua de cobrança',()=>{
  let s=ensureCommercialSnapshot(base());
  s=createBillingPlan(s,{rentalId:'LOC-1',frequency:'monthly',firstDueAt:'2026-07-01',amount:1000,occurrences:1,finePercent:2,interestMonthlyPercent:3},'USR-1');
  const installment=s.billingInstallments[0];
  const due=installmentBalance(installment,'2026-09-14T12:00:00Z');
  assert.equal(due.daysLate,74);
  assert.equal(due.fine,20);
  assert.equal(due.interest,74);
  const summary=delinquencySummary(s,'2026-09-14T12:00:00Z');
  assert.equal(summary.customers,1);
  assert.equal(summary.count,1);
  assert.equal(summary.aging['60+']>0,true);
  s=recordCollectionAction(s,{installmentId:installment.id,channel:'WhatsApp',note:'Prometeu pagar',promiseAt:'2026-09-20',nextActionAt:'2026-09-21'},'USR-1');
  assert.equal(s.collectionActions.length,1);
  assert.equal(s.collectionActions[0].customerId,'CLI-1');
});

test('sync: preserva coleções comerciais criadas em dispositivos diferentes',()=>{
  const server=ensureCommercialSnapshot(base());
  server.contractTemplates=[{id:'CTR-1',name:'A',body:'A',active:true,version:1,updatedAt:'2026-09-14T10:01:00Z'}];
  const client=ensureCommercialSnapshot(base());
  client.billingPlans=[{id:'PLN-1',rentalId:'LOC-1',amount:100,updatedAt:'2026-09-14T10:02:00Z'}];
  client.billingInstallments=[{id:'PAR-1',planId:'PLN-1',rentalId:'LOC-1',customerId:'CLI-1',amount:100,paidAmount:0,status:'open',dueAt:'2026-09-20',updatedAt:'2026-09-14T10:02:00Z'}];
  const merged=mergeSnapshots(server,client);
  assert.equal(merged.contractTemplates.length,1);
  assert.equal(merged.billingPlans.length,1);
  assert.equal(merged.billingInstallments.length,1);
});

test('cobrança: bloqueia recorrência equivalente, permite cancelar e gera alertas',()=>{
  let s=ensureCommercialSnapshot(base());
  const draft={rentalId:'LOC-1',frequency:'monthly',firstDueAt:'2026-09-20',amount:500,occurrences:2,finePercent:2,interestMonthlyPercent:1};
  s=createBillingPlan(s,draft,'USR-1');
  assert.throws(()=>createBillingPlan(s,draft,'USR-1'),/recorrência ativa equivalente/);
  const alerts=billingAlerts(s,'2026-09-18T12:00:00Z',7);
  assert.equal(alerts.some(a=>a.status==='upcoming'),true);
  const planId=s.billingPlans[0].id;
  s=cancelBillingPlan(s,planId,'USR-1');
  assert.equal(s.billingPlans[0].active,false);
  assert.equal(s.billingInstallments.every(i=>i.status==='cancelled'),true);
});

test('inadimplência: filtra por cliente e agrega por veículo',()=>{
  let s=ensureCommercialSnapshot(base());
  s=createBillingPlan(s,{rentalId:'LOC-1',frequency:'monthly',firstDueAt:'2026-07-01',amount:1000,occurrences:1},'USR-1');
  const rows=filteredDelinquency(s,{customerId:'CLI-1',minDays:30},'2026-09-14T12:00:00Z');
  assert.equal(rows.length,1);
  const vehicles=vehicleDelinquencyReport(s,'2026-09-14T12:00:00Z');
  assert.equal(vehicles[0].vehicleId,'VEI-1');
  assert.equal(vehicles[0].total>0,true);
});
