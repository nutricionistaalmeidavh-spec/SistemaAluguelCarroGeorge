const { contextBridge,ipcRenderer }=require('electron');
contextBridge.exposeInMainWorld('locadoraDesktop',{
  getSyncInfo:()=>ipcRenderer.invoke('locadora:sync-info'),
  snapshotLoad:()=>ipcRenderer.invoke('locadora:snapshot:load'),
  snapshotSave:(snapshot)=>ipcRenderer.invoke('locadora:snapshot:save',snapshot),
  putAttachment:(value)=>ipcRenderer.invoke('locadora:attachment:put',value),
  getAttachment:(id)=>ipcRenderer.invoke('locadora:attachment:get',id),
  verifyAttachment:(id)=>ipcRenderer.invoke('locadora:attachment:verify',id),
  removeAttachment:(id)=>ipcRenderer.invoke('locadora:attachment:remove',id),
  listAttachments:(entityType,entityId)=>ipcRenderer.invoke('locadora:attachment:list',entityType,entityId),
  dbGet:(key)=>ipcRenderer.invoke('locadora:db:get',key),
  dbSet:(key,value)=>ipcRenderer.invoke('locadora:db:set',key,value),
  dbRemove:(key)=>ipcRenderer.invoke('locadora:db:remove',key)
});
