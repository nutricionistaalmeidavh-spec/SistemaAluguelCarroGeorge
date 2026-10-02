import { API_PREFIX } from '../config.mjs';
import { canCloud } from '../auth/permissions.mjs';

const PREFIX=`${API_PREFIX}/summary`;
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};

function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:HEADERS});}
function round(value){return Math.round((Number(value||0)+Number.EPSILON)*100)/100;}
function integer(value,fallback,{min=0,max=500}={}){const n=Number(value);return Number.isInteger(n)&&n>=min?Math.min(n,max):fallback;}
function authOk(auth,permission){return Boolean(auth?.installationId&&auth?.userId&&canCloud(auth,permission));}

async function overviewSummary(db,installationId){
  const now=new Date().toISOString(),[fleet,rentals,finance,performanceRows]=await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN availability='disponivel' THEN 1 ELSE 0 END) AS available,
      SUM(CASE WHEN availability='manutencao' THEN 1 ELSE 0 END) AS maintenance
      FROM vehicles WHERE installation_id=? AND deleted_at IS NULL`).bind(installationId).first(),
    db.prepare(`SELECT COUNT(*) AS openRentals,
      SUM(CASE WHEN status IN ('retirada','em_uso') THEN 1 ELSE 0 END) AS activeRentals,
      SUM(CASE WHEN return_at IS NOT NULL AND return_at < ? AND status!='devolucao' THEN 1 ELSE 0 END) AS overdueRentals
      FROM rentals WHERE installation_id=? AND deleted_at IS NULL AND status!='devolucao'`).bind(now,installationId).first(),
    db.prepare(`SELECT
      SUM(CASE WHEN kind IN ('receivable','billing_receivable') AND status!='cancelled' THEN MAX(amount,paid_amount) ELSE 0 END) AS grossRevenue,
      SUM(CASE WHEN kind IN ('receivable','billing_receivable') AND status!='cancelled' THEN paid_amount ELSE 0 END) AS received,
      SUM(CASE WHEN kind='expense' THEN paid_amount ELSE 0 END) AS expensesPaid,
      SUM(CASE WHEN kind IN ('receivable','billing_receivable') AND status!='cancelled' THEN 1 ELSE 0 END) AS ticketCount
      FROM ledger WHERE installation_id=? AND deleted_at IS NULL`).bind(installationId).first(),
    db.prepare(`WITH rental_counts AS (
        SELECT vehicle_id,COUNT(*) AS rentalCount FROM rentals WHERE installation_id=? AND deleted_at IS NULL GROUP BY vehicle_id
      ), revenue AS (
        SELECT vehicle_id,SUM(paid_amount) AS revenue FROM ledger WHERE installation_id=? AND deleted_at IS NULL AND kind IN ('receivable','billing_receivable') AND status!='cancelled' GROUP BY vehicle_id
      ), expense AS (
        SELECT vehicle_id,SUM(paid_amount) AS expenses FROM ledger WHERE installation_id=? AND deleted_at IS NULL AND kind='expense' GROUP BY vehicle_id
      ), maintenance_cost AS (
        SELECT vehicle_id,SUM(cost) AS maintenanceCost FROM maintenance WHERE installation_id=? AND deleted_at IS NULL AND status='completed' GROUP BY vehicle_id
      )
      SELECT v.id AS vehicleId,v.model,v.plate,COALESCE(rc.rentalCount,0) AS rentalCount,
        COALESCE(rev.revenue,0) AS revenue,COALESCE(exp.expenses,0)+COALESCE(mc.maintenanceCost,0) AS expenses,
        COALESCE(rev.revenue,0)-COALESCE(exp.expenses,0)-COALESCE(mc.maintenanceCost,0) AS margin
      FROM vehicles v LEFT JOIN rental_counts rc ON rc.vehicle_id=v.id LEFT JOIN revenue rev ON rev.vehicle_id=v.id
      LEFT JOIN expense exp ON exp.vehicle_id=v.id LEFT JOIN maintenance_cost mc ON mc.vehicle_id=v.id
      WHERE v.installation_id=? AND v.deleted_at IS NULL ORDER BY margin DESC,v.model LIMIT 20`)
      .bind(installationId,installationId,installationId,installationId,installationId).all()
  ]);
  const fleetTotal=Number(fleet?.total)||0,activeRentals=Number(rentals?.activeRentals)||0,grossRevenue=round(finance?.grossRevenue),received=round(finance?.received),expensesPaid=round(finance?.expensesPaid),ticketCount=Number(finance?.ticketCount)||0;
  return{
    fleetTotal,availableVehicles:Number(fleet?.available)||0,maintenanceVehicles:Number(fleet?.maintenance)||0,
    openRentals:Number(rentals?.openRentals)||0,activeRentals,overdueRentals:Number(rentals?.overdueRentals)||0,
    occupancyRate:fleetTotal?Math.round(activeRentals/fleetTotal*100):0,grossRevenue,received,
    openAmount:round(Math.max(0,grossRevenue-received)),expensesPaid,netCash:round(received-expensesPaid),
    averageTicket:ticketCount?round(grossRevenue/ticketCount):0,
    vehiclePerformance:(performanceRows?.results??[]).map(row=>({...row,rentalCount:Number(row.rentalCount)||0,revenue:round(row.revenue),expenses:round(row.expenses),margin:round(row.margin)}))
  };
}

async function financeSummary(db,installationId){
  const today=new Date();today.setHours(0,0,0,0);const todayIso=today.toISOString();
  const row=await db.prepare(`SELECT
    SUM(CASE WHEN kind IN ('receivable','billing_receivable') AND status!='cancelled' THEN MAX(amount,paid_amount) ELSE 0 END) AS grossRevenue,
    SUM(CASE WHEN kind IN ('receivable','billing_receivable') AND status!='cancelled' THEN paid_amount ELSE 0 END) AS received,
    SUM(CASE WHEN kind='expense' THEN paid_amount ELSE 0 END) AS expensesPaid,
    SUM(CASE WHEN kind IN ('receivable','billing_receivable') AND status!='cancelled' AND due_at IS NOT NULL AND due_at < ? AND amount>paid_amount THEN amount-paid_amount ELSE 0 END) AS overdue,
    SUM(CASE WHEN kind IN ('receivable','billing_receivable') AND status!='cancelled' THEN 1 ELSE 0 END) AS ticketCount
    FROM ledger WHERE installation_id=? AND deleted_at IS NULL`).bind(todayIso,installationId).first();
  const grossRevenue=round(row?.grossRevenue),received=round(row?.received),expensesPaid=round(row?.expensesPaid),ticketCount=Number(row?.ticketCount)||0;
  return{grossRevenue,received,openAmount:round(Math.max(0,grossRevenue-received)),overdue:round(row?.overdue),expensesPaid,netCash:round(received-expensesPaid),averageTicket:ticketCount?round(grossRevenue/ticketCount):0};
}

async function financeReceivables(request,db,installationId){
  const url=new URL(request.url),limit=integer(url.searchParams.get('limit'),30,{min:1,max:100}),offset=integer(url.searchParams.get('offset'),0,{min:0,max:100000}),q=String(url.searchParams.get('q')??'').trim().slice(0,160),params=[installationId],where=[`l.installation_id=?`,`l.deleted_at IS NULL`,`l.kind IN ('receivable','billing_receivable')`,`l.status!='cancelled'`,`l.amount>l.paid_amount`];
  if(q){where.push(`(lower(COALESCE(c.name,'')) LIKE lower(?) OR lower(COALESCE(v.model,'')) LIKE lower(?) OR lower(COALESCE(v.plate,'')) LIKE lower(?) OR lower(COALESCE(l.description,'')) LIKE lower(?) OR lower(COALESCE(l.rental_id,'')) LIKE lower(?))`);for(let i=0;i<5;i++)params.push(`%${q}%`);}
  const sql=`SELECT COALESCE(l.rental_id,l.id) AS groupKey,l.rental_id AS rentalId,MIN(l.id) AS fallbackLedgerId,
      SUM(l.amount) AS amount,SUM(l.paid_amount) AS paidAmount,SUM(CASE WHEN l.amount>l.paid_amount THEN 1 ELSE 0 END) AS openCount,
      MIN(CASE WHEN l.amount>l.paid_amount THEN l.due_at END) AS nextDueAt,r.billing_mode AS billingMode,
      c.name AS customerName,v.model AS vehicleModel,v.plate AS vehiclePlate
    FROM ledger l LEFT JOIN rentals r ON r.installation_id=l.installation_id AND r.id=l.rental_id AND r.deleted_at IS NULL
    LEFT JOIN customers c ON c.installation_id=l.installation_id AND c.id=r.customer_id AND c.deleted_at IS NULL
    LEFT JOIN vehicles v ON v.installation_id=l.installation_id AND v.id=r.vehicle_id AND v.deleted_at IS NULL
    WHERE ${where.join(' AND ')}
    GROUP BY COALESCE(l.rental_id,l.id),l.rental_id,r.billing_mode,c.name,v.model,v.plate
    ORDER BY CASE WHEN MIN(CASE WHEN l.amount>l.paid_amount THEN l.due_at END) IS NULL THEN 1 ELSE 0 END,
      MIN(CASE WHEN l.amount>l.paid_amount THEN l.due_at END),COALESCE(c.name,l.description),COALESCE(l.rental_id,l.id)
    LIMIT ? OFFSET ?`;
  const result=await db.prepare(sql).bind(...params,limit+1,offset).all(),rows=result?.results??[],hasMore=rows.length>limit,items=(hasMore?rows.slice(0,limit):rows).map(row=>({
    key:String(row.groupKey),rentalId:row.rentalId??null,fallbackLedgerId:row.fallbackLedgerId??null,
    amount:round(row.amount),paidAmount:round(row.paidAmount),balance:round(Number(row.amount||0)-Number(row.paidAmount||0)),
    openCount:Number(row.openCount)||0,nextDueAt:row.nextDueAt??null,billingMode:row.billingMode??null,
    customerName:row.customerName??null,vehicleModel:row.vehicleModel??null,vehiclePlate:row.vehiclePlate??null
  }));
  return{items,pagination:{limit,offset,nextOffset:hasMore?offset+items.length:null,hasMore,q}};
}

export function isSummaryRoute(request){const p=new URL(request.url).pathname;return p===PREFIX||p.startsWith(`${PREFIX}/`);}
export async function handleSummaryRoute(request,env,_ctx,{auth=null}={}){
  const p=new URL(request.url).pathname,m=request.method.toUpperCase();if(m!=='GET')return json({ok:false,error:'method_not_allowed'},405);
  if(!auth?.installationId||!auth?.userId)return json({ok:false,error:'unauthorized'},401);
  if(!env?.DB?.prepare)return json({ok:false,error:'database_unavailable'},503);
  try{
    if(p===`${PREFIX}/overview`){if(!authOk(auth,'rental.read'))return json({ok:false,error:'forbidden'},403);return json({ok:true,summary:await overviewSummary(env.DB,auth.installationId)});}
    if(p===`${PREFIX}/finance`){if(!authOk(auth,'finance.read'))return json({ok:false,error:'forbidden'},403);return json({ok:true,summary:await financeSummary(env.DB,auth.installationId)});}
    if(p===`${PREFIX}/finance/receivables`){if(!authOk(auth,'finance.read'))return json({ok:false,error:'forbidden'},403);return json({ok:true,...await financeReceivables(request,env.DB,auth.installationId)});}
    return json({ok:false,error:'not_found'},404);
  }catch(error){console.error('summary route error',error);return json({ok:false,error:error?.message||'internal_error'},500);}
}
