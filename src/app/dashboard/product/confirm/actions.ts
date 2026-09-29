"use server";

import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { KienLetter } from "@/lib/product-label";
import {
  getExistingRealKg,
  loadSwapCandidateNgans,
  markLotPredictionRealized,
} from "@/app/dashboard/product/predict/actions";
import {
  adminUpdateLotTransaction,
  deleteLotTransaction,
  saveLotTransaction,
} from "@/app/dashboard/product/actions";
import {
  assertProductAccess,
  assertReportAccess,
  PRODUCT_CREATE_PERMISSIONS,
  PRODUCT_SWAP_NGAN_PERMISSIONS,
  REPORT_DAILY_PERMISSIONS,
  REPORT_SHIFT_PERMISSIONS,
} from "@/app/dashboard/product/confirm/report-access";
import { normalizeLotStatus } from "@/app/dashboard/product/shared";
import { getLoaiBanhConfig } from "@/lib/product-lot-config";
import { getFactoryTodayISO, getTodayISODate } from "@/lib/date-utils";
import { resolveShiftNamesAt, SHIFT_CODES } from "@/app/dashboard/product/confirm/shift-names";
import { fetchAllPaginated } from "@/lib/supabase-helpers";

const KIEN_LOWER: Record<KienLetter, "a" | "b" | "c" | "d"> = {
  A: "a",
  B: "b",
  C: "c",
  D: "d",
};

// "partial_kien": kiện đã có MỘT PHẦN bành (do top-up dở dang trước đó, tính CẢ committed lẫn nháp
// chưa gửi của bất kỳ ai — xem loadPendingDraftAggregateForKien) — vẫn cho quét lại, nhưng số bành
// tối đa cho phép nhập = maxPerKien - (existingBanh + pendingDraftBanh) (mục 5 rule 06-module-production.md).
// "drafted_full": kiện đã đủ maxPerKien nhưng phần lớn/toàn bộ là NHÁP CHƯA GỬI (chưa thật sự sản
// xuất) — khác "produced" (đã gửi thật) để tránh thông báo sai là "đã sản xuất".
export type ConfirmKienStatus = "predicted" | "partial" | "partial_kien" | "drafted_full" | "produced" | "not_found";

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
  // Số bành kiện này ĐÃ GỬI THẬT (committed, lot_transactions) — giữ nguyên ý nghĩa cũ, KHÔNG gồm
  // nháp chưa gửi (xem pendingDraftBanh). remainingBanh giờ đã trừ luôn cả nháp chưa gửi.
  existingBanh: number;
  remainingBanh: number | null;
  // Số bành đang nằm trong nháp CHƯA GỬI của đúng kiện này — tính từ TẤT CẢ người dùng trong nhà
  // máy (không chỉ người đang quét), để ca sau biết chính xác ca trước đã "giữ chỗ" bao nhiêu dù
  // chưa Gửi. pendingDraftBy là tên hiển thị của những người đang có nháp đó (rỗng nếu không ai).
  pendingDraftBanh: number;
  pendingDraftBy: string[];
  // Bọc/Pallet "gần nhất" của ĐÚNG kiện đang xác nhận (không phải toàn lô) — ưu tiên nháp chưa gửi
  // mới nhất nếu có, else dữ liệu đã gửi gần nhất. Chỉ có giá trị khi kiện này đã có đóng góp trước
  // đó (committed hoặc nháp). Quy tắc đã chốt: các lần nhập tiếp theo của CÙNG 1 kiện được phép khác
  // Ca SX/Số chỉ thị/Ngày SX, nhưng BẮT BUỘC cùng Bọc/Pallet với lần nhập trước của chính kiện đó —
  // UI dùng 2 field này để pre-fill và cảnh báo khi người dùng chọn khác đi.
  existingKienBoc: string | null;
  existingKienPallet: string[] | null;
  // Thuộc tính đã ghi nhận của lô (từ lots hoặc nháp trước đó) — dùng để kiểm tra tính đồng nhất
  // Quy tắc: Trong cùng 1 lô, tất cả các kiện bắt buộc cùng Chủng loại, Loại bọc và Loại bành.
  existingLotCsr: string | null;
  existingLotBanh: number | null;
  existingLotBoc: string | null;
  // Ngăn KẾ HOẠCH của đúng kiện này (lot_prediction_lots.kien_X_ngan_id) — chỉ có khi lô có dự đoán.
  // UI chỉ cho "Đổi ngăn" khi kiện chưa có bành (thật lẫn nháp) và ngăn đang dùng chính là ngăn kế hoạch.
  predictionNganId?: string | null;
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
    pendingDraftBanh: 0,
    pendingDraftBy: [],
    existingKienBoc: null,
    existingKienPallet: null,
    existingLotCsr: null,
    existingLotBanh: null,
    existingLotBoc: null,
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

type PendingDraftAgg = {
  totalBanh: number;
  lastBoc: string | null;
  lastPallet: string[] | null;
  byNames: string[];
};

