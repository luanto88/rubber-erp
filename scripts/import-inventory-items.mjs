/**
 * Import hàng loạt vật tư kho từ file Excel / CSV
 *
 * Xử lý tự động:
 *   - category_id  : tên tiếng Việt  → UUID trong inventory_item_categories
 *   - default_warehouse_ids : mã kho (KB, KA, KTPMT...) → UUID array trong inventory_warehouses
 *
 * Cách dùng:
 *   node --env-file=.env.local scripts/import-inventory-items.mjs <đường-dẫn-file>
 *
 * Ví dụ:
 *   node --env-file=.env.local scripts/import-inventory-items.mjs "C:/Users/Software/items.xlsx"
 *   node --env-file=.env.local scripts/import-inventory-items.mjs items.csv
 *
 * Cột bắt buộc trong file (tên cột phân biệt hoa thường KHÔNG quan trọng):
 *   code, name, unit
 *
 * Cột tùy chọn (để trống = bỏ qua):
 *   category_id / category_name / phan_loai    → tên phân loại tiếng Việt
 *   default_warehouse_ids / warehouse / kho     → mã kho, nhiều kho cách nhau bằng dấu phẩy
 *   specification / quy_cach
 *   manages_lot   (TRUE/FALSE/1/0)
 *   manages_expiry (TRUE/FALSE/1/0)
 *   min_stock, max_stock, opening_stock
 *   is_active (mặc định TRUE)
 */

import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "fs"
import { resolve, extname } from "path"
import { createRequire } from "module"

const require = createRequire(import.meta.url)

// ─── config ───────────────────────────────────────────────────────────────────

const FACTORY_ID = "0268ab41-a564-4538-acf1-6297ac372f57"
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
const BATCH_SIZE = 50

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌  Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local")
  process.exit(1)
}

