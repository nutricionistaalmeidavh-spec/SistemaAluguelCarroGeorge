import { auditStatement } from './audit.mjs';
import { abandonOperation,beginOperationStatement,completeOperationStatement,findOperationReceipt,operationIdentity } from './operation-receipts.mjs';
import { appendChangeStatement } from '../sync/change-log.mjs';

const DAY=86_400_000;

function fail(code,message=code){const error=new Error(message);error.code=code;throw error;}
function required(value,code){const text=String(value??'').trim();if(!text)fail(code);return text;}
function entityId(value,prefix){const text=String(value??'').trim();return text&&/^[A-Za-z0-9._:-]{1,120}$/.test(text)?text:`${prefix}-${crypto.randomUUID()}`;}
function positive(value,code='invalid_amount'){const number=Number(value);if(!Number.isFinite(number)||number<=0)fail(code);return Math.round((number+Number.EPSILON)*100)/100;}
function nonNegative(value,code='invalid_number'){const number=Number(value??0);if(!Number.isFinite(number)||number<0)fail(code);return Math.round((number+Number.EPSILON)*100)/100;}
function flag(value){return value===false||value===0||value==='0'?0:1;}
function parseJson(value,fallback={}){if(!value)return structuredClone(fallback);try{return typeof value==='string'?JSON.parse(value):structuredClone(value);}catch{return structuredClone(fallback);}}
function addDue(first,frequency,index,customDays){
  const raw=String(first),date=new Date(raw.length<=10?`${raw}T12:00:00Z`:raw);
  if(!Number.isFinite(date.getTime()))fail('invalid_due_date');
  if(index>0){
    if(frequency==='daily')date.setUTCDate(date.getUTCDate()+index);
    else if(frequency==='weekly')date.setUTCDate(date.getUTCDate()+index*7);
    else if(frequency==='custom')date.setUTCDate(date.getUTCDate()+index*Math.max(1,Number(customDays)||1));
    else if(frequency==='monthly'){
      const day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+index);
      const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();date.setUTCDate(Math.min(day,last));
    }else fail('invalid_frequency');
  }
  return raw.length<=10?date.toISOString().slice(0,10):date.toISOString();
}
function renderTemplate(body,context){return String(body??'').replace(/{{\s*([A-Za-z0-9_]+)\s*}}/g,(_match,key)=>String(context[key]??''));}

async function operationBase(context,operationId,kind){
  const db=context?.db,auth=context?.auth,installationId=auth?.installationId,userId=auth?.userId;
  if(!db?.prepare||!db?.batch||!installationId||!userId)fail('invalid_context');
  const op=operationIdentity(operationId),previous=await findOperationReceipt(db,installationId,op);
  return{db,auth,installationId,userId,op,previous,kind,now:new Date().toISOString(),executionId:`EXE-${crypto.randomUUID()}`,deviceId:auth.deviceId??null};
}

async function commitOperation(base,{result,statements=[],requiredIndexes=[],entityType,entityId,operation='create',baseVersion=null,entityVersion=1,auditAction,details={},guardSql='1=1',guardParams=[]}){
  const {db,installationId,userId,op,kind,now,executionId,deviceId}=base;
  const all=[beginOperationStatement(db,{installationId,operationId:op,kind,executionId,createdAt:now}),...statements];
  const offset=1,changeIndex=all.length;
  all.push(appendChangeStatement(db,{operationId:op,installationId,deviceId,entityType,entityId,operation,baseVersion,entityVersion,payload:result,createdAt:now,guardSql,guardParams}));
  all.push(auditStatement(db,{installationId,actorId:userId,action:auditAction,entityType,entityId,details,deviceId,at:now,guardSql,guardParams}));
  all.push(completeOperationStatement(db,{installationId,operationId:op,executionId,result,completedAt:now,guardSql,guardParams}));
  try{
    const batch=await db.batch(all),failed=requiredIndexes.some(index=>Number(batch?.[offset+index]?.meta?.changes??0)!==1);
    if(failed||Number(batch?.[changeIndex]?.meta?.changes??0)!==1)fail('command_conflict');
    return{result,replayed:false};
  }catch(error){
    const concurrent=await findOperationReceipt(db,installationId,op).catch(()=>null);
    if(concurrent?.result)return{result:concurrent.result,replayed:true};
    await abandonOperation(db,{installationId,operationId:op,executionId}).catch(()=>{});
    throw error;
  }
}

