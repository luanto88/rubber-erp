import type { SupabaseClient } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import { buildStorageLookupPath } from "@/lib/storage-detail"
import { getLoaiBanhConfig } from "@/lib/product-lot-config"

import { normalizeLotStatus } from "@/app/dashboard/product/shared"

export type KienLetter = "A" | "B" | "C" | "D"

export const KIEN_LETTERS: KienLetter[] = ["A", "B", "C", "D"]

function normalizeLookupValue(value?: string | null) {
  return (value || "").trim()
}

export function buildProductLabelLookupPath(factoryId: string, maLo: string, kien: KienLetter) {
  const params = new URLSearchParams()
  params.set("f", normalizeLookupValue(factoryId))
  params.set("lo", normalizeLookupValue(maLo))
  params.set("kien", kien)
  return `/product-label?${params.toString()}`
}

export function buildProductLabelLookupUrl(factoryId: string, maLo: string, kien: KienLetter) {
  const path = buildProductLabelLookupPath(factoryId, maLo, kien)
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  return origin ? `${origin}${path}` : path
}

// "partial_kien" (2026-07-16): kiện đã có MỘT PHẦN bành (đã bắt đầu sản xuất nhưng chưa đủ
// max_per_kien) — trước đây bị gộp nhầm vào "produced" chỉ vì có >=1 giao dịch >0 (bug đã fix,
// xem resolveProductLabelLookupTarget). Khác "partial" thuần túy (kiện CHƯA có giao dịch nào).
// "exported" (2026-09-02): lô thành phẩm đã chuyển trạng thái "Xuất hàng" hoặc nằm trong đơn xuất hàng.
export type ProductLabelStatus = "predicted" | "produced" | "partial" | "partial_kien" | "exported" | "not_found"

export type ProductLabelLookupResult = {
  status: ProductLabelStatus
  maLo: string
  kien: KienLetter
  loaiCsr: string | null
  loaiBanh: number | null
  boc: string | null
  pallet: string[] | string | null
  nganId: string | null
  nganMa: string | null
  nganTen: string | null
  ngaySx: string | null
  // Giờ sản xuất thực tế (lấy thời điểm gửi kiện từ lot_transactions.created_at)
  gioSx: string | null
  // Ca sản xuất thực tế (A/B/C) của giao dịch ĐÓNG GÓP GẦN NHẤT cho kiện này — có giá trị khi
  // status = "produced" hoặc "partial_kien" hoặc "exported". Với "predicted"/"partial" luôn là null (kiện chưa
  // được nhập liệu thật, UI hiển thị "Chờ nhập liệu" thay vì suy đoán).
  ca: string | null
  realLotId: string | null
  // Kết quả chấm hạng KN mới nhất của lô thật (vd "CSR10", "CSR10RH") — null nếu lô chưa có
  // lô thật hoặc chưa có phiếu KN nào (UI hiển thị "Đang chờ kiểm nghiệm").
  datHang: string | null
  // Tổng số bành đã ghi nhận cho ĐÚNG kiện này (SUM toàn bộ lot_transactions, không phải chỉ 1
  // giao dịch) và số bành tối đa cho phép của kiện — chỉ có giá trị khi status = "produced" hoặc
  // "partial_kien" hoặc "exported". Dùng để hiển thị "Đã sản xuất N bành" và tính số còn thiếu ở UI.
  existingBanh: number
  maxPerKien: number | null
  eudrOrderCode: string | null
  eudrOrderUrl: string | null
}

const KIEN_LOWER: Record<KienLetter, string> = { A: "a", B: "b", C: "c", D: "d" }

// Lấy dat_hang của phiếu KN mới nhất cho 1 lô thật — dedupe theo lan lớn nhất rồi created_at
// mới nhất, mirror đúng logic getRotHangLotCount() trong module-tasks.ts.
async function fetchLatestDatHang(lotId: string, client: SupabaseClient): Promise<string | null> {
  const { data } = await client
    .from("qc_results")
    .select("lan, created_at, dat_hang")
    .eq("lot_id", lotId)
  const rows = (data || []) as { lan: number | null; created_at: string; dat_hang: string | null }[]
  if (rows.length === 0) return null
  let latest = rows[0]
  for (const r of rows) {
    const rLan = r.lan || 1
    const latestLan = latest.lan || 1
    if (rLan > latestLan || (rLan === latestLan && new Date(r.created_at || 0) > new Date(latest.created_at || 0))) {
      latest = r
    }
  }
  return latest.dat_hang || null
}

