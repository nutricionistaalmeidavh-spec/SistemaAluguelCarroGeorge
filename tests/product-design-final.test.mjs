import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('Mais fica restrito a funções administrativas no Desktop',async()=>{
  const app=await source('src/app.mjs');
  const secondary=app.slice(app.indexOf('const secondaryNav='),app.indexOf('const nav='));
  for(const id of ['vistorias','manutencao','cobrancas','inadimplencia','contratos','alertas','documentos'])
    assert.doesNotMatch(secondary,new RegExp(`\\['${id}'`));
  assert.match(secondary,/auditoria/);
  assert.match(secondary,/backup/);
  assert.match(app,/navigate\(id\)/);
});

test('Vistorias é somente histórico e ações começam em Locações',async()=>{
  const [p1,reservas]=await Promise.all([source('src/ui/p1.mjs'),source('src/ui/reservas.mjs')]);
  const start=p1.indexOf('export function renderVistorias');
  const end=p1.indexOf('export function renderManutencao');
  const view=p1.slice(start,end);
  assert.match(view,/Histórico de vistorias/);
  assert.doesNotMatch(view,/data-new-inspection/);
  assert.doesNotMatch(view,/data-edit-inspection/);
  assert.match(reservas,/Fazer retirada/);
  assert.match(reservas,/Registrar devolução/);
  assert.match(reservas,/openInspectionEditor/);
});

test('Cobrança possui uma única ação conceitual de recebimento',async()=>{
  const [reservas,payments]=await Promise.all([source('src/ui/reservas.mjs'),source('src/ui/payments.mjs')]);
  assert.match(reservas,/Receber pagamento/);
  assert.doesNotMatch(reservas,/data-daily-control/);
  assert.doesNotMatch(payments,/Receber próxima diária/);
  assert.doesNotMatch(payments,/Receber outro valor/);
  assert.doesNotMatch(payments,/Receber várias diárias/);
  assert.match(payments,/data-payment-quick/);
  assert.match(payments,/Quitar saldo/);
});

test('Cadastros Desktop priorizam somente dados essenciais',async()=>{
  const cad=await source('src/ui/cadastros.mjs');
  assert.match(cad,/customer-advanced/);
  assert.match(cad,/vehicle-advanced/);
  assert.match(cad,/Mais informações/);
  assert.match(cad,/Modelo/);
  assert.match(cad,/Placa/);
  assert.match(cad,/Valor da diária/);
});

test('Identificadores e status apresentados ao usuário são amigáveis',async()=>{
  const [common,reservas,p1]=await Promise.all([source('src/ui/common.mjs'),source('src/ui/reservas.mjs'),source('src/ui/p1.mjs')]);
  assert.match(common,/friendlyId/);
  assert.match(common,/rentalStatusLabel/);
  assert.doesNotMatch(reservas,/rentalStatusLabel\(status\).*reserva:'Locação'/);
  assert.doesNotMatch(p1,/>\$\{esc\(r\.status\)\}</);
});

test('Detalhes técnicos ficam dentro de Diagnóstico avançado',async()=>{
  const system=await source('src/ui/system.mjs');
  assert.match(system,/Diagnóstico avançado/);
  const normal=system.slice(system.indexOf('Backup e configurações'),system.indexOf('Diagnóstico avançado'));
  assert.doesNotMatch(normal,/SHA-256|P0\/v2|D1|R2|SQLite/);
});

test('Datas operacionais são explicitamente pt-BR e modal é navegável por teclado',async()=>{
  const [common,reservas,styles]=await Promise.all([source('src/ui/common.mjs'),source('src/ui/reservas.mjs'),source('styles-p2.css')]);
  assert.match(common,/brDateTimeToIso/);
  assert.match(common,/dd\/mm\/aaaa hh:mm/);
  assert.match(common,/role="dialog"/);
  assert.match(common,/aria-modal="true"/);
  assert.match(common,/Escape/);
  assert.match(reservas,/placeholder="dd\/mm\/aaaa hh:mm"/);
  assert.match(styles,/:focus-visible/);
  assert.match(styles,/min-height:44px/);
});
