"use server";

import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getLoaiBanhConfig, kienWeightKg as calcKienWeightKg } from "@/lib/product-lot-config";

export type PredictAvailableNgan = {
  id: string;
  ma_ngan: string;
  ten_ngan: string;
  loai_nl: string;
  tong_kho: number;
  trang_thai: string;
};

export async function loadPredictAvailableNgans(
  factoryId: string,
): Promise<PredictAvailableNgan[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("ngans")
    .select("id,ma_ngan,ten_ngan,loai_nl,tong_kho,trang_thai")
    .eq("factory_id", factoryId)
    .in("trang_thai", ["Chờ sản xuất", "Đang sản xuất"])
    .gt("tong_kho", 0)
    .order("ten_ngan", { ascending: true });
  if (error) throw new Error(error.message);
  let ngans = (data || []) as PredictAvailableNgan[];

  // Loại ngăn đã bị đánh dấu "đã dự kiến xong" (checkbox lúc tạo) — bất kể còn dư dung lượng
  // danh nghĩa bao nhiêu, vì mục tiêu mặc định chỉ 100-105% (không phải 110%) nên luôn còn dư
  // 5-10% nếu chỉ dựa vào capacity thô. Xem cột lot_prediction_batches.closes_ngan.
  const { data: closedRows, error: closedErr } = await supabase
    .from("lot_prediction_batches")
    .select("ngan_id")
    .eq("factory_id", factoryId)
    .eq("closes_ngan", true);
  if (closedErr) throw new Error(closedErr.message);
  const closedNganIds = new Set((closedRows || []).map((r) => r.ngan_id));
  ngans = ngans.filter((n) => !closedNganIds.has(n.id));

  // Loại ngăn đã "hết dung lượng dự đoán" — real kg + predicted kg + KL "có chủ" của kiện dở
  // dang một phần (xem getReservedKgForPartialKien) đã chạm 110% tong_kho, không còn chỗ
  // trống dù chỉ 1 kiện. Tính thuần theo kg (không phụ thuộc CSR/bành cụ thể, vì bước chọn
  // ngăn diễn ra TRƯỚC khi chọn CSR/bành).
  const reservedMap = await getReservedKgForPartialKien(factoryId);
  const withCapacity = await Promise.all(
    ngans.map(async (n) => {
      const [realKg, predictedKg] = await Promise.all([
        getExistingRealKg(factoryId, n.id),
        getExistingPredictedKg(factoryId, n.id),
      ]);
      const reservedKg = reservedMap[n.id] || 0;
      const capKg = Number(n.tong_kho || 0) * 1.1;
      const availableKg = capKg - realKg - predictedKg - reservedKg;
      return { ngan: n, availableKg };
    }),
  );
  return withCapacity.filter((x) => x.availableKg > 0.5).map((x) => x.ngan);
}

// Lấy thông tin ngăn theo id, KHÔNG lọc theo trạng thái/dung lượng/đóng dự kiến — dùng khi
// cần hiển thị 1 ngăn đã được gán trước đó (vd trong modal sửa lô dự kiến) dù ngăn đó hiện
// không còn nằm trong loadPredictAvailableNgans (đã đóng dự kiến hoặc đã hết dung lượng).
export async function loadNgansByIdsRaw(ids: string[]): Promise<PredictAvailableNgan[]> {
  if (ids.length === 0) return [];
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("ngans")
    .select("id,ma_ngan,ten_ngan,loai_nl,tong_kho,trang_thai")
    .in("id", Array.from(new Set(ids)));
  if (error) throw new Error(error.message);
  return (data || []) as PredictAvailableNgan[];
}

// Export để tái dùng ở src/app/dashboard/product/confirm/actions.ts (luồng quét QR xác nhận
// sản xuất) — tránh viết lại cùng 1 query tính KL thật đã ghi nhận trong ngăn.
//
// Phân trang bằng .range() — một ngăn hiếm khi vượt 1000 giao dịch trong vòng đời của nó, nhưng
// không có gì đảm bảo tuyệt đối (ngăn tồn tại lâu, nhiều lần top-up từng kiện qua quét QR liên
// tục). PostgREST mặc định cắt kết quả ở 1000 dòng và không báo lỗi — xem
// .claude/rules/04-code-patterns.md mục "Phân trang khi query bảng lớn". Không dùng .order() ở
// đây vì range() chỉ cần đọc hết toàn bộ tập hợp để SUM, không quan tâm thứ tự.
export async function getExistingRealKg(
  factoryId: string,
  nganId: string,
): Promise<number> {
  const supabase = getSupabaseAdmin();
  let total = 0;
  let from = 0;
  const PAGE_SIZE = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from("lot_transactions")
      .select("so_kg, lots!inner(factory_id)")
      .eq("ngan_id", nganId)
      .eq("lots.factory_id", factoryId)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data || [];
    total += rows.reduce((sum, row) => sum + Number(row.so_kg || 0), 0);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return total;
}

async function getExistingPredictedKg(
  factoryId: string,
  nganId: string,
  excludeIds: string[] = [],
): Promise<number> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("lot_prediction_lots")
    .select("id,kien_a_ngan_id,kien_b_ngan_id,kien_c_ngan_id,kien_d_ngan_id,kien_weight_kg")
    .eq("factory_id", factoryId)
    .eq("trang_thai", "Dự kiến")
    .is("real_lot_id", null);
  if (error) throw new Error(error.message);
  const excludeSet = new Set(excludeIds);
  return (data || [])
    .filter((row) => !excludeSet.has(row.id))
    .reduce((sum, row) => {
      let count = 0;
      if (row.kien_a_ngan_id === nganId) count += 1;
      if (row.kien_b_ngan_id === nganId) count += 1;
      if (row.kien_c_ngan_id === nganId) count += 1;
      if (row.kien_d_ngan_id === nganId) count += 1;
      return sum + count * Number(row.kien_weight_kg || 0);
    }, 0);
}

type KienLetterLower = "a" | "b" | "c" | "d";
const KIEN_LETTERS_LOWER: KienLetterLower[] = ["a", "b", "c", "d"];

type KienFillInfo = {
  letter: KienLetterLower;
  realCount: number;
  originNganId: string | null;
  status: "empty" | "partial" | "full";
};

