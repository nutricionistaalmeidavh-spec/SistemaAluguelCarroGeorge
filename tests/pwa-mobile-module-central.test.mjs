import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mobileNavigationGroups,mobileNavHtml,mobileLabelFor,navHtml } from '../src/cloud/ui/common.mjs';

const admin={id:'USR',role:'admin',active:true};

test('menu mobile prioriza trabalho principal e deixa capacidades avançadas em Mais',()=>{
  const groups=mobileNavigationGroups(admin);
  assert.deepEqual(groups.map(group=>group.items.map(item=>item.id)),[
    ['overview','rentals','customers','vehicles','finance'],
    ['inspections','billing','delinquency','maintenance','contracts','documents','alerts','administration']
  ]);
  const ids=groups.flatMap(group=>group.items.map(item=>item.id));
  assert.equal(new Set(ids).size,ids.length,'nenhum módulo pode aparecer em dois grupos');
  assert.equal(mobileLabelFor('inspections','Vistorias'),'Vistoria');
  assert.equal(mobileLabelFor('administration','Configurações'),'Configurações');
});

test('menu mobile mantém todas as capacidades sem atalho duplicado de pagamento',()=>{
  const html=mobileNavHtml(admin,'billing');
  for(const id of ['overview','rentals','customers','vehicles','finance','inspections','billing','delinquency','maintenance','contracts','documents','alerts','administration']){
    assert.match(html,new RegExp(`data-cloud-nav="${id}"`));
  }
  assert.doesNotMatch(html,/data-cloud-shortcut="payment"/);
  assert.doesNotMatch(html,/>Dar baixa<\/span>/);
  assert.match(html,/Configurações/);
  assert.match(html,/Vistoria/);
  assert.match(html,/aria-current="page"/);
});

test('nav mobile usa botão único e menu em vez de scroll horizontal',async()=>{
  const html=navHtml(admin,'rentals');
  const styles=await readFile(new URL('../styles-payments.css',import.meta.url),'utf8');
  assert.match(html,/id="cloud-mobile-menu"/);
  assert.match(html,/data-test="mobile-module-central"/);
  assert.match(html,/<h2>Menu<\/h2>/);
  assert.match(html,/>Locações</);
  assert.match(styles,/\.mobile-appbar\{/);
  assert.match(styles,/\.mobile-module-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles,/@media\(max-width:900px\)[\s\S]*?\.desktop-nav-list\{display:none\}/);
  assert.match(styles,/@media\(max-width:900px\)[\s\S]*?\.sidebar nav\{display:block;[\s\S]*?overflow:visible\}/);
});