async function expenseCreate(context,input,operationId){
  const base=await operationBase(context,operationId,'expense.create');if(base.previous?.result)return{result:base.previous.result,replayed:true};
  const {db,installationId,now,deviceId}=base,id=entityId(input?.id,'DES'),description=required(input?.description,'description_required'),amount=positive(input?.amount),category=String(input?.category??''),dueAt=input?.dueAt?String(input.dueAt):null,paid=flag(input?.paid),vehicleId=input?.vehicleId?String(input.vehicleId):null,ledgerId=`FIN-${crypto.randomUUID()}`;
  if(vehicleId){const vehicle=await db.prepare('SELECT id FROM vehicles WHERE installation_id=? AND id=? AND deleted_at IS NULL LIMIT 1').bind(installationId,vehicleId).first();if(!vehicle)fail('vehicle_not_found');}
  const result={id,vehicleId,description,category,amount,dueAt,paid,version:1,createdAt:now,updatedAt:now,updatedByDevice:deviceId};
  const statements=[
    db.prepare('INSERT INTO expenses(id,installation_id,vehicle_id,description,category,amount,due_at,paid,created_at,updated_at,version,updated_by_device) VALUES(?,?,?,?,?,?,?,?,?,?,1,?)').bind(id,installationId,vehicleId,description,category,amount,dueAt,paid,now,now,deviceId),
    db.prepare("INSERT INTO ledger(id,installation_id,kind,expense_id,vehicle_id,description,amount,paid_amount,status,due_at,paid_at,created_at,updated_at,version,updated_by_device) VALUES(?,?,'expense',?,?,?,?,?,?,?,?,?,?,1,?)").bind(ledgerId,installationId,id,vehicleId,description,amount,paid?amount:0,paid?'paid':'open',dueAt,paid?now:null,now,now,deviceId)
  ];
  return commitOperation(base,{result,statements,requiredIndexes:[0,1],entityType:'expense',entityId:id,auditAction:'expense.created',details:{amount,category,vehicleId},guardSql:'EXISTS (SELECT 1 FROM expenses WHERE installation_id=? AND id=? AND deleted_at IS NULL)',guardParams:[installationId,id]});
}

async function expenseUpdate(context,input,operationId){
  const base=await operationBase(context,operationId,'expense.update');if(base.previous?.result)return{result:base.previous.result,replayed:true};
  const {db,installationId,now,deviceId}=base,id=required(input?.id,'expense_required'),expectedVersion=Number(input?.expectedVersion);if(!Number.isInteger(expectedVersion)||expectedVersion<1)fail('expected_version_required');
  const row=await db.prepare('SELECT * FROM expenses WHERE installation_id=? AND id=? AND deleted_at IS NULL LIMIT 1').bind(installationId,id).first();if(!row)fail('expense_not_found');if(Number(row.version)!==expectedVersion)fail('version_conflict');
  const description=input.description==null?row.description:required(input.description,'description_required'),category=input.category==null?row.category:String(input.category),amount=input.amount==null?Number(row.amount):positive(input.amount),dueAt=input.dueAt===undefined?row.due_at:(input.dueAt?String(input.dueAt):null),paid=input.paid===undefined?Number(row.paid):flag(input.paid),vehicleId=input.vehicleId===undefined?row.vehicle_id:(input.vehicleId?String(input.vehicleId):null),nextVersion=expectedVersion+1;
  const result={id,vehicleId,description,category,amount,dueAt,paid,version:nextVersion,updatedAt:now,updatedByDevice:deviceId};
  const statements=[
    db.prepare('UPDATE expenses SET vehicle_id=?,description=?,category=?,amount=?,due_at=?,paid=?,updated_at=?,version=version+1,updated_by_device=? WHERE installation_id=? AND id=? AND version=? AND deleted_at IS NULL').bind(vehicleId,description,category,amount,dueAt,paid,now,deviceId,installationId,id,expectedVersion),
    db.prepare("UPDATE ledger SET vehicle_id=?,description=?,amount=?,paid_amount=?,status=?,due_at=?,paid_at=?,updated_at=?,version=version+1,updated_by_device=? WHERE installation_id=? AND expense_id=? AND kind='expense' AND deleted_at IS NULL").bind(vehicleId,description,amount,paid?amount:0,paid?'paid':'open',dueAt,paid?now:null,now,deviceId,installationId,id)
  ];
  return commitOperation(base,{result,statements,requiredIndexes:[0,1],entityType:'expense',entityId:id,operation:'update',baseVersion:expectedVersion,entityVersion:nextVersion,auditAction:'expense.updated',guardSql:'EXISTS (SELECT 1 FROM expenses WHERE installation_id=? AND id=? AND version=?)',guardParams:[installationId,id,nextVersion]});
}

