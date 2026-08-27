import { createClient } from "@supabase/supabase-js"
import { createHash } from "crypto"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const APPLY = process.argv.includes("--apply")

// Giai đoạn 0 mục 4 của kế hoạch ký số dùng chung (xem CLAUDE.md "Kế hoạch phiên sau
// 2026-08-27" + cung_cap_dl/du_an_ky_so_dung_chung - new.docx mục 6.1/9). Trước khi có
// content_hash trên doc_approval_log, các file PDF đã ký (ISO + Văn bản) không có bằng
// chứng toàn vẹn nào. Script này backfill hash cho các file ĐÃ KÝ SẴN trong Storage —
// insert-only (không UPDATE dòng log cũ nào, vì trigger nhat_ky_bat_bien chặn cả UPDATE
// của service role) — mỗi doc chỉ được backfill đúng 1 lần (idempotent, an toàn chạy lại).
//
// LƯU Ý QUAN TRỌNG: hash backfill KHÔNG phải bằng chứng toàn vẹn tại thời điểm ký gốc —
// chỉ chứng minh file không đổi kể từ mốc backfill (hash_backfilled_at) trở đi. Đây là do
// hạn chế thật (không ai chụp hash lúc ký gốc), không phải giả vờ hồi tố.
//
// Bắt buộc chạy migration 20260901_doc_approval_log_hardening.sql (thêm cột content_hash/
// hash_backfilled_at + trigger bất biến) TRƯỚC khi chạy script này.

async function fetchAllRows(table, columns) {
  const PAGE_SIZE = 500
  let from = 0
  const all = []
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .not("file_signed_pdf_url", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    all.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

async function fetchExistingBackfillDocIds(docType) {
  const PAGE_SIZE = 1000
  let from = 0
  const ids = new Set()
  for (;;) {
    const { data, error } = await supabase
      .from("doc_approval_log")
      .select("doc_id")
      .eq("doc_type", docType)
      .eq("action", "backfill_hash")
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`doc_approval_log (${docType}): ${error.message}`)
    for (const row of data || []) ids.add(row.doc_id)
    if (!data || data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return ids
}

async function hashRemoteFile(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} khi tải file`)
  const buf = Buffer.from(await res.arrayBuffer())
  return createHash("sha256").update(buf).digest("hex")
}

async function backfillTable(table, docType) {
  console.log(`\n=== ${table} (doc_type='${docType}') ===`)
  const rows = await fetchAllRows(table, "id, factory_id, file_signed_pdf_url")
  const alreadyDone = await fetchExistingBackfillDocIds(docType)
  const pending = rows.filter((r) => !alreadyDone.has(r.id))

  console.log(`Tổng file đã ký (PDF): ${rows.length}`)
  console.log(`Đã backfill từ trước: ${alreadyDone.size}`)
  console.log(`Còn cần backfill: ${pending.length}`)

  if (pending.length === 0) return { ok: 0, failed: 0 }

  let ok = 0
  let failed = 0
  const failedRows = []

  for (const row of pending) {
    try {
      const hash = await hashRemoteFile(row.file_signed_pdf_url)
      if (APPLY) {
        const { error: insertErr } = await supabase.from("doc_approval_log").insert({
          factory_id: row.factory_id,
          doc_id: row.id,
          doc_type: docType,
          user_id: null,
          action: "backfill_hash",
          content_hash: hash,
          hash_backfilled_at: new Date().toISOString(),
        })
        if (insertErr) throw new Error(insertErr.message)
      }
      ok += 1
      console.log(`${APPLY ? "[OK]" : "[DRY-RUN]"} ${docType}/${row.id} -> ${hash.slice(0, 12)}...`)
    } catch (err) {
      failed += 1
      failedRows.push({ id: row.id, url: row.file_signed_pdf_url, error: err instanceof Error ? err.message : String(err) })
      console.error(`[LỖI] ${docType}/${row.id}: ${err instanceof Error ? err.message : err}`)
    }
  }

  if (failedRows.length > 0) {
    console.log(`\n${failedRows.length} dòng lỗi (file có thể đã bị xoá khỏi Storage — không chặn phần còn lại):`)
    for (const f of failedRows) console.log(`  - ${f.id}: ${f.error}`)
  }

  return { ok, failed }
}

async function main() {
  console.log(APPLY ? "CHẾ ĐỘ: GHI THẬT (--apply)" : "CHẾ ĐỘ: DRY-RUN (thêm --apply để ghi thật)")

  const isoResult = await backfillTable("iso_documents", "iso")
  const vanBanResult = await backfillTable("van_ban_documents", "van_ban")

  console.log("\n=== Tổng kết ===")
  console.log(`ISO: ${isoResult.ok} thành công, ${isoResult.failed} lỗi`)
  console.log(`Văn bản: ${vanBanResult.ok} thành công, ${vanBanResult.failed} lỗi`)
  if (!APPLY) {
    console.log("\nĐây là dry-run — chưa ghi gì vào DB. Chạy lại kèm --apply để ghi thật.")
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
