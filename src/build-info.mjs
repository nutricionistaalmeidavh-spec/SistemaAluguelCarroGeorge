export const BUILD_INFO=Object.freeze({appVersion:'0.7.0',commit:'development',builtAt:null});
export function shortBuildCommit(value=BUILD_INFO.commit){const commit=String(value??'').trim();return commit&&commit!=='development'&&commit!=='unknown'?commit.slice(0,8):commit||'unknown';}
