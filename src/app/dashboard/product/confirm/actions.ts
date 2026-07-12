"use server";

import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { KienLetter } from "@/lib/product-label";
import { getExistingRealKg, markLotPredictionRealized } from "@/app/dashboard/product/predict/actions";
import { deleteLotTransaction, saveLotTransaction } from "@/app/dashboard/product/actions";
import { normalizeLotStatus } from "@/app/dashboard/product/shared";
import { getLoaiBanhConfig } from "@/lib/product-lot-config";
import { getTodayISODate } from "@/lib/date-utils";

const KIEN_LOWER: Record<KienLetter, "a" | "b" | "c" | "d"> = {
  A: "a",
  B: "b",
  C: "c",
  D: "d",
};

// "partial_kien": kiện đã có MỘT PHẦN bành (do top-up dở dang trước đó) — vẫn cho quét lại,
// nhưng số bành tối đa cho phép nhập = maxPerKien - existingBanh (xem mục 5 rule 06-module-production.md).
export type ConfirmKienStatus = "predicted" | "partial" | "partial_kien" | "produced" | "not_found";

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
  chiThi: string | null;
  ghiChu: string | null;
  nganId: string | null;
  nganMa: string | null;
  nganTen: string | null;
  maxPerKien: number | null;
  kienWeightKg: number | null;
  // Số bành kiện này đã có sẵn (chỉ > 0 khi status = "partial_kien") và số bành còn được phép
  // nhập thêm (= maxPerKien - existingBanh) — dùng để clamp stepper + hiện cảnh báo trên UI.
  existingBanh: number;
  remainingBanh: number | null;
  // Bọc/Pallet của ĐÚNG kiện đang xác nhận (không phải toàn lô) — chỉ có giá trị khi
  // status = "partial_kien" (kiện này đã có giao dịch trước đó). Quy tắc đã chốt: các lần nhập
  // tiếp theo của CÙNG 1 kiện được phép khác Ca SX/Số chỉ thị/Ngày SX, nhưng BẮT BUỘC cùng
  // Bọc/Pallet với lần nhập trước của chính kiện đó (loại bành đã cố định theo lô nên không cần
  // check thêm) — UI dùng 2 field này để pre-fill và cảnh báo khi người dùng chọn khác đi.
  existingKienBoc: string | null;
  existingKienPallet: string[] | null;
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
    chiThi: null,
    ghiChu: null,
    nganId: null,
    nganMa: null,
    nganTen: null,
    maxPerKien: null,
    kienWeightKg: null,
    existingBanh: 0,
    remainingBanh: null,
    existingKienBoc: null,
    existingKienPallet: null,
  };
}

