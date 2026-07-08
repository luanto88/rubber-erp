import { supabase } from "@/lib/supabase"
import { buildStorageLookupPath } from "@/lib/storage-detail"

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

export type ProductLabelStatus = "predicted" | "produced" | "partial" | "not_found"

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
  // Ca sản xuất thực tế (A/B/C) của đúng giao dịch đã ghi nhận kiện này — chỉ có giá trị khi
  // status = "produced". Với "predicted"/"partial" luôn là null (kiện chưa được nhập liệu
  // thật, UI hiển thị "Chờ nhập liệu" thay vì suy đoán).
  ca: string | null
  realLotId: string | null
}

const KIEN_LOWER: Record<KienLetter, string> = { A: "a", B: "b", C: "c", D: "d" }

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
    const txWithKien = (txRows || []).find(
      (row) => Number((row as Record<string, unknown>)[kienField] || 0) > 0,
    ) as { ngan_id: string; ngay_nhap: string; ca: string | null } | undefined

    if (txWithKien) {
      const { data: ngan } = await supabase
        .from("ngans")
        .select("id,ma_ngan,ten_ngan")
        .eq("id", txWithKien.ngan_id)
        .maybeSingle()
      return {
        status: "produced",
        maLo: normalizedMaLo,
        kien,
        loaiCsr: lot.loai_csr,
        loaiBanh: lot.loai_banh,
        boc: lot.boc,
        nganId: txWithKien.ngan_id,
        nganMa: ngan?.ma_ngan || null,
        nganTen: ngan?.ten_ngan || null,
        ngaySx: txWithKien.ngay_nhap,
        ca: txWithKien.ca || null,
        realLotId: lot.id,
      }
    }

    return {
      status: "partial",
      maLo: normalizedMaLo,
      kien,
      loaiCsr: lot.loai_csr,
      loaiBanh: lot.loai_banh,
      boc: lot.boc,
      nganId: lot.ngan_id,
      nganMa: null,
      nganTen: null,
      ngaySx: null,
      ca: null,
      realLotId: lot.id,
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
  }
}

export function buildNganLookupPath(nganId?: string | null, nganMa?: string | null) {
  return buildStorageLookupPath(nganId, nganMa)
}
