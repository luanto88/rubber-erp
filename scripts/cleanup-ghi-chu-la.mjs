import { createClient } from "@supabase/supabase-js"

// Dọn dữ liệu "ghi chú lạ" — đưa "0" và 3 biến thể "Bọc 0'04C không hàn" / "Bọc 0,04 không hàn" /
// "Bọc 0,04C không hàn" về "không có ghi chú" (NULL cho các cột phẳng, "" cho JSONB
// dispatch_entries.rows[].ghi_chu — đúng quy ước blank sẵn có của mảng dòng điều xe).
//
// Nguồn gốc "0": bug đã fix trong output-import.tsx (ô Ghi chú trống trong Excel bị đọc thành
// số 0, buộc người dùng "Thêm vào danh mục" để qua được import, rồi "0" bị ghi thẳng vào DB).
// 3 biến thể "Bọc..." là lỗi gõ tay qua quick-add, không liên quan bug trên.
//
// KHÔNG đụng "T" — người dùng xác nhận đây là ghi chú cố ý.
// KHÔNG đụng bảng danh mục required_notes — người dùng tự xóa 4 dòng liên quan (0 + 3 biến thể
// Bọc) qua Cài đặt → Danh mục → Ghi chú bắt buộc sau khi dữ liệu thật đã sạch.
// KHÔNG đụng dispatch_entry_rows (bảng vật lý đã đóng băng, không còn là nguồn dữ liệu thật —
// xem .claude/rules/19-dispatch-module.md mục "Đính chính quan trọng 2026-07-21") và không đụng
// qc_results (module Kiểm nghiệm, không thuộc hệ thống required_notes).
//
// Chạy: node --env-file=.env.local scripts/cleanup-ghi-chu-la.mjs          (dry-run, mặc định)
//       node --env-file=.env.local scripts/cleanup-ghi-chu-la.mjs --apply  (ghi thật)

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

