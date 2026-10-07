const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const apikey = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=([^\r\n]+)/)[1].trim();

async function run() {
  const t0 = Date.now();
  console.log('Sending fetch to Supabase auth...');
  try {
    const res = await fetch('https://kaoeenrewvltnrbxmjfe.supabase.co/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: {
        'apikey': apikey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'cnho@auth.rubber-erp.example.com',
        password: 'wrongpassword'
      }),
      signal: AbortSignal.timeout(10000)
    });
    console.log('Took:', Date.now() - t0, 'ms. Status:', res.status);
    const json = await res.json();
    console.log('Body:', json);
  } catch (e) {
    console.log('Error after', Date.now() - t0, 'ms:', e.message);
  }
}
run();
