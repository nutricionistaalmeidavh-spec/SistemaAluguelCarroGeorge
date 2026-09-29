'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {launchCloudPwa}=require('./fixtures/cloud-pwa.cjs');

const OUT=path.resolve('qa-artifacts','pdf-web-screens');
function shot(page,name){return page.screenshot({path:path.join(OUT,`${name}.png`),fullPage:true});}
async function selectFirstValue(page,selector){const value=await page.locator(`${selector} option`).nth(1).getAttribute('value');assert.ok(value,`Nenhuma opção disponível em ${selector}`);await page.locator(selector).selectOption(value);return value;}

async function seed(page){
  await page.locator('[data-cloud-nav="customers"]').click();
  await page.locator('#cloud-customer-form input[name="name"]').fill('Cliente QA PDF');
  await page.locator('#cloud-customer-form input[name="phone"]').fill('16999990000');
  await page.locator('#cloud-customer-form input[name="document"]').fill('12345678909');
  await page.locator('#cloud-customer-form button').click();
  await page.getByText('Cliente salvo e sincronizado.').waitFor();

  await page.locator('[data-cloud-nav="vehicles"]').click();
  await page.locator('#cloud-vehicle-form input[name="model"]').fill('Onix QA PDF');
  await page.locator('#cloud-vehicle-form input[name="plate"]').fill('PDF1A23');
  await page.locator('#cloud-vehicle-form input[name="dailyRate"]').fill('150');
  await page.locator('#cloud-vehicle-form button').click();
  await page.getByText('Veículo salvo e sincronizado.').waitFor();

  await page.locator('[data-cloud-nav="rentals"]').click();
  await selectFirstValue(page,'#cloud-rental-form select[name="customerId"]');
  await selectFirstValue(page,'#cloud-rental-form select[name="vehicleId"]');
  await page.locator('#cloud-rental-form input[name="pickupAt"]').fill('2026-10-10T10:00');
  await page.locator('#cloud-rental-form input[name="returnAt"]').fill('2026-10-12T10:00');
  await page.locator('#cloud-rental-form input[name="dailyRate"]').fill('150');
  await page.locator('#cloud-rental-form select[name="billingMode"]').selectOption('daily');
  await page.locator('#cloud-rental-form button').click();
  await page.getByText('Locação salva e sincronizada.').waitFor();

  await page.locator('[data-cloud-nav="inspections"]').click();
  await selectFirstValue(page,'#cloud-inspection-form select[name="rentalId"]');
  await page.locator('#cloud-inspection-form input[name="mileage"]').fill('12345');
  await page.locator('#cloud-inspection-form textarea[name="notes"]').fill('Vistoria QA PDF');
  await page.locator('#cloud-inspection-form button').click();
  await page.getByText('Vistoria e evidência salvas.').waitFor();
}

test('captura QA de todas as telas web correspondentes',async t=>{
  fs.mkdirSync(OUT,{recursive:true});
  const fx=await launchCloudPwa();t.after(()=>fx.close());
  const {page}=fx;
  await fx.login();
  await seed(page);

  const screens=[
    ['overview','web-01-visao-geral'],
    ['customers','web-02-clientes'],
    ['vehicles','web-03-frota'],
    ['rentals','web-04-locacoes'],
    ['inspections','web-05-vistorias'],
    ['finance','web-06-financeiro']
  ];
  for(const [nav,name] of screens){
    await page.locator(`[data-cloud-nav="${nav}"]`).click();
    await page.locator('#cloud-sync-state').waitFor();
    await shot(page,name);
  }
});
