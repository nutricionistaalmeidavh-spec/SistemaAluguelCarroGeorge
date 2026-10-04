'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {launchCloudPwa}=require('./fixtures/cloud-pwa.cjs');

function seedBase(fx,{rentalId,billingMode,total=300,dailyRate=100}){
  const {db,installationId}=fx,now='2026-10-04T12:00:00.000Z';
  db.sqlite.prepare('INSERT INTO customers (id,installation_id,name,phone,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run('CUS-PAY',installationId,'Cliente Pagamento','16999999999',1,now,now);
  db.sqlite.prepare('INSERT INTO vehicles (id,installation_id,model,plate,daily_rate,availability,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run('VEI-PAY',installationId,'Carro Pagamento','PAY1A23',dailyRate,'disponivel',now,now);
  db.sqlite.prepare(`INSERT INTO rentals (id,installation_id,vehicle_id,customer_id,pickup_at,return_at,period_mode,status,priority,daily_rate,days,total,billing_mode,payment_status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(rentalId,installationId,'VEI-PAY','CUS-PAY','2026-10-01T12:00:00.000Z','2026-10-04T12:00:00.000Z','fixed','em_uso','Média',dailyRate,3,total,billingMode,'aberto',now,now);
}
async function openRentalsAndPay(fx){
  const {page}=fx;
  await fx.login();
  await fx.openModule('rentals');
  const button=page.locator('[data-payment-rental]').first();
  await button.waitFor({state:'visible'});
  await button.click();
  const dialog=page.locator('[data-payment-form]');
  await dialog.waitFor({state:'visible'});
  await dialog.getByRole('button',{name:'Confirmar recebimento',exact:true}).click();
}

test('PWA baixa recebimento total pela locação',async t=>{
  const fx=await launchCloudPwa();t.after(()=>fx.close());
  seedBase(fx,{rentalId:'LOC-TOTAL',billingMode:'total',total:300,dailyRate:100});
  await openRentalsAndPay(fx);
  await fx.page.waitForFunction(()=>!document.querySelector('[data-payment-form]'));
  const row=fx.db.sqlite.prepare('SELECT amount,method FROM rental_payments WHERE installation_id=? AND rental_id=?').get(fx.installationId,'LOC-TOTAL');
  assert.equal(Number(row?.amount),100);
  assert.equal(row?.method,'PIX');
});

test('PWA baixa diária pela locação quando existe agenda de cobrança',async t=>{
  const fx=await launchCloudPwa();t.after(()=>fx.close());
  seedBase(fx,{rentalId:'LOC-DAILY',billingMode:'daily',total:300,dailyRate:100});
  const {db,installationId}=fx,now='2026-10-04T12:00:00.000Z';
  db.sqlite.prepare(`INSERT INTO billing_plans (id,installation_id,rental_id,customer_id,vehicle_id,purpose,frequency,amount,occurrences,first_due_at,active,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('PLN-PAY',installationId,'LOC-DAILY','CUS-PAY','VEI-PAY','rental_schedule','daily',100,3,'2026-10-01',1,now,now);
  for(let i=1;i<=3;i++)db.sqlite.prepare(`INSERT INTO billing_installments (id,installation_id,plan_id,rental_id,customer_id,vehicle_id,sequence,due_at,amount,paid_amount,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(`PAR-PAY-${i}`,installationId,'PLN-PAY','LOC-DAILY','CUS-PAY','VEI-PAY',i,`2026-10-0${i}`,100,0,'open',now,now);
  await openRentalsAndPay(fx);
  await fx.page.waitForFunction(()=>!document.querySelector('[data-payment-form]'));
  const row=db.sqlite.prepare('SELECT installment_id,amount,method FROM billing_payments WHERE installation_id=? ORDER BY created_at LIMIT 1').get(installationId);
  assert.equal(row?.installment_id,'PAR-PAY-1');
  assert.equal(Number(row?.amount),100);
  assert.equal(row?.method,'PIX');
});
