import test from 'node:test';
import assert from 'node:assert/strict';
import { rentalsHtml } from '../src/cloud/ui/rentals.mjs';
import { inspectionsHtml } from '../src/cloud/ui/inspections.mjs';
import { financeHtml } from '../src/cloud/ui/finance.mjs';
import { billingHtml } from '../src/cloud/ui/billing.mjs';
import { delinquencyHtml } from '../src/cloud/ui/delinquency.mjs';
import { contractsHtml } from '../src/cloud/ui/contracts.mjs';
import { documentsHtml } from '../src/cloud/ui/documents.mjs';
import { alertsHtml } from '../src/cloud/ui/alerts.mjs';
import { maintenanceHtml } from '../src/cloud/ui/maintenance.mjs';

const admin={id:'USR-1',role:'admin',active:true};
const now='2026-09-29T12:00:00.000Z';
const snapshot={
  customers:[{id:'CUS-1',name:'George',document:'123',active:1}],
  vehicles:[{id:'VEI-1',model:'Onix',plate:'ABC1D23',dailyRate:100,mileage:1000,availability:'disponivel'}],
  rentals:[{id:'LOC-1',customerId:'CUS-1',vehicleId:'VEI-1',pickupAt:'2026-09-28T10:00:00.000Z',returnAt:'2026-09-30T10:00:00.000Z',periodMode:'fixed',status:'reserva',dailyRate:100,total:200,billingMode:'total',paymentStatus:'aberto',version:1,payments:[]}],
  inspections:[{id:'VIS-1',rentalId:'LOC-1',vehicleId:'VEI-1',kind:'pickup',status:'completed',mileage:1000,fuelLevel:'3/4',notes:'ok',damages:[],checklist:[{id:'documents',label:'Documentos',done:true}],completedAt:now}],
  expenses:[{id:'DES-1',description:'Lavagem',category:'Operação',amount:50,paid:1,dueAt:'2026-09-29',version:1}],
  ledger:[{id:'FIN-1',kind:'receivable',rentalId:'LOC-1',vehicleId:'VEI-1',amount:200,paidAmount:100,status:'partial',dueAt:'2026-09-28'},{id:'FIN-2',kind:'expense',expenseId:'DES-1',amount:50,paidAmount:50,status:'paid'}],
  billingPlans:[{id:'COB-1',rentalId:'LOC-1',frequency:'daily',amount:100,occurrences:2,active:1}],
  billingInstallments:[{id:'PAR-1',planId:'COB-1',rentalId:'LOC-1',customerId:'CUS-1',vehicleId:'VEI-1',sequence:1,dueAt:'2026-09-28',amount:100,paidAmount:0,status:'open',finePercent:2,interestMonthlyPercent:1}],
  billingPayments:[],collectionActions:[],
  contractTemplates:[{id:'TPL-1',name:'Padrão',body:'Contrato {{locacao.id}}',active:1,isDefault:1,version:1,templateVersion:1}],
  issuedContracts:[{id:'CTR-1',rentalId:'LOC-1',templateId:'TPL-1',templateName:'Padrão',templateVersion:1,renderedText:'Contrato LOC-1',createdAt:now}],
  attachments:[{id:'ATT-1',entityType:'inspection',entityId:'VIS-1',mimeType:'image/jpeg',sizeBytes:100}],
  alertState:{},maintenance:[{id:'MNT-1',vehicleId:'VEI-1',type:'Óleo',dueAt:'2026-09-20',status:'scheduled',costEstimate:150,version:1}],settings:{}
};

test('rentals mobile exposes creation, lifecycle, continuous close and payment actions in the applicable states',()=>{
  const reservation=rentalsHtml(snapshot,admin);assert.match(reservation,/Nova locação/);assert.match(reservation,/data-rental-advance/);assert.match(reservation,/data-rental-pay/);assert.match(reservation,/periodMode/);
  const continuous=structuredClone(snapshot);continuous.rentals=[{...continuous.rentals[0],id:'LOC-CONT',periodMode:'continuous',returnAt:null,status:'em_uso',billingMode:'daily',continuousClosedAt:null}];
  assert.match(rentalsHtml(continuous,admin),/data-rental-close/);
});
test('inspection mobile exposes complete checklist, multi-photo and PDF/history',()=>{const html=inspectionsHtml(snapshot,admin);assert.match(html,/checklist/);assert.match(html,/multiple/);assert.match(html,/data-inspection-pdf/);assert.match(html,/Avarias/);});
test('finance and billing expose desktop-equivalent receivables, expenses and plans',()=>{assert.match(financeHtml(snapshot,admin),/Nova despesa/);assert.match(financeHtml(snapshot,admin),/Caixa líquido/);assert.match(billingHtml(snapshot,admin),/Novo plano/);assert.match(billingHtml(snapshot,admin),/Receber parcela/);});
test('delinquency exposes aging and collection action',()=>{const html=delinquencyHtml(snapshot,admin,new Date('2026-09-29T12:00:00Z'));assert.match(html,/Inadimplência/);assert.match(html,/data-collection-action/);assert.match(html,/dias em atraso/);});
test('contracts and documents expose template issuance and persisted PDFs',()=>{const contracts=contractsHtml(snapshot,admin),docs=documentsHtml(snapshot,admin);assert.match(contracts,/Novo modelo/);assert.match(contracts,/data-contract-issue/);assert.match(docs,/Contrato emitido/);assert.match(docs,/Vistoria/);});
test('alerts and maintenance expose operational actions',()=>{assert.match(alertsHtml(snapshot,admin),/data-alert-ack/);const maintenance=maintenanceHtml(snapshot,admin);assert.match(maintenance,/Agendar manutenção/);assert.match(maintenance,/data-maintenance-start/);});
