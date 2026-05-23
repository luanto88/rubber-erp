"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, getFreshAuthSession, hasPermission, type SessionUser } from "@/lib/auth"
import { IsoShell } from "../../_components/iso-shell"
import {
  TRANG_THAI_LABEL,
  TRANG_THAI_COLOR,
  LOAI_TAI_LIEU_OPTIONS,
  LOAI_TAI_LIEU_LABEL,
  PHONG_BAN_OPTIONS,
  buildMaTaiLieu,
  emptyIsoForm,
  fmtDate,
  type IsoDocument,
  type IsoDocumentForm,
} from "../../_components/iso-types"
import {
  ArrowLeft,
  Save,
  Upload,
  FileText,
  Eye,
  Download,
  Send,
  CheckCircle2,
  AlertTriangle,
  X,
  KeyRound,
  EyeOff,
  Loader2,
  RotateCcw,
  Lock,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import Link from "next/link"
import { QRCodeSVG } from "qrcode.react"
import Draggable from "react-draggable"
import { Resizable } from "re-resizable"

type ProfileOption = {
  id: string
  full_name: string
  username: string
  role: string
}

type PinModalAction = "gui_xem_xet" | "gui_phe_duyet" | "phe_duyet" | "tra_ve" | "khong_xem_xet"

type SignPlacement = {
  page: number
  x: number
  y: number
  width: number
  height: number
}

export default function IsoDocumentDetailPage() {
  const params = useParams()
  const router = useRouter()
  const docId = params.id as string
  const isNew = docId === "new-doc"

  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [doc, setDoc] = useState<IsoDocument | null>(null)
  const [form, setForm] = useState<IsoDocumentForm>(emptyIsoForm())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // File upload
  const [fileUploading, setFileUploading] = useState(false)
  const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Users for selectors — all active, xem_xet-filtered, phe_duyet-filtered
  const [profilesAll, setProfilesAll] = useState<ProfileOption[]>([])
  const [profilesXemXet, setProfilesXemXet] = useState<ProfileOption[]>([])
  const [profilesPheDuyet, setProfilesPheDuyet] = useState<ProfileOption[]>([])

  // PIN modal
  const [pinModal, setPinModal] = useState<{
    action: PinModalAction
    label: string
  } | null>(null)
  const [pin, setPin] = useState("")
  const [showPin, setShowPin] = useState(false)
  const [pinError, setPinError] = useState("")
  const [pinLoading, setPinLoading] = useState(false)
  const [lyDoTraVe, setLyDoTraVe] = useState("")

  // Signature placement modal
  const [placementModal, setPlacementModal] = useState<{
    show: boolean
    token: string
    action: PinModalAction
    lyDo: string
    sigX: number
    sigY: number
    sigW: number
    sigH: number
    currentPage: number
    totalPages: number
    canvasScale: number
    pdfPageHeight: number
    sigImgUrl: string | null
  } | null>(null)
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null)
  const pdfDocRef = useRef<unknown>(null)

  // Success toast
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)

  const appUrl = typeof window !== "undefined" ? window.location.origin : ""
  const recordUrl = `${appUrl}/dashboard/iso/documents/${docId}`

  // Load profiles filtered by permission code
  const loadProfilesByPermission = useCallback(async (fid: string, permCode: string): Promise<ProfileOption[]> => {
    const [directRes, roleRes] = await Promise.all([
      supabase.from("user_permissions").select("user_id").eq("permission_code", permCode).eq("granted", true),
      supabase.from("role_permissions").select("role").eq("permission_code", permCode),
    ])
    const directIds = ((directRes.data || []) as { user_id: string }[]).map((d) => d.user_id)
    const roles = [...new Set([...((roleRes.data || []) as { role: string }[]).map((r) => r.role), "admin"])]

    const conditions: string[] = []
    if (directIds.length > 0) conditions.push(`id.in.(${directIds.join(",")})`)
    if (roles.length > 0) conditions.push(`role.in.(${roles.map((r) => `"${r}"`).join(",")})`)
    if (conditions.length === 0) return []

    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, username, role")
      .eq("factory_id", fid)
      .eq("status", "active")
      .or(conditions.join(","))
      .order("full_name")
    return (data || []) as ProfileOption[]
  }, [])

  const loadProfiles = useCallback(async (fid: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, username, role")
      .eq("factory_id", fid)
      .eq("status", "active")
      .order("full_name")
    setProfilesAll((data || []) as ProfileOption[])

    const [xemXetList, pheDuyetList] = await Promise.all([
      loadProfilesByPermission(fid, "iso.xem_xet"),
      loadProfilesByPermission(fid, "iso.phe_duyet"),
    ])
    setProfilesXemXet(xemXetList)
    setProfilesPheDuyet(pheDuyetList)
  }, [loadProfilesByPermission])

  const loadDoc = useCallback(async (id: string, fid: string) => {
    const { data, error } = await supabase
      .from("iso_documents")
      .select("*")
      .eq("id", id)
      .eq("factory_id", fid)
      .single()
    if (error || !data) return
    const d = data as IsoDocument
    setDoc(d)
    const maParts = (d.ma_tai_lieu || "").split("-")
    const soHieu = maParts.length >= 3 && /^\d+$/.test(maParts[maParts.length - 1])
      ? String(parseInt(maParts[maParts.length - 1]))
      : ""
    setForm({
      ma_tai_lieu: d.ma_tai_lieu || "",
      so_hieu: soHieu,
      ten_tai_lieu: d.ten_tai_lieu,
      loai_tai_lieu: d.loai_tai_lieu || "QT",
      phong_ban: d.phong_ban || "",
      cap_tl: d.cap_tl || "Cấp 1",
      chon_quy_trinh: d.chon_quy_trinh || "Soạn thảo",
      lan_ban_hanh: String(d.lan_ban_hanh ?? 0),
      soan_thao: d.soan_thao || "",
      soan_thao_user_id: d.soan_thao_user_id || "",
      xem_xet: d.xem_xet || "",
      xem_xet_user_id: d.xem_xet_user_id || "",
      phe_duyet: d.phe_duyet || "",
      phe_duyet_user_id: d.phe_duyet_user_id || "",
      ghi_chu: d.ghi_chu || "",
      ma_tai_lieu_moi: d.ma_tai_lieu_moi || "",
      phan_loai_tl: d.phan_loai_tl || "cha",
    })
    if (d.file_goc_url) {
      setUploadedFileUrl(d.file_goc_url)
      const parts = d.file_goc_url.split("/")
      setUploadedFileName(decodeURIComponent(parts[parts.length - 1]))
    }
  }, [])

  useEffect(() => {
    const bootstrap = async () => {
      const fid = await getActiveFactoryId()
      if (!fid) { setLoading(false); return }
      const session = await getFreshAuthSession()
      if (!session?.user) { setLoading(false); return }
      const erp = JSON.parse(localStorage.getItem("erp_user") || "{}")
      setUser(erp)
      setFactoryId(fid)
      void loadProfiles(fid)
      if (!isNew) {
        await loadDoc(docId, fid)
      }
      setLoading(false)
    }
    void bootstrap()
  }, [isNew, docId, loadDoc, loadProfiles])

  // Auto-set soạn thảo = user hiện tại khi tạo mới
  useEffect(() => {
    if (isNew && user && !form.soan_thao_user_id) {
      setForm((f) => ({
        ...f,
        soan_thao_user_id: user.id,
        soan_thao: user.full_name || user.username,
      }))
    }
  }, [isNew, user, form.soan_thao_user_id])

  // Load PDF khi mở placement modal
  useEffect(() => {
    if (!placementModal?.show || !doc?.file_goc_url) return
    const loadPdf = async () => {
      const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist")
      GlobalWorkerOptions.workerSrc = "//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
      const pdfDoc = await getDocument(doc.file_goc_url!).promise
      pdfDocRef.current = pdfDoc
      setPlacementModal((p) => p ? { ...p, totalPages: pdfDoc.numPages } : null)
      await renderPdfPage(pdfDoc, 1)
    }
    void loadPdf()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placementModal?.show])

  const renderPdfPage = async (pdfDoc: unknown, pageNum: number) => {
    const pd = pdfDoc as { getPage: (n: number) => Promise<unknown> }
    const page = await pd.getPage(pageNum)
    const p = page as {
      getViewport: (o: { scale: number }) => { width: number; height: number }
      view: number[]
      render: (ctx: object) => { promise: Promise<void> }
    }
    const viewport = p.getViewport({ scale: 1.5 })
    const canvas = pdfCanvasRef.current
    if (!canvas) return
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext("2d")!
    await p.render({ canvasContext: ctx, viewport }).promise
    const pdfPageH = p.view[3] - p.view[1]
    const scale = viewport.height / pdfPageH
    setPlacementModal((prev) => prev ? { ...prev, canvasScale: scale, pdfPageHeight: pdfPageH } : null)
  }

  const trangThai = doc?.trang_thai || "draft"
  const isEditable = isNew || trangThai === "draft" || trangThai === "tra_ve"
  const userId = user?.id ?? ""
  // Phải là đúng người được chỉ định VÀ có quyền
  const canXemXet = hasPermission(user, "iso.xem_xet") && !!userId && userId === doc?.xem_xet_user_id
  const canApprove = hasPermission(user, "iso.phe_duyet") && !!userId && userId === doc?.phe_duyet_user_id

  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text })
    setTimeout(() => setToast(null), 4000)
  }

  const handleFileUpload = async (file: File) => {
    if (!factoryId) return
    const allowed = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
    if (!allowed.some((t) => file.type.includes(t.split("/")[1])) && !file.name.match(/\.(pdf|docx|xlsx)$/i)) {
      setSaveError("Chỉ hỗ trợ file PDF, DOCX, XLSX")
      return
    }
    setFileUploading(true)
    setSaveError(null)
    try {
      const safeName = file.name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._\-]/g, (c) => encodeURIComponent(c))
      const path = `${factoryId}/iso/${Date.now()}_${safeName}`
      const { error } = await supabase.storage.from("iso-documents").upload(path, file, { upsert: true })
      if (error) { setSaveError(error.message); return }
      const { data: urlData } = supabase.storage.from("iso-documents").getPublicUrl(path)
      setUploadedFileUrl(urlData.publicUrl)
      setUploadedFileName(file.name)
    } finally {
      setFileUploading(false)
    }
  }

  const handleSave = async () => {
    if (!factoryId) return
    if (!form.ten_tai_lieu.trim()) { setSaveError("Vui lòng nhập tên tài liệu"); return }
    setSaving(true)
    setSaveError(null)
    try {
      const session = await getFreshAuthSession()
      const payload = {
        factory_id: factoryId,
        ma_tai_lieu: form.ma_tai_lieu || null,
        ten_tai_lieu: form.ten_tai_lieu,
        loai_tai_lieu: form.loai_tai_lieu || null,
        phong_ban: form.phong_ban || null,
        cap_tl: form.cap_tl || null,
        chon_quy_trinh: form.chon_quy_trinh || null,
        lan_ban_hanh: parseInt(form.lan_ban_hanh) || 0,
        soan_thao: form.soan_thao || null,
        soan_thao_user_id: form.soan_thao_user_id || null,
        xem_xet: form.xem_xet || null,
        xem_xet_user_id: form.xem_xet_user_id || null,
        phe_duyet: form.phe_duyet || null,
        phe_duyet_user_id: form.phe_duyet_user_id || null,
        ghi_chu: form.ghi_chu || null,
        ma_tai_lieu_moi: form.ma_tai_lieu_moi || null,
        phan_loai_tl: form.phan_loai_tl || "cha",
        file_goc_url: uploadedFileUrl || null,
        created_by: session?.user?.id,
      }

      if (isNew) {
        const { data, error } = await supabase
          .from("iso_documents")
          .insert(payload)
          .select("id")
          .single()
        if (error) { setSaveError(error.message); return }
        showToast(true, "Đã tạo tài liệu")
        router.replace(`/dashboard/iso/documents/${data.id}`)
      } else {
        const { error } = await supabase
          .from("iso_documents")
          .update(payload)
          .eq("id", docId)
          .eq("factory_id", factoryId)
        if (error) { setSaveError(error.message); return }
        showToast(true, "Đã lưu thay đổi")
        void loadDoc(docId, factoryId)
      }
    } finally {
      setSaving(false)
    }
  }

  // Helper: danh sách user nhận thông báo theo action
  const getNotifyRecipients = (action: PinModalAction, d: IsoDocument): string[] => {
    switch (action) {
      case "gui_xem_xet":
        if (d.cap_tl === "Cấp 2") return [d.phe_duyet_user_id].filter(Boolean) as string[]
        return [d.xem_xet_user_id].filter(Boolean) as string[]
      case "gui_phe_duyet": return [d.phe_duyet_user_id].filter(Boolean) as string[]
      case "phe_duyet": return [d.soan_thao_user_id, d.xem_xet_user_id].filter(Boolean) as string[]
      case "tra_ve":
      case "khong_xem_xet": return [d.soan_thao_user_id].filter(Boolean) as string[]
      default: return []
    }
  }

  // Thực hiện chuyển trạng thái sau khi PIN đã được xác minh
  const doTransition = async (
    action: PinModalAction,
    token: string | null,
    placement: SignPlacement | null,
    lyDo?: string,
  ) => {
    if (!factoryId || !user || !doc) return
    const now = new Date().toISOString()
    let invalidatedIds: string[] = []

    try {
      if (action === "gui_xem_xet") {
        // Cấp 2 đi thẳng vào cho_phe_duyet; Cấp 1 qua cho_xem_xet
        const newStatus = doc.cap_tl === "Cấp 2" ? "cho_phe_duyet" : "cho_xem_xet"
        const { error } = await supabase
          .from("iso_documents")
          .update({ trang_thai: newStatus, ky_soan_thao_at: now })
          .eq("id", docId).eq("factory_id", factoryId)
        if (error) { showToast(false, error.message); return }

      } else if (action === "gui_phe_duyet") {
        const { error } = await supabase
          .from("iso_documents")
          .update({ trang_thai: "cho_phe_duyet", ky_xem_xet_at: now })
          .eq("id", docId).eq("factory_id", factoryId)
        if (error) { showToast(false, error.message); return }

      } else if (action === "phe_duyet") {
        // Thu thập ID tài liệu cũ TRƯỚC khi đổi mã (dùng mã HIỆN TẠI của doc)
        if (doc.chon_quy_trinh === "Soát xét" && doc.ma_tai_lieu) {
          const { data: toInvalidate } = await supabase
            .from("iso_documents")
            .select("id")
            .eq("factory_id", factoryId)
            .eq("ma_tai_lieu", doc.ma_tai_lieu)
            .eq("trang_thai", "co_hieu_luc")
            .neq("id", docId)
          invalidatedIds = (toInvalidate || []).map((d) => d.id)
        }
        const updatePayload: Record<string, unknown> = {
          trang_thai: "co_hieu_luc",
          ky_phe_duyet_at: now,
          ngay_hieu_luc: now,
        }
        // Soát xét đổi mã: gán mã mới từ ma_tai_lieu_moi
        if (doc.chon_quy_trinh === "Soát xét" && doc.ma_tai_lieu_moi) {
          updatePayload.ma_tai_lieu = doc.ma_tai_lieu_moi
        }
        const { error } = await supabase
          .from("iso_documents")
          .update(updatePayload)
          .eq("id", docId).eq("factory_id", factoryId)
        if (error) { showToast(false, error.message); return }
        // Đánh dấu hết hiệu lực các doc cũ
        if (invalidatedIds.length > 0) {
          await supabase
            .from("iso_documents")
            .update({ trang_thai: "het_hieu_luc", ngay_het_hieu_luc: now })
            .in("id", invalidatedIds)
            .eq("factory_id", factoryId)
        }

      } else if (action === "tra_ve" || action === "khong_xem_xet") {
        const { error } = await supabase
          .from("iso_documents")
          .update({ trang_thai: "tra_ve", ghi_chu: lyDo || null })
          .eq("id", docId).eq("factory_id", factoryId)
        if (error) { showToast(false, error.message); return }
      }

      // Ghi audit log
      await supabase.from("doc_approval_log").insert({
        factory_id: factoryId,
        doc_id: docId,
        doc_type: "iso",
        user_id: user.id,
        action,
        ly_do: lyDo || null,
      })

      // Tạo PDF ký duyệt (không block UI nếu lỗi)
      if (token && action !== "tra_ve" && action !== "khong_xem_xet" && doc.file_goc_url) {
        try {
          const pdfRes = await fetch("/api/sign/generate-pdf", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, docId, docType: "iso", signaturePlacement: placement }),
          })
          const pdfJson = await pdfRes.json()
          if (pdfJson.ok && pdfJson.signedPdfUrl) {
            await supabase
              .from("iso_documents")
              .update({ file_signed_pdf_url: pdfJson.signedPdfUrl })
              .eq("id", docId).eq("factory_id", factoryId)
          }
        } catch { /* PDF fail không chặn UI */ }
      }

      // Restamp PDF tài liệu cũ bị hủy hiệu lực
      if (invalidatedIds.length > 0) {
        void fetch("/api/sign/restamp-pdf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docIds: invalidatedIds, factoryId }),
        })
      }

      // Gửi thông báo
      const recipients = getNotifyRecipients(action, doc)
      if (recipients.length > 0) {
        void fetch("/api/iso/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            docId,
            factoryId,
            action,
            recipientUserIds: recipients,
            actorUserId: user.id,
            lyDo: lyDo || undefined,
          }),
        })
      }

      showToast(true, "Đã cập nhật trạng thái")
      void loadDoc(docId, factoryId)
    } catch (err) {
      showToast(false, err instanceof Error ? err.message : "Lỗi xử lý")
    }
  }

  // Xác nhận PIN → mở placement modal hoặc transition trực tiếp
  const handlePinConfirm = async () => {
    if (!pinModal || !factoryId || !user) return
    if (!pin.trim()) { setPinError("Vui lòng nhập PIN"); return }
    setPinLoading(true)
    setPinError("")
    try {
      const verifyRes = await fetch("/api/sign/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, pin, docId, docType: "iso" }),
      })
      const verifyJson = await verifyRes.json()
      if (!verifyRes.ok) { setPinError(verifyJson.error || "PIN không đúng"); return }

      const action = pinModal.action
      const currentLyDo = lyDoTraVe

      // Đóng PIN modal
      setPinModal(null)
      setPin("")
      setLyDoTraVe("")

      // Trả về / từ chối: không cần đặt chữ ký
      if (action === "tra_ve" || action === "khong_xem_xet") {
        await doTransition(action, verifyJson.token, null, currentLyDo)
        return
      }

      // Có file gốc → mở placement modal để đặt chữ ký
      if (doc?.file_goc_url) {
        const sigPath = `signatures/${factoryId}/${user.id}/chu_ky.png`
        const { data: sigUrlData } = supabase.storage.from("iso-documents").getPublicUrl(sigPath)
        setPlacementModal({
          show: true,
          token: verifyJson.token,
          action,
          lyDo: currentLyDo,
          sigX: 100,
          sigY: 100,
          sigW: 120,
          sigH: 60,
          currentPage: 1,
          totalPages: 1,
          canvasScale: 1,
          pdfPageHeight: 842,
          sigImgUrl: sigUrlData.publicUrl,
        })
        return
      }

      // Không có file → transition trực tiếp
      await doTransition(action, verifyJson.token, null)
    } finally {
      setPinLoading(false)
    }
  }

  // Xác nhận vị trí chữ ký → convert tọa độ canvas → PDF rồi transition
  const handlePlacementConfirm = async () => {
    if (!placementModal) return
    const { token, action, lyDo, sigX, sigY, sigW, sigH, canvasScale, pdfPageHeight, currentPage } = placementModal
    const placement: SignPlacement = {
      page: currentPage,
      x: sigX / canvasScale,
      y: pdfPageHeight - (sigY / canvasScale) - (sigH / canvasScale),
      width: sigW / canvasScale,
      height: sigH / canvasScale,
    }
    setPlacementModal(null)
    await doTransition(action, token, placement, lyDo)
  }

  const handlePageChange = async (newPage: number) => {
    if (!pdfDocRef.current || !placementModal) return
    setPlacementModal((p) => p ? { ...p, currentPage: newPage } : null)
    await renderPdfPage(pdfDocRef.current, newPage)
  }

  const profileName = (uid: string) => {
    const p = profilesAll.find((p) => p.id === uid)
    return p ? (p.full_name || p.username) : ""
  }

  if (loading) {
    return (
      <IsoShell>
        <div className="p-10 text-center text-slate-400">Đang tải...</div>
      </IsoShell>
    )
  }

  if (!isNew && !doc) {
    return (
      <IsoShell>
        <div className="p-10 text-center text-slate-400">Không tìm thấy tài liệu</div>
      </IsoShell>
    )
  }

  return (
    <IsoShell>
      <div className="space-y-4">
        {/* Toast */}
        {toast && (
          <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl max-w-xl ${toast.ok ? "bg-emerald-600" : "bg-red-600"} text-white`}>
            {toast.ok ? <CheckCircle2 size={16} className="shrink-0" /> : <AlertTriangle size={16} className="shrink-0" />}
            <span className="text-sm font-bold">{toast.text}</span>
            <button onClick={() => setToast(null)} className="ml-2 hover:opacity-70"><X size={14} /></button>
          </div>
        )}

        {/* Save error */}
        {saveError && (
          <div className="flex items-center gap-3 px-5 py-3 bg-red-50 border border-red-200 text-red-700 rounded-xl">
            <AlertTriangle size={16} className="shrink-0" />
            <span className="text-sm">{saveError}</span>
            <button onClick={() => setSaveError(null)} className="ml-auto hover:opacity-70"><X size={14} /></button>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Link href="/dashboard/iso/documents" className="p-2 hover:bg-slate-100 rounded-xl transition-all">
              <ArrowLeft size={18} className="text-slate-600" />
            </Link>
            <div>
              <h1 className="text-xl font-extrabold text-slate-800">
                {isNew ? "Tạo tài liệu ISO mới" : (doc?.ten_tai_lieu || "Chi tiết tài liệu")}
              </h1>
              {!isNew && doc && (
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="font-mono text-xs text-violet-700">{doc.ma_tai_lieu || "(chưa có mã)"}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${TRANG_THAI_COLOR[trangThai]}`}>
                    {TRANG_THAI_LABEL[trangThai]}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* QR code khi đã có mã */}
            {!isNew && doc?.ma_tai_lieu && (
              <QRCodeSVG value={recordUrl} size={48} className="rounded-lg border border-slate-200 p-1" />
            )}

            {/* Nút workflow — dùng inline style để tránh Tailwind purge */}
            {!isNew && trangThai === "draft" && (
              <button
                onClick={() => {
                  const label = doc?.cap_tl === "Cấp 2" ? "Xác nhận gửi phê duyệt" : "Xác nhận gửi xem xét"
                  setPinModal({ action: "gui_xem_xet", label })
                  setPin("")
                  setPinError("")
                }}
                disabled={doc?.cap_tl === "Cấp 2" ? !doc?.phe_duyet_user_id : !doc?.xem_xet}
                style={{ background: "#d97706" }}
                className="flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-xl disabled:opacity-50 transition-all hover:opacity-90"
              >
                <Send size={14} />
                {doc?.cap_tl === "Cấp 2" ? "Gửi phê duyệt" : "Gửi xem xét"}
              </button>
            )}

            {/* Xem xét → gửi phê duyệt */}
            {!isNew && trangThai === "cho_xem_xet" && canXemXet && (
              <button
                onClick={() => { setPinModal({ action: "gui_phe_duyet", label: "Ký xem xét & gửi phê duyệt" }); setPin(""); setPinError("") }}
                style={{ background: "#ea580c" }}
                className="flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-xl transition-all hover:opacity-90"
              >
                <Send size={14} /> Gửi phê duyệt
              </button>
            )}

            {/* Từ chối xem xét */}
            {!isNew && trangThai === "cho_xem_xet" && canXemXet && (
              <button
                onClick={() => { setPinModal({ action: "khong_xem_xet", label: "Từ chối xem xét" }); setPin(""); setPinError("") }}
                style={{ background: "#e11d48" }}
                className="flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-xl transition-all hover:opacity-90"
              >
                <X size={14} /> Từ chối
              </button>
            )}

            {/* Phê duyệt */}
            {!isNew && (trangThai === "cho_phe_duyet") && canApprove && (
              <button
                onClick={() => { setPinModal({ action: "phe_duyet", label: "Phê duyệt tài liệu" }); setPin(""); setPinError("") }}
                style={{ background: "#16a34a" }}
                className="flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-xl transition-all hover:opacity-90"
              >
                <CheckCircle2 size={14} /> Phê duyệt
              </button>
            )}

            {/* Trả về */}
            {!isNew && (trangThai === "cho_xem_xet" || trangThai === "cho_phe_duyet") && canApprove && (
              <button
                onClick={() => { setPinModal({ action: "tra_ve", label: "Trả về tài liệu" }); setPin(""); setPinError("") }}
                style={{ background: "#e11d48" }}
                className="flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-xl transition-all hover:opacity-90"
              >
                <RotateCcw size={14} /> Trả về
              </button>
            )}

            {/* Nút lưu */}
            {isEditable && (
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl shadow-md disabled:opacity-50 transition-all"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? "Đang lưu..." : "Lưu"}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Form chính */}
          <div className="lg:col-span-2 space-y-4">
            {/* Thông tin cơ bản */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h2 className="text-sm font-extrabold text-slate-700 mb-4">Thông tin tài liệu</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Số hiệu + Lần sửa đổi */}
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Số hiệu</label>
                  <input
                    type="number"
                    min="1"
                    max="99"
                    value={form.so_hieu}
                    onChange={(e) => {
                      const so = e.target.value
                      setForm((f) => ({ ...f, so_hieu: so, ma_tai_lieu: buildMaTaiLieu(f.phong_ban, f.loai_tai_lieu, so) }))
                    }}
                    disabled={!isEditable}
                    placeholder="01"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50 font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Lần sửa đổi</label>
                  <input
                    type="number"
                    min="0"
                    value={form.lan_ban_hanh}
                    onChange={(e) => setForm((f) => ({ ...f, lan_ban_hanh: e.target.value }))}
                    disabled={!isEditable}
                    placeholder="00"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50"
                  />
                </div>

                {/* Mã tài liệu */}
                <div className="sm:col-span-2">
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã tài liệu</label>
                  <input
                    type="text"
                    value={form.ma_tai_lieu}
                    onChange={(e) => setForm((f) => ({ ...f, ma_tai_lieu: e.target.value }))}
                    disabled={!isEditable}
                    placeholder="Tự tạo từ phòng ban + loại + số hiệu"
                    className="w-full px-3 py-2 border border-violet-200 bg-violet-50 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-violet-50 font-mono text-violet-700 placeholder:text-violet-300"
                  />
                </div>

                {/* Tên tài liệu */}
                <div className="sm:col-span-2">
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Tên tài liệu <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={form.ten_tai_lieu}
                    onChange={(e) => setForm((f) => ({ ...f, ten_tai_lieu: e.target.value }))}
                    disabled={!isEditable}
                    placeholder="Nhập tên tài liệu..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50"
                  />
                </div>

                {/* Loại tài liệu */}
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    Loại tài liệu
                    {form.loai_tai_lieu && LOAI_TAI_LIEU_LABEL[form.loai_tai_lieu] && (
                      <span className="ml-1.5 text-slate-400 font-normal">({LOAI_TAI_LIEU_LABEL[form.loai_tai_lieu]})</span>
                    )}
                  </label>
                  <select
                    value={form.loai_tai_lieu}
                    onChange={(e) => {
                      const loai = e.target.value
                      setForm((f) => ({ ...f, loai_tai_lieu: loai, ma_tai_lieu: buildMaTaiLieu(f.phong_ban, loai, f.so_hieu) }))
                    }}
                    disabled={!isEditable}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50"
                  >
                    {LOAI_TAI_LIEU_OPTIONS.map((l) => (
                      <option key={l} value={l}>{l} — {LOAI_TAI_LIEU_LABEL[l]}</option>
                    ))}
                  </select>
                  {/* Phân loại Cha/Con cho PL và HD */}
                  {(form.loai_tai_lieu === "PL" || form.loai_tai_lieu === "HD") && (
                    <div className="flex gap-4 mt-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          checked={form.phan_loai_tl !== "con"}
                          onChange={() => setForm((f) => ({ ...f, phan_loai_tl: "cha" }))}
                          disabled={!isEditable}
                          className="accent-violet-600"
                        />
                        <span className="text-xs font-medium text-slate-700">Cha (tài liệu gốc)</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          checked={form.phan_loai_tl === "con"}
                          onChange={() => setForm((f) => ({ ...f, phan_loai_tl: "con" }))}
                          disabled={!isEditable}
                          className="accent-violet-600"
                        />
                        <span className="text-xs font-medium text-slate-700">Con (phụ lục đính kèm)</span>
                      </label>
                    </div>
                  )}
                </div>

                {/* Phòng ban */}
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Phòng ban</label>
                  <select
                    value={form.phong_ban}
                    onChange={(e) => {
                      const pb = e.target.value
                      setForm((f) => ({ ...f, phong_ban: pb, ma_tai_lieu: buildMaTaiLieu(pb, f.loai_tai_lieu, f.so_hieu) }))
                    }}
                    disabled={!isEditable}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50"
                  >
                    <option value="">— Chọn phòng ban —</option>
                    {PHONG_BAN_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>

                {/* Cấp tài liệu */}
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Cấp tài liệu</label>
                  <select
                    value={form.cap_tl}
                    onChange={(e) => setForm((f) => ({ ...f, cap_tl: e.target.value }))}
                    disabled={!isEditable}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50"
                  >
                    <option value="Cấp 1">Cấp 1 (3 bước: Soạn thảo → Xem xét → Phê duyệt)</option>
                    <option value="Cấp 2">Cấp 2 (2 bước: Soạn thảo → Phê duyệt)</option>
                  </select>
                </div>

                {/* Quy trình */}
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Quy trình</label>
                  <select
                    value={form.chon_quy_trinh}
                    onChange={(e) => setForm((f) => ({ ...f, chon_quy_trinh: e.target.value }))}
                    disabled={!isEditable}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50"
                  >
                    <option value="Soạn thảo">Soạn thảo mới</option>
                    <option value="Soát xét">Soát xét (thay thế tài liệu cũ)</option>
                  </select>
                </div>

                {form.chon_quy_trinh === "Soát xét" && (
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã tài liệu mới (sau soát xét)</label>
                    <input
                      type="text"
                      value={form.ma_tai_lieu_moi}
                      onChange={(e) => setForm((f) => ({ ...f, ma_tai_lieu_moi: e.target.value }))}
                      disabled={!isEditable}
                      placeholder="Để trống = giữ nguyên mã cũ"
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50 font-mono"
                    />
                  </div>
                )}

                <div className="sm:col-span-2">
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Ghi chú</label>
                  <textarea
                    value={form.ghi_chu}
                    onChange={(e) => setForm((f) => ({ ...f, ghi_chu: e.target.value }))}
                    disabled={!isEditable}
                    rows={2}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50 resize-none"
                  />
                </div>
              </div>
            </div>

            {/* Nhân sự */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h2 className="text-sm font-extrabold text-slate-700 mb-4">Nhân sự ký duyệt</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Soạn thảo — auto-set, read-only */}
                <div>
                  <label className="text-xs font-bold text-slate-600 flex items-center gap-1 mb-1.5">
                    Người soạn thảo
                    {isNew && <Lock size={10} className="text-slate-400" />}
                  </label>
                  <div className="relative">
                    <select
                      value={form.soan_thao_user_id}
                      onChange={(e) => {
                        if (!isNew) {
                          const uid = e.target.value
                          setForm((f) => ({ ...f, soan_thao_user_id: uid, soan_thao: profileName(uid) }))
                        }
                      }}
                      disabled={!isEditable || isNew}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50"
                    >
                      <option value="">— Chọn người —</option>
                      {profilesAll.map((p) => (
                        <option key={p.id} value={p.id}>{p.full_name || p.username}</option>
                      ))}
                    </select>
                  </div>
                  {doc?.ky_soan_thao_at && (
                    <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                      <CheckCircle2 size={10} /> Đã ký {fmtDate(doc.ky_soan_thao_at)}
                    </p>
                  )}
                </div>

                {/* Xem xét (chỉ Cấp 1) — chỉ liệt kê user có iso.xem_xet */}
                {form.cap_tl === "Cấp 1" && (
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">Người xem xét</label>
                    <select
                      value={form.xem_xet_user_id}
                      onChange={(e) => {
                        const uid = e.target.value
                        setForm((f) => ({ ...f, xem_xet_user_id: uid, xem_xet: profileName(uid) }))
                      }}
                      disabled={!isEditable}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50"
                    >
                      <option value="">— Chọn người —</option>
                      {profilesXemXet
                        .filter((p) => p.id !== form.soan_thao_user_id)
                        .map((p) => (
                          <option key={p.id} value={p.id}>{p.full_name || p.username}</option>
                        ))}
                    </select>
                    {doc?.ky_xem_xet_at && (
                      <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                        <CheckCircle2 size={10} /> Đã ký {fmtDate(doc.ky_xem_xet_at)}
                      </p>
                    )}
                  </div>
                )}

                {/* Phê duyệt — chỉ liệt kê user có iso.phe_duyet */}
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Người phê duyệt</label>
                  <select
                    value={form.phe_duyet_user_id}
                    onChange={(e) => {
                      const uid = e.target.value
                      setForm((f) => ({ ...f, phe_duyet_user_id: uid, phe_duyet: profileName(uid) }))
                    }}
                    disabled={!isEditable}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50"
                  >
                    <option value="">— Chọn người —</option>
                    {profilesPheDuyet
                      .filter((p) => p.id !== form.soan_thao_user_id && p.id !== form.xem_xet_user_id)
                      .map((p) => (
                        <option key={p.id} value={p.id}>{p.full_name || p.username}</option>
                      ))}
                  </select>
                  {doc?.ky_phe_duyet_at && (
                    <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                      <CheckCircle2 size={10} /> Đã duyệt {fmtDate(doc.ky_phe_duyet_at)}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar: File & thông tin */}
          <div className="space-y-4">
            {/* File đính kèm */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h2 className="text-sm font-extrabold text-slate-700 mb-3">File tài liệu</h2>
              <p className="text-xs text-slate-500 mb-3">PDF, DOCX hoặc XLSX</p>

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleFileUpload(f)
                  e.target.value = ""
                }}
              />

              {uploadedFileUrl ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 p-3 bg-violet-50 rounded-xl">
                    <FileText size={16} className="text-violet-600 shrink-0" />
                    <span className="text-xs text-slate-700 flex-1 truncate">{uploadedFileName}</span>
                    <a href={uploadedFileUrl} target="_blank" rel="noreferrer" className="shrink-0 p-1 hover:bg-violet-100 rounded-lg">
                      <Eye size={13} className="text-violet-600" />
                    </a>
                    <a href={uploadedFileUrl} download className="shrink-0 p-1 hover:bg-violet-100 rounded-lg">
                      <Download size={13} className="text-violet-600" />
                    </a>
                  </div>
                  {isEditable && (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={fileUploading}
                      className="w-full px-3 py-2 border border-dashed border-slate-300 hover:border-violet-400 text-slate-500 hover:text-violet-600 text-xs font-medium rounded-xl transition-all"
                    >
                      {fileUploading ? "Đang tải..." : "Thay file"}
                    </button>
                  )}
                </div>
              ) : (
                isEditable && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={fileUploading}
                    className="w-full flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-slate-200 hover:border-violet-400 rounded-xl text-slate-400 hover:text-violet-600 transition-all"
                  >
                    <Upload size={20} />
                    <span className="text-xs font-medium">
                      {fileUploading ? "Đang tải lên..." : "Nhấn để chọn file"}
                    </span>
                  </button>
                )
              )}

              {/* PDF đã ký */}
              {doc?.file_signed_pdf_url && (
                <div className="mt-3 flex items-center gap-2 p-3 bg-emerald-50 rounded-xl">
                  <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                  <span className="text-xs text-emerald-700 flex-1">PDF có chữ ký</span>
                  <a href={doc.file_signed_pdf_url} target="_blank" rel="noreferrer" className="shrink-0">
                    <Eye size={13} className="text-emerald-600" />
                  </a>
                  <a href={doc.file_signed_pdf_url} download className="shrink-0">
                    <Download size={13} className="text-emerald-600" />
                  </a>
                </div>
              )}
            </div>

            {/* Thông tin hiệu lực */}
            {!isNew && doc && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
                <h2 className="text-sm font-extrabold text-slate-700">Thông tin hiệu lực</h2>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Ngày hiệu lực</span>
                    <span className="font-medium text-slate-700">{fmtDate(doc.ngay_hieu_luc) || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Ngày hết hiệu lực</span>
                    <span className="font-medium text-slate-700">{fmtDate(doc.ngay_het_hieu_luc) || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Cấp tài liệu</span>
                    <span className="font-medium text-slate-700">{doc.cap_tl || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Lần ban hành</span>
                    <span className="font-mono font-bold text-slate-700">{doc.lan_ban_hanh}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Phân loại</span>
                    <span className="font-medium text-slate-700">{doc.phan_loai_tl === "con" ? "Con" : "Cha"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Tạo lúc</span>
                    <span className="font-medium text-slate-700">{fmtDate(doc.created_at)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Signature Placement Modal */}
        {placementModal?.show && (
          <div className="fixed inset-0 bg-black/70 z-50 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 shrink-0 flex-wrap gap-2">
              <h3 className="font-bold text-slate-800 text-sm">Đặt chữ ký trên tài liệu</h3>
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-500 mr-1">
                  Trang {placementModal.currentPage} / {placementModal.totalPages}
                </span>
                <button
                  onClick={() => void handlePageChange(placementModal.currentPage - 1)}
                  disabled={placementModal.currentPage <= 1}
                  className="p-1.5 hover:bg-slate-100 rounded-lg disabled:opacity-40 transition-all"
                >
                  <ChevronLeft size={16} className="text-slate-600" />
                </button>
                <button
                  onClick={() => void handlePageChange(placementModal.currentPage + 1)}
                  disabled={placementModal.currentPage >= placementModal.totalPages}
                  className="p-1.5 hover:bg-slate-100 rounded-lg disabled:opacity-40 transition-all"
                >
                  <ChevronRight size={16} className="text-slate-600" />
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const { action, token, lyDo } = placementModal
                    setPlacementModal(null)
                    void doTransition(action, token, null, lyDo)
                  }}
                  className="px-3 py-1.5 text-sm text-slate-600 border border-slate-300 rounded-xl hover:bg-slate-50 transition-all"
                >
                  Bỏ qua chữ ký
                </button>
                <button
                  onClick={() => void handlePlacementConfirm()}
                  style={{ background: "#7c3aed" }}
                  className="px-4 py-1.5 text-sm text-white font-bold rounded-xl hover:opacity-90 transition-all"
                >
                  Xác nhận vị trí
                </button>
              </div>
            </div>
            {/* Canvas area */}
            <div className="flex-1 overflow-auto flex items-start justify-center p-4 bg-slate-100">
              <div className="relative inline-block shadow-2xl bg-white select-none">
                <canvas ref={pdfCanvasRef} className="block" />
                {placementModal.sigImgUrl && (
                  <Draggable
                    position={{ x: placementModal.sigX, y: placementModal.sigY }}
                    onStop={(_, d) => setPlacementModal((p) => p ? { ...p, sigX: d.x, sigY: d.y } : null)}
                    bounds="parent"
                  >
                    <div style={{ position: "absolute", top: 0, left: 0, zIndex: 10, cursor: "move" }}>
                      <Resizable
                        size={{ width: placementModal.sigW, height: placementModal.sigH }}
                        onResizeStop={(_, __, ref) => setPlacementModal((p) => p ? {
                          ...p,
                          sigW: parseInt(ref.style.width) || p.sigW,
                          sigH: parseInt(ref.style.height) || p.sigH,
                        } : null)}
                        minWidth={40}
                        minHeight={20}
                        style={{ border: "2px dashed #7c3aed", position: "relative" }}
                      >
                        <img
                          src={placementModal.sigImgUrl}
                          alt="chữ ký"
                          style={{ width: "100%", height: "100%", objectFit: "contain", opacity: 0.9, display: "block" }}
                          draggable={false}
                        />
                        <span style={{
                          position: "absolute",
                          top: -20,
                          left: 0,
                          fontSize: 10,
                          color: "#7c3aed",
                          background: "rgba(255,255,255,0.92)",
                          padding: "1px 5px",
                          borderRadius: 4,
                          whiteSpace: "nowrap",
                          pointerEvents: "none",
                        }}>
                          Kéo để đặt vị trí
                        </span>
                      </Resizable>
                    </div>
                  </Draggable>
                )}
              </div>
            </div>
          </div>
        )}

        {/* PIN Modal */}
        {pinModal && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-violet-100 rounded-xl">
                  <KeyRound size={18} className="text-violet-600" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-800">{pinModal.label}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Nhập PIN ký duyệt để xác nhận</p>
                </div>
              </div>

              {(pinModal.action === "tra_ve" || pinModal.action === "khong_xem_xet") && (
                <div className="mb-4">
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    {pinModal.action === "khong_xem_xet" ? "Lý do từ chối" : "Lý do trả về"}
                  </label>
                  <textarea
                    value={lyDoTraVe}
                    onChange={(e) => setLyDoTraVe(e.target.value)}
                    rows={3}
                    placeholder="Nhập lý do..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 resize-none"
                  />
                </div>
              )}

              <div className="mb-4">
                <label className="text-xs font-bold text-slate-600 block mb-1.5">PIN ký duyệt</label>
                <div className="relative">
                  <input
                    type={showPin ? "text" : "password"}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    autoFocus
                    value={pin}
                    onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); setPinError("") }}
                    placeholder="4–6 chữ số"
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 pr-9 font-mono tracking-widest text-center text-lg"
                    onKeyDown={(e) => { if (e.key === "Enter") void handlePinConfirm() }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPin ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {pinError && (
                  <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
                    <AlertTriangle size={11} /> {pinError}
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => { setPinModal(null); setPin(""); setPinError(""); setLyDoTraVe("") }}
                  className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Hủy
                </button>
                <button
                  onClick={() => void handlePinConfirm()}
                  disabled={pinLoading || !pin}
                  className="flex items-center gap-2 px-5 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold rounded-xl disabled:opacity-50 transition-all"
                >
                  {pinLoading ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                  {pinLoading ? "Đang xử lý..." : "Xác nhận"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </IsoShell>
  )
}