async function expenseDelete(context,input,operationId){
  const base=await operationBase(context,operationId,'expense.delete');if(base.previous?.result)return{result:base.previous.result,replayed:true};
  const {db,installationId,now,deviceId}=base,id=required(input?.id,'expense_required'),expectedVersion=Number(input?.expectedVersion);if(!Number.isInteger(expectedVersion)||expectedVersion<1)fail('expected_version_required');
  const row=await db.prepare('SELECT version FROM expenses WHERE installation_id=? AND id=? AND deleted_at IS NULL LIMIT 1').bind(installationId,id).first();if(!row)fail('expense_not_found');if(Number(row.version)!==expectedVersion)fail('version_conflict');
  const result={id,deleted:true,version:expectedVersion+1,updatedAt:now};
  const statements=[
    db.prepare('UPDATE expenses SET deleted_at=?,updated_at=?,version=version+1,updated_by_device=? WHERE installation_id=? AND id=? AND version=? AND deleted_at IS NULL').bind(now,now,deviceId,installationId,id,expectedVersion),
    db.prepare("UPDATE ledger SET deleted_at=?,status='cancelled',updated_at=?,version=version+1,updated_by_device=? WHERE installation_id=? AND expense_id=? AND kind='expense' AND deleted_at IS NULL").bind(now,now,deviceId,installationId,id)
  ];
  return commitOperation(base,{result,statements,requiredIndexes:[0,1],entityType:'expense',entityId:id,operation:'delete',baseVersion:expectedVersion,entityVersion:expectedVersion+1,auditAction:'expense.deleted',guardSql:'EXISTS (SELECT 1 FROM expenses WHERE installation_id=? AND id=? AND deleted_at=?)',guardParams:[installationId,id,now]});
}

