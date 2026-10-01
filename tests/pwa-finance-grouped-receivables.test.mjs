import test from 'node:test';
import assert from 'node:assert/strict';
import { groupFinancialReceivables,financeHtml } from '../src/cloud/ui/finance.mjs';

const admin={id:'USR',role:'admin',active:true};

function snapshot(){return{
  users:[],expenses:[],inspections:[],maintenance:[],audit:[],contractTemplates:[],issuedContracts:[],billingPlans:[],billingPayments:[],collectionActions:[],attachments:[],alertState:{},settings:{},
  customers:[{id:'CLI-1',name:'Francisco Rogério de Castro Afonso'}],
  vehicles:[{id:'VEI-1',model:'Fiat Strada',plate:'ABC1D23'}],
  rentals:[{id:'LOC-1',customerId:'CLI-1',vehicleId:'VEI-1',total:300,dailyRate:100,billingMode:'daily',periodMode:'continuous',payments:[]}],
  billingInstallments:[
    {id:'PAR-1',rentalId:'LOC-1',customerId:'CLI-1',vehicleId:'VEI-1',sequence:1,dueAt:'2027-04-26',amount:100,paidAmount:0,status:'open',payments:[]},
    {id:'PAR-2',rentalId:'LOC-1',customerId:'CLI-1',vehicleId:'VEI-1',sequence:2,dueAt:'2027-07-03',amount:100,paidAmount:50,status:'partial',payments:[{amount:50,paidAt:'2027-07-01'}]},
    {id:'PAR-3',rentalId:'LOC-1',customerId:'CLI-1',vehicleId:'VEI-1',sequence:3,dueAt:'2027-09-05',amount:100,paidAmount:0,status:'open',payments:[]}
  ],
  ledger:[
    {id:'REC-1',kind:'billing_receivable',rentalId:'LOC-1',installmentId:'PAR-1',description:'Diária #1',amount:100,paidAmount:0,status:'open',dueAt:'2027-04-26'},
    {id:'REC-2',kind:'billing_receivable',rentalId:'LOC-1',installmentId:'PAR-2',description:'Diária #2',amount:100,paidAmount:50,status:'partial',dueAt:'2027-07-03'},
    {id:'REC-3',kind:'billing_receivable',rentalId:'LOC-1',installmentId:'PAR-3',description:'Diária #3',amount:100,paidAmount:0,status:'open',dueAt:'2027-09-05'}
  ]
};}

test('financeiro agrupa recebíveis da mesma locação em um único grupo',()=>{
  const groups=groupFinancialReceivables(snapshot());
  assert.equal(groups.length,1);
  assert.equal(groups[0].rentalId,'LOC-1');
  assert.equal(groups[0].entryCount,3);
  assert.equal(groups[0].openCount,3);
  assert.equal(groups[0].amount,300);
  assert.equal(groups[0].paidAmount,50);
  assert.equal(groups[0].balance,250);
  assert.equal(groups[0].nextDueAt,'2027-04-26');
});

test('financeiro renderiza um card e uma única ação Dar baixa por locação',()=>{
  const html=financeHtml(snapshot(),admin);
  assert.equal((html.match(/data-receivable-rental="LOC-1"/g)||[]).length,1);
  assert.equal((html.match(/data-payment-rental="LOC-1"/g)||[]).length,1);
  assert.match(html,/3 diárias em aberto/);
  assert.match(html,/Saldo R\$\s*250,00/);
  assert.match(html,/Próximo vencimento/);
});