export async function resolveProductLabelLookupTarget(
  factoryId: string,
  maLo: string,
  kien: KienLetter,
  client: SupabaseClient = supabase,
): Promise<ProductLabelLookupResult> {
  const normalizedFactoryId = normalizeLookupValue(factoryId)
  const normalizedMaLo = normalizeLookupValue(maLo)
  const kienKey = KIEN_LOWER[kien]

  if (!normalizedFactoryId || !normalizedMaLo) {
    return {
      status: "not_found",
      maLo: normalizedMaLo,
      kien,
      loaiCsr: null,
      loaiBanh: null,
      boc: null,
      pallet: null,
      nganId: null,
      nganMa: null,
      nganTen: null,
      ngaySx: null,
      gioSx: null,
      ca: null,
      realLotId: null,
      datHang: null,
      existingBanh: 0,
      maxPerKien: null,
      eudrOrderCode: null,
      eudrOrderUrl: null,
    }
  }

  // Case 1 — lô thật (ưu tiên cao nhất, áp dụng cho mọi lô bất kể có qua dự đoán hay không)
  const { data: lot } = await client
    .from("lots")
    .select("id,ma_lo,loai_csr,loai_banh,boc,pallet,trang_thai,ngan_id,created_at")
    .eq("factory_id", normalizedFactoryId)
    .eq("ma_lo", normalizedMaLo)
    .maybeSingle()

  if (lot) {
    const [{ data: txRows }, { data: exportOrders }] = await Promise.all([
      client
        .from("lot_transactions")
        .select("id,ngan_id,ngay_nhap,ca,kien_a,kien_b,kien_c,kien_d,boc,pallet,created_at")
        .eq("lot_id", lot.id)
        .order("ngay_nhap", { ascending: false })
        .order("created_at", { ascending: false }),
      client
        .from("export_orders")
        .select("id,ma_don,public_token,assignments")
        .eq("factory_id", normalizedFactoryId)
        .order("created_at", { ascending: false })
        .limit(100),
    ])

    const kienField = `kien_${kienKey}`
    const rows = (txRows || []) as Array<{
      id: string
      ngan_id: string
      ngay_nhap: string
      ca: string | null
      boc: string | null
      pallet: string[] | string | null
      created_at?: string | null
    }>

    const existingBanh = rows.reduce(
      (sum, row) => sum + Number((row as unknown as Record<string, unknown>)[kienField] || 0),
      0,
    )
    const lastKienTx = rows.find(
      (row) => Number((row as unknown as Record<string, unknown>)[kienField] || 0) > 0,
    )

    const config = lot.loai_csr ? getLoaiBanhConfig(lot.loai_csr, Number(lot.loai_banh) || undefined) : null
    const maxPerKien = config?.max_per_kien ?? 36

    const datHang = await fetchLatestDatHang(lot.id, client)

    // Tra cứu đơn xuất hàng liên quan
    const matchedOrder = (exportOrders || []).find((ord) => {
      const assigns = (ord.assignments || []) as Array<{ lot_id?: string; ma_lo?: string }>
      return assigns.some((a) => a.lot_id === lot.id || a.ma_lo === normalizedMaLo)
    })

    let eudrOrderCode: string | null = null
    let eudrOrderUrl: string | null = null
    if (matchedOrder) {
      eudrOrderCode = matchedOrder.ma_don
      if (matchedOrder.public_token) {
        eudrOrderUrl = `/eudr-order?token=${encodeURIComponent(matchedOrder.public_token)}`
      } else {
        eudrOrderUrl = `/dashboard/eudr/lookup?order=${encodeURIComponent(matchedOrder.ma_don)}`
      }
    }

    const isLotExported = normalizeLotStatus(lot.trang_thai) === "Xuất hàng" || Boolean(matchedOrder)

    const finalNganId = lastKienTx?.ngan_id || lot.ngan_id || null
    let nganMa: string | null = null
    let nganTen: string | null = null
    if (finalNganId) {
      const { data: ngan } = await client
        .from("ngans")
        .select("id,ma_ngan,ten_ngan")
        .eq("id", finalNganId)
        .maybeSingle()
      nganMa = ngan?.ma_ngan || null
      nganTen = ngan?.ten_ngan || null
    }

    const resolvedPallet = lastKienTx?.pallet || lot.pallet || null
    const resolvedGioSx = lastKienTx?.created_at || (lot as { created_at?: string | null }).created_at || null

    if (isLotExported) {
      return {
        status: "exported",
        maLo: normalizedMaLo,
        kien,
        loaiCsr: lot.loai_csr,
        loaiBanh: lot.loai_banh,
        boc: lastKienTx?.boc || lot.boc || null,
        pallet: resolvedPallet,
        nganId: finalNganId,
        nganMa,
        nganTen,
        ngaySx: lastKienTx?.ngay_nhap || null,
        gioSx: resolvedGioSx,
        ca: lastKienTx?.ca || null,
        realLotId: lot.id,
        datHang,
        existingBanh,
        maxPerKien: config?.max_per_kien ?? null,
        eudrOrderCode,
        eudrOrderUrl,
      }
    }

    if (lastKienTx && existingBanh >= maxPerKien) {
      return {
        status: "produced",
        maLo: normalizedMaLo,
        kien,
        loaiCsr: lot.loai_csr,
        loaiBanh: lot.loai_banh,
        boc: lastKienTx.boc || lot.boc || null,
        pallet: resolvedPallet,
        nganId: finalNganId,
        nganMa,
        nganTen,
        ngaySx: lastKienTx.ngay_nhap,
        gioSx: resolvedGioSx,
        ca: lastKienTx.ca || null,
        realLotId: lot.id,
        datHang,
        existingBanh,
        maxPerKien: config?.max_per_kien ?? null,
        eudrOrderCode,
        eudrOrderUrl,
      }
    }

    if (lastKienTx && existingBanh > 0) {
      return {
        status: "partial_kien",
        maLo: normalizedMaLo,
        kien,
        loaiCsr: lot.loai_csr,
        loaiBanh: lot.loai_banh,
        boc: lastKienTx.boc || lot.boc || null,
        pallet: resolvedPallet,
        nganId: finalNganId,
        nganMa,
        nganTen,
        ngaySx: lastKienTx.ngay_nhap,
        gioSx: resolvedGioSx,
        ca: lastKienTx.ca || null,
        realLotId: lot.id,
        datHang,
        existingBanh,
        maxPerKien: config?.max_per_kien ?? null,
        eudrOrderCode,
        eudrOrderUrl,
      }
    }

    return {
      status: "partial",
      maLo: normalizedMaLo,
      kien,
      loaiCsr: lot.loai_csr,
      loaiBanh: lot.loai_banh,
      boc: lot.boc,
      pallet: resolvedPallet,
      nganId: finalNganId,
      nganMa,
      nganTen,
      ngaySx: null,
      gioSx: null,
      ca: null,
      realLotId: lot.id,
      datHang,
      existingBanh: 0,
      maxPerKien: config?.max_per_kien ?? null,
      eudrOrderCode,
      eudrOrderUrl,
    }
  }

  // Case 2 — chưa có lô thật, fallback dự đoán
  const { data: predicted } = await client
    .from("lot_prediction_lots")
    .select("ma_lo,loai_csr,loai_banh,boc,kien_a_ngan_id,kien_b_ngan_id,kien_c_ngan_id,kien_d_ngan_id")
    .eq("factory_id", normalizedFactoryId)
    .eq("ma_lo", normalizedMaLo)
    .maybeSingle()

  if (predicted) {
    const nganIdField = `kien_${kienKey}_ngan_id`
    const nganId = (predicted as Record<string, unknown>)[nganIdField] as string | null
    let nganMa: string | null = null
    let nganTen: string | null = null
    if (nganId) {
      const { data: ngan } = await client
        .from("ngans")
        .select("ma_ngan,ten_ngan")
        .eq("id", nganId)
        .maybeSingle()
      nganMa = ngan?.ma_ngan || null
      nganTen = ngan?.ten_ngan || null
    }
    const config = predicted.loai_csr
      ? getLoaiBanhConfig(predicted.loai_csr, Number(predicted.loai_banh) || undefined)
      : null
    return {
      status: "predicted",
      maLo: normalizedMaLo,
      kien,
      loaiCsr: predicted.loai_csr,
      loaiBanh: predicted.loai_banh,
      boc: predicted.boc,
      pallet: null,
      nganId,
      nganMa,
      nganTen,
      ngaySx: null,
      gioSx: null,
      ca: null,
      realLotId: null,
      datHang: null,
      existingBanh: 0,
      maxPerKien: config?.max_per_kien ?? null,
      eudrOrderCode: null,
      eudrOrderUrl: null,
    }
  }

  return {
    status: "not_found",
    maLo: normalizedMaLo,
    kien,
    loaiCsr: null,
    loaiBanh: null,
    boc: null,
    pallet: null,
    nganId: null,
    nganMa: null,
    nganTen: null,
    ngaySx: null,
    gioSx: null,
    ca: null,
    realLotId: null,
    datHang: null,
    existingBanh: 0,
    maxPerKien: null,
    eudrOrderCode: null,
    eudrOrderUrl: null,
  }
}

export function buildNganLookupPath(nganId?: string | null, nganMa?: string | null) {
  return buildStorageLookupPath(nganId, nganMa)
}

// Dùng cho trang công khai `/product-label` (`ProductLabelClient`) — khách quét QR nhãn kiện
// chưa đăng nhập không còn đọc thẳng `lots`/`qc_results`/`ngans`/`lot_transactions`/
// `lot_prediction_lots` bằng anon key được nữa sau khi khóa RLS SELECT (2026-08-08). Gọi qua
// route service-role `/api/product-label/lookup` thay vì `resolveProductLabelLookupTarget()`
// trực tiếp.
export async function fetchProductLabelLookupPublic(
  factoryId: string,
  maLo: string,
  kien: KienLetter,
): Promise<ProductLabelLookupResult> {
  const search = new URLSearchParams({ f: factoryId, lo: maLo, kien })
  const res = await fetch(`/api/product-label/lookup?${search.toString()}`)
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(json?.error || "Không tải được thông tin lô/kiện.")
  }
  return json as ProductLabelLookupResult
}
