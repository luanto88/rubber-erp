// Kho vật tư — tải dữ liệu báo cáo sử dụng theo ngày. Nhận client Supabase làm tham số (trình duyệt dùng client anon theo
// RLS; script kiểm dùng service role). Rule 13.
//
// - Xuất kho thật: inventory_stock_movements movement_type='export' trong kỳ (phiếu huỷ đã bị xoá movement), BỎ dòng
//   của phiếu điều chỉnh tồn (inventory_documents.la_dieu_chinh — vd lô chốt tồn 24/07/2026) ⇒ ngày đó dùng số lịch sử.
// - Lịch sử: inventory_legacy_movements export (bảng có thể chưa có khi chưa chạy migration ⇒ coi như rỗng).
// - PostgREST cắt 1000 dòng ⇒ .range() + .order("id"); .in() chia lô 200.

import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import { loadAdjustmentDocumentIds } from "@/lib/inventory-adjustment"
import { buildDailyMatrix, type DayQty } from "./compute"
import type { DailyReportConfig, DailyReportKieu, DailyReportSnapshot, SnapItem } from "./types"

const CHUNK = 200

function chunks<T>(arr: T[], n = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

export async function loadItemsByIds(sb: SupabaseClient, factoryId: string, ids: string[]): Promise<Map<string, SnapItem>> {
  const map = new Map<string, SnapItem>()
  for (const part of chunks([...new Set(ids)])) {
    const { data, error } = await sb.from("inventory_items").select("id,code,name,unit").eq("factory_id", factoryId).in("id", part)
    if (error) throw error
    for (const r of (data || []) as Array<{ id: string; code: string | null; name: string | null; unit: string | null }>) {
      map.set(r.id, { id: r.id, code: r.code || "", name: r.name || "", unit: r.unit || "" })
    }
  }
  return map
}

async function loadRealExports(sb: SupabaseClient, factoryId: string, from: string, to: string, itemIds: string[]): Promise<DayQty[]> {
  const out: DayQty[] = []
  const adjustmentDocs = await loadAdjustmentDocumentIds(sb, factoryId)
  for (const part of chunks(itemIds)) {
    type Row = { item_id: string; movement_date: string; quantity_out: number | string | null; document_id: string | null }
    const rows = await fetchAllPaginated<Row>((a, b) =>
      sb
        .from("inventory_stock_movements")
        .select("id,item_id,movement_date,quantity_out,document_id")
        .eq("factory_id", factoryId)
        .eq("movement_type", "export")
        .gte("movement_date", from)
        .lte("movement_date", to)
        .in("item_id", part)
        .order("id")
        .range(a, b),
    )
    for (const r of rows) {
      if (r.document_id && adjustmentDocs.has(r.document_id)) continue
      out.push({ ngay: String(r.movement_date).slice(0, 10), itemId: r.item_id, qty: Number(r.quantity_out || 0) })
    }
  }
  return out
}

async function loadLegacyExports(sb: SupabaseClient, factoryId: string, from: string, to: string, itemIds: string[]): Promise<DayQty[]> {
  const out: DayQty[] = []
  try {
    for (const part of chunks(itemIds)) {
      const rows = await fetchAllPaginated<{ item_id: string; ngay: string; quantity: number | string }>((a, b) =>
        sb
          .from("inventory_legacy_movements")
          .select("id,item_id,ngay,quantity")
          .eq("factory_id", factoryId)
          .eq("movement_type", "export")
          .gte("ngay", from)
          .lte("ngay", to)
          .in("item_id", part)
          .order("id")
          .range(a, b),
      )
      for (const r of rows) out.push({ ngay: String(r.ngay).slice(0, 10), itemId: r.item_id, qty: Number(r.quantity || 0) })
    }
  } catch (e) {
    const msg = String((e as { message?: string })?.message || e)
    // Chưa chạy migration (bảng chưa có) ⇒ bỏ qua lịch sử.
    if (/inventory_legacy_movements|does not exist|schema cache/i.test(msg)) return []
    throw e
  }
  return out
}

export async function buildDailySnapshot(
  sb: SupabaseClient,
  factoryId: string,
  args: { from: string; to: string; kieu: DailyReportKieu; config: DailyReportConfig },
): Promise<DailyReportSnapshot> {
  const itemIds = [...new Set((args.config.columns || []).flatMap((c) => c.itemIds || []))]
  const [items, real, legacy] = await Promise.all([
    loadItemsByIds(sb, factoryId, itemIds),
    itemIds.length ? loadRealExports(sb, factoryId, args.from, args.to, itemIds) : Promise.resolve([]),
    itemIds.length ? loadLegacyExports(sb, factoryId, args.from, args.to, itemIds) : Promise.resolve([]),
  ])
  return buildDailyMatrix({ ...args, items, real, legacy })
}
