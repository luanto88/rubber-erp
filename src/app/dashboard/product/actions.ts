"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  normalizeLotStatus,
  pickCanonicalLot,
} from "@/app/dashboard/product/shared";
import { assertShiftNotLocked } from "@/app/dashboard/product/shift-lock";
import {
  assertProductAccess,
  assertProductAdmin,
  PRODUCT_CREATE_PERMISSIONS,
} from "@/app/dashboard/product/confirm/report-access";
import { getBocsForLoaiCSR, getLoaiBanhConfig } from "@/lib/product-lot-config";
import {
  applyTxToKienBoc,
  applyTxToKienPallet,
  kienBocOf,
  kienPalletOf,
  type KienBoc,
  type KienPallet,
} from "@/lib/lot-kien-boc";

type SaveLotTransactionInput = {
  lot: {
    factory_id: string;
    ma_lo: string;
    ngay_sx: string;
    ca: string;
    loai_csr: string;
    loai_banh: number;
    num?: number;
    suffix?: string;
    year?: string;
    ngan_id?: string | null;
    day_chuyen?: string | null;
    boc?: string | null;
    tham?: string | null;
    pallet?: string[] | null;
    chi_thi?: string | null;
    ghi_chu?: string | null;
    image_url_1?: string | null;
    image_url_2?: string | null;
    image_code_1?: string | null;
    image_code_2?: string | null;
    trang_thai?: string | null;
  };
  transaction: {
    id?: string;
    ngan_id: string;
    ca: string;
    ngay_nhap: string;
    kien_a?: number;
    kien_b?: number;
    kien_c?: number;
    kien_d?: number;
    so_banh: number;
    so_kg: number;
    created_by?: string | null;
    // Snapshot bọc/pallet/số chỉ thị CỦA ĐÚNG GIAO DỊCH NÀY — chỉ tính năng "Xác nhận sản xuất
    // qua QR" (confirm/page.tsx) gửi các trường này; product/page.tsx (nhập tay) không gửi, để
    // undefined/null — syncLotMasterSnapshot() sẽ bỏ qua các dòng null khi suy giá trị mới nhất,
    // không ghi đè nhầm boc/pallet/chi_thi của lô.
    boc?: string | null;
    pallet?: string[] | null;
    chi_thi?: string | null;
  };
  // Access token Supabase của người thao tác — server tự xác thực (không tin userId client khai),
  // dùng để kiểm quyền tạo thành phẩm + "Khóa ca sản xuất" (admin bypass).
  accessToken: string | null;
};

type DeleteLotTransactionInput = {
  transactionId: string;
  factoryId: string;
  // GĐ4: xóa giao dịch ĐÃ GỬI chỉ admin — server tự xác thực token.
  accessToken: string | null;
};

function logProductActionError(
  action: string,
  context: Record<string, unknown>,
  error: unknown,
) {
  const details =
    error instanceof Error
      ? {
          message: error.message,
          digest: (error as Error & { digest?: string }).digest,
          stack: error.stack,
        }
      : { message: String(error) };

  console.error(`[product/actions] ${action} failed`, {
    ...context,
    ...details,
  });
}

function parseLotCode(maLo: string) {
  const normalized = maLo.trim().toLowerCase();
  const match = normalized.match(/^(\d+)([a-z]*)\/(\d{2,4})$/i);
  if (!match) throw new Error(`Ma lo khong dung dinh dang: ${maLo}`);
  const [, num, suffix, year] = match;
  return { num: Number(num), suffix: suffix || "", year };
}

function revalidateLotScreens() {
  revalidatePath("/dashboard/product");
}