export type RealContinuation = {
  maLo: string;
  num: number;
  unassignableLetters: KienLetterLower[];
  openLetters: KienLetterLower[];
};

// Quét TẤT CẢ lô thật "Dở dang" của nhà máy (không giới hạn theo 1 series cụ thể — mỗi lô
// đã tự mang theo loai_csr/loai_banh riêng) để tính KL (kg) "có chủ nhưng chưa sản xuất" của
// từng ngăn: phần còn thiếu của các kiện dở dang MỘT PHẦN (vd kiện C=12/36, phần 24 bành còn
// lại coi như đã có chủ của đúng ngăn đã sản xuất 12 bành đầu — ngăn đó không còn đủ 24 bành
// dung lượng để nhận dự đoán mới, dù chưa có bản ghi lot_prediction_lots nào phản ánh điều
// này). Trước đây phần này chỉ được tính đúng 1 LẦN DUY NHẤT tại thời điểm "bridge" (tạo dòng
// lot_prediction_lots đại diện lô dở dang) rồi bị bỏ quên ở các lần gọi RPC sau — khiến ngăn
// gốc có thể bị tính dư dung lượng, dẫn tới đề xuất/tạo vượt quá capacity thật. Hàm này tính
// lại MỖI LẦN gọi, độc lập với việc đã "bridge" hay chưa, dùng thống nhất cho mọi nơi cần biết
// dung lượng ngăn: lọc ngăn khả dụng, preview, tạo dự đoán, và tỷ lệ lấp đầy hiển thị trên nhãn.
async function getReservedKgForPartialKien(factoryId: string): Promise<Record<string, number>> {
  const supabase = getSupabaseAdmin();
  const { data: dodangLots } = await supabase
    .from("lots")
    .select("id,loai_csr,loai_banh")
    .eq("factory_id", factoryId)
    .eq("trang_thai", "Dở dang");
  const reservedByNgan: Record<string, number> = {};
  for (const lot of dodangLots || []) {
    const cfg = getLoaiBanhConfig(lot.loai_csr, lot.loai_banh);
    const { data: txs } = await supabase
      .from("lot_transactions")
      .select("ngan_id,kien_a,kien_b,kien_c,kien_d,ngay_nhap,created_at")
      .eq("lot_id", lot.id)
      .order("ngay_nhap", { ascending: true })
      .order("created_at", { ascending: true });
    KIEN_LETTERS_LOWER.forEach((letter) => {
      let sum = 0;
      let originNganId: string | null = null;
      (txs || []).forEach((tx) => {
        const val = Number((tx as unknown as Record<string, number>)[`kien_${letter}`] || 0);
        if (val > 0) {
          sum += val;
          originNganId = tx.ngan_id;
        }
      });
      if (sum > 0 && sum < cfg.max_per_kien && originNganId) {
        const missingBanh = cfg.max_per_kien - sum;
        reservedByNgan[originNganId] = (reservedByNgan[originNganId] || 0) + missingBanh * Number(lot.loai_banh);
      }
    });
  }
  return reservedByNgan;
}

async function getNganReservedKg(factoryId: string, nganId: string): Promise<number> {
  const map = await getReservedKgForPartialKien(factoryId);
  return map[nganId] || 0;
}

// Phát hiện lô thật "Dở dang" cùng series (loai_csr+loai_banh+year) CHƯA từng được bridge
// vào lot_prediction_lots — dùng để RPC tự tạo dòng nối tiếp đúng kiện còn trống (vd kiện D).
// Xem .claude/rules/06-module-production.md mục "4.6".
async function findRealContinuationForSeries(
  factoryId: string,
  loaiCsr: string,
  loaiBanh: number,
  year: string,
  maxPerKien: number,
): Promise<RealContinuation | null> {
  const supabase = getSupabaseAdmin();
  const { data: realLot } = await supabase
    .from("lots")
    .select("id,ma_lo,num")
    .eq("factory_id", factoryId)
    .eq("loai_csr", loaiCsr)
    .eq("loai_banh", loaiBanh)
    .eq("year", year)
    .eq("trang_thai", "Dở dang")
    .order("num", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!realLot) return null;

  // Đã từng bridge chưa? Nếu có row (pending hoặc đã resolve), không cần bridge lại —
  // Path A (pendingCarryLot) hoặc MAX(num) fallback đã tự xử lý đúng.
  const { data: existingBridge } = await supabase
    .from("lot_prediction_lots")
    .select("id")
    .eq("factory_id", factoryId)
    .eq("ma_lo", realLot.ma_lo)
    .maybeSingle();
  if (existingBridge) return null;

  const { data: txs } = await supabase
    .from("lot_transactions")
    .select("ngan_id,ngay_nhap,kien_a,kien_b,kien_c,kien_d,created_at")
    .eq("lot_id", realLot.id)
    .order("ngay_nhap", { ascending: true })
    .order("created_at", { ascending: true });

  const kienInfo: KienFillInfo[] = KIEN_LETTERS_LOWER.map((letter) => {
    let sum = 0;
    let originNganId: string | null = null;
    (txs || []).forEach((tx) => {
      const val = Number((tx as unknown as Record<string, number>)[`kien_${letter}`] || 0);
      if (val > 0) {
        sum += val;
        originNganId = tx.ngan_id;
      }
    });
    const status: KienFillInfo["status"] = sum <= 0 ? "empty" : sum >= maxPerKien ? "full" : "partial";
    return { letter, realCount: sum, originNganId, status };
  });

  const unassignableLetters = kienInfo.filter((k) => k.status !== "empty").map((k) => k.letter);
  const openLetters = kienInfo.filter((k) => k.status === "empty").map((k) => k.letter);

  return { maLo: realLot.ma_lo, num: realLot.num, unassignableLetters, openLetters };
}

export type PendingCarryLot = {
  id: string;
  ma_lo: string;
  num: number;
  kien_a_ngan_id: string | null;
  kien_b_ngan_id: string | null;
  kien_c_ngan_id: string | null;
  kien_d_ngan_id: string | null;
  // Kiện đã có thật ngoài đời (không qua dự đoán) — không được tính vào số kiện "sẽ tiếp tục".
  // Dùng bởi countPendingCarryOpenKien() để ước tính đúng KL cộng thêm vào preview % khi người
  // dùng chọn "Tiếp tục lô dở dang". Xem .claude/rules/06-module-production.md mục "Cập nhật 2026-07-21".
  unassignable_kien: string[];
};

