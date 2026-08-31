"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, Loader2, XCircle } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import {
  buildMaintenanceSuCoNhoPdfForSigning, buildMaintenanceBaoDuongPdfForSigning,
  buildMaintenanceBaoDuongXePdfForSigning, buildMaintenanceSuaChuaNhoXePdfForSigning,
  type LineData, type MaterialRow, type RecordData,
  type MaintenanceSignBundle, type MaintenanceSignRoleId, type MaintenanceSigningResult,
} from "@/lib/maintenance-pdf"
import { jsPdfBoxToPt } from "@/lib/signing/coords"

type ResolvedSigner = {
  roleId: MaintenanceSignRoleId
  roleLabel: string
  name: string | null
  userId: string | null
  fullName: string | null
  resolved: boolean
  reason: string | null
}

// Thứ tự ký DÙNG CHUNG cho cả 4 bundle (đính chính 2026-09, KHÔNG theo thứ tự cột in trên PDF —
// cột in vẫn giữ nguyên theo đúng mẫu KHXD-QT02, chỉ thứ tự KÝ ĐIỆN TỬ đổi): Nhân viên phụ
// trách ký trước (gộp luôn vị trí Tổ trưởng cơ điện/cơ khí và Tài xế — các vai trò không có
// tài khoản riêng) → BGĐ phụ trách → Giám đốc nhà máy (ký sau cùng, người phê duyệt cuối).
const ROLE_ORDER: Record<MaintenanceSignRoleId, { thuTu: number; vaiTro: "ky" | "phe_duyet" }> = {
  nv_phu_trach: { thuTu: 10, vaiTro: "ky" },
  to_co_dien: { thuTu: 15, vaiTro: "ky" },
  tai_xe: { thuTu: 16, vaiTro: "ky" },
  bgd_phu_trach: { thuTu: 20, vaiTro: "ky" },
  giam_doc: { thuTu: 40, vaiTro: "phe_duyet" },
}

type BundleConfig = {
  modalTitle: string
  docLabel: string
  build: (record: RecordData, qrUrl: string, staffMap: Map<string, string>) => Promise<MaintenanceSigningResult>
}

