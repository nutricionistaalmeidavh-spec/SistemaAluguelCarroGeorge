'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {launchLocadora}=require('./fixtures/locadora-electron.cjs');
const password=process.env.LOCADORA_QA_ADMIN_PASSWORD;
async function login(page){assert.ok(password,'LOCADORA_QA_ADMIN_PASSWORD is required');await page.locator('input[name="username"]').fill('admin');await page.locator('input[name="password"]').fill(password);await page.getByRole('button',{name:'Entrar'}).click();await page.locator('.session').getByText('Administrador').waitFor();}
async function createCustomer(page,name='George E2E'){await page.locator('[data-nav="clientes"]').click();await page.locator('#new-customer').click();const f=page.locator('#customer-form');await f.locator('[name="name"]').fill(name);await f.locator('[name="document"]').fill('12345678900');await f.locator('[name="phone"]').fill('16999999999');await f.getByRole('button',{name:'Salvar'}).click();await page.getByText(name).waitFor();}
async function createVehicle(page,model='Onix E2E',plate='E2E1A23'){await page.locator('[data-nav="frota"]').click();await page.locator('#new-vehicle').click();const f=page.locator('#vehicle-form');await f.locator('[name="model"]').fill(model);await f.locator('[name="plate"]').fill(plate);await f.locator('[name="dailyRate"]').fill('100');await f.getByRole('button',{name:'Salvar'}).click();await page.getByText(model).waitFor();}

test('Electron: cobrança diária usa um único fluxo Receber pagamento',async()=>{
 const ctx=await launchLocadora();try{const p=ctx.page;await login(p);await createCustomer(p);await createVehicle(p);
  await p.locator('[data-nav="reservas"]').click();await p.locator('#new-rental').click();const f=p.locator('#rental-form');
  await f.locator('[name="pickupAt"]').fill('01/10/2026 10:00');await f.locator('[name="returnAt"]').fill('06/10/2026 10:00');
  await f.locator('details.rental-advanced summary').click();await f.locator('[name="billingMode"]').selectOption('daily');await f.getByRole('button',{name:'Salvar locação'}).click();
  const pay=p.locator('[data-rental-payment]').first();await pay.waitFor();assert.equal(await p.locator('[data-daily-control]').count(),0);
  await pay.click();await p.getByRole('heading',{name:'Receber pagamento'}).waitFor();const form=p.locator('#daily-payment-form');assert.equal(await form.locator('tbody tr').count(),5);assert.ok(await form.locator('[data-payment-quick]').count()>=2);
  await form.locator('button.primary').click();await p.getByText('Recebimento registrado.').waitFor();
  await p.locator('[data-rental-payment]').first().click();const form2=p.locator('#daily-payment-form');await form2.waitFor();await form2.locator('[name="amount"]').fill('250');await form2.locator('button.primary').click();await p.getByText('Recebimento registrado.').waitFor();
  await p.locator('[data-rental-payment]').first().click();const form3=p.locator('#daily-payment-form');await form3.waitFor();const received=await form3.locator('.cards article').filter({hasText:'Já recebido'}).innerText();assert.match(received,/350,00/);
 }finally{await ctx.close();}
});

test('Electron: locação contínua força cobrança diária sem expor escolha técnica',async()=>{
 const ctx=await launchLocadora();try{const p=ctx.page;await login(p);await createCustomer(p,'George Contínuo');await createVehicle(p,'Onix Contínuo','CNT1A23');
  await p.locator('[data-nav="reservas"]').click();await p.locator('#new-rental').click();const f=p.locator('#rental-form');await f.locator('[name="pickupAt"]').fill('01/10/2026 10:00');await f.locator('[name="periodMode"]').selectOption('continuous');assert.equal(await f.locator('[name="returnAt"]').isDisabled(),true);await f.getByRole('button',{name:'Salvar locação'}).click();await p.getByText('Locação contínua criada.').waitFor();await p.getByText('Contínua').first().waitFor();await p.locator('[data-rental-payment]').first().click();await p.locator('#daily-payment-form').waitFor();
 }finally{await ctx.close();}
});
