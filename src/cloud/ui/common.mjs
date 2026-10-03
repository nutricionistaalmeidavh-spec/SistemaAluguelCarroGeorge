import { can } from '../../domain/auth.mjs';

export const PWA_NAV=Object.freeze([
  Object.freeze({id:'overview',label:'Hoje',permission:null}),
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
  Object.freeze({id:'administration',label:'Configurações',permission:'admin.access'})
]);

export const PRIMARY_NAV_IDS=Object.freeze(['overview','rentals','customers','vehicles','finance']);
export const SECONDARY_NAV_IDS=Object.freeze(['inspections','billing','delinquency','maintenance','contracts','documents','alerts','administration']);
const NAV_PARENT=Object.freeze({
  inspections:'rentals',
  contracts:'rentals',
  documents:'rentals',
  billing:'finance',
  delinquency:'finance',
  maintenance:'vehicles',
  alerts:'overview'
});

export const MOBILE_NAV_GROUPS=Object.freeze([
  Object.freeze({label:'Principal',ids:PRIMARY_NAV_IDS}),
  Object.freeze({label:'Mais',ids:SECONDARY_NAV_IDS})
]);

const MOBILE_NAV_LABELS=Object.freeze({inspections:'Vistoria',administration:'Configurações'});

export function navigationFor(user){return PWA_NAV.filter(item=>item.permission==null||can(user,item.permission));}
export function primaryNavigationFor(user){const allowed=new Map(navigationFor(user).map(item=>[item.id,item]));return PRIMARY_NAV_IDS.map(id=>allowed.get(id)).filter(Boolean);}
export function secondaryNavigationFor(user){const allowed=new Map(navigationFor(user).map(item=>[item.id,item]));return SECONDARY_NAV_IDS.map(id=>allowed.get(id)).filter(Boolean);}
export function navigationParentFor(id){return NAV_PARENT[String(id)]??String(id);}
export function mobileLabelFor(id,fallback=''){return MOBILE_NAV_LABELS[id]??fallback;}
export function mobileNavigationGroups(user){
  const allowed=new Map(navigationFor(user).map(item=>[item.id,item]));
  return MOBILE_NAV_GROUPS.map(group=>({
    label:group.label,
    items:group.ids.map(id=>{const item=allowed.get(id);return item?{...item,mobileLabel:mobileLabelFor(id,item.label)}:null;}).filter(Boolean)
  })).filter(group=>group.items.length);
}
export function mobileNavHtml(user,active){
  const parent=navigationParentFor(active);
  return mobileNavigationGroups(user).map(group=>`<section class="mobile-module-group"><h3>${esc(group.label)}</h3><div class="mobile-module-grid">${group.items.map(({id,mobileLabel})=>{const selected=id===active||(group.label==='Principal'&&id===parent);return `<button type="button" data-cloud-nav="${id}" class="mobile-module-card ${selected?'active':''}"${selected?' aria-current="page"':''}><span>${esc(mobileLabel)}</span></button>`;}).join('')}</div></section>`).join('');
}
export function mobilePageLabel(user,active){const item=navigationFor(user).find(entry=>entry.id===active);return mobileLabelFor(active,item?.label??'Menu');}
export function esc(value){return String(value??'').replace(/[&<>\"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[char]));}
export function money(value){return Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
export function shortDate(value){if(!value)return'-';const date=new Date(String(value).length<=10?`${value}T12:00:00`:value);return Number.isFinite(date.getTime())?date.toLocaleDateString('pt-BR'):String(value);}
export function brDateValue(value){if(!value)return'';const raw=String(value).trim(),match=raw.match(/^(\d{4})-(\d{2})-(\d{2})/);if(match)return `${match[3]}/${match[2]}/${match[1]}`;const date=new Date(raw);return Number.isFinite(date.getTime())?date.toLocaleDateString('pt-BR'):raw;}
export function brDateToIso(value,{required=false}={}){const raw=String(value??'').trim();if(!raw){if(required)throw new Error('Informe a data no formato dd/mm/aaaa.');return'';}if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;const match=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(!match)throw new Error('Data inválida. Use dd/mm/aaaa.');const day=Number(match[1]),month=Number(match[2]),year=Number(match[3]),date=new Date(Date.UTC(year,month-1,day));if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)throw new Error('Data inválida. Use dd/mm/aaaa.');return `${match[3]}-${match[2]}-${match[1]}`;}
export function brDateTimeValue(value){if(!value)return'';const raw=String(value).trim(),date=new Date(raw);if(!Number.isFinite(date.getTime()))return raw;const parts=new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(date),pick=type=>parts.find(part=>part.type===type)?.value??'';return `${pick('day')}/${pick('month')}/${pick('year')} ${pick('hour')}:${pick('minute')}`;}
export function brDateTimeToIso(value,{required=false}={}){const raw=String(value??'').trim();if(!raw){if(required)throw new Error('Informe data e hora no formato dd/mm/aaaa hh:mm.');return null;}if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)){const date=new Date(raw);if(Number.isFinite(date.getTime()))return date.toISOString();}const match=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);if(!match)throw new Error('Data e hora inválidas. Use dd/mm/aaaa hh:mm.');const day=Number(match[1]),month=Number(match[2]),year=Number(match[3]),hour=Number(match[4]),minute=Number(match[5]),date=new Date(year,month-1,day,hour,minute);if(date.getFullYear()!==year||date.getMonth()!==month-1||date.getDate()!==day||date.getHours()!==hour||date.getMinutes()!==minute)throw new Error('Data e hora inválidas. Use dd/mm/aaaa hh:mm.');return date.toISOString();}
export function statusLabel(value){const key=String(value??'');return ({open:'Em aberto',partial:'Parcial',paid:'Pago',cancelled:'Cancelado',overdue:'Vencido',active:'Ativo',acknowledged:'Reconhecido',scheduled:'Agendada',in_progress:'Em andamento',completed:'Concluída',disponivel:'Disponível',locado:'Locado',manutencao:'Em manutenção',reserva:'Reservada',retirada:'Retirada',em_uso:'Em uso',devolucao:'Devolvida',valid:'Válido',pending:'Pendente',creating:'Gerando',failed:'Falhou',restored:'Restaurado',revoked:'Revogado'})[key]??key.replaceAll('_',' ');}
export function frequencyLabel(value){return ({daily:'Diária',weekly:'Semanal',monthly:'Mensal',custom:'Personalizada'})[String(value??'')]??String(value??'').replaceAll('_',' ');}
export function billingPurposeLabel(value){return ({rental_schedule:'Diárias da locação',rental:'Locação',manual:'Cobrança manual'})[String(value??'')]??'Cobrança';}
export function alertKindLabel(value){return ({rental_overdue:'Locação em atraso',rental_due:'Devolução próxima',maintenance:'Manutenção',vehicle_document:'Documento do veículo',driver_license:'CNH'})[String(value??'')]??'Alerta operacional';}
export function auditActionLabel(value){return ({'settings.update':'Configurações atualizadas','rental.created':'Locação criada','rental.status_changed':'Status da locação alterado','payment.received':'Recebimento registrado','billing.payment.received':'Recebimento de parcela registrado','inspection.completed':'Vistoria concluída','inspection.created':'Vistoria criada','inspection.item_changed':'Item da vistoria alterado','maintenance.scheduled':'Manutenção agendada','maintenance.started':'Manutenção iniciada','maintenance.completed':'Manutenção concluída','contract_template.created':'Modelo de contrato criado','contract_template.updated':'Modelo de contrato atualizado','contract.issued':'Contrato emitido','expense.created':'Despesa criada','expense.updated':'Despesa atualizada','expense.deleted':'Despesa excluída','customer.license_updated':'CNH do cliente atualizada','vehicle.documents_updated':'Documentos do veículo atualizados','daily_schedule.accrued':'Diárias atualizadas','daily_schedule.closed':'Cobrança diária encerrada'})[String(value??'')]??'Ação registrada';}
export function entityLabel(value){return ({customer:'Cliente',vehicle:'Veículo',rental:'Locação',inspection:'Vistoria',maintenance:'Manutenção',expense:'Despesa',contract_template:'Modelo de contrato',issued_contract:'Contrato emitido',billing_installment:'Parcela',billingPayment:'Recebimento',rentalPayment:'Recebimento',appSettings:'Configurações'})[String(value??'')]??'Registro';}
export function deviceKindLabel(value){return ({pwa:'Celular / navegador',browser:'Celular / navegador',desktop:'Computador',replica:'Computador de contingência'})[String(value??'')]??'Dispositivo';}
export function emptyStateHtml({title,description='',actionLabel='',action=''}){return `<div class="empty-state"><strong>${esc(title)}</strong>${description?`<p>${esc(description)}</p>`:''}${actionLabel&&action?`<button type="button" class="primary" data-empty-action="${esc(action)}">${esc(actionLabel)}</button>`:''}</div>`;}

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
    overviewSummary:list(data.overviewSummary)[0]??null,
    financeSummary:list(data.financeSummary)[0]??null,
    financeReceivables:list(data.financeReceivables),
    alertState:parse(alertRow?.stateJson??alertRow?.state_json,{}),
    settings:parse(settingsRow?.settingsJson??settingsRow?.settings_json,{}),
    updatedAt:new Date().toISOString()
  };
}

