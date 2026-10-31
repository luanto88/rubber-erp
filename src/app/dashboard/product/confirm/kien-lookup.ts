// Logic tra cứu 1 kiện cho màn quét QR xác nhận sản xuất — hàm THUẦN, dùng chung cho:
//   - server: resolveKienForConfirm (confirm/actions.ts) gom dữ liệu từ DB rồi gọi computeKienLookup;
//   - client: khi mất mạng, dựng lại từ gói tải sẵn (loadConfirmOfflinePack) + hàng đợi trên máy.
// KHÔNG import gì chạy server (supabase-admin, fs...) — file này bị bundle cho trình duyệt.

import type { KienLetter } from "@/lib/product-label";
import { getLoaiBanhConfig } from "@/lib/product-lot-config";

// "partial_kien": kiện đã có MỘT PHẦN bành (do top-up dở dang trước đó, tính CẢ committed lẫn nháp
// chưa gửi của bất kỳ ai) — vẫn cho quét lại, nhưng số bành tối đa cho phép nhập = maxPerKien -
// (existingBanh + pendingDraftBanh) (mục 5 rule 06-module-production.md).
// "drafted_full": kiện đã đủ maxPerKien nhưng phần lớn/toàn bộ là NHÁP CHƯA GỬI (chưa thật sự sản
// xuất) — khác "produced" (đã gửi thật) để tránh thông báo sai là "đã sản xuất".
// "offline_unknown": CHỈ client dựng khi mất mạng mà mã không có trong gói tải sẵn — server không
// bao giờ trả giá trị này. Người dùng tự chọn CSR/bành/ngăn, server kiểm lại khi đồng bộ.
export type ConfirmKienStatus =
  | "predicted"
  | "partial"
  | "partial_kien"
  | "drafted_full"
  | "produced"
  | "not_found"
  | "offline_unknown";

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
  // Số bành kiện này ĐÃ GỬI THẬT (committed, lot_transactions) — KHÔNG gồm nháp chưa gửi (xem
  // pendingDraftBanh). remainingBanh đã trừ luôn cả nháp chưa gửi.
  existingBanh: number;
  remainingBanh: number | null;
  // Số bành đang nằm trong nháp CHƯA GỬI của đúng kiện này — tính từ TẤT CẢ người dùng trong nhà
  // máy, để ca sau biết chính xác ca trước đã "giữ chỗ" bao nhiêu dù chưa Gửi.
  pendingDraftBanh: number;
  pendingDraftBy: string[];
  // Bọc/Pallet "gần nhất" của ĐÚNG kiện đang xác nhận (không phải toàn lô) — ưu tiên nháp chưa gửi
  // mới nhất nếu có, else dữ liệu đã gửi gần nhất. Các lần nhập tiếp theo của CÙNG 1 kiện được phép
  // khác Ca SX/Số chỉ thị/Ngày SX, nhưng BẮT BUỘC cùng Bọc/Pallet với lần nhập trước của kiện đó.
  existingKienBoc: string | null;
  existingKienPallet: string[] | null;
  // Thuộc tính đã ghi nhận của lô (từ lots hoặc nháp trước đó) — trong cùng 1 lô, tất cả các kiện
  // bắt buộc cùng Chủng loại, Loại bọc và Loại bành.
  existingLotCsr: string | null;
  existingLotBanh: number | null;
  existingLotBoc: string | null;
  // Ngăn KẾ HOẠCH của đúng kiện này (lot_prediction_lots.kien_X_ngan_id) — chỉ có khi lô có dự đoán.
  predictionNganId?: string | null;
};

export type KienLookupLot = {
  id: string;
  loai_csr: string | null;
  loai_banh: number | null;
  day_chuyen: string | null;
  boc: string | null;
  tham: string | null;
  pallet: string[] | null;
  chi_thi: string | null;
  ghi_chu: string | null;
  ngan_id: string | null;
};

export type KienLookupPredicted = {
  loai_csr: string;
  loai_banh: number | null;
  boc: string | null;
  tham: string | null;
  kien_a_ngan_id: string | null;
  kien_b_ngan_id: string | null;
  kien_c_ngan_id: string | null;
  kien_d_ngan_id: string | null;
};

export type KienLookupTx = {
  kien_a: number;
  kien_b: number;
  kien_c: number;
  kien_d: number;
  boc: string | null;
  pallet: string[] | null;
  created_at: string | null;
};

export type KienLookupDraft = {
  id: string;
  kien: string;
  so_banh: number;
  boc: string | null;
  pallet: string[] | null;
  created_by: string | null;
  loai_csr: string | null;
  loai_banh: number | null;
  created_at: string | null;
};