async function billingPlanCreate(context,input,operationId){
  const base=await operationBase(context,operationId,'billing.plan.create');if(base.previous?.result)return{result:base.previous.result,replayed:true};
  const {db,installationId,now,deviceId}=base,id=entityId(input?.id,'COB'),rentalId=required(input?.rentalId,'rental_required'),frequency=String(input?.frequency??'monthly');
  if(!['daily','weekly','monthly','custom'].includes(frequency))fail('invalid_frequency');
  const customDays=frequency==='custom'?Number(input?.customDays):null;if(frequency==='custom'&&(!Number.isInteger(customDays)||customDays<1||customDays>365))fail('invalid_custom_days');
  const amount=positive(input?.amount),occurrences=Number(input?.occurrences);if(!Number.isInteger(occurrences)||occurrences<1||occurrences>120)fail('invalid_occurrences');
  const firstDueAt=required(input?.firstDueAt,'first_due_at_required'),finePercent=nonNegative(input?.finePercent,'invalid_fine_percent'),interestMonthlyPercent=nonNegative(input?.interestMonthlyPercent,'invalid_interest_percent');addDue(firstDueAt,frequency,0,customDays);
  const rental=await db.prepare('SELECT id,customer_id,vehicle_id FROM rentals WHERE installation_id=? AND id=? AND deleted_at IS NULL LIMIT 1').bind(installationId,rentalId).first();if(!rental)fail('rental_not_found');
  const installmentIds=Array.from({length:occurrences},()=>`PAR-${crypto.randomUUID()}`),result={id,rentalId,customerId:rental.customer_id,vehicleId:rental.vehicle_id,purpose:String(input?.purpose??'additional'),frequency,customDays,amount,occurrences,firstDueAt,finePercent,interestMonthlyPercent,active:1,installmentIds,version:1,createdAt:now,updatedAt:now};
  const statements=[db.prepare("INSERT INTO billing_plans(id,installation_id,rental_id,customer_id,vehicle_id,purpose,frequency,custom_days,amount,occurrences,first_due_at,fine_percent,interest_monthly_percent,active,generation_mode,created_at,updated_at,version,updated_by_device) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,'fixed',?,?,1,?)").bind(id,installationId,rentalId,rental.customer_id,rental.vehicle_id,result.purpose,frequency,customDays,amount,occurrences,firstDueAt,finePercent,interestMonthlyPercent,now,now,deviceId)],requiredIndexes=[0];
  for(let index=0;index<occurrences;index++){
    const installmentId=installmentIds[index],dueAt=addDue(firstDueAt,frequency,index,customDays),installIndex=statements.length;
    statements.push(db.prepare("INSERT INTO billing_installments(id,installation_id,plan_id,rental_id,customer_id,vehicle_id,sequence,due_at,amount,paid_amount,status,fine_percent,interest_monthly_percent,sync_conflict,created_at,updated_at,version,updated_by_device) VALUES(?,?,?,?,?,?,?,?,?,0,'open',?,?,0,?,?,1,?)").bind(installmentId,installationId,id,rentalId,rental.customer_id,rental.vehicle_id,index+1,dueAt,amount,finePercent,interestMonthlyPercent,now,now,deviceId));requiredIndexes.push(installIndex);
    const ledgerIndex=statements.length;
    statements.push(db.prepare("INSERT INTO ledger(id,installation_id,kind,billing_purpose,rental_id,installment_id,vehicle_id,description,amount,paid_amount,status,due_at,created_at,updated_at,version,updated_by_device) VALUES(?,?,'billing_receivable',?,?,?,?,?,?,0,'open',?,?,?,1,?)").bind(`FIN-${crypto.randomUUID()}`,installationId,result.purpose,rentalId,installmentId,rental.vehicle_id,`Cobrança ${id} parcela ${index+1}`,amount,dueAt,now,now,deviceId));requiredIndexes.push(ledgerIndex);
  }
  return commitOperation(base,{result,statements,requiredIndexes,entityType:'billingPlan',entityId:id,auditAction:'billing.plan.created',details:{rentalId,occurrences,amount},guardSql:'EXISTS (SELECT 1 FROM billing_plans WHERE installation_id=? AND id=? AND deleted_at IS NULL)',guardParams:[installationId,id]});
}

async function collectionActionCreate(context,input,operationId){
  const base=await operationBase(context,operationId,'collectionAction.create');if(base.previous?.result)return{result:base.previous.result,replayed:true};
  const {db,installationId,userId,now,deviceId}=base,id=entityId(input?.id,'COL'),installmentId=required(input?.installmentId,'installment_required'),channel=required(input?.channel,'channel_required'),note=required(input?.note,'note_required');
  const row=await db.prepare('SELECT id,rental_id,customer_id FROM billing_installments WHERE installation_id=? AND id=? AND deleted_at IS NULL LIMIT 1').bind(installationId,installmentId).first();if(!row)fail('installment_not_found');
  const promiseAt=input?.promiseAt?String(input.promiseAt):null,nextActionAt=input?.nextActionAt?String(input.nextActionAt):null,result={id,installmentId,rentalId:row.rental_id,customerId:row.customer_id,channel,note,promiseAt,nextActionAt,actorId:userId,version:1,createdAt:now,updatedAt:now};
  const statements=[db.prepare('INSERT INTO collection_actions(id,installation_id,installment_id,rental_id,customer_id,channel,note,promise_at,next_action_at,actor_id,created_at,updated_at,version,updated_by_device) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?)').bind(id,installationId,installmentId,row.rental_id,row.customer_id,channel,note,promiseAt,nextActionAt,userId,now,now,deviceId)];
  return commitOperation(base,{result,statements,requiredIndexes:[0],entityType:'collectionAction',entityId:id,auditAction:'collection.action.created',details:{installmentId,channel},guardSql:'EXISTS (SELECT 1 FROM collection_actions WHERE installation_id=? AND id=? AND deleted_at IS NULL)',guardParams:[installationId,id]});
}

