'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {launchCloudPwa}=require('./fixtures/cloud-pwa.cjs');

function seedBase(fx,{rentalId,billingMode,total=300,dailyRate=100}){
  const {db,installationId}=fx,now='2026-10-04T12:00:00.000Z';
  db.sqlite.prepare('INSERT INTO customers (id,installation_id,name,phone,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run('CUS-PAY',installationId,'Cliente Pagamento','16999999999',1,now,now);
  db.sqlite.prepare('INSERT INTO vehicles (id,installation_id,model,plate,daily_rate,availability,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run('VEI-PAY',installationId,'Carro Pagamento','PAY1A23',dailyRate,'locado',now,now);
  db.sqlite.prepare('INSERT INTO rentals (id,installation_id,vehicle_id,customer_id,pickup_at,return_at,period_mode,status,priority,daily_rate,days,total,billing_mode,payment_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(rentalId,installationId,'VEI-PAY','CUS-PAY','2026-10-01T12:00:00.000Z','2026-10-04T12:00:00.000Z','fixed','em_uso','Média',dailyRate,3,total,billingMode,'aberto',now,now);
  db.sqlite.prepare('INSERT INTO ledger (id,installation_id,kind,billing_purpose,rental_id,vehicle_id,description,amount,paid_amount,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('FIN-'+rentalId,installationId,'receivable','rental',rentalId,'VEI-PAY','Locação '+rentalId,total,0,'open',now,now);
}
function seedDaily(fx){
  const {db,installationId}=fx,now='2026-10-04T12:00:00.000Z';
  db.sqlite.prepare('INSERT INTO billing_plans (id,installation_id,rental_id,customer_id,vehicle_id,purpose,frequency,amount,occurrences,first_due_at,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('PLN-PAY',installationId,'LOC-DAILY','CUS-PAY','VEI-PAY','rental_schedule','daily',100,3,'2026-10-01',1,now,now);
  for(let i=1;i<=3;i++)db.sqlite.prepare('INSERT INTO billing_installments (id,installation_id,plan_id,rental_id,customer_id,vehicle_id,sequence,due_at,amount,paid_amount,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('PAR-PAY-'+i,installationId,'PLN-PAY','LOC-DAILY','CUS-PAY','VEI-PAY',i,'2026-10-0'+i,100,0,'open',now,now);
}
async function openPayment(fx){
  const {page}=fx;await fx.login();await fx.openModule('rentals');
  const button=page.locator('[data-payment-rental]').first();await button.waitFor({state:'visible'});await button.click();
  const form=page.locator('[data-payment-form]');await form.waitFor({state:'visible'});return form;
}
async function waitSynced(page){
  await page.getByText('Recebimento sincronizado.').waitFor({timeout:15000});
  await page.waitForFunction(()=>document.querySelector('#cloud-sync-state')?.textContent==='Sincronizado',null,{timeout:15000});
}

test('PWA baixa recebimento total pela locação',async t=>{
  const fx=await launchCloudPwa();t.after(()=>fx.close());
  seedBase(fx,{rentalId:'LOC-TOTAL',billingMode:'total'});
  const form=await openPayment(fx);await form.getByRole('button',{name:'Confirmar recebimento',exact:true}).click();await waitSynced(fx.page);
  const row=fx.db.sqlite.prepare('SELECT amount,method FROM rental_payments WHERE installation_id=? AND rental_id=?').get(fx.installationId,'LOC-TOTAL');
  assert.equal(Number(row?.amount),100);assert.equal(row?.method,'PIX');
});

test('PWA baixa diária pela locação quando existe agenda de cobrança',async t=>{
  const fx=await launchCloudPwa();t.after(()=>fx.close());
  seedBase(fx,{rentalId:'LOC-DAILY',billingMode:'daily'});seedDaily(fx);
  const form=await openPayment(fx);await form.getByRole('button',{name:'Confirmar recebimento',exact:true}).click();await waitSynced(fx.page);
  const row=fx.db.sqlite.prepare('SELECT installment_id,amount,method FROM billing_payments WHERE installation_id=? ORDER BY created_at LIMIT 1').get(fx.installationId);
  assert.equal(row?.installment_id,'PAR-PAY-1');assert.equal(Number(row?.amount),100);assert.equal(row?.method,'PIX');
});

test('PWA não duplica recebimento quando o formulário é enviado duas vezes',async t=>{
  const fx=await launchCloudPwa();t.after(()=>fx.close());
  seedBase(fx,{rentalId:'LOC-DOUBLE',billingMode:'total'});
  const form=await openPayment(fx);
  await form.evaluate(node=>{node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  await waitSynced(fx.page);
  assert.equal(fx.db.scalar('SELECT COUNT(*) FROM rental_payments WHERE installation_id=? AND rental_id=?',fx.installationId,'LOC-DOUBLE'),1);
});
