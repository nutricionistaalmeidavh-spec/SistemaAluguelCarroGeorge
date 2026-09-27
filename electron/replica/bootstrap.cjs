'use strict';
const {runReplicaCycle}=require('./cycle.cjs');
async function bootstrapReplica({client,store,stateStore}={}){const before=stateStore?.load?.()||{initialized:false,cursor:0,restoreGeneration:0},state=await runReplicaCycle({state:{...before,initialized:false},api:client,local:store});stateStore?.save?.(state);return{cursor:state.cursor,restoreGeneration:state.restoreGeneration,state};}
exports.bootstrapReplica=bootstrapReplica;
