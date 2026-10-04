'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {launchCloudPwa}=require('./fixtures/cloud-pwa.cjs');

const OUT=path.resolve(__dirname,'..','..','qa-artifacts','pwa-critical-flows');
async function shot(page,name){fs.mkdirSync(OUT,{recursive:true});await page.waitForTimeout(100);await page.screenshot({path:path.join(OUT,name),fullPage:false});}

async function createCustomerVehicleAndRental(fx){
  const {page,db,installationId}=fx;
  await fx.openModule('customers');
  await page.locator('[data-customer-editor] summary').click();
  const customer=page.locator('#cloud-customer-form');
  await customer.locator('input[name="name"]').fill('Cliente Ciclo PWA');
  await customer.locator('input[name="document"]').fill('12345678900');
  await customer.locator('input[name="phone"]').fill('16999990000');
  await customer.locator('button.primary').click();
  await page.getByText('Cliente salvo e sincronizado.').waitFor();

  await fx.openModule('vehicles');
  await page.locator('[data-vehicle-editor] summary').click();
  const vehicle=page.locator('#cloud-vehicle-form');
  await vehicle.locator('input[name="model"]').fill('Onix Ciclo PWA');
  await vehicle.locator('input[name="plate"]').fill('PWA1A23');
  await vehicle.locator('input[name="dailyRate"]').fill('120');
  await vehicle.locator('button.primary').click();
  await page.getByText('Veículo salvo e sincronizado.').waitFor();

  const customerId=db.sqlite.prepare('SELECT id FROM customers WHERE installation_id=? AND name=?').get(installationId,'Cliente Ciclo PWA').id;
  const vehicleId=db.sqlite.prepare('SELECT id FROM vehicles WHERE installation_id=? AND plate=?').get(installationId,'PWA1A23').id;

  await fx.openModule('rentals');
  await page.locator('[data-rental-editor] > summary').click();
  const rental=page.locator('#cloud-rental-form');
  await rental.locator('select[name="customerId"]').selectOption(customerId);
  await rental.locator('select[name="vehicleId"]').selectOption(vehicleId);
  await rental.locator('input[name="pickupAt"]').fill('10/10/2030 10:00');
  await rental.locator('input[name="returnAt"]').fill('12/10/2030 10:00');
  await rental.locator('input[name="dailyRate"]').fill('120');
  await rental.locator('select[name="billingMode"]').selectOption('total');
  await rental.getByRole('button',{name:'Criar locação',exact:true}).click();
  await page.getByText('Locação salva e sincronizada.').waitFor();
  return db.sqlite.prepare('SELECT id FROM rentals WHERE installation_id=? AND customer_id=? ORDER BY created_at DESC LIMIT 1').get(installationId,customerId).id;
}

async function completeInspection(page,{mileage,name}){
  const form=page.locator('#cloud-inspection-form');await form.waitFor();
  await form.locator('input[name="mileage"]').fill(String(mileage));
  await form.locator('select[name="fuelLevel"]').selectOption('3/4');
  await form.locator('input[name="photo"]').setInputFiles({name,mimeType:'image/png',buffer:Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4])});
  await form.locator('button.primary').click();
}

test('PWA fecha o ciclo operacional completo da locação sem depender do desktop',async t=>{
  const fx=await launchCloudPwa();t.after(()=>fx.close());const {page,db,installationId}=fx;await fx.login();
  const rentalId=await createCustomerVehicleAndRental(fx);

  await fx.openModule('rentals');
  await page.locator('[data-rental-inspection="'+rentalId+'"][data-kind="pickup"]').click();
  await page.getByRole('heading',{name:'Vistoria de retirada'}).waitFor();
  await shot(page,'01-retirada.png');
  await completeInspection(page,{mileage:12345,name:'retirada.png'});
  await page.getByText('Retirada concluída. Veículo em uso.').waitFor({timeout:15000});
  assert.equal(db.sqlite.prepare('SELECT status FROM rentals WHERE installation_id=? AND id=?').get(installationId,rentalId).status,'em_uso');

  const pay=page.locator('[data-payment-rental="'+rentalId+'"]');await pay.waitFor();await pay.click();
  const payment=page.locator('[data-payment-form]');await payment.waitFor();
  await payment.getByRole('button',{name:'Quitar saldo',exact:true}).click();
  await shot(page,'02-recebimento.png');
  await payment.getByRole('button',{name:'Confirmar recebimento',exact:true}).click();
  await page.getByText('Recebimento sincronizado.').waitFor({timeout:15000});
  assert.equal(db.sqlite.prepare('SELECT payment_status FROM rentals WHERE installation_id=? AND id=?').get(installationId,rentalId).payment_status,'pago');

  const giveBack=page.locator('[data-rental-inspection="'+rentalId+'"][data-kind="return"]');await giveBack.waitFor();await giveBack.click();
  await page.getByRole('heading',{name:'Vistoria de devolução'}).waitFor();
  await shot(page,'03-devolucao.png');
  await completeInspection(page,{mileage:12420,name:'devolucao.png'});
  await page.getByText('Devolução concluída. Locação encerrada.').waitFor({timeout:15000});

  const finalRental=db.sqlite.prepare('SELECT status,payment_status FROM rentals WHERE installation_id=? AND id=?').get(installationId,rentalId);
  assert.equal(finalRental.status,'devolucao');
  assert.equal(finalRental.payment_status,'pago');
  assert.equal(db.scalar('SELECT COUNT(*) FROM inspections WHERE installation_id=? AND rental_id=?',installationId,rentalId),2);
  assert.equal(db.scalar('SELECT COUNT(*) FROM attachments WHERE installation_id=? AND entity_type=?',installationId,'inspection'),2);
  const finalCard=page.locator('.cloud-entity-card').filter({hasText:'Cliente Ciclo PWA'}).first();
  await finalCard.getByText(/Finalizada/).waitFor();
  await shot(page,'04-finalizada.png');
});