export async function findPendingCarryLot(
  factoryId: string,
  loaiCsr: string,
  loaiBanh: number,
  year: string,
): Promise<PendingCarryLot | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("lot_prediction_lots")
    .select("id,ma_lo,num,kien_a_ngan_id,kien_b_ngan_id,kien_c_ngan_id,kien_d_ngan_id,unassignable_kien")
    .eq("factory_id", factoryId)
    .eq("loai_csr", loaiCsr)
    .eq("loai_banh", loaiBanh)
    .eq("year", year)
    .eq("carry_over_status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PendingCarryLot) || null;
}

export type PredictPreviewInput = {
  factoryId: string;
  nganId: string;
  tongKho: number;
  loaiCsr: string;
  loaiBanh: number;
  // Số kiện sẽ được RPC gán cho ĐÚNG ngăn này nếu người dùng chọn "Tiếp tục lô dở dang" — cộng
  // thêm vào usedKg TRƯỚC khi tính availableKg, để preview % không còn bị hụt so với thực tế
  // sau khi tạo (bug đã xác nhận: preview cũ không biết gì về continuation, chỉ đúng lúc in
  // nhãn). Chỉ truyền non-zero cho ngăn tiêu thụ ĐẦU TIÊN — xem countPendingCarryOpenKien() và
  // .claude/rules/06-module-production.md mục "Cập nhật 2026-07-21".
  continuationKienCount?: number;
};

export type PredictPreview = {
  kienWeightKg: number;
  lotWeightKg: number;
  availableKg: number;
  suggestedLotCount: number;
};

export async function previewLotPrediction(
  input: PredictPreviewInput,
): Promise<PredictPreview> {
  const cfg = getLoaiBanhConfig(input.loaiCsr, input.loaiBanh);
  const kienW = calcKienWeightKg(cfg);
  const lotW = kienW * 4;
  const [existingRealKg, existingPredictedKg, reservedKg] = await Promise.all([
    getExistingRealKg(input.factoryId, input.nganId),
    getExistingPredictedKg(input.factoryId, input.nganId),
    getNganReservedKg(input.factoryId, input.nganId),
  ]);
  const capKg = Number(input.tongKho || 0) * 1.1;
  const continuationKg = (input.continuationKienCount || 0) * kienW;
  const usedKg = existingRealKg + existingPredictedKg + reservedKg + continuationKg;
  const availableKg = Math.max(0, capKg - usedKg);
  const suggestedLotCount = Math.floor(availableKg / lotW);
  return { kienWeightKg: kienW, lotWeightKg: lotW, availableKg, suggestedLotCount };
}

export type CreateLotPredictionBatchInput = {
  factoryId: string;
  nganId: string;
  dayChuyen: string;
  loaiCsr: string;
  loaiBanh: number;
  boc: string;
  tham: string;
  suffix: string;
  year: string;
  requestedLotCount: number | null;
  carryResolution: "continue" | "skip" | null;
  createdBy: string | null;
  // Override tường minh số kiện lẻ (0-3) của lô "đuôi" — null = tự động tối đa hóa (hành vi
  // cũ, dùng khi tạo nhiều ngăn cùng lúc). Chỉ set non-null khi UI cho chỉnh tay (đúng 1 ngăn).
  trailingKienCount: number | null;
  // true = đánh dấu ngăn này "đã dự kiến xong", loại khỏi loadPredictAvailableNgans các lần sau.
  closesNgan: boolean;
  // Override số lô bắt đầu khi KHÔNG nối tiếp lô dở dang (carryResolution="skip" hoặc không có
  // carry-over nào) — null = tự động MAX+1 (hành vi cũ). Chỉ có ý nghĩa ở nhánh fresh-start của
  // RPC; bị bỏ qua nếu đang continue/bridge 1 lô dở dang. Xem .claude/rules/06-module-production.md
  // mục "Cập nhật 2026-07-14".
  overrideStartNum: number | null;
};

export type CreateLotPredictionBatchResult =
  | {
      ok: true;
      batchId: string;
      suggestedLotCount: number;
      createdCount: number;
      nextNum: number;
      createdIds: string[];
      carryContinued: boolean;
    }
  | { ok: false; needsCarryDecision: true; pendingId: string; pendingMaLo: string }
  | { ok: false; needsCarryDecision: false; message: string };

export async function createLotPredictionBatch(
  input: CreateLotPredictionBatchInput,
): Promise<CreateLotPredictionBatchResult> {
  const supabase = getSupabaseAdmin();
  const cfg = getLoaiBanhConfig(input.loaiCsr, input.loaiBanh);
  const kienW = calcKienWeightKg(cfg);
  const [existingRealKg, reservedKg, continuation] = await Promise.all([
    getExistingRealKg(input.factoryId, input.nganId),
    getNganReservedKg(input.factoryId, input.nganId),
    findRealContinuationForSeries(
      input.factoryId,
      input.loaiCsr,
      input.loaiBanh,
      input.year,
      cfg.max_per_kien,
    ),
  ]);

  const { data, error } = await supabase.rpc("create_lot_prediction_batch", {
    p_factory_id: input.factoryId,
    p_ngan_id: input.nganId,
    p_day_chuyen: input.dayChuyen,
    p_loai_csr: input.loaiCsr,
    p_loai_banh: input.loaiBanh,
    p_boc: input.boc,
    p_tham: input.tham,
    p_suffix: input.suffix,
    p_year: input.year,
    p_kien_weight_kg: kienW,
    p_existing_real_kg: existingRealKg,
    p_requested_lot_count: input.requestedLotCount,
    p_carry_resolution: input.carryResolution,
    p_created_by: input.createdBy,
    p_reserved_kg: reservedKg,
    p_real_lot_ma_lo: continuation?.maLo ?? null,
    p_real_lot_num: continuation?.num ?? null,
    p_real_unassignable_kien: continuation?.unassignableLetters ?? null,
    p_requested_trailing_kien: input.trailingKienCount,
    p_closes_ngan: input.closesNgan,
    p_override_start_num: input.overrideStartNum,
  });

  if (error) {
    const match = /CARRY_PENDING:([0-9a-fA-F-]+):(.+)/.exec(error.message || "");
    if (match) {
      return { ok: false, needsCarryDecision: true, pendingId: match[1], pendingMaLo: match[2] };
    }
    return { ok: false, needsCarryDecision: false, message: error.message };
  }

  const result = data as {
    batch_id: string;
    suggested_lot_count: number;
    created_count: number;
    next_num: number;
    created_ids: string[];
    carry_continued: boolean;
  };
  return {
    ok: true,
    batchId: result.batch_id,
    suggestedLotCount: result.suggested_lot_count,
    createdCount: result.created_count,
    nextNum: result.next_num,
    createdIds: result.created_ids || [],
    carryContinued: !!result.carry_continued,
  };
}

