"use server";

import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { KienLetter } from "@/lib/product-label";
import { getExistingRealKg, markLotPredictionRealized } from "@/app/dashboard/product/predict/actions";
import { saveLotTransaction } from "@/app/dashboard/product/actions";
import { getLoaiBanhConfig } from "@/lib/product-lot-config";
import { getTodayISODate } from "@/lib/date-utils";

const KIEN_LOWER: Record<KienLetter, "a" | "b" | "c" | "d"> = {
  A: "a",
  B: "b",
  C: "c",
  D: "d",
};

export type ConfirmKienStatus = "predicted" | "partial" | "produced" | "not_found";

export type ConfirmKienLookup = {
  status: ConfirmKienStatus;
  maLo: string;
  kien: KienLetter;
  isNewLot: boolean;
  lotId: string | null;
  loaiCsr: string | null;
  loaiBanh: number | null;
  dayChuyen: string | null;
  boc: string | null;
  tham: string | null;
  pallet: string[] | null;
  ghiChu: string | null;
  nganId: string | null;
  nganMa: string | null;
  nganTen: string | null;
  maxPerKien: number | null;
  kienWeightKg: number | null;
};

function notFoundResult(maLo: string, kien: KienLetter): ConfirmKienLookup {
  return {
    status: "not_found",
    maLo,
    kien,
    isNewLot: false,
    lotId: null,
    loaiCsr: null,
    loaiBanh: null,
    dayChuyen: null,
    boc: null,
    tham: null,
    pallet: null,
    ghiChu: null,
    nganId: null,
    nganMa: null,
    nganTen: null,
    maxPerKien: null,
    kienWeightKg: null,
  };
}

async function loadNganInfo(nganId: string | null) {
  if (!nganId) return { nganMa: null as string | null, nganTen: null as string | null };
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("ngans")
    .select("ma_ngan,ten_ngan")
    .eq("id", nganId)
    .maybeSingle();
  return { nganMa: data?.ma_ngan ?? null, nganTen: data?.ten_ngan ?? null };
}

export async function resolveKienForConfirm(
  factoryId: string,
  maLoRaw: string,
  kien: KienLetter,
): Promise<ConfirmKienLookup> {
  const maLo = maLoRaw.trim();
  if (!factoryId || !maLo) return notFoundResult(maLo, kien);

  const supabase = getSupabaseAdmin();
  const kienKey = KIEN_LOWER[kien];
  const nganIdField = `kien_${kienKey}_ngan_id`;

  const [{ data: lot }, { data: predicted }] = await Promise.all([
    supabase
      .from("lots")
      .select("id,ma_lo,loai_csr,loai_banh,day_chuyen,boc,tham,pallet,ghi_chu,ngan_id")
      .eq("factory_id", factoryId)
      .eq("ma_lo", maLo)
      .maybeSingle(),
    supabase
      .from("lot_prediction_lots")
      .select(
        "ma_lo,loai_csr,loai_banh,boc,tham,origin_batch_id,kien_a_ngan_id,kien_b_ngan_id,kien_c_ngan_id,kien_d_ngan_id",
      )
      .eq("factory_id", factoryId)
      .eq("ma_lo", maLo)
      .maybeSingle(),
  ]);

  const predictedNganId = predicted
    ? ((predicted as Record<string, unknown>)[nganIdField] as string | null)
    : null;

  let dayChuyenFromBatch: string | null = null;
  if (predicted?.origin_batch_id) {
    const { data: batch } = await supabase
      .from("lot_prediction_batches")
      .select("day_chuyen")
      .eq("id", predicted.origin_batch_id)
      .maybeSingle();
    dayChuyenFromBatch = batch?.day_chuyen ?? null;
  }

  if (lot) {
    const { data: txRows } = await supabase
      .from("lot_transactions")
      .select("kien_a,kien_b,kien_c,kien_d")
      .eq("lot_id", lot.id);
    const alreadyProduced = (txRows || []).some(
      (row) => Number((row as Record<string, unknown>)[`kien_${kienKey}`] || 0) > 0,
    );

    const config = lot.loai_csr ? getLoaiBanhConfig(lot.loai_csr, Number(lot.loai_banh) || undefined) : null;

    if (alreadyProduced) {
      const { nganMa, nganTen } = await loadNganInfo(lot.ngan_id);
      return {
        status: "produced",
        maLo,
        kien,
        isNewLot: false,
        lotId: lot.id,
        loaiCsr: lot.loai_csr,
        loaiBanh: lot.loai_banh,
        dayChuyen: lot.day_chuyen,
        boc: lot.boc,
        tham: lot.tham,
        pallet: lot.pallet,
        ghiChu: lot.ghi_chu,
        nganId: lot.ngan_id,
        nganMa,
        nganTen,
        maxPerKien: config?.max_per_kien ?? null,
        kienWeightKg: config ? Math.round(config.max_per_kien * config.loai_banh * 100) / 100 : null,
      };
    }

    // Lô đã tồn tại nhưng kiện này chưa ghi nhận — ưu tiên ngăn theo dòng dự đoán per-kiện,
    // fallback về ngan_id chung của lô (đúng thứ tự ưu tiên đã chốt trong plan).
    const nganId = predictedNganId || lot.ngan_id || null;
    const { nganMa, nganTen } = await loadNganInfo(nganId);
    return {
      status: "partial",
      maLo,
      kien,
      isNewLot: false,
      lotId: lot.id,
      loaiCsr: lot.loai_csr,
      loaiBanh: lot.loai_banh,
      dayChuyen: lot.day_chuyen ?? dayChuyenFromBatch,
      boc: lot.boc,
      tham: lot.tham,
      pallet: lot.pallet,
      ghiChu: lot.ghi_chu,
      nganId,
      nganMa,
      nganTen,
      maxPerKien: config?.max_per_kien ?? null,
      kienWeightKg: config ? Math.round(config.max_per_kien * config.loai_banh * 100) / 100 : null,
    };
  }

  if (predicted) {
    const config = getLoaiBanhConfig(predicted.loai_csr, Number(predicted.loai_banh) || undefined);
    const { nganMa, nganTen } = await loadNganInfo(predictedNganId);
    return {
      status: "predicted",
      maLo,
      kien,
      isNewLot: true,
      lotId: null,
      loaiCsr: predicted.loai_csr,
      loaiBanh: predicted.loai_banh,
      dayChuyen: dayChuyenFromBatch,
      boc: predicted.boc,
      tham: predicted.tham,
      pallet: null,
      ghiChu: null,
      nganId: predictedNganId,
      nganMa,
      nganTen,
      maxPerKien: config.max_per_kien,
      kienWeightKg: Math.round(config.max_per_kien * config.loai_banh * 100) / 100,
    };
  }

  return notFoundResult(maLo, kien);
}

