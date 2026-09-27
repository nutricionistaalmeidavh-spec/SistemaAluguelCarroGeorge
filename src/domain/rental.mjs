import { seedUsers } from './auth.mjs';

const DAY = 86_400_000;

export function createEmptySnapshot() {
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    customers: [], vehicles: [], rentals: [], expenses: [], users: seedUsers(), ledger: [], audit: [],
    settings: { companyName:'Sistema Locadora', document:'', phone:'', address:'' }
  };
}

function clone(snapshot) {
  return typeof structuredClone === 'function' ? structuredClone(snapshot) : JSON.parse(JSON.stringify(snapshot));
}

function entityId(prefix){
  if(typeof globalThis.crypto?.randomUUID==='function')return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function nextId(prefix, list) {
  const max = list.reduce((acc, item) => Math.max(acc, Number(String(item.id).replace(/\D/g,'')) || 0), 0);
  return `${prefix}-${String(max + 1).padStart(6,'0')}`;
}

function audit(snapshot, actorId, action, entityType, entityId, details = {}) {
  snapshot.audit.unshift({ id: nextId('AUD', snapshot.audit), at:new Date().toISOString(), actorId, action, entityType, entityId, details });
}

export function rentalDays(pickupAt, returnAt) {
  const start = new Date(pickupAt).getTime();
  const end = new Date(returnAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('Período de locação inválido.');
  return Math.max(1, Math.ceil((end - start) / DAY));
}

function rentalEnd(rental){
  if(rental?.status==='devolucao'||rental?.cancelledAt)return new Date(rental.returnAt??rental.continuousClosedAt??0).getTime();
  if(rental?.periodMode==='continuous'&&!rental?.continuousClosedAt)return Infinity;
  const value=new Date(rental?.returnAt??rental?.continuousClosedAt??'').getTime();
  return Number.isFinite(value)?value:Infinity;
}

export function hasReservationConflict(snapshot, vehicleId, pickupAt, returnAt, ignoreRentalId = null) {
  const start = new Date(pickupAt).getTime();
  const end = returnAt==null||returnAt==='' ? Infinity : new Date(returnAt).getTime();
  if (!Number.isFinite(start) || (!(end===Infinity)&&(!Number.isFinite(end)||end<=start))) return true;
  return snapshot.rentals.some((rental) => {
    if (rental.id === ignoreRentalId || rental.vehicleId !== vehicleId || rental.status === 'devolucao' || rental.cancelledAt) return false;
    const otherStart = new Date(rental.pickupAt).getTime();
    const otherEnd = rentalEnd(rental);
    if(!Number.isFinite(otherStart))return false;
    return start < otherEnd && end > otherStart;
  });
}

export function createRental(snapshot, draft, actorId) {
  const continuous=draft.periodMode==='continuous'||draft.openEnded===true;
  const days = continuous ? 1 : rentalDays(draft.pickupAt, draft.returnAt);
  const returnAt=continuous?null:draft.returnAt;
  if (hasReservationConflict(snapshot, draft.vehicleId, draft.pickupAt, returnAt)) {
    throw new Error('Conflito de reserva: o veículo já está comprometido neste período.');
  }
  if (!snapshot.customers.some((c) => c.id === draft.customerId && c.active)) throw new Error('Cliente inválido.');
  if (!snapshot.vehicles.some((v) => v.id === draft.vehicleId && v.availability !== 'manutencao')) throw new Error('Veículo indisponível.');
  const next = clone(snapshot);
  const now = new Date().toISOString();
  const rental = {
    id: entityId('LOC'), vehicleId:draft.vehicleId, customerId:draft.customerId, attendantId:draft.attendantId,
    pickupAt:draft.pickupAt, returnAt, periodMode:continuous?'continuous':'fixed', continuousClosedAt:null,
    status:'reserva', priority:draft.priority ?? 'Media', notes:draft.notes ?? '',
    dailyRate:Number(draft.dailyRate), days, total:round(days * Number(draft.dailyRate)), payments:[], paymentStatus:'aberto',
    createdAt:now, updatedAt:now
  };
  next.rentals.unshift(rental);
  next.ledger.unshift({ id:nextId('FIN', next.ledger), kind:'receivable', rentalId:rental.id, vehicleId:rental.vehicleId, description:`Locação ${rental.id}`, amount:rental.total, paidAmount:0, status:'open', dueAt:rental.pickupAt, createdAt:now });
  audit(next, actorId, 'rental.created', 'rental', rental.id, { vehicleId:rental.vehicleId, pickupAt:rental.pickupAt, returnAt:rental.returnAt, periodMode:rental.periodMode, total:rental.total });
  next.updatedAt = now;
  return next;
}

export function moveRental(snapshot, rentalId, status, actorId) {
  const next = clone(snapshot);
  const rental = next.rentals.find((r) => r.id === rentalId);
  if (!rental) throw new Error('Locação não encontrada.');
  const allowed={reserva:'retirada',retirada:'em_uso',em_uso:'devolucao'};
  if(allowed[rental.status]!==status)throw new Error('Transição de locação inválida.');
  const completed=(kind)=>next.inspections?.some(item=>item.rentalId===rental.id&&item.kind===kind&&item.status==='completed');
  if(status==='em_uso'&&!completed('checkout'))throw new Error('Conclua a vistoria de retirada antes de iniciar a locação.');
  if(status==='devolucao'&&!completed('return'))throw new Error('Conclua a vistoria de devolução antes de finalizar a locação.');
  if(status==='devolucao'&&rental.periodMode==='continuous'&&!rental.continuousClosedAt)throw new Error('Encerre a diária contínua antes de finalizar a devolução.');
  rental.status = status;
  rental.updatedAt = new Date().toISOString();
  const vehicle = next.vehicles.find((v) => v.id === rental.vehicleId);
  if (vehicle) vehicle.availability = status === 'devolucao' ? 'disponivel' : (status === 'reserva' ? vehicle.availability : 'locado');
  audit(next, actorId, 'rental.status_changed', 'rental', rental.id, { status });
  next.updatedAt = rental.updatedAt;
  return next;
}

export function registerPayment(snapshot, rentalId, amount, method, actorId) {
  const value = round(Number(amount));
  if (!(value > 0)) throw new Error('Valor do pagamento deve ser maior que zero.');
  const next = clone(snapshot);
  const rental = next.rentals.find((r) => r.id === rentalId);
  if (!rental) throw new Error('Locação não encontrada.');
  const hasDailySchedule=(next.billingPlans??[]).some((plan)=>plan.rentalId===rentalId&&plan.active!==false&&plan.purpose==='rental_schedule');
  if(rental.billingMode==='daily'||hasDailySchedule)throw new Error('Esta locação usa agenda diária. Registre o recebimento pelas diárias.');
  const received = round(rental.payments.reduce((sum,p) => sum + p.amount, 0));
  if (received + value > rental.total + 0.001) throw new Error('Pagamento excede o saldo da locação.');
  const now = new Date().toISOString();
  rental.payments.push({ id:nextId('PAG', rental.payments), amount:value, method, paidAt:now });
  const paid = round(received + value);
  rental.paymentStatus = paid >= rental.total ? 'pago' : 'aberto';
  rental.updatedAt = now;
  const entry = next.ledger.find((e) => e.kind === 'receivable' && e.rentalId === rentalId);
  if (entry) { entry.paidAmount = paid; entry.status = paid >= entry.amount ? 'paid' : 'partial'; entry.paidAt = paid >= entry.amount ? now : undefined; }
  audit(next, actorId, 'payment.received', 'rental', rental.id, { amount:value, method });
  next.updatedAt = now;
  return next;
}

export function addExpense(snapshot, input, actorId) {
  const amount = round(Number(input.amount));
  if (!(amount > 0)) throw new Error('Despesa deve ser maior que zero.');
  const next = clone(snapshot);
  const now = new Date().toISOString();
  const expense = { id:nextId('DES', next.expenses), description:input.description, category:input.category, amount, dueAt:input.dueAt, paid:Boolean(input.paid), vehicleId:input.vehicleId ?? null, createdAt:now };
  next.expenses.unshift(expense);
  next.ledger.unshift({ id:nextId('FIN', next.ledger), kind:'expense', expenseId:expense.id, vehicleId:expense.vehicleId, description:expense.description, amount, paidAmount:expense.paid ? amount : 0, status:expense.paid ? 'paid' : 'open', dueAt:expense.dueAt, createdAt:now, paidAt:expense.paid ? now : undefined });
  audit(next, actorId, 'expense.created', 'expense', expense.id, { amount, category:expense.category, vehicleId:expense.vehicleId });
  next.updatedAt = now;
  return next;
}

export function getFinancialSummary(snapshot) {
  const receivables = snapshot.ledger.filter((e) => e.kind === 'receivable');
  const expenses = snapshot.ledger.filter((e) => e.kind === 'expense');
  const grossRevenue = round(receivables.reduce((s,e) => s + e.amount, 0));
  const paidAmount = round(receivables.reduce((s,e) => s + (e.paidAmount || 0), 0));
  const expensesAmount = round(expenses.reduce((s,e) => s + (e.paidAmount || 0), 0));
  return { grossRevenue, paidAmount, openAmount:round(grossRevenue - paidAmount), expensesAmount, netCash:round(paidAmount - expensesAmount) };
}

export function periodAvailability(snapshot, vehicleId, pickupAt, returnAt) {
  const vehicle = snapshot.vehicles.find((v) => v.id === vehicleId);
  if (!vehicle || vehicle.availability === 'manutencao') return 'indisponivel';
  return hasReservationConflict(snapshot, vehicleId, pickupAt, returnAt) ? 'ocupado' : 'disponivel';
}

export function addCustomer(snapshot, input, actorId) {
  const next = clone(snapshot);
  const now=new Date().toISOString();
  const customer = { id:entityId('CLI'), name:input.name.trim(), document:input.document.trim(), phone:input.phone.trim(), email:input.email?.trim() ?? '', address:input.address?.trim() ?? '', active:true, createdAt:now, updatedAt:now };
  next.customers.unshift(customer); audit(next, actorId, 'customer.created', 'customer', customer.id); next.updatedAt = new Date().toISOString(); return next;
}

export function addVehicle(snapshot, input, actorId) {
  const next = clone(snapshot);
  const now=new Date().toISOString();
  const vehicle = { id:entityId('VEI'), model:input.model.trim(), plate:input.plate.trim().toUpperCase(), year:String(input.year), mileage:Number(input.mileage || 0), category:input.category || 'Padrão', color:input.color || '', dailyRate:Number(input.dailyRate || 0), purchasePrice:Number(input.purchasePrice || 0), availability:'disponivel', createdAt:now, updatedAt:now };
  next.vehicles.unshift(vehicle); audit(next, actorId, 'vehicle.created', 'vehicle', vehicle.id); next.updatedAt = new Date().toISOString(); return next;
}

function parseLegacyDate(value, fallbackYear = 2026) {
  if (!value) return new Date().toISOString();
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  const match = String(value).match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s*(\d{1,2})?:?(\d{2})?/);
  if (!match) return new Date().toISOString();
  const [,d,m,y,h='09',min='00'] = match;
  return `${y || fallbackYear}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}T${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}:00`;
}

export function migrateLegacySnapshot(raw) {
  const source = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (source?.version === 2 && Array.isArray(source.ledger) && Array.isArray(source.audit)) return source;
  const next = createEmptySnapshot();
  next.customers = source?.customers ?? [];
  next.vehicles = source?.vehicles ?? [];
  next.settings = { ...next.settings, ...(source?.settings ?? {}) };
  next.users = seedUsers();
  for (const old of source?.rentals ?? []) {
    const pickupAt = parseLegacyDate(old.pickupAt ?? old.pickupDate);
    const returnAt = parseLegacyDate(old.returnAt ?? old.returnDate);
    const dailyLine = old.lines?.find((line) => String(line.id).startsWith('DIA-'));
    const dailyRate = Number(old.dailyRate ?? dailyLine?.unitPrice ?? 0);
    const days = Number(old.days ?? dailyLine?.quantity ?? rentalDays(pickupAt, returnAt));
    const total = round(old.total ?? days * dailyRate);
    const rental = { ...old, pickupAt, returnAt, periodMode:old.periodMode??'fixed', dailyRate, days, total, payments:old.payments ?? [], paymentStatus:old.paymentStatus ?? 'aberto' };
    next.rentals.push(rental);
    const paid = round(rental.payments.reduce((s,p) => s + Number(p.amount || 0), 0));
    next.ledger.push({ id:nextId('FIN', next.ledger), kind:'receivable', rentalId:rental.id, vehicleId:rental.vehicleId, description:`Locação ${rental.id}`, amount:total, paidAmount:paid, status:paid >= total ? 'paid' : paid > 0 ? 'partial' : 'open', dueAt:pickupAt, createdAt:rental.createdAt ?? new Date().toISOString() });
  }
  for (const old of source?.expenses ?? []) {
    const expense = { ...old, dueAt:old.dueAt ?? old.dueDate ?? '', paid:Boolean(old.paid) };
    next.expenses.push(expense);
    next.ledger.push({ id:nextId('FIN', next.ledger), kind:'expense', expenseId:expense.id, description:expense.description, amount:Number(expense.amount || 0), paidAmount:expense.paid ? Number(expense.amount || 0) : 0, status:expense.paid ? 'paid' : 'open', dueAt:expense.dueAt, createdAt:new Date().toISOString() });
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

function round(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }
