
export function publicVersion(env={}){const commit=String(env.BUILD_SHA??BUILD_INFO.commit??'unknown').trim()||'unknown',builtAt=env.BUILD_TIME??BUILD_INFO.builtAt??null;return Object.freeze({ok:true,appVersion:APP_VERSION,schemaVersion:SCHEMA_VERSION,commit,builtAt});}
