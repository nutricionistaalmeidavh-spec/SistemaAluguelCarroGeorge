function normalizeInternal(baseURL,currentURL,href,preserveHashRoutes=false){
  try{
    if(!href)return null;
    const url=new URL(href,currentURL||baseURL);
    const base=new URL(baseURL);
    if(!['http:','https:'].includes(url.protocol)||url.origin!==base.origin)return null;
    if(!preserveHashRoutes)url.hash='';
    return url.toString();
  }catch{return null}
}

export async function runUiSweep({
  page,
  baseURL,
  startPaths=['/'],
  maxPages=30,
  failOnHttp5xx=true,
  failOnPageError=true,
  failOnRequestFailure=true,
  preserveHashRoutes=false,
}={}){
  if(!page)throw new TypeError('page is required');
  const base=new URL(String(baseURL||''));
  const queue=[];
  const seen=new Set();
  for(const value of startPaths){
    const url=normalizeInternal(base.toString(),base.toString(),String(value),preserveHashRoutes);
    if(url&&!queue.includes(url))queue.push(url);
  }
  if(!queue.length)queue.push(base.toString());

  const consoleErrors=[];
  const pageErrors=[];
  const requestFailures=[];
  const httpErrors=[];
  page.on?.('console',message=>{
    const type=message.type?.()||'log';
    if(type==='error')consoleErrors.push({url:page.url?.()||null,text:message.text?.()||String(message)});
  });
  page.on?.('pageerror',error=>pageErrors.push({url:page.url?.()||null,message:error?.message||String(error)}));
  page.on?.('requestfailed',request=>requestFailures.push({
    url:request.url?.()||null,
    method:request.method?.()||null,
    error:request.failure?.()?.errorText||'request failed',
  }));
  page.on?.('response',response=>{
    const status=response.status?.();
    if(Number(status)>=400)httpErrors.push({
      url:response.url?.()||null,
      method:response.request?.().method?.()||null,
      status:Number(status),
    });
  });

  const pages=[];
  while(queue.length&&pages.length<Math.max(1,Number(maxPages)||1)){
    const target=queue.shift();
    if(!target||seen.has(target))continue;
    seen.add(target);
    let response=null;
    let navigationError=null;
    try{
      response=await page.goto(target,{waitUntil:'domcontentloaded'});
    }catch(error){
      navigationError=error?.message||String(error);
    }
    const current=page.url?.()||target;
    let inventory={title:'',links:[],buttons:[],forms:[],controls:[]};
    if(!navigationError){
      try{
        inventory=await page.evaluate(()=>({
          title:document.title||'',
          links:[...document.querySelectorAll('a')].map(node=>({
            href:node.getAttribute('href')||'',
            resolved:node.href||'',
            text:(node.textContent||'').trim().slice(0,160),
          })),
          buttons:[...document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]')].map(node=>({
            text:(node.textContent||node.getAttribute('value')||node.getAttribute('aria-label')||'').trim().slice(0,160),
            disabled:Boolean(node.disabled||node.getAttribute('aria-disabled')==='true'),
          })),
          forms:[...document.querySelectorAll('form')].map(node=>({
            action:node.getAttribute('action')||'',
            method:(node.getAttribute('method')||'GET').toUpperCase(),
          })),
          controls:[...document.querySelectorAll('input:not([type="hidden"]),select,textarea')].map(node=>({
            name:node.getAttribute('name')||'',
            type:node.getAttribute('type')||node.tagName.toLowerCase(),
            labelled:Boolean(node.getAttribute('aria-label')||node.getAttribute('aria-labelledby')||node.getAttribute('placeholder')||(node.id&&document.querySelector('label[for="'+CSS.escape(node.id)+'"]'))),
          })),
        }));
      }catch(error){
        navigationError='DOM inventory failed: '+(error?.message||String(error));
      }
    }

    const suspiciousLinks=(inventory.links||[]).filter(link=>{
      const href=String(link.href||'').trim().toLowerCase();
      return !href||href==='#'||href.startsWith('javascript:');
    });
    const unlabeledControls=(inventory.controls||[]).filter(control=>!control.labelled);
    const navigationStatus=Number(response?.status?.()||0)||null;
    pages.push({
      url:current,
      requestedUrl:target,
      title:inventory.title||'',
      navigationStatus,
      navigationError,
      counts:{
        links:(inventory.links||[]).length,
        buttons:(inventory.buttons||[]).length,
        forms:(inventory.forms||[]).length,
        controls:(inventory.controls||[]).length,
      },
      suspiciousLinks,
      unlabeledControls,
    });

    for(const link of inventory.links||[]){
      const next=normalizeInternal(base.toString(),current,link.resolved||link.href,preserveHashRoutes);
      if(next&&!seen.has(next)&&!queue.includes(next))queue.push(next);
    }
  }

  const brokenNavigations=pages.filter(item=>item.navigationError||(item.navigationStatus!=null&&item.navigationStatus>=400));
  const fatalHttp=httpErrors.filter(item=>item.status>=500);
  const failures=[
    ...brokenNavigations.map(item=>({type:'navigation',url:item.url,detail:item.navigationError||('HTTP '+item.navigationStatus)})),
    ...(failOnPageError?pageErrors.map(item=>({type:'pageerror',url:item.url,detail:item.message})):[]),
    ...(failOnRequestFailure?requestFailures.map(item=>({type:'requestfailed',url:item.url,detail:item.error})):[]),
    ...(failOnHttp5xx?fatalHttp.map(item=>({type:'http5xx',url:item.url,detail:'HTTP '+item.status})):[]),
  ];

  return {
    schemaVersion:1,
    status:failures.length?'failed':'passed',
    baseURL:base.toString(),
    pages,
    consoleErrors,
    pageErrors,
    requestFailures,
    httpErrors,
    failures,
    coverage:{visited:pages.length,queuedRemaining:queue.length,maxPages:Math.max(1,Number(maxPages)||1)},
  };
}
