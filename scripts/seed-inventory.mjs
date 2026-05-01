/**
 * Seed dữ liệu thật cho module Quản lý Kho
 * Nhà máy: Phước Hòa Kampong Thom
 *
 * Chạy: node --env-file=.env.local scripts/seed-inventory.mjs
 *
 * Script idempotent — chạy nhiều lần không bị trùng.
 * Nếu muốn reset hoàn toàn: xóa dữ liệu trong Supabase rồi chạy lại.
 */

import { createClient } from "@supabase/supabase-js"

const FACTORY_ID = "0268ab41-a564-4538-acf1-6297ac372f57" // Phước Hòa Kampong Thom
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌  Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function log(msg) { console.log(`  ${msg}`) }
function ok(msg)  { console.log(`  ✅ ${msg}`) }
function skip(msg){ console.log(`  ⏭️  ${msg}`) }
function err(msg) { console.error(`  ❌ ${msg}`); process.exit(1) }

// ─── helpers ──────────────────────────────────────────────────────────────────

async function upsertReturning(table, rows, conflictCol, label) {
  const { data, error } = await sb.from(table).upsert(rows, { onConflict: conflictCol, ignoreDuplicates: false }).select()
  if (error) err(`${label}: ${error.message}`)
  ok(`${label} (${data.length} bản ghi)`)
  return data
}

async function findDoc(code) {
  const { data } = await sb.from("inventory_documents")
    .select("id, status, document_code")
    .eq("factory_id", FACTORY_ID)
    .eq("document_code", code)
    .single()
  return data
}

async function createDocWithLines(docPayload, lines) {
  const { data: doc, error: docErr } = await sb.from("inventory_documents").insert(docPayload).select().single()
  if (docErr) err(`Tạo phiếu ${docPayload.document_code}: ${docErr.message}`)

  const lineRows = lines.map(l => ({ ...l, document_id: doc.id, factory_id: FACTORY_ID }))
  const { error: lineErr } = await sb.from("inventory_document_lines").insert(lineRows)
  if (lineErr) err(`Tạo dòng phiếu ${docPayload.document_code}: ${lineErr.message}`)

  return doc
}

async function postDoc(docId, type) {
  const rpcMap = {
    import:   "inventory_post_import_document",
    export:   "inventory_post_export_document",
    transfer: "inventory_post_transfer_document",
  }
  const { data, error } = await sb.rpc(rpcMap[type], {
    p_factory_id: FACTORY_ID,
    p_document_id: docId,
  })
  if (error) err(`Ghi sổ ${docId}: ${error.message}`)
  return data
}

// ─── 1. Kho ───────────────────────────────────────────────────────────────────

console.log("\n📦 1. Danh mục kho")
const warehouses = await upsertReturning(
  "inventory_warehouses",
  [
    { factory_id: FACTORY_ID, code: "KA", name: "Kho Vật Tư", keeper_name: "Nguyễn Văn An", warehouse_type: "general", is_active: true },
    { factory_id: FACTORY_ID, code: "KB", name: "Kho Hóa Chất", keeper_name: "Trần Thị Bình", warehouse_type: "chemical", is_active: true },
  ],
  "factory_id,code",
  "Kho"
)
const warehouseMap = Object.fromEntries(warehouses.map(w => [w.code, w]))

// ─── 2. Danh mục nhóm vật tư ──────────────────────────────────────────────────

console.log("\n🗂️  2. Nhóm vật tư")
const categories = await upsertReturning(
  "inventory_item_categories",
  [
    { factory_id: FACTORY_ID, code: "HC", name: "Hóa chất",            sort_order: 1 },
    { factory_id: FACTORY_ID, code: "VT", name: "Vật tư - Bao bì",     sort_order: 2 },
    { factory_id: FACTORY_ID, code: "BD", name: "Vật tư - Bảo dưỡng",  sort_order: 3 },
  ],
  "factory_id,code",
  "Nhóm vật tư"
)
const catMap = Object.fromEntries(categories.map(c => [c.code, c]))

// ─── 3. Vật tư / hóa chất ─────────────────────────────────────────────────────

