"use server";

// GĐ7b — "Bản cứng" PDF của F09 / F11 / F12 cho ngày đã KHÓA ĐỦ mọi ca. Xem
// .claude/rules/06-module-production.md mục 4.15 + migration 20261003_product_shift_report_snapshots.sql.
//
// Quy tắc: bản cứng sinh khi mọi ca có phát sinh trong ngày đều đã khóa VÀ có người render lần đầu.
// Đã có bản hiện hành → mọi người (kể cả admin) mở lại đều nhận đúng bản đó. Muốn sửa: admin mở
// khóa rồi khóa lại → bộ khóa (lock_ids) đổi → bản cũ hết hiệu lực, lần render kế tiếp sinh bản mới.
//
// Mọi thao tác chạy bằng service role; client chỉ gửi access token, server tự xác thực + kiểm quyền.
// File PDF KHÔNG đi qua server action (giới hạn body): server phát signed upload URL, client tự tải
// lên bucket private, rồi finalize tải lại object để tự tính sha256 — không tin băm client gửi.

import { createHash, randomUUID } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { mintSignedUrlForPath } from "@/lib/secure-file-url";
import { fetchAllPaginated } from "@/lib/supabase-helpers";
import {
  REPORT_DAILY_PERMISSIONS,
  REPORT_SHIFT_PERMISSIONS,
  assertProductAccess,
} from "@/app/dashboard/product/confirm/report-access";

const BUCKET = "product-shift-reports";

// Xem bản cứng: ai xem được Thành phẩm, hoặc ai vốn được dựng chính phiếu/báo cáo đó (người trực ca
// quét QR có thể không có product.view nhưng được in F09 — bản cứng thay đúng chỗ bản render sống).
const VIEW_PERMISSIONS = [
  "product.view",
  ...REPORT_SHIFT_PERMISSIONS,
  ...REPORT_DAILY_PERMISSIONS,
  "product.approve_shift",
];
const TABLE = "product_shift_report_snapshots";

export type ReportSnapshotKind = "F09" | "F11" | "F12" | "F11_F12";
const KINDS: ReportSnapshotKind[] = ["F09", "F11", "F12", "F11_F12"];

export type ReportSnapshotInfo = {
  id: string;
  loai: ReportSnapshotKind;
  fileName: string;
  createdAt: string;
  createdByName: string;
  inputs: Record<string, unknown> | null;
};

export type DayLockState = {
  /** Bảng/bucket chưa tạo (migration chưa chạy) — mọi thứ chạy như chưa khóa. */
  unavailable: boolean;
  fullyLocked: boolean;
  cas: string[];
  lockedCas: string[];
  current: Partial<Record<ReportSnapshotKind, ReportSnapshotInfo>>;
};

const EMPTY_STATE: DayLockState = {
  unavailable: false,
  fullyLocked: false,
  cas: [],
  lockedCas: [],
  current: {},
};

function assertDay(ngay: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ngay)) throw new Error("Ngày sản xuất không hợp lệ.");
}

function isMissingRelation(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "42P01" || err.code === "PGRST205" || /does not exist|schema cache/i.test(err.message || "");
}

// Quyền SINH bản cứng theo loại = đúng quyền được dựng chính phiếu/báo cáo đó.
function createPermissionsFor(loai: ReportSnapshotKind): string[] {
  return loai === "F09" ? REPORT_SHIFT_PERMISSIONS : REPORT_DAILY_PERMISSIONS;
}

