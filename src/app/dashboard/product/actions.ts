"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  normalizeLotStatus,
  pickCanonicalLot,
} from "@/app/dashboard/product/shared";
import { assertShiftNotLocked } from "@/app/dashboard/product/shift-lock";

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
  // Người thực hiện thao tác — dùng để check "Khóa ca sản xuất" (product_shift_locks). Admin
  // luôn được bypass khóa. Không bắt buộc (null cho phép các call site cũ trước khi tính năng
  // khóa ca tồn tại vẫn build được), nhưng thiếu giá trị này thì mọi ca đã khóa đều bị chặn
  // ghi (kể cả với admin) vì không tra được role — luôn truyền currentUser?.id/input.userId.
  actorUserId?: string | null;
};

type DeleteLotTransactionInput = {
  transactionId: string;
  // Dùng để check "Khóa ca sản xuất" — xem SaveLotTransactionInput.actorUserId. Truyền null nếu
  // không xác định được actor (call site không có session context) — an toàn, chỉ khiến RPC coi
  // actor đó là non-admin (không bypass được khóa), không bao giờ mở khóa nhầm.
  actorUserId: string | null;
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
  revalidatePath("/dashboard/product-draft");
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
  const editingTransactionId = transaction.id ?? null;
  const isEditingExistingTransaction = Boolean(editingTransactionId);

  try {
    const supabase = getSupabaseAdmin();
    if (!maLo) throw new Error("Thieu ma lo.");

    await assertShiftNotLocked({
      factoryId: lot.factory_id,
      ngaySx: transaction.ngay_nhap,
      ca: transaction.ca,
      actorUserId: input.actorUserId,
    });

    const parsedLotCode = parseLotCode(maLo);
    const kienA = transaction.kien_a ?? 0;
    const kienB = transaction.kien_b ?? 0;
    const kienC = transaction.kien_c ?? 0;
    const kienD = transaction.kien_d ?? 0;

    const { data: matchingLots, error: findLotError } = await supabase
      .from("lots")
      .select("id, factory_id, ma_lo, trang_thai, tong_banh, created_at, updated_at")
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
      if (isEditingExistingTransaction) {
        // Allow editing an existing transaction on in-progress and completed lots.
      } else
      if (normalizedStatus !== "Dở dang") {
        throw new Error(
          `Lo ${maLo} dang o trang thai "${existingLot.trang_thai}", khong the nhap them giao dich.`,
        );
      }
    }

    if (editingTransactionId) {
      const { data: existingTransaction, error: existingTransactionError } = await supabase
        .from("lot_transactions")
        .select("id, lot_id")
        .eq("id", editingTransactionId)
        .maybeSingle();

      if (existingTransactionError) {
        throw new Error(
          `Khong xac dinh duoc giao dich dang sua cua lo ${maLo}: ${existingTransactionError.message}`,
        );
      }
      if (!existingTransaction) {
        throw new Error("Khong tim thay transaction can sua.");
      }
      if (existingTransaction.lot_id !== lotId) {
        throw new Error("Transaction dang sua khong thuoc lo hien tai.");
      }
    }

    const { data: savedTransaction, error: saveTransactionError } = await supabase
      .from("lot_transactions")
      .upsert(
        {
          ...(transaction.id ? { id: transaction.id } : {}),
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
          ...(transaction.boc !== undefined ? { boc: transaction.boc } : {}),
          ...(transaction.pallet !== undefined ? { pallet: transaction.pallet } : {}),
          ...(transaction.chi_thi !== undefined ? { chi_thi: transaction.chi_thi } : {}),
        },
        { onConflict: "id" },
      )
      // created_at thêm vào select để caller (confirmKienProduction) không phải query lại
      // riêng chỉ để lấy đúng giá trị này (giảm 1 round-trip Supabase mỗi lần quét QR).
      .select("id, lot_id, ngan_id, so_banh, so_kg, created_at")
      .single();

    if (saveTransactionError) {
      throw new Error(`Khong luu duoc giao dich cua lo ${maLo}: ${saveTransactionError.message}`);
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
  const { transactionId, actorUserId } = input;

  try {
    const supabase = getSupabaseAdmin();

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