async function maintenanceCreate(context,input,operationId){
  const base=await operationBase(context,operationId,'maintenance.create');if(base.previous?.result)return{result:base.previous.result,replayed:true};
  const {db,installationId,now,deviceId}=base,id=entityId(input?.id,'MNT'),vehicleId=required(input?.vehicleId,'vehicle_required'),type=required(input?.type,'type_required');
  const vehicle=await db.prepare('SELECT id FROM vehicles WHERE installation_id=? AND id=? AND deleted_at IS NULL LIMIT 1').bind(installationId,vehicleId).first();if(!vehicle)fail('vehicle_not_found');
  const result={id,vehicleId,type,dueAt:input?.dueAt?String(input.dueAt):null,dueMileage:input?.dueMileage==null||input.dueMileage===''?null:nonNegative(input.dueMileage,'invalid_due_mileage'),notes:String(input?.notes??''),costEstimate:nonNegative(input?.costEstimate,'invalid_cost_estimate'),status:'scheduled',startedAt:null,completedAt:null,cost:0,version:1,createdAt:now,updatedAt:now};
  const statements=[db.prepare("INSERT INTO maintenance(id,installation_id,vehicle_id,type,due_at,due_mileage,notes,cost_estimate,status,cost,created_at,updated_at,version,updated_by_device) VALUES(?,?,?,?,?,?,?,?,'scheduled',0,?,?,1,?)").bind(id,installationId,vehicleId,type,result.dueAt,result.dueMileage,result.notes,result.costEstimate,now,now,deviceId)];
  return commitOperation(base,{result,statements,requiredIndexes:[0],entityType:'maintenance',entityId:id,auditAction:'maintenance.scheduled',details:{vehicleId,type},guardSql:'EXISTS (SELECT 1 FROM maintenance WHERE installation_id=? AND id=? AND deleted_at IS NULL)',guardParams:[installationId,id]});
}

async function maintenanceStart(context,input,operationId){
  const base=await operationBase(context,operationId,'maintenance.start');if(base.previous?.result)return{result:base.previous.result,replayed:true};
  const {db,installationId,now,deviceId}=base,id=required(input?.id,'maintenance_required'),row=await db.prepare('SELECT * FROM maintenance WHERE installation_id=? AND id=? AND deleted_at IS NULL LIMIT 1').bind(installationId,id).first();if(!row)fail('maintenance_not_found');if(row.status!=='scheduled')fail('invalid_maintenance_transition');
  const result={id,vehicleId:row.vehicle_id,type:row.type,status:'in_progress',startedAt:now,costEstimate:Number(row.cost_estimate||0),version:Number(row.version||1)+1,updatedAt:now};
  const statements=[
    db.prepare("UPDATE maintenance SET status='in_progress',started_at=?,updated_at=?,version=version+1,updated_by_device=? WHERE installation_id=? AND id=? AND status='scheduled' AND version=? AND deleted_at IS NULL").bind(now,now,deviceId,installationId,id,Number(row.version||1)),
    db.prepare("UPDATE vehicles SET availability='manutencao',updated_at=?,version=version+1,updated_by_device=? WHERE installation_id=? AND id=? AND deleted_at IS NULL").bind(now,deviceId,installationId,row.vehicle_id)
  ];
  return commitOperation(base,{result,statements,requiredIndexes:[0,1],entityType:'maintenance',entityId:id,operation:'update',baseVersion:Number(row.version||1),entityVersion:result.version,auditAction:'maintenance.started',details:{vehicleId:row.vehicle_id},guardSql:"EXISTS (SELECT 1 FROM maintenance WHERE installation_id=? AND id=? AND status='in_progress')",guardParams:[installationId,id]});
}

