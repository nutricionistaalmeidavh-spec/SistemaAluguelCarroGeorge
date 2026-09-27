const { contextBridge,ipcRenderer }=require('electron');
contextBridge.exposeInMainWorld('locadoraDesktop',{
  getSyncInfo:()=>ipcRenderer.invoke('locadora:sync-info'),
  snapshotLoad:()=>ipcRenderer.invoke('locadora:snapshot:load'),
  snapshotSave:(snapshot)=>ipcRenderer.invoke('locadora:snapshot:save',snapshot),
  dbGet:(key)=>ipcRenderer.invoke('locadora:db:get',key),
  dbSet:(key,value)=>ipcRenderer.invoke('locadora:db:set',key,value),
  dbRemove:(key)=>ipcRenderer.invoke('locadora:db:remove',key)
});
