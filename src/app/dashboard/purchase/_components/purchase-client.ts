// Helper phía trình duyệt cho module Đề nghị mua vật tư.
import { supabase } from "@/lib/supabase"
import { authFetch } from "@/lib/auth-fetch"
import { buildPurchasePdfForSigning } from "@/lib/purchase-pdf"
import { jsPdfBoxToPt } from "@/lib/signing/coords"
import type { SigningFieldInput } from "@/lib/signing/requests"
import {
  PURCHASE_SIGN_ORDER,
  formatSoPhieuFull,
  type PurchaseAdjustmentSummary, type PurchaseApprover, type PurchaseInsightSnapshot, type PurchaseEffectiveLine, type PurchaseLineRow,
  type PurchaseReceiptRow, type PurchaseRequestRow, type PurchaseSigner, type PurchaseSignRole, type PurchaseMaintenanceSource,
} from "@/lib/purchase/types"

export type ApproversResponse = {
  giamDoc: PurchaseApprover[]
  keToan: PurchaseApprover[]
  giamDocFallback: boolean
  keToanFallback: boolean
  defaultGiamDocId: string | null
  defaultKeToanId: string | null
  myChucVu: string | null
}

export type PurchaseDetail = {
  request: PurchaseRequestRow & { created_by: string | null; huy_boi: string | null }
  lines: PurchaseLineRow[]
  signers: PurchaseSigner[]
  logs: { hanh_dong: string; noi_dung: string | null; user_id: string | null; created_at: string }[]
  names: Record<string, string>
  fileHienTai: string | null
  traVeLyDo: string | null
  effectiveLines: PurchaseEffectiveLine[]
  receipts: PurchaseReceiptRow[]
  adjustments: PurchaseAdjustmentSummary[]
  pendingAdjustmentId: string | null
  parent: { id: string; so: number; nam: number } | null
  /** GĐ2g: phiếu lập từ biên bản bảo trì — nhập cứng vào kho tạm KT. */
  maintenanceSource: PurchaseMaintenanceSource | null
  perms: {
    canEdit: boolean; canSubmit: boolean; canCancel: boolean; isAdmin: boolean
    /** Người xem có purchase.create nhưng chưa là người đề nghị của phiếu từ biên bản: Lưu = nhận xử lý. */
    canTakeOver?: boolean
    canReceive: boolean; canAdjust: boolean; canClose: boolean; canEditImages: boolean
  }
}

export type ReceivePayload = {
  warehouseId: string
  ngay: string
  nhaCungCap: string
  ghiChu: string
  imageUrls: string[]
  lines: { lineId: string; soLuong: number; donGia: number; lotNo: string | null; expiryDate: string | null; ghiChu: string | null }[]
}

export async function receivePurchase(requestId: string, payload: ReceivePayload) {
  return readJson<{ documentId: string; documentCode: string; status: string }>(await authFetch(`/api/purchase/requests/${requestId}/receive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }))
}

export type AdjustPayload = {
  lyDo: string
  lines: { parentLineId: string; itemId: string; soLuong: number; donGia: number; ghiChu: string | null }[]
}

export async function createAdjustment(requestId: string, payload: AdjustPayload): Promise<string> {
  const json = await readJson<{ id: string }>(await authFetch(`/api/purchase/requests/${requestId}/adjust`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }))
  return json.id
}

export async function closePurchase(requestId: string, lyDo: string) {
  return readJson<{ ok: boolean }>(await authFetch(`/api/purchase/requests/${requestId}/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lyDo }),
  }))
}

export async function readJson<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(json.error || `Lỗi ${res.status}`)
  return json
}

export async function fetchApprovers(): Promise<ApproversResponse> {
  return readJson<ApproversResponse>(await authFetch("/api/purchase/approvers"))
}

