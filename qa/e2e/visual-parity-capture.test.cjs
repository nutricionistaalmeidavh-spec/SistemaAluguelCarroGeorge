'use strict';
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const {launchCloudPwa}=require('./fixtures/cloud-pwa.cjs');

const MODULES=[
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

test('captura screenshots reais do PWA para comparativo visual Desktop x Web',async t=>{
  const fx=await launchCloudPwa();
  t.after(()=>fx.close());
  const {page}=fx;
  const out=path.resolve(__dirname,'..','..','qa-artifacts','pwa-visual-parity');
  fs.mkdirSync(out,{recursive:true});
  await fx.login();
  for(const [id,name] of MODULES){
    await page.locator(`[data-cloud-nav="${id}"]`).click();
    await page.locator(`[data-cloud-nav="${id}"].active`).waitFor();
    await page.waitForTimeout(350);
    await page.screenshot({path:path.join(out,`${name}.png`),fullPage:true});
  }
});
