'use strict';
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const {launchCloudPwa}=require('./fixtures/cloud-pwa.cjs');
const {launchLocadora}=require('./fixtures/locadora-electron.cjs');

const PWA_MODULES=[
  ['overview','visao-geral'],
  ['customers','clientes'],
  ['vehicles','frota'],
  ['rentals','locacoes'],
  ['inspections','vistorias'],
  ['finance','financeiro'],
  ['billing','cobrancas'],
  ['delinquency','inadimplencia'],
  ['contracts','contratos'],
  ['documents','documentos'],
  ['alerts','alertas'],
  ['maintenance','manutencao'],
  ['administration','administracao']
];

const DESKTOP_MODULES=[
  ['dashboard','visao-geral'],
  ['clientes','clientes'],
  ['frota','frota'],
  ['reservas','locacoes'],
  ['vistorias','vistorias'],
  ['financeiro','financeiro'],
  ['cobrancas','cobrancas'],
  ['inadimplencia','inadimplencia'],
  ['contratos','contratos'],
  ['documentos','documentos'],
  ['alertas','alertas'],
  ['manutencao','manutencao'],
  ['auditoria','administracao-auditoria'],
  ['backup','administracao-backup']
];

function outputDir(name){const out=path.resolve(__dirname,'..','..','qa-artifacts',name);fs.mkdirSync(out,{recursive:true});return out;}

async function loginDesktop(page){
  await page.locator('#login input[name="username"]').fill('admin');
  await page.locator('#login input[name="password"]').fill(process.env.LOCADORA_QA_ADMIN_PASSWORD||'1234');
  await page.locator('#login button').click();
  await page.locator('[data-nav="dashboard"]').waitFor();
}

test('captura screenshots reais do PWA para comparativo visual Desktop x Web',async t=>{
  const fx=await launchCloudPwa();
  t.after(()=>fx.close());
  const {page}=fx,out=outputDir('pwa-visual-parity');
  await fx.login();
  for(const [id,name] of PWA_MODULES){
    await page.locator(`[data-cloud-nav="${id}"]`).click();
    await page.locator(`[data-cloud-nav="${id}"].active`).waitFor();
    await page.waitForTimeout(350);
    await page.screenshot({path:path.join(out,`${name}.png`),fullPage:true});
  }
});

test('captura screenshots reais do Desktop para comparativo visual Desktop x Web',async t=>{
  const fx=await launchLocadora();
  t.after(()=>fx.close());
  const {page}=fx,out=outputDir('desktop-visual-parity');
  await loginDesktop(page);
  for(const [id,name] of DESKTOP_MODULES){
    await page.locator(`[data-nav="${id}"]`).click();
    await page.locator(`[data-nav="${id}"].active`).waitFor();
    await page.waitForTimeout(250);
    await page.screenshot({path:path.join(out,`${name}.png`),fullPage:true});
  }
});