// Tổng hợp nháp CHƯA GỬI của đúng (ma_lo, kiện) — từ TẤT CẢ người dùng trong nhà máy, không chỉ
// người đang quét. Đây là phần lõi để "ca sau" biết chính xác "ca trước" đã giữ chỗ bao nhiêu bành
// dù chưa Gửi, tránh nhập vượt maxPerKien khi cộng cả phần đã gửi lẫn phần đang chờ gửi.
async function loadPendingDraftAggregateForKien(
  factoryId: string,
  maLo: string,
  kien: KienLetter,
): Promise<PendingDraftAgg> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("product_confirm_drafts")
    .select("so_banh, boc, pallet, created_by, created_at")
    .eq("factory_id", factoryId)
    .eq("ma_lo", maLo)
    .eq("kien", kien)
    .order("created_at", { ascending: true });
  const rows = data || [];
  const totalBanh = rows.reduce((sum, r) => sum + Number(r.so_banh || 0), 0);
  const last = rows.length > 0 ? rows[rows.length - 1] : null;
  const creatorIds = [...new Set(rows.map((r) => r.created_by).filter((v): v is string => !!v))];
  const nameMap = creatorIds.length > 0 ? await resolveProfileNames(creatorIds) : new Map<string, string>();
  return {
    totalBanh,
    lastBoc: last?.boc ?? null,
    lastPallet: last?.pallet ?? null,
    byNames: creatorIds.map((id) => nameMap.get(id) || "—"),
  };
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

  // Chỉ cần tra day_chuyen từ batch dự đoán khi lô thật CHƯA có (hoặc lô có nhưng thiếu
  // day_chuyen) — nếu lot.day_chuyen đã có sẵn, giá trị này sẽ không bao giờ được dùng tới
  // (xem "?? dayChuyenFromBatch" bên dưới), nên bỏ qua query để tiết kiệm 1 round-trip cho
  // trường hợp phổ biến nhất (kiện 2-4 của 1 lô đã có day_chuyen).
  let dayChuyenFromBatch: string | null = null;
  if (predicted?.origin_batch_id && (!lot || !lot.day_chuyen)) {
    const { data: batch } = await supabase
      .from("lot_prediction_batches")
      .select("day_chuyen")
      .eq("id", predicted.origin_batch_id)
      .maybeSingle();
    dayChuyenFromBatch = batch?.day_chuyen ?? null;
  }

  // Tra cứu xem lô này đã có kiện nào được ghi nhận trước đó hay chưa (kể cả trong nháp)
  // Quy tắc nghiệp vụ: tất cả các kiện của cùng 1 lô bắt buộc phải cùng Chủng loại, Bọc, Loại bành.
  let existingLotCsr: string | null = lot?.loai_csr ?? null;
  let existingLotBanh: number | null = lot?.loai_banh ? Number(lot.loai_banh) : null;
  let existingLotBoc: string | null = lot?.boc ?? null;

  if (!existingLotCsr || !existingLotBoc || !existingLotBanh) {
    const { data: siblingDraft } = await supabase
      .from("product_confirm_drafts")
      .select("loai_csr, loai_banh, boc")
      .eq("factory_id", factoryId)
      .eq("ma_lo", maLo)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (siblingDraft) {
      if (!existingLotCsr) existingLotCsr = siblingDraft.loai_csr;
      if (!existingLotBanh) existingLotBanh = Number(siblingDraft.loai_banh);
      if (!existingLotBoc) existingLotBoc = siblingDraft.boc;
    }
  }

  if (lot) {
    // nganIdForPartial không phụ thuộc lot_transactions — tính được ngay từ dữ liệu đã có, nên
    // có thể prefetch song song với truy vấn lot_transactions thay vì đợi tuần tự. Chỉ cần tra
    // thêm ngăn thứ 2 khi ngăn dự đoán khác ngăn hiện tại của lô (hiếm gặp).
    const nganIdForPartial = predictedNganId || lot.ngan_id || null;
    const needsSecondNganLookup = !!lot.ngan_id && !!nganIdForPartial && lot.ngan_id !== nganIdForPartial;

    const [{ data: txRows }, primaryNganInfo, secondaryNganInfo, pendingAgg] = await Promise.all([
      supabase
        .from("lot_transactions")
        .select("kien_a,kien_b,kien_c,kien_d,boc,pallet,created_at")
        .eq("lot_id", lot.id)
        .order("created_at", { ascending: true }),
      loadNganInfo(lot.ngan_id),
      needsSecondNganLookup ? loadNganInfo(nganIdForPartial) : Promise.resolve(null),
      // Nháp CHƯA GỬI của đúng kiện này, từ BẤT KỲ ai — để ca sau thấy đúng phần ca trước đã giữ
      // chỗ dù chưa Gửi (xem loadPendingDraftAggregateForKien).
      loadPendingDraftAggregateForKien(factoryId, maLo, kien),
    ]);
    const rows = (txRows || []) as Array<{
      kien_a: number; kien_b: number; kien_c: number; kien_d: number;
      boc: string | null; pallet: string[] | null; created_at: string | null;
    }>;
    const existingBanh = rows.reduce(
      (sum, row) => sum + Number((row as Record<string, unknown>)[`kien_${kienKey}`] || 0),
      0,
    );
    // Bọc/Pallet của lần nhập GẦN NHẤT của ĐÚNG kiện này (không phải toàn lô) — dùng để bắt buộc
    // các lần nhập sau của cùng kiện phải đồng nhất (xem ghi chú ở ConfirmKienLookup). Ưu tiên nháp
    // chưa gửi mới nhất (pendingAgg) nếu có — nó luôn mới hơn dữ liệu đã gửi vì workflow tuần tự
    // theo thời gian (không ai top-up một kiện đã gửi bằng cách quay lại quét cũ hơn).
    const kienField = `kien_${kienKey}` as "kien_a" | "kien_b" | "kien_c" | "kien_d";
    const lastKienTx = [...rows].reverse().find((row) => Number(row[kienField] || 0) > 0) || null;
    const committedKienBoc = lastKienTx?.boc ?? null;
    const committedKienPallet = lastKienTx?.pallet ?? null;
    const existingKienBoc = pendingAgg.lastBoc ?? committedKienBoc;
    const existingKienPallet = pendingAgg.lastPallet ?? committedKienPallet;

    const config = lot.loai_csr ? getLoaiBanhConfig(lot.loai_csr, Number(lot.loai_banh) || undefined) : null;
    const maxPerKien = config?.max_per_kien ?? 36;
    const totalClaimed = existingBanh + pendingAgg.totalBanh;

    if (existingBanh >= maxPerKien) {
      const { nganMa, nganTen } = primaryNganInfo;
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
        pendingDraftBanh: pendingAgg.totalBanh,
        pendingDraftBy: pendingAgg.byNames,
        existingKienBoc,
        existingKienPallet,
        existingLotCsr,
        existingLotBanh,
        existingLotBoc,
      };
    }

    // Kiện đã ĐỦ maxPerKien nếu tính cả nháp chưa gửi (nhưng chưa thật sự sản xuất) — khác "produced"
    // để không báo nhầm là đã sản xuất; chặn quét thêm cho tới khi nháp được gửi hoặc xóa.
    if (totalClaimed >= maxPerKien) {
      const { nganMa, nganTen } = secondaryNganInfo ?? primaryNganInfo;
      return {
        status: "drafted_full",
        maLo,
        kien,
        isNewLot: false,
        lotId: lot.id,
        loaiCsr: lot.loai_csr,
        loaiBanh: lot.loai_banh,
        dayChuyen: lot.day_chuyen ?? dayChuyenFromBatch,
        boc: existingKienBoc ?? lot.boc,
        tham: lot.tham,
        pallet: existingKienPallet ?? lot.pallet,
        chiThi: lot.chi_thi,
        ghiChu: lot.ghi_chu,
        nganId: nganIdForPartial,
        nganMa,
        nganTen,
        maxPerKien: config?.max_per_kien ?? null,
        kienWeightKg: config ? Math.round(config.max_per_kien * config.loai_banh * 100) / 100 : null,
        existingBanh,
        remainingBanh: 0,
        pendingDraftBanh: pendingAgg.totalBanh,
        pendingDraftBy: pendingAgg.byNames,
        existingKienBoc,
        existingKienPallet,
        existingLotCsr,
        existingLotBanh,
        existingLotBoc,
      };
    }

    // Lô đã tồn tại, kiện này chưa đủ dù đã tính cả nháp chưa gửi — ưu tiên ngăn theo dòng dự
    // đoán per-kiện, fallback về ngan_id chung của lô (đúng thứ tự ưu tiên đã chốt trong plan).
    const nganId = nganIdForPartial;
    const { nganMa, nganTen } = secondaryNganInfo ?? primaryNganInfo;
    const isPartialKien = totalClaimed > 0;
    return {
      status: isPartialKien ? "partial_kien" : "partial",
      maLo,
      kien,
      isNewLot: false,
      lotId: lot.id,
      loaiCsr: lot.loai_csr,
      loaiBanh: lot.loai_banh,
      dayChuyen: lot.day_chuyen ?? dayChuyenFromBatch,
      // Kiện đã có một phần hoặc lô đã có bọc chuẩn: ưu tiên existingLotBoc để toàn lô đồng nhất
      boc: existingLotBoc ?? (isPartialKien ? existingKienBoc ?? lot.boc : lot.boc),
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
      remainingBanh: maxPerKien - totalClaimed,
      pendingDraftBanh: pendingAgg.totalBanh,
      pendingDraftBy: pendingAgg.byNames,
      existingKienBoc,
      existingKienPallet,
      existingLotCsr,
      existingLotBanh,
      existingLotBoc,
      predictionNganId: predictedNganId,
    };
  }

  if (predicted) {
    const config = getLoaiBanhConfig(predicted.loai_csr, Number(predicted.loai_banh) || undefined);
    const [{ nganMa, nganTen }, chiThi, pendingAgg] = await Promise.all([
      loadNganInfo(predictedNganId),
      loadSuggestedChiThiForNewLot(factoryId),
      loadPendingDraftAggregateForKien(factoryId, maLo, kien),
    ]);
    const totalClaimed = pendingAgg.totalBanh; // lot chưa tồn tại nên existingBanh committed = 0

    if (totalClaimed >= config.max_per_kien) {
      return {
        status: "drafted_full",
        maLo,
        kien,
        isNewLot: true,
        lotId: null,
        loaiCsr: predicted.loai_csr,
        loaiBanh: predicted.loai_banh,
        dayChuyen: dayChuyenFromBatch,
        boc: existingLotBoc ?? pendingAgg.lastBoc ?? predicted.boc,
        tham: predicted.tham,
        pallet: pendingAgg.lastPallet,
        chiThi,
        ghiChu: null,
        nganId: predictedNganId,
        nganMa,
        nganTen,
        maxPerKien: config.max_per_kien,
        kienWeightKg: Math.round(config.max_per_kien * config.loai_banh * 100) / 100,
        existingBanh: 0,
        remainingBanh: 0,
        pendingDraftBanh: pendingAgg.totalBanh,
        pendingDraftBy: pendingAgg.byNames,
        existingKienBoc: pendingAgg.lastBoc,
        existingKienPallet: pendingAgg.lastPallet,
        existingLotCsr,
        existingLotBanh,
        existingLotBoc,
      };
    }

    return {
      // Nếu đã có nháp chưa gửi cho kiện này (dù lô thật chưa tồn tại), coi như "partial_kien" thay
      // vì "predicted" thuần túy — để bắt buộc đồng nhất Bọc/Pallet với nháp đó (mirror nhánh lot).
      status: totalClaimed > 0 ? "partial_kien" : "predicted",
      maLo,
      kien,
      isNewLot: true,
      lotId: null,
      loaiCsr: predicted.loai_csr,
      loaiBanh: predicted.loai_banh,
      dayChuyen: dayChuyenFromBatch,
      boc: existingLotBoc ?? pendingAgg.lastBoc ?? predicted.boc,
      tham: predicted.tham,
      pallet: pendingAgg.lastPallet,
      chiThi,
      ghiChu: null,
      nganId: predictedNganId,
      nganMa,
      nganTen,
      maxPerKien: config.max_per_kien,
      kienWeightKg: Math.round(config.max_per_kien * config.loai_banh * 100) / 100,
      existingBanh: 0,
      remainingBanh: config.max_per_kien - totalClaimed,
      pendingDraftBanh: pendingAgg.totalBanh,
      pendingDraftBy: pendingAgg.byNames,
      existingKienBoc: pendingAgg.lastBoc,
      existingKienPallet: pendingAgg.lastPallet,
      existingLotCsr,
      existingLotBanh,
      existingLotBoc,
      predictionNganId: predictedNganId,
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

// ─── Đổi ngăn nguồn của 1 kiện theo kế hoạch dự đoán (trước khi "Gửi tất cả") ───────────────
// Chỉ làm ở MÀN TRA CỨU NHÃN (/product-label, dòng "Xem chi tiết ngăn nguồn gốc") — trang đó công
// khai nên MỌI server action ở đây tự xác thực access token (assertProductAccess), không tin userId
// client gửi lên. Danh sách ngăn = ngăn ĐÃ CÓ LỊCH SỬ DỰ ĐOÁN, Chờ/Đang SX, cùng dây chuyền với lô
// (loadSwapCandidateNgans). Sức chứa tính như màn Dự đoán (thật + dự kiến + giữ chỗ) cộng thêm đúng
// 1 kiện đang đổi, trần 110% chặn cứng. Ngăn cũ tự được giải phóng vì kế hoạch của kiện chuyển hẳn
// sang ngăn mới (RPC swap_predicted_kien_ngan).

export type SwappableNganOption = {
  id: string;
  ma_ngan: string;
  ten_ngan: string;
  pctAfter: number;
  fits: boolean;
};

/** Lý do không cho đổi ngăn — client dịch theo mã, `reason` là câu tiếng Việt dự phòng. */
export type SwapBlockCode = "not_predicted" | "has_real_banh" | "has_draft" | "ngan_mismatch" | "not_found";

export type KienSwapContext =
  | {
      canSwap: true;
      maLo: string;
      kien: KienLetter;
      currentNganId: string;
      currentNganMa: string | null;
      options: SwappableNganOption[];
    }
  | { canSwap: false; code: SwapBlockCode; reason: string };

function dayChuyenFromLoaiNl(loaiNl: string | null | undefined): string {
  const s = (loaiNl || "").toLowerCase();
  return s.includes("nước") || s.includes("nuoc") ? "Mủ nước" : "Mủ tạp";
}

async function loadPredictionKienWeight(factoryId: string, maLo: string): Promise<number | null> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("lot_prediction_lots")
    .select("kien_weight_kg")
    .eq("factory_id", factoryId)
    .eq("ma_lo", maLo)
    .neq("trang_thai", "Hủy")
    .maybeSingle();
  return data ? Number(data.kien_weight_kg || 0) : null;
}

async function computeSwappableNgans(
  factoryId: string,
  maLo: string,
  currentNganId: string | null,
  dayChuyen: string | null,
): Promise<SwappableNganOption[]> {
  const kienWeight = await loadPredictionKienWeight(factoryId, maLo);
  if (!kienWeight) return [];
  const rows = await loadSwapCandidateNgans(factoryId);
  return rows
    .filter((r) => r.ngan.id !== currentNganId)
    .filter((r) => !dayChuyen || dayChuyenFromLoaiNl(r.ngan.loai_nl) === dayChuyen)
    .map((r) => {
      const tongKho = Number(r.ngan.tong_kho || 0);
      const pctAfter = tongKho > 0 ? ((r.usedKg + kienWeight) / tongKho) * 100 : 0;
      return {
        id: r.ngan.id,
        ma_ngan: r.ngan.ma_ngan,
        ten_ngan: r.ngan.ten_ngan,
        pctAfter: Math.round(pctAfter * 10) / 10,
        fits: r.availableKg - kienWeight >= -0.5,
      };
    })
    .sort((a, b) => Number(b.fits) - Number(a.fits));
}

// Điều kiện đổi ngăn — nguồn sự thật DUY NHẤT (client không tự quyết): kiện theo dự đoán, chưa có
// bành thật lẫn nháp của BẤT KỲ ai, và ngăn đang dùng chính là ngăn kế hoạch (1 kiện 1 ngăn).
function evaluateSwapEligibility(lookup: ConfirmKienLookup):
  | { ok: true; nganId: string }
  | { ok: false; code: SwapBlockCode; reason: string } {
  if (lookup.status === "not_found") {
    return { ok: false, code: "not_found", reason: "Không tìm thấy lô/kiện." };
  }
  if (lookup.existingBanh > 0 || lookup.status === "produced") {
    return {
      ok: false,
      code: "has_real_banh",
      reason: `Kiện ${lookup.kien} đã có ${lookup.existingBanh} bành ở ngăn hiện tại — một kiện không được lấy từ 2 ngăn.`,
    };
  }
  if (lookup.pendingDraftBanh > 0 || lookup.status === "drafted_full" || lookup.status === "partial_kien") {
    const by = lookup.pendingDraftBy.join(", ") || "—";
    return {
      ok: false,
      code: "has_draft",
      reason: `Kiện ${lookup.kien} đang có ${lookup.pendingDraftBanh} bành nháp chưa gửi (của ${by}) — gửi hoặc xóa nháp trước.`,
    };
  }
  if (!lookup.predictionNganId) {
    return { ok: false, code: "not_predicted", reason: "Kiện này không thuộc lô dự đoán nên không đổi ngăn được." };
  }
  if (!lookup.nganId || lookup.nganId !== lookup.predictionNganId) {
    return { ok: false, code: "ngan_mismatch", reason: "Ngăn hiện tại của kiện khác ngăn kế hoạch — không đổi ngăn được." };
  }
  return { ok: true, nganId: lookup.nganId };
}

export async function loadKienSwapContext(
  accessToken: string | null,
  factoryId: string,
  maLoRaw: string,
  kien: KienLetter,
): Promise<KienSwapContext> {
  await assertProductAccess(accessToken, factoryId, PRODUCT_SWAP_NGAN_PERMISSIONS, "đổi ngăn nguồn");
  const maLo = maLoRaw.trim();
  const lookup = await resolveKienForConfirm(factoryId, maLo, kien);
  const eligible = evaluateSwapEligibility(lookup);
  if (!eligible.ok) return { canSwap: false, code: eligible.code, reason: eligible.reason };
  const options = await computeSwappableNgans(factoryId, maLo, eligible.nganId, lookup.dayChuyen);
  return {
    canSwap: true,
    maLo,
    kien,
    currentNganId: eligible.nganId,
    currentNganMa: lookup.nganMa,
    options,
  };
}

type SwapResult =
  | { success: true; nganMa: string | null; nganTen: string | null }
  | { success: false; error: string };

// Nội bộ (không export → không phải server action). Gọi từ swapKienNgan (đã xác thực) và từ
// updateDraftKien khi sửa nháp đổi sang ngăn khác.
async function swapKienNganInternal(input: {
  factoryId: string;
  maLo: string;
  kien: KienLetter;
  oldNganId: string;
  newNganId: string;
  dayChuyen: string | null;
  userId: string | null;
  draftId?: string | null;
}): Promise<SwapResult> {
  try {
    if (!input.factoryId || !input.maLo || !input.newNganId) {
      return { success: false, error: "Thiếu thông tin đổi ngăn." };
    }
    // Kiểm sức chứa lại ở server ngay trước khi ghi (danh sách phía client có thể đã cũ).
    const options = await computeSwappableNgans(input.factoryId, input.maLo.trim(), input.oldNganId, input.dayChuyen);
    const target = options.find((o) => o.id === input.newNganId);
    if (!target) {
      return {
        success: false,
        error: "Ngăn này không nằm trong danh sách ngăn được đổi (chưa từng có dự đoán, khác dây chuyền, hết nguyên liệu hoặc không ở trạng thái Chờ/Đang sản xuất).",
      };
    }
    if (!target.fits) {
      return { success: false, error: `Ngăn ${target.ma_ngan} sẽ vượt 110% (${target.pctAfter}%) nếu nhận thêm kiện này.` };
    }
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.rpc("swap_predicted_kien_ngan", {
      p_factory_id: input.factoryId,
      p_ma_lo: input.maLo.trim(),
      p_kien: input.kien,
      p_old_ngan_id: input.oldNganId,
      p_new_ngan_id: input.newNganId,
      p_actor_id: input.userId,
      p_draft_id: input.draftId ?? null,
    });
    if (error) return { success: false, error: error.message };
    return { success: true, nganMa: target.ma_ngan, nganTen: target.ten_ngan };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Lỗi không xác định khi đổi ngăn." };
  }
}

export async function swapKienNgan(input: {
  accessToken: string | null;
  factoryId: string;
  maLo: string;
  kien: KienLetter;
  newNganId: string;
}): Promise<SwapResult> {
  let userId: string;
  try {
    userId = await assertProductAccess(input.accessToken, input.factoryId, PRODUCT_SWAP_NGAN_PERMISSIONS, "đổi ngăn nguồn");
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Không có quyền đổi ngăn." };
  }
  // Ngăn cũ + dây chuyền tính lại ở server — không tin giá trị client gửi.
  const lookup = await resolveKienForConfirm(input.factoryId, input.maLo.trim(), input.kien);
  const eligible = evaluateSwapEligibility(lookup);
  if (!eligible.ok) return { success: false, error: eligible.reason };
  return swapKienNganInternal({
    factoryId: input.factoryId,
    maLo: input.maLo,
    kien: input.kien,
    oldNganId: eligible.nganId,
    newNganId: input.newNganId,
    dayChuyen: lookup.dayChuyen,
    userId,
  });
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

    // 3 truy vấn ĐỌC đầu tiên không phụ thuộc lẫn nhau (existingLot chỉ cần maLo; ngan và
    // existingRealKg chỉ cần input.nganId) — chạy song song thay vì tuần tự để giảm round-trip.
    // Bước GHI (transaction) vẫn phải đợi validate xong mới chạy, giữ đúng thứ tự đọc-trước-ghi.
    const [{ data: existingLot }, { data: ngan, error: nganError }, existingRealKg] = await Promise.all([
      supabase.from("lots").select("id").eq("factory_id", input.factoryId).eq("ma_lo", maLo).maybeSingle(),
      supabase.from("ngans").select("tong_kho").eq("id", input.nganId).eq("factory_id", input.factoryId).maybeSingle(),
      getExistingRealKg(input.factoryId, input.nganId),
    ]);

    if (nganError || !ngan) {
      return { success: false, error: "Không tìm thấy ngăn nguồn được chọn." };
    }

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

    // Lookup "có dòng dự đoán khớp mã lô này không" chỉ cần maLo+factoryId, không phụ thuộc kết
    // quả ghi transaction — chạy song song với saveLotTransaction() thay vì đợi nó xong rồi mới
    // tra (markLotPredictionRealized ở dưới mới thực sự cần lotId từ saveResult).
    const [saveResult, { data: predictionRow }] = await Promise.all([
      saveLotTransaction({
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
        // Hàm này không còn call site (thay bằng Lưu tạm + Gửi tất cả) và không có token người
        // gọi — saveLotTransaction sẽ từ chối. Giữ chữ ký để không phá build.
        accessToken: null,
      }),
      supabase.from("lot_prediction_lots").select("id").eq("factory_id", input.factoryId).eq("ma_lo", maLo).maybeSingle(),
    ]);

    if (!saveResult.success) {
      return { success: false, error: saveResult.error };
    }

    const lotId = saveResult.lotId as string;

    // Chuyển dự kiến -> thật nếu có dòng dự đoán khớp mã lô này (idempotent, an toàn gọi lại
    // cho các kiện sau của cùng lô).
    if (predictionRow) {
      await markLotPredictionRealized(input.factoryId, maLo, lotId);
    }

    // created_at của giao dịch vừa lưu đã có sẵn trong saveResult.transaction (select() của
    // saveLotTransaction đã bổ sung cột này) — không cần query lại riêng chỉ để lấy giá trị này.
    const createdAt = (saveResult.transaction as Record<string, unknown> | undefined)?.created_at as
      | string
      | null
      | undefined ?? null;

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

// Ca sản xuất được gán sẵn cho user hiện tại theo bảng phân công trực ca cố định (mục 5/6, xem
// production_shift_assignments) — dùng để tự gợi ý đúng "Ca sản xuất" khi mở form quét QR thay
// vì luôn mặc định "A". Trả về null khi chưa được gán/không active — page.tsx tự fallback sang
// Ca đã dùng gần nhất trên chính thiết bị (localStorage), rồi cuối cùng mới về "A".
//
// Dùng .limit(1) thay .maybeSingle() — kể cả trước khi cho phép nhiều người/ca (migration
// 20260721), 1 user vẫn có thể được gán cho NHIỀU ca khác nhau cùng lúc (không có ràng buộc nào
// chặn 1 assigned_user_id xuất hiện ở cả 3 dòng A/B/C), nên .maybeSingle() vốn đã không an toàn
// nếu gặp đúng trường hợp đó. Chỉ cần 1 gợi ý mặc định, lấy dòng cũ nhất cho ổn định.
export async function loadUserShiftAssignment(factoryId: string, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("production_shift_assignments")
    .select("ca")
    .eq("factory_id", factoryId)
    .eq("assigned_user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1);
  return data?.[0]?.ca ?? null;
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
  lots: ShiftTxLotInfo | ShiftTxLotInfo[];
};

// boc/pallet/chi_thi CỦA LÔ (lot-level, snapshot mới nhất suy bởi sync_lot_master_snapshot) — dùng
// làm fallback khi CHÍNH giao dịch (lot_transactions.boc/pallet/chi_thi) là null, trường hợp luôn
// đúng với các dòng nhập tay qua product/page.tsx (không bao giờ gửi 3 cột này ở cấp giao dịch,
// xem product/actions.ts). Thiếu fallback này khiến "Lịch sử ca" và "Phiếu báo thành phẩm" hiện
// trống Bọc/Pallet/Số chỉ thị cho MỌI lô có ít nhất 1 giao dịch nhập tay (bug đã xác nhận qua dữ
// liệu thật 2026-07-16 — lots.boc/chi_thi không hề rỗng, chỉ lot_transactions.boc/chi_thi rỗng).
type ShiftTxLotInfo = {
  ma_lo: string;
  loai_csr: string;
  loai_banh: number;
  trang_thai: string;
  day_chuyen: string | null;
  boc: string | null;
  pallet: string[] | null;
  chi_thi: string | null;
};

// Toàn bộ giao dịch của MỘT ngày sản xuất + ca — KHÔNG lọc theo người nhập, vì 1 ca có thể có
// nhiều người trực khác nhau nối tiếp nhau (đã chốt với người dùng). Dùng cho:
// - Hub "Lịch sử ca" (kèm xóa dòng)
// - Xem/tạo lại phiếu cũ theo ngày+ca bất kỳ (qua loadShiftHistory)
async function loadShiftTransactions(factoryId: string, ngaySx: string, ca: string): Promise<ShiftTxRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("lot_transactions")
    .select(
      "id,lot_id,ca,ngay_nhap,kien_a,kien_b,kien_c,kien_d,so_banh,so_kg,boc,pallet,chi_thi,ngan_id,created_at,created_by,lots!inner(ma_lo,loai_csr,loai_banh,trang_thai,day_chuyen,boc,pallet,chi_thi,factory_id)",
    )
    .eq("lots.factory_id", factoryId)
    .eq("ngay_nhap", ngaySx)
    .eq("ca", ca)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as unknown as ShiftTxRow[];
}

// Toàn bộ giao dịch của MỘT ngày sản xuất, KHÔNG lọc theo ca — 1 ngày có thể có 2 ca (Ca A buổi
// sáng, Ca B buổi chiều chạy xuyên đêm) và phiếu báo thành phẩm phải gộp cả 2 vào cùng 1 phiếu,
// mỗi ca 1 bảng chi tiết riêng + 1 bảng "Tổng hợp" chung cho cả ngày (đã chốt với người dùng).
async function loadDayTransactions(factoryId: string, ngaySx: string): Promise<ShiftTxRow[]> {
  const supabase = getSupabaseAdmin();
  // Phân trang: PostgREST cắt âm thầm ở 1000 dòng (rule 04-code-patterns). Thêm order theo id để
  // các trang không chồng/lọt dòng khi nhiều giao dịch cùng created_at.
  try {
    const rows = await fetchAllPaginated((from, to) =>
      supabase
        .from("lot_transactions")
        .select(
          "id,lot_id,ca,ngay_nhap,kien_a,kien_b,kien_c,kien_d,so_banh,so_kg,boc,pallet,chi_thi,ngan_id,created_at,created_by,lots!inner(ma_lo,loai_csr,loai_banh,trang_thai,day_chuyen,boc,pallet,chi_thi,factory_id)",
        )
        .eq("lots.factory_id", factoryId)
        .eq("ngay_nhap", ngaySx)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    );
    return rows as unknown as ShiftTxRow[];
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : (err as { message?: string })?.message || String(err));
  }
}

export type LotCompletenessWarning = { maLo: string; missingKien: KienLetter[] };

// Quét tất cả lô CÓ GIAO DỊCH trong 1 ngày sản xuất (mọi ca) để tìm lô nào vẫn "Dở dang" với
// kiện chưa đủ — dùng cho cảnh báo lúc "Kết thúc ca" (mục 3). Không chặn cứng, chỉ để UI hiện
// danh sách và yêu cầu xác nhận rõ ràng trước khi tiếp tục xuất phiếu. Dùng `lots.kien_a-d` (đã
// đồng bộ sẵn) thay vì tự SUM transactions — chỉ cần 1 query bổ sung cho danh sách lot_id.
// `pendingByMaLo`: map ma_lo -> các kiện đang nằm trong nháp CHƯA gửi của lô đó (từ mọi người
// dùng) — cộng thêm vào phần "đã có" khi xét 1 lô có còn thiếu kiện hay không. Optional, mặc
// định rỗng giữ nguyên hành vi cũ (chỉ xét dữ liệu đã gửi thật trong `lots`).
export async function checkIncompleteLotsForDay(
  factoryId: string,
  ngaySx: string,
  pendingByMaLo: Record<string, KienLetter[]> = {},
): Promise<LotCompletenessWarning[]> {
  const dayRows = await loadDayTransactions(factoryId, ngaySx);
  const lotIds = [...new Set(dayRows.map((r) => r.lot_id))];
  if (lotIds.length === 0) return [];

  const supabase = getSupabaseAdmin();
  const { data: lots } = await supabase
    .from("lots")
    .select("id, ma_lo, loai_csr, loai_banh, trang_thai, kien_a, kien_b, kien_c, kien_d")
    .in("id", lotIds);

  const warnings: LotCompletenessWarning[] = [];
  for (const lot of lots || []) {
    if (normalizeLotStatus(lot.trang_thai) !== "Dở dang") continue;
    const config = getLoaiBanhConfig(lot.loai_csr, Number(lot.loai_banh) || undefined);
    const totals: Record<KienLetter, number> = {
      A: Number(lot.kien_a || 0),
      B: Number(lot.kien_b || 0),
      C: Number(lot.kien_c || 0),
      D: Number(lot.kien_d || 0),
    };
    const pendingKien = pendingByMaLo[lot.ma_lo] || [];
    const missingKien = (Object.keys(totals) as KienLetter[]).filter(
      (k) => totals[k] < config.max_per_kien && !pendingKien.includes(k),
    );
    if (missingKien.length > 0) warnings.push({ maLo: lot.ma_lo, missingKien });
  }
  return warnings.sort((a, b) => a.maLo.localeCompare(b.maLo));
}

export type OtherIncompleteLotKien = { kien: KienLetter; missingBanh: number };
export type OtherIncompleteLot = { maLo: string; missing: OtherIncompleteLotKien[] };

// Cảnh báo (KHÔNG chặn) các lô KHÁC cùng loai_csr đang "Dở dang" — bất kể đã làm ngày nào (dù
// cùng ngày hay khác ngày với lô đang quét). Tính cả bành đang nằm trong nháp CHƯA gửi của BẤT
// KỲ ai khi xác định kiện nào còn thiếu, để không báo sai "còn thiếu" nếu thực ra đã có người Lưu
// tạm (chỉ chưa Gửi). Gọi song song với resolveKienForConfirm mỗi lần quét 1 kiện, hiển thị như
// banner nhắc nhở — không chặn thao tác của kiện đang quét.
//
// Fix 2026-07-16: đã bỏ filter phụ theo `day_chuyen` (trước đây `if (dayChuyen) query =
// query.eq("day_chuyen", dayChuyen)`) — đây là nguyên nhân khiến banner hiện KHÔNG NHẤT QUÁN giữa
// các lần quét cùng 1 lô (report thật: quét kiện A không thấy cảnh báo 1 lô dở dang cùng loại,
// quét kiện B của CÙNG lô đó lại thấy). `loai_csr` (CSR10/20 = Mủ tạp, CSRL/3L/CV50/CV60 = Mủ
// nước) đã tự nhiên phân tách 2 dây chuyền, filter `day_chuyen` chỉ thêm rủi ro loại nhầm 1 lô có
// `day_chuyen` không khớp/rỗng do dữ liệu cũ — bỏ hẳn để kết quả xác định (deterministic).
export async function checkOtherIncompleteLotsForCategory(
  factoryId: string,
  loaiCsr: string,
  excludeMaLo: string,
): Promise<OtherIncompleteLot[]> {
  if (!factoryId || !loaiCsr) return [];
  const supabase = getSupabaseAdmin();
  const { data: lots } = await supabase
    .from("lots")
    .select("ma_lo, loai_csr, loai_banh, trang_thai, kien_a, kien_b, kien_c, kien_d")
    .eq("factory_id", factoryId)
    .eq("loai_csr", loaiCsr)
    .neq("ma_lo", excludeMaLo)
    .in("trang_thai", ["Dở dang", "Do dang"]);
  const rows = lots || [];
  if (rows.length === 0) return [];

  const maLoList = rows.map((r) => r.ma_lo);
  const { data: draftRows } = await supabase
    .from("product_confirm_drafts")
    .select("ma_lo, kien, so_banh")
    .eq("factory_id", factoryId)
    .in("ma_lo", maLoList);
  const pendingByKey = new Map<string, number>();
  for (const d of draftRows || []) {
    const key = `${d.ma_lo}::${d.kien}`;
    pendingByKey.set(key, (pendingByKey.get(key) || 0) + Number(d.so_banh || 0));
  }

  const result: OtherIncompleteLot[] = [];
  for (const lot of rows) {
    const config = getLoaiBanhConfig(lot.loai_csr, Number(lot.loai_banh) || undefined);
    const committed: Record<KienLetter, number> = {
      A: Number(lot.kien_a || 0),
      B: Number(lot.kien_b || 0),
      C: Number(lot.kien_c || 0),
      D: Number(lot.kien_d || 0),
    };
    const missing: OtherIncompleteLotKien[] = [];
    for (const k of KIEN_ORDER) {
      const pending = pendingByKey.get(`${lot.ma_lo}::${k}`) || 0;
      const missingBanh = config.max_per_kien - (committed[k] + pending);
      if (missingBanh > 0) missing.push({ kien: k, missingBanh });
    }
    if (missing.length > 0) result.push({ maLo: lot.ma_lo, missing });
  }
  return result.sort((a, b) => a.maLo.localeCompare(b.maLo));
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
  num: number;
  kienLetters: string;
  soBanh: number;
  soKg: number;
  nguoiNhap: string;
  createdAt: string | null;
  canDelete: boolean;
  // Sửa dữ liệu quét sai — mirror canDelete cho user thường (chỉ "Dở dang"); admin được sửa ở
  // MỌI trạng thái TRỪ KHI lô đồng thời đã "Xuất hàng" VÀ đã có qc_results gắn vào (cả 2 điều
  // kiện phải CÙNG đúng mới chặn admin). Xem editShiftHistoryEntry() — server luôn re-check lại,
  // giá trị này chỉ để quyết định hiện/ẩn nút Sửa trên UI.
  canEdit: boolean;
  // Snapshot đầy đủ của giao dịch — dùng để pre-fill modal Sửa mà không phải load lại riêng.
  nganId: string | null;
  nganMa: string | null;
  nganTen: string | null;
  ca: string;
  ngaySx: string;
  boc: string | null;
  pallet: string[] | null;
  chiThi: string | null;
  loaiCsr: string;
  loaiBanh: number;
  dayChuyen: string | null;
};

// Batch check "lô nào trong danh sách đã có qc_results" — chỉ dùng cho canEdit của admin ở các
// lô "Xuất hàng" (mục 2, quy tắc chặn admin sửa lô đã xuất hàng VÀ đã kiểm nghiệm).
async function getLotIdsWithQcResults(lotIds: string[]): Promise<Set<string>> {
  if (lotIds.length === 0) return new Set();
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from("qc_results").select("lot_id").in("lot_id", lotIds);
  return new Set((data || []).map((r) => r.lot_id).filter((v): v is string => !!v));
}

// Danh sách giao dịch (từng lần quét 1 kiện) của 1 ngày SX + ca — dùng cho khối "Lịch sử ca"
// trong Hub, kèm quyền xóa/sửa từng dòng. Sắp xếp theo SỐ LÔ tăng dần rồi theo kiện A→D (không
// còn theo thời gian quét — nếu quét kiện D trước A/B/C, D không còn bị đẩy xuống cuối danh sách,
// dễ theo dõi tiến độ theo lô hơn — mục 4). `isAdmin` cần truyền vào để tính đúng canEdit.
export async function loadShiftHistory(
  factoryId: string,
  ngaySx: string,
  ca: string,
  isAdmin: boolean,
): Promise<ShiftHistoryEntry[]> {
  const rows = await loadShiftTransactions(factoryId, ngaySx, ca);
  const nameMap = await resolveProfileNames(rows.map((r) => r.created_by || ""));

  // "Khóa ca sản xuất" — scope của hàm này luôn đúng 1 (ngaySx, ca), chỉ cần 1 query duy nhất
  // (không cần Set/Map theo dòng). Admin bypass, giữ đúng nguyên tắc bypass khóa toàn hệ thống.
  const supabaseLock = getSupabaseAdmin();
  const { data: lockRow } = await supabaseLock
    .from("product_shift_locks")
    .select("id")
    .eq("factory_id", factoryId)
    .eq("ngay_sx", ngaySx)
    .eq("ca", ca)
    .eq("is_active", true)
    .maybeSingle();
  const isShiftLocked = !!lockRow && !isAdmin;

  const xuatHangLotIds = isAdmin
    ? [...new Set(
        rows
          .map((r) => {
            const info = Array.isArray(r.lots) ? r.lots[0] : r.lots;
            return normalizeLotStatus(info?.trang_thai) === "Xuất hàng" ? r.lot_id : null;
          })
          .filter((v): v is string => !!v),
      )]
    : [];
  const lotIdsWithQc = await getLotIdsWithQcResults(xuatHangLotIds);

  // Batch tra tên ngăn cho toàn bộ dòng — dùng để hiển thị/pre-fill dropdown ngăn trong modal
  // Sửa (mục 2) mà không cần query riêng cho từng dòng khi mở modal.
  const nganIds = [...new Set(rows.map((r) => r.ngan_id).filter((v): v is string => !!v))];
  let nganInfoById = new Map<string, { ma_ngan: string; ten_ngan: string }>();
  if (nganIds.length > 0) {
    const supabase = getSupabaseAdmin();
    const { data: nganRows } = await supabase.from("ngans").select("id, ma_ngan, ten_ngan").in("id", nganIds);
    nganInfoById = new Map((nganRows || []).map((n) => [n.id, { ma_ngan: n.ma_ngan, ten_ngan: n.ten_ngan }]));
  }

  return rows
    .map((row) => {
      const lotInfo = Array.isArray(row.lots) ? row.lots[0] : row.lots;
      const letters = KIEN_ORDER.filter((k) => {
        const key = `kien_${KIEN_LOWER[k]}` as "kien_a" | "kien_b" | "kien_c" | "kien_d";
        return Number(row[key] || 0) > 0;
      }).join("");
      const lotStatus = normalizeLotStatus(lotInfo?.trang_thai);
      // GĐ4: giao dịch ĐÃ GỬI chỉ admin sửa/xóa (người quét chỉ tự sửa nháp trước "Gửi tất cả").
      // Cờ này chỉ để hiện nút — server (editShiftHistoryEntry/deleteShiftHistoryEntry) tự xác
      // thực token và kiểm lại.
      const canDelete = isAdmin && !isShiftLocked && lotStatus === "Dở dang";
      const canEdit =
        isAdmin && !isShiftLocked && !(lotStatus === "Xuất hàng" && lotIdsWithQc.has(row.lot_id));
      const maLo = lotInfo?.ma_lo || "";
      const num = Number(maLo.match(/^(\d+)/)?.[1] || 0);
      return {
        transactionId: row.id,
        lotId: row.lot_id,
        maLo,
        num,
        kienLetters: letters,
        soBanh: Number(row.so_banh || 0),
        soKg: Number(row.so_kg || 0),
        nguoiNhap: row.created_by ? nameMap.get(row.created_by) || "—" : "—",
        createdAt: row.created_at,
        canDelete,
        canEdit,
        nganId: row.ngan_id,
        nganMa: row.ngan_id ? nganInfoById.get(row.ngan_id)?.ma_ngan ?? null : null,
        nganTen: row.ngan_id ? nganInfoById.get(row.ngan_id)?.ten_ngan ?? null : null,
        ca: row.ca,
        ngaySx: row.ngay_nhap,
        // Fallback lot-level khi giao dịch không tự mang boc/pallet/chi_thi riêng — luôn đúng với
        // dòng nhập tay qua product/page.tsx (xem ghi chú ở ShiftTxLotInfo).
        boc: row.boc ?? lotInfo?.boc ?? null,
        pallet: row.pallet ?? lotInfo?.pallet ?? null,
        chiThi: row.chi_thi ?? lotInfo?.chi_thi ?? null,
        loaiCsr: lotInfo?.loai_csr || "",
        loaiBanh: Number(lotInfo?.loai_banh) || 35,
        dayChuyen: lotInfo?.day_chuyen ?? null,
      };
    })
    .sort((a, b) => {
      if (a.num !== b.num) return a.num - b.num;
      if (a.maLo !== b.maLo) return a.maLo.localeCompare(b.maLo);
      const ia = KIEN_ORDER.indexOf((a.kienLetters[0] as KienLetter) || "A");
      const ib = KIEN_ORDER.indexOf((b.kienLetters[0] as KienLetter) || "A");
      return ia - ib;
    });
}

export type ShiftLockStatus = {
  isActive: boolean;
  lockedByName: string;
  lockedAt: string;
};

// Trạng thái khóa (chỉ đọc) của đúng (ngaySx, ca) — dùng cho badge thông tin ở Hub quét QR (Hub
// không có nút hành động khóa/mở khóa, chỉ hiển thị để người dùng hiểu vì sao Sửa/Xóa bị ẩn; xem
// .claude/rules/06-module-production.md mục "Khóa ca sản xuất").
export async function loadShiftLockStatus(
  factoryId: string,
  ngaySx: string,
  ca: string,
): Promise<ShiftLockStatus | null> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("product_shift_locks")
    .select("locked_by, locked_at")
    .eq("factory_id", factoryId)
    .eq("ngay_sx", ngaySx)
    .eq("ca", ca)
    .eq("is_active", true)
    .maybeSingle();
  if (!data) return null;
  const nameMap = await resolveProfileNames([data.locked_by]);
  return {
    isActive: true,
    lockedByName: nameMap.get(data.locked_by) || "—",
    lockedAt: data.locked_at,
  };
}

