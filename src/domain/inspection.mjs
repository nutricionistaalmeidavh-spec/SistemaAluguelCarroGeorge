import { appendAudit, ensureP1Snapshot, nextEntityId } from './p1.mjs';

export const DEFAULT_INSPECTION_ITEMS=[
  ['documents','Documentos e CNH conferidos'],
  ['mileage','Quilometragem registrada'],
  ['fuel','Nível de combustível registrado'],
  ['exterior','Lataria, vidros e pintura conferidos'],
  ['tires','Pneus e estepe conferidos'],
  ['lights','Faróis, lanternas e sinalização conferidos'],
  ['interior','Interior e acessórios conferidos'],
  ['photos','Fotos do veículo anexadas']
];

function inspection(snapshot,id){const found=snapshot.inspections.find(item=>item.id===id);if(!found)throw new Error('Vistoria não encontrada.');return found;}

export function createInspection(input,{rentalId,kind='checkout'}={},actorId){
  const snapshot=ensureP1Snapshot(input);
  if(!['checkout','return'].includes(kind))throw new Error('Tipo de vistoria inválido.');
  const rental=snapshot.rentals?.find(item=>item.id===rentalId);
  if(!rental)throw new Error('Locação não encontrada.');
  if(kind==='checkout'&&!['reserva','retirada'].includes(rental.status))throw new Error('Vistoria de retirada exige locação em reserva/retirada.');
  const checkout=snapshot.inspections.find(item=>item.rentalId===rentalId&&item.kind==='checkout'&&item.status==='completed');
  if(kind==='return'&&!checkout)throw new Error('Conclua a vistoria de retirada antes da devolução.');
  if(kind==='return'&&!['em_uso','devolucao'].includes(rental.status))throw new Error('Vistoria de devolução exige locação em uso.');
  if(snapshot.inspections.some(item=>item.rentalId===rentalId&&item.kind===kind))throw new Error('Já existe uma vistoria deste tipo para a locação.');
  const now=new Date().toISOString();
  const value={
    id:nextEntityId('VIS',snapshot.inspections),rentalId,vehicleId:rental.vehicleId,kind,status:'draft',
    mileage:null,fuelLevel:'',notes:'',damages:[],photos:[],createdAt:now,completedAt:null,
    checklist:DEFAULT_INSPECTION_ITEMS.map(([id,label])=>({id,label,done:false,evidence:null}))
  };
  snapshot.inspections.unshift(value);
  appendAudit(snapshot,{actorId,action:'inspection.created',entityType:'inspection',entityId:value.id,details:{rentalId,kind}});
  return snapshot;
}

export function setInspectionItem(input,inspectionId,itemId,patch={},actorId){
  const snapshot=ensureP1Snapshot(input);const current=inspection(snapshot,inspectionId);const item=current.checklist.find(row=>row.id===itemId);
  if(!item)throw new Error('Item de vistoria não encontrado.');
  Object.assign(item,{done:patch.done??item.done,evidence:patch.evidence??item.evidence});
  appendAudit(snapshot,{actorId,action:'inspection.item_changed',entityType:'inspection',entityId:inspectionId,details:{itemId,done:item.done}});
  return snapshot;
}

export function addInspectionPhoto(input,inspectionId,{name='foto.jpg',type='image/jpeg',dataUrl}={},actorId){
  const snapshot=ensureP1Snapshot(input);const current=inspection(snapshot,inspectionId);
  if(typeof dataUrl!=='string'||!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(dataUrl))throw new Error('Foto inválida.');
  if(dataUrl.length>2_500_000)throw new Error('Foto excede o limite de 2,5 MB em base64.');
  if(current.photos.length>=12)throw new Error('Limite de 12 fotos por vistoria.');
  current.photos.push({id:nextEntityId('FOTO',current.photos),name,type,dataUrl,createdAt:new Date().toISOString()});
  const photosItem=current.checklist.find(item=>item.id==='photos');if(photosItem){photosItem.done=true;photosItem.evidence=`${current.photos.length} foto(s)`;}
  appendAudit(snapshot,{actorId,action:'inspection.photo_added',entityType:'inspection',entityId:inspectionId,details:{count:current.photos.length}});
  return snapshot;
}

export function completeInspection(input,inspectionId,{mileage,fuelLevel,notes='',damages=[]}={},actorId){
  const snapshot=ensureP1Snapshot(input);const current=inspection(snapshot,inspectionId);
  const km=Number(mileage);if(!Number.isFinite(km)||km<0)throw new Error('Quilometragem inválida.');
  if(!String(fuelLevel??'').trim())throw new Error('Nível de combustível é obrigatório.');
  current.mileage=km;current.fuelLevel=String(fuelLevel);current.notes=String(notes);current.damages=Array.isArray(damages)?damages:[];
  const mileageItem=current.checklist.find(item=>item.id==='mileage');if(mileageItem)mileageItem.done=true;
  const fuelItem=current.checklist.find(item=>item.id==='fuel');if(fuelItem)fuelItem.done=true;
  if(!current.photos.length)throw new Error('Inclua pelo menos uma foto da vistoria.');
  if(current.checklist.some(item=>!item.done))throw new Error('Conclua todos os itens do checklist antes de finalizar.');
  current.status='completed';current.completedAt=new Date().toISOString();
  const vehicle=snapshot.vehicles.find(item=>item.id===current.vehicleId);if(vehicle&&km>Number(vehicle.mileage||0))vehicle.mileage=km;
  appendAudit(snapshot,{actorId,action:'inspection.completed',entityType:'inspection',entityId:inspectionId,details:{mileage:km,fuelLevel:current.fuelLevel,damages:current.damages.length}});
  return snapshot;
}

export function inspectionProgress(value){
  const total=value?.checklist?.length??0;const completed=value?.checklist?.filter(item=>item.done).length??0;
  return{completed,total,percent:total?Math.round(completed/total*100):100,done:total===completed};
}
