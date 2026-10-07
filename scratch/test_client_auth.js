const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=([^\r\n]+)/)[1].trim();
const anonKey = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=([^\r\n]+)/)[1].trim();
const { createClient } = require('@supabase/supabase-js');

async function test() {
  console.log('Creating client...');
  const client = createClient(url, anonKey);
  console.log('Client created. Calling signInWithPassword...');
  const t0 = Date.now();
  const res = await client.auth.signInWithPassword({
    email: 'cnho@auth.rubber-erp.example.com',
    password: 'wrongpassword'
  });
  console.log('signInWithPassword finished in', Date.now() - t0, 'ms');
  console.log('Error:', res.error ? res.error.message : 'no error');
}

test().catch(err => console.error('Caught error:', err));
