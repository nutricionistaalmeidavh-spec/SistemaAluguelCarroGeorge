'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {launchLocadora}=require('./fixtures/locadora-electron.cjs');
const password=process.env.LOCADORA_QA_ADMIN_PASSWORD;

async function login(page){
  assert.ok(password,'LOCADORA_QA_ADMIN_PASSWORD is required');
  await page.locator('input[name="username"]').fill('admin');
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button',{name:'Entrar'}).click();
  await page.locator('.session').getByText('Administrador').waitFor();
}

async function createCustomer(page,name='George E2E'){
  await page.locator('[data-nav="clientes"]').click();
  await page.locator('#new-customer').click();
  const form=page.locator('#customer-form');
  await form.locator('[name="name"]').fill(name);
  await form.locator('[name="document"]').fill('12345678900');
  await form.locator('[name="phone"]').fill('16999999999');
  await form.getByRole('button',{name:'Salvar'}).click();
  await page.getByText(name).waitFor();
}

async function createVehicle(page,model='Onix E2E',plate='E2E1A23'){
  await page.locator('[data-nav="frota"]').click();
  await page.locator('#new-vehicle').click();
  const form=page.locator('#vehicle-form');
  await form.locator('[name="model"]').fill(model);
  await form.locator('[name="plate"]').fill(plate);
  await form.locator('[name="year"]').fill('2026');
  await form.locator('[name="category"]').fill('Compacto');
  await form.locator('[name="dailyRate"]').fill('100');
  await form.getByRole('button',{name:'Salvar'}).click();
  await page.getByText(model).waitFor();
}

test('Electron: reserva por diária gera cobranças, recebe a próxima e distribui várias',async()=>{
  const ctx=await launchLocadora();
  try{
    const page=ctx.page;
    await login(page);
    await createCustomer(page);
    await createVehicle(page);

    await page.locator('[data-nav="reservas"]').click();
    await page.locator('#new-rental').click();
    const form=page.locator('#rental-form');
    await form.locator('[name="pickupAt"]').fill('2026-10-01T10:00');
    await form.locator('[name="returnAt"]').fill('2026-10-06T10:00');
    await form.locator('[name="billingMode"]').selectOption('daily');
    assert.equal(await form.locator('[name="dailyRate"]').inputValue(),'100');
    await form.getByRole('button',{name:'Salvar reserva'}).click();

    const dailyButton=page.locator('[data-daily-control]').first();
    await dailyButton.waitFor();
    await dailyButton.click();
    await page.getByRole('heading',{name:'Controle de diárias'}).waitFor();
    assert.equal(await page.locator('.modal tbody tr').count(),5);
    await page.getByText('Diária 1',{exact:false}).waitFor();
    await page.locator('#receive-next-daily').click();

    await page.getByRole('heading',{name:'Receber diária'}).waitFor();
    assert.equal(await page.locator('.modal-overlay').count(),1,'recebimento deve substituir o modal anterior');
    const payment=page.locator('#daily-payment-form');
    assert.equal(await payment.locator('[name="amount"]').inputValue(),'100.00');
    await payment.getByRole('button',{name:'Confirmar recebimento'}).click();
    await page.getByText('Diária atualizada.').waitFor();

    await page.locator('[data-daily-control]').first().click();
    await page.getByRole('heading',{name:'Controle de diárias'}).waitFor();
    await page.locator('.modal tbody tr').first().getByText('Pago').waitFor();
    await page.locator('#receive-multiple-daily').click();
    await page.getByRole('heading',{name:'Receber várias diárias'}).waitFor();
    const bulk=page.locator('#daily-bulk-payment-form');
    await bulk.locator('[name="amount"]').fill('250');
    await bulk.getByRole('button',{name:'Confirmar recebimento'}).click();
    await page.getByText('Recebimento distribuído nas diárias.').waitFor();

    await page.locator('[data-daily-control]').first().click();
    await page.getByRole('heading',{name:'Controle de diárias'}).waitFor();
    const rows=page.locator('.modal tbody tr');
    await rows.nth(0).getByText('Pago').waitFor();
    await rows.nth(1).getByText('Pago').waitFor();
    await rows.nth(2).getByText('Pago').waitFor();
    await rows.nth(3).getByText('Parcial').waitFor();
    const received=await page.locator('.modal .cards article').filter({hasText:'Recebido'}).innerText();
    assert.match(received,/350,00/);
  } finally {
    await ctx.close();
  }
});

test('Electron: locação contínua nasce sem devolução e força cobrança diária',async()=>{
  const ctx=await launchLocadora();
  try{
    const page=ctx.page;
    await login(page);
    await createCustomer(page,'George Contínuo');
    await createVehicle(page,'Onix Contínuo','CNT1A23');
    await page.locator('[data-nav="reservas"]').click();
    await page.locator('#new-rental').click();
    const form=page.locator('#rental-form');
    await form.locator('[name="pickupAt"]').fill('2026-10-01T10:00');
    await form.locator('[name="periodMode"]').selectOption('continuous');
    assert.equal(await form.locator('[name="returnAt"]').isDisabled(),true);
    assert.equal(await form.locator('[name="billingMode"]').inputValue(),'daily');
    assert.equal(await form.locator('[name="billingMode"]').isDisabled(),true);
    await form.getByRole('button',{name:'Salvar reserva'}).click();
    await page.getByText('Locação contínua e primeira diária criadas.').waitFor();
    await page.getByText('Contínua').first().waitFor();
    await page.locator('[data-daily-control]').first().click();
    await page.getByRole('heading',{name:'Controle de diárias'}).waitFor();
    assert.equal(await page.locator('.modal tbody tr').count(),1);
  } finally {
    await ctx.close();
  }
});
