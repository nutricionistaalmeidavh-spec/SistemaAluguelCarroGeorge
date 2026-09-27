import { ensureP1Snapshot } from './p1.mjs';
import { buildOperationalAlerts } from './alerts.mjs';

const round=value=>Math.round((Number(value||0)+Number.EPSILON)*100)/100;

export function buildDashboard(input,now=new Date()){
  const snapshot=ensureP1Snapshot(input);const vehicles=snapshot.vehicles;const rentals=snapshot.rentals??[];const ledger=snapshot.ledger??[];
  const receivables=ledger.filter(item=>['receivable','billing_receivable'].includes(item.kind)&&item.status!=='cancelled');const expenses=ledger.filter(item=>item.kind==='expense');
  const grossRevenue=round(receivables.reduce((sum,item)=>sum+Math.max(Number(item.amount||0),Number(item.paidAmount||0)),0));
  const received=round(receivables.reduce((sum,item)=>sum+Number(item.paidAmount||0),0));
  const expensesPaid=round(expenses.reduce((sum,item)=>sum+Number(item.paidAmount||0),0));
  const activeRentals=rentals.filter(item=>['retirada','em_uso'].includes(item.status));
  const overdueRentals=buildOperationalAlerts(snapshot,now).filter(item=>item.kind==='rental_overdue').length;
  const vehiclePerformance=vehicles.map(vehicle=>{
    const vehicleRentals=rentals.filter(item=>item.vehicleId===vehicle.id);
    const revenue=round(receivables.filter(item=>item.vehicleId===vehicle.id).reduce((sum,item)=>sum+Number(item.paidAmount||0),0));
    const vehicleExpenses=round(expenses.filter(item=>item.vehicleId===vehicle.id).reduce((sum,item)=>sum+Number(item.paidAmount||0),0));
    const maintenanceCost=round(snapshot.maintenance.filter(item=>item.vehicleId===vehicle.id&&item.status==='completed').reduce((sum,item)=>sum+Number(item.cost||0),0));
    return{vehicleId:vehicle.id,model:vehicle.model,plate:vehicle.plate,rentalCount:vehicleRentals.length,revenue,expenses:round(vehicleExpenses+maintenanceCost),margin:round(revenue-vehicleExpenses-maintenanceCost)};
  }).sort((a,b)=>b.margin-a.margin);
  return{
    fleetTotal:vehicles.length,availableVehicles:vehicles.filter(item=>item.availability==='disponivel').length,maintenanceVehicles:vehicles.filter(item=>item.availability==='manutencao').length,
    openRentals:rentals.filter(item=>item.status!=='devolucao'&&!item.cancelledAt).length,activeRentals:activeRentals.length,overdueRentals,
    occupancyRate:vehicles.length?Math.round(activeRentals.length/vehicles.length*100):0,grossRevenue,received,openAmount:round(Math.max(0,grossRevenue-received)),expensesPaid,netCash:round(received-expensesPaid),
    averageTicket:receivables.length?round(grossRevenue/receivables.length):0,vehiclePerformance
  };
}
