if(['http:','https:'].includes(location.protocol)){
  try{
    await fetch('/api/v1/auth/bootstrap',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:'{}',
      credentials:'include',
      cache:'no-store'
    });
  }catch{}
}

await import('./app.mjs');
