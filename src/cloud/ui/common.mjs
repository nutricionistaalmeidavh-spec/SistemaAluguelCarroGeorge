import { can } from '../../domain/auth.mjs';

export const PWA_NAV=Object.freeze([
  Object.freeze({id:'overview',label:'Visão geral',permission:null}),
  Object.freeze({id:'customers',label:'Clientes',permission:'customer.read'}),
  Object.freeze({id:'vehicles',label:'Frota',permission:'vehicle.read'}),
  Object.freeze({id:'rentals',label:'Locações',permission:'rental.read'}),
  Object.freeze({id:'inspections',label:'Vistorias',permission:'inspection.read'}),
  Object.freeze({id:'finance',label:'Financeiro',permission:'finance.read'}),
  Object.freeze({id:'billing',label:'Cobranças',permission:'billing.read'}),
  Object.freeze({id:'delinquency',label:'Inadimplência',permission:'billing.read'}),
  Object.freeze({id:'contracts',label:'Contratos',permission:'contracts.read'}),
  Object.freeze({id:'documents',label:'Documentos',permission:'documents.read'}),
  Object.freeze({id:'alerts',label:'Alertas',permission:'alerts.read'}),
  Object.freeze({id:'maintenance',label:'Manutenção',permission:'maintenance.read'}),
  Object.freeze({id:'administration',label:'Administração',permission:'admin.access'})
]);

export const MOBILE_NAV_GROUPS=Object.freeze([
  Object.freeze({label:'Operação',ids:Object.freeze(['overview','rentals','customers','billing','inspections','finance'])}),
  Object.freeze({label:'Gestão',ids:Object.freeze(['finance','delinquency','vehicles','maintenance'])}),
  Object.freeze({label:'Documentos e sistema',ids:Object.freeze(['contracts','documents','alerts','administration'])})
]);

const MOBILE_NAV_LABELS=Object.freeze({inspections:'Vistoria',administration:'Configurações'});