export async function fetchPurchaseDetail(id: string): Promise<PurchaseDetail> {
  return readJson<PurchaseDetail>(await authFetch(`/api/purchase/requests/${id}`))
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/**
 * Dựng PDF A5 theo dữ liệu đã lưu trên server (không dùng state form) rồi gửi ký.
 * Trả về yeuCauId để điều hướng sang màn ký.
 */
export async function submitPurchaseForSigning(requestId: string, factoryId: string): Promise<string> {
  const [detail, approvers, { data: factory }] = await Promise.all([
    fetchPurchaseDetail(requestId),
    fetchApprovers(),
    supabase.from("factories").select("name").eq("id", factoryId).maybeSingle(),
  ])
  const req = detail.request
  if (!req.giam_doc_user_id || !req.ke_toan_user_id) throw new Error("Chưa chọn Giám đốc hoặc Kế toán")

  // Chụp số liệu bằng chứng (tồn kho, tiêu hao, lần mua trước) ở server NGAY trước khi dựng PDF —
  // cùng bản chụp được lưu vào DB và in lên phiếu, người duyệt thấy đúng số lúc gửi ký.
  const { snapshots } = await readJson<{ snapshots: Record<string, PurchaseInsightSnapshot> }>(
    await authFetch(`/api/purchase/requests/${requestId}/insight-snapshot`, { method: "POST" }),
  )

  const chucVuOf = (list: PurchaseApprover[], id: string) => list.find((a) => a.id === id)?.chuc_vu || null
  const pdf = await buildPurchasePdfForSigning({
    factoryName: (factory?.name as string) || "Nhà máy chế biến",
    soPhieu: req.so,
    ngay: req.ngay,
    loaiTien: req.loai_tien,
    nguoiDeNghiTen: req.nguoi_de_nghi_ten || detail.names[req.nguoi_de_nghi_id] || "",
    nguoiDeNghiChucVu: approvers.myChucVu,
    boPhan: req.bo_phan ?? null,
    giamDocChucVu: chucVuOf(approvers.giamDoc, req.giam_doc_user_id),
    keToanChucVu: chucVuOf(approvers.keToan, req.ke_toan_user_id),
    ghiChu: req.loai === "dieu_chinh" ? null : req.ghi_chu,
    adjustment: req.loai === "dieu_chinh"
      ? {
          parentSoPhieu: detail.parent ? formatSoPhieuFull(detail.parent.so, detail.parent.nam) : "—",
          lyDo: req.ly_do_dieu_chinh || "",
        }
      : null,
    lines: detail.lines.map((l) => ({
      truoc: req.loai === "dieu_chinh"
        ? { item_code: l.truoc_item_code ?? null, item_name: l.truoc_item_name ?? null, so_luong: l.truoc_so_luong ?? null, don_gia: l.truoc_don_gia ?? null }
        : null,
      item_code: l.item_code,
      item_name: l.item_name,
      unit: l.unit,
      so_luong: Number(l.so_luong),
      don_gia: Number(l.don_gia),
      thanh_tien: Number(l.thanh_tien),
      muc_dich: l.muc_dich,
      ghi_chu: l.ghi_chu,
      la_vat_tu_moi: l.la_vat_tu_moi,
      lech_gia_pct: l.lech_gia_pct,
      ly_do_lech_gia: l.ly_do_lech_gia,
      mua_tai: l.mua_tai ?? null,
      ngay_co_hang: l.ngay_co_hang ?? null,
      ngay_can_hang: l.ngay_can_hang ?? null,
      insight: snapshots[l.id] ?? null,
    })),
    qrUrl: `${window.location.origin}/dashboard/purchase/${requestId}`,
  })

  const fieldsByRole = {} as Record<PurchaseSignRole, SigningFieldInput[]>
  for (const role of Object.keys(PURCHASE_SIGN_ORDER) as PurchaseSignRole[]) {
    const b = pdf.boxesByRole[role]
    const nhan = PURCHASE_SIGN_ORDER[role].label
    fieldsByRole[role] = [
      { page: b.page, ...jsPdfBoxToPt(pdf.pageHeightMm, b.chuKyBox), loai: "chu_ky", nhan },
      { page: b.page, ...jsPdfBoxToPt(pdf.pageHeightMm, b.tenBox), loai: "ten", nhan },
    ]
  }

  const res = await authFetch(`/api/purchase/requests/${requestId}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileBase64: bytesToBase64(pdf.bytes), fieldsByRole }),
  })
  const json = await readJson<{ yeuCauId: string }>(res)
  return json.yeuCauId
}

export async function updateLineImages(requestId: string, lineId: string, imageUrls: string[]) {
  return readJson<{ ok: boolean; imageUrls: string[] }>(await authFetch(`/api/purchase/requests/${requestId}/line-images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lineId, imageUrls }),
  }))
}
