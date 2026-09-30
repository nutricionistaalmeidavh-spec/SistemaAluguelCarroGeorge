import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../src/app.mjs', import.meta.url), 'utf8');
const desktopRentalsSource = readFileSync(new URL('../src/ui/reservas.mjs', import.meta.url), 'utf8');
const cloudRentalsSource = readFileSync(new URL('../src/cloud/ui/rentals.mjs', import.meta.url), 'utf8');

const legacyVisibleTerms = [
  'Reservas e locações',
  'Nova reserva',
  'Salvar reserva',
  '<small>Reservas</small>',
  'Nenhuma reserva cadastrada.',
  'primeira reserva for criada'
];

test('Desktop usa Locações como nomenclatura visível do módulo', () => {
  assert.match(appSource, /\['reservas','Locações'\]/);
  assert.match(desktopRentalsSource, /<h1>Locações<\/h1>/);
  assert.match(desktopRentalsSource, />Nova locação<\/button>/);
  assert.match(desktopRentalsSource, /modal\('Nova locação'/);
  assert.match(desktopRentalsSource, />Salvar locação<\/button>/);
  assert.match(desktopRentalsSource, /<small>Locações<\/small>/);
  assert.match(desktopRentalsSource, /Nenhuma locação cadastrada\./);
  assert.match(desktopRentalsSource, /primeira locação for criada/);
  for (const term of legacyVisibleTerms) assert.ok(!desktopRentalsSource.includes(term), `texto legado ainda visível: ${term}`);
});

test('PWA mantém Locações como nomenclatura visível', () => {
  assert.match(cloudRentalsSource, /<h1>Locações<\/h1>/);
  assert.match(cloudRentalsSource, /<h2>Nova locação<\/h2>/);
  assert.match(cloudRentalsSource, />Criar locação<\/button>/);
  assert.ok(!cloudRentalsSource.includes('Nova reserva'));
});
