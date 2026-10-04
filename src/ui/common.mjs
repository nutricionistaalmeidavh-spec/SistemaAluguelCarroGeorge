export const money = (v) => Number(v || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export const date = (v) => v ? new Date(v).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}) : '-';
export const esc = (v='') => String(v).replace(/[&<>\"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]));

export function friendlyId(value,prefix=''){
  const raw=String(value??'').trim(),tail=(raw.split('-').filter(Boolean).pop()||raw).slice(-6).toUpperCase();
  return (prefix?prefix+' ':'')+'#'+(tail||'—');
}
export function rentalStatusLabel(status){
  return ({reserva:'Agendada',retirada:'Retirada em andamento',em_uso:'Em uso',devolucao:'Finalizada'})[status]||String(status||'').replaceAll('_',' ');
}
export function brDateTimeValue(value){
  if(!value)return'';const d=value instanceof Date?value:new Date(value);if(Number.isNaN(d.getTime()))return'';
  const p=n=>String(n).padStart(2,'0');return p(d.getDate())+'/'+p(d.getMonth()+1)+'/'+d.getFullYear()+' '+p(d.getHours())+':'+p(d.getMinutes());
}
export function brDateTimeToIso(value,{required=false}={}){
  const text=String(value??'').trim();if(!text){if(required)throw new Error('Informe data e hora no formato dd/mm/aaaa hh:mm.');return null;}
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)){const d=new Date(text);if(!Number.isNaN(d.getTime()))return d.toISOString();}
  const match=text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))$/);
  if(!match)throw new Error('Use o formato dd/mm/aaaa hh:mm.');
  const [,dd,mm,yyyy,hh,min]=match,d=new Date(Number(yyyy),Number(mm)-1,Number(dd),Number(hh),Number(min),0,0);
  if(d.getFullYear()!==Number(yyyy)||d.getMonth()!==Number(mm)-1||d.getDate()!==Number(dd)||d.getHours()!==Number(hh)||d.getMinutes()!==Number(min))throw new Error('Data ou hora inválida.');
  return d.toISOString();
}

export function toast(message) {
  document.querySelectorAll('.toast').forEach(node=>node.remove());
  const el = document.createElement('div');
  el.className='toast'; el.textContent=message; el.setAttribute('role','status');el.setAttribute('aria-live','polite');document.body.appendChild(el);
  setTimeout(()=>el.remove(),2600);
}

let modalReturnFocus=null;
export function modal(title,body,onReady){
  modalReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.innerHTML='<div class="modal" role="dialog" aria-modal="true" aria-label="'+esc(title)+'"><div class="modal-head"><h2>'+esc(title)+'</h2><button type="button" data-close aria-label="Fechar">×</button></div>'+body+'</div>';
  document.body.appendChild(overlay);
  overlay.querySelectorAll('[data-close]').forEach(b=>b.onclick=closeModal);
  overlay.addEventListener('click',event=>{if(event.target===overlay)closeModal();});
  overlay.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeModal();}});
  onReady?.();
  const first=overlay.querySelector('[autofocus],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled])');
  first?.focus();
}
export function closeModal(){const node=document.querySelector('.modal-overlay');if(node)node.remove();modalReturnFocus?.focus?.();modalReturnFocus=null;}
export function download(name,text){const blob=new Blob([text],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