export type DeleteShiftHistoryResult = { success: true } | { success: false; error: string };

// Xóa 1 giao dịch đã gửi trong Hub — GĐ4: chỉ admin (xác thực token ở server, không tin cờ
// client), và lô vẫn phải "Dở dang". Dùng lại deleteLotTransaction() (product/actions.ts) — đã tự
// đồng bộ lots + trạng thái ngăn.
export async function deleteShiftHistoryEntry(
  transactionId: string,
  factoryId: string,
  accessToken: string | null,
): Promise<DeleteShiftHistoryResult> {
  try {
    const supabase = getSupabaseAdmin();
    const { data: tx, error: txError } = await supabase
      .from("lot_transactions")
      .select("lot_id, ngan_id, lots!inner(trang_thai)")
      .eq("id", transactionId)
      .maybeSingle();
    if (txError || !tx) return { success: false, error: "Không tìm thấy giao dịch cần xóa." };

    const lotInfo = Array.isArray(tx.lots) ? tx.lots[0] : tx.lots;
    if (normalizeLotStatus(lotInfo?.trang_thai) !== "Dở dang") {
      return { success: false, error: "Lô đã qua bước tiếp theo (Hoàn thành/Xuất hàng...), không thể xóa từ đây." };
    }

    const result = await deleteLotTransaction({ transactionId, factoryId, accessToken });
    if (!result.success) return { success: false, error: result.error };
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Lỗi không xác định khi xóa giao dịch.",
    };
  }
}

