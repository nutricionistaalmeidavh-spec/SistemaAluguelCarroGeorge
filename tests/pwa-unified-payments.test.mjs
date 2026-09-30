import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentPlanForRental, paymentTargetForLedger } from '../src/cloud/ui/payment-flow.mjs';
import { rentalsHtml } from '../src/cloud/ui/rentals.mjs';
import { financeHtml } from '../src/cloud/ui/finance.mjs';
import { billingHtml } from '../src/cloud/ui/billing.mjs';

const admin={id:'USR-A',role:'admin',active:true};

function snapshot(){
  return {
    customers:[{id:'CUS-1',name:'George Cliente'}],
    vehicles:[{id:'VEI-1',model:'Onix',plate:'ABC1D23',availability:'disponivel'}],
    rentals:[
      {id:'LOC-D',customerId:'CUS-1',vehicleId:'VEI-1',status:'em_uso',periodMode:'fixed',pickupAt:'2026-09-01',returnAt:'2026-09-04',dailyRate:100,total:300,billingMode:'daily',payments:[]},
      {id:'LOC-T',customerId:'CUS-1',vehicleId:'VEI-1',status:'em_uso',periodMode:'fixed',pickupAt:'2026-09-10',returnAt:'2026-09-12',dailyRate:250,total:500,billingMode:'total',payments:[{id:'PAG-1',amount:100}]},
      {id:'LOC-LEG',customerId:'CUS-1',vehicleId:'VEI-1',status:'em_uso',periodMode:'fixed',pickupAt:'2026-08-01',returnAt:'2026-08-03',dailyRate:80,total:160,billingMode:'daily',payments:[]}
    ],
    billingInstallments:[
      {id:'PAR-1',rentalId:'LOC-D',sequence:1,dueAt:'2026-09-01',amount:100,paidAmount:100,status:'paid'},
      {id:'PAR-2',rentalId:'LOC-D',sequence:2,dueAt:'2026-09-02',amount:100,paidAmount:0,status:'open'},
      {id:'PAR-3',rentalId:'LOC-D',sequence:3,dueAt:'2026-09-03',amount:100,paidAmount:50,status:'partial'}
    ],
    billingPlans:[],billingPayments:[],expenses:[],
    ledger:[
      {id:'FIN-PAR-2',kind:'billing_receivable',rentalId:'LOC-D',installmentId:'PAR-2',description:'Diária 2',amount:100,paidAmount:0,status:'open',dueAt:'2026-09-02'},
      {id:'FIN-TOTAL',kind:'receivable',rentalId:'LOC-T',description:'Locação total',amount:500,paidAmount:100,status:'partial',dueAt:'2026-09-12'},
      {id:'FIN-LEG',kind:'receivable',rentalId:'LOC-LEG',description:'Locação antiga',amount:160,paidAmount:0,status:'open',dueAt:'2026-08-03'}
    ]
  };
}

test('baixa pela locação distribui valor entre diárias abertas em ordem',()=>{
  const plan=paymentPlanForRental(snapshot(),'LOC-D',{amount:120,method:'PIX',paidAt:'2026-09-30T15:00:00.000Z'});
  assert.deepEqual(plan.map(item=>({kind:item.kind,installmentId:item.payload.installmentId,amount:item.payload.amount})),[
    {kind:'billing.payment',installmentId:'PAR-2',amount:100},
    {kind:'billing.payment',installmentId:'PAR-3',amount:20}
  ]);
});

test('locação antiga diária sem parcelas usa recebimento direto como fallback',()=>{
  const plan=paymentPlanForRental(snapshot(),'LOC-LEG',{amount:80,method:'Dinheiro',paidAt:'2026-09-30T15:00:00.000Z'});
  assert.equal(plan.length,1);
  assert.equal(plan[0].kind,'rental.payment');
  assert.equal(plan[0].payload.rentalId,'LOC-LEG');
  assert.equal(plan[0].payload.amount,80);
});

test('card do financeiro decide sozinho entre parcela e recebimento direto',()=>{
  const snap=snapshot();
  assert.deepEqual(paymentTargetForLedger(snap,snap.ledger[0]),{kind:'billing.payment',id:'PAR-2',balance:100,rentalId:'LOC-D'});
  assert.deepEqual(paymentTargetForLedger(snap,snap.ledger[1]),{kind:'rental.payment',id:'LOC-T',balance:400,rentalId:'LOC-T'});
  assert.deepEqual(paymentTargetForLedger(snap,snap.ledger[2]),{kind:'rental.payment',id:'LOC-LEG',balance:160,rentalId:'LOC-LEG'});
});

test('Locações, Cobranças e Financeiro expõem Dar baixa sem formulário separado Receber diária',()=>{
  const snap=snapshot();
  const rentals=rentalsHtml(snap,admin);
  const billing=billingHtml(snap,admin);
  const finance=financeHtml(snap,admin);
  assert.match(rentals,/Dar baixa/);
  assert.match(rentals,/data-payment-rental="LOC-D"/);
  assert.match(rentals,/data-payment-rental="LOC-T"/);
  assert.match(billing,/Dar baixa/);
  assert.match(finance,/Dar baixa/);
  assert.doesNotMatch(finance,/Receber diária/);
  assert.doesNotMatch(finance,/cloud-payment-form/);
});