export type CreateLotPredictionBatchMultiInput = Omit<CreateLotPredictionBatchInput, "nganId"> & {
  // Danh sách ngăn ĐÃ SẮP XẾP đúng thứ tự tiêu thụ (ngăn "Đang sản xuất" trước, rồi theo
  // thứ tự người dùng bấm chọn) — sắp xếp thực hiện ở page.tsx trước khi gọi hàm này.
  nganIds: string[];
};

export type CreateLotPredictionBatchMultiResult =
  | { ok: true; results: Array<CreateLotPredictionBatchResult & { ok: true }> }
  | {
      ok: false;
      completedResults: Array<CreateLotPredictionBatchResult & { ok: true }>;
      failedNganId: string;
      error: CreateLotPredictionBatchResult & { ok: false };
    }
  | { ok: false; emptyResult: true; message: string };

// Xóa (best-effort) các đợt vừa tạo trong CHÍNH request này nhưng không sinh ra bất kỳ dòng
// lot_prediction_lots nào (không lô mới, không leftover, không nối tiếp carry-over) — tránh
// để lại các dòng lịch sử rỗng "Đề xuất 0 lô" gây rối UI. Không cần isAdmin vì đây là dọn dẹp
// nội bộ của chính request vừa tạo ra chúng, không phải thao tác admin xóa dữ liệu người khác.
async function cleanupEmptyBatches(batchIds: string[]): Promise<void> {
  if (batchIds.length === 0) return;
  const supabase = getSupabaseAdmin();
  await supabase.from("lot_prediction_batches").delete().in("id", batchIds);
}

// Xử lý tuần tự nhiều ngăn trong 1 thao tác người dùng: dùng hết capacity ngăn 1 rồi mới
// sang ngăn 2 (gọi lại đúng RPC atomic 1-ngăn hiện có, không cần viết lại thuật toán SQL
// cho N ngăn) — carry-over PHÁT SINH TỪ CHÍNH thao tác này (leftover của ngăn trước trong
// cùng vòng lặp) tự động "continue", KHÔNG hỏi lại người dùng; chỉ ngăn ĐẦU TIÊN mới có thể
// gặp carry-over từ 1 phiên trước đó và cần hỏi người dùng (needsCarryDecision).
export async function createLotPredictionBatchMulti(
  input: CreateLotPredictionBatchMultiInput,
): Promise<CreateLotPredictionBatchMultiResult> {
  const results: Array<CreateLotPredictionBatchResult & { ok: true }> = [];
  let remainingCap = input.requestedLotCount;

  for (let i = 0; i < input.nganIds.length; i++) {
    const nganId = input.nganIds[i];
    const isFirst = i === 0;
    const result = await createLotPredictionBatch({
      ...input,
      nganId,
      requestedLotCount: remainingCap,
      carryResolution: isFirst ? input.carryResolution : "continue",
      // overrideStartNum chỉ có ý nghĩa cho ngăn ĐẦU TIÊN (đúng lúc chọn "bắt đầu lô mới") —
      // các ngăn sau trong cùng thao tác luôn tự "continue" nối tiếp, không có khái niệm bắt
      // đầu lại từ số khác.
      overrideStartNum: isFirst ? input.overrideStartNum : null,
    });
    if (!result.ok) {
      return { ok: false, completedResults: results, failedNganId: nganId, error: result };
    }
    results.push(result);
    if (remainingCap != null) {
      remainingCap = Math.max(0, remainingCap - result.createdCount);
      if (remainingCap === 0) break;
    }
  }

  // Nếu KHÔNG ngăn nào tạo được dù chỉ 1 dòng (lô đầy đủ, leftover một phần, hay nối tiếp
  // carry-over) — toàn bộ (các) ngăn đã chọn thực ra đã hết dung lượng dự đoán. Dọn ngay các
  // đợt rỗng vừa tạo và báo lỗi rõ ràng thay vì để UI hiện "thành công" với 0 lô, khiến nút
  // "In nhãn QR" sau đó không có gì để in và trông như không phản hồi.
  const totalCreatedRows = results.reduce((sum, r) => sum + r.createdIds.length, 0);
  const anyContinued = results.some((r) => r.carryContinued);
  if (totalCreatedRows === 0 && !anyContinued) {
    await cleanupEmptyBatches(results.map((r) => r.batchId));
    return {
      ok: false,
      emptyResult: true,
      message: "Ngăn đã chọn không còn đủ dung lượng để tạo thêm lô dự kiến nào (kể cả lô lẻ).",
    };
  }

  return { ok: true, results };
}