const filePath = process.argv[2]
if (!filePath) {
  console.error("❌  Vui lòng truyền đường dẫn file. Ví dụ:")
  console.error("    node --env-file=.env.local scripts/import-inventory-items.mjs items.xlsx")
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ─── helpers log ──────────────────────────────────────────────────────────────

const ok   = (msg) => console.log(`  ✅ ${msg}`)
const warn = (msg) => console.warn(`  ⚠️  ${msg}`)
const fail = (msg) => { console.error(`  ❌ ${msg}`); process.exit(1) }
const info = (msg) => console.log(`  ℹ️  ${msg}`)

// ─── đọc file ─────────────────────────────────────────────────────────────────

function readFile(path) {
  const xlsx = require("xlsx")
  const abs = resolve(path)
  const ext = extname(abs).toLowerCase()

  let workbook
  if (ext === ".csv") {
    const content = readFileSync(abs, "utf-8")
    workbook = xlsx.read(content, { type: "string" })
  } else {
    workbook = xlsx.readFile(abs)
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" })
  return rows
}

// ─── normalize tiếng Việt ────────────────────────────────────────────────────

// Bỏ toàn bộ dấu để so sánh mờ: "hoá chất" == "hóa chất"
function stripAccents(str) {
  return str.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim()
}

// ─── normalize tên cột ────────────────────────────────────────────────────────

function normalizeKey(key) {
  return key.trim().toLowerCase().replace(/\s+/g, "_")
}

function normalizeRow(row) {
  const out = {}
  for (const [k, v] of Object.entries(row)) {
    out[normalizeKey(k)] = typeof v === "string" ? v.trim() : v
  }
  return out
}

// Các alias tên cột được chấp nhận
const FIELD_ALIASES = {
  category_id: ["category_id", "category_name", "phan_loai", "phân_loại", "loai", "loại"],
  warehouse:   ["default_warehouse_ids", "default_w", "warehouse", "kho", "warehouse_code", "warehouse_codes"],
  spec:        ["specification", "quy_cach", "quy_cách"],
  manages_lot: ["manages_lot", "quan_ly_lo", "quan_li_lo"],
  manages_exp: ["manages_expiry", "quan_ly_han", "quan_li_han"],
  min_stock:   ["min_stock", "ton_min", "tồn_min"],
  max_stock:   ["max_stock", "ton_max", "tồn_max"],
  opening:     ["opening_stock", "ton_dau_ky", "tồn_đầu_kỳ"],
  is_active:   ["is_active", "hoat_dong", "hoạt_động"],
}

function getField(row, aliases) {
  for (const alias of aliases) {
    if (alias in row) return row[alias]
  }
  return undefined
}

// ─── parse boolean ────────────────────────────────────────────────────────────

function parseBool(val, defaultVal = false) {
  if (val === undefined || val === null || val === "") return defaultVal
  const s = String(val).trim().toUpperCase()
  return s === "TRUE" || s === "1" || s === "YES" || s === "CÓ"
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n📦  Import vật tư kho")
  console.log("─────────────────────────────────────────────────────")
  info(`File: ${filePath}`)
  info(`Nhà máy: ${FACTORY_ID}`)

  // 1. Đọc file
  let rawRows
  try {
    rawRows = readFile(filePath)
  } catch (e) {
    fail(`Không đọc được file: ${e.message}`)
  }
  info(`Đọc được ${rawRows.length} dòng từ file`)

  const rows = rawRows.map(normalizeRow)

  // 2. Load danh mục phân loại
  const { data: cats, error: catErr } = await sb
    .from("inventory_item_categories")
    .select("id, name, code")
    .eq("factory_id", FACTORY_ID)
  if (catErr) fail(`Không load được phân loại: ${catErr.message}`)

  const categoryByName = new Map(cats.map((c) => [c.name.trim().toLowerCase(), c.id]))
  const categoryByNameNoAccent = new Map(cats.map((c) => [stripAccents(c.name), c.id]))
  const categoryByCode = new Map(cats.map((c) => [c.code.trim().toUpperCase(), c.id]))
  ok(`Phân loại: ${cats.length} danh mục (${cats.map((c) => c.name).join(", ")})`)

  // 3. Load kho
  const { data: whs, error: whErr } = await sb
    .from("inventory_warehouses")
    .select("id, code, name")
    .eq("factory_id", FACTORY_ID)
  if (whErr) fail(`Không load được kho: ${whErr.message}`)

  const warehouseByCode = new Map(whs.map((w) => [w.code.trim().toUpperCase(), w.id]))
  ok(`Kho: ${whs.length} kho (${whs.map((w) => w.code).join(", ")})`)

  // 4. Build payload
  const payloads = []
  const skipped = []
  const missingCategories = new Set()
  const missingWarehouses = new Set()

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const lineNo = i + 2 // +2 vì dòng 1 là header

    const code = String(row.code || "").trim()
    const name = String(row.name || "").trim()
    const unit = String(row.unit || "").trim()

    if (!code) {
      skipped.push(`Dòng ${lineNo}: thiếu code`)
      continue
    }
    if (!name) {
      skipped.push(`Dòng ${lineNo} [${code}]: thiếu name`)
      continue
    }

    // category_id: lookup by name hoặc code
    const catRaw = String(getField(row, FIELD_ALIASES.category_id) ?? "").trim()
    let categoryId = null
    if (catRaw) {
      categoryId =
        categoryByName.get(catRaw.toLowerCase()) ||
        categoryByNameNoAccent.get(stripAccents(catRaw)) ||
        categoryByCode.get(catRaw.toUpperCase()) ||
        null
      if (!categoryId) missingCategories.add(catRaw)
    }

    // default_warehouse_ids: mã kho cách nhau bằng dấu phẩy
    const whRaw = String(getField(row, FIELD_ALIASES.warehouse) ?? "").trim()
    const whIds = []
    if (whRaw) {
      for (const code_ of whRaw.split(",")) {
        const wCode = code_.trim().toUpperCase()
        if (!wCode) continue
        const wId = warehouseByCode.get(wCode)
        if (wId) {
          whIds.push(wId)
        } else {
          missingWarehouses.add(wCode)
        }
      }
    }

    payloads.push({
      factory_id: FACTORY_ID,
      code,
      name,
      unit: unit || "cái",
      specification: String(getField(row, FIELD_ALIASES.spec) ?? "").trim() || null,
      category_id: categoryId,
      default_warehouse_ids: whIds,
      manages_lot: parseBool(getField(row, FIELD_ALIASES.manages_lot)),
      manages_expiry: parseBool(getField(row, FIELD_ALIASES.manages_exp)),
      min_stock: Number(getField(row, FIELD_ALIASES.min_stock)) || 0,
      max_stock: Number(getField(row, FIELD_ALIASES.max_stock)) || 0,
      opening_stock: Number(getField(row, FIELD_ALIASES.opening)) || 0,
      is_active: parseBool(getField(row, FIELD_ALIASES.is_active), true),
    })
  }

  // Cảnh báo tên phân loại không khớp
  if (missingCategories.size > 0) {
    warn(`Không tìm thấy phân loại (category_id sẽ là NULL): ${[...missingCategories].join(", ")}`)
    info(`Phân loại hiện có: ${cats.map((c) => `"${c.name}"`).join(", ")}`)
  }

  // Cảnh báo mã kho không khớp
  if (missingWarehouses.size > 0) {
    warn(`Không tìm thấy mã kho (bỏ qua): ${[...missingWarehouses].join(", ")}`)
    info(`Mã kho hiện có: ${whs.map((w) => w.code).join(", ")}`)
  }

  if (skipped.length > 0) {
    warn(`Bỏ qua ${skipped.length} dòng thiếu dữ liệu bắt buộc:`)
    skipped.forEach((s) => console.log(`    - ${s}`))
  }

  if (payloads.length === 0) {
    fail("Không có dòng hợp lệ nào để import.")
  }

  info(`Chuẩn bị upsert ${payloads.length} vật tư...`)

  // 5. Upsert theo batch
  let total = 0
  for (let i = 0; i < payloads.length; i += BATCH_SIZE) {
    const batch = payloads.slice(i, i + BATCH_SIZE)
    const { error } = await sb
      .from("inventory_items")
      .upsert(batch, { onConflict: "factory_id,code", ignoreDuplicates: false })
    if (error) fail(`Batch ${i / BATCH_SIZE + 1}: ${error.message}`)
    total += batch.length
    process.stdout.write(`\r  ⏳ Đã import: ${total} / ${payloads.length}`)
  }

  console.log()
  ok(`Hoàn thành! Đã upsert ${total} vật tư vào inventory_items.`)

  if (missingCategories.size > 0) {
    console.log()
    warn(`${missingCategories.size} phân loại không khớp → category_id = NULL.`)
    info("Chạy lại sau khi thêm đủ phân loại trong Cài đặt → Vật tư → Phân loại.")
  }

  console.log("─────────────────────────────────────────────────────\n")
}

main().catch((e) => { console.error(e); process.exit(1) })
