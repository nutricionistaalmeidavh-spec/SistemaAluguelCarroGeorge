import { createRental, moveRental, rentalDays } from './rental.mjs';
import { createBillingPlan, ensureCommercialSnapshot, installmentBalance, recordInstallmentPayment } from './commercial.mjs';
import { appendAudit } from './p1.mjs';

const DAY=86_400_000;
const round = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
function entityId(prefix){
  if(typeof globalThis.crypto?.randomUUID==='function')return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
function iso(value){const d=new Date(value);if(!Number.isFinite(d.getTime()))throw new Error('Data inválida.');return d.toISOString();}
function dateOnly(value){return iso(value).slice(0,10);}
function addDays(value,days){const d=new Date(`${dateOnly(value)}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}

export function billingPlanPurpose(plan) {
  return plan?.purpose === 'rental_schedule' ? 'rental_schedule' : 'additional';
}

export function markRentalSchedulePurpose(input, planId) {
  const snapshot = ensureCommercialSnapshot(input);
  const plan = snapshot.billingPlans.find((item) => item.id === planId);
  if (!plan) throw new Error('Plano de cobrança não encontrado.');
  plan.purpose = 'rental_schedule';
  plan.updatedAt = new Date().toISOString();
  const installmentIds = new Set(snapshot.billingInstallments.filter((item) => item.planId === plan.id).map((item) => item.id));
  for (const entry of snapshot.ledger ?? []) if (entry.kind === 'billing_receivable' && installmentIds.has(entry.installmentId)) entry.billingPurpose = 'rental_schedule';
  return snapshot;
}

export function activeRentalSchedulePlans(snapshot) {
  return (snapshot?.billingPlans ?? []).filter((plan) => plan.active !== false && billingPlanPurpose(plan) === 'rental_schedule');
}

function schedulePlanForRental(snapshot, rentalId) {
  return activeRentalSchedulePlans(snapshot).find((item) => item.rentalId === rentalId && item.frequency === 'daily') ?? null;
}

function elapsedRentalDays(pickupAt,asOf){
  const start=new Date(pickupAt).getTime(),end=new Date(asOf).getTime();
  if(!Number.isFinite(start)||!Number.isFinite(end))throw new Error('Data inválida.');
  if(end<=start)return 1;
  return Math.max(1,Math.ceil((end-start)/DAY));
}

function ensureScheduleCount(input,rentalId,targetCount,actorId){
  const snapshot=ensureCommercialSnapshot(input);
  const rental=snapshot.rentals.find(item=>item.id===rentalId);
  if(!rental)throw new Error('Locação não encontrada.');
  const plan=schedulePlanForRental(snapshot,rentalId);
  if(!plan)throw new Error('Esta locação não possui agenda diária ativa.');
  if(rental.periodMode!=='continuous'||rental.continuousClosedAt||plan.generationClosedAt)return snapshot;
  const target=Math.max(1,Math.floor(Number(targetCount)||1));
  const schedule=snapshot.billingInstallments.filter(item=>item.planId===plan.id&&item.status!=='cancelled').sort((a,b)=>Number(a.sequence||0)-Number(b.sequence||0));
  let count=schedule.length;
  if(target<=count)return snapshot;
  const now=new Date().toISOString();
  while(count<target){
    const sequence=count+1,dueAt=addDays(plan.firstDueAt,sequence-1);
    const installment={id:entityId('PAR'),planId:plan.id,rentalId:rental.id,customerId:rental.customerId,vehicleId:rental.vehicleId,sequence,dueAt,amount:Number(plan.amount),paidAmount:0,status:'open',payments:[],paymentConflicts:[],finePercent:Number(plan.finePercent||0),interestMonthlyPercent:Number(plan.interestMonthlyPercent||0),createdAt:now,updatedAt:now};
    snapshot.billingInstallments.push(installment);
    snapshot.ledger.unshift({id:entityId('FIN'),kind:'billing_receivable',billingPurpose:'rental_schedule',installmentId:installment.id,rentalId:rental.id,vehicleId:rental.vehicleId,description:`Cobrança recorrente ${plan.id} parcela ${sequence}`,amount:Number(plan.amount),paidAmount:0,status:'open',dueAt,createdAt:now});
    count+=1;
  }
  snapshot.billingInstallments.sort((a,b)=>String(a.dueAt).localeCompare(String(b.dueAt))||Number(a.sequence||0)-Number(b.sequence||0));
  plan.occurrences=count;plan.updatedAt=now;plan.generationMode='continuous';
  rental.days=count;rental.total=round(count*Number(plan.amount||rental.dailyRate||0));rental.updatedAt=now;
  const paid=round(snapshot.billingInstallments.filter(item=>item.planId===plan.id&&item.status!=='cancelled').reduce((sum,item)=>sum+Math.min(Number(item.amount||0),Number(item.paidAmount||0)),0));
  rental.paymentStatus=paid>=rental.total-0.001?'pago':'aberto';
  const parent=snapshot.ledger.find(entry=>entry.kind==='receivable'&&entry.rentalId===rental.id);
  if(parent){parent.amount=rental.total;parent.paidAmount=Math.min(rental.total,paid);parent.status=paid>=rental.total-0.001?'paid':paid>0?'partial':'open';if(parent.status!=='paid')delete parent.paidAt;}
  appendAudit(snapshot,{actorId,action:'daily_schedule.accrued',entityType:'rental',entityId:rental.id,details:{added:target-schedule.length,days:count,total:rental.total}});
  return snapshot;
}

export function createRentalWithBilling(input, draft={}, actorId) {
  const billingMode = draft.billingMode === 'daily' ? 'daily' : 'total';
  const periodMode=draft.periodMode==='continuous'?'continuous':'fixed';
  if(periodMode==='continuous'&&billingMode!=='daily')throw new Error('Locação contínua deve usar recebimento por diária.');
  let snapshot = ensureCommercialSnapshot(createRental(input, {...draft,periodMode,returnAt:periodMode==='continuous'?null:draft.returnAt}, actorId));
  const rental = snapshot.rentals[0];
  rental.billingMode = billingMode;
  rental.periodMode=periodMode;
  rental.updatedAt = new Date().toISOString();
  if (billingMode !== 'daily') return snapshot;

  snapshot = createBillingPlan(snapshot, {
    rentalId:rental.id,
    purpose:'rental_schedule',
    frequency:'daily',
    firstDueAt:rental.pickupAt,
    amount:rental.dailyRate,
    occurrences:rental.days,
    finePercent:0,
    interestMonthlyPercent:0
  }, actorId);
  const plan = snapshot.billingPlans.find((item) => item.rentalId === rental.id && item.frequency === 'daily' && item.purpose === 'rental_schedule');
  if (!plan) throw new Error('Não foi possível criar a agenda diária da locação.');
  const persistedRental = snapshot.rentals.find((item) => item.id === rental.id);
  persistedRental.billingMode = 'daily';
  persistedRental.periodMode=periodMode;
  persistedRental.updatedAt = plan.updatedAt;
  if(periodMode==='continuous'){plan.generationMode='continuous';plan.generationClosedAt=null;}
  return snapshot;
}

export function ensureDailyInstallmentsUntil(input,rentalId,asOf=new Date().toISOString(),actorId='SYSTEM'){
  const snapshot=ensureCommercialSnapshot(input),rental=snapshot.rentals.find(item=>item.id===rentalId);
  if(!rental)throw new Error('Locação não encontrada.');
  const plan=schedulePlanForRental(snapshot,rentalId);
  if(rental.periodMode!=='continuous'||rental.continuousClosedAt||!plan||plan.generationClosedAt)return snapshot;
  return ensureScheduleCount(snapshot,rentalId,elapsedRentalDays(rental.pickupAt,asOf),actorId);
}

export function ensureOpenDailyRentals(input,asOf=new Date().toISOString(),actorId='SYSTEM'){
  let snapshot=ensureCommercialSnapshot(input);
  const ids=snapshot.rentals.filter(rental=>rental.periodMode==='continuous'&&!rental.continuousClosedAt&&rental.billingMode==='daily').map(rental=>rental.id);
  for(const rentalId of ids)snapshot=ensureDailyInstallmentsUntil(snapshot,rentalId,asOf,actorId);
  return snapshot;
}

export function closeContinuousDailyRental(input,rentalId,{returnAt}={},actorId){
  let snapshot=ensureCommercialSnapshot(input);
  let rental=snapshot.rentals.find(item=>item.id===rentalId);
  if(!rental)throw new Error('Locação não encontrada.');
  if(rental.periodMode!=='continuous'||rental.continuousClosedAt)throw new Error('Locação contínua já encerrada ou inválida.');
  const closedAt=iso(returnAt),targetCount=rentalDays(rental.pickupAt,closedAt);
  snapshot=ensureScheduleCount(snapshot,rentalId,targetCount,actorId);
  rental=snapshot.rentals.find(item=>item.id===rentalId);
  const plan=schedulePlanForRental(snapshot,rentalId);
  rental.returnAt=closedAt;rental.continuousClosedAt=closedAt;rental.updatedAt=closedAt;
  plan.generationClosedAt=closedAt;plan.occurrences=snapshot.billingInstallments.filter(item=>item.planId===plan.id&&item.status!=='cancelled').length;plan.updatedAt=closedAt;
  appendAudit(snapshot,{actorId,action:'daily_schedule.closed',entityType:'rental',entityId:rentalId,details:{returnAt:closedAt,days:rental.days,total:rental.total}});
  return moveRental(snapshot,rentalId,'devolucao',actorId);
}

export function dailyBillingSummary(input, rentalId, asOf=new Date().toISOString()) {
  const snapshot = ensureCommercialSnapshot(input);
  const plan = schedulePlanForRental(snapshot, rentalId);
  if (!plan) return { rentalId, planId:null, totalCount:0, paidCount:0, pendingCount:0, partialCount:0, overdueCount:0, conflictCount:0, received:0, openAmount:0, rows:[] };
  const rows = snapshot.billingInstallments
    .filter((item) => item.planId === plan.id && item.status !== 'cancelled')
    .sort((a,b) => Number(a.sequence || 0) - Number(b.sequence || 0))
    .map((item) => {
      const balance = installmentBalance(item, asOf);
      const status = item.status === 'paid' ? 'paid' : item.status === 'partial' ? 'partial' : balance.daysLate > 0 ? 'overdue' : 'pending';
      return { installmentId:item.id, sequence:item.sequence, dueAt:item.dueAt, amount:Number(item.amount || 0), paidAmount:Number(item.paidAmount || 0), openAmount:round(Math.max(0, Number(item.amount || 0) - Number(item.paidAmount || 0))), totalDue:balance.totalDue, daysLate:balance.daysLate, status, payments:[...(item.payments??[])], paymentConflicts:[...(item.paymentConflicts??[])] };
    });
  return {
    rentalId,
    planId:plan.id,
    totalCount:rows.length,
    paidCount:rows.filter((row) => row.status === 'paid').length,
    pendingCount:rows.filter((row) => row.status === 'pending' || row.status === 'overdue').length,
    partialCount:rows.filter((row) => row.status === 'partial').length,
    overdueCount:rows.filter((row) => row.status === 'overdue').length,
    conflictCount:rows.reduce((sum,row)=>sum+row.paymentConflicts.length,0),
    received:round(rows.reduce((sum,row) => sum + row.paidAmount, 0)),
    openAmount:round(rows.reduce((sum,row) => sum + row.openAmount, 0)),
    rows
  };
}

export function nextDailyInstallment(input, rentalId) {
  const snapshot = ensureCommercialSnapshot(input);
  const plan = schedulePlanForRental(snapshot, rentalId);
  if (!plan) return null;
  return snapshot.billingInstallments
    .filter((item) => item.planId === plan.id && !['paid','cancelled'].includes(item.status))
    .sort((a,b) => Number(a.sequence || 0) - Number(b.sequence || 0))[0] ?? null;
}

export function recordNextDailyPayment(input, rentalId, payment={}, actorId) {
  const snapshot = ensureCommercialSnapshot(input);
  const installment = nextDailyInstallment(snapshot, rentalId);
  if (!installment) throw new Error('Não há diária pendente para esta locação.');
  return recordInstallmentPayment(snapshot, installment.id, payment, actorId);
}

export function recordDailyPaymentAmount(input, rentalId, payment={}, actorId) {
  let snapshot = ensureCommercialSnapshot(input);
  const plan = schedulePlanForRental(snapshot, rentalId);
  if (!plan) throw new Error('Esta locação não possui agenda diária ativa.');
  const value = round(payment.amount);
  if (!(value > 0)) throw new Error('Valor do pagamento deve ser maior que zero.');
  const paidAt = payment.paidAt ?? new Date().toISOString();
  const method = String(payment.method ?? 'PIX');
  const installments = snapshot.billingInstallments
    .filter((item) => item.planId === plan.id && !['paid','cancelled'].includes(item.status))
    .sort((a,b) => Number(a.sequence || 0) - Number(b.sequence || 0));
  const outstanding = round(installments.reduce((sum,item) => sum + Math.max(0, Number(item.amount || 0) - Number(item.paidAmount || 0)), 0));
  if (value > outstanding + 0.001) throw new Error('Pagamento excede o saldo das diárias.');

  let remaining = value;
  for (const installment of installments) {
    if (remaining <= 0.001) break;
    const open = round(Math.max(0, Number(installment.amount || 0) - Number(installment.paidAmount || 0)));
    if (open <= 0) continue;
    const allocated = round(Math.min(open, remaining));
    snapshot = recordInstallmentPayment(snapshot, installment.id, { amount:allocated, method, paidAt }, actorId);
    remaining = round(remaining - allocated);
  }
  if (remaining > 0.001) throw new Error('Não foi possível distribuir todo o pagamento nas diárias.');
  return snapshot;
}