// Gợi ý số lô kế tiếp cho tính năng "bắt đầu lô mới" — mirror ĐÚNG công thức fallback MAX+1 của
// nhánh không-continue trong RPC (supabase/migrations/20260714_lot_prediction_fixes.sql, nhánh
// ELSE của "IF v_continue THEN ... ELSE ..."), để UI hiển thị gợi ý trước khi submit thật.
export async function suggestNextLotNum(
  factoryId: string,
  loaiCsr: string,
  loaiBanh: number,
  year: string,
): Promise<number> {
  const supabase = getSupabaseAdmin();
  const [lotsRes, predictionRes] = await Promise.all([
    supabase
      .from("lots")
      .select("num")
      .eq("factory_id", factoryId)
      .eq("loai_csr", loaiCsr)
      .eq("loai_banh", loaiBanh)
      .eq("year", year)
      .order("num", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("lot_prediction_lots")
      .select("num")
      .eq("factory_id", factoryId)
      .eq("loai_csr", loaiCsr)
      .eq("loai_banh", loaiBanh)
      .eq("year", year)
      .neq("carry_over_status", "abandoned")
      .order("num", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const maxLots = Number(lotsRes.data?.num || 0);
  const maxPrediction = Number(predictionRes.data?.num || 0);
  return Math.max(maxLots, maxPrediction) + 1;
}

// Kiểm tra trùng mã lô — dựng ma_lo ứng viên từ số + hậu tố + năm, kiểm tra tồn tại trong cả
// `lots` (lô thật) và `lot_prediction_lots` (lô dự kiến, loại abandoned) trong cùng factory.
// Dùng cho input "Số lô bắt đầu" (tính năng "bắt đầu lô mới") — validate live phía client trước
// khi submit; RPC vẫn validate lại lần nữa ở server để tránh race condition.
export async function checkLotNumTaken(
  factoryId: string,
  suffix: string,
  year: string,
  num: number,
): Promise<{ taken: boolean; maLo: string }> {
  const maLo = suffix ? `${num}${suffix}/${year}` : `${num}/${year}`;
  const supabase = getSupabaseAdmin();
  const [lotsRes, predictionRes] = await Promise.all([
    supabase.from("lots").select("id").eq("factory_id", factoryId).eq("ma_lo", maLo).maybeSingle(),
    supabase
      .from("lot_prediction_lots")
      .select("id")
      .eq("factory_id", factoryId)
      .eq("ma_lo", maLo)
      .neq("carry_over_status", "abandoned")
      .maybeSingle(),
  ]);
  return { taken: !!lotsRes.data || !!predictionRes.data, maLo };
}

// Lưu URL PDF (nhãn nhỏ/lớn) vừa render lên lot_prediction_batches — dùng cho icon "mở lại PDF
// đã lưu" (không render lại). Xem .claude/rules/06-module-production.md mục "Cập nhật 2026-07-14".
export async function updateBatchPdfUrl(
  factoryId: string,
  batchId: string,
  size: "small" | "large",
  url: string,
): Promise<{ ok: boolean; message?: string }> {
  const supabase = getSupabaseAdmin();
  const payload =
    size === "small"
      ? { pdf_small_url: url, pdf_small_generated_at: new Date().toISOString() }
      : { pdf_large_url: url, pdf_large_generated_at: new Date().toISOString() };
  const { error } = await supabase
    .from("lot_prediction_batches")
    .update(payload)
    .eq("id", batchId)
    .eq("factory_id", factoryId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export type PredictionBatchRow = {
  id: string;
  ngan_id: string;
  day_chuyen: string | null;
  loai_csr: string;
  loai_banh: number;
  boc: string | null;
  tham: string | null;
  suggested_lot_count: number;
  requested_lot_count: number | null;
  status: string;
  created_at: string;
  // PDF đã render gần nhất cho đợt này (icon "mở lại PDF đã lưu", không render lại) — xem
  // .claude/rules/06-module-production.md mục "Cập nhật 2026-07-14".
  pdf_small_url: string | null;
  pdf_small_generated_at: string | null;
  pdf_large_url: string | null;
  pdf_large_generated_at: string | null;
  ngans?: { ma_ngan: string; ten_ngan: string } | null;
};

export async function loadPredictionBatches(
  factoryId: string,
): Promise<PredictionBatchRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("lot_prediction_batches")
    .select(
      "id,ngan_id,day_chuyen,loai_csr,loai_banh,boc,tham,suggested_lot_count,requested_lot_count,status,created_at,pdf_small_url,pdf_small_generated_at,pdf_large_url,pdf_large_generated_at,ngans(ma_ngan,ten_ngan)",
    )
    .eq("factory_id", factoryId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data || []) as unknown as PredictionBatchRow[];
}

export type PredictionLotRow = {
  id: string;
  ma_lo: string;
  num: number;
  suffix: string;
  year: string;
  loai_csr: string;
  loai_banh: number;
  boc: string | null;
  tham: string | null;
  kien_weight_kg: number;
  kien_a_ngan_id: string | null;
  kien_b_ngan_id: string | null;
  kien_c_ngan_id: string | null;
  kien_d_ngan_id: string | null;
  // Batch nào THỰC SỰ gán ngăn cho từng kiện — độc lập với origin_batch_id (batch tạo dòng)
  // vì 1 dòng có thể bị batch KHÁC "continue" thêm kiện sau này (xem migration
  // 20260714_lot_prediction_fixes.sql). Dùng để in đúng nhãn theo đúng batch, tránh bug
  // "batch continue thiếu kiện + batch gốc in lại lòi nhãn phantom".
  kien_a_batch_id: string | null;
  kien_b_batch_id: string | null;
  kien_c_batch_id: string | null;
  kien_d_batch_id: string | null;
  carry_over_status: string;
  trang_thai: string;
  real_lot_id: string | null;
  origin_batch_id: string;
};

const PREDICTION_LOT_COLUMNS =
  "id,ma_lo,num,suffix,year,loai_csr,loai_banh,boc,tham,kien_weight_kg,kien_a_ngan_id,kien_b_ngan_id,kien_c_ngan_id,kien_d_ngan_id,kien_a_batch_id,kien_b_batch_id,kien_c_batch_id,kien_d_batch_id,carry_over_status,trang_thai,real_lot_id,origin_batch_id";

export async function loadPredictionLotsForBatch(
  batchId: string,
): Promise<PredictionLotRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("lot_prediction_lots")
    .select(PREDICTION_LOT_COLUMNS)
    .eq("origin_batch_id", batchId)
    .order("num", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as PredictionLotRow[];
}

// Dùng riêng cho IN NHÃN — khác loadPredictionLotsForBatch (chỉ lọc origin_batch_id, dùng cho
// bảng admin xem/sửa theo đúng batch đã tạo dòng). Ở đây lấy TẤT CẢ dòng có LIÊN QUAN tới bất
// kỳ batch nào trong danh sách, dù dòng đó không do batch này tạo (vd batch N4 "continue" 1
// kiện của dòng do N5 tạo) — buildLabelItemsForBatches (predict/page.tsx) sau đó tự lọc từng
// KIỆN theo đúng kien_X_batch_id, không dùng cả dòng.
export async function loadPredictionLotsForPrint(
  batchIds: string[],
): Promise<PredictionLotRow[]> {
  if (batchIds.length === 0) return [];
  const supabase = getSupabaseAdmin();
  const idList = batchIds.join(",");
  const { data, error } = await supabase
    .from("lot_prediction_lots")
    .select(PREDICTION_LOT_COLUMNS)
    .or(
      `origin_batch_id.in.(${idList}),kien_a_batch_id.in.(${idList}),kien_b_batch_id.in.(${idList}),kien_c_batch_id.in.(${idList}),kien_d_batch_id.in.(${idList})`,
    )
    .order("num", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as PredictionLotRow[];
}

async function getNganFillPct(
  factoryId: string,
  nganId: string,
  tongKho: number,
  excludePredictionLotId?: string,
): Promise<number> {
  const [realKg, reservedKg, predictedKg] = await Promise.all([
    getExistingRealKg(factoryId, nganId),
    getNganReservedKg(factoryId, nganId),
    getExistingPredictedKg(factoryId, nganId, excludePredictionLotId ? [excludePredictionLotId] : []),
  ]);
  return tongKho > 0 ? ((realKg + predictedKg + reservedKg) / tongKho) * 100 : 0;
}

export type UpdatePredictionLotInput = {
  factoryId: string;
  predictionLotId: string;
  // string = gán ngăn mới; null = bỏ gán (xóa kiện khỏi ngăn hiện tại) — trước đây UI không
  // truyền được null nên không thể thực sự bỏ gán một kiện đã có ngăn.
  kienAssignments: Partial<Record<"kien_a_ngan_id" | "kien_b_ngan_id" | "kien_c_ngan_id" | "kien_d_ngan_id", string | null>>;
  loaiCsr?: string;
  loaiBanh?: number;
  boc?: string;
  tham?: string;
  isAdmin: boolean;
};

export type UpdatePredictionLotResult = { ok: true } | { ok: false; message: string };

export async function updatePredictionLot(
  input: UpdatePredictionLotInput,
): Promise<UpdatePredictionLotResult> {
  const supabase = getSupabaseAdmin();
  const { data: current, error: loadError } = await supabase
    .from("lot_prediction_lots")
    .select(
      "id,trang_thai,real_lot_id,kien_a_ngan_id,kien_b_ngan_id,kien_c_ngan_id,kien_d_ngan_id,unassignable_kien,carry_over_status,origin_batch_id,kien_weight_kg",
    )
    .eq("id", input.predictionLotId)
    .eq("factory_id", input.factoryId)
    .maybeSingle();
  if (loadError) return { ok: false, message: loadError.message };
  if (!current) return { ok: false, message: "Không tìm thấy lô dự kiến." };
  if (current.trang_thai === "Đã dùng" && !input.isAdmin) {
    return { ok: false, message: "Lô đã được dùng, chỉ admin mới được sửa." };
  }

  const kienKeysAll = ["kien_a_ngan_id", "kien_b_ngan_id", "kien_c_ngan_id", "kien_d_ngan_id"] as const;

  // Validate tỷ lệ lấp đầy của ngăn đích cho từng ngăn xuất hiện trong lần sửa này — chặn khi
  // vượt 110%. Trước đây getNganFillPct() loại TOÀN BỘ dòng đang sửa ra khỏi predictedKg rồi
  // check `pct > 110` mà KHÔNG cộng lại phần đóng góp MỚI của chính dòng này sau khi áp dụng
  // kienAssignments — nên gán nhiều kiện cùng lúc vào 1 ngăn gần đầy có thể lọt qua 110% (bug
  // đã xác nhận, xem .claude/rules/06-module-production.md mục "Cập nhật 2026-07-14").
  const affectedNganIds = new Set(Object.values(input.kienAssignments).filter((v): v is string => !!v));
  for (const nganId of affectedNganIds) {
    const { data: ngan } = await supabase
      .from("ngans")
      .select("tong_kho")
      .eq("id", nganId)
      .maybeSingle();
    if (!ngan) continue;
    const pctOthers = await getNganFillPct(
      input.factoryId,
      nganId,
      Number(ngan.tong_kho || 0),
      input.predictionLotId,
    );
    // Số kiện của CHÍNH dòng đang sửa sẽ trỏ về nganId SAU khi áp dụng thay đổi
    const thisRowKienCount = kienKeysAll.reduce((count, key) => {
      const mergedValue = key in input.kienAssignments ? input.kienAssignments[key] : current[key];
      return mergedValue === nganId ? count + 1 : count;
    }, 0);
    const tongKho = Number(ngan.tong_kho || 0);
    const addedPct = tongKho > 0 ? ((thisRowKienCount * Number(current.kien_weight_kg || 0)) / tongKho) * 100 : 0;
    const pct = pctOthers + addedPct;
    if (pct > 110) {
      return { ok: false, message: `Ngăn sẽ vượt quá 110% (dự kiến ${pct.toFixed(1)}%). Không thể lưu.` };
    }
  }

  const updatePayload: Record<string, unknown> = { ...input.kienAssignments };
  // Đồng bộ kien_X_batch_id theo đúng kien_X_ngan_id vừa đổi — gán mới thì attribute cho
  // origin_batch_id của chính dòng này (đang sửa trong panel của batch nào thì batch đó nhận
  // ghi công); bỏ gán (null) thì batch_id cũng về null.
  for (const key of Object.keys(input.kienAssignments) as (keyof typeof input.kienAssignments)[]) {
    const value = input.kienAssignments[key];
    const batchKey = key.replace("_ngan_id", "_batch_id");
    updatePayload[batchKey] = value ? current.origin_batch_id : null;
  }
  if (input.loaiCsr) updatePayload.loai_csr = input.loaiCsr;
  if (input.loaiBanh) updatePayload.loai_banh = input.loaiBanh;
  if (input.boc !== undefined) updatePayload.boc = input.boc;
  if (input.tham !== undefined) updatePayload.tham = input.tham;

  // Tự động đồng bộ carry_over_status theo mức độ hoàn thiện của 4 kiện SAU khi áp dụng thay
  // đổi — chỉ áp dụng cho lô CHƯA thực sự dùng (real_lot_id IS NULL); lô đã dùng không đụng.
  // Thiếu ít nhất 1 kiện (và kiện đó chưa nằm trong unassignable_kien — tức không phải kiện
  // đã có thật ngoài đời qua bridge) → 'pending', để findPendingCarryLot gợi ý "tiếp tục lô
  // dở dang" ở lần tạo dự đoán kế tiếp cùng series. Đủ cả 4 → 'none' (không còn gì để tiếp
  // tục). Xem .claude/rules/06-module-production.md mục "4.6".
  if (!current.real_lot_id) {
    const kienKeys = ["kien_a_ngan_id", "kien_b_ngan_id", "kien_c_ngan_id", "kien_d_ngan_id"] as const;
    const kienLetters = ["a", "b", "c", "d"] as const;
    const unassignable = new Set((current.unassignable_kien as string[] | null) || []);
    const allFilled = kienKeys.every((key, i) => {
      const mergedValue = key in input.kienAssignments ? input.kienAssignments[key] : current[key];
      return !!mergedValue || unassignable.has(kienLetters[i]);
    });
    const nextStatus = allFilled ? "none" : "pending";
    if (nextStatus !== current.carry_over_status) {
      updatePayload.carry_over_status = nextStatus;
    }
  }

  const { error } = await supabase
    .from("lot_prediction_lots")
    .update(updatePayload)
    .eq("id", input.predictionLotId)
    .eq("factory_id", input.factoryId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function cancelPredictionLot(
  factoryId: string,
  predictionLotId: string,
  isAdmin: boolean,
): Promise<{ ok: boolean; message?: string }> {
  // Chỉ admin được hủy dự đoán (đã chốt nghiệp vụ) — kiểm tra ở tầng server action, không
  // chỉ ẩn nút ở UI, để tránh gọi thẳng action này bỏ qua giao diện.
  if (!isAdmin) return { ok: false, message: "Chỉ admin mới được hủy dự đoán." };
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("lot_prediction_lots")
    .update({ trang_thai: "Hủy" })
    .eq("id", predictionLotId)
    .eq("factory_id", factoryId)
    .is("real_lot_id", null);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export type ClosedNgan = { id: string; ma_ngan: string; ten_ngan: string };

// Danh sách ngăn đang bị "đóng dự kiến" (có ít nhất 1 batch với closes_ngan=true) — dùng để
// hiển thị panel "Ngăn đã đóng dự kiến" ở tab Lịch sử, cho phép mở lại.
export async function loadClosedNgans(factoryId: string): Promise<ClosedNgan[]> {
  const supabase = getSupabaseAdmin();
  const { data: closedRows, error: closedErr } = await supabase
    .from("lot_prediction_batches")
    .select("ngan_id")
    .eq("factory_id", factoryId)
    .eq("closes_ngan", true);
  if (closedErr) throw new Error(closedErr.message);
  const nganIds = Array.from(new Set((closedRows || []).map((r) => r.ngan_id)));
  if (nganIds.length === 0) return [];
  const { data, error } = await supabase
    .from("ngans")
    .select("id,ma_ngan,ten_ngan")
    .in("id", nganIds)
    .order("ma_ngan", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as ClosedNgan[];
}

// Mở lại 1 ngăn đã bị đóng dự kiến — hạ toàn bộ closes_ngan=true về false cho ngăn đó, để
// ngăn xuất hiện lại trong loadPredictAvailableNgans. Không cần isAdmin — thao tác này không
// phá hủy dữ liệu, chỉ mở lại gợi ý, guard theo quyền product.predict_manage ở UI.
export async function reopenNganPrediction(
  factoryId: string,
  nganId: string,
): Promise<{ ok: boolean; message?: string }> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("lot_prediction_batches")
    .update({ closes_ngan: false })
    .eq("factory_id", factoryId)
    .eq("ngan_id", nganId)
    .eq("closes_ngan", true);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export type NganCumulativeBaseline = {
  id: string;
  ma_ngan: string;
  ten_ngan: string;
  tongKho: number;
  // KL (kg) "nền" của ngăn — mọi thứ tính vào tỷ lệ NGOẠI TRỪ các kiện nằm trong chính đợt in
  // hiện tại (real production đã có + dự kiến từ batch KHÁC + KL "có chủ" của kiện dở dang một
  // phần từ lô Dở dang khác). Dùng làm điểm bắt đầu để cộng dồn % LŨY KẾ theo từng kiện khi in
  // nhãn — xem buildLabelItemsFromLots ở predict/page.tsx.
  baselineKg: number;
};

// Lấy mã/tên/tong_kho + baselineKg theo danh sách ngăn, LOẠI TRỪ các lô dự kiến nằm trong
// excludePredictionLotIds (chính là các lô đang được in trong đợt này) khỏi phần "predicted"
// — nhờ vậy caller có thể tự cộng dồn % lũy kế đúng theo thứ tự từng kiện thay vì áp 1 con số
// tổng cào bằng cho mọi kiện. Thay thế hoàn toàn loadNganLabelInfoWithFill cũ (không còn call
// site nào khác dùng hàm đó).
export async function loadNganCumulativeBaselines(
  factoryId: string,
  nganIds: string[],
  excludePredictionLotIds: string[],
): Promise<Record<string, NganCumulativeBaseline>> {
  if (nganIds.length === 0) return {};
  const supabase = getSupabaseAdmin();
  const uniqueIds = Array.from(new Set(nganIds));
  const { data, error } = await supabase
    .from("ngans")
    .select("id,ma_ngan,ten_ngan,tong_kho")
    .in("id", uniqueIds);
  if (error) throw new Error(error.message);
  const reservedMap = await getReservedKgForPartialKien(factoryId);
  const map: Record<string, NganCumulativeBaseline> = {};
  await Promise.all(
    (data || []).map(async (n) => {
      const [realKg, predictedKg] = await Promise.all([
        getExistingRealKg(factoryId, n.id),
        getExistingPredictedKg(factoryId, n.id, excludePredictionLotIds),
      ]);
      const reservedKg = reservedMap[n.id] || 0;
      map[n.id] = {
        id: n.id,
        ma_ngan: n.ma_ngan,
        ten_ngan: n.ten_ngan,
        tongKho: Number(n.tong_kho || 0),
        baselineKg: realKg + predictedKg + reservedKg,
      };
    }),
  );
  return map;
}

export type DeletePredictionBatchResult = { ok: true } | { ok: false; message: string };

const KIEN_NGAN_KEYS = ["kien_a_ngan_id", "kien_b_ngan_id", "kien_c_ngan_id", "kien_d_ngan_id"] as const;
const KIEN_BATCH_KEYS = ["kien_a_batch_id", "kien_b_batch_id", "kien_c_batch_id", "kien_d_batch_id"] as const;
const KIEN_LETTERS_FOR_UNASSIGNABLE = ["a", "b", "c", "d"] as const;

// Xóa 1 đợt dự đoán (admin only). Chỉ cho phép khi TẤT CẢ lô THỰC SỰ liên quan tới đợt này —
// cả lô do chính đợt tạo (origin_batch_id = batchId) LẪN lô do đợt khác tạo nhưng có kiện được
// đợt này "nối tiếp" (kien_X_batch_id = batchId, xem migration 20260714_lot_prediction_fixes.sql)
// — chưa được dùng thực tế (real_lot_id IS NULL). Với nhóm thứ 2 (nối tiếp từ đợt khác), xóa
// đợt này phải HOÀN TÁC đúng phần kiện mà đợt này đã gán (trả kien_X_ngan_id/kien_X_batch_id về
// NULL, tính lại carry_over_status) — không được xóa cả dòng (dòng đó thuộc đợt khác).
export async function deletePredictionBatch(
  factoryId: string,
  batchId: string,
  isAdmin: boolean,
): Promise<DeletePredictionBatchResult> {
  if (!isAdmin) return { ok: false, message: "Chỉ admin mới được xóa đợt dự đoán." };
  const supabase = getSupabaseAdmin();

  const { data: batch, error: batchErr } = await supabase
    .from("lot_prediction_batches")
    .select("id")
    .eq("id", batchId)
    .eq("factory_id", factoryId)
    .maybeSingle();
  if (batchErr) return { ok: false, message: batchErr.message };
  if (!batch) return { ok: false, message: "Không tìm thấy đợt dự đoán." };

  const { data: ownLots, error: ownErr } = await supabase
    .from("lot_prediction_lots")
    .select("id,real_lot_id,origin_batch_id")
    .eq("origin_batch_id", batchId);
  if (ownErr) return { ok: false, message: ownErr.message };
  if ((ownLots || []).some((l) => l.real_lot_id)) {
    return { ok: false, message: "Đợt này có lô đã được dùng thực tế, không thể xóa." };
  }

  const { data: kienTouchedLots, error: kienTouchedErr } = await supabase
    .from("lot_prediction_lots")
    .select(
      "id,real_lot_id,origin_batch_id,unassignable_kien,carry_over_status,kien_a_ngan_id,kien_b_ngan_id,kien_c_ngan_id,kien_d_ngan_id,kien_a_batch_id,kien_b_batch_id,kien_c_batch_id,kien_d_batch_id",
    )
    .neq("origin_batch_id", batchId)
    .or(
      `kien_a_batch_id.eq.${batchId},kien_b_batch_id.eq.${batchId},kien_c_batch_id.eq.${batchId},kien_d_batch_id.eq.${batchId}`,
    );
  if (kienTouchedErr) return { ok: false, message: kienTouchedErr.message };
  if ((kienTouchedLots || []).some((l) => l.real_lot_id)) {
    return {
      ok: false,
      message: "Đợt này đã có kiện được dùng thực tế qua một lô liên kết (nối tiếp từ đợt khác), không thể xóa.",
    };
  }

  for (const lot of kienTouchedLots || []) {
    const revertPayload: Record<string, unknown> = { last_batch_id: lot.origin_batch_id };
    const unassignable = new Set((lot.unassignable_kien as string[] | null) || []);
    KIEN_NGAN_KEYS.forEach((nganKey, i) => {
      const batchKey = KIEN_BATCH_KEYS[i];
      if ((lot as Record<string, unknown>)[batchKey] === batchId) {
        revertPayload[nganKey] = null;
        revertPayload[batchKey] = null;
      }
    });
    const allFilledAfterRevert = KIEN_NGAN_KEYS.every((nganKey, i) => {
      const letter = KIEN_LETTERS_FOR_UNASSIGNABLE[i];
      const value = nganKey in revertPayload ? revertPayload[nganKey] : (lot as Record<string, unknown>)[nganKey];
      return !!value || unassignable.has(letter);
    });
    revertPayload.carry_over_status = allFilledAfterRevert ? "none" : "pending";
    const { error: revertErr } = await supabase
      .from("lot_prediction_lots")
      .update(revertPayload)
      .eq("id", lot.id);
    if (revertErr) return { ok: false, message: revertErr.message };
  }

  // Heal FK-safety còn sót cho dữ liệu cũ trước migration này (last_batch_id trỏ vào batchId
  // nhưng không dòng nào trong kienTouchedLots phản ánh, hiếm gặp) — last_batch_id không được
  // đọc ở bất kỳ đâu trong code nên chỉ cần đảm bảo không trỏ vào batch sắp bị xóa.
  const kienTouchedIds = new Set((kienTouchedLots || []).map((l) => l.id));
  const { data: staleLastBatchLots, error: staleErr } = await supabase
    .from("lot_prediction_lots")
    .select("id,origin_batch_id")
    .eq("last_batch_id", batchId)
    .neq("origin_batch_id", batchId);
  if (staleErr) return { ok: false, message: staleErr.message };
  for (const lot of staleLastBatchLots || []) {
    if (kienTouchedIds.has(lot.id)) continue;
    const { error: healErr } = await supabase
      .from("lot_prediction_lots")
      .update({ last_batch_id: lot.origin_batch_id })
      .eq("id", lot.id);
    if (healErr) return { ok: false, message: healErr.message };
  }

  if ((ownLots || []).length > 0) {
    const { error: delLotsErr } = await supabase
      .from("lot_prediction_lots")
      .delete()
      .eq("origin_batch_id", batchId);
    if (delLotsErr) return { ok: false, message: delLotsErr.message };
  }

  const { error: delBatchErr } = await supabase
    .from("lot_prediction_batches")
    .delete()
    .eq("id", batchId)
    .eq("factory_id", factoryId);
  if (delBatchErr) return { ok: false, message: delBatchErr.message };

  return { ok: true };
}

export async function markLotPredictionRealized(
  factoryId: string,
  maLo: string,
  realLotId: string,
): Promise<{ ok: boolean; message?: string }> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("lot_prediction_lots")
    .update({ real_lot_id: realLotId, trang_thai: "Đã dùng" })
    .eq("factory_id", factoryId)
    .eq("ma_lo", maLo);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