// Gợi ý "Số chỉ thị" cho lô MỚI (chưa từng tồn tại trong `lots`) — mặc định theo lô có ngày
// thành phẩm gần nhất của nhà máy, mirror đúng nguồn `lots[0]?.chi_thi` mà product/page.tsx
// đang dùng (danh sách lots ở đó được order theo ngay_sx desc, created_at desc).
async function loadSuggestedChiThiForNewLot(factoryId: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("lots")
    .select("chi_thi")
    .eq("factory_id", factoryId)
    .order("ngay_sx", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.chi_thi || "1";
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
      .select("id,ma_lo,loai_csr,loai_banh,day_chuyen,boc,tham,pallet,chi_thi,ghi_chu,ngan_id")
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
      .select("kien_a,kien_b,kien_c,kien_d,boc,pallet,created_at")
      .eq("lot_id", lot.id)
      .order("created_at", { ascending: true });
    const rows = (txRows || []) as Array<{
      kien_a: number; kien_b: number; kien_c: number; kien_d: number;
      boc: string | null; pallet: string[] | null; created_at: string | null;
    }>;
    const existingBanh = rows.reduce(
      (sum, row) => sum + Number((row as Record<string, unknown>)[`kien_${kienKey}`] || 0),
      0,
    );
    // Bọc/Pallet của lần nhập GẦN NHẤT của ĐÚNG kiện này (không phải toàn lô) — dùng để bắt buộc
    // các lần nhập sau của cùng kiện phải đồng nhất (xem ghi chú ở ConfirmKienLookup).
    const kienField = `kien_${kienKey}` as "kien_a" | "kien_b" | "kien_c" | "kien_d";
    const lastKienTx = [...rows].reverse().find((row) => Number(row[kienField] || 0) > 0) || null;
    const existingKienBoc = lastKienTx?.boc ?? null;
    const existingKienPallet = lastKienTx?.pallet ?? null;

    const config = lot.loai_csr ? getLoaiBanhConfig(lot.loai_csr, Number(lot.loai_banh) || undefined) : null;
    const maxPerKien = config?.max_per_kien ?? 36;

    if (existingBanh >= maxPerKien) {
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
        chiThi: lot.chi_thi,
        ghiChu: lot.ghi_chu,
        nganId: lot.ngan_id,
        nganMa,
        nganTen,
        maxPerKien: config?.max_per_kien ?? null,
        kienWeightKg: config ? Math.round(config.max_per_kien * config.loai_banh * 100) / 100 : null,
        existingBanh,
        remainingBanh: 0,
        existingKienBoc,
        existingKienPallet,
      };
    }

    // Lô đã tồn tại, kiện này chưa đủ (chưa có gì hoặc có một phần) — ưu tiên ngăn theo dòng dự
    // đoán per-kiện, fallback về ngan_id chung của lô (đúng thứ tự ưu tiên đã chốt trong plan).
    const nganId = predictedNganId || lot.ngan_id || null;
    const { nganMa, nganTen } = await loadNganInfo(nganId);
    const isPartialKien = existingBanh > 0;
    return {
      status: isPartialKien ? "partial_kien" : "partial",
      maLo,
      kien,
      isNewLot: false,
      lotId: lot.id,
      loaiCsr: lot.loai_csr,
      loaiBanh: lot.loai_banh,
      dayChuyen: lot.day_chuyen ?? dayChuyenFromBatch,
      // Kiện đã có một phần: pre-fill đúng bọc/pallet của CHÍNH kiện đó (không phải lot.boc/pallet
      // — giá trị đó chỉ là "gần nhất của cả lô", có thể đến từ kiện KHÁC đã scan sau kiện này).
      boc: isPartialKien ? existingKienBoc ?? lot.boc : lot.boc,
      tham: lot.tham,
      pallet: isPartialKien ? existingKienPallet ?? lot.pallet : lot.pallet,
      chiThi: lot.chi_thi,
      ghiChu: lot.ghi_chu,
      nganId,
      nganMa,
      nganTen,
      maxPerKien: config?.max_per_kien ?? null,
      kienWeightKg: config ? Math.round(config.max_per_kien * config.loai_banh * 100) / 100 : null,
      existingBanh,
      remainingBanh: maxPerKien - existingBanh,
      existingKienBoc,
      existingKienPallet,
    };
  }

  if (predicted) {
    const config = getLoaiBanhConfig(predicted.loai_csr, Number(predicted.loai_banh) || undefined);
    const { nganMa, nganTen } = await loadNganInfo(predictedNganId);
    const chiThi = await loadSuggestedChiThiForNewLot(factoryId);
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
      chiThi,
      ghiChu: null,
      nganId: predictedNganId,
      nganMa,
      nganTen,
      maxPerKien: config.max_per_kien,
      kienWeightKg: Math.round(config.max_per_kien * config.loai_banh * 100) / 100,
      existingBanh: 0,
      remainingBanh: config.max_per_kien,
      existingKienBoc: null,
      existingKienPallet: null,
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
  // Bọc/Pallet/Số chỉ thị giờ LUÔN được gửi (không chỉ khi isNewLot) — người dùng có thể sửa
  // lại ở mọi kiện, kể cả kiện 2-4 của lô đã tồn tại (xem mục 1 rule 06-module-production.md).
  boc?: string | null;
  pallet?: string[] | null;
  chiThi?: string | null;
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
    // Chống race: tính lại số bành hiện có của đúng kiện này trước khi ghi (lô có thể vừa được
    // người khác xác nhận thêm giữa lúc mở trang và lúc bấm gửi) — cho phép top-up phần còn
    // thiếu, chỉ chặn khi vượt quá maxPerKien của đúng loại bành/CSR đang gửi lên.
    const config = getLoaiBanhConfig(input.loaiCsr, input.loaiBanh);
    const maxPerKien = config.max_per_kien;

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
      const existingBanh = (txRows || []).reduce(
        (sum, row) => sum + Number((row as Record<string, unknown>)[`kien_${kienKey}`] || 0),
        0,
      );
      if (existingBanh >= maxPerKien) {
        return { success: false, error: "Kiện này vừa được ghi nhận đủ sản lượng, vui lòng tải lại." };
      }
      if (existingBanh + input.soBanh > maxPerKien) {
        return {
          success: false,
          error: `Kiện ${input.kien} đã có ${existingBanh} bành, lần này chỉ được nhập tối đa ${maxPerKien - existingBanh} bành.`,
        };
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
        chi_thi: input.isNewLot ? (input.chiThi ?? undefined) : undefined,
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
        // Ghi kèm bọc/pallet/chỉ thị theo đúng lựa chọn của kiện này — syncLotMasterSnapshot()
        // sẽ tự cập nhật lại lots.boc/pallet/chi_thi theo giá trị mới nhất (xem product/actions.ts).
        boc: input.boc ?? null,
        pallet: input.pallet ?? null,
        chi_thi: input.chiThi ?? null,
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

// Chức danh thật hiển thị ở header (thay "Trực ca" cố định) — tra theo profile_id, mirror
// đúng pattern đã dùng ở src/app/api/documents/dept-leader/route.ts. Trả về null khi tài
// khoản chưa liên kết maintenance_staff hoặc chưa khai chuc_vu — page.tsx tự fallback về
// nhãn "Trực ca" (i18n key shiftLabel) khi null.
export async function loadUserChucVu(factoryId: string, profileId: string | null): Promise<string | null> {
  if (!profileId) return null;
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("maintenance_staff")
    .select("chuc_vu, chuc_vu_chinh_quyen")
    .eq("factory_id", factoryId)
    .eq("profile_id", profileId)
    .eq("active", true)
    .maybeSingle();
  return data?.chuc_vu_chinh_quyen || data?.chuc_vu || null;
}

const KIEN_ORDER: KienLetter[] = ["A", "B", "C", "D"];

type ShiftTxRow = {
  id: string;
  lot_id: string;
  ca: string;
  ngay_nhap: string;
  kien_a: number;
  kien_b: number;
  kien_c: number;
  kien_d: number;
  so_banh: number;
  so_kg: number;
  boc: string | null;
  pallet: string[] | null;
  chi_thi: string | null;
  ngan_id: string | null;
  created_at: string | null;
  created_by: string | null;
  lots: { ma_lo: string; loai_csr: string; loai_banh: number; trang_thai: string } | { ma_lo: string; loai_csr: string; loai_banh: number; trang_thai: string }[];
};

// Toàn bộ giao dịch của MỘT ngày sản xuất + ca — KHÔNG lọc theo người nhập, vì 1 ca có thể có
// nhiều người trực khác nhau nối tiếp nhau (đã chốt với người dùng). Dùng chung cho cả 3 nơi:
// - Hub "Lịch sử ca" (kèm xóa dòng)
// - Sinh phiếu báo thành phẩm cuối ca
// - Xem/tạo lại phiếu cũ theo ngày+ca bất kỳ
async function loadShiftTransactions(factoryId: string, ngaySx: string, ca: string): Promise<ShiftTxRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("lot_transactions")
    .select(
      "id,lot_id,ca,ngay_nhap,kien_a,kien_b,kien_c,kien_d,so_banh,so_kg,boc,pallet,chi_thi,ngan_id,created_at,created_by,lots!inner(ma_lo,loai_csr,loai_banh,trang_thai,factory_id)",
    )
    .eq("lots.factory_id", factoryId)
    .eq("ngay_nhap", ngaySx)
    .eq("ca", ca)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as unknown as ShiftTxRow[];
}

async function resolveProfileNames(profileIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(profileIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from("profiles").select("id, full_name, username").in("id", ids);
  const map = new Map<string, string>();
  for (const p of data || []) {
    map.set(p.id, p.full_name || p.username || "—");
  }
  return map;
}

export type ShiftHistoryEntry = {
  transactionId: string;
  lotId: string;
  maLo: string;
  kienLetters: string;
  soBanh: number;
  soKg: number;
  nguoiNhap: string;
  createdAt: string | null;
  canDelete: boolean;
};

// Danh sách giao dịch (từng lần quét 1 kiện) của 1 ngày SX + ca, mới nhất trước — dùng cho khối
// "Lịch sử ca" trong Hub, có kèm quyền xóa từng dòng.
export async function loadShiftHistory(
  factoryId: string,
  ngaySx: string,
  ca: string,
): Promise<ShiftHistoryEntry[]> {
  const rows = await loadShiftTransactions(factoryId, ngaySx, ca);
  const nameMap = await resolveProfileNames(rows.map((r) => r.created_by || ""));

  return rows
    .map((row) => {
      const lotInfo = Array.isArray(row.lots) ? row.lots[0] : row.lots;
      const letters = KIEN_ORDER.filter((k) => {
        const key = `kien_${KIEN_LOWER[k]}` as "kien_a" | "kien_b" | "kien_c" | "kien_d";
        return Number(row[key] || 0) > 0;
      }).join("");
      return {
        transactionId: row.id,
        lotId: row.lot_id,
        maLo: lotInfo?.ma_lo || "",
        kienLetters: letters,
        soBanh: Number(row.so_banh || 0),
        soKg: Number(row.so_kg || 0),
        nguoiNhap: row.created_by ? nameMap.get(row.created_by) || "—" : "—",
        createdAt: row.created_at,
        canDelete: normalizeLotStatus(lotInfo?.trang_thai) === "Dở dang",
      };
    })
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export type DeleteShiftHistoryResult = { success: true } | { success: false; error: string };

// Cho phép sửa lỗi nhập sai: xóa 1 giao dịch đã gửi trong Hub — chỉ khi lô liên quan vẫn đang
// "Dở dang" (chưa đi qua Kiểm nghiệm/Xuất hàng), re-check ở server chứ không tin canDelete phía
// client. Dùng lại deleteLotTransaction() (product/actions.ts) — đã tự đồng bộ lại lots.
export async function deleteShiftHistoryEntry(transactionId: string): Promise<DeleteShiftHistoryResult> {
  const supabase = getSupabaseAdmin();
  const { data: tx, error: txError } = await supabase
    .from("lot_transactions")
    .select("lot_id, lots!inner(trang_thai)")
    .eq("id", transactionId)
    .maybeSingle();
  if (txError || !tx) return { success: false, error: "Không tìm thấy giao dịch cần xóa." };

  const lotInfo = Array.isArray(tx.lots) ? tx.lots[0] : tx.lots;
  if (normalizeLotStatus(lotInfo?.trang_thai) !== "Dở dang") {
    return { success: false, error: "Lô đã qua bước tiếp theo (Hoàn thành/Xuất hàng...), không thể xóa từ đây." };
  }

  const result = await deleteLotTransaction({ transactionId });
  if (!result.success) return { success: false, error: result.error };
  return { success: true };
}

export type ShiftReportLotRow = {
  maLo: string;
  loaiCsr: string;
  loaiBanh: number;
  kienLetters: string;
  soBanh: number;
  soKg: number;
  boc: string;
  pallet: string;
  hoanThanhAt: string | null;
  nguoiNhap: string;
};

export type ShiftReportGroupRow = {
  loaiCsr: string;
  loaiBanh: number;
  boc: string;
  pallet: string;
  soBanh: number;
  soKg: number;
};

export type ShiftReportData = {
  ngay: string;
  ca: string;
  nganMa: string;
  soChiThi: string;
  rows: ShiftReportLotRow[];
  tongBanh: number;
  tongKg: number;
  byGroup: ShiftReportGroupRow[];
};

// Tổng hợp toàn bộ giao dịch của 1 NGÀY SX + CA (không lọc theo người nhập — 1 ca có thể có
// nhiều người trực) để in phiếu báo thành phẩm — dùng lại cho cả "Kết thúc ca" lẫn "Xem/tạo lại
// phiếu cũ" vì luôn truy vấn lại DB, không phụ thuộc phiên làm việc nào.
export async function loadShiftReportData(factoryId: string, ngaySx: string, ca: string): Promise<ShiftReportData> {
  const rows = await loadShiftTransactions(factoryId, ngaySx, ca);
  const nameMap = await resolveProfileNames(rows.map((r) => r.created_by || ""));

  // Nhóm theo (ma_lo + boc + pallet) của ĐÚNG giao dịch — KHÔNG chỉ theo ma_lo. Trước đây gộp
  // thuần theo ma_lo rồi ghi đè boc/pallet theo giao dịch cuối cùng (last-wins) khiến 1 lô có
  // các kiện dùng pallet khác nhau (vd A/B/C = "Sắt đế gỗ", D = "MB5") bị hiển thị sai thành MỘT
  // pallet duy nhất cho cả lô, kéo theo "Tổng hợp" cộng nhầm số bành vào sai nhóm pallet (bug đã
  // xác nhận 2026-07-13). Nhóm theo tổ hợp thuộc tính thật của từng giao dịch → khi các kiện của
  // cùng 1 lô khác bọc/pallet, chúng tự tách thành nhiều dòng riêng, mỗi dòng đúng số liệu.
  const byGroupKey = new Map<
    string,
    {
      maLo: string;
      loaiCsr: string;
      loaiBanh: number;
      letters: Set<KienLetter>;
      soBanh: number;
      soKg: number;
      boc: string;
      pallet: string;
      hoanThanhAt: string | null;
      nguoiNhap: string;
    }
  >();
  const nganIds = new Set<string>();
  const chiThiSet = new Set<string>();

  for (const row of rows) {
    const lotInfo = Array.isArray(row.lots) ? row.lots[0] : row.lots;
    const maLo = lotInfo?.ma_lo || "";
    if (!maLo) continue;
    if (row.ngan_id) nganIds.add(row.ngan_id);
    if (row.chi_thi) chiThiSet.add(row.chi_thi);

    const rowBoc = row.boc || "";
    const rowPallet = row.pallet && row.pallet.length > 0 ? row.pallet.join(", ") : "";
    const key = `${maLo}||${rowBoc}||${rowPallet}`;
    const entry = byGroupKey.get(key) || {
      maLo,
      loaiCsr: lotInfo?.loai_csr || "",
      loaiBanh: Number(lotInfo?.loai_banh) || 0,
      letters: new Set<KienLetter>(),
      soBanh: 0,
      soKg: 0,
      boc: rowBoc,
      pallet: rowPallet,
      hoanThanhAt: null,
      nguoiNhap: "",
    };
    if (Number(row.kien_a || 0) > 0) entry.letters.add("A");
    if (Number(row.kien_b || 0) > 0) entry.letters.add("B");
    if (Number(row.kien_c || 0) > 0) entry.letters.add("C");
    if (Number(row.kien_d || 0) > 0) entry.letters.add("D");
    entry.soBanh += Number(row.so_banh || 0);
    entry.soKg += Number(row.so_kg || 0);
    if (!entry.hoanThanhAt || (row.created_at && row.created_at > entry.hoanThanhAt)) {
      entry.hoanThanhAt = row.created_at;
      entry.nguoiNhap = row.created_by ? nameMap.get(row.created_by) || "—" : "—";
    }
    byGroupKey.set(key, entry);
  }

  const reportRows: ShiftReportLotRow[] = [...byGroupKey.values()].map((entry) => ({
    maLo: entry.maLo,
    loaiCsr: entry.loaiCsr,
    loaiBanh: entry.loaiBanh,
    kienLetters: KIEN_ORDER.filter((k) => entry.letters.has(k)).join(""),
    soBanh: entry.soBanh,
    soKg: Math.round(entry.soKg * 100) / 100,
    boc: entry.boc,
    pallet: entry.pallet,
    hoanThanhAt: entry.hoanThanhAt,
    nguoiNhap: entry.nguoiNhap,
  }));

  // Tổng hợp theo Loại CSR - Loại bành - Bọc - Loại pallet — nếu nhiều tổ hợp khác nhau thì
  // chia nhiều dòng (đã chốt với người dùng).
  const byGroupMap = new Map<string, ShiftReportGroupRow>();
  for (const r of reportRows) {
    const key = `${r.loaiCsr}||${r.loaiBanh}||${r.boc}||${r.pallet}`;
    const acc = byGroupMap.get(key) || { loaiCsr: r.loaiCsr, loaiBanh: r.loaiBanh, boc: r.boc, pallet: r.pallet, soBanh: 0, soKg: 0 };
    acc.soBanh += r.soBanh;
    acc.soKg += r.soKg;
    byGroupMap.set(key, acc);
  }

  let nganMa = "—";
  if (nganIds.size > 0) {
    const supabase = getSupabaseAdmin();
    const { data: ngans } = await supabase.from("ngans").select("id, ma_ngan").in("id", [...nganIds]);
    const mas = (ngans || []).map((n) => n.ma_ngan).filter(Boolean);
    if (mas.length > 0) nganMa = [...new Set(mas)].join(", ");
  }
  const soChiThi = chiThiSet.size > 0 ? [...chiThiSet].join(", ") : "—";

  return {
    ngay: ngaySx,
    ca,
    nganMa,
    soChiThi,
    rows: reportRows,
    tongBanh: reportRows.reduce((s, r) => s + r.soBanh, 0),
    tongKg: Math.round(reportRows.reduce((s, r) => s + r.soKg, 0) * 100) / 100,
    byGroup: [...byGroupMap.values()].map((g) => ({ ...g, soKg: Math.round(g.soKg * 100) / 100 })),
  };
}