// Trước đây hàm này tự đọc toàn bộ lot_transactions rồi tính tổng ở JS và ghi đè lots — không
// có khóa nào giữa bước đọc và ghi, gây race condition (lost update) khi 2 kiện của CÙNG 1 lô
// được xác nhận gần như đồng thời (rất dễ xảy ra với tính năng "Xác nhận sản xuất qua QR" —
// quét liên tục, có thể nhiều điện thoại quét song song). Đã phát hiện thực tế 2026-07-12: nhiều
// lô "Dở dang" có kien_a/b/c/d đúng nhưng tong_banh = 0 dù không có lỗi hiển thị cho người dùng.
//
// Fix: chuyển toàn bộ phép tính SUM + ghi lots thành 1 hàm Postgres atomic
// (sync_lot_master_snapshot, migration 20260712_sync_lot_master_snapshot_rpc.sql), khóa dòng
// lots bằng FOR UPDATE trước khi tính — loại bỏ hoàn toàn khoảng hở đọc-tính-ghi.
//
// Tối ưu 2026-07-15 (migration 20260715_sync_lot_master_snapshot_returns_row.sql): RPC giờ
// RETURNS TABLE và trả thẳng snapshot ngay trong cùng lệnh gọi — bỏ hẳn round-trip SELECT lots
// theo sau (trước đây luôn là 2 round-trip riêng biệt cho mỗi lần lưu/sửa/xóa giao dịch thành
// phẩm, quan trọng nhất với luồng quét QR liên tục).
async function syncLotMasterSnapshot(lotId: string) {
  const supabase = getSupabaseAdmin();

  const { data, error: rpcError } = await supabase.rpc("sync_lot_master_snapshot", { p_lot_id: lotId });
  if (rpcError) throw new Error(`Khong dong bo duoc lo: ${rpcError.message}`);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Khong dong bo duoc lo: RPC khong tra ve du lieu.");

  return { ...row, lotId };
}

