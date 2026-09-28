'use strict';
function nextRestoreGeneration(value){const n=Number(value);return Number.isInteger(n)&&n>=0?n+1:1;}
function assertRestoreGeneration(clientGeneration,serverGeneration){const client=Number(clientGeneration),server=Number(serverGeneration);if(!Number.isInteger(client)||!Number.isInteger(server)||client!==server){const error=new Error('restore_generation_mismatch');error.code='restore_generation_mismatch';error.clientGeneration=clientGeneration;error.serverGeneration=serverGeneration;throw error;}return true;}
exports.nextRestoreGeneration=nextRestoreGeneration;exports.assertRestoreGeneration=assertRestoreGeneration;