async function maintenanceComplete(context,input,operationId){
  const base=await operationBase(context,operationId,'maintenance.complete');if(base.previous?.result)return{result:base.previous.result,replayed:true};
  const {db,installationId,now,deviceId}=base,id=required(input?.id,'maintenance_required'),row=await db.prepare('SELECT * FROM maintenance WHERE installation_id=? AND id=? AND deleted_at IS NULL LIMIT 1').bind(installationId,id).first();if(!row)fail('maintenance_not_found');if(row.status!=='in_progress')fail('invalid_maintenance_transition');
  const cost=nonNegative(input?.cost,'invalid_cost'),mileage=input?.mileage==null||input.mileage===''?null:nonNegative(input.mileage,'invalid_mileage'),notes=input?.notes==null?row.notes:String(input.notes),expenseId=cost>0?`DES-${crypto.randomUUID()}`:null,ledgerId=cost>0?`FIN-${crypto.randomUUID()}`:null;
  const result={id,vehicleId:row.vehicle_id,type:row.type,status:'completed',startedAt:row.started_at,completedAt:now,cost,notes,version:Number(row.version||1)+1,updatedAt:now,expenseId};
  const statements=[
    db.prepare("UPDATE maintenance SET status='completed',completed_at=?,cost=?,notes=?,updated_at=?,version=version+1,updated_by_device=? WHERE installation_id=? AND id=? AND status='in_progress' AND version=? AND deleted_at IS NULL").bind(now,cost,notes,now,deviceId,installationId,id,Number(row.version||1)),
    db.prepare("UPDATE vehicles SET availability=CASE WHEN EXISTS(SELECT 1 FROM maintenance m WHERE m.installation_id=? AND m.vehicle_id=vehicles.id AND m.id<>? AND m.status IN ('scheduled','in_progress') AND m.deleted_at IS NULL) THEN 'manutencao' ELSE 'disponivel' END,mileage=CASE WHEN ? IS NULL THEN mileage ELSE MAX(mileage,?) END,updated_at=?,version=version+1,updated_by_device=? WHERE installation_id=? AND id=? AND deleted_at IS NULL").bind(installationId,id,mileage,mileage,now,deviceId,installationId,row.vehicle_id)
  ],requiredIndexes=[0,1];
  if(cost>0){
    const expenseIndex=statements.length;statements.push(db.prepare("INSERT INTO expenses(id,installation_id,vehicle_id,description,category,amount,due_at,paid,created_at,updated_at,version,updated_by_device) VALUES(?,?,?,?,'Manutenção',?,?,1,?,?,1,?)").bind(expenseId,installationId,row.vehicle_id,`Manutenção ${row.type}`,cost,now,now,now,deviceId));requiredIndexes.push(expenseIndex);
    const ledgerIndex=statements.length;statements.push(db.prepare("INSERT INTO ledger(id,installation_id,kind,expense_id,vehicle_id,description,amount,paid_amount,status,due_at,paid_at,created_at,updated_at,version,updated_by_device) VALUES(?,?,'expense',?,?,?,?,?,'paid',?,?,?,?,1,?)").bind(ledgerId,installationId,expenseId,row.vehicle_id,`Manutenção ${row.type}`,cost,cost,now,now,now,now,deviceId));requiredIndexes.push(ledgerIndex);
  }
  return commitOperation(base,{result,statements,requiredIndexes,entityType:'maintenance',entityId:id,operation:'update',baseVersion:Number(row.version||1),entityVersion:result.version,auditAction:'maintenance.completed',details:{vehicleId:row.vehicle_id,cost,mileage},guardSql:"EXISTS (SELECT 1 FROM maintenance WHERE installation_id=? AND id=? AND status='completed')",guardParams:[installationId,id]});
}

async function contractTemplateCreate(context,input,operationId){
  const base=await operationBase(context,operationId,'contract.template.create');if(base.previous?.result)return{result:base.previous.result,replayed:true};
  const {db,installationId,now,deviceId}=base,id=entityId(input?.id,'TPL'),name=required(input?.name,'name_required'),body=required(input?.body,'body_required'),isDefault=flag(input?.isDefault),result={id,name,body,active:1,isDefault,templateVersion:1,version:1,createdAt:now,updatedAt:now};
  const statements=[];if(isDefault)statements.push(db.prepare('UPDATE contract_templates SET is_default=0,updated_at=?,version=version+1,updated_by_device=? WHERE installation_id=? AND is_default=1 AND deleted_at IS NULL').bind(now,deviceId,installationId));
  const insertIndex=statements.length;statements.push(db.prepare('INSERT INTO contract_templates(id,installation_id,name,body,active,is_default,template_version,created_at,updated_at,version,updated_by_device) VALUES(?,?,?,?,1,?,1,?,?,1,?)').bind(id,installationId,name,body,isDefault,now,now,deviceId));
  return commitOperation(base,{result,statements,requiredIndexes:[insertIndex],entityType:'contractTemplate',entityId:id,auditAction:'contract.template.created',guardSql:'EXISTS (SELECT 1 FROM contract_templates WHERE installation_id=? AND id=? AND deleted_at IS NULL)',guardParams:[installationId,id]});
}

