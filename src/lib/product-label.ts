import { supabase } from "@/lib/supabase"
import { buildStorageLookupPath } from "@/lib/storage-detail"
import { getLoaiBanhConfig } from "@/lib/product-lot-config"

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
export type ProductLabelStatus = "predicted" | "produced" | "partial" | "partial_kien" | "not_found"

export type ProductLabelLookupResult = {
  status: ProductLabelStatus
  maLo: string
  kien: KienLetter
  loaiCsr: string | null
  loaiBanh: number | null
  boc: string | null
  nganId: string | null
  nganMa: string | null
  nganTen: string | null
  ngaySx: string | null
  // Ca sản xuất thực tế (A/B/C) của giao dịch ĐÓNG GÓP GẦN NHẤT cho kiện này — có giá trị khi
  // status = "produced" hoặc "partial_kien". Với "predicted"/"partial" luôn là null (kiện chưa
  // được nhập liệu thật, UI hiển thị "Chờ nhập liệu" thay vì suy đoán).
  ca: string | null
  realLotId: string | null
  // Kết quả chấm hạng KN mới nhất của lô thật (vd "CSR10", "CSR10RH") — null nếu lô chưa có
  // lô thật hoặc chưa có phiếu KN nào (UI hiển thị "Đang chờ kiểm nghiệm").
  datHang: string | null
  // Tổng số bành đã ghi nhận cho ĐÚNG kiện này (SUM toàn bộ lot_transactions, không phải chỉ 1
  // giao dịch) và số bành tối đa cho phép của kiện — chỉ có giá trị khi status = "produced" hoặc
  // "partial_kien". Dùng để hiển thị "Đã sản xuất N bành" và tính số còn thiếu ở UI.
  existingBanh: number
  maxPerKien: number | null
}

const KIEN_LOWER: Record<KienLetter, string> = { A: "a", B: "b", C: "c", D: "d" }