export type EditShiftHistoryInput = {
  transactionId: string;
  factoryId: string;
  accessToken: string | null;
  nganId: string;
  ca: string;
  ngaySx: string;
  soBanh: number;
  boc: string | null;
  pallet: string[] | null;
  chiThi: string | null;
  lyDo: string;
};

export type EditShiftHistoryResult = { success: true } | { success: false; error: string };

// Sửa 1 dòng giao dịch đã gửi trong Hub (đổi bọc/pallet/số bành/ngăn/ca/ngày/số chỉ thị).
// GĐ4: chỉ admin; dùng CHUNG adminUpdateLotTransaction với trang Thành phẩm để 2 đường sửa không
// lệch nhau (RPC atomic: kiểm khóa ca nguồn+đích, đồng bộ dự đoán/nháp/ngăn, ghi lot_admin_edits).
export async function editShiftHistoryEntry(input: EditShiftHistoryInput): Promise<EditShiftHistoryResult> {
  try {
    const supabase = getSupabaseAdmin();
    const { data: tx, error: txError } = await supabase
      .from("lot_transactions")
      .select("id, kien_a, kien_b, kien_c, kien_d")
      .eq("id", input.transactionId)
      .maybeSingle();
    if (txError || !tx) return { success: false, error: "Không tìm thấy giao dịch cần sửa." };

    // Dòng quét QR thuộc đúng 1 kiện — số bành mới đặt vào đúng kiện đó. Nhưng dòng nhập tay có thể
    // chứa nhiều kiện (vd A+B): KHÔNG được xoá các kiện còn lại về 0. Màn này chỉ có 1 ô số bành nên
    // với dòng nhiều kiện chỉ cho sửa các trường khác (giữ nguyên số bành từng kiện).
    const cur = {
      a: Number(tx.kien_a) || 0,
      b: Number(tx.kien_b) || 0,
      c: Number(tx.kien_c) || 0,
      d: Number(tx.kien_d) || 0,
    };
    const withBales = (["a", "b", "c", "d"] as const).filter((k) => cur[k] > 0);
    if (withBales.length === 0) return { success: false, error: "Không xác định được kiện của giao dịch này." };
    let kien = { ...cur };
    if (withBales.length === 1) {
      kien = { ...cur, [withBales[0]]: input.soBanh };
    } else if (input.soBanh !== cur.a + cur.b + cur.c + cur.d) {
      return {
        success: false,
        error: `Giao dịch này gồm nhiều kiện (${withBales.map((k) => k.toUpperCase()).join(", ")}) — hãy sửa số bành từng kiện ở trang Thành phẩm.`,
      };
    }

    const result = await adminUpdateLotTransaction({
      accessToken: input.accessToken,
      factoryId: input.factoryId,
      transactionId: input.transactionId,
      kien,
      nganId: input.nganId,
      ca: input.ca,
      ngayNhap: input.ngaySx,
      boc: input.boc,
      pallet: input.pallet,
      chiThi: input.chiThi,
      lyDo: input.lyDo,
    });
    if (!result.success) return { success: false, error: result.error };
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Lỗi không xác định khi sửa giao dịch.",
    };
  }
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
  // Mã ngăn nguồn của các giao dịch gộp vào dòng này — bình thường 1 giá trị, nhưng 1 kiện có thể
  // được nhập nhiều lần từ 2 ngăn khác nhau (không có ràng buộc cứng nào chặn việc này, xem mục
  // 4.6 rule 06-module-production.md) nên phải gộp đủ, cách nhau ", " khi có nhiều hơn 1 ngăn.
  nganMa: string;
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

