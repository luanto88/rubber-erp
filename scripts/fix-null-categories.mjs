/**
 * Chẩn đoán và gán category_id cho vật tư đang NULL
 *
 * Bước 1 — xem danh sách phân loại và số vật tư NULL:
 *   node --env-file=.env.local scripts/fix-null-categories.mjs
 *
 * Bước 2 — gán vật tư NULL vào một phân loại cụ thể (dùng CODE phân loại):
 *   node --env-file=.env.local scripts/fix-null-categories.mjs HC
 */

import { createClient } from "@supabase/supabase-js"

const FACTORY_ID = "0268ab41-a564-4538-acf1-6297ac372f57"
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌  Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local")
  process.exit(1)
}

const targetCode = process.argv[2]?.trim().toUpperCase() || null

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function main() {
  console.log("\n🔍  Chẩn đoán category_id vật tư")
  console.log("─────────────────────────────────────────────────────")

  // Lấy danh sách phân loại
  const { data: cats, error: catErr } = await sb
    .from("inventory_item_categories")
    .select("id, code, name")
    .eq("factory_id", FACTORY_ID)
    .order("name")
  if (catErr) { console.error("❌", catErr.message); process.exit(1) }

  // Đếm số vật tư NULL
  const { count: nullCount, error: nullErr } = await sb
    .from("inventory_items")
    .select("id", { count: "exact", head: true })
    .eq("factory_id", FACTORY_ID)
    .is("category_id", null)
  if (nullErr) { console.error("❌", nullErr.message); process.exit(1) }

  // Đếm vật tư theo từng phân loại
  console.log("\n  Phân loại trong DB:")
  for (const c of cats) {
    const { count } = await sb
      .from("inventory_items")
      .select("id", { count: "exact", head: true })
      .eq("factory_id", FACTORY_ID)
      .eq("category_id", c.id)
    console.log(`    [${c.code.padEnd(8)}] ${c.name.padEnd(32)} → ${count ?? 0} vật tư`)
  }
  console.log(`    [${"NULL".padEnd(8)}] ${"(Chưa gán phân loại)".padEnd(32)} → ${nullCount ?? 0} vật tư`)

  if ((nullCount ?? 0) === 0) {
    console.log("\n  ✅ Tất cả vật tư đã có phân loại. Không cần fix.")
    console.log("─────────────────────────────────────────────────────\n")
    return
  }

  if (!targetCode) {
    console.log(`\n  ℹ️  Có ${nullCount} vật tư chưa được gán phân loại.`)
    console.log("  Để gán, chạy lại với CODE phân loại:")
    console.log("    node --env-file=.env.local scripts/fix-null-categories.mjs <CODE>")
    if (cats.length > 0) {
      console.log(`  Ví dụ: node --env-file=.env.local scripts/fix-null-categories.mjs ${cats[0].code}`)
    }
    console.log("─────────────────────────────────────────────────────\n")
    return
  }

  // Tìm phân loại đích
  const target = cats.find((c) => c.code.toUpperCase() === targetCode)
  if (!target) {
    console.error(`\n  ❌ Không tìm thấy phân loại với code "${targetCode}"`)
    console.error(`  Các code hợp lệ: ${cats.map((c) => c.code).join(", ")}`)
    process.exit(1)
  }

  console.log(`\n  ⏳ Gán ${nullCount} vật tư → "${target.name}" (${target.code})...`)
  const { error: updateErr } = await sb
    .from("inventory_items")
    .update({ category_id: target.id })
    .eq("factory_id", FACTORY_ID)
    .is("category_id", null)

  if (updateErr) { console.error("  ❌", updateErr.message); process.exit(1) }
  console.log(`  ✅ Xong! ${nullCount} vật tư đã được gán phân loại "${target.name}".`)
  console.log("─────────────────────────────────────────────────────\n")
}

main().catch((e) => { console.error(e); process.exit(1) })
