'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {launchLocadora}=require('./fixtures/locadora-electron.cjs');
const password=process.env.LOCADORA_QA_ADMIN_PASSWORD;

async function login(page){
  assert.ok(password,'LOCADORA_QA_ADMIN_PASSWORD is required');
  await page.locator('input[name="username"]').fill('admin');
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button',{name:'Entrar'}).click();
  await page.locator('.session').getByText('Administrador').waitFor();
}
async function completeInspection(page,{mileage}){
  const form=page.locator('#inspection-form');await form.waitFor();
  const checks=form.locator('input[type="checkbox"]');for(let i=0;i<await checks.count();i++)await checks.nth(i).check();
  await form.locator('[name="mileage"]').fill(String(mileage));
  await form.locator('[name="fuelLevel"]').selectOption('3/4');
  await form.locator('[name="photos"]').setInputFiles({name:'qa.jpg',mimeType:'image/jpeg',buffer:Buffer.from([255,216,255,217])});
  await form.locator('button.primary').click();
}

test('jornada intuitiva: locação → retirada → pagamento → devolução sem módulos paralelos',async()=>{
  const ctx=await launchLocadora();
  try{
    const p=ctx.page;await login(p);
    await p.locator('[data-nav="clientes"]').click();await p.locator('#new-customer').click();
    const customer=p.locator('#customer-form');await customer.locator('[name="name"]').fill('Cliente Jornada');await customer.locator('[name="document"]').fill('12345678900');await customer.locator('[name="phone"]').fill('16999990000');await customer.locator('button.primary').click();await p.getByText('Cliente Jornada').waitFor();

    await p.locator('[data-nav="frota"]').click();await p.locator('#new-vehicle').click();
    const vehicle=p.locator('#vehicle-form');await vehicle.locator('[name="model"]').fill('Onix Jornada');await vehicle.locator('[name="plate"]').fill('JOR1A23');await vehicle.locator('[name="dailyRate"]').fill('120');await vehicle.locator('button.primary').click();await p.getByText('Onix Jornada').waitFor();

    await p.locator('[data-nav="reservas"]').click();
    const newRental=p.locator('#new-rental');await newRental.click();await p.getByRole('heading',{name:'Nova locação'}).waitFor();await p.keyboard.press('Escape');assert.equal(await p.locator('#rental-form').count(),0,'Escape deve fechar o modal');assert.equal(await newRental.evaluate(node=>document.activeElement===node),true,'foco deve retornar ao gatilho');await newRental.click();
    const rental=p.locator('#rental-form');await rental.locator('[name="pickupAt"]').fill('10/10/2030 10:00');await rental.locator('[name="returnAt"]').fill('12/10/2030 10:00');await rental.getByRole('button',{name:'Salvar locação'}).click();
    const row=p.locator('tbody tr').filter({hasText:'Cliente Jornada'}).first();await row.waitFor();
    assert.doesNotMatch(await row.innerText(),/LOC-[0-9a-f-]{20,}/i,'UUID não deve ser exibido ao operador');

    await row.getByRole('button',{name:'Fazer retirada'}).click();
    await p.getByRole('heading',{name:'Vistoria de retirada'}).waitFor();
    await completeInspection(p,{mileage:12345});
    await p.getByText('Retirada concluída. Veículo em uso.').waitFor();
    const inUse=p.locator('tbody tr').filter({hasText:'Cliente Jornada'}).first();await inUse.getByText('Em uso',{exact:true}).waitFor();

    await inUse.getByRole('button',{name:'Receber pagamento'}).click();
    await p.getByRole('heading',{name:'Receber pagamento'}).waitFor();
    await p.locator('#rental-payment-form button.primary').click();
    await p.getByText('Recebimento registrado.').waitFor();

    const returnRow=p.locator('tbody tr').filter({hasText:'Cliente Jornada'}).first();
    await returnRow.getByRole('button',{name:'Registrar devolução'}).click();
    await p.getByRole('heading',{name:'Vistoria de devolução'}).waitFor();
    await completeInspection(p,{mileage:12420});
    await p.getByText('Devolução concluída. Locação finalizada.').waitFor();
    await p.locator('tbody tr').filter({hasText:'Cliente Jornada'}).first().getByText('Finalizada',{exact:true}).waitFor();

    for(const id of ['vistorias','cobrancas','inadimplencia','manutencao','contratos','documentos','alertas'])assert.equal(await p.locator(`[data-nav="${id}"]`).count(),0);
  }finally{await ctx.close();}
});
