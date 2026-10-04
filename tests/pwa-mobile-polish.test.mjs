import test from 'node:test';
import assert from 'node:assert/strict';
import { rentalsHtml } from '../src/cloud/ui/rentals.mjs';
import { inspectionsHtml } from '../src/cloud/ui/inspections.mjs';

const admin={id:'USR-QA',role:'admin',active:true};
const snapshot={
  customers:[{id:'CUS-1',name:'Cliente QA'}],
  vehicles:[{id:'VEI-1',model:'Onix',plate:'ABC1D23',dailyRate:100,availability:'disponivel'}],
  rentals:[],inspections:[],attachments:[]
};

test('PWA mantém Nova locação recolhível como os demais cadastros',()=>{
  const html=rentalsHtml(snapshot,admin);
  assert.match(html,/data-rental-editor/);
  assert.match(html,/<summary>\+ Nova locação<\/summary>/);
  assert.match(html,/<details[^>]*cloud-create-panel[^>]*data-rental-editor/);
  assert.doesNotMatch(html,/data-rental-editor[^>]*\sopen(?:\s|>)/);
});

test('PWA substitui o texto nativo do navegador no seletor de fotos por copy em português',()=>{
  const html=inspectionsHtml(snapshot,admin,{inspectionPreset:{kind:'pickup'}});
  assert.match(html,/class="file-button"[^>]*>Selecionar fotos/);
  assert.match(html,/data-photo-selection/);
  assert.match(html,/Nenhuma foto selecionada/);
  assert.match(html,/name="photo"/);
});
