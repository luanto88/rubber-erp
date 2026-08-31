"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import type { SessionUser } from "@/lib/auth"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { buildDispatchAnalytics, type DispatchAnalyticsEntry } from "@/lib/dispatch-analytics"
import { buildDispatchEntryPdfForSigning } from "@/lib/dispatch-pdf"
import { jsPdfBoxToPt } from "@/lib/signing/coords"
import type { DiemGN } from "@/lib/dispatch-master"

type GiamDoc = { id: string; full_name: string; username: string }

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export function DispatchSignModal({
  open,
  onClose,
  factoryId,
  currentUser,
  entry,
  deliveryPoints,
  factoryName,
}: {
  open: boolean
  onClose: () => void
  factoryId: string
  currentUser: SessionUser
  entry: DispatchAnalyticsEntry
  deliveryPoints: DiemGN[]
  factoryName: string
}) {
  const router = useRouter()
  const [approvers, setApprovers] = useState<GiamDoc[]>([])
  const [loadingApprovers, setLoadingApprovers] = useState(true)
  const [approverId, setApproverId] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  // Tự nhận diện "Giám đốc nhà máy" — mirror đúng luồng của module Chất lượng
  // (dept-leader/route.ts) nhưng dùng route riêng (Giám đốc không thuộc 1 phòng ban cụ
  // thể như QLCL, nên không gọi được dept-leader vốn bắt buộc tham số `dept`).
  useEffect(() => {
    if (!open) return
    setError("")
    setApproverId("")
    setLoadingApprovers(true)
    fetch(`/api/dispatch/approvers?factoryId=${factoryId}`)
      .then((r) => r.json())
      .then((list: GiamDoc[]) => {
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
      // Dùng toàn bộ dữ liệu thật của ngày (entry.rows đầy đủ) — không áp filter đang
      // bật trên màn hình danh sách, để tài liệu đã ký luôn phản ánh đúng dữ liệu gốc.
      const { trips } = buildDispatchAnalytics([entry], deliveryPoints)
      if (!trips.length) {
        setError("Không có dữ liệu chuyến để ký duyệt")
        return
      }
      const { bytes, page } = await buildDispatchEntryPdfForSigning({ entry, trips, factoryName })

      const lapBangChuKy = jsPdfBoxToPt(page.pageHeightMm, page.lapBang.chuKyBox)
      const lapBangTen = jsPdfBoxToPt(page.pageHeightMm, page.lapBang.tenBox)
      const giamDocChuKy = jsPdfBoxToPt(page.pageHeightMm, page.giamDoc.chuKyBox)
      const giamDocTen = jsPdfBoxToPt(page.pageHeightMm, page.giamDoc.tenBox)

      const lapFields = [
        { page: page.pageNumber, ...lapBangChuKy, loai: "chu_ky" as const, nhan: "Lập bảng" },
        { page: page.pageNumber, ...lapBangTen, loai: "ten" as const, nhan: "Lập bảng" },
      ]
      const pheDuyetFields = [
        { page: page.pageNumber, ...giamDocChuKy, loai: "chu_ky" as const, nhan: "Giám đốc nhà máy" },
        { page: page.pageNumber, ...giamDocTen, loai: "ten" as const, nhan: "Giám đốc nhà máy" },
      ]

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
          modun: "dispatch",
          loaiTaiLieu: "dispatch_bang_phan_xe",
          maHoSo: entry.id,
          banGhiId: entry.id,
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
      title="Ký duyệt bảng phân xe"
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
          Bạn sẽ ký vai trò <b>Lập bảng</b>. Người ký vai trò <b>Giám đốc nhà máy</b> được hệ
          thống tự nhận diện bên dưới.
        </p>
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Giám đốc nhà máy phê duyệt</label>
          {loadingApprovers ? (
            <div className="text-sm text-slate-400">Đang tự nhận diện...</div>
          ) : approvers.length === 0 ? (
            <p className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              Chưa xác định được Giám đốc nhà máy có đủ điều kiện phê duyệt. Kiểm tra: (1)
              Chức vụ đúng nguyên văn &quot;Giám đốc&quot; trong Cài đặt → Bảo trì → Nhân
              sự bảo trì, và (2) quyền
              <code className="mx-1 bg-red-100 px-1 rounded">dispatch.phe_duyet</code>
              đã được cấp trong Cài đặt → Phân quyền.
            </p>
          ) : approvers.length === 1 ? (
            <div className="flex items-center gap-2 px-3 py-2 border border-emerald-200 bg-emerald-50 rounded-xl">
              <span className="text-sm font-bold text-slate-800">
                {approvers[0].full_name || approvers[0].username}
              </span>
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
                <option key={a.id} value={a.id}>{a.full_name || a.username}</option>
              ))}
            </select>
          )}
        </div>
        {error && <p className="text-sm font-bold text-red-600">{error}</p>}
      </div>
    </ModalShell>
  )
}