/** Ca có phát sinh + bộ khóa active của ngày. `lockIds` đã sắp xếp. */
async function computeDayLocks(factoryId: string, ngay: string) {
  const supabase = getSupabaseAdmin();
  const [txRows, locksRes] = await Promise.all([
    fetchAllPaginated((from, to) =>
      supabase
        .from("lot_transactions")
        .select("id, ca, lots!inner(factory_id)")
        .eq("lots.factory_id", factoryId)
        .eq("ngay_nhap", ngay)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    supabase
      .from("product_shift_locks")
      .select("id, ca")
      .eq("factory_id", factoryId)
      .eq("ngay_sx", ngay)
      .eq("is_active", true),
  ]);
  if (locksRes.error) throw new Error(locksRes.error.message);

  const cas = [
    ...new Set(
      (txRows as Array<{ ca: string | null }>).map((r) => String(r.ca || "").trim()).filter(Boolean),
    ),
  ].sort();
  const locks = (locksRes.data || []) as Array<{ id: string; ca: string }>;
  const lockedCas = [...new Set(locks.map((l) => l.ca))].sort();
  const fullyLocked = cas.length > 0 && cas.every((ca) => lockedCas.includes(ca));
  const lockIds = locks.map((l) => l.id).sort();
  return { cas, lockedCas, fullyLocked, lockIds };
}

function sameIds(a: string[] | null | undefined, b: string[]): boolean {
  if (!a || a.length !== b.length) return false;
  const sorted = [...a].sort();
  return sorted.every((v, i) => v === b[i]);
}

type SnapshotRow = {
  id: string;
  loai: ReportSnapshotKind;
  lock_ids: string[];
  file_name: string;
  storage_path: string;
  inputs: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
};

/** Bản hiện hành theo từng loại (mới nhất có lock_ids trùng bộ khóa hiện tại). */
async function loadCurrentSnapshots(
  factoryId: string,
  ngay: string,
  lockIds: string[],
): Promise<{ missing: boolean; rows: Partial<Record<ReportSnapshotKind, SnapshotRow>> }> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(TABLE)
    .select("id, loai, lock_ids, file_name, storage_path, inputs, created_by, created_at")
    .eq("factory_id", factoryId)
    .eq("ngay_sx", ngay)
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingRelation(error)) return { missing: true, rows: {} };
    throw new Error(error.message);
  }
  const rows: Partial<Record<ReportSnapshotKind, SnapshotRow>> = {};
  for (const r of (data || []) as SnapshotRow[]) {
    if (rows[r.loai]) continue;
    if (sameIds(r.lock_ids, lockIds)) rows[r.loai] = r;
  }
  return { missing: false, rows };
}

async function resolveNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data } = await getSupabaseAdmin().from("profiles").select("id, full_name, username").in("id", unique);
  return new Map((data || []).map((p) => [p.id as string, (p.full_name || p.username || "—") as string]));
}

/** Trạng thái khóa + bản cứng hiện hành của 1 ngày. Quyền: VIEW_PERMISSIONS. */
export async function loadDayLockState(
  accessToken: string | null,
  factoryId: string,
  ngay: string,
): Promise<DayLockState> {
  assertDay(ngay);
  await assertProductAccess(accessToken, factoryId, VIEW_PERMISSIONS, "xem thành phẩm");
  const locks = await computeDayLocks(factoryId, ngay);
  if (!locks.fullyLocked) return { ...EMPTY_STATE, cas: locks.cas, lockedCas: locks.lockedCas };

  const { missing, rows } = await loadCurrentSnapshots(factoryId, ngay, locks.lockIds);
  if (missing) return { ...EMPTY_STATE, unavailable: true, cas: locks.cas, lockedCas: locks.lockedCas };

  const names = await resolveNames(Object.values(rows).map((r) => r?.created_by || ""));
  const current: DayLockState["current"] = {};
  for (const kind of KINDS) {
    const r = rows[kind];
    if (!r) continue;
    current[kind] = {
      id: r.id,
      loai: r.loai,
      fileName: r.file_name,
      createdAt: r.created_at,
      createdByName: names.get(r.created_by || "") || "—",
      inputs: r.inputs,
    };
  }
  return { unavailable: false, fullyLocked: true, cas: locks.cas, lockedCas: locks.lockedCas, current };
}

