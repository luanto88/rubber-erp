// Nắp pallet theo kiện (GĐ3 phần B, migration 20261118_lot_nap.sql). THUẦN (client + server), không import supabase.
//
// lot_transactions.nap = {"a":"nap_sat","c":"nap_go"} — mã thành phần la_nap của bảng pallet_components, chỉ kiện có nắp.
// Ô Nắp chỉ hiện khi pallet của kiện có thành phần co_nap (Pallet sắt dày DPH ⇒ "Sắt đế gỗ", "Sắt đế nhựa").
// Cảnh báo (không chặn) khi 1 lô có quá MAX_NAP_PER_LOT kiện có nắp.

import {
  componentByCode,
  componentGroupCode,
  componentLabel,
  napComponents,
  type PalletComponentsConfig,
} from "@/lib/pallet-components"
import { palletComponentsFromConfig, type PackagingConfig } from "@/lib/product-packaging"

export type NapKien = "a" | "b" | "c" | "d"
export const NAP_KIENS: NapKien[] = ["a", "b", "c", "d"]
export type NapMap = Partial<Record<NapKien, string>>

/** 4 kiện DPH thường chỉ 2 nắp (1 nắp giữa kiện dưới và kiện trên). */
export const MAX_NAP_PER_LOT = 2

/** Pallet (danh sách tên loại pallet SX) có thành phần cần nắp không — khớp SQL pallet_names_need_nap. */
export function palletNeedsNap(
  packaging: PackagingConfig | null | undefined,
  components: PalletComponentsConfig | null | undefined,
  pallets: (string | null | undefined)[] | string | null | undefined,
): boolean {
  const list = (Array.isArray(pallets) ? pallets : [pallets]).map((p) => String(p ?? "").trim()).filter(Boolean)
  for (const p of list) {
    const comps = palletComponentsFromConfig(packaging, p) || []
    if (comps.some((c) => componentByCode(components, c)?.co_nap === true)) return true
  }
  return false
}

/** Mã nắp hợp lệ (thành phần la_nap, kể cả đã tắt — lô cũ vẫn tham chiếu). */
export function isNapCode(components: PalletComponentsConfig | null | undefined, code: string | null | undefined): boolean {
  const c = String(code ?? "").trim()
  return !!c && componentByCode(components, c)?.la_nap === true
}

/** Lựa chọn cho ô Nắp: nắp đang dùng (+ giá trị hiện tại nếu đã tắt). */
export function napOptions(
  components: PalletComponentsConfig | null | undefined,
  current?: string | null,
): { code: string; ten: string }[] {
  const out = napComponents(components).map((c) => ({ code: c.code, ten: c.ten }))
  const cur = String(current ?? "").trim()
  if (cur && !out.some((o) => o.code === cur) && isNapCode(components, cur)) {
    out.unshift({ code: cur, ten: componentLabel(components, cur) })
  }
  return out
}

/** JSONB / dữ liệu lạ ⇒ NapMap sạch (chỉ khoá a..d, giá trị chuỗi khác rỗng). */
export function parseNapMap(raw: unknown): NapMap {
  const out: NapMap = {}
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim().toLowerCase() as NapKien
    const val = String(v ?? "").trim()
    if (NAP_KIENS.includes(key) && val) out[key] = val
  }
  return out
}

/**
 * Lọc nắp trước khi ghi (mirror SQL lot_nap_sanitize): chỉ kiện có bành, mã là nắp, pallet cần nắp.
 * kienBanh = {a,b,c,d} số bành của giao dịch.
 */
export function sanitizeNapMap(
  nap: NapMap | null | undefined,
  kienBanh: Partial<Record<NapKien, number | null | undefined>>,
  pallets: string[] | null | undefined,
  packaging: PackagingConfig | null | undefined,
  components: PalletComponentsConfig | null | undefined,
): NapMap {
  if (!nap || !palletNeedsNap(packaging, components, pallets || [])) return {}
  const out: NapMap = {}
  for (const k of NAP_KIENS) {
    const code = String(nap[k] ?? "").trim()
    if (code && Number(kienBanh[k] || 0) > 0 && isNapCode(components, code)) out[k] = code
  }
  return out
}

export const napCount = (nap: NapMap | null | undefined) => NAP_KIENS.filter((k) => !!nap?.[k]).length

/**
 * Nắp của từng kiện trong LÔ từ các giao dịch: kiện có nắp nếu BẤT KỲ giao dịch nào chứa kiện ghi nắp cho kiện đó
 * (kiện quét bổ sung nhiều lần có thể chỉ 1 lần ghi nắp); giá trị = giao dịch mới nhất có ghi.
 */
export function lotNapByKien(
  txs: {
    nap?: unknown
    kien_a?: number | null
    kien_b?: number | null
    kien_c?: number | null
    kien_d?: number | null
    created_at?: string | null
  }[],
): NapMap {
  const sorted = [...txs].sort((x, y) => String(x.created_at || "").localeCompare(String(y.created_at || "")))
  const out: NapMap = {}
  for (const t of sorted) {
    const nap = parseNapMap(t.nap)
    const has: Record<NapKien, boolean> = {
      a: Number(t.kien_a || 0) > 0,
      b: Number(t.kien_b || 0) > 0,
      c: Number(t.kien_c || 0) > 0,
      d: Number(t.kien_d || 0) > 0,
    }
    for (const k of NAP_KIENS) if (has[k] && nap[k]) out[k] = nap[k]
  }
  return out
}

/** "A: NS, C: NG" — dùng cho chi tiết lô / lịch sử. */
export function formatNapMap(components: PalletComponentsConfig | null | undefined, nap: NapMap | null | undefined): string {
  return NAP_KIENS.filter((k) => nap?.[k])
    .map((k) => `${k.toUpperCase()}: ${componentLabel(components, String(nap![k]))}`)
    .join(", ")
}

/** "+ NS A, C / + NG D" — hậu tố cột pallet của F11. Rỗng khi không có nắp. */
export function formatNapSuffix(components: PalletComponentsConfig | null | undefined, nap: NapMap | null | undefined): string {
  const byCode = new Map<string, string[]>()
  for (const k of NAP_KIENS) {
    const c = nap?.[k]
    if (!c) continue
    byCode.set(c, [...(byCode.get(c) || []), k.toUpperCase()])
  }
  if (byCode.size === 0) return ""
  return [...byCode.entries()].map(([c, ks]) => `+ ${componentGroupCode(components, c)} ${ks.join(", ")}`).join(" / ")
}

export function napOverLimitMessage(maLo: string, total: number): string {
  return `Lô ${maLo} sẽ có ${total} nắp — thông thường 4 kiện DPH chỉ ${MAX_NAP_PER_LOT} nắp (1 nắp giữa kiện dưới và kiện trên). Vẫn lưu?`
}

/** Nắp đã ghi của 1 lô: giao dịch đã gửi + nháp chưa gửi. */
export type LotNapState = { sent: NapMap; drafts: NapMap }

/** Tổng kiện có nắp của lô sau khi thêm `adding` (kiện trùng chỉ tính 1 lần; adding ghi đè kiện đó). */
export function lotNapTotalAfter(state: LotNapState | null | undefined, adding: NapMap, removing: NapKien[] = []): number {
  const merged: NapMap = { ...(state?.sent || {}), ...(state?.drafts || {}) }
  for (const k of removing) delete merged[k]
  return napCount({ ...merged, ...parseNapMap(adding) })
}