async function contractTemplateUpdate(context,input,operationId){
  const base=await operationBase(context,operationId,'contract.template.update');if(base.previous?.result)return{result:base.previous.result,replayed:true};
  const {db,installationId,now,deviceId}=base,id=required(input?.id,'template_required'),expectedVersion=Number(input?.expectedVersion),row=await db.prepare('SELECT * FROM contract_templates WHERE installation_id=? AND id=? AND deleted_at IS NULL LIMIT 1').bind(installationId,id).first();if(!row)fail('template_not_found');if(!Number.isInteger(expectedVersion)||Number(row.version)!==expectedVersion)fail('version_conflict');
  const name=input.name==null?row.name:required(input.name,'name_required'),body=input.body==null?row.body:required(input.body,'body_required'),active=input.active==null?Number(row.active):flag(input.active),isDefault=input.isDefault==null?Number(row.is_default):flag(input.isDefault),nextVersion=expectedVersion+1,templateVersion=Number(row.template_version||1)+(body!==row.body?1:0),result={id,name,body,active,isDefault,templateVersion,version:nextVersion,updatedAt:now};
  const statements=[];if(isDefault)statements.push(db.prepare('UPDATE contract_templates SET is_default=0,updated_at=?,version=version+1,updated_by_device=? WHERE installation_id=? AND id<>? AND is_default=1 AND deleted_at IS NULL').bind(now,deviceId,installationId,id));
  const updateIndex=statements.length;statements.push(db.prepare('UPDATE contract_templates SET name=?,body=?,active=?,is_default=?,template_version=?,updated_at=?,version=version+1,updated_by_device=? WHERE installation_id=? AND id=? AND version=? AND deleted_at IS NULL').bind(name,body,active,isDefault,templateVersion,now,deviceId,installationId,id,expectedVersion));
  return commitOperation(base,{result,statements,requiredIndexes:[updateIndex],entityType:'contractTemplate',entityId:id,operation:'update',baseVersion:expectedVersion,entityVersion:nextVersion,auditAction:'contract.template.updated',guardSql:'EXISTS (SELECT 1 FROM contract_templates WHERE installation_id=? AND id=? AND version=?)',guardParams:[installationId,id,nextVersion]});
}

async function contractTemplateDuplicate(context,input,operationId){
  const {db,installationId}=await operationBase(context,operationId,'contract.template.duplicate'),sourceId=required(input?.sourceId??input?.templateId,'template_required');
  const source=await db.prepare('SELECT * FROM contract_templates WHERE installation_id=? AND id=? AND deleted_at IS NULL LIMIT 1').bind(installationId,sourceId).first();if(!source)fail('template_not_found');
  return contractTemplateCreate(context,{id:input?.id,name:input?.name||`${source.name} (cópia)`,body:source.body,isDefault:false},operationId);
}
async function contractTemplateDeactivate(context,input,operationId){return contractTemplateUpdate(context,{id:input?.id??input?.templateId,expectedVersion:input?.expectedVersion,active:false,isDefault:false},operationId);}

