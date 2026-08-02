import { createClient } from "@supabase/supabase-js"

// Dọn dẹp task trùng do bug "việc định kỳ mắc kẹt" (đã fix ở migration
// 20260812_kpi_task_templates_skip_stuck.sql) sinh ra TRƯỚC KHI migration đó được chạy.
// Với mỗi template_id có NHIỀU HƠN 1 task đang mở (trang_thai NOT IN hoan_thanh/huy), giữ lại
// đúng 1 task có ngay_giao MỚI NHẤT, HỦY (trang_thai='huy' — không xóa cứng, giữ nguyên lịch
// sử/log) các task còn lại.
//
// Chạy: node --env-file=.env.local scripts/cleanup-kpi-duplicate-template-tasks.mjs           (dry-run, mặc định)
//       node --env-file=.env.local scripts/cleanup-kpi-duplicate-template-tasks.mjs --apply    (ghi thật)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const APPLY = process.argv.includes("--apply")

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function main() {
  const { data: openTasks, error } = await supabase
    .from("kpi_tasks")
    .select("id, factory_id, template_id, tieu_de, ngay_giao, trang_thai, created_at")
    .not("template_id", "is", null)
    .not("trang_thai", "in", "(hoan_thanh,huy)")
    .order("ngay_giao", { ascending: true })
  if (error) throw error

  const byTemplate = new Map()
  for (const t of openTasks) {
    if (!byTemplate.has(t.template_id)) byTemplate.set(t.template_id, [])
    byTemplate.get(t.template_id).push(t)
  }

  const toCancel = []
  const summary = []
  for (const [templateId, rows] of byTemplate) {
    if (rows.length < 2) continue
    // Giữ lại ngay_giao mới nhất; nếu trùng ngay_giao (không nên xảy ra vì có unique index) thì
    // giữ created_at mới nhất.
    const sorted = [...rows].sort((a, b) => (a.ngay_giao < b.ngay_giao ? 1 : a.ngay_giao > b.ngay_giao ? -1 : new Date(b.created_at) - new Date(a.created_at)))
    const keep = sorted[0]
    const cancel = sorted.slice(1)
    summary.push({ templateId, tieu_de: keep.tieu_de, giu_lai: keep.ngay_giao, huy: cancel.map((c) => c.ngay_giao) })
    toCancel.push(...cancel)
  }

  console.log(`Tìm thấy ${byTemplate.size} template có task đang mở; ${summary.length} template bị trùng (>1 task mở).`)
  console.log(JSON.stringify(summary, null, 2))
  console.log(`\nTổng số task sẽ bị HỦY (trang_thai='huy'): ${toCancel.length}`)
  console.log(toCancel.map((t) => `- ${t.id} | template=${t.template_id} | ngay_giao=${t.ngay_giao} | tieu_de="${t.tieu_de}"`).join("\n"))

  if (!APPLY) {
    console.log("\n[DRY-RUN] Không ghi gì cả. Chạy lại kèm --apply để thực thi.")
    return
  }

  if (toCancel.length === 0) {
    console.log("\nKhông có gì để hủy.")
    return
  }

  const ids = toCancel.map((t) => t.id)
  const { error: updErr, count } = await supabase
    .from("kpi_tasks")
    .update({ trang_thai: "huy" })
    .in("id", ids)
    .select("id", { count: "exact" })
  if (updErr) throw updErr
  console.log(`\n[APPLY] Đã hủy ${count ?? ids.length} task trùng.`)
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("FATAL:", err)
  process.exit(1)
})
