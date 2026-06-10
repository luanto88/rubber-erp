"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, hydrateActiveSession, hasPermission } from "@/lib/auth"
import { DocumentsShell } from "../_components/documents-shell"
import {
  LOAI_VAN_BAN_LABEL,
  TRANG_THAI_COLOR,
  TRANG_THAI_LABEL,
  PHAN_LOAI_LABEL,
  PHAN_LOAI_COLOR,
  fmtDate,
  type VanBanDocument,
  type ThuTuKyStep,
} from "../_components/documents-types"
import { Lock } from "lucide-react"
import {
  AlertTriangle,
  X,
  CheckCircle2,
  Clock,
  FileText,
  Send,
  RotateCcw,
  Eye,
  ArrowLeft,
  PenLine,
  ShieldCheck,
} from "lucide-react"
import type { SessionUser } from "@/lib/auth"

type NguoiKyEntry = { ten: string; chuc_vu: string; ky_at: string }

export default function DocumentDetailPage() {
  const params = useParams()
  const router = useRouter()
  const docId = params.id as string

  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [userDeptCode, setUserDeptCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [doc, setDoc] = useState<VanBanDocument | null>(null)

  const [actionError, setActionError] = useState<string | null>(null)
  const [actionOk, setActionOk] = useState<string | null>(null)
  const [acting, setActing] = useState(false)

  // PIN modal
  const [pinModal, setPinModal] = useState<"ky_buoc" | "phe_duyet" | null>(null)
  const [pin, setPin] = useState("")
  const [pinError, setPinError] = useState<string | null>(null)

  // Trả về modal
  const [traVeModal, setTraVeModal] = useState(false)
  const [traVeLyDo, setTraVeLyDo] = useState("")

  // Fetch department code via admin API
  const resolveUserDeptCode = useCallback(async (uid: string) => {
    try {
      const res = await fetch(`/api/documents/dept-code?userId=${uid}`)
      if (res.ok) {
        const json = (await res.json()) as { code: string | null }
        setUserDeptCode(json.code)
      }
    } catch { /* ignore */ }
  }, [])

  const loadDoc = useCallback(async (fid: string) => {
    const { data } = await supabase
      .from("van_ban_documents")
      .select("*")
      .eq("id", docId)
      .eq("factory_id", fid)
      .single()
    setDoc(data as VanBanDocument | null)
  }, [docId])

  useEffect(() => {
    const bootstrap = async () => {
      const fid = await getActiveFactoryId()
      if (!fid) { setLoading(false); return }
      setFactoryId(fid)

      const { user: sessionUser } = await hydrateActiveSession()
      if (sessionUser) {
        setUser(sessionUser)
        void resolveUserDeptCode(sessionUser.id)
      }
      setLoading(false)
    }
    void bootstrap()
  }, [resolveUserDeptCode])

  useEffect(() => {
    if (factoryId) {
      setLoading(true)
      void loadDoc(factoryId).finally(() => setLoading(false))
    }
  }, [factoryId, loadDoc])

  const getAuthToken = async () => {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token || ""
  }

  const doAction = async (action: string, extra?: Record<string, string>) => {
    if (!factoryId || !doc) return
    setActing(true)
    setActionError(null)
    try {
      const token = await getAuthToken()
      const res = await fetch("/api/documents/sign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ docId: doc.id, factoryId, action, ...extra }),
      })
      const json = (await res.json()) as { ok?: boolean; error?: string; trang_thai?: string }
      if (!res.ok || !json.ok) throw new Error(json.error || "Lỗi thực hiện")
      setActionOk(`Thao tác thành công!`)
      setTimeout(() => setActionOk(null), 3000)
      void loadDoc(factoryId)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setActing(false)
    }
  }

  const handleGuiKy = () => void doAction("gui_ky")

  const handleKyBuoc = async () => {
    if (!pin.trim()) { setPinError("Vui lòng nhập PIN"); return }
    setActing(true)
    setPinError(null)
    if (!factoryId || !doc) return
    try {
      const token = await getAuthToken()
      const res = await fetch("/api/documents/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ docId: doc.id, factoryId, action: "ky_buoc", pin }),
      })
      const json = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) { setPinError(json.error || "Lỗi ký"); return }
      setPinModal(null)
      setPin("")
      setActionOk("Ký thành công!")
      setTimeout(() => setActionOk(null), 3000)
      void loadDoc(factoryId)
    } catch (err) {
      setPinError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setActing(false)
    }
  }

  const handlePheDuyet = async () => {
    if (!pin.trim()) { setPinError("Vui lòng nhập PIN"); return }
    setActing(true)
    setPinError(null)
    if (!factoryId || !doc) return
    try {
      const token = await getAuthToken()
      const res = await fetch("/api/documents/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ docId: doc.id, factoryId, action: "phe_duyet", pin }),
      })
      const json = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) { setPinError(json.error || "Lỗi phê duyệt"); return }
      setPinModal(null)
      setPin("")
      setActionOk("Phê duyệt thành công!")
      setTimeout(() => setActionOk(null), 3000)
      // Bug 6c: Cập nhật AI embedding sau khi phê duyệt (fire-and-forget)
      void fetch("/api/documents/embed-doc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId: doc.id, factoryId }),
      }).catch(() => {})
      void loadDoc(factoryId)
    } catch (err) {
      setPinError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setActing(false)
    }
  }

  const handleTraVe = () => void doAction("tra_ve", { ly_do: traVeLyDo }).then(() => {
    setTraVeModal(false)
    setTraVeLyDo("")
  })

  if (loading) {
    return (
      <DocumentsShell>
        <div className="p-12 text-center text-slate-400">Đang tải...</div>
      </DocumentsShell>
    )
  }

  if (!doc) {
    return (
      <DocumentsShell>
        <div className="p-12 text-center text-slate-400">
          <FileText size={40} className="mx-auto mb-3 opacity-30" />
          <p>Không tìm thấy văn bản</p>
          <button onClick={() => router.push("/dashboard/documents")} className="mt-4 text-blue-600 underline text-sm">
            Quay lại danh sách
          </button>
        </div>
      </DocumentsShell>
    )
  }

  const isAdmin = user?.role === "admin"

  // Determine actions
  const isSoanThao = doc.soan_thao_user_id === user?.id || isAdmin
  const canGuiKy = isSoanThao && (doc.trang_thai === "draft" || doc.trang_thai === "tra_ve")

  // Ký bước: kiểm tra bước hiện tại có thuộc phòng ban của user không
  let canKyBuoc = false
  let currentStep: ThuTuKyStep | null = null
  if (doc.trang_thai === "cho_ky_phong_ban" && user) {
    const stepIndex = doc.buoc_hien_tai
    currentStep = (doc.thu_tu_ky_json || [])[stepIndex] || null
    if (currentStep) {
      if (isAdmin) {
        canKyBuoc = true
      } else if (currentStep.type === "phong_ban" && userDeptCode === currentStep.phong_ban_code) {
        canKyBuoc = true
      } else if (currentStep.type === "ca_nhan" && currentStep.user_id === user.id) {
        canKyBuoc = true
      }
    }
  }

  const canPheDuyet = doc.trang_thai === "cho_phe_duyet" && (isAdmin || hasPermission(user, "documents.phe_duyet"))

  const canTraVe =
    (doc.trang_thai === "cho_ky_phong_ban" && (canKyBuoc || isAdmin || hasPermission(user, "documents.phe_duyet"))) ||
    (doc.trang_thai === "cho_phe_duyet" && (isAdmin || hasPermission(user, "documents.phe_duyet")))

  const fileUrl = doc.file_signed_pdf_url || doc.file_signed_office_url || doc.file_goc_url

  return (
    <DocumentsShell>
      {/* Toasts */}
      {actionError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 bg-red-600 text-white rounded-2xl shadow-2xl max-w-xl">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="text-sm font-bold">{actionError}</span>
          <button onClick={() => setActionError(null)} className="ml-2 hover:opacity-70"><X size={14} /></button>
        </div>
      )}
      {actionOk && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 bg-emerald-600 text-white rounded-2xl shadow-2xl">
          <CheckCircle2 size={16} />
          <span className="text-sm font-bold">{actionOk}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => router.push("/dashboard/documents")}
          className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-extrabold text-slate-800">{doc.ten_van_ban}</h1>
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold ${TRANG_THAI_COLOR[doc.trang_thai]}`}>
              {TRANG_THAI_LABEL[doc.trang_thai]}
            </span>
            {doc.phan_loai && doc.phan_loai !== "Thuong" && (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${PHAN_LOAI_COLOR[doc.phan_loai] || "bg-red-100 text-red-700 border border-red-200"}`}>
                <Lock size={10} />
                {PHAN_LOAI_LABEL[doc.phan_loai] || doc.phan_loai}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-400 mt-0.5 font-mono">{doc.ma_van_ban || "Chưa có số văn bản"}</p>
        </div>
        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          {fileUrl && (
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition-all"
            >
              <Eye size={15} />
              Xem file
            </a>
          )}
          {canGuiKy && (
            <button
              onClick={handleGuiKy}
              disabled={acting}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl shadow-md transition-all"
            >
              <Send size={15} />
              Gửi ký
            </button>
          )}
          {canKyBuoc && (
            <button
              onClick={() => { setPinModal("ky_buoc"); setPin(""); setPinError(null) }}
              disabled={acting}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-xl shadow-md transition-all"
            >
              <PenLine size={15} />
              Ký phòng ban
            </button>
          )}
          {canPheDuyet && (
            <button
              onClick={() => { setPinModal("phe_duyet"); setPin(""); setPinError(null) }}
              disabled={acting}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl shadow-md transition-all"
            >
              <ShieldCheck size={15} />
              Phê duyệt
            </button>
          )}
          {canTraVe && (
            <button
              onClick={() => { setTraVeModal(true); setTraVeLyDo("") }}
              disabled={acting}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-xl shadow-md transition-all"
            >
              <RotateCcw size={15} />
              Trả về
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Thông tin văn bản */}
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-sm font-bold text-slate-700 mb-4">Thông tin văn bản</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <InfoRow label="Loại văn bản" value={doc.loai_van_ban ? (LOAI_VAN_BAN_LABEL[doc.loai_van_ban] || doc.loai_van_ban) : "—"} />
              <InfoRow label="Phòng ban" value={doc.phong_ban || "—"} />
              <InfoRow label="Cấp văn bản" value={doc.cap_tl || "—"} />
              <InfoRow label="Phân loại" value={doc.phan_loai ? (PHAN_LOAI_LABEL[doc.phan_loai] || doc.phan_loai) : "Thường"} />
              <InfoRow label="Người soạn thảo" value={doc.nguoi_soan_thao_display || "—"} />
              <InfoRow label="Người phê duyệt" value={doc.phe_duyet || "—"} />
              <InfoRow label="Ngày phê duyệt" value={fmtDate(doc.ngay_phe_duyet)} />
            </div>
            {doc.ghi_chu && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <p className="text-xs font-bold text-slate-500 mb-1">Ghi chú</p>
                <p className="text-sm text-slate-700">{doc.ghi_chu}</p>
              </div>
            )}
          </div>

          {/* Trả về info */}
          {doc.trang_thai === "tra_ve" && doc.tra_ve_ly_do && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <RotateCcw size={14} className="text-rose-600" />
                <span className="text-sm font-bold text-rose-700">Văn bản bị trả về</span>
              </div>
              <p className="text-sm text-rose-600">
                <strong>{doc.tra_ve_nguoi}</strong> trả về bước {doc.tra_ve_step != null ? doc.tra_ve_step + 1 : ""}: {doc.tra_ve_ly_do}
              </p>
              {doc.tra_ve_at && (
                <p className="text-xs text-rose-400 mt-1">{fmtDate(doc.tra_ve_at)}</p>
              )}
            </div>
          )}
        </div>

        {/* Timeline ký */}
        <div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h2 className="text-sm font-bold text-slate-700 mb-4">Tiến trình ký duyệt</h2>
            <div className="space-y-3">
              {/* Soạn thảo */}
              <TimelineStep
                label="Soạn thảo"
                sublabel={doc.nguoi_soan_thao_display || ""}
                done={true}
                at={doc.created_at}
              />

              {/* Từng bước ký phòng ban */}
              {(doc.thu_tu_ky_json || []).map((step: ThuTuKyStep, i) => {
                const nguoiKyEntry = (doc.nguoi_ky as Record<string, NguoiKyEntry>)[String(i + 1)]
                const isCurrentStep = doc.trang_thai === "cho_ky_phong_ban" && doc.buoc_hien_tai === i
                return (
                  <TimelineStep
                    key={i}
                    label={`Bước ${i + 1}: ${step.phong_ban_code || step.ten || ""}`}
                    sublabel={nguoiKyEntry?.ten || (isCurrentStep ? "Đang chờ ký..." : "Chờ")}
                    done={!!nguoiKyEntry}
                    pending={isCurrentStep}
                    at={nguoiKyEntry?.ky_at}
                  />
                )
              })}

              {/* Phê duyệt cuối */}
              <TimelineStep
                label="Phê duyệt"
                sublabel={
                  doc.trang_thai === "da_phe_duyet"
                    ? doc.phe_duyet || "Đã phê duyệt"
                    : doc.trang_thai === "cho_phe_duyet"
                      ? "Đang chờ phê duyệt..."
                      : doc.phe_duyet || "Chờ phê duyệt"
                }
                done={doc.trang_thai === "da_phe_duyet"}
                pending={doc.trang_thai === "cho_phe_duyet"}
                at={doc.ngay_phe_duyet || undefined}
              />
            </div>
          </div>
        </div>
      </div>

      {/* PIN Modal */}
      {pinModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-800">
                {pinModal === "ky_buoc" ? "Ký phòng ban" : "Phê duyệt văn bản"}
              </h3>
              <button onClick={() => { setPinModal(null); setPin(""); setPinError(null) }} className="text-slate-400 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>
            {pinModal === "ky_buoc" && currentStep && (
              <p className="text-sm text-slate-600 mb-4">
                Bước {doc.buoc_hien_tai + 1}: Ký cho phòng ban <strong>{currentStep.phong_ban_code}</strong>
              </p>
            )}
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">PIN ký duyệt</label>
              <input
                type="password"
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500 tracking-widest"
                placeholder="Nhập PIN..."
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void (pinModal === "ky_buoc" ? handleKyBuoc() : handlePheDuyet())
                  }
                }}
                autoFocus
              />
              {pinError && <p className="text-xs text-red-600 mt-1.5">{pinError}</p>}
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => void (pinModal === "ky_buoc" ? handleKyBuoc() : handlePheDuyet())}
                disabled={acting || !pin.trim()}
                className="flex-1 py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl transition-all"
              >
                {acting ? "Đang xử lý..." : "Xác nhận"}
              </button>
              <button
                onClick={() => { setPinModal(null); setPin(""); setPinError(null) }}
                disabled={acting}
                className="px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
              >
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Trả về Modal */}
      {traVeModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-800">Trả về văn bản</h3>
              <button onClick={() => setTraVeModal(false)} className="text-slate-400 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Lý do trả về (tùy chọn)</label>
              <textarea
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500 resize-none"
                rows={3}
                placeholder="Nhập lý do hoặc yêu cầu chỉnh sửa..."
                value={traVeLyDo}
                onChange={(e) => setTraVeLyDo(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleTraVe}
                disabled={acting}
                className="flex-1 py-2.5 text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-xl transition-all"
              >
                {acting ? "Đang xử lý..." : "Trả về"}
              </button>
              <button
                onClick={() => setTraVeModal(false)}
                disabled={acting}
                className="px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
              >
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}
    </DocumentsShell>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-bold text-slate-400 mb-0.5">{label}</dt>
      <dd className="text-slate-700">{value || "—"}</dd>
    </div>
  )
}

function TimelineStep({
  label,
  sublabel,
  done,
  pending,
  at,
}: {
  label: string
  sublabel: string
  done: boolean
  pending?: boolean
  at?: string | null
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="shrink-0 mt-0.5">
        {done ? (
          <CheckCircle2 size={18} className="text-emerald-500" />
        ) : pending ? (
          <Clock size={18} className="text-amber-500" />
        ) : (
          <div className="w-4 h-4 rounded-full border-2 border-slate-200" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-bold ${done ? "text-slate-800" : pending ? "text-amber-700" : "text-slate-400"}`}>
          {label}
        </p>
        {sublabel && (
          <p className={`text-xs ${done ? "text-slate-500" : pending ? "text-amber-500" : "text-slate-300"}`}>
            {sublabel}
          </p>
        )}
        {at && <p className="text-xs text-slate-300 mt-0.5">{fmtDate(at)}</p>}
      </div>
    </div>
  )
}
