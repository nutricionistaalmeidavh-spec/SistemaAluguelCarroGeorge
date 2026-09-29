import { auditStatement } from './audit.mjs';
import { abandonOperation, beginOperationStatement, completeOperationStatement, findOperationReceipt, operationIdentity } from './operation-receipts.mjs';
import { appendChangeStatement } from '../sync/change-log.mjs';

function fail(code,message=code){const error=new Error(message);error.code=code;throw error;}
function required(value,code){const text=String(value??'').trim();if(!text)fail(code);return text;}
function entityId(value,prefix){const text=String(value??'').trim();if(text&&/^[A-Za-z0-9._:-]{1,120}$/.test(text))return text;return `${prefix}-${crypto.randomUUID()}`;}
function numberOrNull(value){if(value==null||value==='')return null;const parsed=Number(value);if(!Number.isFinite(parsed)||parsed<0)fail('invalid_number');return parsed;}
function normalizeItems(items){
  if(!Array.isArray(items)||items.length<1||items.length>100)fail('invalid_checklist');
  const seen=new Set();return items.map((item,index)=>{
    const key=required(item?.key??item?.itemKey,`checklist_key_required_${index}`),label=required(item?.label,`checklist_label_required_${index}`);
    if(seen.has(key))fail('duplicate_checklist_key');seen.add(key);
    return{id:entityId(item?.id,'CHK'),key,label,done:Boolean(item?.done),evidence:item?.evidence==null?null:String(item.evidence)};
  });
}

export async function createInspectionOperation(context,input,operationId){
  const db=context?.db,auth=context?.auth,installationId=auth?.installationId,userId=auth?.userId;
  if(!db?.prepare||!db?.batch||!installationId||!userId)fail('invalid_context');
  const op=operationIdentity(operationId),previous=await findOperationReceipt(db,installationId,op);if(previous?.result)return{result:previous.result,change:null,replayed:true};
  const rentalId=required(input?.rentalId,'rental_required'),kind=String(input?.kind??'pickup').trim();
  if(!['pickup','return'].includes(kind))fail('invalid_inspection_kind');
  const rental=await db.prepare('SELECT id, vehicle_id, status FROM rentals WHERE installation_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1').bind(installationId,rentalId).first();
  if(!rental)fail('rental_not_found');
  const existing=await db.prepare("SELECT id FROM inspections WHERE installation_id=? AND rental_id=? AND kind=? AND status='completed' AND deleted_at IS NULL LIMIT 1").bind(installationId,rentalId,kind).first();if(existing)fail('inspection_already_exists');
  if(kind==='pickup'&&!['reserva','retirada'].includes(String(rental.status)))fail('pickup_inspection_not_allowed');
  if(kind==='return'){
    if(!['em_uso','devolucao'].includes(String(rental.status)))fail('return_inspection_not_allowed');
    const pickup=await db.prepare("SELECT id FROM inspections WHERE installation_id=? AND rental_id=? AND kind='pickup' AND status='completed' AND deleted_at IS NULL LIMIT 1").bind(installationId,rentalId).first();if(!pickup)fail('pickup_inspection_required');
  }
  const items=normalizeItems(input?.items);if(items.some(item=>!item.done))fail('inspection_checklist_incomplete');
  const inspectionId=entityId(input?.id,'VIS'),now=new Date().toISOString(),executionId=`EXE-${crypto.randomUUID()}`,deviceId=auth.deviceId??null;
  const mileage=numberOrNull(input?.mileage),fuelLevel=input?.fuelLevel==null?null:String(input.fuelLevel),notes=input?.notes==null?'':String(input.notes),damages=Array.isArray(input?.damages)?input.damages:[],status='completed';
  const result={id:inspectionId,rentalId,vehicleId:rental.vehicle_id,kind,status,mileage,fuelLevel,notes,damages,items,completedAt:now,version:1,createdAt:now,updatedAt:now,updatedByDevice:deviceId};
  const receipt=beginOperationStatement(db,{installationId,operationId:op,kind:'inspection.create',executionId,createdAt:now});
  const header=db.prepare(`INSERT INTO inspections
    (id, installation_id, rental_id, vehicle_id, kind, status, mileage, fuel_level, notes, damages_json, completed_at, created_at, updated_at, version, updated_by_device)
    SELECT ?, ?, r.id, r.vehicle_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ? FROM rentals r
    WHERE r.installation_id = ? AND r.id = ? AND r.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM inspections x WHERE x.installation_id=? AND x.rental_id=? AND x.kind=? AND x.status='completed' AND x.deleted_at IS NULL)
      AND EXISTS (SELECT 1 FROM operation_receipts WHERE installation_id = ? AND operation_id = ? AND execution_id = ? AND result_json IS NULL)`)
    .bind(inspectionId,installationId,kind,status,mileage,fuelLevel,notes,JSON.stringify(damages),now,now,now,deviceId,installationId,rentalId,installationId,rentalId,kind,installationId,op,executionId);
  const statements=[receipt,header];
  for(const item of items){
    statements.push(db.prepare(`INSERT INTO inspection_items
      (id, installation_id, inspection_id, item_key, label, done, evidence, created_at, updated_at, version, updated_by_device)
      SELECT ?, ?, i.id, ?, ?, ?, ?, ?, ?, 1, ? FROM inspections i
      WHERE i.installation_id = ? AND i.id = ? AND i.deleted_at IS NULL`)
      .bind(item.id,installationId,item.key,item.label,item.done?1:0,item.evidence,now,now,deviceId,installationId,inspectionId));
  }
  const changeIndex=statements.length;
  statements.push(appendChangeStatement(db,{operationId:op,installationId,deviceId,entityType:'inspection',entityId:inspectionId,operation:'create',entityVersion:1,payload:result,createdAt:now,guardSql:'EXISTS (SELECT 1 FROM inspections WHERE installation_id = ? AND id = ? AND deleted_at IS NULL)',guardParams:[installationId,inspectionId]}));
  statements.push(auditStatement(db,{installationId,actorId:userId,action:'inspection.completed',entityType:'inspection',entityId:inspectionId,details:{rentalId,vehicleId:rental.vehicle_id,kind,itemCount:items.length},deviceId,at:now,guardSql:'EXISTS (SELECT 1 FROM inspections WHERE installation_id = ? AND id = ? AND deleted_at IS NULL)',guardParams:[installationId,inspectionId]}));
  statements.push(completeOperationStatement(db,{installationId,operationId:op,executionId,result,completedAt:now,guardSql:'EXISTS (SELECT 1 FROM inspections WHERE installation_id = ? AND id = ? AND deleted_at IS NULL)',guardParams:[installationId,inspectionId]}));
  const batch=await db.batch(statements);
  if(Number(batch?.[1]?.meta?.changes??0)!==1||Number(batch?.[changeIndex]?.meta?.changes??0)!==1){
    const concurrent=await findOperationReceipt(db,installationId,op);if(concurrent?.result)return{result:concurrent.result,change:null,replayed:true};
    await abandonOperation(db,{installationId,operationId:op,executionId});fail('inspection_conflict');
  }
  return{result,change:{entityType:'inspection',entityId:inspectionId,operation:'create'},replayed:false};
}
