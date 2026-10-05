import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { normalizeDateInput } from "@/lib/date-utils"
import { computeIntegrityHash } from "@/lib/signing/hash"

/**
 * "Dấu vân tay" dữ liệu nghiệp vụ tại thời điểm gửi ký — lưu vào `yeu_cau_ky.du_lieu_hash`
 * (migration 20261004_yeu_cau_ky_du_lieu_hash.sql). Thay cho cách cũ so `updated_at` của bản
 * ghi nguồn với `yeu_cau_ky.tao_luc`: `updated_at` bị đổi cả khi nội dung KHÔNG đổi (vd
 * writeBackToDispatch ghi lại y nguyên), gây badge "Đã ký — dữ liệu đã đổi" báo sai.
 *
 * Chỉ đưa vào hash những trường THỰC SỰ in lên PDF đã ký — đổi trường không in (ghi chú, DRC,
 * stops_detail...) không làm nội dung chứng từ khác đi nên không được báo "đã đổi".
 *
 * SERVER-ONLY (dùng service role).
 */

/** JSON ổn định: khóa object sắp xếp đệ quy, bỏ `undefined`. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null"
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) return "null"
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`
}

// Các cột KL in ở bảng chuyến của Phiếu điều xe ngày (Tươi/Khô theo 5 loại nguyên liệu) —
// mirror getTripMaterials() trong src/lib/dispatch-analytics.ts. DRC KHÔNG in nên không đưa vào.
const DISPATCH_KL_KEYS = [
  "kl_mn", "kl_mnk",
  "kl_ct", "kl_ck",
  "kl_dct", "kl_dck",
  "kl_dkt", "kl_dkk",
  "kl_dt", "kl_dk",
] as const

function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim().replace(",", "."))
  return Number.isFinite(n) ? n : 0
}

function toStr(v: unknown): string {
  return String(v ?? "").trim()
}

function toStrArr(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => toStr(x)).filter(Boolean)
}

function toNumArr(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => toNum(x)).filter((n) => n !== 0)
}

type DispatchEntryLike = {
  ngay?: string | null
  chung_nhan?: string | null
  rows?: unknown
}

/**
 * Trích đúng các trường in lên "Phiếu điều xe ngày" (buildDispatchEntryDoc trong
 * src/lib/dispatch-pdf.ts): ngày, chứng nhận; từng chuyến: xe, chuyến, tài xế, đội, điểm GN,
 * phiên, lô thu hoạch, km, KL tươi/khô 5 loại. Rows sắp theo (so_xe, chuyen) để thứ tự mảng
 * không ảnh hưởng hash.
 */
export function dispatchFingerprintPayload(entry: DispatchEntryLike) {
  const rawNgay = toStr(entry.ngay)
  const rowsIn = Array.isArray(entry.rows) ? (entry.rows as Array<Record<string, unknown>>) : []

  const rows = rowsIn
    .map((row) => {
      const out: Record<string, unknown> = {
        so_xe: toStr(row.so_xe).toUpperCase(),
        chuyen: toNum(row.chuyen) || 1,
        tai_xe: toStr(row.tai_xe),
        doi: toNumArr(row.doi),
        diem_gn: toStrArr(row.diem_gn),
        phien: toStrArr(row.phien),
        lo_thu_hoach: toStrArr(row.lo_thu_hoach),
        so_km: toNum(row.so_km),
      }
      for (const k of DISPATCH_KL_KEYS) out[k] = toNum(row[k])
      return out
    })
    .filter((r) => r.so_xe || DISPATCH_KL_KEYS.some((k) => (r[k] as number) !== 0))
    .sort((a, b) => {
      const x = String(a.so_xe).localeCompare(String(b.so_xe))
      if (x !== 0) return x
      const c = (a.chuyen as number) - (b.chuyen as number)
      if (c !== 0) return c
      // Tie-break ổn định khi trùng xe+chuyến: so cả nội dung.
      return canonicalJson(a).localeCompare(canonicalJson(b))
    })

  return {
    // Không dùng toISODate(): hàm đó trả "hôm nay" khi rỗng → hash phụ thuộc thời điểm tính.
    ngay: normalizeDateInput(rawNgay) || rawNgay,
    chung_nhan: toStr(entry.chung_nhan),
    rows,
  }
}

export function hashDispatchEntry(entry: DispatchEntryLike): string {
  return computeIntegrityHash(Buffer.from(canonicalJson(dispatchFingerprintPayload(entry)), "utf8"))
}

/**
 * Hash dữ liệu nguồn của 1 bản ghi nghiệp vụ theo module. Module chưa hỗ trợ → null.
 * Lỗi bất kỳ → null (không throw — đây là lớp phụ, không được làm hỏng luồng chính).
 */
export async function computeRecordFingerprint(
  modun: string,
  factoryId: string,
  banGhiId: string,
): Promise<string | null> {
  try {
    switch (modun) {
      case "dispatch": {
        const { data, error } = await getSupabaseAdmin()
          .from("dispatch_entries")
          .select("ngay, chung_nhan, rows")
          .eq("id", banGhiId)
          .eq("factory_id", factoryId)
          .maybeSingle()
        if (error || !data) return null
        return hashDispatchEntry(data as DispatchEntryLike)
      }
      default:
        return null
    }
  } catch (err) {
    console.warn("[data-fingerprint] Không tính được hash dữ liệu:", err)
    return null
  }
}
