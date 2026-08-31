"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import type { SessionUser } from "@/lib/auth"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { buildQualityKqknPdfForSigning, type QualityKqknResult } from "@/lib/quality-pdf"
import { jsPdfBoxToPt } from "@/lib/signing/coords"

type DeptLeader = { id: string; full_name: string; username: string; chuc_vu: string }

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export function QualitySignModal({
  open,
  onClose,
  factoryId,
  currentUser,
  dateResults,
  maHoSo,
  factoryCode,
}: {
  open: boolean
  onClose: () => void
  factoryId: string
  currentUser: SessionUser
  dateResults: QualityKqknResult[]
  maHoSo: string
  factoryCode: string
}) {
  const router = useRouter()
  const [approvers, setApprovers] = useState<DeptLeader[]>([])
  const [loadingApprovers, setLoadingApprovers] = useState(true)
  const [approverId, setApproverId] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  // Tự nhận diện Trưởng/Phó phòng QLCL — mirror đúng luồng "Nội bộ đơn vị" của module Văn bản
  // (dept-leader/route.ts): dò chuc_vu trong Nhân sự bảo trì khớp phòng ban QLCL + đã có quyền
  // quality.phe_duyet. Không còn cho chọn tay từ danh sách admin/manager rộng.
  useEffect(() => {
    if (!open) return
    setError("")
    setApproverId("")
    setLoadingApprovers(true)
    fetch(`/api/documents/dept-leader?factoryId=${factoryId}&dept=QLCL&permission=quality.phe_duyet`)
      .then((r) => r.json())
      .then((list: DeptLeader[]) => {
        const rows = Array.isArray(list) ? list : []
        setApprovers(rows)
        if (rows.length === 1) setApproverId(rows[0].id)
      })
      .catch(() => setApprovers([]))
      .finally(() => setLoadingApprovers(false))
  }, [open, factoryId])

  if (!open) return null

  const handleSubmit = async () => {
    if (!approverId) {
      setError("Vui lòng chọn người phê duyệt")
      return
    }
    setSubmitting(true)
    setError("")
    try {
      const { bytes, pages } = await buildQualityKqknPdfForSigning(dateResults, factoryCode)

      const lapFields: Array<{ page: number; xPt: number; yPt: number; wPt: number; hPt: number; loai: "chu_ky" | "ten"; nhan: string }> = []
      const pheDuyetFields: typeof lapFields = []
      for (const p of pages) {
        const lapChuKy = jsPdfBoxToPt(p.pageHeightMm, p.nguoiLap.chuKyBox)
        const lapTen = jsPdfBoxToPt(p.pageHeightMm, p.nguoiLap.tenBox)
        lapFields.push({ page: p.pageNumber, ...lapChuKy, loai: "chu_ky", nhan: "Lập biểu" })
        lapFields.push({ page: p.pageNumber, ...lapTen, loai: "ten", nhan: "Lập biểu" })

        const pdChuKy = jsPdfBoxToPt(p.pageHeightMm, p.nguoiPheDuyet.chuKyBox)
        const pdTen = jsPdfBoxToPt(p.pageHeightMm, p.nguoiPheDuyet.tenBox)
        pheDuyetFields.push({ page: p.pageNumber, ...pdChuKy, loai: "chu_ky", nhan: "Trưởng phòng QLCL" })
        pheDuyetFields.push({ page: p.pageNumber, ...pdTen, loai: "ten", nhan: "Trưởng phòng QLCL" })
      }

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
          modun: "quality",
          loaiTaiLieu: "quality_kqkn",
          maHoSo,
          fileBase64: bytesToBase64(bytes),
          fileExt: "pdf",
          signers: [
            { userId: currentUser.id, thuTu: 10, vaiTro: "ky", fields: lapFields },
            { userId: approverId, thuTu: 20, vaiTro: "phe_duyet", fields: pheDuyetFields },
          ],
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
      title="Ký duyệt Phiếu KQKN"
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
            disabled={submitting || loadingApprovers || !approvers.length}
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
          Bạn sẽ ký vai trò <b>Lập biểu</b>. Người ký vai trò <b>Trưởng phòng QLCL</b> được hệ
          thống tự nhận diện bên dưới.
        </p>
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Trưởng phòng QLCL phê duyệt</label>
          {loadingApprovers ? (
            <div className="text-sm text-slate-400">Đang tự nhận diện...</div>
          ) : approvers.length === 0 ? (
            <p className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              Chưa xác định được Trưởng/Phó phòng QLCL có đủ điều kiện phê duyệt. Kiểm tra: (1)
              Chức vụ (&quot;Trưởng phòng&quot; hoặc &quot;Phó phòng&quot;) đúng phòng ban QLCL
              trong Cài đặt → Bảo trì → Nhân sự bảo trì, và (2) quyền
              <code className="mx-1 bg-red-100 px-1 rounded">quality.phe_duyet</code>
              đã được cấp trong Cài đặt → Phân quyền.
            </p>
          ) : approvers.length === 1 ? (
            <div className="flex items-center gap-2 px-3 py-2 border border-emerald-200 bg-emerald-50 rounded-xl">
              <span className="text-sm font-bold text-slate-800">
                {approvers[0].full_name || approvers[0].username}
              </span>
              <span className="text-xs text-slate-500">— {approvers[0].chuc_vu}</span>
              <span className="ml-auto px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-full">
                Tự động xác định
              </span>
            </div>
          ) : (
            <select
              value={approverId}
              onChange={(e) => setApproverId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
            >
              <option value="">— Chọn người phê duyệt —</option>
              {approvers.map((a) => (
                <option key={a.id} value={a.id}>{(a.full_name || a.username)} — {a.chuc_vu}</option>
              ))}
            </select>
          )}
        </div>
        {error && <p className="text-sm font-bold text-red-600">{error}</p>}
      </div>
    </ModalShell>
  )
}
