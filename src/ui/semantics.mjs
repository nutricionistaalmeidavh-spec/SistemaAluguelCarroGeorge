export const WORK_AREAS=Object.freeze([
  Object.freeze({key:'overview',label:'Hoje',desktopId:'dashboard',cloudId:'overview'}),
  Object.freeze({key:'rentals',label:'Locações',desktopId:'reservas',cloudId:'rentals'}),
  Object.freeze({key:'customers',label:'Clientes',desktopId:'clientes',cloudId:'customers'}),
  Object.freeze({key:'vehicles',label:'Frota',desktopId:'frota',cloudId:'vehicles'}),
  Object.freeze({key:'finance',label:'Financeiro',desktopId:'financeiro',cloudId:'finance'})
]);
export const RENTAL_STATUS_LABELS=Object.freeze({reserva:'Agendada',retirada:'Retirada em andamento',em_uso:'Em uso',devolucao:'Finalizada'});
export function rentalStatusLabel(status){const key=String(status??'');return RENTAL_STATUS_LABELS[key]??key.replaceAll('_',' ');}
export function workAreaLabel(surfaceId){const id=String(surfaceId??'');return WORK_AREAS.find(item=>item.desktopId===id||item.cloudId===id||item.key===id)?.label??id;}
