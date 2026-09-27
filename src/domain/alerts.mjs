import { ensureP1Snapshot } from './p1.mjs';
import { maintenanceDue } from './maintenance.mjs';

const DAY=86_400_000;
function inDays(value,now){const t=Date.parse(value);return Number.isFinite(t)?Math.ceil((t-now.getTime())/DAY):null;}
function state(snapshot,id){return snapshot.alertState?.[id]??{};}
function active(snapshot,alert){const current=state(snapshot,alert.id);return current.dismissedAt?null:{...alert,status:current.acknowledgedAt?'acknowledged':'active',acknowledgedAt:current.acknowledgedAt??null};}

export function buildOperationalAlerts(input,now=new Date()){
  const snapshot=ensureP1Snapshot(input);const result=[];
  for(const rental of snapshot.rentals??[]){
    if(rental.status==='devolucao'||rental.cancelledAt)continue;
    const returnAt=rental.returnAt??rental.returnDate;const days=inDays(returnAt,now);const returnTs=Date.parse(returnAt);
    if(Number.isFinite(returnTs)&&returnTs<now.getTime())result.push({id:`rental-overdue:${rental.id}`,kind:'rental_overdue',severity:'critical',title:`Locação ${rental.id} em atraso`,entityRef:{kind:'rental',id:rental.id},dueAt:returnAt,days});
    else if(days!==null&&days<=1)result.push({id:`rental-due:${rental.id}`,kind:'rental_due',severity:'warning',title:`Devolução próxima: ${rental.id}`,entityRef:{kind:'rental',id:rental.id},dueAt:returnAt,days});
  }
  for(const record of snapshot.maintenance){
    const vehicle=snapshot.vehicles.find(item=>item.id===record.vehicleId);if(maintenanceDue(record,vehicle,now))result.push({id:`maintenance:${record.id}`,kind:'maintenance',severity:'warning',title:`Manutenção vencida: ${vehicle?.model??record.vehicleId}`,entityRef:{kind:'maintenance',id:record.id},dueAt:record.dueAt||now.toISOString()});
  }
  for(const vehicle of snapshot.vehicles){
    for(const [key,label] of [['insuranceExpiry','Seguro'],['licensingExpiry','Licenciamento'],['inspectionExpiry','Inspeção']]){
      const value=vehicle.documents?.[key];const days=inDays(value,now);if(days!==null&&days<=30)result.push({id:`vehicle-doc:${vehicle.id}:${key}`,kind:'vehicle_document',severity:days<0?'critical':'warning',title:`${label} ${days<0?'vencido':'a vencer'}: ${vehicle.model}`,entityRef:{kind:'vehicle',id:vehicle.id},dueAt:value,days});
    }
  }
  for(const customer of snapshot.customers){
    const value=customer.driverLicense?.expiry;const days=inDays(value,now);if(days!==null&&days<=30)result.push({id:`license:${customer.id}`,kind:'driver_license',severity:days<0?'critical':'warning',title:`CNH ${days<0?'vencida':'a vencer'}: ${customer.name}`,entityRef:{kind:'customer',id:customer.id},dueAt:value,days});
  }
  const rank={critical:0,warning:1,info:2};
  return result.map(item=>active(snapshot,item)).filter(Boolean).sort((a,b)=>(rank[a.severity]-rank[b.severity])||(Date.parse(a.dueAt)-Date.parse(b.dueAt)));
}

export function acknowledgeAlert(input,id,actorId){const snapshot=ensureP1Snapshot(input);snapshot.alertState[id]={...(snapshot.alertState[id]??{}),acknowledgedAt:new Date().toISOString(),acknowledgedBy:actorId};snapshot.updatedAt=new Date().toISOString();return snapshot;}
export function dismissAlert(input,id,actorId,reason='Resolvido'){const snapshot=ensureP1Snapshot(input);snapshot.alertState[id]={...(snapshot.alertState[id]??{}),dismissedAt:new Date().toISOString(),dismissedBy:actorId,dismissReason:String(reason)};snapshot.updatedAt=new Date().toISOString();return snapshot;}
