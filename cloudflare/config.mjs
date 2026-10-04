import { BUILD_INFO } from '../src/build-info.mjs';

export const APP_VERSION='0.7.0';
export const SCHEMA_VERSION=4;
export const API_PREFIX='/api/v1';

export function publicHealth(){
  return Object.freeze({ok:true,appVersion:APP_VERSION,schemaVersion:SCHEMA_VERSION});
}

export function publicVersion(env={}){
  const commit=String(env.BUILD_SHA??BUILD_INFO.commit??'unknown').trim()||'unknown';
  const builtAt=env.BUILD_TIME??BUILD_INFO.builtAt??null;
  return Object.freeze({ok:true,appVersion:APP_VERSION,schemaVersion:SCHEMA_VERSION,commit,builtAt});
}
