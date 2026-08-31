import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"

const envLocal = readFileSync("./.env.local", "utf8")
const get = (key) => {
  const m = envLocal.match(new RegExp(`^${key}=(.*)$`, "m"))
  return m ? m[1].trim().replace(/^"|"$/g, "") : null
}
const url = get("NEXT_PUBLIC_SUPABASE_URL")
const key = get("SUPABASE_SERVICE_ROLE_KEY")
if (!url || !key) { console.error("Missing supabase env vars"); process.exit(1) }
const supabase = createClient(url, key)

const { data: profiles, error: pErr } = await supabase
  .from("profiles")
  .select("id, full_name, username, role, status, factory_id, department, department_id")
  .ilike("full_name", "%Trương Tấn Phước%")
if (pErr) { console.error(pErr); process.exit(1) }
console.log("=== profiles matching 'Trương Tấn Phước' ===")
console.log(profiles)

for (const profile of profiles || []) {
  console.log(`\n--- Checking profile ${profile.id} (${profile.full_name}) ---`)
  console.log("status:", profile.status, "| role:", profile.role, "| department:", profile.department, "| department_id:", profile.department_id)

  const { data: deptRow } = await supabase
    .from("departments")
    .select("id, name, code")
    .eq("code", "QLCL")
    .maybeSingle()
  console.log("departments row for code=QLCL:", deptRow)
  const deptMatch =
    (deptRow?.id && profile.department_id === deptRow.id) ||
    (deptRow?.name && profile.department === deptRow.name) ||
    (profile.department?.toUpperCase() === "QLCL")
  console.log("=> dept match result:", !!deptMatch)

  const { data: staffRows } = await supabase
    .from("maintenance_staff")
    .select("id, ten, chuc_vu, chuc_vu_chinh_quyen, active, factory_id, profile_id")
    .eq("profile_id", profile.id)
  console.log("maintenance_staff rows linked to this profile_id:", staffRows)

  const LEADER_KEYWORDS = ["trưởng phòng", "phó phòng", "giám đốc"]
  for (const s of staffRows || []) {
    const cv = (s.chuc_vu || "").toLowerCase()
    const cvcq = (s.chuc_vu_chinh_quyen || "").toLowerCase()
    const matchCv = LEADER_KEYWORDS.some((k) => cv.includes(k))
    const matchCvcq = LEADER_KEYWORDS.some((k) => cvcq.includes(k))
    console.log(`  staff row "${s.ten}" active=${s.active} factory_id=${s.factory_id}`)
    console.log(`    chuc_vu="${s.chuc_vu}" matchKeyword=${matchCv}`)
    console.log(`    chuc_vu_chinh_quyen="${s.chuc_vu_chinh_quyen}" matchKeyword=${matchCvcq}`)
  }

  const { data: explicitPerm } = await supabase
    .from("user_permissions")
    .select("permission_code, granted")
    .eq("user_id", profile.id)
    .eq("permission_code", "quality.phe_duyet")
  console.log("user_permissions row for quality.phe_duyet:", explicitPerm)

  const { data: rolePerm } = await supabase
    .from("role_permissions")
    .select("role, permission_code")
    .eq("permission_code", "quality.phe_duyet")
  console.log("role_permissions rows granting quality.phe_duyet to any role:", rolePerm)
  console.log(`=> this profile's role ("${profile.role}") has it via role_permissions:`, (rolePerm || []).some(r => r.role === profile.role))
}
