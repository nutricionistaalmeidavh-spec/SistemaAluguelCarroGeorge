import { auditStatement } from './audit.mjs';
import { abandonOperation,beginOperationStatement,completeOperationStatement,findOperationReceipt,operationIdentity } from './operation-receipts.mjs';
import { appendChangeStatement } from '../sync/change-log.mjs';

function fail(code){const error=new Error(code);error.code=code;throw error;}
function required(value,code){const text=String(value??'').trim();if(!text)fail(code);return text;}
function safeId(value,prefix){const text=String(value??'').trim();return text&&/^[A-Za-z0-9._:-]{1,120}$/.test(text)?text:`${prefix}-${crypto.randomUUID()}`;}
function parse(value,fallback={}){if(value==null||value==='')return structuredClone(fallback);try{return typeof value==='string'?JSON.parse(value):structuredClone(value);}catch{return structuredClone(fallback);}}
function money(value){return Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
function nested(source,path){return String(path).split('.').reduce((current,key)=>current?.[key],source);}
function render(body,variables){const unknown=[];const text=String(body??'').replace(/{{\s*([\w.]+)\s*}}/g,(_match,path)=>{const value=nested(variables,path);if(value==null){if(!unknown.includes(path))unknown.push(path);return`[${path}]`;}return String(value);});return{text,unknown};}

export async function issueContractParity(context,input,operationId){
  const db=context?.db,auth=context?.auth,installationId=auth?.installationId,userId=auth?.userId;if(!db?.prepare||!db?.batch||!installationId||!userId)fail('invalid_context');
  const op=operationIdentity(operationId),previous=await findOperationReceipt(db,installationId,op);if(previous?.result)return{result:previous.result,replayed:true};
  const id=safeId(input?.id,'EMI'),rentalId=required(input?.rentalId,'rental_required'),templateId=required(input?.templateId,'template_required');
  const template=await db.prepare('SELECT * FROM contract_templates WHERE installation_id=? AND id=? AND active=1 AND deleted_at IS NULL LIMIT 1').bind(installationId,templateId).first();if(!template)fail('template_not_found');
  const row=await db.prepare(`SELECT r.*,c.name AS customer_name,c.document AS customer_document,c.phone AS customer_phone,c.email AS customer_email,c.address AS customer_address,c.driver_license_json AS driver_license_json,v.model AS vehicle_model,v.plate AS vehicle_plate,v.year AS vehicle_year,v.color AS vehicle_color,v.category AS vehicle_category,v.mileage AS vehicle_mileage,v.documents_json AS vehicle_documents,u.name AS attendant_name,u.username AS attendant_username
    FROM rentals r
    JOIN customers c ON c.installation_id=r.installation_id AND c.id=r.customer_id AND c.deleted_at IS NULL
    JOIN vehicles v ON v.installation_id=r.installation_id AND v.id=r.vehicle_id AND v.deleted_at IS NULL
    LEFT JOIN users u ON u.installation_id=r.installation_id AND u.id=r.attendant_id AND u.deleted_at IS NULL
    WHERE r.installation_id=? AND r.id=? AND r.deleted_at IS NULL LIMIT 1`).bind(installationId,rentalId).first();if(!row)fail('rental_not_found');
  const settingsRow=await db.prepare('SELECT settings_json FROM app_settings WHERE installation_id=? AND deleted_at IS NULL LIMIT 1').bind(installationId).first(),settings=parse(settingsRow?.settings_json,{}),license=parse(row.driver_license_json,{}),documents=parse(row.vehicle_documents,{});
  const variables={
    locadora:{nome:settings.companyName??'',documento:settings.document??'',telefone:settings.phone??'',endereco:settings.address??''},
    cliente:{nome:row.customer_name??'',cpf:row.customer_document??'',documento:row.customer_document??'',telefone:row.customer_phone??'',email:row.customer_email??'',endereco:row.customer_address??'',cnh:license.number??'',categoria_cnh:license.category??''},
    veiculo:{modelo:row.vehicle_model??'',placa:row.vehicle_plate??'',ano:row.vehicle_year??'',cor:row.vehicle_color??'',categoria:row.vehicle_category??'',km:row.vehicle_mileage??'',renavam:documents.renavam??'',chassi:documents.chassis??''},
    locacao:{id:row.id,retirada:row.pickup_at??'',devolucao:row.return_at??'',valor_diaria:money(row.daily_rate),valor_total:money(row.total),dias:row.days??'',status:row.status??'',observacoes:row.notes??''},
    atendente:{nome:row.attendant_name??'',usuario:row.attendant_username??''}
  };
  const rendered=render(template.body,variables);if(rendered.unknown.length)fail('unknown_contract_variables');
  const now=new Date().toISOString(),executionId=`EXE-${crypto.randomUUID()}`,deviceId=auth.deviceId??null,result={id,rentalId,templateId,templateName:template.name,templateVersion:Number(template.template_version||1),renderedText:rendered.text,version:1,createdAt:now,updatedAt:now};
  const insert=db.prepare('INSERT INTO issued_contracts(id,installation_id,rental_id,template_id,template_name,template_version,rendered_text,created_at,updated_at,version,updated_by_device) VALUES(?,?,?,?,?,?,?,?,?,1,?)').bind(id,installationId,rentalId,templateId,template.name,Number(template.template_version||1),rendered.text,now,now,deviceId),guard='EXISTS (SELECT 1 FROM issued_contracts WHERE installation_id=? AND id=? AND deleted_at IS NULL)',guardParams=[installationId,id],statements=[beginOperationStatement(db,{installationId,operationId:op,kind:'contract.issue',executionId,createdAt:now}),insert,appendChangeStatement(db,{operationId:op,installationId,deviceId,entityType:'issuedContract',entityId:id,operation:'create',entityVersion:1,payload:result,createdAt:now,guardSql:guard,guardParams}),auditStatement(db,{installationId,actorId:userId,action:'contract.issued',entityType:'issued_contract',entityId:id,details:{rentalId,templateId,templateVersion:result.templateVersion},deviceId,at:now,guardSql:guard,guardParams}),completeOperationStatement(db,{installationId,operationId:op,executionId,result,completedAt:now,guardSql:guard,guardParams})];
  const batch=await db.batch(statements);if(Number(batch?.[1]?.meta?.changes??0)!==1||Number(batch?.[2]?.meta?.changes??0)!==1){const replay=await findOperationReceipt(db,installationId,op);if(replay?.result)return{result:replay.result,replayed:true};await abandonOperation(db,{installationId,operationId:op,executionId});fail('command_conflict');}
  return{result,replayed:false};
}
