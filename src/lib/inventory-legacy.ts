// Kho vật tư — "Phiếu cũ" (dữ liệu AppSheet 01/01–31/07/2026, bảng inventory_legacy_movements, import bằng
// scripts/import-inventory-legacy-nxt.mjs). CHỈ ĐỌC: không có tồn / thẻ kho / balance, không sửa / huỷ / ký. Rule 13.
//
// Dùng ở: tab Nhập / Xuất (lồng phiếu cũ, gom theo mã NX), báo cáo sử dụng theo ngày (loader riêng), đối soát định mức.
// - 1 mã NX = 1 phiếu: luôn 1 ngày, 1 loại (X = xuất, N = nhập), 1 người; KHO theo từng dòng (98 phiếu nhiều kho).
// - Tên kho cũ → kho app: "Kho A" = Kho Vật Tư, "Kho B" = Kho Hóa Chất (người dùng xác nhận 2026-11-15; căn cứ mã phiếu
//   app N-KA / N-KB), còn lại khớp theo tên.
// - Mã NX = X|N + ddmmyy (NGÀY LẬP trên AppSheet) + hhmmss — có thể sau Ngày NX (vd X290726091857 lập 29/07, NX 26/07).

import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchAllPaginated } from "@/lib/supabase-helpers"

/** Phiếu cũ chỉ có trước ngày này (app bắt đầu dùng 30/07/2026). */
export const LEGACY_LAST_DATE = "2026-07-31"
export const LEGACY_LABEL = "Phiếu cũ (AppSheet)"

export type LegacyMovementRow = {
  id: string
  legacy_id: string
  ngay: string
  item_id: string
  item_code: string
  movement_type: "import" | "export"
  quantity: number
  ma_nx: string | null
  warehouse_name: string | null
  nguoi_nx: string | null
  ghi_chu: string | null
}

export type LegacyLine = {
  id: string
  itemId: string
  itemCode: string
  quantity: number
  warehouseName: string
  /** Kho app tương ứng (null = không khớp kho nào). */
  warehouseId: string | null
  note: string
}

export type LegacyDocument = {
  /** Khoá ổn định trong danh sách (không trùng id phiếu thật). */
  key: string
  maNx: string
  ngay: string
  /** Ngày lập trên AppSheet (tách từ mã NX) — null nếu mã không đúng dạng. */
  ngayLap: string | null
  movementType: "import" | "export"
  nguoi: string
  lines: LegacyLine[]
  warehouseIds: string[]
  warehouseNames: string[]
}

const WAREHOUSE_ALIAS: Record<string, string> = {
  "kho a": "kho vật tư",
  "kho b": "kho hóa chất",
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .trim()
    .toLowerCase()

/** Hàm ánh xạ tên kho cũ → id kho app (so khớp không dấu, không phân biệt hoa thường). */
export function makeLegacyWarehouseResolver(warehouses: Array<{ id: string; name: string; code?: string | null }>) {
  const byName = new Map<string, string>()
  for (const w of warehouses) {
    byName.set(fold(w.name), w.id)
    if (w.code) byName.set(fold(w.code), w.id)
  }
  return (legacyName: string | null | undefined): string | null => {
    const raw = (legacyName || "").trim().toLowerCase()
    if (!raw) return null
    const target = WAREHOUSE_ALIAS[raw] || raw
    return byName.get(fold(target)) ?? null
  }
}

/** "Châu Nho." / "Chau Nho" → "Chau Nho" (file cũ gõ lẫn). */
export function normalizeLegacyPerson(name: string | null | undefined): string {
  const s = (name || "").trim().replace(/[.\s]+$/u, "")
  if (!s) return ""
  return fold(s) === "chau nho" ? "Chau Nho" : s
}

/** X290726091857 → 2026-07-29. */
export function legacyCreatedDate(maNx: string | null | undefined): string | null {
  const m = String(maNx || "").match(/^[XN](\d{2})(\d{2})(\d{2})\d{6}$/)
  if (!m) return null
  const [, d, mo, y] = m
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null
  return `20${y}-${mo}-${d}`
}

/** Tải dòng phiếu cũ trong khoảng ngày (bảng chưa có — chưa chạy migration 20261125 — ⇒ rỗng). */
export async function loadLegacyMovements(
  sb: SupabaseClient,
  factoryId: string,
  args: { from?: string; to?: string; movementType?: "import" | "export" },
): Promise<LegacyMovementRow[]> {
  if (args.from && args.from > LEGACY_LAST_DATE) return []
  try {
    return await fetchAllPaginated<LegacyMovementRow>((a, b) => {
      let q = sb
        .from("inventory_legacy_movements")
        .select("id,legacy_id,ngay,item_id,item_code,movement_type,quantity,ma_nx,warehouse_name,nguoi_nx,ghi_chu")
        .eq("factory_id", factoryId)
      if (args.movementType) q = q.eq("movement_type", args.movementType)
      if (args.from) q = q.gte("ngay", args.from)
      if (args.to) q = q.lte("ngay", args.to)
      return q.order("ngay").order("id").range(a, b)
    })
  } catch (e) {
    const msg = String((e as { message?: string })?.message || e)
    if (/inventory_legacy_movements|does not exist|schema cache/i.test(msg)) return []
    throw e
  }
}

/** Gom dòng cũ thành phiếu theo mã NX (dòng thiếu mã NX ⇒ phiếu riêng theo legacy_id). Mới nhất trước. */
export function groupLegacyDocuments(rows: LegacyMovementRow[], resolveWarehouse: (name: string | null) => string | null): LegacyDocument[] {
  const map = new Map<string, LegacyDocument>()
  for (const r of rows) {
    const maNx = (r.ma_nx || "").trim() || r.legacy_id
    const key = `legacy:${r.movement_type}:${maNx}`
    let doc = map.get(key)
    if (!doc) {
      doc = {
        key,
        maNx,
        ngay: String(r.ngay).slice(0, 10),
        ngayLap: legacyCreatedDate(maNx),
        movementType: r.movement_type,
        nguoi: normalizeLegacyPerson(r.nguoi_nx),
        lines: [],
        warehouseIds: [],
        warehouseNames: [],
      }
      map.set(key, doc)
    }
    const warehouseName = (r.warehouse_name || "").trim()
    const warehouseId = resolveWarehouse(warehouseName)
    doc.lines.push({ id: r.id, itemId: r.item_id, itemCode: r.item_code, quantity: Number(r.quantity) || 0, warehouseName, warehouseId, note: (r.ghi_chu || "").trim() })
    if (warehouseId && !doc.warehouseIds.includes(warehouseId)) doc.warehouseIds.push(warehouseId)
    if (warehouseName && !doc.warehouseNames.includes(warehouseName)) doc.warehouseNames.push(warehouseName)
  }
  return [...map.values()].sort((a, b) => b.ngay.localeCompare(a.ngay) || b.maNx.localeCompare(a.maNx))
}

/**
 * Xuất kho cũ dùng cho đối soát định mức: CÙNG quy tắc với báo cáo sử dụng theo ngày — ô (ngày, vật tư) đã có xuất thật
 * (không tính phiếu điều chỉnh tồn) ⇒ bỏ dòng cũ, không cộng trùng.
 */
export function legacyExportsNotInReal<T extends { ngay: string; itemId: string }>(legacy: T[], realKeys: Set<string>): T[] {
  return legacy.filter((x) => !realKeys.has(`${x.ngay}|${x.itemId}`))
}