const BUNDLE_CONFIG: Record<MaintenanceSignBundle, BundleConfig> = {
  su_co_nho: { modalTitle: "Ký duyệt biên bản sự cố", docLabel: "F13 + F10 + F15", build: buildMaintenanceSuCoNhoPdfForSigning },
  bao_duong: { modalTitle: "Ký duyệt biên bản bảo dưỡng", docLabel: "F03 + F15", build: buildMaintenanceBaoDuongPdfForSigning },
  bao_duong_xe: { modalTitle: "Ký duyệt biên bản bảo dưỡng", docLabel: "F03 + F15 + F06", build: buildMaintenanceBaoDuongXePdfForSigning },
  sua_chua_nho_xe: { modalTitle: "Ký duyệt biên bản sửa chữa nhỏ", docLabel: "F08 + F15 + F06", build: buildMaintenanceSuaChuaNhoXePdfForSigning },
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

// Tải lại toàn bộ dữ liệu biên bản trực tiếp từ DB (không dùng state form đang sửa của trang
// chi tiết — form đó dùng shape DraftLine/DraftMaterial khác hẳn RecordData/LineData của
// maintenance-pdf.ts) — mirror đúng cách maintenance/print/page.tsx tải dữ liệu cho su_co_nho.
async function loadRecordForSigning(recordId: string, factoryId: string): Promise<{ record: RecordData; staffMap: Map<string, string> } | null> {
  const { data: rec } = await supabase
    .from("maintenance_records")
    .select("*")
    .eq("id", recordId)
    .eq("factory_id", factoryId)
    .single()
  if (!rec) return null

  const { data: rawLines } = await supabase
    .from("maintenance_record_lines")
    .select("*")
    .eq("record_id", recordId)
    .order("sort_order")

  const lines: LineData[] = []
  for (const ln of rawLines || []) {
    const { data: mats } = await supabase
      .from("maintenance_materials")
      .select("*")
      .eq("line_id", ln.id)
      .order("sort_order")
    lines.push({ ...(ln as Omit<LineData, "materials">), materials: (mats || []) as MaterialRow[] })
  }
  const record = { ...(rec as Omit<RecordData, "lines">), lines }

  const { data: staffData } = await supabase
    .from("maintenance_staff")
    .select("ten, chuc_vu")
    .eq("factory_id", factoryId)
    .eq("active", true)
  const staffMap = new Map<string, string>()
  for (const s of (staffData || []) as { ten: string; chuc_vu: string | null }[]) {
    if (s.ten && s.chuc_vu) staffMap.set(s.ten, s.chuc_vu)
  }

  return { record, staffMap }
}

export function MaintenanceSignModal({
  open,
  onClose,
  factoryId,
  recordId,
  maBb,
  bundle,
}: {
  open: boolean
  onClose: () => void
  factoryId: string
  recordId: string
  maBb: string | null
  bundle: MaintenanceSignBundle
}) {
  const router = useRouter()
  const config = BUNDLE_CONFIG[bundle]
  const [signers, setSigners] = useState<ResolvedSigner[]>([])
  const [loadingSigners, setLoadingSigners] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    setError("")
    setLoadingSigners(true)
    fetch(`/api/maintenance/su-co-nho-signers?factoryId=${factoryId}&recordId=${recordId}&type=${bundle}`)
      .then((r) => r.json())
      .then((json: { signers?: ResolvedSigner[]; error?: string }) => {
        if (json.error) { setError(json.error); setSigners([]); return }
        setSigners(json.signers || [])
      })
      .catch(() => setError("Không tải được danh sách người ký"))
      .finally(() => setLoadingSigners(false))
  }, [open, factoryId, recordId, bundle])

  if (!open) return null

  const allResolved = signers.length > 0 && signers.every((s) => s.resolved)

  const handleSubmit = async () => {
    if (!allResolved) return
    setSubmitting(true)
    setError("")
    try {
      const loaded = await loadRecordForSigning(recordId, factoryId)
      if (!loaded) {
        setError("Không tải được dữ liệu biên bản")
        return
      }
      const qrUrl = `${window.location.origin}/dashboard/maintenance/records/${recordId}`
      const { bytes, pageHeightMm, boxesByRole } = await config.build(loaded.record, qrUrl, loaded.staffMap)

      // Gộp theo userId — 1 người có thể được gán cùng lúc cho 2 vai trò trên biên bản (vd
      // "Nhân viên phụ trách" cũng là "Tổ trưởng cơ điện" của chính họ). `nguoi_ky` có unique
      // constraint (yeu_cau_id, user_id) — nếu tạo 2 dòng người ký trùng userId sẽ lỗi DB. Gộp
      // tất cả field của các vai trò trùng người vào ĐÚNG 1 signer (đúng tinh thần "nhân bản
      // khung" — 1 người ký ở nhiều vị trí); vai_tro lấy theo vai trò có thu_tu lớn nhất (nếu
      // gộp với Giám đốc nhà máy — thu_tu cao nhất — người đó coi như phe_duyet).
      type SignerField = { page: number; xPt: number; yPt: number; wPt: number; hPt: number; loai: "chu_ky" | "ten"; nhan: string }
      const signerMap = new Map<string, { userId: string; thuTu: number; maxThuTu: number; vaiTro: "ky" | "phe_duyet"; fields: SignerField[] }>()
      for (const s of signers) {
        const boxes = boxesByRole[s.roleId] || []
        const fields = boxes.flatMap((b) => [
          { page: b.page, ...jsPdfBoxToPt(pageHeightMm, b.chuKyBox), loai: "chu_ky" as const, nhan: s.roleLabel },
          { page: b.page, ...jsPdfBoxToPt(pageHeightMm, b.tenBox), loai: "ten" as const, nhan: s.roleLabel },
        ])
        const order = ROLE_ORDER[s.roleId]
        const uid = s.userId as string
        const existing = signerMap.get(uid)
        if (existing) {
          existing.fields.push(...fields)
          existing.thuTu = Math.min(existing.thuTu, order.thuTu)
          if (order.thuTu > existing.maxThuTu) { existing.maxThuTu = order.thuTu; existing.vaiTro = order.vaiTro }
        } else {
          signerMap.set(uid, { userId: uid, thuTu: order.thuTu, maxThuTu: order.thuTu, vaiTro: order.vaiTro, fields })
        }
      }
      const signerInputs = Array.from(signerMap.values()).map((v) => ({
        userId: v.userId, thuTu: v.thuTu, vaiTro: v.vaiTro, fields: v.fields,
      }))

      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) {
        setError("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại")
        return
      }

      const res = await fetch("/api/signing/create-request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          factoryId,
          modun: "maintenance",
          loaiTaiLieu: bundle,
          maHoSo: recordId,
          banGhiId: recordId,
          fileBase64: bytesToBase64(bytes),
          fileExt: "pdf",
          signers: signerInputs,
        }),
      })
      const json = (await res.json()) as { yeuCauId?: string; error?: string }
      if (!res.ok || !json.yeuCauId) {
        setError(json.error || "Không tạo được yêu cầu ký")
        return
      }
      router.push(`/dashboard/ky/${json.yeuCauId}`)
    } catch {
      setError("Không tạo được yêu cầu ký, vui lòng thử lại")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell
      title={config.modalTitle}
      onClose={onClose}
      maxWidth="sm"
      footer={
        <>
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl disabled:opacity-50"
          >
            Hủy
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || loadingSigners || !allResolved}
            className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md disabled:opacity-60"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Tạo yêu cầu ký
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Ký điện tử cho bộ chứng từ {config.docLabel}{maBb ? ` — biên bản ${maBb}` : ""}. Những
          người dưới đây sẽ lần lượt được yêu cầu ký; vai trò không có tài khoản đăng nhập riêng
          (nếu có) sẽ do <b>Nhân viên phụ trách</b> ký thay.
        </p>
        {loadingSigners ? (
          <div className="text-sm text-slate-400">Đang tự nhận diện người ký...</div>
        ) : (
          <div className="space-y-2">
            {signers.map((s) => (
              <div
                key={s.roleId}
                className={`flex items-start gap-2 px-3 py-2 rounded-xl border text-sm ${
                  s.resolved ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"
                }`}
              >
                {s.resolved ? (
                  <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <XCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <p className="font-bold text-slate-800">{s.roleLabel}</p>
                  {s.resolved ? (
                    <p className="text-slate-600">{s.fullName}</p>
                  ) : (
                    <p className="text-xs font-semibold text-red-600">{s.reason}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {error && <p className="text-sm font-bold text-red-600">{error}</p>}
      </div>
    </ModalShell>
  )
}
