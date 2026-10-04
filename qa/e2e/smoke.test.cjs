'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {launchLocadora}=require('./fixtures/locadora-electron.cjs');
const password=process.env.LOCADORA_QA_ADMIN_PASSWORD;
async function login(page){assert.ok(password,'LOCADORA_QA_ADMIN_PASSWORD is required');await page.locator('input[name="username"]').fill('admin');await page.locator('input[name="password"]').fill(password);await page.getByRole('button',{name:'Entrar'}).click();await page.locator('.session').getByText('Administrador').waitFor();}
async function openModule(page,id){const target=page.locator(`[data-nav="${id}"]`);if(!(await target.isVisible()))await page.locator('.desktop-nav-more>summary').click();await target.click();}
const visibleModules=['dashboard','reservas','clientes','frota','financeiro','auditoria','backup'];
const contextualOnly=['vistorias','manutencao','cobrancas','inadimplencia','contratos','alertas','documentos'];

test('Electron: navegação expõe tarefas principais e mantém módulos internos fora do menu',async()=>{
 const ctx=await launchLocadora();try{const p=ctx.page;
  await p.locator('input[name="username"]').fill('admin');await p.locator('input[name="password"]').fill('invalid-e2e-value');await p.getByRole('button',{name:'Entrar'}).click();await p.getByText('Usuário ou senha inválidos.').waitFor();
  await login(p);
  for(const id of visibleModules)assert.equal(await p.locator(`[data-nav="${id}"]`).count(),1,id);
  for(const id of contextualOnly)assert.equal(await p.locator(`[data-nav="${id}"]`).count(),0,`${id} deve ser contextual, não item de menu`);
  await p.locator('#cloud-status').waitFor();assert.match(await p.locator('#cloud-status').innerText(),/Nuvem/);
 }finally{await ctx.close();}
});

test('Electron: capacidades avançadas continuam acessíveis pelo contexto correto',async()=>{
 const ctx=await launchLocadora();try{const p=ctx.page;await login(p);
  await p.locator('[data-nav="reservas"]').click();
  for(const label of ['Histórico de vistorias','Contratos','Arquivo de documentos'])assert.equal(await p.getByRole('button',{name:label}).count(),1,label);
  await p.locator('[data-nav="frota"]').click();assert.equal(await p.getByRole('button',{name:'Manutenções'}).count(),1);
  await p.locator('[data-nav="financeiro"]').click();assert.equal(await p.getByRole('button',{name:'Parcelas e planos'}).count(),1);assert.equal(await p.getByRole('button',{name:'Em atraso'}).count(),1);
  await p.locator('[data-nav="dashboard"]').click();assert.equal(await p.getByRole('button',{name:'Todos os alertas'}).count(),1);
  for(const id of visibleModules){await openModule(p,id);assert.ok((await p.locator('#view').innerText()).trim().length>0,id);}
 }finally{await ctx.close();}
});