export function pageControls(resource,pagination={},options={}){
  const limit=Number(pagination?.limit)||Number(options.limit)||50,offset=Math.max(0,Number(pagination?.offset)||0),hasMore=Boolean(pagination?.hasMore),page=Math.floor(offset/Math.max(1,limit))+1,q=String(pagination?.q??options.q??''),searchMarker=options.searchAttribute?` ${esc(options.searchAttribute)}`:resource==='customers'?' data-customer-search':resource==='vehicles'?' data-vehicle-search':'';
  const search=options.search?`<form class="server-search" data-page-search="${esc(resource)}"><input name="q" type="search"${searchMarker} value="${esc(q)}" placeholder="${esc(options.placeholder||'Buscar')}"><button type="submit" class="secondary">Buscar</button></form>`:'';
  return `<div class="server-pagebar">${search}<div class="server-pager"><button type="button" class="secondary" data-page-resource="${esc(resource)}" data-page-offset="${Math.max(0,offset-limit)}" ${offset<=0?'disabled':''}>Anterior</button><span>Página ${page}</span><button type="button" class="secondary" data-page-resource="${esc(resource)}" data-page-offset="${offset+limit}" ${hasMore?'':'disabled'}>Próxima</button></div></div>`;
}
export function navHtml(user,active){
  const parent=navigationParentFor(active);
  const primary=primaryNavigationFor(user).map(({id,label})=>`<button type="button" data-cloud-nav="${id}" class="nav ${parent===id?'active':''}">${label}</button>`).join('');
  const secondary=secondaryNavigationFor(user),advancedActive=secondary.some(item=>item.id===active);
  const more=secondary.length?`<details class="desktop-nav-more" ${advancedActive?'open':''}><summary>Mais</summary><div class="desktop-nav-more-list">${secondary.map(({id,label})=>`<button type="button" data-cloud-nav="${id}" class="nav ${active===id?'active':''}">${label}</button>`).join('')}</div></details>`:'';
  return `<div class="desktop-nav-list">${primary}${more}</div><div class="mobile-nav-shell"><input class="mobile-menu-toggle" id="cloud-mobile-menu" type="checkbox"><label class="mobile-appbar" for="cloud-mobile-menu" aria-label="Abrir menu"><span class="mobile-menu-icon" aria-hidden="true"><i></i><i></i><i></i></span><strong>${esc(mobilePageLabel(user,active))}</strong><span class="mobile-menu-caption">Menu</span></label><div class="mobile-module-overlay" data-test="mobile-module-central"><label class="mobile-module-backdrop" for="cloud-mobile-menu" aria-label="Fechar menu"></label><section class="mobile-module-panel" role="dialog" aria-modal="true" aria-label="Menu da locadora"><header><div><small>Locadora George</small><h2>Menu</h2></div><label class="mobile-module-close" for="cloud-mobile-menu" aria-label="Fechar">×</label></header>${mobileNavHtml(user,active)}</section></div></div>`;
}
