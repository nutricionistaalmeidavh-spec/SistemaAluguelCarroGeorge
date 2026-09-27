import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptySnapshot,
  createRental,
  registerPayment,
  addExpense,
  getFinancialSummary,
  addCustomer,
  addVehicle
} from '../src/domain/rental.mjs';
import { can, authenticate, seedUsers } from '../src/domain/auth.mjs';
import { createBackupEnvelope, restoreBackupEnvelope, isLegacyBackupPayload } from '../src/domain/backup.mjs';

function baseSnapshot() {
  const snapshot = createEmptySnapshot();
  snapshot.customers.push({ id: 'C1', name: 'Ana', document: '1', phone: '1', active: true });
  snapshot.vehicles.push({ id: 'V1', model: 'Onix', plate: 'ABC1D23', year: '2025', mileage: 10, category: 'Compacto', color: 'Prata', dailyRate: 150, purchasePrice: 80000, availability: 'disponivel' });
  snapshot.users = seedUsers();
  return snapshot;
}

test('P0 reservas: bloqueia sobreposição e permite período livre', () => {
  let s = baseSnapshot();
  s = createRental(s, { vehicleId:'V1', customerId:'C1', attendantId:'USR-001', pickupAt:'2026-09-20T10:00:00', returnAt:'2026-09-22T10:00:00', dailyRate:150, notes:'' }, 'USR-001');
  assert.throws(() => createRental(s, { vehicleId:'V1', customerId:'C1', attendantId:'USR-001', pickupAt:'2026-09-21T09:00:00', returnAt:'2026-09-23T09:00:00', dailyRate:150, notes:'' }, 'USR-001'), /conflito/i);
  assert.doesNotThrow(() => createRental(s, { vehicleId:'V1', customerId:'C1', attendantId:'USR-001', pickupAt:'2026-09-23T09:00:00', returnAt:'2026-09-24T09:00:00', dailyRate:150, notes:'' }, 'USR-001'));
});

test('P0 RBAC: restringe financeiro e autentica senha local', async () => {
  const users = seedUsers();
  assert.equal(can(users[1], 'finance.write'), true);
  assert.equal(can(users[2], 'finance.write'), false);
  const user = await authenticate(users, 'admin', '1234');
  assert.equal(user?.role, 'admin');
  assert.equal(await authenticate(users, 'admin', 'errada'), null);
});

test('P0 financeiro: pagamento parcial, despesa e resultado determinístico', () => {
  let s = baseSnapshot();
  s = createRental(s, { vehicleId:'V1', customerId:'C1', attendantId:'USR-001', pickupAt:'2026-09-20T10:00:00', returnAt:'2026-09-22T10:00:00', dailyRate:150, notes:'' }, 'USR-001');
  const rental = s.rentals[0];
  s = registerPayment(s, rental.id, 100, 'PIX', 'USR-001');
  s = addExpense(s, { description:'Lavagem', category:'Operacional', amount:40, dueAt:'2026-09-20', paid:true, vehicleId:'V1' }, 'USR-001');
  const summary = getFinancialSummary(s);
  assert.deepEqual(summary, { grossRevenue:300, paidAmount:100, openAmount:200, expensesAmount:40, netCash:60 });
});

test('P0 auditoria e backup: registra ações e rejeita backup adulterado', async () => {
  let s = baseSnapshot();
  s = createRental(s, { vehicleId:'V1', customerId:'C1', attendantId:'USR-001', pickupAt:'2026-09-20T10:00:00', returnAt:'2026-09-21T10:00:00', dailyRate:150, notes:'' }, 'USR-001');
  assert.equal(s.audit.some((e) => e.action === 'rental.created'), true);
  const envelope = await createBackupEnvelope(s);
  const restored = await restoreBackupEnvelope(envelope);
  assert.equal(restored.rentals.length, 1);
  const tampered = JSON.stringify({ ...JSON.parse(envelope), checksum: 'bad' });
  await assert.rejects(() => restoreBackupEnvelope(tampered), /integridade/i);
});

test('migração 0.1.5 preserva clientes, frota, locações, pagamentos e despesas', async () => {
  const { migrateLegacySnapshot } = await import('../src/domain/rental.mjs');
  const legacy = {
    version:1,
    customers:[{id:'CLI-001',name:'Cliente',document:'1',phone:'1',active:true}],
    vehicles:[{id:'VEI-001',model:'Mobi',plate:'ABC1D23',year:'2024',mileage:100,category:'Econômico',color:'Branco',dailyRate:100,purchasePrice:50000,availability:'disponivel'}],
    rentals:[{id:'LOC-000001',vehicleId:'VEI-001',customerId:'CLI-001',attendantId:'USR-001',pickupDate:'20/09 09:00',returnDate:'22/09 09:00',status:'reserva',lines:[{id:'DIA-X',quantity:2,unitPrice:100}],payments:[{amount:50,method:'PIX',paidAt:'2026-09-20T09:10:00'}]}],
    expenses:[{id:'DES-001',description:'Seguro',category:'Seguro',amount:30,dueDate:'20/09/2026',paid:true}],
    settings:{companyName:'Locadora Teste'}
  };
  const migrated = migrateLegacySnapshot(legacy);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.rentals[0].total, 200);
  assert.equal(getFinancialSummary(migrated).paidAmount, 50);
  assert.equal(getFinancialSummary(migrated).expensesAmount, 30);
  assert.equal(migrated.settings.companyName, 'Locadora Teste');
});


test('P0 restore não classifica envelope adulterado como legado',async()=>{const raw=await createBackupEnvelope(baseSnapshot());const value=JSON.parse(raw);value.checksum='bad';const tampered=JSON.stringify(value);assert.equal(isLegacyBackupPayload(tampered),false);await assert.rejects(()=>restoreBackupEnvelope(tampered),/integridade/i);assert.equal(isLegacyBackupPayload(JSON.stringify({version:1,customers:[],vehicles:[],rentals:[]})),true);});

test('P0 novos IDs são únicos mesmo partindo do mesmo snapshot offline',()=>{const a=addCustomerForTest(baseSnapshot(),'Ana A');const b=addCustomerForTest(baseSnapshot(),'Ana B');assert.notEqual(a.customers[0].id,b.customers[0].id);});

function addCustomerForTest(s,name){return addCustomer(s,{name,document:name,phone:'1'},'USR-001');}


test('P0 clientes e frota: cadastro gera identidades independentes e preserva dados',()=>{let s=baseSnapshot();const beforeCustomers=s.customers.length,beforeVehicles=s.vehicles.length;s=addCustomer(s,{name:'Bruno',document:'2',phone:'2'},'USR-001');s=addVehicle(s,{model:'Mobi',plate:'XYZ9A99',year:'2026',mileage:0,category:'Econômico',color:'Branco',dailyRate:120,purchasePrice:60000},'USR-001');assert.equal(s.customers.length,beforeCustomers+1);assert.equal(s.vehicles.length,beforeVehicles+1);const customer=s.customers.find(x=>x.document==='2');const vehicle=s.vehicles.find(x=>x.plate==='XYZ9A99');assert.ok(customer);assert.ok(vehicle);assert.match(customer.id,/^CLI-/);assert.match(vehicle.id,/^VEI-/);assert.equal(vehicle.plate,'XYZ9A99');});
