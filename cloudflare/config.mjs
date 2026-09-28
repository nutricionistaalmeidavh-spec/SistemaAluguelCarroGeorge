export const APP_VERSION='0.7.0';
export const SCHEMA_VERSION=4;
export const API_PREFIX='/api/v1';

export function publicHealth(){
  return Object.freeze({ok:true,appVersion:APP_VERSION,schemaVersion:SCHEMA_VERSION});
}