console.log("\n🧪 3. Danh mục vật tư")
const itemDefs = [
  // Hóa chất — quản lý lô + hạn sử dụng
  { code: "HC001", name: "Axit formic 85%",           unit: "Lít", cat: "HC", manages_lot: true,  manages_expiry: true,  min_stock: 100, max_stock: 1000, specification: "Nồng độ ≥ 85%, TCVN" },
  { code: "HC002", name: "TMTD (gia tốc lưu hóa)",    unit: "Kg",  cat: "HC", manages_lot: true,  manages_expiry: true,  min_stock:  20, max_stock:  200, specification: "Tetramethylthiuram Disulfide" },
  { code: "HC003", name: "Amoniac 25%",               unit: "Lít", cat: "HC", manages_lot: true,  manages_expiry: true,  min_stock:  50, max_stock:  500, specification: "Nồng độ 25%, dùng bảo quản mủ" },
  { code: "HC004", name: "Natri carbonate (Na₂CO₃)",  unit: "Kg",  cat: "HC", manages_lot: false, manages_expiry: false, min_stock:  30, max_stock:  300 },
  // Vật tư bao bì — không quản lý lô
  { code: "VT001", name: "Bao PE 0.04mm (bao bì đóng gói)", unit: "Cái",  cat: "VT", manages_lot: false, manages_expiry: false, min_stock: 1000, max_stock: 10000 },
  { code: "VT002", name: "Dây đai nhựa 16mm",               unit: "Cuộn", cat: "VT", manages_lot: false, manages_expiry: false, min_stock:   10, max_stock:   100 },
  { code: "VT003", name: "Pallet gỗ 1200×1000mm",           unit: "Cái",  cat: "VT", manages_lot: false, manages_expiry: false, min_stock:   20, max_stock:   200 },
  { code: "VT004", name: "Băng keo đóng thùng 48mm",        unit: "Cuộn", cat: "VT", manages_lot: false, manages_expiry: false, min_stock:   50, max_stock:   200 },
  // Vật tư bảo dưỡng
  { code: "BD001", name: "Dầu nhớt Shell Rimula R4X 15W40", unit: "Lít", cat: "BD", manages_lot: false, manages_expiry: false, min_stock: 20, max_stock: 200 },
  { code: "BD002", name: "Vải lau công nghiệp",             unit: "Kg",  cat: "BD", manages_lot: false, manages_expiry: false, min_stock: 40, max_stock:  50 },
]
const itemRows = itemDefs.map(d => ({
  factory_id:      FACTORY_ID,
  category_id:     catMap[d.cat].id,
  code:            d.code,
  name:            d.name,
  unit:            d.unit,
  specification:   d.specification || null,
  manages_lot:     d.manages_lot,
  manages_expiry:  d.manages_expiry,
  min_stock:       d.min_stock,
  max_stock:       d.max_stock,
  is_active:       true,
}))
const items = await upsertReturning("inventory_items", itemRows, "factory_id,code", "Vật tư")
const itemMap = Object.fromEntries(items.map(i => [i.code, i]))

// ─── 4. Định mức min/max theo kho ─────────────────────────────────────────────

console.log("\n📐 4. Định mức min/max theo kho")
const ruleRows = [
  { item: "HC001", wh: "KB", min: 100, max: 1000, safety:  50, reorder: 150 },
  { item: "HC002", wh: "KB", min:  20, max:  200, safety:  10, reorder:  30 },
  { item: "HC003", wh: "KB", min:  50, max:  500, safety:  25, reorder:  75 },
  { item: "HC004", wh: "KB", min:  30, max:  300, safety:  15, reorder:  50 },
  { item: "VT001", wh: "KA", min: 1000, max: 10000, safety: 500, reorder: 1500 },
  { item: "VT002", wh: "KA", min:  10, max:  100, safety:   5, reorder:  15 },
  { item: "VT003", wh: "KA", min:  20, max:  200, safety:  10, reorder:  30 },
  { item: "VT004", wh: "KA", min:  50, max:  200, safety:  20, reorder:  60 },
  { item: "BD001", wh: "KA", min:  20, max:  200, safety:  10, reorder:  30 },
  { item: "BD002", wh: "KA", min:  40, max:   50, safety:  10, reorder:  20 },
]
const warehouseRuleRows = ruleRows.map(r => ({
  factory_id:   FACTORY_ID,
  item_id:      itemMap[r.item].id,
  warehouse_id: warehouseMap[r.wh].id,
  min_stock:    r.min,
  max_stock:    r.max,
  safety_stock: r.safety,
  reorder_point: r.reorder,
  is_primary:   true,
}))
await upsertReturning("inventory_item_warehouse_rules", warehouseRuleRows, "item_id,warehouse_id", "Định mức kho")

// ─── helpers để tạo & duyệt phiếu ────────────────────────────────────────────

async function processImportDoc(code, date, targetWhCode, linesDef) {
  const existing = await findDoc(code)
  if (existing?.status === "posted") { skip(`Phiếu ${code} đã ghi sổ, bỏ qua`); return }

  let docId = existing?.id
  if (!docId) {
    const doc = await createDocWithLines(
      {
        factory_id:          FACTORY_ID,
        document_code:       code,
        document_type:       "import",
        document_date:       date,
        target_warehouse_id: warehouseMap[targetWhCode].id,
        status:              "draft",
        source_name:         "Nhà cung cấp",
      },
      linesDef.map(l => ({
        item_id:    itemMap[l.code].id,
        item_code:  l.code,
        item_name:  itemMap[l.code].name,
        unit:       itemMap[l.code].unit,
        quantity:   l.qty,
        lot_no:     l.lot   || null,
        expiry_date: l.exp  || null,
      }))
    )
    docId = doc.id
    log(`Tạo phiếu nhập ${code}`)
  }

  await postDoc(docId, "import")
  ok(`Ghi sổ ${code}`)
}

