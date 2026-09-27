import {
  createEmptySnapshot,
  addCustomer,
  addVehicle,
  registerPayment,
  addExpense
} from '../../src/domain/rental.mjs';
import {
  createRentalWithBilling,
  recordNextDailyPayment
} from '../../src/domain/daily-billing.mjs';
import {
  createContractTemplate,
  issueContract
} from '../../src/domain/commercial.mjs';
import { createInspection } from '../../src/domain/inspection.mjs';
import { scheduleMaintenance } from '../../src/domain/maintenance.mjs';

const ACTOR = 'USR-001';

export async function buildLegacySnapshotFixture() {
  let snapshot = createEmptySnapshot();

  snapshot = addCustomer(snapshot, {
    name:'Cliente Total', document:'12345678900', phone:'16999990001',
    email:'total@example.test', address:'Rua Um, 10'
  }, ACTOR);
  const totalCustomer = snapshot.customers[0];

  snapshot = addCustomer(snapshot, {
    name:'Cliente Diária', document:'98765432100', phone:'16999990002',
    email:'diaria@example.test', address:'Rua Dois, 20'
  }, ACTOR);
  const dailyCustomer = snapshot.customers[0];

  snapshot = addVehicle(snapshot, {
    model:'Sedan Total', plate:'TST1A01', year:'2024', mileage:12000,
    category:'Sedan', color:'Prata', dailyRate:100, purchasePrice:70000
  }, ACTOR);
  const totalVehicle = snapshot.vehicles[0];

  snapshot = addVehicle(snapshot, {
    model:'Hatch Diário', plate:'TST2B02', year:'2025', mileage:8000,
    category:'Hatch', color:'Branco', dailyRate:80, purchasePrice:60000
  }, ACTOR);
  const dailyVehicle = snapshot.vehicles[0];

  snapshot = createRentalWithBilling(snapshot, {
    customerId:totalCustomer.id,
    vehicleId:totalVehicle.id,
    attendantId:ACTOR,
    pickupAt:'2026-10-01T12:00:00.000Z',
    returnAt:'2026-10-04T12:00:00.000Z',
    dailyRate:100,
    billingMode:'total',
    notes:'Baseline modo total'
  }, ACTOR);
  const totalRental = snapshot.rentals[0];
  snapshot = registerPayment(snapshot, totalRental.id, 100, 'PIX', ACTOR);

  snapshot = createRentalWithBilling(snapshot, {
    customerId:dailyCustomer.id,
    vehicleId:dailyVehicle.id,
    attendantId:ACTOR,
    pickupAt:'2026-10-10T12:00:00.000Z',
    returnAt:'2026-10-15T12:00:00.000Z',
    dailyRate:80,
    billingMode:'daily',
    notes:'Baseline agenda diária'
  }, ACTOR);
  const dailyRental = snapshot.rentals[0];
  snapshot = recordNextDailyPayment(snapshot, dailyRental.id, {
    amount:50, method:'Dinheiro', paidAt:'2026-10-10T15:00:00.000Z'
  }, ACTOR);

  snapshot = addExpense(snapshot, {
    description:'Lavagem baseline', category:'Operacional', amount:60,
    dueAt:'2026-10-02', paid:true, vehicleId:totalVehicle.id
  }, ACTOR);

  snapshot = createInspection(snapshot, { rentalId:totalRental.id, kind:'checkout' }, ACTOR);
  const inspection = snapshot.inspections[0];
  // Esta fixture congela deliberadamente o formato histórico anterior ao AttachmentStore.
  // Não use a API atual addInspectionPhoto aqui: o objetivo é testar a migração de dados reais legados.
  inspection.photos.push({
    id:'FOTO-LEGACY-001',
    name:'baseline.jpg',
    type:'image/jpeg',
    dataUrl:'data:image/jpeg;base64,AA==',
    createdAt:'2026-09-27T12:00:00.000Z'
  });
  const photosItem=inspection.checklist.find(item=>item.id==='photos');
  if(photosItem){photosItem.done=true;photosItem.evidence='1 foto(s)';}

  snapshot = scheduleMaintenance(snapshot, {
    vehicleId:dailyVehicle.id,
    type:'Troca de óleo',
    dueAt:'2026-12-01',
    notes:'Manutenção da fixture',
    costEstimate:250
  }, ACTOR);

  snapshot = createContractTemplate(snapshot, {
    name:'Contrato baseline',
    body:'Contrato {{locacao.id}} - {{cliente.nome}} - {{veiculo.placa}}',
    isDefault:true
  }, ACTOR);
  const template = snapshot.contractTemplates[0];
  snapshot = issueContract(snapshot, { templateId:template.id, rentalId:totalRental.id }, ACTOR);

  return snapshot;
}
