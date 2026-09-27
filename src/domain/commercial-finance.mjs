import { getFinancialSummary as getRentalFinancialSummary } from './rental.mjs';
import { installmentBalance } from './commercial.mjs';
import { activeRentalSchedulePlans } from './daily-billing.mjs';

const round=value=>Math.round((Number(value||0)+Number.EPSILON)*100)/100;
const dateOnly=value=>new Date(value).toISOString().slice(0,10);

function rentalScheduleIds(snapshot){return new Set(activeRentalSchedulePlans(snapshot).map(plan=>plan.rentalId));}

export function getFinancialSummary(snapshot){
  const base=getRentalFinancialSummary(snapshot);
  const scheduleIds=rentalScheduleIds(snapshot);
  const parent=(snapshot?.ledger??[]).filter(entry=>entry.kind==='receivable'&&scheduleIds.has(entry.rentalId));
  const recurring=(snapshot?.ledger??[]).filter(entry=>entry.kind==='billing_receivable'&&entry.status!=='cancelled');
  const parentGross=round(parent.reduce((sum,entry)=>sum+Number(entry.amount||0),0));
  const parentPaid=round(parent.reduce((sum,entry)=>sum+Number(entry.paidAmount||0),0));
  const grossRecurring=round(recurring.reduce((sum,entry)=>sum+Math.max(Number(entry.amount||0),Number(entry.paidAmount||0)),0));
  const paidRecurring=round(recurring.reduce((sum,entry)=>sum+Number(entry.paidAmount||0),0));
  const grossRevenue=round(base.grossRevenue-parentGross+grossRecurring);
  const paidAmount=round(base.paidAmount-parentPaid+paidRecurring);
  return {
    grossRevenue,
    paidAmount,
    openAmount:round(grossRevenue-paidAmount),
    expensesAmount:base.expensesAmount,
    netCash:round(paidAmount-base.expensesAmount)
  };
}

export function financialReceivables(snapshot){
  const scheduleIds=rentalScheduleIds(snapshot);
  return (snapshot?.ledger??[]).filter(entry=>{
    if(entry.status==='cancelled'||!['receivable','billing_receivable'].includes(entry.kind))return false;
    if(entry.kind==='receivable'&&scheduleIds.has(entry.rentalId))return false;
    return true;
  });
}

export function dailyFinancialSummary(snapshot, asOf=new Date().toISOString()){
  const today=dateOnly(asOf);
  const plans=activeRentalSchedulePlans(snapshot).filter(plan=>plan.frequency==='daily');
  const planIds=new Set(plans.map(plan=>plan.id));
  const installments=(snapshot?.billingInstallments??[])
    .filter(item=>planIds.has(item.planId)&&item.status!=='cancelled');

  let receivedToday=0,dueToday=0,pendingToday=0,overdueAmount=0,overdueCount=0;
  const rowsByRental=new Map();

  for(const item of installments){
    const balance=installmentBalance(item,asOf);
    const openPrincipal=round(Math.max(0,Number(item.amount||0)-Number(item.paidAmount||0)));
    const paymentsToday=(item.payments??[]).filter(payment=>dateOnly(payment.paidAt)===today).reduce((sum,payment)=>sum+Number(payment.amount||0),0);
    receivedToday=round(receivedToday+paymentsToday);
    if(String(item.dueAt).slice(0,10)===today){
      dueToday=round(dueToday+Number(item.amount||0));
      pendingToday=round(pendingToday+openPrincipal);
    }
    const overdue=!['paid','cancelled'].includes(item.status)&&balance.daysLate>0&&balance.totalDue>0;
    if(overdue){overdueCount+=1;overdueAmount=round(overdueAmount+balance.totalDue);}

    let row=rowsByRental.get(item.rentalId);
    if(!row){
      const rental=(snapshot?.rentals??[]).find(entry=>entry.id===item.rentalId)??{};
      row={rentalId:item.rentalId,customerId:item.customerId,vehicleId:item.vehicleId,dailyRate:Number(rental.dailyRate||item.amount||0),paidCount:0,pendingCount:0,overdueCount:0,receivedToday:0,dueToday:0,openAmount:0};
      rowsByRental.set(item.rentalId,row);
    }
    if(item.status==='paid')row.paidCount+=1;
    else if(overdue)row.overdueCount+=1;
    else row.pendingCount+=1;
    row.receivedToday=round(row.receivedToday+paymentsToday);
    if(String(item.dueAt).slice(0,10)===today)row.dueToday=round(row.dueToday+Number(item.amount||0));
    row.openAmount=round(row.openAmount+openPrincipal);
  }

  return {
    asOf,
    date:today,
    receivedToday,
    dueToday,
    pendingToday,
    overdueAmount,
    overdueCount,
    rows:[...rowsByRental.values()].sort((a,b)=>String(a.rentalId).localeCompare(String(b.rentalId)))
  };
}

export function dailyDelinquencySummary(snapshot,asOf=new Date().toISOString()){
  const plans=activeRentalSchedulePlans(snapshot).filter(plan=>plan.frequency==='daily');
  const planIds=new Set(plans.map(plan=>plan.id));
  const rows=(snapshot?.billingInstallments??[])
    .filter(item=>planIds.has(item.planId)&&!['paid','cancelled'].includes(item.status))
    .map(item=>({item,balance:installmentBalance(item,asOf)}))
    .filter(({balance})=>balance.daysLate>0&&balance.totalDue>0)
    .map(({item,balance})=>({
      installmentId:item.id,
      rentalId:item.rentalId,
      customerId:item.customerId,
      vehicleId:item.vehicleId,
      sequence:Number(item.sequence||0),
      dueAt:item.dueAt,
      daysLate:balance.daysLate,
      amount:Number(item.amount||0),
      paidAmount:Number(item.paidAmount||0),
      openAmount:round(Math.max(0,Number(item.amount||0)-Number(item.paidAmount||0))),
      totalDue:balance.totalDue
    }))
    .sort((a,b)=>String(a.dueAt).localeCompare(String(b.dueAt))||a.sequence-b.sequence);
  return {
    asOf,
    overdueCount:rows.length,
    overdueAmount:round(rows.reduce((sum,row)=>sum+row.totalDue,0)),
    rows
  };
}