// 1 section = 1 ca sản xuất trong ngày (chỉ những ca thực sự có giao dịch trong ngày mới có
// section riêng). caLabel là số thứ tự hiển thị ("Ca 1", "Ca 2"...) suy ra từ giao dịch (created_at)
// SỚM NHẤT của mỗi ca trong đúng ngày đó — ca nào có giao dịch đầu tiên sớm hơn thì là "Ca 1", bất
// kể mã ca (A/B/C) là gì. Không hard-code A luôn là "Ca 1": nếu lịch đảo (Ca B làm ca ngày, Ca A
// làm ca đêm) thì Ca B sẽ tự thành "Ca 1" đúng thực tế hôm đó. caName là tên ca do nhà máy tự đặt
// (Cài đặt → Danh mục → Thông tin công ty → "Tên ca sản xuất"), rỗng nếu chưa cấu hình.
export type ShiftReportCaSection = {
  ca: string;
  caLabel: string;
  caName: string;
  rows: ShiftReportLotRow[];
  tongBanh: number;
  tongKg: number;
};

// 1 lô HOÀN THÀNH trong ngày báo cáo (lots.ngay_ht = ngày) — nguồn của mục 1 "Tên lô sản xuất"
// trong Báo cáo lô sản xuất (F11). Khác `sections` (giao dịch phát sinh trong ngày): lô bắt đầu
// từ hôm trước nhưng tròn lô hôm nay VẪN có mặt; lô mới mở hôm nay còn dở dang thì KHÔNG.
export type CompletedLotRow = {
  maLo: string;
  num: number;
  loaiCsr: string;
  loaiBanh: number;
  boc: string;
  // Tập pallet khác nhau của các kiện (gom từ lot_transactions của lô, mọi ngày) — nối "/".
  pallet: string;
  ghiChu: string;
};

export type ShiftReportData = {
  ngay: string;
  soChiThi: string;
  sections: ShiftReportCaSection[];
  tongBanh: number;
  tongKg: number;
  byGroup: ShiftReportGroupRow[];
  completedLots: CompletedLotRow[];
};

function joinUniqueSlash(values: (string | null | undefined)[]): string {
  const out: string[] = [];
  for (const v of values) {
    const t = (v || "").trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out.join("/");
}

// Pallet theo kiện cho F11: "Sắt mỏng A, C / Sắt đế gỗ B, D". Chỉ 1 loại pallet cho cả lô → in
// đúng tên pallet như cũ (không kèm kiện). Giao dịch không mang pallet → dùng pallet của lô.
// Chỉ ghi nhận kiện có số bành > 0 (giao dịch âm/0 không làm kiện "thuộc" pallet đó).
const KIEN_KEYS = ["a", "b", "c", "d"] as const;
function formatPalletByKien(
  txs: { pallet: string[] | null; kien_a: number | null; kien_b: number | null; kien_c: number | null; kien_d: number | null }[],
  lotPallet: string[],
): string {
  const kienByPallet = new Map<string, Set<string>>();
  for (const t of txs) {
    const pallets = (t.pallet && t.pallet.length > 0 ? t.pallet : lotPallet)
      .map((p) => (p || "").trim())
      .filter(Boolean);
    for (const k of KIEN_KEYS) {
      if ((Number(t[`kien_${k}`]) || 0) <= 0) continue;
      for (const p of pallets) {
        const set = kienByPallet.get(p) || new Set<string>();
        set.add(k.toUpperCase());
        kienByPallet.set(p, set);
      }
    }
  }
  if (kienByPallet.size === 0) return joinUniqueSlash(lotPallet);
  if (kienByPallet.size === 1) return [...kienByPallet.keys()][0];
  return [...kienByPallet.entries()]
    .sort((a, b) => Math.min(...[...a[1]].map((x) => x.charCodeAt(0))) - Math.min(...[...b[1]].map((x) => x.charCodeAt(0))))
    .map(([p, set]) => `${p} ${[...set].sort().join(", ")}`)
    .join(" / ");
}

// Lô hoàn thành (tròn lô) đúng ngày `ngaySx` — dựa trên lots.ngay_ht (do sync_lot_master_snapshot
// ghi khi lô đủ kiện). Pallet/bọc gom từ giao dịch thật của lô để thấy đúng lô có kiện dùng pallet
// khác nhau (lots.pallet chỉ là snapshot giao dịch cuối).
async function loadCompletedLotsForDay(factoryId: string, ngaySx: string): Promise<CompletedLotRow[]> {
  const supabase = getSupabaseAdmin();
  const { data: lots, error } = await supabase
    .from("lots")
    .select("id,ma_lo,num,loai_csr,loai_banh,boc,pallet,ghi_chu,trang_thai")
    .eq("factory_id", factoryId)
    .eq("ngay_ht", ngaySx)
    .order("num", { ascending: true })
    .range(0, 999);
  if (error) throw new Error(error.message);
  const done = (lots || []).filter((l) => normalizeLotStatus(l.trang_thai) !== "Dở dang");
  if (done.length === 0) return [];

  const ids = done.map((l) => l.id as string);
  type LotTxLite = {
    lot_id: string; boc: string | null; pallet: string[] | null;
    kien_a: number | null; kien_b: number | null; kien_c: number | null; kien_d: number | null;
  };
  const txByLot = new Map<string, LotTxLite[]>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    let txs: LotTxLite[];
    try {
      txs = await fetchAllPaginated<LotTxLite>((from, to) =>
        supabase
          .from("lot_transactions")
          .select("lot_id,boc,pallet,kien_a,kien_b,kien_c,kien_d,created_at,id")
          .in("lot_id", chunk)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      );
    } catch (err) {
      throw new Error((err as { message?: string })?.message || String(err));
    }
    for (const t of txs) {
      const list = txByLot.get(t.lot_id) || [];
      list.push(t);
      txByLot.set(t.lot_id, list);
    }
  }

  // Trùng ma_lo (dữ liệu lịch sử bẩn) → giữ 1 dòng.
  const seen = new Set<string>();
  const rows: CompletedLotRow[] = [];
  for (const l of done) {
    if (!l.ma_lo || seen.has(l.ma_lo)) continue;
    seen.add(l.ma_lo);
    const txs = txByLot.get(l.id) || [];
    rows.push({
      maLo: l.ma_lo,
      num: Number(l.num) || 0,
      loaiCsr: l.loai_csr || "",
      loaiBanh: Number(l.loai_banh) || 0,
      // Sau Thay bọc tròn kiện, 1 lô có thể có kiện khác bọc → in theo kiện như pallet.
      boc: formatPalletByKien(
        txs.map((t) => ({ ...t, pallet: t.boc ? [t.boc] : null })),
        l.boc ? [l.boc] : [],
      ),
      pallet: formatPalletByKien(txs, l.pallet || []),
      ghiChu: (l.ghi_chu || "").trim(),
    });
  }
  return rows;
}