export async function saveLotTransaction(input: SaveLotTransactionInput) {
  const { lot, transaction } = input;
  const maLo = lot.ma_lo.trim();

  try {
    const supabase = getSupabaseAdmin();
    if (!maLo) throw new Error("Thieu ma lo.");
    // GĐ4: hàm này CHỈ còn tạo giao dịch mới. Sửa giao dịch đã gửi đi qua adminUpdateLotTransaction
    // (RPC atomic, kiểm khóa ca cả nguồn lẫn đích, đồng bộ dự đoán/nháp, ghi nhật ký).
    if (transaction.id) {
      throw new Error("Giao dịch đã gửi chỉ được sửa qua chức năng Sửa của admin.");
    }

    const actorUserId = await assertProductAccess(
      input.accessToken,
      lot.factory_id,
      PRODUCT_CREATE_PERMISSIONS,
      "tạo thành phẩm",
    );
    const { data: actorProfile } = await supabase.from("profiles").select("role").eq("id", actorUserId).maybeSingle();
    const actorIsAdmin = actorProfile?.role === "admin";

    await assertShiftNotLocked({
      factoryId: lot.factory_id,
      ngaySx: transaction.ngay_nhap,
      ca: transaction.ca,
      actorUserId,
    });

    const parsedLotCode = parseLotCode(maLo);
    const kienA = transaction.kien_a ?? 0;
    const kienB = transaction.kien_b ?? 0;
    const kienC = transaction.kien_c ?? 0;
    const kienD = transaction.kien_d ?? 0;

    const { data: matchingLots, error: findLotError } = await supabase
      .from("lots")
      .select("id, factory_id, ma_lo, trang_thai, tong_banh, created_at, updated_at, loai_csr, loai_banh, boc")
      .eq("factory_id", lot.factory_id)
      .eq("ma_lo", maLo);

    if (findLotError) throw new Error(`Khong tim duoc lo ${maLo}: ${findLotError.message}`);

    const existingLot =
      matchingLots && matchingLots.length > 0
        ? pickCanonicalLot(
            matchingLots.map((item) => ({
              ...item,
              trang_thai: normalizeLotStatus(item.trang_thai),
            })),
          )
        : null;

    let lotId = existingLot?.id;

    if (!existingLot) {
      const { data: insertedLot, error: insertLotError } = await supabase
        .from("lots")
        .insert({
          factory_id: lot.factory_id,
          ma_lo: maLo,
          num: lot.num ?? parsedLotCode.num,
          suffix: lot.suffix ?? parsedLotCode.suffix,
          year: lot.year ?? parsedLotCode.year,
          ngay_sx: lot.ngay_sx,
          ca: lot.ca,
          ngan_id: lot.ngan_id ?? transaction.ngan_id,
          loai_csr: lot.loai_csr,
          loai_banh: lot.loai_banh,
          tong_banh: 0,
          tong_kg: 0,
          trang_thai: "Dở dang",
          ghi_chu: lot.ghi_chu ?? "",
          ...(lot.day_chuyen !== undefined ? { day_chuyen: lot.day_chuyen } : {}),
          ...(lot.boc !== undefined ? { boc: lot.boc } : {}),
          ...(lot.tham !== undefined ? { tham: lot.tham } : {}),
          ...(lot.pallet !== undefined ? { pallet: lot.pallet } : {}),
          ...(lot.chi_thi !== undefined ? { chi_thi: lot.chi_thi } : {}),
          ...(lot.image_url_1 !== undefined ? { image_url_1: lot.image_url_1 } : {}),
          ...(lot.image_url_2 !== undefined ? { image_url_2: lot.image_url_2 } : {}),
          ...(lot.image_code_1 !== undefined ? { image_code_1: lot.image_code_1 } : {}),
          ...(lot.image_code_2 !== undefined ? { image_code_2: lot.image_code_2 } : {}),
        })
        .select("id")
        .single();

      if (insertLotError || !insertedLot) {
        throw new Error(`Khong tao duoc lo ${maLo}: ${insertLotError?.message}`);
      }
      lotId = insertedLot.id;
    } else {
      const normalizedStatus = normalizeLotStatus(existingLot.trang_thai);
      {
        if (normalizedStatus !== "Dở dang") {
          throw new Error(
            `Lo ${maLo} dang o trang thai "${existingLot.trang_thai}", khong the nhap them giao dich.`,
          );
        }
        // Kiểm tra tính đồng nhất của lô: Cùng 1 lô, tất cả kiện phải cùng Chủng loại, Loại bọc, Loại bành
        if (existingLot.loai_csr && lot.loai_csr && existingLot.loai_csr !== lot.loai_csr) {
          throw new Error(
            `Cùng lô ${maLo} không thể khác Chủng loại (đã có: "${existingLot.loai_csr}", đang nhập: "${lot.loai_csr}").`,
          );
        }
        if (
          existingLot.loai_banh &&
          lot.loai_banh &&
          Number(existingLot.loai_banh) !== Number(lot.loai_banh)
        ) {
          throw new Error(
            `Cùng lô ${maLo} không thể khác Loại bành (đã có: ${existingLot.loai_banh}kg, đang nhập: ${lot.loai_banh}kg).`,
          );
        }
        const effectiveBoc = transaction.boc || lot.boc;
        if (existingLot.boc && effectiveBoc && existingLot.boc !== effectiveBoc) {
          throw new Error(
            `Cùng lô ${maLo} không thể khác Loại bọc (đã có: "${existingLot.boc}", đang nhập: "${effectiveBoc}").`,
          );
        }
      }
    }

    const effectiveBoc = transaction.boc ?? lot.boc;
    const { data: savedTransaction, error: saveTransactionError } = await supabase
      .from("lot_transactions")
      .insert(
        {
          lot_id: lotId,
          ngan_id: transaction.ngan_id,
          ca: transaction.ca,
          ngay_nhap: transaction.ngay_nhap,
          kien_a: kienA,
          kien_b: kienB,
          kien_c: kienC,
          kien_d: kienD,
          so_banh: transaction.so_banh,
          so_kg: transaction.so_kg,
          ...(transaction.created_by ? { created_by: transaction.created_by } : {}),
          ...(effectiveBoc !== undefined ? { boc: effectiveBoc } : {}),
          ...(transaction.pallet !== undefined ? { pallet: transaction.pallet } : lot.pallet !== undefined ? { pallet: lot.pallet } : {}),
          ...(transaction.chi_thi !== undefined ? { chi_thi: transaction.chi_thi } : lot.chi_thi !== undefined ? { chi_thi: lot.chi_thi } : {}),
        },
      )
      // created_at thêm vào select để caller (confirmKienProduction) không phải query lại
      // riêng chỉ để lấy đúng giá trị này (giảm 1 round-trip Supabase mỗi lần quét QR).
      .select("id, lot_id, ngan_id, so_banh, so_kg, created_at")
      .single();

    if (saveTransactionError) {
      throw new Error(`Khong luu duoc giao dich cua lo ${maLo}: ${saveTransactionError.message}`);
    }

    // Đảm bảo tất cả transactions của cùng lô được đồng bộ bọc đồng nhất với lô. GĐ7a: người
    // không phải admin KHÔNG được ghi vào giao dịch thuộc ca đã khóa (lan bọc từng là đường vượt
    // khóa ca) — chỉ lan cho các giao dịch ở ca chưa khóa.
    if (effectiveBoc) {
      let targetIds: string[] | null = null;
      if (!actorIsAdmin) {
        const [{ data: lotTxs }, { data: locks }] = await Promise.all([
          supabase.from("lot_transactions").select("id, ngay_nhap, ca").eq("lot_id", lotId),
          supabase
            .from("product_shift_locks")
            .select("ngay_sx, ca")
            .eq("factory_id", lot.factory_id)
            .eq("is_active", true),
        ]);
        const lockedKeys = new Set((locks || []).map((l) => `${l.ngay_sx}|${l.ca}`));
        targetIds = (lotTxs || [])
          .filter((tx) => !lockedKeys.has(`${tx.ngay_nhap}|${tx.ca}`))
          .map((tx) => tx.id as string);
      }
      if (targetIds === null) {
        await supabase.from("lot_transactions").update({ boc: effectiveBoc }).eq("lot_id", lotId);
      } else if (targetIds.length > 0) {
        await supabase.from("lot_transactions").update({ boc: effectiveBoc }).in("id", targetIds);
      }
    }

    const snapshot = await syncLotMasterSnapshot(lotId);
    revalidateLotScreens();
    return { success: true as const, lotId, snapshot, transaction: savedTransaction };
  } catch (error) {
    logProductActionError("saveLotTransaction", {
      factoryId: lot.factory_id,
      maLo,
      lotNganId: lot.ngan_id,
      transactionId: transaction.id,
      transactionNganId: transaction.ngan_id,
      ca: transaction.ca,
      ngayNhap: transaction.ngay_nhap,
      soBanh: transaction.so_banh,
      soKg: transaction.so_kg,
    }, error);
    // Tra ve loi da serialize thay vi throw — Next.js se thay message that
    // bang generic digest tren client neu throw truc tiep tu Server Action.
    return {
      success: false as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Trước đây hàm này làm 3 bước riêng biệt không atomic (xóa transaction -> đếm còn lại -> xóa
// lots nếu hết) — phát hiện bug thật 2026-07-13: nếu lô được tạo qua "Dự đoán số lô", bước xóa
// lots cuối cùng luôn thất bại vì vi phạm khóa ngoại `lot_prediction_lots.real_lot_id`, nhưng
// bước xóa transaction TRƯỚC ĐÓ đã commit rồi — để lại "lô ma": transaction đã mất, lots vẫn còn
// với tong_banh=0 (trigger cũ đã recompute) nhưng kien_a-d vẫn giữ giá trị cũ (trigger cũ không
// đụng tới), và mọi lần xóa lại sau đó lặp lại đúng lỗi cũ. Đã chuyển toàn bộ luồng vào RPC atomic
// `delete_lot_transaction` (migration 20260713_delete_lot_transaction_rpc.sql) — khóa lots FOR
// UPDATE, tự gỡ liên kết lot_prediction_lots trước khi xóa lots, tất cả trong 1 transaction duy
// nhất (thành công toàn bộ hoặc rollback toàn bộ, không còn trạng thái nửa vời).
export async function deleteLotTransaction(input: DeleteLotTransactionInput) {
  const { transactionId, factoryId } = input;

  try {
    const supabase = getSupabaseAdmin();
    const actorUserId = await assertProductAdmin(input.accessToken, factoryId, "xóa giao dịch thành phẩm đã gửi");

    const { data: txCheck } = await supabase
      .from("lot_transactions")
      .select("id, lots!inner(factory_id)")
      .eq("id", transactionId)
      .maybeSingle();
    const txLot = txCheck ? (Array.isArray(txCheck.lots) ? txCheck.lots[0] : txCheck.lots) : null;
    if (!txLot || txLot.factory_id !== factoryId) throw new Error("Giao dịch không thuộc nhà máy hiện tại.");

    const { data: rpcData, error: rpcError } = await supabase.rpc("delete_lot_transaction", {
      p_transaction_id: transactionId,
      p_actor_id: actorUserId,
    });
    if (rpcError) throw new Error(`Khong xoa duoc giao dich: ${rpcError.message}`);

    const row = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as
      | { lot_id: string; ngan_id: string | null; remaining_count: number; lot_deleted: boolean }
      | undefined;
    if (!row) throw new Error("Khong xoa duoc giao dich: RPC khong tra ve du lieu.");

    let snapshot = null;
    if (!row.lot_deleted) {
      const { data: lot, error: lotError } = await supabase
        .from("lots")
        .select("kien_a, kien_b, kien_c, kien_d, tong_banh, tong_kg, trang_thai, ca, ngan_id, ngay_ht, boc, pallet, chi_thi")
        .eq("id", row.lot_id)
        .single();
      if (lotError || !lot) throw new Error(`Khong doc duoc lo sau khi xoa giao dich: ${lotError?.message}`);
      snapshot = { ...lot, lotId: row.lot_id };
    }

    if (row.ngan_id) {
      const { error: syncError } = await supabase.rpc("sync_ngan_production_status", { p_ngan_id: row.ngan_id });
      if (syncError) console.error("sync_ngan_production_status:", syncError);
    }

    revalidateLotScreens();

    return {
      success: true as const,
      deletedTransactionId: transactionId,
      lotId: row.lot_id,
      affectedNganId: row.ngan_id,
      remainingTransactions: row.remaining_count,
      snapshot,
    };
  } catch (error) {
    logProductActionError("deleteLotTransaction", { transactionId }, error);
    return {
      success: false as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ── GĐ4: admin sửa giao dịch đã gửi ────────────────────────────────────────

export type AdminUpdateLotTransactionInput = {
  accessToken: string | null;
  factoryId: string;
  transactionId: string;
  kien: { a: number; b: number; c: number; d: number };
  nganId: string;
  ca: string;
  ngayNhap: string;
  boc: string | null;
  pallet: string[] | null;
  chiThi: string | null;
  lyDo: string;
};

export type AdminUpdateLotTransactionResult =
  | { success: true; lotId: string; oldNganId: string | null; newNganId: string }
  | { success: false; error: string };

// Nguồn DUY NHẤT để sửa 1 giao dịch thành phẩm đã gửi (trang Thành phẩm + Lịch sử ca ở màn quét).
// Mọi kiểm tra nghiệp vụ + đồng bộ bảng liên quan nằm trong RPC admin_update_lot_transaction
// (migration 20260929_lot_admin_edits.sql) để chạy trong 1 transaction.
export async function adminUpdateLotTransaction(
  input: AdminUpdateLotTransactionInput,
): Promise<AdminUpdateLotTransactionResult> {
  try {
    if (!input.lyDo?.trim()) throw new Error("Vui lòng nhập lý do sửa.");
    if (!input.nganId) throw new Error("Chưa chọn ngăn nguồn.");
    const actorUserId = await assertProductAdmin(
      input.accessToken,
      input.factoryId,
      "sửa giao dịch thành phẩm đã gửi",
    );
    const supabase = getSupabaseAdmin();

    const { data: tx, error: txError } = await supabase
      .from("lot_transactions")
      .select("id, lots!inner(factory_id, loai_csr, loai_banh)")
      .eq("id", input.transactionId)
      .maybeSingle();
    if (txError) throw new Error(txError.message);
    const lot = tx ? (Array.isArray(tx.lots) ? tx.lots[0] : tx.lots) : null;
    if (!lot || lot.factory_id !== input.factoryId) throw new Error("Giao dịch không thuộc nhà máy hiện tại.");

    const maxPerKien = getLoaiBanhConfig(lot.loai_csr, Number(lot.loai_banh) || undefined).max_per_kien;
    const toInt = (v: number) => Math.max(0, Math.round(Number(v) || 0));

    const { data, error } = await supabase.rpc("admin_update_lot_transaction", {
      p_tx_id: input.transactionId,
      p_kien_a: toInt(input.kien.a),
      p_kien_b: toInt(input.kien.b),
      p_kien_c: toInt(input.kien.c),
      p_kien_d: toInt(input.kien.d),
      p_ngan_id: input.nganId,
      p_ca: input.ca,
      p_ngay_nhap: input.ngayNhap,
      p_boc: input.boc?.trim() || null,
      p_pallet: input.pallet && input.pallet.length > 0 ? input.pallet : null,
      p_chi_thi: input.chiThi?.trim() || null,
      p_max_per_kien: maxPerKien,
      p_actor_id: actorUserId,
      p_ly_do: input.lyDo.trim(),
    });
    if (error) throw new Error(error.message);

    const result = (data || {}) as { lot_id: string; old_ngan_id: string | null; new_ngan_id: string };
    revalidateLotScreens();
    return { success: true, lotId: result.lot_id, oldNganId: result.old_ngan_id, newNganId: result.new_ngan_id };
  } catch (error) {
    logProductActionError("adminUpdateLotTransaction", { transactionId: input.transactionId }, error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ── GĐ4: "Sửa theo ngày" (header phiếu) ────────────────────────────────────

export type SaveDateHeaderEditsInput = {
  accessToken: string | null;
  factoryId: string;
  oldDate: string;
  lotIds: string[];
  patch: {
    ngay_sx: string;
    chi_thi: string | null;
    ghi_chu: string | null;
    image_url_1: string | null;
    image_url_2: string | null;
    image_code_1: string | null;
    image_code_2: string | null;
  };
  lyDo: string;
};

export type SaveDateHeaderEditsResult =
  | { success: true; updated: string[]; skipped: Array<{ maLo: string; reason: string }> }
  | { success: false; error: string };

// Không đổi mã lô (hậu tố/năm) — đã bỏ khỏi GĐ4 vì đổi mã lô không lan sang
// lot_prediction_lots.ma_lo (khóa QR) → quét nhãn cũ sinh lô trùng. Từng lô xử lý riêng, lô lỗi
// được trả về trong `skipped` để UI báo rõ thay vì lưu một nửa âm thầm.
export async function saveDateHeaderEdits(input: SaveDateHeaderEditsInput): Promise<SaveDateHeaderEditsResult> {
  try {
    if (!input.lyDo?.trim()) throw new Error("Vui lòng nhập lý do sửa.");
    if (!input.patch.ngay_sx) throw new Error("Thiếu ngày sản xuất.");
    const actorUserId = await assertProductAdmin(
      input.accessToken,
      input.factoryId,
      "sửa phiếu thành phẩm theo ngày",
    );
    const supabase = getSupabaseAdmin();

    const { data: lotRows, error: lotsError } = await supabase
      .from("lots")
      .select("id, factory_id, ma_lo, trang_thai, ngay_sx, chi_thi, ghi_chu, ngan_id")
      .in("id", input.lotIds);
    if (lotsError) throw new Error(lotsError.message);

    const updated: string[] = [];
    const skipped: Array<{ maLo: string; reason: string }> = [];
    const nganIdsToSync = new Set<string>();

    for (const lot of lotRows || []) {
      if (lot.factory_id !== input.factoryId) {
        skipped.push({ maLo: lot.ma_lo, reason: "không thuộc nhà máy hiện tại" });
        continue;
      }
      if (normalizeLotStatus(lot.trang_thai) === "Xuất hàng") {
        skipped.push({ maLo: lot.ma_lo, reason: "đã Xuất hàng" });
        continue;
      }
      if (lot.ngay_sx !== input.oldDate) {
        skipped.push({ maLo: lot.ma_lo, reason: "ngày sản xuất đã thay đổi, vui lòng tải lại" });
        continue;
      }

      // Chỉ thị là thông tin của đúng các giao dịch ngày này — sync_lot_master_snapshot lấy chỉ thị
      // mới nhất từ giao dịch, nên phải ghi xuống giao dịch thì lots.chi_thi mới không bị ghi đè lại.
      const txPatch: Record<string, unknown> = { ngay_nhap: input.patch.ngay_sx };
      if ((input.patch.chi_thi || null) !== (lot.chi_thi || null)) txPatch.chi_thi = input.patch.chi_thi || null;
      const { error: txError } = await supabase
        .from("lot_transactions")
        .update(txPatch)
        .eq("lot_id", lot.id)
        .eq("ngay_nhap", input.oldDate);
      if (txError) {
        skipped.push({ maLo: lot.ma_lo, reason: txError.message });
        continue;
      }

      const { error: lotError } = await supabase
        .from("lots")
        .update({
          ngay_sx: input.patch.ngay_sx,
          chi_thi: input.patch.chi_thi || null,
          ghi_chu: input.patch.ghi_chu || null,
          image_url_1: input.patch.image_url_1 || null,
          image_url_2: input.patch.image_url_2 || null,
          image_code_1: input.patch.image_code_1 || null,
          image_code_2: input.patch.image_code_2 || null,
        })
        .eq("id", lot.id);
      if (lotError) {
        skipped.push({ maLo: lot.ma_lo, reason: lotError.message });
        continue;
      }

      const { data: snap, error: snapError } = await supabase.rpc("sync_lot_master_snapshot", { p_lot_id: lot.id });
      if (snapError) console.error("sync_lot_master_snapshot:", snapError);
      const snapRow = (Array.isArray(snap) ? snap[0] : snap) as { ngan_id?: string | null } | null;
      if (lot.ngan_id) nganIdsToSync.add(lot.ngan_id);
      if (snapRow?.ngan_id) nganIdsToSync.add(snapRow.ngan_id);

      const { error: auditError } = await supabase.from("lot_admin_edits").insert({
        factory_id: input.factoryId,
        lot_id: lot.id,
        loai: "sua_theo_ngay",
        actor_id: actorUserId,
        ly_do: input.lyDo.trim(),
        truoc: { ngay_sx: lot.ngay_sx, chi_thi: lot.chi_thi, ghi_chu: lot.ghi_chu },
        sau: { ngay_sx: input.patch.ngay_sx, chi_thi: input.patch.chi_thi, ghi_chu: input.patch.ghi_chu },
      });
      if (auditError) console.error("lot_admin_edits:", auditError);
      updated.push(lot.ma_lo);
    }

    for (const nganId of nganIdsToSync) {
      const { error: syncError } = await supabase.rpc("sync_ngan_production_status", { p_ngan_id: nganId });
      if (syncError) console.error("sync_ngan_production_status:", syncError);
    }

    revalidateLotScreens();
    return { success: true, updated, skipped };
  } catch (error) {
    logProductActionError("saveDateHeaderEdits", { oldDate: input.oldDate }, error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ── Sang kiện / Thay bọc theo quy tắc "tròn kiện" (GĐ6, 2026-09-28) ─────────────────────────────
// Sau sản xuất được đổi bọc/pallet nhưng phải NGUYÊN KIỆN và chỉ kiện chưa gán đơn xuất bành nào.
// Không còn tách lô tồn dư "…r". Ghi qua RPC perform_sang_kien_thay_boc (service role).

export type SkKienKey = "a" | "b" | "c" | "d";
// boc/pallet = bọc/pallet HIỆN TẠI của kiện theo giao dịch cuối chứa kiện (lots.boc/pallet chỉ là bản chụp
// giao dịch cuối của cả lô — sau Thay bọc tròn kiện 1 lô có kiện khác bọc).
export type SkKienAvailability = Record<
  SkKienKey,
  { produced: number; assigned: number; boc: string; pallet: string[] }
>;

const SK_PERMISSIONS = ["product.edit"];
const SK_KIENS: SkKienKey[] = ["a", "b", "c", "d"];

/** Số bành đã sản xuất / đã gán đơn xuất theo từng kiện của các lô đang chọn. */
export async function loadSkKienAvailability(
  factoryId: string,
  accessToken: string | null,
  lotIds: string[],
): Promise<Record<string, SkKienAvailability>> {
  await assertProductAccess(accessToken, factoryId, SK_PERMISSIONS, "sang kiện / thay bọc");
  const ids = [...new Set(lotIds)].filter(Boolean);
  const out: Record<string, SkKienAvailability> = {};
  if (ids.length === 0) return out;
  const supabase = getSupabaseAdmin();
  const empty = (): SkKienAvailability => ({
    a: { produced: 0, assigned: 0, boc: "", pallet: [] },
    b: { produced: 0, assigned: 0, boc: "", pallet: [] },
    c: { produced: 0, assigned: 0, boc: "", pallet: [] },
    d: { produced: 0, assigned: 0, boc: "", pallet: [] },
  });
  const kienBoc = new Map<string, KienBoc>();
  const kienPallet = new Map<string, KienPallet>();
  const lotSnap = new Map<string, { boc: string | null; pallet: string[] | null }>();
  const maToId = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data: lots, error: lotErr } = await supabase
      .from("lots")
      .select("id,ma_lo,boc,pallet")
      .eq("factory_id", factoryId)
      .in("id", chunk);
    if (lotErr) throw new Error(lotErr.message);
    for (const l of lots || []) {
      out[l.id] = empty();
      lotSnap.set(l.id, { boc: l.boc ?? null, pallet: (l.pallet as string[] | null) ?? null });
      if (l.ma_lo) maToId.set(String(l.ma_lo).trim().toLowerCase(), l.id);
    }
    for (let from = 0; ; from += 1000) {
      const { data: txs, error: txErr } = await supabase
        .from("lot_transactions")
        .select("id,lot_id,kien_a,kien_b,kien_c,kien_d,boc,pallet,created_at")
        .in("lot_id", chunk)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + 999);
      if (txErr) throw new Error(txErr.message);
      for (const t of txs || []) {
        const row = out[t.lot_id];
        if (!row) continue;
        for (const k of SK_KIENS) row[k].produced += Number(t[`kien_${k}`]) || 0;
        const snap = lotSnap.get(t.lot_id);
        applyTxToKienBoc(kienBoc, t, snap?.boc);
        applyTxToKienPallet(kienPallet, t, snap?.pallet);
      }
      if (!txs || txs.length < 1000) break;
    }
  }
  for (let from = 0; ; from += 1000) {
    const { data: orders, error: ordErr } = await supabase
      .from("export_orders")
      .select("id,assignments")
      .eq("factory_id", factoryId)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (ordErr) throw new Error(ordErr.message);
    for (const o of orders || []) {
      const list = Array.isArray(o.assignments) ? (o.assignments as Record<string, unknown>[]) : [];
      for (const a of list) {
        const byId = typeof a.lot_id === "string" && out[a.lot_id] ? (a.lot_id as string) : null;
        const byMa = typeof a.ma_lo === "string" ? maToId.get(a.ma_lo.trim().toLowerCase()) : undefined;
        const lotId = byId || byMa;
        if (!lotId) continue;
        for (const k of SK_KIENS) out[lotId][k].assigned += Number(a[`kien_${k}`]) || 0;
      }
    }
    if (!orders || orders.length < 1000) break;
  }
  for (const [lotId, row] of Object.entries(out)) {
    const snap = lotSnap.get(lotId);
    for (const k of SK_KIENS) {
      row[k].boc = kienBocOf(kienBoc, lotId, k, snap?.boc);
      row[k].pallet = kienPalletOf(kienPallet, lotId, k, snap?.pallet);
    }
  }
  return out;
}

export async function performSangKienThayBoc(input: {
  factoryId: string;
  accessToken: string | null;
  loai: "Sang kiện" | "Thay bọc";
  lots: { lotId: string; kiens: SkKienKey[] }[];
  newBoc: string | null;
  newPallet: string[] | null;
  history: Record<string, unknown>;
}): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const actorId = await assertProductAccess(
      input.accessToken,
      input.factoryId,
      SK_PERMISSIONS,
      "sang kiện / thay bọc",
    );
    const lots = input.lots
      .map((l) => ({ lot_id: l.lotId, kiens: [...new Set(l.kiens)].filter((k) => SK_KIENS.includes(k)) }))
      .filter((l) => l.lot_id && l.kiens.length > 0);
    if (lots.length === 0) return { success: false, error: "Chưa chọn kiện nào để đổi." };
    const supabase = getSupabaseAdmin();
    // Bọc mới phải hợp lệ theo dây chuyền + CSR của từng lô (không chỉ ẩn ở giao diện). Chặn bọc trùng
    // bọc kiện đang mang nằm trong RPC (đọc đúng giao dịch của kiện).
    if (input.loai === "Thay bọc") {
      const newBoc = (input.newBoc || "").trim();
      if (!newBoc) return { success: false, error: "Chưa chọn bọc mới." };
      const { data: lotRows, error: lotErr } = await supabase
        .from("lots")
        .select("id,ma_lo,day_chuyen,loai_csr")
        .eq("factory_id", input.factoryId)
        .in("id", lots.map((l) => l.lot_id));
      if (lotErr) return { success: false, error: lotErr.message };
      for (const l of lotRows || []) {
        const folded = String(l.day_chuyen || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
        const dc = folded.includes("nuoc") ? "Mủ nước" : "Mủ tạp";
        const allowed = getBocsForLoaiCSR(dc, String(l.loai_csr || "").trim());
        if (!allowed.includes(newBoc)) {
          return { success: false, error: `Bọc "${newBoc}" không dùng được cho lô ${l.ma_lo} (${l.loai_csr}, ${dc}).` };
        }
      }
    }
    const { error } = await supabase.rpc("perform_sang_kien_thay_boc", {
      p_factory_id: input.factoryId,
      p_actor_id: actorId,
      p_loai: input.loai,
      p_lots: lots,
      p_new_boc: input.loai === "Thay bọc" ? input.newBoc : null,
      p_new_pallet: input.loai === "Sang kiện" ? input.newPallet : null,
      p_history_payload: input.history,
    });
    if (error) return { success: false, error: error.message };
    revalidateLotScreens();
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}