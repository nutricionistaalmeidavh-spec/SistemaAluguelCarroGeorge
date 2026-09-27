const { contextBridge,ipcRenderer }=require('electron');
contextBridge.exposeInMainWorld('locadoraDesktop',{
  getSyncInfo:()=>ipcRenderer.invoke('locadora:sync-info'),
  dbGet:(key)=>ipcRenderer.invoke('locadora:db:get',key),
  dbSet:(key,value)=>ipcRenderer.invoke('locadora:db:set',key,value),
  dbRemove:(key)=>ipcRenderer.invoke('locadora:db:remove',key)
});