// Fallback A→B→C — chỉ dùng làm tie-breaker khi 2 ca có cùng (hoặc thiếu) mốc created_at sớm nhất
// (về lý thuyết gần như không xảy ra vì created_at có độ chính xác mili-giây), KHÔNG còn là nguồn
// sắp xếp chính. Xem loadShiftReportData() — nguồn chính là created_at sớm nhất của mỗi ca trong
// đúng ngày đang in phiếu (đã chốt với người dùng 2026-07-21, xem rule mục 3).
const CA_ORDER = ["A", "B", "C"];
function compareCaCode(a: string, b: string): number {
  const ia = CA_ORDER.indexOf(a);
  const ib = CA_ORDER.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.localeCompare(b);
}

// Tên ca theo ca trưởng, hiệu lực tại `ngay` (mặc định hôm nay theo giờ nhà máy) — nguồn là bảng
// lịch sử production_shift_names (Cài đặt → Danh mục → Thông tin công ty), xem shift-names.ts.
// Dùng cho tiêu đề section phiếu báo thành phẩm lẫn dropdown "Ca sản xuất" ở trang quét QR.
export async function loadFactoryShiftNames(
  factoryId: string,
  ngay?: string,
): Promise<Record<string, string>> {
  const day = ngay && /^\d{4}-\d{2}-\d{2}$/.test(ngay) ? ngay : getFactoryTodayISO();
  return resolveShiftNamesAt(factoryId, day);
}

function resolveCaName(names: Record<string, string>, ca: string): string {
  if (!(SHIFT_CODES as readonly string[]).includes(ca)) return "";
  return names[ca] || "";
}

// Tổng hợp toàn bộ giao dịch của 1 NGÀY SX (mọi ca, không lọc theo người nhập — 1 ca có thể có
// nhiều người trực) để in phiếu báo thành phẩm — dùng lại cho cả "Kết thúc ca" lẫn "Xem/tạo lại
// phiếu cũ" vì luôn truy vấn lại DB, không phụ thuộc phiên làm việc nào. Trường hợp 2 ca cùng làm
// trong 1 ngày (Ca A buổi sáng, Ca B buổi chiều xuyên đêm), phiếu gộp cả 2 vào cùng 1 lần in —
// mỗi ca 1 bảng chi tiết riêng (section), 1 bảng "Tổng hợp" chung cho cả ngày.
//
// `purpose` quyết định quyền cần kiểm: "shift" = Phiếu báo thành phẩm F09 (quyền tạo thành phẩm);
// "daily" = Báo cáo lô F11 (dựng từ CHÍNH dữ liệu này, nên nhận quyền product.report_daily).
export async function loadShiftReportData(
  factoryId: string,
  ngaySx: string,
  accessToken: string | null,
  purpose: "shift" | "daily",
): Promise<ShiftReportData> {
  await assertReportAccess(
    accessToken,
    factoryId,
    purpose === "shift" ? REPORT_SHIFT_PERMISSIONS : REPORT_DAILY_PERMISSIONS,
    purpose === "shift" ? "phiếu báo thành phẩm" : "báo cáo sản xuất hằng ngày",
  );
  const [rows, shiftNames, completedLots] = await Promise.all([
    loadDayTransactions(factoryId, ngaySx),
    loadFactoryShiftNames(factoryId, ngaySx),
    loadCompletedLotsForDay(factoryId, ngaySx),
  ]);
  const nameMap = await resolveProfileNames(rows.map((r) => r.created_by || ""));

  // Nhóm theo (ca + ma_lo + boc + pallet) của ĐÚNG giao dịch — KHÔNG chỉ theo ma_lo. Trước đây gộp
  // thuần theo ma_lo rồi ghi đè boc/pallet theo giao dịch cuối cùng (last-wins) khiến 1 lô có
  // các kiện dùng pallet khác nhau (vd A/B/C = "Sắt đế gỗ", D = "MB5") bị hiển thị sai thành MỘT
  // pallet duy nhất cho cả lô, kéo theo "Tổng hợp" cộng nhầm số bành vào sai nhóm pallet (bug đã
  // xác nhận 2026-07-13). Nhóm theo tổ hợp thuộc tính thật của từng giao dịch → khi các kiện của
  // cùng 1 lô khác bọc/pallet, chúng tự tách thành nhiều dòng riêng, mỗi dòng đúng số liệu. Thêm
  // `ca` vào khóa nhóm (mới, 2026-07-13) để 1 lô có kiện làm ở 2 ca khác nhau tự tách đúng section.
  const byGroupKey = new Map<
    string,
    {
      ca: string;
      maLo: string;
      loaiCsr: string;
      loaiBanh: number;
      letters: Set<KienLetter>;
      soBanh: number;
      soKg: number;
      boc: string;
      pallet: string;
      nganMas: Set<string>;
      hoanThanhAt: string | null;
      firstAt: string | null;
      nguoiNhap: string;
    }
  >();
  const nganIdSet = new Set<string>();
  const chiThiSet = new Set<string>();
  // created_at SỚM NHẤT của mỗi ca trong ngày — dùng để suy ra "Ca 1"/"Ca 2" theo đúng thứ tự
  // sản xuất thật, thay vì hard-code A→B→C (xem CA_ORDER ở trên). `rows` đã được loadDayTransactions
  // sort sẵn theo created_at tăng dần, nên dòng đầu tiên gặp của mỗi ca chính là dòng sớm nhất —
  // không cần query/sort thêm.
  const earliestCreatedAtByCa = new Map<string, string>();

  for (const row of rows) {
    const lotInfo = Array.isArray(row.lots) ? row.lots[0] : row.lots;
    const maLo = lotInfo?.ma_lo || "";
    if (!maLo) continue;
    if (row.ngan_id) nganIdSet.add(row.ngan_id);
    // Bỏ qua created_at null: nếu lưu "" thì so sánh chuỗi không bao giờ thay được, ca đó luôn
    // bị xếp đầu dù thực tế sản xuất sau.
    if (row.created_at && !earliestCreatedAtByCa.has(row.ca)) earliestCreatedAtByCa.set(row.ca, row.created_at);
    // Fallback lot-level khi giao dịch không tự mang boc/pallet/chi_thi riêng — luôn đúng với dòng
    // nhập tay qua product/page.tsx (xem ghi chú ở ShiftTxLotInfo) — nếu không, phiếu báo thành
    // phẩm hiện trống Bọc/Pallet/Số chỉ thị cho mọi lô có ít nhất 1 giao dịch nhập tay.
    const rowChiThi = row.chi_thi || lotInfo?.chi_thi || "";
    if (rowChiThi) chiThiSet.add(rowChiThi);

    // Bọc của lô là thuộc tính chung toàn lô. Ưu tiên lots.boc (master snapshot) trước
    // để khi admin sửa bọc ở bảng lots thì phiếu thành phẩm PDF lập tức cập nhật chính xác,
    // fallback về row.boc của từng giao dịch nếu lotInfo.boc chưa có.
    const rowBoc = lotInfo?.boc || row.boc || "";
    const rowPalletArr = row.pallet && row.pallet.length > 0 ? row.pallet : lotInfo?.pallet || [];
    const rowPallet = rowPalletArr.length > 0 ? rowPalletArr.join(", ") : "";
    const key = `${row.ca}||${maLo}||${rowBoc}||${rowPallet}||${row.ngan_id || ""}`;
    const entry = byGroupKey.get(key) || {
      ca: row.ca,
      maLo,
      loaiCsr: lotInfo?.loai_csr || "",
      loaiBanh: Number(lotInfo?.loai_banh) || 0,
      letters: new Set<KienLetter>(),
      soBanh: 0,
      soKg: 0,
      boc: rowBoc,
      pallet: rowPallet,
      nganMas: new Set<string>(),
      hoanThanhAt: null,
      firstAt: null,
      nguoiNhap: "",
    };
    if (Number(row.kien_a || 0) > 0) entry.letters.add("A");
    if (Number(row.kien_b || 0) > 0) entry.letters.add("B");
    if (Number(row.kien_c || 0) > 0) entry.letters.add("C");
    if (Number(row.kien_d || 0) > 0) entry.letters.add("D");
    entry.soBanh += Number(row.so_banh || 0);
    entry.soKg += Number(row.so_kg || 0);
    if (row.ngan_id) entry.nganMas.add(row.ngan_id);
    if (row.created_at && (!entry.firstAt || row.created_at < entry.firstAt)) entry.firstAt = row.created_at;
    if (!entry.hoanThanhAt || (row.created_at && row.created_at > entry.hoanThanhAt)) {
      entry.hoanThanhAt = row.created_at;
      entry.nguoiNhap = row.created_by ? nameMap.get(row.created_by) || "—" : "—";
    }
    byGroupKey.set(key, entry);
  }

  // Resolve ngan_id -> ma_ngan 1 lần cho toàn bộ report (dùng chung cho mọi dòng/section).
  let nganMaById = new Map<string, string>();
  if (nganIdSet.size > 0) {
    const supabase = getSupabaseAdmin();
    const { data: ngans } = await supabase.from("ngans").select("id, ma_ngan").in("id", [...nganIdSet]);
    nganMaById = new Map((ngans || []).map((n) => [n.id, n.ma_ngan || ""]));
  }

  // Mốc quét SỚM NHẤT của mỗi lô trong từng ca — dùng để xếp lô theo thời gian sản xuất nhưng
  // vẫn gom các dòng cùng lô đứng liền nhau (1 lô bị tách nhiều dòng khi các kiện khác ngăn/pallet).
  const lotFirstAtBySection = new Map<string, string>();
  for (const entry of byGroupKey.values()) {
    const k = `${entry.ca}||${entry.maLo}`;
    const cur = lotFirstAtBySection.get(k);
    if (entry.firstAt && (cur === undefined || entry.firstAt < cur)) lotFirstAtBySection.set(k, entry.firstAt);
  }
  const kienRank = (letters: string) =>
    letters ? KIEN_ORDER.indexOf(letters[0] as KienLetter) : KIEN_ORDER.length;

  const bySection = new Map<string, ShiftReportLotRow[]>();
  for (const entry of byGroupKey.values()) {
    const nganMaList = [...entry.nganMas].map((id) => nganMaById.get(id)).filter((v): v is string => !!v);
    const row: ShiftReportLotRow = {
      maLo: entry.maLo,
      loaiCsr: entry.loaiCsr,
      loaiBanh: entry.loaiBanh,
      kienLetters: KIEN_ORDER.filter((k) => entry.letters.has(k)).join(""),
      soBanh: entry.soBanh,
      soKg: Math.round(entry.soKg * 100) / 100,
      boc: entry.boc,
      pallet: entry.pallet,
      nganMa: [...new Set(nganMaList)].join(", ") || "—",
      hoanThanhAt: entry.hoanThanhAt,
      nguoiNhap: entry.nguoiNhap,
    };
    const list = bySection.get(entry.ca) || [];
    list.push(row);
    bySection.set(entry.ca, list);
  }

  const sections: ShiftReportCaSection[] = [...bySection.keys()]
    .sort((a, b) => {
      const ta = earliestCreatedAtByCa.get(a) || "";
      const tb = earliestCreatedAtByCa.get(b) || "";
      return ta.localeCompare(tb) || compareCaCode(a, b);
    })
    .map((ca, idx) => {
      // Thứ tự in: lô theo mốc quét sớm nhất → cùng lô thì kiện A, B, C, D (dù trực ca quét CD
      // trước AB) → cuối cùng mới theo thời gian.
      const lotFirstAt = (maLo: string) => lotFirstAtBySection.get(`${ca}||${maLo}`) || "";
      const caRows = (bySection.get(ca) || []).sort(
        (a, b) =>
          lotFirstAt(a.maLo).localeCompare(lotFirstAt(b.maLo)) ||
          a.maLo.localeCompare(b.maLo) ||
          kienRank(a.kienLetters) - kienRank(b.kienLetters) ||
          (a.hoanThanhAt || "").localeCompare(b.hoanThanhAt || ""),
      );
      return {
        ca,
        caLabel: `Ca ${idx + 1}`,
        caName: resolveCaName(shiftNames, ca),
        rows: caRows,
        tongBanh: caRows.reduce((s, r) => s + r.soBanh, 0),
        tongKg: Math.round(caRows.reduce((s, r) => s + r.soKg, 0) * 100) / 100,
      };
    });

  const allRows = sections.flatMap((s) => s.rows);

  // Tổng hợp theo Loại CSR - Loại bành - Bọc - Loại pallet, GỘP CHUNG CẢ NGÀY (không tách theo
  // ca — đã chốt với người dùng: bảng tổng vẫn tổng hợp chung như cũ dù có nhiều ca).
  const byGroupMap = new Map<string, ShiftReportGroupRow>();
  for (const r of allRows) {
    const key = `${r.loaiCsr}||${r.loaiBanh}||${r.boc}||${r.pallet}`;
    const acc = byGroupMap.get(key) || { loaiCsr: r.loaiCsr, loaiBanh: r.loaiBanh, boc: r.boc, pallet: r.pallet, soBanh: 0, soKg: 0 };
    acc.soBanh += r.soBanh;
    acc.soKg += r.soKg;
    byGroupMap.set(key, acc);
  }

  const soChiThi = chiThiSet.size > 0 ? [...chiThiSet].join(", ") : "—";

  return {
    ngay: ngaySx,
    soChiThi,
    sections,
    tongBanh: allRows.reduce((s, r) => s + r.soBanh, 0),
    tongKg: Math.round(allRows.reduce((s, r) => s + r.soKg, 0) * 100) / 100,
    byGroup: [...byGroupMap.values()].map((g) => ({ ...g, soKg: Math.round(g.soKg * 100) / 100 })),
    completedLots,
  };
}

