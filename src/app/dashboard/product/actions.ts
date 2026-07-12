"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  normalizeLotStatus,
  pickCanonicalLot,
  type NormalizedLotStatus,
} from "@/app/dashboard/product/shared";

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
};

type DeleteLotTransactionInput = {
  transactionId: string;
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

// Duyệt ngược mảng (đã sắp xếp tăng dần theo ngay_nhap/created_at) để tìm giá trị non-null
// gần nhất — dùng cho boc/pallet/chi_thi vốn chỉ được set bởi luồng "Xác nhận sản xuất qua QR",
// các dòng nhập tay cũ để null nên phải bỏ qua thay vì coi null là "giá trị mới nhất".
function lastNonNull<T, V>(arr: T[], picker: (item: T) => V | null | undefined): V | undefined {
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    const value = picker(arr[i]);
    if (value !== null && value !== undefined) return value;
  }
  return undefined;
}

async function syncLotMasterSnapshot(lotId: string) {
  const supabase = getSupabaseAdmin();
  const [{ data: lot, error: lotError }, { data: transactions, error: txError }] =
    await Promise.all([
      supabase.from("lots").select("id, loai_banh, trang_thai").eq("id", lotId).single(),
      supabase
        .from("lot_transactions")
        .select(
          "id, ngan_id, ca, ngay_nhap, kien_a, kien_b, kien_c, kien_d, so_banh, so_kg, created_at, boc, pallet, chi_thi",
        )
        .eq("lot_id", lotId)
        .order("ngay_nhap", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);

  if (lotError) throw new Error(`Khong dong bo duoc lo: ${lotError.message}`);
  if (txError) throw new Error(`Khong tai duoc giao dich lo: ${txError.message}`);

  const txs = transactions ?? [];
  const latestTx = txs.at(-1);
  const kienA = txs.reduce((sum, tx) => sum + Number(tx.kien_a ?? 0), 0);
  const kienB = txs.reduce((sum, tx) => sum + Number(tx.kien_b ?? 0), 0);
  const kienC = txs.reduce((sum, tx) => sum + Number(tx.kien_c ?? 0), 0);
  const kienD = txs.reduce((sum, tx) => sum + Number(tx.kien_d ?? 0), 0);
  const tongBanh = txs.reduce((sum, tx) => sum + Number(tx.so_banh ?? 0), 0);
  const tongKg = txs.reduce((sum, tx) => sum + Number(tx.so_kg ?? 0), 0);
  const loTron = Number(lot.loai_banh) === 20 ? 240 : 144;

  const derivedStatus: NormalizedLotStatus =
    tongBanh >= loTron ? "Hoàn thành" : "Dở dang";

  const latestBoc = lastNonNull(txs, (tx) => tx.boc as string | null);
  const latestPallet = lastNonNull(txs, (tx) => tx.pallet as string[] | null);
  const latestChiThi = lastNonNull(txs, (tx) => tx.chi_thi as string | null);

  const payload = {
    kien_a: kienA,
    kien_b: kienB,
    kien_c: kienC,
    kien_d: kienD,
    tong_banh: tongBanh,
    tong_kg: tongKg,
    trang_thai: derivedStatus,
    ca: latestTx?.ca ?? null,
    ngan_id: latestTx?.ngan_id ?? null,
    ngay_ht: derivedStatus === "Hoàn thành" ? (latestTx?.ngay_nhap ?? null) : null,
    ...(latestBoc !== undefined ? { boc: latestBoc } : {}),
    ...(latestPallet !== undefined ? { pallet: latestPallet } : {}),
    ...(latestChiThi !== undefined ? { chi_thi: latestChiThi } : {}),
  };

  const { error: updateError } = await supabase.from("lots").update(payload).eq("id", lotId);
  if (updateError) throw new Error(`Khong cap nhat tong lo duoc: ${updateError.message}`);

  return { ...payload, lotId, transactionsCount: txs.length };
}

export async function saveLotTransaction(input: SaveLotTransactionInput) {
  const { lot, transaction } = input;
  const maLo = lot.ma_lo.trim();
  const editingTransactionId = transaction.id ?? null;
  const isEditingExistingTransaction = Boolean(editingTransactionId);

  try {
    const supabase = getSupabaseAdmin();
    if (!maLo) throw new Error("Thieu ma lo.");

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
      .select("id, lot_id, ngan_id, so_banh, so_kg")
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

export async function deleteLotTransaction(input: DeleteLotTransactionInput) {
  const { transactionId } = input;

  try {
    const supabase = getSupabaseAdmin();

    const { data: targetTx, error: findError } = await supabase
      .from("lot_transactions")
      .select("id, lot_id, ngan_id")
      .eq("id", transactionId)
      .single();

    if (findError || !targetTx) {
      throw new Error(`Khong tim thay giao dich can xoa: ${findError?.message ?? transactionId}`);
    }

    const { error: deleteError } = await supabase
      .from("lot_transactions")
      .delete()
      .eq("id", transactionId);
    if (deleteError) throw new Error(`Khong xoa duoc giao dich: ${deleteError.message}`);

    const { count, error: countError } = await supabase
      .from("lot_transactions")
      .select("id", { count: "exact", head: true })
      .eq("lot_id", targetTx.lot_id);

    if (countError) throw new Error(`Khong dem duoc giao dich con lai: ${countError.message}`);

    let snapshot = null;
    if ((count ?? 0) > 0) {
      snapshot = await syncLotMasterSnapshot(targetTx.lot_id);
    } else {
      const { error: deleteLotError } = await supabase.from("lots").delete().eq("id", targetTx.lot_id);
      if (deleteLotError) throw new Error(`Khong xoa duoc lo tong: ${deleteLotError.message}`);
    }

    revalidateLotScreens();

    return {
      success: true as const,
      deletedTransactionId: transactionId,
      lotId: targetTx.lot_id,
      affectedNganId: targetTx.ngan_id,
      remainingTransactions: count ?? 0,
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
