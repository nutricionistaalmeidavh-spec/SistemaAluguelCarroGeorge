import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mobileNavigationGroups,mobileNavHtml,mobileLabelFor,navHtml } from '../src/cloud/ui/common.mjs';

const admin={id:'USR',role:'admin',active:true};

test('central mobile segue a ordem operacional aprovada',()=>{
  const groups=mobileNavigationGroups(admin);
  assert.deepEqual(groups.map(group=>group.items.map(item=>item.id)),[
    ['overview','rentals','customers','billing','inspections','finance'],
    ['finance','delinquency','vehicles','maintenance'],
    ['contracts','documents','alerts','administration']
  ]);
  assert.equal(groups[0].items.at(-1).mobileLabel,'Dar baixa');
  assert.equal(mobileLabelFor('inspections','Vistorias'),'Vistoria');
  assert.equal(mobileLabelFor('administration','Administração'),'Configurações');
});

test('central mobile mantém data-cloud-nav e atalho de Dar baixa',()=>{
  const html=mobileNavHtml(admin,'rentals');
  for(const id of ['overview','rentals','customers','billing','inspections','finance','delinquency','vehicles','maintenance','contracts','documents','alerts','administration']){
    assert.match(html,new RegExp(`data-cloud-nav="${id}"`));
  }
  assert.match(html,/data-cloud-nav="finance" data-cloud-shortcut="payment"[^>]*>\s*<span>Dar baixa<\/span>/);
  assert.match(html,/data-cloud-nav="finance"(?! data-cloud-shortcut="payment")[^>]*>\s*<span>Financeiro<\/span>/);
  assert.match(html,/Configurações/);
  assert.match(html,/Vistoria/);
  assert.match(html,/aria-current="page"/);
});

test('nav mobile usa botão único e central de módulos em vez de scroll horizontal',async()=>{
  const html=navHtml(admin,'rentals');
  const styles=await readFile(new URL('../styles-payments.css',import.meta.url),'utf8');
  assert.match(html,/id="cloud-mobile-menu"/);
  assert.match(html,/data-test="mobile-module-central"/);
  assert.match(html,/Central de módulos/);
  assert.match(html,/>Locações</);
  assert.match(styles,/\.mobile-appbar\{/);
  assert.match(styles,/\.mobile-module-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles,/@media\(max-width:900px\)[\s\S]*?\.desktop-nav-list\{display:none\}/);
  assert.match(styles,/@media\(max-width:900px\)[\s\S]*?\.sidebar nav\{display:block;[\s\S]*?overflow:visible\}/);
});