async function contractIssue(context,input,operationId){
  const base=await operationBase(context,operationId,'contract.issue');if(base.previous?.result)return{result:base.previous.result,replayed:true};
  const {db,installationId,now,deviceId}=base,id=entityId(input?.id,'CTR'),rentalId=required(input?.rentalId,'rental_required'),templateId=required(input?.templateId,'template_required');
  const template=await db.prepare('SELECT * FROM contract_templates WHERE installation_id=? AND id=? AND active=1 AND deleted_at IS NULL LIMIT 1').bind(installationId,templateId).first();if(!template)fail('template_not_found');
  const row=await db.prepare('SELECT r.*,c.name AS customer_name,c.document AS customer_document,v.model AS vehicle_model,v.plate AS vehicle_plate FROM rentals r JOIN customers c ON c.installation_id=r.installation_id AND c.id=r.customer_id JOIN vehicles v ON v.installation_id=r.installation_id AND v.id=r.vehicle_id WHERE r.installation_id=? AND r.id=? AND r.deleted_at IS NULL LIMIT 1').bind(installationId,rentalId).first();if(!row)fail('rental_not_found');
  const renderedText=renderTemplate(template.body,{rentalId,customerName:row.customer_name,customerDocument:row.customer_document??'',vehicle:row.vehicle_model,vehicleModel:row.vehicle_model,plate:row.vehicle_plate,vehiclePlate:row.vehicle_plate,pickupAt:row.pickup_at,returnAt:row.return_at??'',total:Number(row.total||0).toFixed(2)}),result={id,rentalId,templateId,templateName:template.name,templateVersion:Number(template.template_version||1),renderedText,version:1,createdAt:now,updatedAt:now};
  const statements=[db.prepare('INSERT INTO issued_contracts(id,installation_id,rental_id,template_id,template_name,template_version,rendered_text,created_at,updated_at,version,updated_by_device) VALUES(?,?,?,?,?,?,?,?,?,1,?)').bind(id,installationId,rentalId,templateId,template.name,result.templateVersion,renderedText,now,now,deviceId)];
  return commitOperation(base,{result,statements,requiredIndexes:[0],entityType:'issuedContract',entityId:id,auditAction:'contract.issued',details:{rentalId,templateId},guardSql:'EXISTS (SELECT 1 FROM issued_contracts WHERE installation_id=? AND id=? AND deleted_at IS NULL)',guardParams:[installationId,id]});
}

async function alertMutation(context,input,operationId,mode){
  const base=await operationBase(context,operationId,`alert.${mode}`);if(base.previous?.result)return{result:base.previous.result,replayed:true};
  const {db,installationId,userId,now,deviceId}=base,alertId=required(input?.alertId,'alert_required'),row=await db.prepare('SELECT * FROM alert_state WHERE installation_id=? AND deleted_at IS NULL LIMIT 1').bind(installationId).first(),state=parseJson(row?.state_json,{}),current=state[alertId]??{};
  if(mode==='acknowledge')state[alertId]={...current,acknowledgedAt:now,acknowledgedBy:userId};else state[alertId]={...current,dismissedAt:now,dismissedBy:userId,dismissReason:String(input?.reason??'Resolvido')};
  const id=row?.id??`ALTSTATE-${installationId}`.slice(0,120),version=row?Number(row.version||1)+1:1,result={id,stateJson:JSON.stringify(state),state,version,updatedAt:now};
  const statements=[row?db.prepare('UPDATE alert_state SET state_json=?,updated_at=?,version=version+1,updated_by_device=? WHERE installation_id=? AND id=? AND version=? AND deleted_at IS NULL').bind(result.stateJson,now,deviceId,installationId,id,Number(row.version||1)):db.prepare('INSERT INTO alert_state(id,installation_id,state_json,created_at,updated_at,version,updated_by_device) VALUES(?,?,?,?,?,1,?)').bind(id,installationId,result.stateJson,now,now,deviceId)];
  return commitOperation(base,{result,statements,requiredIndexes:[0],entityType:'alertState',entityId:id,operation:row?'update':'create',baseVersion:row?Number(row.version||1):null,entityVersion:version,auditAction:`alert.${mode}`,details:{alertId},guardSql:'EXISTS (SELECT 1 FROM alert_state WHERE installation_id=? AND id=? AND version=?)',guardParams:[installationId,id,version]});
}

const COMMANDS=Object.freeze({
  'expense.create':expenseCreate,'expense.update':expenseUpdate,'expense.delete':expenseDelete,
  'billing.plan.create':billingPlanCreate,'collectionAction.create':collectionActionCreate,
  'maintenance.create':maintenanceCreate,'maintenance.start':maintenanceStart,'maintenance.complete':maintenanceComplete,
  'contract.template.create':contractTemplateCreate,'contract.template.update':contractTemplateUpdate,'contract.template.duplicate':contractTemplateDuplicate,'contract.template.deactivate':contractTemplateDeactivate,'contract.issue':contractIssue,
  'alert.acknowledge':(context,input,operationId)=>alertMutation(context,input,operationId,'acknowledge'),
  'alert.dismiss':(context,input,operationId)=>alertMutation(context,input,operationId,'dismiss')
});

export function hasParityCommand(kind){return Object.hasOwn(COMMANDS,String(kind));}
export async function executeParityCommand(context,kind,input,operationId){const handler=COMMANDS[String(kind)];if(!handler)fail('unsupported_command');return handler(context,input??{},operationId);}
