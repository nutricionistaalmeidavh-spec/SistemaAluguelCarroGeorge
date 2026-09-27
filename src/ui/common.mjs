export const money = (v) => Number(v || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export const date = (v) => v ? new Date(v).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}) : '-';
export const esc = (v='') => String(v).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

export function toast(message) {
  const el = document.createElement('div');
  el.className='toast'; el.textContent=message; document.body.appendChild(el);
  setTimeout(()=>el.remove(),2600);
}

export function modal(title,body,onReady){
  const overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal"><div class="modal-head"><h2>${esc(title)}</h2><button data-close aria-label="Fechar">×</button></div>${body}</div>`;
  document.body.appendChild(overlay);
  overlay.querySelectorAll('[data-close]').forEach(b=>b.onclick=closeModal);
  onReady?.();
}
export function closeModal(){document.querySelector('.modal-overlay')?.remove();}
export function download(name,text){const blob=new Blob([text],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
