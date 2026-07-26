import { createClient } from "@supabase/supabase-js"

// Script điều tra READ-ONLY (không ghi/sửa gì) để xác nhận nguyên nhân "Hữu Thọ đăng ký thay
// thế RyTa nhưng không thấy task 'Tạo ngăn' hôm nay trong dropdown Gắn bằng chứng".
// Xem .claude/rules/27-kpi-module.md mục "Kế hoạch phiên sau (2026-07-26, tiếp)".
//
// Chạy: node --env-file=.env.local scripts/investigate-kpi-substitution.mjs

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function main() {
  const { data: factories, error: fErr } = await supabase.from("factories").select("id, code, name")
  if (fErr) throw fErr
  console.log("Factories:", factories)

  const { data: subs, error: subErr } = await supabase
    .from("kpi_user_substitutions")
    .select("*")
    .order("created_at", { ascending: false })
  if (subErr) throw subErr
  console.log("\n=== kpi_user_substitutions (all) ===")
  console.log(JSON.stringify(subs, null, 2))

  const { data: templates, error: tplErr } = await supabase
    .from("kpi_task_templates")
    .select("*")
    .order("created_at", { ascending: false })
  if (tplErr) throw tplErr
  console.log("\n=== kpi_task_templates (all) ===")
  console.log(JSON.stringify(templates, null, 2))

  const { data: tasks, error: taskErr } = await supabase
    .from("kpi_tasks")
    .select("*")
    .not("template_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(50)
  if (taskErr) throw taskErr
  console.log("\n=== kpi_tasks (template_id IS NOT NULL, gần nhất 50) ===")
  console.log(JSON.stringify(tasks, null, 2))

  const taskIds = (tasks || []).map((t) => t.id)
  if (taskIds.length) {
    const { data: members, error: memErr } = await supabase
      .from("kpi_task_members")
      .select("*")
      .in("task_id", taskIds)
    if (memErr) throw memErr
    console.log("\n=== kpi_task_members (cho các task định kỳ trên) ===")
    console.log(JSON.stringify(members, null, 2))
  }

  // Resolve tên qua maintenance_staff.profile_id để đối chiếu người thật (RyTa/Hữu Thọ)
  const userIds = new Set()
  ;(subs || []).forEach((s) => {
    userIds.add(s.original_user_id)
    userIds.add(s.substitute_user_id)
  })
  ;(tasks || []).forEach((t) => userIds.add(t.nguoi_giao_id))
  if (userIds.size) {
    const { data: staff, error: staffErr } = await supabase
      .from("maintenance_staff")
      .select("id, ten, profile_id, active")
      .in("profile_id", Array.from(userIds))
    if (staffErr) throw staffErr
    console.log("\n=== maintenance_staff (tên các user liên quan) ===")
    console.log(JSON.stringify(staff, null, 2))
  }

  console.log("\n=== Hôm nay (server) ===", new Date().toISOString())
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("LỖI:", err)
    process.exit(1)
  })