// Chuẩn hóa để so khớp bất kể dấu nháy đơn thẳng/cong và có/không dấu phẩy trước cụm số —
// ví dụ "0'04C" và "0,04C" đều chuẩn hóa về "004c" nên vẫn khớp đúng dù nguồn dữ liệu gõ khác
// nhau, mà không làm 2 biến thể khác nghĩa ("0,04" và "0,04C") gộp nhầm vào nhau.
function normalizeForMatch(s) {
  return (s || "")
    .trim()
    .toLowerCase()
    .replace(/['‘’]/g, "")
    .replace(/,/g, "")
    .replace(/\s+/g, " ")
}

const TARGET_KEYS = new Set([
  normalizeForMatch("0"),
  normalizeForMatch("Bọc 0'04C không hàn"),
  normalizeForMatch("Bọc 0,04 không hàn"),
  normalizeForMatch("Bọc 0,04C không hàn"),
])

function isTargetNote(value) {
  const trimmed = (value || "").trim()
  if (!trimmed) return false // đã rỗng sẵn, không cần đụng
  return TARGET_KEYS.has(normalizeForMatch(trimmed))
}

// ─── 4 bảng cột phẳng dùng chung hệ thống required_notes ───

const FLAT_TABLES = [
  { table: "production_records", label: "Sản lượng (production_records)" },
  { table: "ngans", label: "Kho nguyên liệu (ngans)" },
  { table: "lots", label: "Thành phẩm (lots)" },
  { table: "product_confirm_drafts", label: "Nháp quét QR Thành phẩm (product_confirm_drafts)" },
]

async function fetchAllRowsWithNote(table) {
  const PAGE_SIZE = 1000
  let from = 0
  const all = []
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select("id, factory_id, ghi_chu")
      .not("ghi_chu", "is", null)
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    all.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

async function processFlatTable(table, label) {
  const rows = await fetchAllRowsWithNote(table)
  const matched = rows.filter((r) => isTargetNote(r.ghi_chu))
  console.log(`\n[${label}] Quét ${rows.length} dòng có ghi_chu — khớp ${matched.length} dòng cần dọn.`)
  if (matched.length > 0) {
    for (const r of matched.slice(0, 20)) {
      console.log(`  - id=${r.id} factory=${r.factory_id} ghi_chu="${r.ghi_chu}"`)
    }
    if (matched.length > 20) console.log(`  ... và ${matched.length - 20} dòng khác`)
  }
  if (APPLY && matched.length > 0) {
    const CHUNK_SIZE = 200
    const ids = matched.map((r) => r.id)
    let updatedCount = 0
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE)
      const { error, count } = await supabase
        .from(table)
        .update({ ghi_chu: null })
        .in("id", chunk)
        .select("id", { count: "exact" })
      if (error) throw new Error(`${table}: lỗi khi cập nhật lô ${i}-${i + chunk.length} — ${error.message}`)
      updatedCount += count ?? chunk.length
    }
    console.log(`  [APPLY] Đã đưa ${updatedCount} dòng về ghi_chu = NULL.`)
  }
  return matched.length
}

// ─── dispatch_entries.rows (JSONB, source of truth cho chi tiết điều xe) ───

async function fetchAllDispatchEntries() {
  const PAGE_SIZE = 500
  let from = 0
  const all = []
  for (;;) {
    const { data, error } = await supabase
      .from("dispatch_entries")
      .select("id, factory_id, ngay, rows")
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`dispatch_entries: ${error.message}`)
    all.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

async function processDispatchEntries() {
  const entries = await fetchAllDispatchEntries()
  let totalRowsMatched = 0
  const plannedUpdates = []

  for (const entry of entries) {
    const rows = Array.isArray(entry.rows) ? entry.rows : []
    let changed = false
    const nextRows = rows.map((row) => {
      if (!row || !isTargetNote(row.ghi_chu)) return row
      changed = true
      totalRowsMatched++
      console.log(
        `  [dispatch_entries ${entry.id}] ngày=${entry.ngay} factory=${entry.factory_id} so_xe=${row.so_xe} chuyến=${row.chuyen} ghi_chu="${row.ghi_chu}" -> ""`,
      )
      return { ...row, ghi_chu: "" }
    })
    if (changed) plannedUpdates.push({ id: entry.id, rows: nextRows })
  }

  console.log(
    `\n[Điều xe (dispatch_entries.rows)] Quét ${entries.length} phiếu — khớp ${totalRowsMatched} dòng chuyến ở ${plannedUpdates.length} phiếu cần dọn.`,
  )

  if (APPLY && plannedUpdates.length > 0) {
    for (const update of plannedUpdates) {
      const { error } = await supabase.from("dispatch_entries").update({ rows: update.rows }).eq("id", update.id)
      if (error) throw new Error(`dispatch_entries ${update.id}: lỗi khi cập nhật — ${error.message}`)
    }
    console.log(`  [APPLY] Đã cập nhật ${plannedUpdates.length} phiếu điều xe.`)
  }

  return totalRowsMatched
}

async function main() {
  console.log(APPLY ? "Chế độ: APPLY (sẽ ghi vào DB)" : "Chế độ: DRY-RUN (chỉ xem trước, chưa ghi DB)")
  console.log(
    "Giá trị mục tiêu (đưa về rỗng): \"0\", \"Bọc 0'04C không hàn\", \"Bọc 0,04 không hàn\", \"Bọc 0,04C không hàn\"",
  )
  console.log("KHÔNG đụng \"T\" và không đụng danh mục required_notes.\n")

  let total = 0
  for (const { table, label } of FLAT_TABLES) {
    total += await processFlatTable(table, label)
  }
  total += await processDispatchEntries()

  console.log(`\n=== TỔNG KẾT === Tổng số bản ghi cần dọn: ${total}`)

  if (total === 0) {
    console.log("Không có gì để dọn.")
    return
  }

  if (!APPLY) {
    console.log("\nĐây là DRY-RUN — chưa có gì được ghi vào DB.")
    console.log("Xem lại danh sách trên, nếu đúng hãy chạy lại với flag --apply:")
    console.log("  node --env-file=.env.local scripts/cleanup-ghi-chu-la.mjs --apply")
  } else {
    console.log("\nHoàn tất ghi dữ liệu. Danh mục required_notes (4 dòng: 0 + 3 biến thể Bọc)")
    console.log("chưa bị đụng tới — tự xóa qua Cài đặt → Danh mục → Ghi chú bắt buộc khi cần.")
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Lỗi:", err)
    process.exit(1)
  })