// Lấy dat_hang của phiếu KN mới nhất cho 1 lô thật — dedupe theo lan lớn nhất rồi created_at
// mới nhất, mirror đúng logic getRotHangLotCount() trong module-tasks.ts.
async function fetchLatestDatHang(lotId: string): Promise<string | null> {
  const { data } = await supabase
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
      nganId: null,
      nganMa: null,
      nganTen: null,
      ngaySx: null,
      ca: null,
      realLotId: null,
      datHang: null,
      existingBanh: 0,
      maxPerKien: null,
    }
  }

  // Case 1 — lô thật (ưu tiên cao nhất, áp dụng cho mọi lô bất kể có qua dự đoán hay không)
  const { data: lot } = await supabase
    .from("lots")
    .select("id,ma_lo,loai_csr,loai_banh,boc,ngan_id")
    .eq("factory_id", normalizedFactoryId)
    .eq("ma_lo", normalizedMaLo)
    .maybeSingle()

  if (lot) {
    const { data: txRows } = await supabase
      .from("lot_transactions")
      .select("ngan_id,ngay_nhap,ca,kien_a,kien_b,kien_c,kien_d")
      .eq("lot_id", lot.id)
      .order("ngay_nhap", { ascending: false })

    const kienField = `kien_${kienKey}`
    const rows = (txRows || []) as Array<{ ngan_id: string; ngay_nhap: string; ca: string | null }>
    // Bug đã fix (2026-07-16): trước đây chỉ kiểm tra "có tồn tại giao dịch nào > 0" (dùng
    // .find()), coi bất kỳ kiện nào đã bắt đầu (dù mới 1 bành) là "đã sản xuất xong" — SAI, phải
    // SUM toàn bộ giao dịch của đúng kiện rồi so với max_per_kien, mirror đúng công thức đã dùng
    // ở resolveKienForConfirm (confirm/actions.ts).
    const existingBanh = rows.reduce(
      (sum, row) => sum + Number((row as unknown as Record<string, unknown>)[kienField] || 0),
      0,
    )
    // rows đã order theo ngay_nhap desc — phần tử ĐẦU TIÊN có đóng góp cho kiện này là giao dịch
    // gần nhất, dùng để hiển thị ngày/ca/ngăn.
    const lastKienTx = rows.find(
      (row) => Number((row as unknown as Record<string, unknown>)[kienField] || 0) > 0,
    )

    const config = lot.loai_csr ? getLoaiBanhConfig(lot.loai_csr, Number(lot.loai_banh) || undefined) : null
    const maxPerKien = config?.max_per_kien ?? 36

    const datHang = await fetchLatestDatHang(lot.id)

    if (lastKienTx && existingBanh >= maxPerKien) {
      const { data: ngan } = await supabase
        .from("ngans")
        .select("id,ma_ngan,ten_ngan")
        .eq("id", lastKienTx.ngan_id)
        .maybeSingle()
      return {
        status: "produced",
        maLo: normalizedMaLo,
        kien,
        loaiCsr: lot.loai_csr,
        loaiBanh: lot.loai_banh,
        boc: lot.boc,
        nganId: lastKienTx.ngan_id,
        nganMa: ngan?.ma_ngan || null,
        nganTen: ngan?.ten_ngan || null,
        ngaySx: lastKienTx.ngay_nhap,
        ca: lastKienTx.ca || null,
        realLotId: lot.id,
        datHang,
        existingBanh,
        maxPerKien: config?.max_per_kien ?? null,
      }
    }

    if (lastKienTx && existingBanh > 0) {
      // Kiện đã có MỘT PHẦN bành nhưng chưa đủ — khác "produced" (chưa xong) và khác "partial"
      // thuần túy (không phải "chưa có gì") — vẫn phải cho phép xác nhận sản xuất tiếp.
      const { data: ngan } = await supabase
        .from("ngans")
        .select("id,ma_ngan,ten_ngan")
        .eq("id", lastKienTx.ngan_id)
        .maybeSingle()
      return {
        status: "partial_kien",
        maLo: normalizedMaLo,
        kien,
        loaiCsr: lot.loai_csr,
        loaiBanh: lot.loai_banh,
        boc: lot.boc,
        nganId: lastKienTx.ngan_id,
        nganMa: ngan?.ma_ngan || null,
        nganTen: ngan?.ten_ngan || null,
        ngaySx: lastKienTx.ngay_nhap,
        ca: lastKienTx.ca || null,
        realLotId: lot.id,
        datHang,
        existingBanh,
        maxPerKien: config?.max_per_kien ?? null,
      }
    }

    // Kiện này chưa có giao dịch thật, nhưng lô đã tồn tại (do kiện khác đã được xác nhận trước
    // đó) — vẫn phải tra ngăn nguồn theo lot.ngan_id, KHÔNG được hardcode null, nếu không kiện
    // đầu tiên (đi qua nhánh "predicted" bên dưới) hiển thị đúng số ngăn còn các kiện sau của
    // cùng lô lại hiện "-" dù đã có ngăn hợp lệ (bug đã xác nhận 2026-07-13).
    let partialNganMa: string | null = null
    let partialNganTen: string | null = null
    if (lot.ngan_id) {
      const { data: ngan } = await supabase
        .from("ngans")
        .select("ma_ngan,ten_ngan")
        .eq("id", lot.ngan_id)
        .maybeSingle()
      partialNganMa = ngan?.ma_ngan || null
      partialNganTen = ngan?.ten_ngan || null
    }

    return {
      status: "partial",
      maLo: normalizedMaLo,
      kien,
      loaiCsr: lot.loai_csr,
      loaiBanh: lot.loai_banh,
      boc: lot.boc,
      nganId: lot.ngan_id,
      nganMa: partialNganMa,
      nganTen: partialNganTen,
      ngaySx: null,
      ca: null,
      realLotId: lot.id,
      datHang,
      existingBanh: 0,
      maxPerKien: config?.max_per_kien ?? null,
    }
  }

  // Case 2 — chưa có lô thật, fallback dự đoán
  const { data: predicted } = await supabase
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
      const { data: ngan } = await supabase
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
      nganId,
      nganMa,
      nganTen,
      ngaySx: null,
      ca: null,
      realLotId: null,
      datHang: null,
      existingBanh: 0,
      maxPerKien: config?.max_per_kien ?? null,
    }
  }

  return {
    status: "not_found",
    maLo: normalizedMaLo,
    kien,
    loaiCsr: null,
    loaiBanh: null,
    boc: null,
    nganId: null,
    nganMa: null,
    nganTen: null,
    ngaySx: null,
    ca: null,
    realLotId: null,
    datHang: null,
    existingBanh: 0,
    maxPerKien: null,
  }
}

export function buildNganLookupPath(nganId?: string | null, nganMa?: string | null) {
  return buildStorageLookupPath(nganId, nganMa)
}