export function navigationFor(user){return PWA_NAV.filter(item=>item.permission==null||can(user,item.permission));}
export function mobileLabelFor(id,fallback=''){return MOBILE_NAV_LABELS[id]??fallback;}
export function mobileNavigationGroups(user){
  const allowed=new Map(navigationFor(user).map(item=>[item.id,item]));
  return MOBILE_NAV_GROUPS.map(group=>({label:group.label,items:group.ids.map(id=>{const item=allowed.get(id);if(!item)return null;const shortcut=group.label==='Operação'&&id==='finance';return{...item,mobileLabel:shortcut?'Dar baixa':mobileLabelFor(id,item.label),shortcut};}).filter(Boolean)})).filter(group=>group.items.length);
}
export function mobileNavHtml(user,active){
  return mobileNavigationGroups(user).map(group=>`<section class="mobile-module-group"><h3>${esc(group.label)}</h3><div class="mobile-module-grid">${group.items.map(({id,mobileLabel,shortcut})=>{const selected=!shortcut&&active===id;return `<button type="button" data-cloud-nav="${id}"${shortcut?' data-cloud-shortcut="payment"':''} class="mobile-module-card ${selected?'active':''}"${selected?' aria-current="page"':''}><span>${esc(mobileLabel)}</span></button>`;}).join('')}</div></section>`).join('');
}
export function mobilePageLabel(user,active){const item=navigationFor(user).find(entry=>entry.id===active);return mobileLabelFor(active,item?.label??'Menu');}
export function esc(value){return String(value??'').replace(/[&<>\"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[char]));}
export function money(value){return Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
export function shortDate(value){if(!value)return'-';const date=new Date(String(value).length<=10?`${value}T12:00:00`:value);return Number.isFinite(date.getTime())?date.toLocaleDateString('pt-BR'):String(value);}

function parse(value,fallback){if(value==null||value==='')return structuredClone(fallback);if(typeof value==='object')return structuredClone(value);try{return JSON.parse(String(value));}catch{return structuredClone(fallback);}}
function list(value){return Array.isArray(value)?structuredClone(value):[];}
function group(items,key){const result=new Map();for(const item of list(items)){const id=String(item?.[key]??'');if(!id)continue;if(!result.has(id))result.set(id,[]);result.get(id).push(item);}return result;}

export function buildCloudSnapshot(data={}){
  const rentalPayments=group(data.rentalPayments,'rentalId'),inspectionItems=group(data.inspectionItems,'inspectionId'),billingPayments=group(data.billingPayments,'installmentId'),inspectionAttachments=group(list(data.attachments).filter(item=>item?.entityType==='inspection'),'entityId');
  const customers=list(data.customers).map(item=>({...item,driverLicense:{number:'',category:'',expiry:'',...parse(item.driverLicenseJson,{})}}));
  const vehicles=list(data.vehicles).map(item=>({...item,documents:{insuranceExpiry:'',licensingExpiry:'',inspectionExpiry:'',renavam:'',chassis:'',...parse(item.documentsJson,{})}}));
  const rentals=list(data.rentals).map(item=>({...item,payments:list(rentalPayments.get(String(item.id)))}));
  const inspections=list(data.inspections).map(item=>({...item,damages:parse(item.damagesJson,[]),checklist:list(inspectionItems.get(String(item.id))).map(row=>({id:String(row.itemKey??row.id??''),label:String(row.label??''),done:Boolean(row.done),evidence:row.evidence??null})),photos:list(inspectionAttachments.get(String(item.id))).map(row=>({attachmentId:String(row.id),name:String(row.originalName??row.fileName??row.id),mimeType:String(row.mimeType??''),sizeBytes:Number(row.sizeBytes||0),sha256:String(row.sha256??'')}))}));
  const installments=list(data.billingInstallments).map(item=>({...item,payments:list(billingPayments.get(String(item.id)))}));
  const alertRow=list(data.alertState)[0],settingsRow=list(data.appSettings)[0];
  return{
    version:4,
    users:list(data.users),customers,vehicles,rentals,
    expenses:list(data.expenses),inspections,maintenance:list(data.maintenance),
    ledger:list(data.ledger),audit:list(data.audit),
    contractTemplates:list(data.contractTemplates),issuedContracts:list(data.issuedContracts),
    billingPlans:list(data.billingPlans),billingInstallments:installments,billingPayments:list(data.billingPayments),
    collectionActions:list(data.collectionActions),attachments:list(data.attachments),
    alertState:parse(alertRow?.stateJson??alertRow?.state_json,{}),
    settings:parse(settingsRow?.settingsJson??settingsRow?.settings_json,{}),
    updatedAt:new Date().toISOString()
  };
}

export function navHtml(user,active){
  const desktop=navigationFor(user).map(({id,label})=>`<button type="button" data-cloud-nav="${id}" class="nav ${active===id?'active':''}">${label}</button>`).join('');
  return `<div class="desktop-nav-list">${desktop}</div><div class="mobile-nav-shell"><input class="mobile-menu-toggle" id="cloud-mobile-menu" type="checkbox"><label class="mobile-appbar" for="cloud-mobile-menu" aria-label="Abrir central de módulos"><span class="mobile-menu-icon" aria-hidden="true"><i></i><i></i><i></i></span><strong>${esc(mobilePageLabel(user,active))}</strong><span class="mobile-menu-caption">Módulos</span></label><div class="mobile-module-overlay" data-test="mobile-module-central"><label class="mobile-module-backdrop" for="cloud-mobile-menu" aria-label="Fechar central de módulos"></label><section class="mobile-module-panel" role="dialog" aria-modal="true" aria-label="Central de módulos"><header><div><small>Locadora George</small><h2>Central de módulos</h2></div><label class="mobile-module-close" for="cloud-mobile-menu" aria-label="Fechar">×</label></header>${mobileNavHtml(user,active)}</section></div></div>`;
}
