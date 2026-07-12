import { createClient } from "@supabase/supabase-js"

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

// Bug: cloneRow()/cloneRowsTemplate() trong dispatch/page.tsx (trước khi được fix) chỉ sinh
// `uid` mới khi nhân bản 1 dòng, không reset `row_id` cũ — khiến nhiều dòng vật lý khác nhau
// trong CÙNG 1 phiếu điều xe chia sẻ chung `row_id`. Vì ref liên kết trip trong module Kho
// nguyên liệu là `${dispatchEntryId}::${rowId}`, các dòng bị trùng row_id chỉ còn 1 dòng
// resolve được — các dòng còn lại "biến mất" khỏi danh sách chuyến chọn được.
// Script này chỉ cấp lại row_id duy nhất cho các dòng trùng, không đổi so_xe/chuyen/uid/KL.

function genRowId() {
  return `r_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

async function fetchAllDispatchEntries() {
  const PAGE_SIZE = 500
  let from = 0
  const all = []
  for (;;) {
    const { data, error } = await supabase
      .from("dispatch_entries")
      .select("id, factory_id, ngay, rows")
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    all.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

function findDuplicateGroups(rows) {
  const byRowId = new Map()
  rows.forEach((row, index) => {
    const key = row.row_id || row.uid || ""
    if (!key) return
    if (!byRowId.has(key)) byRowId.set(key, [])
    byRowId.get(key).push(index)
  })
  return [...byRowId.entries()].filter(([, indices]) => indices.length > 1)
}

// Mirror getKLFromTrip() (src/lib/storage-detail.ts) — phải giữ đồng bộ nếu công thức đổi.
function getKLFromRow(row, loaiNL) {
  switch (loaiNL) {
    case "Mủ chén":
      return { tuoi: Number(row.kl_ct) || 0, kho: Number(row.kl_ck) || 0 }
    case "Mủ đông chén":
      return { tuoi: Number(row.kl_dct) || 0, kho: Number(row.kl_dck) || 0 }
    case "Mủ đông khối":
      return { tuoi: Number(row.kl_dkt) || 0, kho: Number(row.kl_dkk) || 0 }
    case "Mủ dây":
      return { tuoi: Number(row.kl_dt) || 0, kho: Number(row.kl_dk) || 0 }
    case "Mủ nước":
      return { tuoi: Number(row.kl_mn) || 0, kho: Number(row.kl_mnk) || 0 }
    default:
      return { tuoi: 0, kho: 0 }
  }
}

async function resyncNganTotalsForFactory(factoryId, allEntriesForFactory) {
  const { data: ngans, error: ngansError } = await supabase
    .from("ngans")
    .select("id, loai_nl, trips, tong_tuoi, tong_kho")
    .eq("factory_id", factoryId)
  if (ngansError) throw new Error(ngansError.message)
  if (!ngans || ngans.length === 0) return { checked: 0, updated: 0 }

  // Build ref -> row map, dùng đúng fallback rowId = row.row_id || row.uid (như buildDispatchTripRef)
  const rowByRef = new Map()
  for (const entry of allEntriesForFactory) {
    const rows = Array.isArray(entry.rows) ? entry.rows : []
    for (const row of rows) {
      const rowId = row.row_id || row.uid || ""
      if (!rowId) continue
      const ref = `${entry.id}::${rowId}`
      if (!rowByRef.has(ref)) rowByRef.set(ref, row)
      const bareUidRef = row.uid || ""
      if (bareUidRef && !rowByRef.has(bareUidRef)) rowByRef.set(bareUidRef, row)
    }
  }

  let updated = 0
  for (const ngan of ngans) {
    const tripRefs = Array.isArray(ngan.trips) ? ngan.trips.filter(Boolean) : []
    let tongTuoi = 0
    let tongKho = 0
    for (const ref of tripRefs) {
      const row = rowByRef.get(ref)
      if (!row) continue
      const kl = getKLFromRow(row, ngan.loai_nl)
      tongTuoi += kl.tuoi
      tongKho += kl.kho
    }
    tongTuoi = Math.round(tongTuoi * 100) / 100
    tongKho = Math.round(tongKho * 100) / 100
    const changed =
      Math.abs((ngan.tong_tuoi || 0) - tongTuoi) > 0.0001 ||
      Math.abs((ngan.tong_kho || 0) - tongKho) > 0.0001
    if (changed) {
      console.log(
        `  [ngan ${ngan.id}] tong_tuoi ${ngan.tong_tuoi} -> ${tongTuoi}, tong_kho ${ngan.tong_kho} -> ${tongKho}`,
      )
      if (APPLY) {
        const { error } = await supabase
          .from("ngans")
          .update({ tong_tuoi: tongTuoi, tong_kho: tongKho })
          .eq("id", ngan.id)
        if (error) throw new Error(error.message)
      }
      updated++
    }
  }
  return { checked: ngans.length, updated }
}

async function main() {
  console.log(APPLY ? "Chế độ: APPLY (sẽ ghi vào DB)" : "Chế độ: DRY-RUN (chỉ xem trước, chưa ghi DB)")
  console.log("Đang tải toàn bộ dispatch_entries...")
  const entries = await fetchAllDispatchEntries()
  console.log(`Đã tải ${entries.length} phiếu điều xe.\n`)

  const plannedUpdates = [] // { entryId, factoryId, rows (mutated copy) }
  const affectedFactoryIds = new Set()
  let totalDupGroups = 0
  let totalRowsReassigned = 0

  for (const entry of entries) {
    const rows = Array.isArray(entry.rows) ? entry.rows.map((r) => ({ ...r })) : []
    const dupGroups = findDuplicateGroups(rows)
    if (dupGroups.length === 0) continue

    console.log(`Phiếu ${entry.id} (ngày ${entry.ngay}, factory ${entry.factory_id}):`)
    let entryChanged = false
    for (const [rowId, indices] of dupGroups) {
      totalDupGroups++
      // Giữ nguyên phần tử đầu tiên (đang được mọi ref hiện tại trỏ tới), cấp row_id mới cho các phần tử còn lại
      const [, ...rest] = indices
      console.log(`  Nhóm trùng row_id=${rowId} (${indices.length} dòng):`)
      indices.forEach((idx, i) => {
        const r = rows[idx]
        const marker = i === 0 ? "GIỮ NGUYÊN" : "CẤP row_id MỚI"
        console.log(`    [${marker}] so_xe=${r.so_xe} chuyen=${r.chuyen} uid=${r.uid} row_id cũ=${r.row_id || r.uid}`)
      })
      for (const idx of rest) {
        const newRowId = genRowId()
        console.log(`      -> row_id mới cho dòng index ${idx} (so_xe=${rows[idx].so_xe}, chuyen=${rows[idx].chuyen}): ${newRowId}`)
        rows[idx].row_id = newRowId
        totalRowsReassigned++
        entryChanged = true
      }
    }
    console.log("")

    if (entryChanged) {
      plannedUpdates.push({ entryId: entry.id, factoryId: entry.factory_id, rows })
      affectedFactoryIds.add(entry.factory_id)
    }
  }

  console.log("=== TỔNG KẾT ===")
  console.log(`Số phiếu bị ảnh hưởng: ${plannedUpdates.length}`)
  console.log(`Số nhóm trùng row_id: ${totalDupGroups}`)
  console.log(`Số dòng được cấp row_id mới: ${totalRowsReassigned}`)

  if (plannedUpdates.length === 0) {
    console.log("Không phát hiện dữ liệu bị trùng row_id. Không cần làm gì thêm.")
    return
  }

  if (!APPLY) {
    console.log("\nĐây là DRY-RUN — chưa có gì được ghi vào DB.")
    console.log("Xem lại danh sách trên, nếu đồng ý hãy chạy lại với flag --apply:")
    console.log("  node --env-file=.env.local scripts/fix-duplicate-dispatch-row-ids.mjs --apply")
    return
  }

  console.log("\nĐang ghi các phiếu đã sửa vào DB...")
  for (const update of plannedUpdates) {
    const { error } = await supabase
      .from("dispatch_entries")
      .update({ rows: update.rows })
      .eq("id", update.entryId)
    if (error) throw new Error(`Lỗi khi cập nhật phiếu ${update.entryId}: ${error.message}`)
  }
  console.log(`Đã cập nhật ${plannedUpdates.length} phiếu.`)

  console.log("\nĐang đồng bộ lại tong_tuoi/tong_kho cho các ngăn bị ảnh hưởng...")
  for (const factoryId of affectedFactoryIds) {
    const entriesForFactory = entries
      .map((e) => {
        const updated = plannedUpdates.find((u) => u.entryId === e.id)
        return updated ? { ...e, rows: updated.rows } : e
      })
      .filter((e) => e.factory_id === factoryId)
    const result = await resyncNganTotalsForFactory(factoryId, entriesForFactory)
    console.log(`  Factory ${factoryId}: đã kiểm tra ${result.checked} ngăn, cập nhật ${result.updated} ngăn.`)
  }

  console.log("\nHoàn tất. Lưu ý: script chỉ khôi phục row_id duy nhất và tính lại KL theo các trip")
  console.log("đã có sẵn trong ngans.trips[] — nó KHÔNG tự thêm chuyến bị ẩn trước đây vào ngăn nào cả.")
  console.log("Nếu ngăn cần bổ sung thêm chuyến (vd chuyến 2 của 1 xe) vào danh sách trips, phải vào")
  console.log("Kho nguyên liệu → Sửa ngăn và tick chọn thủ công.")
}

main().catch((err) => {
  console.error("Lỗi:", err)
  process.exit(1)
})