export type ActiveNganOption = { id: string; ma_ngan: string; ten_ngan: string; loai_nl: string };

// Fallback khi ngăn dự kiến của kiện này bị null (dữ liệu cũ/đã bị bỏ gán) — cho phép người
// dùng chọn tay một ngăn đang hoạt động thay vì bị kẹt không thể gửi.
export async function loadActiveNgansForFactory(factoryId: string): Promise<ActiveNganOption[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("ngans")
    .select("id,ma_ngan,ten_ngan,loai_nl")
    .eq("factory_id", factoryId)
    .in("trang_thai", ["Chờ sản xuất", "Đang sản xuất"])
    .order("ten_ngan", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as ActiveNganOption[];
}

export type ConfirmKienInput = {
  factoryId: string;
  maLo: string;
  kien: KienLetter;
  isNewLot: boolean;
  nganId: string;
  loaiCsr: string;
  loaiBanh: number;
  dayChuyen: string | null;
  soBanh: number;
  ngaySx: string;
  ca: string;
  boc?: string | null;
  pallet?: string[] | null;
  tham?: string | null;
  ghiChu?: string | null;
  userId: string | null;
};

export type ConfirmKienResult =
  | { success: true; lotId: string; soKg: number; createdAt: string | null }
  | { success: false; error: string };

export async function confirmKienProduction(input: ConfirmKienInput): Promise<ConfirmKienResult> {
  const supabase = getSupabaseAdmin();
  const maLo = input.maLo.trim();
  const kienKey = KIEN_LOWER[input.kien];

  if (!input.nganId) {
    return { success: false, error: "Chưa xác định ngăn nguồn cho kiện này." };
  }
  if (!input.soBanh || input.soBanh <= 0) {
    return { success: false, error: "Số bành phải lớn hơn 0." };
  }

  try {
    // Chống race: kiểm tra lại kiện chưa được ghi nhận trước khi ghi (lô có thể vừa được
    // người khác xác nhận giữa lúc mở trang và lúc bấm gửi).
    const { data: existingLot } = await supabase
      .from("lots")
      .select("id")
      .eq("factory_id", input.factoryId)
      .eq("ma_lo", maLo)
      .maybeSingle();

    if (existingLot) {
      const { data: txRows } = await supabase
        .from("lot_transactions")
        .select("kien_a,kien_b,kien_c,kien_d")
        .eq("lot_id", existingLot.id);
      const alreadyProduced = (txRows || []).some(
        (row) => Number((row as Record<string, unknown>)[`kien_${kienKey}`] || 0) > 0,
      );
      if (alreadyProduced) {
        return { success: false, error: "Kiện này vừa được ghi nhận sản xuất, vui lòng tải lại." };
      }
    }

    const soKg = Math.round(input.soBanh * input.loaiBanh * 100) / 100;

    const { data: ngan, error: nganError } = await supabase
      .from("ngans")
      .select("tong_kho")
      .eq("id", input.nganId)
      .eq("factory_id", input.factoryId)
      .maybeSingle();
    if (nganError || !ngan) {
      return { success: false, error: "Không tìm thấy ngăn nguồn được chọn." };
    }

    const existingRealKg = await getExistingRealKg(input.factoryId, input.nganId);
    const capKg = Number(ngan.tong_kho || 0) * 1.1;
    if (existingRealKg + soKg > capKg + 0.01) {
      return {
        success: false,
        error: "Ngăn sẽ vượt quá 110% sau khi ghi nhận, không thể gửi. Vui lòng kiểm tra lại số bành hoặc liên hệ vận hành.",
      };
    }

    const kienPayload: Record<string, number> = {
      kien_a: 0,
      kien_b: 0,
      kien_c: 0,
      kien_d: 0,
    };
    kienPayload[`kien_${kienKey}`] = input.soBanh;

    const saveResult = await saveLotTransaction({
      lot: {
        factory_id: input.factoryId,
        ma_lo: maLo,
        ngay_sx: input.ngaySx,
        ca: input.ca,
        loai_csr: input.loaiCsr,
        loai_banh: input.loaiBanh,
        ngan_id: input.nganId,
        day_chuyen: input.dayChuyen ?? undefined,
        boc: input.isNewLot ? (input.boc ?? undefined) : undefined,
        tham: input.isNewLot ? (input.tham ?? undefined) : undefined,
        pallet: input.isNewLot ? (input.pallet ?? undefined) : undefined,
        ghi_chu: input.isNewLot ? (input.ghiChu ?? undefined) : undefined,
      },
      transaction: {
        ngan_id: input.nganId,
        ca: input.ca,
        ngay_nhap: input.ngaySx,
        kien_a: kienPayload.kien_a,
        kien_b: kienPayload.kien_b,
        kien_c: kienPayload.kien_c,
        kien_d: kienPayload.kien_d,
        so_banh: input.soBanh,
        so_kg: soKg,
        created_by: input.userId ?? undefined,
      },
    });

    if (!saveResult.success) {
      return { success: false, error: saveResult.error };
    }

    const lotId = saveResult.lotId as string;

    // Chuyển dự kiến -> thật nếu có dòng dự đoán khớp mã lô này (idempotent, an toàn gọi lại
    // cho các kiện sau của cùng lô).
    const { data: predictionRow } = await supabase
      .from("lot_prediction_lots")
      .select("id")
      .eq("factory_id", input.factoryId)
      .eq("ma_lo", maLo)
      .maybeSingle();
    if (predictionRow) {
      await markLotPredictionRealized(input.factoryId, maLo, lotId);
    }

    let createdAt: string | null = null;
    const transactionId = saveResult.transaction?.id as string | undefined;
    if (transactionId) {
      const { data: txRow } = await supabase
        .from("lot_transactions")
        .select("created_at")
        .eq("id", transactionId)
        .maybeSingle();
      createdAt = txRow?.created_at ?? null;
    }

    return { success: true, lotId, soKg, createdAt };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export type RecentConfirmation = {
  id: string;
  maLo: string;
  ngayNhap: string;
  ca: string;
  soBanh: number;
  soKg: number;
  createdAt: string | null;
};

export async function loadRecentConfirmations(
  factoryId: string,
  limitCount = 10,
): Promise<RecentConfirmation[]> {
  const supabase = getSupabaseAdmin();
  const today = getTodayISODate();
  const { data, error } = await supabase
    .from("lot_transactions")
    .select("id,ngay_nhap,ca,so_banh,so_kg,created_at,lots!inner(ma_lo,factory_id)")
    .eq("lots.factory_id", factoryId)
    .eq("ngay_nhap", today)
    .order("created_at", { ascending: false })
    .limit(limitCount);
  if (error) throw new Error(error.message);
  return ((data || []) as unknown as Array<{
    id: string;
    ngay_nhap: string;
    ca: string;
    so_banh: number;
    so_kg: number;
    created_at: string | null;
    lots: { ma_lo: string } | { ma_lo: string }[];
  }>).map((row) => ({
    id: row.id,
    maLo: Array.isArray(row.lots) ? row.lots[0]?.ma_lo ?? "" : row.lots?.ma_lo ?? "",
    ngayNhap: row.ngay_nhap,
    ca: row.ca,
    soBanh: Number(row.so_banh || 0),
    soKg: Number(row.so_kg || 0),
    createdAt: row.created_at,
  }));
}