async function processExportDoc(code, date, sourceWhCode, linesDef) {
  const existing = await findDoc(code)
  if (existing?.status === "posted") { skip(`Phiếu ${code} đã ghi sổ, bỏ qua`); return }

  let docId = existing?.id
  if (!docId) {
    const doc = await createDocWithLines(
      {
        factory_id:           FACTORY_ID,
        document_code:        code,
        document_type:        "export",
        document_date:        date,
        source_warehouse_id:  warehouseMap[sourceWhCode].id,
        status:               "draft",
        recipient_name:       "Tổ sản xuất",
        requester_name:       "Quản đốc",
      },
      linesDef.map(l => ({
        item_id:    itemMap[l.code].id,
        item_code:  l.code,
        item_name:  itemMap[l.code].name,
        unit:       itemMap[l.code].unit,
        quantity:   l.qty,
        lot_no:     l.lot   || null,
        expiry_date: l.exp  || null,
      }))
    )
    docId = doc.id
    log(`Tạo phiếu xuất ${code}`)
  }

  await postDoc(docId, "export")
  ok(`Ghi sổ ${code}`)
}

// ─── 5. Phiếu nhập kho ────────────────────────────────────────────────────────

console.log("\n📥 5. Phiếu nhập kho")

// N-KB-100426/001 — Nhập hóa chất vào KB ngày 10/04/2026
await processImportDoc("N-KB-100426/001", "2026-04-10", "KB", [
  { code: "HC001", qty: 500, lot: "HC001-240410", exp: "2027-04-10" },
  { code: "HC002", qty: 100, lot: "HC002-240410", exp: "2027-04-10" },
  { code: "HC003", qty: 200, lot: "HC003-241010", exp: "2026-10-10" },
  { code: "HC004", qty: 150 },
])

// N-KA-150426/001 — Nhập vật tư bao bì vào KA ngày 15/04/2026
await processImportDoc("N-KA-150426/001", "2026-04-15", "KA", [
  { code: "VT001", qty: 3000 },
  { code: "VT002", qty: 50 },
  { code: "VT003", qty: 100 },
  { code: "VT004", qty: 80 },
])

// N-KB-010526/001 — Nhập bổ sung hóa chất vào KB ngày 01/05/2026
// HC003 lô mới hạn 2026-10-01 → sắp hết hạn trong 6 tháng → cảnh báo
await processImportDoc("N-KB-010526/001", "2026-05-01", "KB", [
  { code: "HC001", qty: 300, lot: "HC001-260501", exp: "2027-05-01" },
  { code: "HC003", qty: 100, lot: "HC003-260501", exp: "2026-10-01" },
])

// N-KA-010526/001 — Nhập vật tư bảo dưỡng vào KA ngày 01/05/2026
await processImportDoc("N-KA-010526/001", "2026-05-01", "KA", [
  { code: "BD001", qty: 100 },
  { code: "BD002", qty: 30 },
])

// ─── 6. Phiếu xuất kho ────────────────────────────────────────────────────────

console.log("\n📤 6. Phiếu xuất kho")

// X-KA-200426/001 — Xuất vật tư cho sản xuất từ KA ngày 20/04/2026
await processExportDoc("X-KA-200426/001", "2026-04-20", "KA", [
  { code: "VT001", qty: 1500 },
  { code: "VT002", qty: 20 },
])

// X-KB-250426/001 — Xuất hóa chất từ KB ngày 25/04/2026
await processExportDoc("X-KB-250426/001", "2026-04-25", "KB", [
  { code: "HC001", qty: 150, lot: "HC001-240410", exp: "2027-04-10" },
  { code: "HC003", qty:  80, lot: "HC003-241010", exp: "2026-10-10" },
])

// ─── 7. Tóm tắt tồn kho dự kiến ───────────────────────────────────────────────

console.log("\n📊 7. Kiểm tra tồn kho")
const { data: balances, error: balErr } = await sb
  .from("inventory_stock_balances")
  .select("warehouse_id, item_id, on_hand, inventory_warehouses(code), inventory_items(code, name, min_stock)")
  .eq("factory_id", FACTORY_ID)
  .order("warehouse_id")

if (balErr) err(`Đọc tồn kho: ${balErr.message}`)

const rows = (balances || []).map(b => ({
  Kho:       b.inventory_warehouses?.code,
  "Mã VT":   b.inventory_items?.code,
  "Tên VT":  b.inventory_items?.name,
  "Tồn":     b.on_hand,
  "Min":     b.inventory_items?.min_stock,
  "Cảnh báo": b.on_hand < (b.inventory_items?.min_stock || 0) ? "⚠️ Thiếu" : "",
}))
console.table(rows)

console.log("\n✨ Seed hoàn tất!\n")
console.log("  Tồn kho dự kiến cuối cùng:")
console.log("  KB: HC001=650 lít | HC002=100 kg | HC003=220 lít | HC004=150 kg")
console.log("  KA: VT001=1500 cái | VT002=30 cuộn | VT003=100 cái | VT004=80 cuộn | BD001=100 lít | BD002=30 kg")
console.log("  ⚠️  BD002 (Vải lau): tồn 30 < min 40 → cảnh báo thiếu")
console.log("  ⚠️  HC003 lô HC003-260501: hạn 2026-10-01 → sắp hết hạn (<6 tháng)\n")