async function assertCanCreate(
  accessToken: string | null,
  factoryId: string,
  ngay: string,
  loai: ReportSnapshotKind,
) {
  assertDay(ngay);
  if (!KINDS.includes(loai)) throw new Error("Loại bản cứng không hợp lệ.");
  const userId = await assertProductAccess(
    accessToken,
    factoryId,
    createPermissionsFor(loai),
    loai === "F09" ? "tạo bản cứng phiếu thành phẩm" : "tạo bản cứng báo cáo ngày",
  );
  const locks = await computeDayLocks(factoryId, ngay);
  if (!locks.fullyLocked) {
    throw new Error("Ngày này chưa khóa đủ tất cả các ca — chưa tạo bản cứng.");
  }
  const { missing, rows } = await loadCurrentSnapshots(factoryId, ngay, locks.lockIds);
  if (missing) throw new Error("Chưa cấu hình lưu bản cứng (migration 20261003 chưa chạy).");
  if (rows[loai]) {
    throw new Error("Ngày này đã có bản cứng. Muốn tạo lại, admin mở khóa rồi khóa lại ca.");
  }
  return { userId, lockIds: locks.lockIds };
}

/** Bước 1: kiểm quyền + phát signed upload URL cho 1 file PDF. */
export async function prepareReportSnapshotUpload(
  accessToken: string | null,
  factoryId: string,
  ngay: string,
  loai: ReportSnapshotKind,
): Promise<{ path: string; token: string }> {
  await assertCanCreate(accessToken, factoryId, ngay, loai);
  const path = `${factoryId}/${ngay}/${loai}-${randomUUID()}.pdf`;
  const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data?.token) throw new Error(error?.message || "Không tạo được đường dẫn tải lên.");
  return { path, token: data.token };
}

/** Bước 2: tải lại object vừa upload, tự tính sha256, ghi bản cứng. */
export async function finalizeReportSnapshot(
  accessToken: string | null,
  factoryId: string,
  ngay: string,
  loai: ReportSnapshotKind,
  path: string,
  fileName: string,
  inputs?: Record<string, unknown> | null,
): Promise<ReportSnapshotInfo> {
  const { userId, lockIds } = await assertCanCreate(accessToken, factoryId, ngay, loai);
  const prefix = `${factoryId}/${ngay}/${loai}-`;
  if (!path.startsWith(prefix) || !path.endsWith(".pdf") || path.includes("..")) {
    throw new Error("Đường dẫn bản cứng không hợp lệ.");
  }

  const supabase = getSupabaseAdmin();
  const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(path);
  if (dlErr || !blob) throw new Error(dlErr?.message || "Không đọc lại được file vừa tải lên.");
  const bytes = Buffer.from(await blob.arrayBuffer());
  if (bytes.length === 0 || bytes.subarray(0, 4).toString("latin1") !== "%PDF") {
    throw new Error("File tải lên không phải PDF.");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const { data: row, error } = await supabase
    .from(TABLE)
    .insert({
      factory_id: factoryId,
      ngay_sx: ngay,
      loai,
      lock_ids: lockIds,
      storage_path: path,
      file_name: (fileName || `${loai}.pdf`).slice(0, 200),
      sha256,
      size_bytes: bytes.length,
      inputs: inputs ?? null,
      created_by: userId,
    })
    .select("id, loai, file_name, inputs, created_at")
    .single();
  if (error || !row) throw new Error(error?.message || "Không ghi được bản cứng.");

  const names = await resolveNames([userId]);
  return {
    id: row.id,
    loai: row.loai as ReportSnapshotKind,
    fileName: row.file_name,
    createdAt: row.created_at,
    createdByName: names.get(userId) || "—",
    inputs: (row.inputs as Record<string, unknown> | null) ?? null,
  };
}

/** Signed URL ngắn hạn để mở/tải 1 bản cứng. Quyền: VIEW_PERMISSIONS. */
export async function getReportSnapshotUrl(
  accessToken: string | null,
  factoryId: string,
  snapshotId: string,
  download = false,
): Promise<string> {
  await assertProductAccess(accessToken, factoryId, VIEW_PERMISSIONS, "xem bản cứng");
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .select("storage_path, file_name, factory_id")
    .eq("id", snapshotId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.factory_id !== factoryId) throw new Error("Không tìm thấy bản cứng.");
  const url = await mintSignedUrlForPath(data.storage_path, {
    bucket: BUCKET,
    downloadName: download ? data.file_name : undefined,
  });
  if (!url) throw new Error("Không tạo được đường dẫn xem bản cứng.");
  return url;
}
