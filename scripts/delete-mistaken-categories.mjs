// Xoá 3 phân loại vật tư "Rotyl" tạo nhầm (08/09/2026, factory phuochoa_kt). Rotyl thật là VẬT TƯ
// (mã RTO1), không phải phân loại. Mặc định CHỈ XEM — thêm --apply mới xoá.
//   node --env-file=.env.local scripts/delete-mistaken-categories.mjs
//   node --env-file=.env.local scripts/delete-mistaken-categories.mjs --apply
// Chỉ xoá id nào: tên đúng "Rotyl" VÀ 0 tham chiếu ở mọi bảng trỏ tới inventory_item_categories
// (FK: inventory_items.category_id, maintenance_external_materials.category_id — đã grep migrations).
import { createClient } from "@supabase/supabase-js"

const APPLY = process.argv.includes("--apply")
const IDS = [
  "f225388c-8299-4707-bd22-c9f7a2f32ef1",
  "d26a0e83-9335-4e86-a2a9-e4bc6c0c9cfc",
  "275cfca7-5bdf-4340-b202-7d3c0f42e626",
]
const EXPECTED_NAME = "rotyl"
const REF_TABLES = ["inventory_items", "maintenance_external_materials"]

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error("Thiếu NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1) }
const supabase = createClient(url, key, { auth: { persistSession: false } })

const { data: cats, error } = await supabase
  .from("inventory_item_categories")
  .select("id, factory_id, code, name, created_at, is_active")
  .in("id", IDS)
if (error) { console.error("Lỗi đọc phân loại:", error.message); process.exit(1) }

const factoryIds = [...new Set((cats || []).map((c) => c.factory_id))]
const { data: factories } = factoryIds.length
  ? await supabase.from("factories").select("id, code").in("id", factoryIds)
  : { data: [] }
const factoryCode = new Map((factories || []).map((f) => [f.id, f.code]))

console.log(`Chế độ: ${APPLY ? "XOÁ THẬT (--apply)" : "CHỈ XEM"}`)
console.log(`Tìm thấy ${(cats || []).length}/${IDS.length} phân loại theo id.`)
const missing = IDS.filter((id) => !(cats || []).some((c) => c.id === id))
if (missing.length) console.log(`Không còn tồn tại (đã xoá trước đó?): ${missing.join(", ")}`)

const okIds = []
for (const c of cats || []) {
  const refs = {}
  for (const t of REF_TABLES) {
    const { count, error: cErr } = await supabase.from(t).select("id", { count: "exact", head: true }).eq("category_id", c.id)
    if (cErr) { console.error(`  Lỗi đếm ${t}: ${cErr.message}`); process.exit(1) }
    refs[t] = count ?? 0
  }
  const totalRefs = Object.values(refs).reduce((s, n) => s + n, 0)
  const nameOk = String(c.name || "").trim().toLowerCase() === EXPECTED_NAME
  const verdict = !nameOk ? "BỎ QUA — tên không phải Rotyl" : totalRefs > 0 ? "BỎ QUA — còn tham chiếu" : "SẼ XOÁ"
  console.log(`- ${c.id} | ${c.code} | "${c.name}" | factory ${factoryCode.get(c.factory_id) || c.factory_id} | tạo ${c.created_at} | tham chiếu ${JSON.stringify(refs)} → ${verdict}`)
  if (nameOk && totalRefs === 0) okIds.push(c.id)
}

if (!APPLY) {
  console.log(`\n${okIds.length} phân loại đủ điều kiện xoá. Chạy lại với --apply để xoá.`)
  process.exit(0)
}
if (!okIds.length) { console.log("Không có gì để xoá."); process.exit(0) }
const { error: delErr } = await supabase.from("inventory_item_categories").delete().in("id", okIds)
if (delErr) { console.error("Lỗi xoá:", delErr.message); process.exit(1) }
const { count: left } = await supabase.from("inventory_item_categories").select("id", { count: "exact", head: true }).in("id", okIds)
console.log(`Đã xoá ${okIds.length} phân loại. Còn lại trong DB theo các id này: ${left ?? "?"}`)
