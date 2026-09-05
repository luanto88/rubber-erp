const fs = require('fs');
const env = {};
fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).forEach(l => {
  const m = l.match(/^([^=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
});
const { createClient } = require('@supabase/supabase-js');
const supabaseAdmin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function normalize() {
  console.log('--- FETCHING DEPARTMENTS ---');
  const { data: depts, error: dErr } = await supabaseAdmin.from('departments').select('*');
  if (dErr || !depts) {
    console.error('Error loading departments:', dErr);
    return;
  }
  console.log(`Found ${depts.length} departments.`);

  const { data: profiles, error: pErr } = await supabaseAdmin.from('profiles').select('id, username, full_name, department, department_id');
  if (pErr || !profiles) {
    console.error('Error loading profiles:', pErr);
    return;
  }
  console.log(`Found ${profiles.length} profiles.`);

  let updatedCount = 0;
  for (const p of profiles) {
    if (!p.department) continue;

    // Match against departments (code or name)
    const match = depts.find(d => 
      d.code.toLowerCase() === p.department.trim().toLowerCase() ||
      d.name.toLowerCase() === p.department.trim().toLowerCase()
    );

    if (match) {
      const needsUpdate = p.department_id !== match.id || p.department !== match.name;
      if (needsUpdate) {
        console.log(`Updating ${p.username} (${p.full_name}): "${p.department}" (id: ${p.department_id}) -> "${match.name}" (id: ${match.id})`);
        const { error: uErr } = await supabaseAdmin.from('profiles').update({
          department: match.name,
          department_id: match.id,
        }).eq('id', p.id);
        if (uErr) {
          console.error(`Failed to update profile ${p.username}:`, uErr.message);
        } else {
          updatedCount++;
        }
      }
    } else {
      console.warn(`No department match for ${p.username}: "${p.department}"`);
    }
  }

  console.log(`Successfully normalized ${updatedCount} profiles.`);
}
normalize();
