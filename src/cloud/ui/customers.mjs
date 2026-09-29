import { can } from '../../domain/auth.mjs';
import { esc,shortDate } from './common.mjs';

function text(form,name){return String(form?.get?.(name)??'').trim();}
export function customerPayload(form,current={}){return{
  ...(current?.id?{id:String(current.id)}:{}),
  ...(current?.version!=null?{version:Number(current.version)}:{}),
  name:text(form,'name'),document:text(form,'document'),phone:text(form,'phone'),email:text(form,'email'),address:text(form,'address'),
  driverLicenseJson:JSON.stringify({number:text(form,'licenseNumber'),category:text(form,'licenseCategory'),expiry:text(form,'licenseExpiry')}),
  active:text(form,'active')==='0'?0:1
};}

function formHtml(current={}){const license=current.driverLicense??{};return `<form id="cloud-customer-form" class="panel cloud-form" data-test="customer-form">
  <h2>${current.id?'Editar cliente':'Novo cliente'}</h2>
  <input type="hidden" name="id" value="${esc(current.id??'')}"><input type="hidden" name="version" value="${esc(current.version??'')}">
  <label>Nome<input name="name" value="${esc(current.name??'')}" required></label>
  <label>CPF/CNPJ<input name="document" value="${esc(current.document??'')}"></label>
  <label>Telefone<input name="phone" inputmode="tel" value="${esc(current.phone??'')}"></label>
  <label>E-mail<input name="email" type="email" value="${esc(current.email??'')}"></label>
  <label class="full">Endereço<input name="address" value="${esc(current.address??'')}"></label>
  <label>CNH<input name="licenseNumber" value="${esc(license.number??'')}"></label>
  <label>Categoria CNH<input name="licenseCategory" value="${esc(license.category??'')}"></label>
  <label>Validade CNH<input name="licenseExpiry" type="date" value="${esc(license.expiry??'')}"></label>
  <label>Status<select name="active"><option value="1" ${current.active===0?'':'selected'}>Ativo</option><option value="0" ${current.active===0?'selected':''}>Inativo</option></select></label>
  <div class="full actions"><button class="primary">${current.id?'Salvar alterações':'Salvar cliente'}</button>${current.id?'<button type="button" class="secondary" data-customer-cancel>Cancelar</button>':''}</div>
</form>`;}

export function customersHtml(snapshot,user,{editingId=null}={}){const writable=can(user,'customer.write'),current=editingId?snapshot.customers.find(item=>String(item.id)===String(editingId))??{}:{};const cards=(snapshot.customers??[]).map(item=>`<article class="card cloud-entity-card"><div><strong>${esc(item.name)}</strong><small>${esc(item.document||'Sem documento')} · ${esc(item.phone||'Sem telefone')}</small><small>${esc(item.email||'Sem e-mail')}</small><small>${esc(item.driverLicense?.number?`CNH ${item.driverLicense.number} · ${item.driverLicense.category||'-'} · ${shortDate(item.driverLicense.expiry)}`:'CNH não informada')}</small></div>${writable?`<div class="actions"><button type="button" data-customer-edit="${esc(item.id)}">Editar</button><button type="button" data-customer-delete="${esc(item.id)}" data-version="${Number(item.version||1)}" class="secondary">${item.active===0?'Excluir':'Desativar'}</button></div>`:''}</article>`).join('');return `<div class="heading"><div><small>CADASTRO COMPLETO</small><h1>Clientes</h1></div></div><div class="cloud-grid">${writable?formHtml(current):''}<section class="panel"><h2>Clientes</h2><div class="cloud-card-list">${cards||'<div class="empty">Nenhum cliente.</div>'}</div></section></div>`;}

export function bindCustomers(root,{snapshot,user,actions,state}){if(!can(user,'customer.write'))return;const form=root.querySelector('#cloud-customer-form');if(form)form.onsubmit=async event=>{event.preventDefault();const fd=new FormData(form),id=String(fd.get('id')||''),version=Number(fd.get('version')||0),payload=customerPayload(fd,id?{id,version}:{});if(id){const {id:entityId,version:expectedVersion,...data}=payload;await actions.updateEntity('customers',entityId,data,expectedVersion);}else{const {version:_,...data}=payload;await actions.createEntity('customers',data);}state.editingCustomerId=null;await actions.refresh('customers');};
  root.querySelectorAll('[data-customer-edit]').forEach(button=>button.onclick=async()=>{state.editingCustomerId=button.dataset.customerEdit;await actions.refresh('customers');});
  root.querySelector('[data-customer-cancel]')?.addEventListener('click',async()=>{state.editingCustomerId=null;await actions.refresh('customers');});
  root.querySelectorAll('[data-customer-delete]').forEach(button=>button.onclick=async()=>{const item=snapshot.customers.find(row=>String(row.id)===String(button.dataset.customerDelete));if(!item)return;if(item.active!==0){await actions.updateEntity('customers',item.id,{active:0},Number(item.version||1));}else{await actions.deleteEntity('customers',item.id,Number(item.version||1));}await actions.refresh('customers');});
}