// ============================================================================
// "Lưu tạm nhiều kiện rồi Gửi 1 lần" — xem .claude/rules/06-module-production.md mục
// "Quét theo lượt: 'Lưu tạm' nhiều kiện rồi 'Gửi' 1 lần".
// ============================================================================

export type SaveDraftKienInput = {
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
  boc: string;
  pallet: string[];
  chiThi: string | null;
  tham: string | null;
  ghiChu: string | null;
  userId: string;
};

export type SaveDraftKienResult = { success: true; draftId: string } | { success: false; error: string };

// "Lưu tạm" — ghi nhanh 1 nháp, KHÔNG validate tồn kho/capacity (rẻ, để quét liên tục nhiều kiện
// trước khi gửi cả lượt). Chỉ chặn khi thiếu các trường bắt buộc (giống canSubmit hiện có, trừ phần
// capacity). Validate đầy đủ (max_per_kien, 110% ngăn, đồng nhất bọc/pallet theo kiện) chỉ diễn ra
// atomic lúc "Gửi tất cả" qua RPC submit_confirm_draft_batch (xem submitConfirmDraftBatch bên dưới).
export async function saveDraftKien(input: SaveDraftKienInput): Promise<SaveDraftKienResult> {
  const maLo = input.maLo.trim();
  if (!maLo) return { success: false, error: "Thiếu mã lô." };
  if (!input.nganId) return { success: false, error: "Chưa xác định ngăn nguồn cho kiện này." };
  if (!input.soBanh || input.soBanh <= 0) return { success: false, error: "Số bành phải lớn hơn 0." };
  if (!input.boc) return { success: false, error: "Chưa chọn bọc." };
  if (!input.pallet || input.pallet.length === 0) return { success: false, error: "Chưa chọn loại pallet." };
  if (!input.userId) return { success: false, error: "Không xác định được người dùng." };

  try {
    const supabase = getSupabaseAdmin();
    const config = getLoaiBanhConfig(input.loaiCsr, input.loaiBanh);
    const soKg = Math.round(input.soBanh * input.loaiBanh * 100) / 100;

    // Chặn cứng vượt max_per_kien NGAY LÚC LƯU TẠM (khác 110% ngăn/hạn mức tổng thể — vẫn để RPC
    // Gửi validate cuối cùng) — tính cả bành đã gửi thật lẫn bành đang nằm trong nháp CHƯA gửi của
    // BẤT KỲ ai khác cho đúng (ma_lo, kiện) này, để "ca sau" không thể nhập vượt số còn lại dù
    // "ca trước" chưa Gửi (mục đích chính của tính năng này).
    const kienKey = KIEN_LOWER[input.kien];
    const [{ data: existingLot }, { data: siblingDrafts }, pendingAgg] = await Promise.all([
      supabase
        .from("lots")
        .select("id, loai_csr, loai_banh, boc")
        .eq("factory_id", input.factoryId)
        .eq("ma_lo", maLo)
        .maybeSingle(),
      supabase
        .from("product_confirm_drafts")
        .select("loai_csr, loai_banh, boc, kien")
        .eq("factory_id", input.factoryId)
        .eq("ma_lo", maLo)
        .order("created_at", { ascending: true })
        .limit(1),
      loadPendingDraftAggregateForKien(input.factoryId, maLo, input.kien),
    ]);

    // Đồng nhất thuộc tính toàn lô: Nếu kiện A chủng loại gì, loại bọc gì, loại bành gì thì
    // các kiện còn lại khác KHÔNG THỂ LƯU.
    const refCsr = existingLot?.loai_csr || siblingDrafts?.[0]?.loai_csr;
    const refBanh = existingLot?.loai_banh
      ? Number(existingLot.loai_banh)
      : siblingDrafts?.[0]?.loai_banh
      ? Number(siblingDrafts[0].loai_banh)
      : null;
    const refBoc = existingLot?.boc || siblingDrafts?.[0]?.boc;

    if (refCsr && refCsr !== input.loaiCsr) {
      return {
        success: false,
        error: `Cùng lô ${maLo} không thể khác Chủng loại (kiện trước là "${refCsr}", đang chọn "${input.loaiCsr}").`,
      };
    }
    if (refBanh && Number(refBanh) !== Number(input.loaiBanh)) {
      return {
        success: false,
        error: `Cùng lô ${maLo} không thể khác Loại bành (kiện trước là ${refBanh}kg, đang chọn ${input.loaiBanh}kg).`,
      };
    }
    if (refBoc && input.boc && refBoc !== input.boc) {
      return {
        success: false,
        error: `Cùng lô ${maLo} không thể khác Loại bọc (kiện trước là "${refBoc}", đang chọn "${input.boc}").`,
      };
    }

    let committedBanh = 0;
    if (existingLot) {
      const { data: txRows } = await supabase
        .from("lot_transactions")
        .select(`kien_${kienKey}`)
        .eq("lot_id", existingLot.id);
      committedBanh = (txRows || []).reduce(
        (sum, row) => sum + Number((row as Record<string, unknown>)[`kien_${kienKey}`] || 0),
        0,
      );
    }
    const totalClaimed = committedBanh + pendingAgg.totalBanh;
    if (totalClaimed + input.soBanh > config.max_per_kien) {
      const remaining = Math.max(0, config.max_per_kien - totalClaimed);
      return {
        success: false,
        error: `Kiện ${input.kien} của lô ${maLo} đã có ${totalClaimed} bành (đã gửi + đang chờ gửi), chỉ được lưu thêm tối đa ${remaining} bành.`,
      };
    }

    const { data, error } = await supabase
      .from("product_confirm_drafts")
      .insert({
        factory_id: input.factoryId,
        created_by: input.userId,
        ma_lo: maLo,
        kien: input.kien,
        is_new_lot: input.isNewLot,
        ngan_id: input.nganId,
        loai_csr: input.loaiCsr,
        loai_banh: input.loaiBanh,
        day_chuyen: input.dayChuyen,
        so_banh: input.soBanh,
        so_kg: soKg,
        max_per_kien: config.max_per_kien,
        ngay_sx: input.ngaySx,
        ca: input.ca,
        boc: input.boc,
        pallet: input.pallet,
        chi_thi: input.chiThi,
        tham: input.tham,
        ghi_chu: input.ghiChu,
      })
      .select("id")
      .single();
    if (error || !data) return { success: false, error: error?.message || "Không lưu được nháp." };
    return { success: true, draftId: data.id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Lỗi không xác định khi lưu nháp.",
    };
  }
}

export type ConfirmDraftRow = {
  id: string;
  maLo: string;
  kien: KienLetter;
  isNewLot: boolean;
  nganId: string;
  nganMa: string | null;
  nganTen: string | null;
  loaiCsr: string;
  loaiBanh: number;
  dayChuyen: string | null;
  soBanh: number;
  soKg: number;
  maxPerKien: number;
  ngaySx: string;
  ca: string;
  boc: string | null;
  pallet: string[] | null;
  chiThi: string | null;
  tham: string | null;
  ghiChu: string | null;
  createdAt: string | null;
};

// Danh sách nháp CHƯA gửi của đúng user hiện tại — dùng cho khối "Đang chờ gửi" trong Hub.
export async function loadDrafts(factoryId: string, userId: string): Promise<ConfirmDraftRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("product_confirm_drafts")
    .select(
      "id,ma_lo,kien,is_new_lot,ngan_id,loai_csr,loai_banh,day_chuyen,so_banh,so_kg,max_per_kien,ngay_sx,ca,boc,pallet,chi_thi,tham,ghi_chu,created_at",
    )
    .eq("factory_id", factoryId)
    .eq("created_by", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = data || [];

  const nganIds = [...new Set(rows.map((r) => r.ngan_id).filter(Boolean))];
  let nganInfoById = new Map<string, { ma_ngan: string; ten_ngan: string }>();
  if (nganIds.length > 0) {
    const { data: nganRows } = await supabase.from("ngans").select("id, ma_ngan, ten_ngan").in("id", nganIds);
    nganInfoById = new Map((nganRows || []).map((n) => [n.id, { ma_ngan: n.ma_ngan, ten_ngan: n.ten_ngan }]));
  }

  return rows.map((r) => ({
    id: r.id,
    maLo: r.ma_lo,
    kien: r.kien as KienLetter,
    isNewLot: r.is_new_lot,
    nganId: r.ngan_id,
    nganMa: nganInfoById.get(r.ngan_id)?.ma_ngan ?? null,
    nganTen: nganInfoById.get(r.ngan_id)?.ten_ngan ?? null,
    loaiCsr: r.loai_csr,
    loaiBanh: Number(r.loai_banh),
    dayChuyen: r.day_chuyen,
    soBanh: Number(r.so_banh),
    soKg: Number(r.so_kg),
    maxPerKien: Number(r.max_per_kien),
    ngaySx: r.ngay_sx,
    ca: r.ca,
    boc: r.boc,
    pallet: r.pallet,
    chiThi: r.chi_thi,
    tham: r.tham,
    ghiChu: r.ghi_chu,
    createdAt: r.created_at,
  }));
}