/** Toàn bộ dữ liệu của 1 mã lô cần để tra mọi kiện của lô đó. */
export type KienLookupSource = {
  lot: KienLookupLot | null;
  predicted: KienLookupPredicted | null;
  /** day_chuyen của batch dự đoán gốc (chỉ dùng khi lô thật chưa có day_chuyen). */
  batchDayChuyen: string | null;
  /** Giao dịch thật của lô, sắp created_at tăng dần. */
  txRows: KienLookupTx[];
  /** Nháp CHƯA gửi của cả lô (mọi kiện, mọi người), sắp created_at tăng dần. */
  drafts: KienLookupDraft[];
};

export type KienLookupContext = {
  nganInfo: Record<string, { ma_ngan: string | null; ten_ngan: string | null }>;
  profileNames: Record<string, string>;
  suggestedChiThi: string;
};

const KIEN_LOWER: Record<KienLetter, "a" | "b" | "c" | "d"> = { A: "a", B: "b", C: "c", D: "d" };

export function notFoundLookup(maLo: string, kien: KienLetter): ConfirmKienLookup {
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

function kienWeight(config: { max_per_kien: number; loai_banh: number }) {
  return Math.round(config.max_per_kien * config.loai_banh * 100) / 100;
}

export function computeKienLookup(
  src: KienLookupSource | null | undefined,
  maLoRaw: string,
  kien: KienLetter,
  ctx: KienLookupContext,
): ConfirmKienLookup {
  const maLo = maLoRaw.trim();
  if (!src || !maLo) return notFoundLookup(maLo, kien);
  const { lot, predicted, txRows, drafts } = src;
  const kienKey = KIEN_LOWER[kien];
  const kienField = `kien_${kienKey}` as "kien_a" | "kien_b" | "kien_c" | "kien_d";

  const ngan = (id: string | null) => {
    if (!id) return { nganMa: null as string | null, nganTen: null as string | null };
    const info = ctx.nganInfo[id];
    return { nganMa: info?.ma_ngan ?? null, nganTen: info?.ten_ngan ?? null };
  };

  const predictedNganId = predicted ? predicted[`${kienField}_ngan_id` as keyof KienLookupPredicted] as string | null : null;
  const dayChuyenFromBatch = src.batchDayChuyen;

  // Thuộc tính toàn lô: lô thật trước, thiếu thì lấy nháp SỚM NHẤT của lô (mọi kiện).
  let existingLotCsr: string | null = lot?.loai_csr ?? null;
  let existingLotBanh: number | null = lot?.loai_banh ? Number(lot.loai_banh) : null;
  let existingLotBoc: string | null = lot?.boc ?? null;
  if (!existingLotCsr || !existingLotBoc || !existingLotBanh) {
    const siblingDraft = drafts[0];
    if (siblingDraft) {
      if (!existingLotCsr) existingLotCsr = siblingDraft.loai_csr;
      if (!existingLotBanh) existingLotBanh = Number(siblingDraft.loai_banh);
      if (!existingLotBoc) existingLotBoc = siblingDraft.boc;
    }
  }

  // Nháp CHƯA GỬI của đúng kiện này, từ BẤT KỲ ai.
  const kienDrafts = drafts.filter((d) => d.kien === kien);
  const lastDraft = kienDrafts.length > 0 ? kienDrafts[kienDrafts.length - 1] : null;
  const creatorIds = [...new Set(kienDrafts.map((d) => d.created_by).filter((v): v is string => !!v))];
  const pendingAgg = {
    totalBanh: kienDrafts.reduce((sum, d) => sum + Number(d.so_banh || 0), 0),
    lastBoc: lastDraft?.boc ?? null,
    lastPallet: lastDraft?.pallet ?? null,
    byNames: creatorIds.map((id) => ctx.profileNames[id] || "—"),
  };

  if (lot) {
    const nganIdForPartial = predictedNganId || lot.ngan_id || null;
    const needsSecondNganLookup = !!lot.ngan_id && !!nganIdForPartial && lot.ngan_id !== nganIdForPartial;
    const primaryNganInfo = ngan(lot.ngan_id);
    const secondaryNganInfo = needsSecondNganLookup ? ngan(nganIdForPartial) : null;

    const existingBanh = txRows.reduce((sum, row) => sum + Number(row[kienField] || 0), 0);
    const lastKienTx = [...txRows].reverse().find((row) => Number(row[kienField] || 0) > 0) || null;
    const existingKienBoc = pendingAgg.lastBoc ?? lastKienTx?.boc ?? null;
    const existingKienPallet = pendingAgg.lastPallet ?? lastKienTx?.pallet ?? null;

    const config = lot.loai_csr ? getLoaiBanhConfig(lot.loai_csr, Number(lot.loai_banh) || undefined) : null;
    const maxPerKien = config?.max_per_kien ?? 36;
    const totalClaimed = existingBanh + pendingAgg.totalBanh;
    const common = {
      maLo,
      kien,
      isNewLot: false,
      lotId: lot.id,
      loaiCsr: lot.loai_csr,
      loaiBanh: lot.loai_banh,
      tham: lot.tham,
      chiThi: lot.chi_thi,
      ghiChu: lot.ghi_chu,
      maxPerKien: config?.max_per_kien ?? null,
      kienWeightKg: config ? kienWeight(config) : null,
      existingBanh,
      pendingDraftBanh: pendingAgg.totalBanh,
      pendingDraftBy: pendingAgg.byNames,
      existingKienBoc,
      existingKienPallet,
      existingLotCsr,
      existingLotBanh,
      existingLotBoc,
    };

    if (existingBanh >= maxPerKien) {
      return {
        ...common,
        status: "produced",
        dayChuyen: lot.day_chuyen,
        boc: lot.boc,
        pallet: lot.pallet,
        nganId: lot.ngan_id,
        ...primaryNganInfo,
        remainingBanh: 0,
      };
    }

    // Đủ maxPerKien nếu tính cả nháp chưa gửi (nhưng chưa thật sự sản xuất).
    if (totalClaimed >= maxPerKien) {
      return {
        ...common,
        status: "drafted_full",
        dayChuyen: lot.day_chuyen ?? dayChuyenFromBatch,
        boc: existingKienBoc ?? lot.boc,
        pallet: existingKienPallet ?? lot.pallet,
        nganId: nganIdForPartial,
        ...(secondaryNganInfo ?? primaryNganInfo),
        remainingBanh: 0,
      };
    }

    const isPartialKien = totalClaimed > 0;
    return {
      ...common,
      status: isPartialKien ? "partial_kien" : "partial",
      dayChuyen: lot.day_chuyen ?? dayChuyenFromBatch,
      // Kiện đã có một phần hoặc lô đã có bọc chuẩn: ưu tiên existingLotBoc để toàn lô đồng nhất
      boc: existingLotBoc ?? (isPartialKien ? existingKienBoc ?? lot.boc : lot.boc),
      pallet: isPartialKien ? existingKienPallet ?? lot.pallet : lot.pallet,
      nganId: nganIdForPartial,
      ...(secondaryNganInfo ?? primaryNganInfo),
      remainingBanh: maxPerKien - totalClaimed,
      predictionNganId: predictedNganId,
    };
  }

  if (predicted) {
    const config = getLoaiBanhConfig(predicted.loai_csr, Number(predicted.loai_banh) || undefined);
    const totalClaimed = pendingAgg.totalBanh; // lô chưa tồn tại nên committed = 0
    const base = {
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
      chiThi: ctx.suggestedChiThi,
      ghiChu: null,
      nganId: predictedNganId,
      ...ngan(predictedNganId),
      maxPerKien: config.max_per_kien,
      kienWeightKg: kienWeight(config),
      existingBanh: 0,
      pendingDraftBanh: pendingAgg.totalBanh,
      pendingDraftBy: pendingAgg.byNames,
      existingKienBoc: pendingAgg.lastBoc,
      existingKienPallet: pendingAgg.lastPallet,
      existingLotCsr,
      existingLotBanh,
      existingLotBoc,
    };
    if (totalClaimed >= config.max_per_kien) {
      return { ...base, status: "drafted_full", remainingBanh: 0 };
    }
    return {
      ...base,
      // Đã có nháp chưa gửi cho kiện này ⇒ "partial_kien" để bắt buộc đồng nhất Bọc/Pallet với nháp đó.
      status: totalClaimed > 0 ? "partial_kien" : "predicted",
      remainingBanh: config.max_per_kien - totalClaimed,
      predictionNganId: predictedNganId,
    };
  }

  return notFoundLookup(maLo, kien);
}

const MU_NUOC_CSR_SUFFIX = ["L", "3L", "CV50", "CV60"];

/** Dây chuyền suy từ loại CSR (CSRL/SVR3L/CSRCV50… ⇒ Mủ nước, còn lại Mủ tạp). */
export function dayChuyenForCsr(loaiCsr: string): string {
  const suffix = loaiCsr.replace(/^(CSR|SVR)/, "");
  return MU_NUOC_CSR_SUFFIX.includes(suffix) ? "Mủ nước" : "Mủ tạp";
}

/** Lookup tạm cho mã KHÔNG có trong gói tải sẵn khi mất mạng — người dùng tự chọn CSR/bành/ngăn. */
export function offlineUnknownLookup(maLo: string, kien: KienLetter, loaiCsr: string, loaiBanh: number): ConfirmKienLookup {
  const config = getLoaiBanhConfig(loaiCsr, loaiBanh);
  return {
    ...notFoundLookup(maLo.trim(), kien),
    status: "offline_unknown",
    isNewLot: true,
    loaiCsr,
    loaiBanh: config.loai_banh,
    dayChuyen: dayChuyenForCsr(loaiCsr),
    maxPerKien: config.max_per_kien,
    kienWeightKg: kienWeight(config),
    remainingBanh: config.max_per_kien,
  };
}
