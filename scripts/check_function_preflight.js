(async () => {
  try {
    const url = 'https://sotrgvahjouvelnsrsly.supabase.co/functions/v1/admin-signup';
    console.log('Invoking OPTIONS', url);
    const res = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:8081',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'x-client-info, content-type, authorization'
      },
    });
    console.log('status', res.status, res.statusText);
    for (const [k, v] of res.headers) {
      console.log(k + ': ' + v);
    }
    const text = await res.text();
    if (text) console.log('body:', text);
  } catch (e) {
    console.error('error', e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();