export type DeleteDraftResult = { success: true } | { success: false; error: string };

// Xóa 1 nháp CHƯA gửi — chỉ chủ nháp mới xóa được (re-check qua created_by, không tin caller).
export async function deleteDraft(draftId: string, userId: string): Promise<DeleteDraftResult> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("product_confirm_drafts")
      .delete()
      .eq("id", draftId)
      .eq("created_by", userId)
      .select("id");
    if (error) return { success: false, error: error.message };
    if (!data || data.length === 0) {
      return { success: false, error: "Không tìm thấy nháp hoặc không có quyền xóa." };
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Lỗi không xác định khi xóa nháp.",
    };
  }
}

export type UpdateDraftKienInput = {
  draftId: string;
  factoryId: string;
  /** Người sửa lấy từ token (không tin userId trình duyệt gửi). */
  accessToken: string | null;
  nganId: string;
  soBanh: number;
  ngaySx: string;
  ca: string;
  boc: string;
  pallet: string[];
  chiThi: string | null;
  tham: string | null;
  ghiChu: string | null;
};

export type UpdateDraftKienResult = { success: true } | { success: false; error: string };

// Sửa 1 nháp CHƯA gửi — chỉ chủ nháp mới sửa được (re-check qua created_by, không tin caller).
// Vì nháp chưa từng qua RPC submit_confirm_draft_batch (chưa ghi lot_transactions/sync trạng
// thái lô), sửa nháp đơn giản hơn nhiều so với sửa giao dịch đã gửi (editShiftHistoryEntry) —
// không cần lo sync_lot_master_snapshot hay điều kiện "lô còn Dở dang" (draft luôn thuộc lô
// chưa tròn theo bản chất), chỉ UPDATE thẳng product_confirm_drafts sau khi re-check lại đúng
// max_per_kien (cộng bành đã gửi thật + nháp KHÁC của BẤT KỲ ai cho cùng kiện, TRỪ chính nháp
// đang sửa — mirror cách saveDraftKien tính totalClaimed). Xem
// .claude/rules/06-module-production.md mục "4b".
export async function updateDraftKien(input: UpdateDraftKienInput): Promise<UpdateDraftKienResult> {
  if (!input.soBanh || input.soBanh <= 0) return { success: false, error: "Số bành phải lớn hơn 0." };
  if (!input.nganId) return { success: false, error: "Chưa xác định ngăn nguồn cho kiện này." };
  if (!input.boc) return { success: false, error: "Chưa chọn bọc." };
  if (!input.pallet || input.pallet.length === 0) return { success: false, error: "Chưa chọn loại pallet." };

  try {
    const userId = await assertProductAccess(input.accessToken, input.factoryId, PRODUCT_CREATE_PERMISSIONS, "sửa nháp");
    const supabase = getSupabaseAdmin();
    const { data: draft, error: draftErr } = await supabase
      .from("product_confirm_drafts")
      .select("id, ma_lo, kien, loai_csr, loai_banh, created_by, factory_id, ngan_id, day_chuyen")
      .eq("id", input.draftId)
      .maybeSingle();
    if (draftErr || !draft) return { success: false, error: "Không tìm thấy nháp cần sửa." };
    if (draft.created_by !== userId) return { success: false, error: "Không có quyền sửa nháp này." };
    if (draft.factory_id !== input.factoryId) return { success: false, error: "Nháp không thuộc nhà máy hiện tại." };

    const kien = draft.kien as KienLetter;
    const config = getLoaiBanhConfig(draft.loai_csr, Number(draft.loai_banh));
    const soKg = Math.round(input.soBanh * Number(draft.loai_banh) * 100) / 100;

    const [{ data: existingLot }, { data: siblingDrafts }, { data: otherDraftRows }] = await Promise.all([
      supabase.from("lots").select("id, boc, loai_csr, loai_banh").eq("factory_id", input.factoryId).eq("ma_lo", draft.ma_lo).maybeSingle(),
      supabase
        .from("product_confirm_drafts")
        .select("boc")
        .eq("factory_id", input.factoryId)
        .eq("ma_lo", draft.ma_lo)
        .neq("id", input.draftId)
        .limit(1),
      supabase
        .from("product_confirm_drafts")
        .select("so_banh")
        .eq("factory_id", input.factoryId)
        .eq("ma_lo", draft.ma_lo)
        .eq("kien", kien)
        .neq("id", input.draftId),
    ]);

    const refBoc = existingLot?.boc || siblingDrafts?.[0]?.boc;
    if (refBoc && input.boc && refBoc !== input.boc) {
      return {
        success: false,
        error: `Cùng lô ${draft.ma_lo} không thể khác Loại bọc (đã có: "${refBoc}", đang chọn "${input.boc}").`,
      };
    }
    let committedBanh = 0;
    if (existingLot) {
      const kienKey = KIEN_LOWER[kien];
      const { data: txRows } = await supabase
        .from("lot_transactions")
        .select(`kien_${kienKey}`)
        .eq("lot_id", existingLot.id);
      committedBanh = (txRows || []).reduce(
        (sum, row) => sum + Number((row as Record<string, unknown>)[`kien_${kienKey}`] || 0),
        0,
      );
    }
    const otherDraftBanh = (otherDraftRows || []).reduce((sum, r) => sum + Number(r.so_banh || 0), 0);
    const totalClaimed = committedBanh + otherDraftBanh;
    if (totalClaimed + input.soBanh > config.max_per_kien) {
      const remaining = Math.max(0, config.max_per_kien - totalClaimed);
      return {
        success: false,
        error: `Kiện ${kien} của lô ${draft.ma_lo} đã có ${totalClaimed} bành (đã gửi + nháp khác), chỉ được sửa tối đa ${remaining} bành.`,
      };
    }

    // Đổi ngăn của nháp: nếu nháp đang đúng ngăn KẾ HOẠCH của kiện, bắt buộc đi qua đổi ngăn theo
    // kế hoạch (kiểm sức chứa + chuyển chỗ giữ sang ngăn mới) — không cho đổi tự do, tránh ngăn cũ vẫn
    // giữ chỗ kiện này trong khi nháp đã sang ngăn khác (tính trùng).
    if (input.nganId !== draft.ngan_id) {
      const { data: plan } = await supabase
        .from("lot_prediction_lots")
        .select("kien_a_ngan_id,kien_b_ngan_id,kien_c_ngan_id,kien_d_ngan_id")
        .eq("factory_id", input.factoryId)
        .eq("ma_lo", draft.ma_lo)
        .neq("trang_thai", "Hủy")
        .maybeSingle();
      const planNgan = plan ? ((plan as Record<string, unknown>)[`kien_${KIEN_LOWER[kien]}_ngan_id`] as string | null) : null;
      if (planNgan && planNgan === draft.ngan_id) {
        if (committedBanh > 0) {
          return { success: false, error: `Kiện ${kien} lô ${draft.ma_lo} đã gửi bành ở ngăn cũ — một kiện không được lấy từ 2 ngăn.` };
        }
        // Đổi ngăn kế hoạch cần đúng quyền như màn đổi ngăn (không chỉ quyền nhập nháp).
        await assertProductAccess(input.accessToken, input.factoryId, PRODUCT_SWAP_NGAN_PERMISSIONS, "đổi ngăn nguồn");
        const swap = await swapKienNganInternal({
          factoryId: input.factoryId,
          maLo: draft.ma_lo,
          kien,
          oldNganId: planNgan,
          newNganId: input.nganId,
          dayChuyen: draft.day_chuyen ?? null,
          userId: userId,
          draftId: input.draftId,
        });
        if (!swap.success) return { success: false, error: swap.error };
      }
    }

    const { error: updateError } = await supabase
      .from("product_confirm_drafts")
      .update({
        ngan_id: input.nganId,
        so_banh: input.soBanh,
        so_kg: soKg,
        ngay_sx: input.ngaySx,
        ca: input.ca,
        boc: input.boc,
        pallet: input.pallet,
        chi_thi: input.chiThi,
        tham: input.tham,
        ghi_chu: input.ghiChu,
      })
      .eq("id", input.draftId)
      .eq("created_by", userId);
    if (updateError) return { success: false, error: updateError.message };
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Lỗi không xác định khi sửa nháp.",
    };
  }
}

export type SubmitDraftBatchResult =
  | { success: true; count: number; touchedLots: Array<{ maLo: string; lotId: string; isNewLot: boolean }> }
  | { success: false; error: string };

// "Gửi tất cả" — validate + ghi atomic toàn bộ nháp đã chọn qua RPC submit_confirm_draft_batch.
// All-or-nothing: 1 nháp lỗi thì toàn bộ batch rollback ở tầng DB, không nháp nào bị xóa/ghi.
export async function submitConfirmDraftBatch(
  factoryId: string,
  userId: string,
  draftIds: string[],
): Promise<SubmitDraftBatchResult> {
  if (draftIds.length === 0) return { success: false, error: "Không có nháp nào để gửi." };
  try {
    const supabase = getSupabaseAdmin();
    const { data: draftRows, error: draftError } = await supabase
      .from("product_confirm_drafts")
      .select("id, ma_lo, loai_csr, loai_banh, is_new_lot")
      .in("id", draftIds)
      .eq("created_by", userId)
      .eq("factory_id", factoryId);
    if (draftError) return { success: false, error: draftError.message };
    if (!draftRows || draftRows.length !== draftIds.length) {
      return { success: false, error: "Một số nháp không còn tồn tại — vui lòng tải lại danh sách." };
    }

    // max_per_kien luôn tính MỚI ngay trước khi gửi (không tin cột đã lưu từ lúc Lưu tạm) — tránh
    // lệch dữ liệu nếu mapping loai_csr/loai_banh -> max_per_kien từng thay đổi giữa 2 thời điểm.
    const recomputed = draftRows.map((d) => ({
      draft_id: d.id,
      max_per_kien: getLoaiBanhConfig(d.loai_csr, Number(d.loai_banh)).max_per_kien,
    }));

    const { data: resultRows, error: rpcError } = await supabase.rpc("submit_confirm_draft_batch", {
      p_draft_ids: draftIds,
      p_user_id: userId,
      p_recomputed: recomputed,
    });
    if (rpcError) {
      const isDeadlock = (rpcError as { code?: string }).code === "40P01";
      return {
        success: false,
        error: isDeadlock
          ? "Hệ thống đang bận xử lý một lượt gửi khác, vui lòng thử lại sau vài giây."
          : rpcError.message,
      };
    }

    const rows = (resultRows || []) as Array<{
      draft_id: string;
      lot_id: string;
      ma_lo: string;
      kien: string;
      so_kg: number;
    }>;
    const draftById = new Map(draftRows.map((d) => [d.id, d]));
    const touchedLotsMap = new Map<string, { maLo: string; lotId: string; isNewLot: boolean }>();
    for (const row of rows) {
      const draft = draftById.get(row.draft_id);
      const isNewLot = !!draft?.is_new_lot;
      const existing = touchedLotsMap.get(row.lot_id);
      touchedLotsMap.set(row.lot_id, {
        maLo: row.ma_lo,
        lotId: row.lot_id,
        isNewLot: isNewLot || existing?.isNewLot || false,
      });
    }
    const touchedLots = [...touchedLotsMap.values()];

    // Chuyển dự kiến -> thật cho các lô mới tạo trong batch — idempotent, best-effort (không chặn
    // kết quả thành công của "Gửi tất cả" nếu bước phụ này lỗi, mirror đúng cách confirmKienProduction
    // đang xử lý markLotPredictionRealized cho luồng không-nháp).
    await Promise.allSettled(
      touchedLots.filter((t) => t.isNewLot).map((t) => markLotPredictionRealized(factoryId, t.maLo, t.lotId)),
    );

    return { success: true, count: rows.length, touchedLots };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Lỗi không xác định khi gửi nháp.",
    };
  }
}
