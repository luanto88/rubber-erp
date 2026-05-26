"use client"

import { type RefObject, useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, getFreshAuthSession, hasPermission, type SessionUser } from "@/lib/auth"
import { IsoShell } from "../../_components/iso-shell"
import {
  TRANG_THAI_LABEL,
  TRANG_THAI_COLOR,
  LOAI_TAI_LIEU_LABEL,
  LOAI_PHONG_BAN_MAP,
  PHONG_BAN_OPTIONS,
  ISO_STANDARD_FALLBACK,
  buildMaTaiLieu,
  buildMaTaiLieuCon,
  parseMaTaiLieuCon,
  parseParentCode,
  isoDocumentTypeFallback,
  emptyIsoForm,
  fmtDate,
  type IsoDocument,
  type IsoDocumentForm,
  type IsoDocumentTypeMaster,
  type IsoStandard,
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

type PinModalAction = "gui_xem_xet" | "gui_phe_duyet" | "phe_duyet" | "tra_ve" | "khong_xem_xet" | "tu_choi_phe_duyet" | "gui_lai_phe_duyet" | "tra_ve_nhap"

type SignPlacement = {
  page: number
  x: number
  y: number
  width: number
  height: number
  showSignerName?: boolean
  nameX?: number
  nameY?: number
  nameWidth?: number
  nameHeight?: number
  qrX?: number
  qrY?: number
  qrWidth?: number
  qrHeight?: number
}

type PreviewSignature = SignPlacement & {
  signerUserId: string
  url: string
  signerName?: string
}

type SignFileKind = "main" | "change_request" | "review_request"

type SignFileTask = {
  kind: SignFileKind
  label: string
  url: string
}

type SignedFilePlacement = {
  kind: SignFileKind
  placement: SignPlacement
}

function sanitizeStorageFileName(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".")
  const rawBase = lastDot > 0 ? fileName.slice(0, lastDot) : fileName
  const rawExt = lastDot > 0 ? fileName.slice(lastDot + 1) : ""
  const base = rawBase
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120)
  const ext = rawExt.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()
  return `${base || "file"}${ext ? `.${ext}` : ""}`
}

function hasVietnameseOrNonAsciiName(fileName: string): boolean {
  return /[^\x00-\x7F]/.test(fileName)
}

const ISO_OFFICE_MAIN_TAGS = [
  "{{MA_TAI_LIEU}}",
  "{{TEN_TAI_LIEU}}",
  "{{PHONG_BAN}}",
  "{{LOAI_TAI_LIEU}}",
  "{{LAN_BAN_HANH}}",
  "{{LAN_SUA_DOI}}",
  "{{NGAY_HIEU_LUC}}",
  "{{TINH_TRANG}}",
  "{{QR}}",
]

const ISO_OFFICE_REVIEW_TAGS = [
  "{{MA_TAI_LIEU_CU}}",
  "{{MA_TAI_LIEU_MOI}}",
  "{{LY_DO_SOAT_XET}}",
  "{{NOI_DUNG_SOAT_XET}}",
]

const ISO_OFFICE_SIGNATURE_TAGS = [
  "{{CHU_KY_SOAN_THAO}}",
  "{{TEN_SOAN_THAO}}",
  "{{CHU_KY_XEM_XET}}",
  "{{TEN_XEM_XET}}",
  "{{CHU_KY_PHE_DUYET}}",
  "{{TEN_PHE_DUYET}}",
]

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
  const [reviewChangeFileUrl, setReviewChangeFileUrl] = useState<string | null>(null)
  const [reviewChangeFileName, setReviewChangeFileName] = useState<string | null>(null)
  const [reviewRequestFileUrl, setReviewRequestFileUrl] = useState<string | null>(null)
  const [reviewRequestFileName, setReviewRequestFileName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const reviewChangeFileInputRef = useRef<HTMLInputElement>(null)
  const reviewRequestFileInputRef = useRef<HTMLInputElement>(null)

  // Users for selectors — all active, xem_xet-filtered, phe_duyet-filtered
  const [profilesAll, setProfilesAll] = useState<ProfileOption[]>([])
  const [profilesXemXet, setProfilesXemXet] = useState<ProfileOption[]>([])
  const [profilesPheDuyet, setProfilesPheDuyet] = useState<ProfileOption[]>([])
  const [standards, setStandards] = useState<IsoStandard[]>(ISO_STANDARD_FALLBACK)
  const [docTypes, setDocTypes] = useState<IsoDocumentTypeMaster[]>(isoDocumentTypeFallback())
  const [effectiveDocs, setEffectiveDocs] = useState<IsoDocument[]>([])
  const [effectiveDocStandards, setEffectiveDocStandards] = useState<Record<string, number[]>>({})
  const [standardsOpen, setStandardsOpen] = useState(false)
  const [reviewDocId, setReviewDocId] = useState("")
  const standardsSelectRef = useRef<HTMLDivElement>(null)

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
    sourcePdfUrl: string
    fileKind: SignFileKind
    fileLabel: string
    fileIndex: number
    fileTotal: number
    pendingFiles: SignFileTask[]
    completedPlacements: SignedFilePlacement[]
    token: string
    action: PinModalAction
    lyDo: string
    sigX: number
    sigY: number
    sigW: number
    sigH: number
    nameX: number
    nameY: number
    nameW: number
    nameH: number
    qrX: number
    qrY: number
    qrW: number
    qrH: number
    showQrPlacement: boolean
    currentPage: number
    totalPages: number
    canvasScale: number
    pdfPageHeight: number
    sigImgUrl: string | null
    previewSignatures: PreviewSignature[]
    signerName: string
    showSignerName: boolean
  } | null>(null)
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null)
  const draggableNodeRef = useRef<HTMLDivElement>(null)
  const nameNodeRef = useRef<HTMLDivElement>(null)
  const qrNodeRef = useRef<HTMLDivElement>(null)
  const pdfDocRef = useRef<unknown>(null)

  // Success toast
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)

  // Header mismatch warnings from generate-pdf
  const [headerMismatchWarnings, setHeaderMismatchWarnings] = useState<Array<{ found: string; expected: string }>>([])
  // Labels user confirmed are intentional (not errors) — skip in future generate-pdf calls
  const [confirmedSkipTags, setConfirmedSkipTags] = useState<string[]>([])


  const appUrl = typeof window !== "undefined" ? window.location.origin : ""
  const recordUrl = `${appUrl}/dashboard/iso/documents/${docId}`

  // Load profiles filtered by permission code — dùng API server-side để bypass RLS trên user_permissions
  const loadProfilesByPermission = useCallback(async (fid: string, permCode: string): Promise<ProfileOption[]> => {
    try {
      const res = await fetch(`/api/iso/profiles-by-permission?factoryId=${fid}&permCode=${encodeURIComponent(permCode)}`)
      if (!res.ok) return []
      const json = await res.json()
      return (json.profiles || []) as ProfileOption[]
    } catch {
      return []
    }
  }, [])

  const loadProfiles = useCallback(async (fid: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, username, role")
      .eq("factory_id", fid)
      .eq("status", "active")
      .order("full_name")
    setProfilesAll((data || []) as ProfileOption[])

    const [soatXetList, xemXetList, pheDuyetList] = await Promise.all([
      loadProfilesByPermission(fid, "iso.soat_xet"),
      loadProfilesByPermission(fid, "iso.xem_xet"),
      loadProfilesByPermission(fid, "iso.phe_duyet"),
    ])
    setProfilesXemXet(soatXetList.length > 0 ? soatXetList : xemXetList)
    setProfilesPheDuyet(pheDuyetList)
  }, [loadProfilesByPermission])

  const loadMasterData = useCallback(async () => {
    const [standardRes, typeRes] = await Promise.all([
      supabase
        .from("iso_standards")
        .select("id, tieu_chuan, ten_tieu_chuan, is_active, sort_order")
        .eq("is_active", true)
        .order("sort_order"),
      supabase
        .from("iso_document_types")
        .select("code, name, can_parent, can_child, force_child, allowed_departments, is_active, sort_order")
        .eq("is_active", true)
        .order("sort_order"),
    ])

    if (!standardRes.error && standardRes.data?.length) {
      setStandards(standardRes.data as IsoStandard[])
    }
    if (!typeRes.error && typeRes.data?.length) {
      setDocTypes(typeRes.data as IsoDocumentTypeMaster[])
    }
  }, [])

  const loadEffectiveDocs = useCallback(async (fid: string) => {
    const { data, error } = await supabase
      .from("iso_documents")
      .select("id, ma_tai_lieu, ten_tai_lieu, loai_tai_lieu, phong_ban, cap_tl, chon_quy_trinh, lan_ban_hanh, ghi_chu, phan_loai_tl, ma_tai_lieu_cu, doi_ma_tai_lieu, ma_tai_lieu_moi, trang_thai")
      .eq("factory_id", fid)
      .eq("trang_thai", "co_hieu_luc")
      .order("ma_tai_lieu")
    if (error) {
      setEffectiveDocs([])
      setEffectiveDocStandards({})
      return
    }

    const docs = (data || []) as IsoDocument[]
    setEffectiveDocs(docs)
    if (docs.length === 0) {
      setEffectiveDocStandards({})
      return
    }

    const { data: standardRows } = await supabase
      .from("iso_document_standards")
      .select("doc_id, standard_id")
      .eq("factory_id", fid)
      .in("doc_id", docs.map((d) => d.id))
    const byDoc = ((standardRows || []) as { doc_id: string; standard_id: number }[]).reduce<Record<string, number[]>>((acc, row) => {
      acc[row.doc_id] = [...(acc[row.doc_id] || []), row.standard_id]
      return acc
    }, {})
    setEffectiveDocStandards(byDoc)
  }, [])

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
    const { data: standardRows } = await supabase
      .from("iso_document_standards")
      .select("standard_id")
      .eq("doc_id", id)
      .eq("factory_id", fid)
    const selectedStandardIds = ((standardRows || []) as { standard_id: number }[]).map((row) => row.standard_id)
    const isCon = d.phan_loai_tl === "con" || d.loai_tai_lieu === "F"

    let soHieu = ""
    let maTaiLieuCha = ""
    let loaiTaiLieuCha = "QT"
    let soHieuCha = ""

    if (isCon && d.ma_tai_lieu && d.loai_tai_lieu) {
      // Parse mã Con: "NMCB-QT01-PL01" → { maCha: "NMCB-QT01", soHieu: "1" }
      const parsed = parseMaTaiLieuCon(d.ma_tai_lieu, d.loai_tai_lieu)
      if (parsed.maCha) {
        maTaiLieuCha = parsed.maCha
        soHieu = parsed.soHieu
        const parentParsed = parseParentCode(parsed.maCha)
        if (parentParsed) {
          loaiTaiLieuCha = parentParsed.loai
          soHieuCha = parentParsed.so
        }
      } else {
        const last = (d.ma_tai_lieu || "").match(/(\d+)$/)
        soHieu = last ? String(parseInt(last[1])) : ""
      }
    } else {
      // Cha: mã dạng NMCB-QT01 → tách số cuối
      const last = (d.ma_tai_lieu || "").match(/(\d+)$/)
      soHieu = last ? String(parseInt(last[1])) : ""
    }

    setForm({
      ma_tai_lieu: d.ma_tai_lieu || "",
      ma_tai_lieu_cu: d.ma_tai_lieu_cu || d.ma_tai_lieu || "",
      so_hieu: soHieu,
      loai_tai_lieu_cha: loaiTaiLieuCha,
      so_hieu_cha: soHieuCha,
      ma_tai_lieu_cha: maTaiLieuCha,
      ten_tai_lieu: d.ten_tai_lieu,
      ten_tai_lieu_cu: d.ten_tai_lieu,
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
      standard_ids: selectedStandardIds,
      doi_ma_tai_lieu: !!d.doi_ma_tai_lieu || !!d.ma_tai_lieu_moi,
      ly_do_soat_xet: d.ly_do_soat_xet || "",
      noi_dung_soat_xet: d.noi_dung_soat_xet || "",
      ma_tai_lieu_moi: d.ma_tai_lieu_moi || "",
      phan_loai_tl: d.phan_loai_tl || "cha",
    })
    if (d.file_goc_url) {
      setUploadedFileUrl(d.file_goc_url)
      const parts = d.file_goc_url.split("/")
      setUploadedFileName(decodeURIComponent(parts[parts.length - 1]))
    }
    const changeUrl = d.file_phieu_yeu_cau_thay_doi_url || null
    if (changeUrl) {
      setReviewChangeFileUrl(changeUrl)
      const parts = changeUrl.split("/")
      setReviewChangeFileName(decodeURIComponent(parts[parts.length - 1]))
    }
    const requestUrl = d.file_de_nghi_soat_xet_url || d.file_soat_xet_url || null
    if (requestUrl) {
      setReviewRequestFileUrl(requestUrl)
      const parts = requestUrl.split("/")
      setReviewRequestFileName(decodeURIComponent(parts[parts.length - 1]))
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
      void loadMasterData()
      void loadProfiles(fid)
      void loadEffectiveDocs(fid)
      if (!isNew) {
        await loadDoc(docId, fid)
      }
      setLoading(false)
    }
    void bootstrap()
  }, [isNew, docId, loadDoc, loadEffectiveDocs, loadMasterData, loadProfiles])

  useEffect(() => {
    if (!standardsOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && standardsSelectRef.current?.contains(target)) return
      setStandardsOpen(false)
    }
    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [standardsOpen])

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

  // Load PDF khi mở placement modal — pdfjs v5+
  useEffect(() => {
    const sourcePdfUrl = placementModal?.sourcePdfUrl
    if (!placementModal?.show || !sourcePdfUrl) return
    const loadPdf = async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist")
        // Dùng version từ package để khớp với CDN worker (tránh version mismatch crash)
        const ver = pdfjsLib.version
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          `https://cdn.jsdelivr.net/npm/pdfjs-dist@${ver}/build/pdf.worker.min.mjs`
        const pdfDoc = await pdfjsLib.getDocument(sourcePdfUrl).promise
        pdfDocRef.current = pdfDoc
        setPlacementModal((p) => p ? { ...p, totalPages: pdfDoc.numPages } : null)
        await renderPdfPage(pdfDoc, 1)
      } catch (err) {
        console.error("PDF load failed:", err)
        showToast(false, "Không tải được file PDF để đặt chữ ký. Chữ ký sẽ chỉ hiện trên Phiếu Ký Duyệt.")
        // Đóng modal trước, rồi gọi doTransition bên ngoài setState (tránh side-effect trong setter)
        const snapshot = placementModal
        setPlacementModal(null)
        if (snapshot) void doTransition(snapshot.action, snapshot.token, null, snapshot.lyDo)
      }
    }
    void loadPdf()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placementModal?.show, placementModal?.sourcePdfUrl])

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
  const userId = user?.id ?? ""
  // Phải là đúng người được chỉ định VÀ có quyền
  const canXemXet = (hasPermission(user, "iso.soat_xet") || hasPermission(user, "iso.xem_xet")) && !!userId && userId === doc?.xem_xet_user_id
  const canApprove = hasPermission(user, "iso.phe_duyet") && !!userId && userId === doc?.phe_duyet_user_id
  const isEditable = isNew || trangThai === "draft" || trangThai === "tra_ve" || (trangThai === "bi_tu_choi_phe_duyet" && canXemXet)

  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text })
    setTimeout(() => setToast(null), 4000)
  }

  const handleFileUpload = async (
    file: File,
    target: "main" | "change" | "review" = "main",
  ) => {
    if (!factoryId) return
    const allowed = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
    if (!allowed.some((t) => file.type.includes(t.split("/")[1])) && !file.name.match(/\.(pdf|docx|xlsx)$/i)) {
      setSaveError("Chỉ hỗ trợ file PDF, DOCX, XLSX")
      return
    }
    setFileUploading(true)
    setSaveError(null)
    setHeaderMismatchWarnings([])
    try {
      const safeName = sanitizeStorageFileName(file.name)
      const uploadWarnings: string[] = []
      if (hasVietnameseOrNonAsciiName(file.name)) {
        uploadWarnings.push(`Tên file có dấu tiếng Việt; hệ thống sẽ lưu storage bằng tên không dấu: ${safeName}`)
      }
      if (!safeName.toLowerCase().endsWith(".pdf")) {
        uploadWarnings.push("File DOCX/XLSX sẽ được ký theo tag. Hãy đặt đúng tag chữ ký, tên người ký và QR trong biểu mẫu.")
      }
      if (uploadWarnings.length > 0) showToast(false, uploadWarnings.join(" "))
      const folder = target === "main" ? "iso" : "iso/review-attachments"
      const path = `${factoryId}/${folder}/${Date.now()}_${safeName}`
      const { error } = await supabase.storage.from("iso-documents").upload(path, file, { upsert: true })
      if (error) { setSaveError(error.message); return }
      const { data: urlData } = supabase.storage.from("iso-documents").getPublicUrl(path)
      if (target === "change") {
        setReviewChangeFileUrl(urlData.publicUrl)
        setReviewChangeFileName(file.name)
      } else if (target === "review") {
        setReviewRequestFileUrl(urlData.publicUrl)
        setReviewRequestFileName(file.name)
      } else {
        setUploadedFileUrl(urlData.publicUrl)
        setUploadedFileName(file.name)
      }
    } finally {
      setFileUploading(false)
    }
  }

  const validateForm = () => {
    const isReviewForm = form.chon_quy_trinh === "Soát xét"
    const isConForm = form.phan_loai_tl === "con"
    const requireValue = (value: string | null | undefined, label: string) => {
      if (!value || !value.trim()) return `Vui lòng nhập/chọn ${label}`
      return null
    }
    const commonErrors = [
      form.standard_ids.length === 0 ? "Vui lòng chọn tiêu chuẩn" : null,
      requireValue(form.phong_ban, "phòng ban"),
      requireValue(form.loai_tai_lieu, isConForm && isReviewForm ? "loại hồ sơ" : "loại tài liệu"),
      requireValue(form.ten_tai_lieu, isConForm ? "tên hồ sơ" : "tên tài liệu"),
      requireValue(form.lan_ban_hanh, isReviewForm ? "lần sửa đổi" : "lần ban hành"),
      requireValue(form.cap_tl, isConForm ? "cấp hồ sơ" : "cấp tài liệu"),
      requireValue(form.soan_thao_user_id, "người soạn thảo"),
      form.cap_tl === "Cấp 1" ? requireValue(form.xem_xet_user_id, "người xem xét") : null,
      requireValue(form.phe_duyet_user_id, "người phê duyệt"),
    ].filter(Boolean)
    if (commonErrors.length > 0) return commonErrors[0] as string

    if (isReviewForm) {
      const reviewErrors = [
        requireValue(form.ma_tai_lieu_cu || form.ma_tai_lieu, isConForm ? "mã hồ sơ" : "mã tài liệu"),
        requireValue(form.ten_tai_lieu_cu, isConForm ? "tên hồ sơ cũ" : "tên tài liệu cũ"),
        form.doi_ma_tai_lieu ? requireValue(form.ma_tai_lieu_moi, isConForm ? "mã hồ sơ mới" : "mã tài liệu mới") : null,
        requireValue(form.ly_do_soat_xet, "lý do soát xét"),
        requireValue(form.noi_dung_soat_xet, "nội dung soát xét"),
      ].filter(Boolean)
      return reviewErrors[0] as string | undefined
    }

    const draftErrors = isConForm
      ? [
          requireValue(form.ma_tai_lieu_cha, "mã tài liệu"),
          requireValue(form.loai_tai_lieu_cha, "loại tài liệu"),
          requireValue(form.so_hieu_cha, "số hiệu tài liệu"),
          requireValue(form.so_hieu, "số hiệu hồ sơ"),
          requireValue(form.ma_tai_lieu, "mã hồ sơ"),
        ]
      : [
          requireValue(form.so_hieu, "số hiệu"),
          requireValue(form.ma_tai_lieu, "mã tài liệu"),
        ]
    return draftErrors.filter(Boolean)[0] as string | undefined
  }

  const handleSave = async () => {
    if (!factoryId) return
    const validationError = validateForm()
    if (validationError) { setSaveError(validationError); return }
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
        doi_ma_tai_lieu: !!form.doi_ma_tai_lieu,
        ma_tai_lieu_cu: form.ma_tai_lieu_cu || doc?.ma_tai_lieu_cu || doc?.ma_tai_lieu || form.ma_tai_lieu || null,
        ly_do_soat_xet: form.ly_do_soat_xet || null,
        noi_dung_soat_xet: form.noi_dung_soat_xet || null,
        ma_tai_lieu_moi: form.doi_ma_tai_lieu ? (form.ma_tai_lieu_moi || null) : null,
        phan_loai_tl: form.phan_loai_tl || "cha",
        file_goc_url: uploadedFileUrl || null,
        file_soat_xet_url: reviewRequestFileUrl || null,
        file_phieu_yeu_cau_thay_doi_url: reviewChangeFileUrl || null,
        file_de_nghi_soat_xet_url: reviewRequestFileUrl || null,
        created_by: session?.user?.id,
      }

      const saveStandards = async (id: string) => {
        await supabase.from("iso_document_standards").delete().eq("doc_id", id).eq("factory_id", factoryId)
        const rows = form.standard_ids.map((standardId) => ({
          doc_id: id,
          standard_id: standardId,
          factory_id: factoryId,
        }))
        if (rows.length > 0) await supabase.from("iso_document_standards").insert(rows)
      }

      if (isNew) {
        const { data, error } = await supabase
          .from("iso_documents")
          .insert(payload)
          .select("id")
          .single()
        if (error) { setSaveError(error.message); return }
        await saveStandards(data.id)
        showToast(true, "Đã tạo tài liệu")
        router.replace(`/dashboard/iso/documents/${data.id}`)
      } else {
        const { error } = await supabase
          .from("iso_documents")
          .update(payload)
          .eq("id", docId)
          .eq("factory_id", factoryId)
        if (error) { setSaveError(error.message); return }
        await saveStandards(docId)
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
      case "tu_choi_phe_duyet":
        if (d.cap_tl === "Cấp 2") return [d.soan_thao_user_id].filter(Boolean) as string[]
        return [d.xem_xet_user_id, d.soan_thao_user_id].filter(Boolean) as string[]
      case "gui_lai_phe_duyet": return [d.phe_duyet_user_id].filter(Boolean) as string[]
      case "tra_ve_nhap": return [d.soan_thao_user_id].filter(Boolean) as string[]
      default: return []
    }
  }

  // Thực hiện chuyển trạng thái sau khi PIN đã được xác minh
  const doTransition = async (
    action: PinModalAction,
    token: string | null,
    placement: SignPlacement | null,
    lyDo?: string,
    signedFilePlacements: SignedFilePlacement[] = [],
  ) => {
    if (!factoryId || !user || !doc) return
    const now = new Date().toISOString()
    let invalidatedIds: string[] = []

    try {
      const noSignActions: PinModalAction[] = ["tra_ve", "khong_xem_xet", "tu_choi_phe_duyet", "tra_ve_nhap"]
      const officeError = await generateOfficeFiles(token, action)
      if (officeError && !noSignActions.includes(action)) {
        showToast(false, "Không thể ký DOCX/XLSX: " + officeError)
        return
      }

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
        const isReview = doc.chon_quy_trinh === "Soát xét"
        const newDocumentCode = doc.doi_ma_tai_lieu && doc.ma_tai_lieu_moi ? doc.ma_tai_lieu_moi : doc.ma_tai_lieu
        const oldDocumentCode = doc.ma_tai_lieu_cu || doc.ma_tai_lieu
        if (isReview && oldDocumentCode) {
          const { data: toInvalidate } = await supabase
            .from("iso_documents")
            .select("id")
            .eq("factory_id", factoryId)
            .eq("ma_tai_lieu", oldDocumentCode)
            .eq("trang_thai", "co_hieu_luc")
            .neq("id", docId)
            .order("ngay_hieu_luc", { ascending: false, nullsFirst: false })
            .order("updated_at", { ascending: false })
            .limit(1)
          invalidatedIds = (toInvalidate || []).map((d) => d.id)
        }
        const updatePayload: Record<string, unknown> = {
          trang_thai: "co_hieu_luc",
          ky_phe_duyet_at: now,
          ngay_hieu_luc: now,
        }
        // Soát xét đổi mã: gán mã mới từ ma_tai_lieu_moi
        if (isReview && newDocumentCode) {
          updatePayload.ma_tai_lieu = newDocumentCode
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

      } else if (action === "tu_choi_phe_duyet") {
        // Cấp 1 → bi_tu_choi_phe_duyet (xem xét quyết định tiếp theo)
        // Cấp 2 → tra_ve trực tiếp (không có xem xét)
        const newStatus = doc.cap_tl === "Cấp 2" ? "tra_ve" : "bi_tu_choi_phe_duyet"
        const { error } = await supabase
          .from("iso_documents")
          .update({ trang_thai: newStatus, ghi_chu: lyDo || null })
          .eq("id", docId).eq("factory_id", factoryId)
        if (error) { showToast(false, error.message); return }

      } else if (action === "gui_lai_phe_duyet") {
        // Xem xét ký lại và gửi phê duyệt lại
        const { error } = await supabase
          .from("iso_documents")
          .update({ trang_thai: "cho_phe_duyet", ky_xem_xet_at: now })
          .eq("id", docId).eq("factory_id", factoryId)
        if (error) { showToast(false, error.message); return }

      } else if (action === "tra_ve_nhap") {
        // Xem xét trả tài liệu về nháp
        const { error } = await supabase
          .from("iso_documents")
          .update({ trang_thai: "draft", ghi_chu: lyDo || null })
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
      let pdfError: string | null = null
      const placementsToGenerate = signedFilePlacements.length > 0
        ? signedFilePlacements
        : (placement ? [{ kind: "main" as const, placement }] : [])
      if (token && !noSignActions.includes(action) && placementsToGenerate.length > 0) {
        try {
          for (const filePlacement of placementsToGenerate) {
          const pdfRes = await fetch("/api/sign/generate-pdf", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token,
              docId,
              docType: "iso",
              fileKind: filePlacement.kind,
              signaturePlacement: filePlacement.placement,
              skipTagLabels: confirmedSkipTags,
            }),
          })
          const pdfJson = await pdfRes.json()
          console.log("[generate-pdf] status:", pdfRes.status, "response:", pdfJson)
          if (pdfJson.ok) {
            if (pdfJson.skipped) {
              showToast(true, "File không phải PDF — chữ ký số không được nhúng, đã lưu workflow")
            }
            // Cập nhật state ngay để UI hiển thị link PDF mà không cần chờ loadDoc
            if (pdfJson.signedPdfUrl) {
              setDoc((prev) => prev
                ? {
                    ...prev,
                    ...(filePlacement.kind === "main" ? { file_signed_pdf_url: pdfJson.signedPdfUrl as string } : {}),
                    ...(filePlacement.kind === "change_request" ? { file_phieu_yeu_cau_thay_doi_url: pdfJson.signedPdfUrl as string } : {}),
                    ...(filePlacement.kind === "review_request" ? { file_de_nghi_soat_xet_url: pdfJson.signedPdfUrl as string, file_soat_xet_url: pdfJson.signedPdfUrl as string } : {}),
                  }
                : prev)
            }
            if (pdfJson.metaMismatched?.length > 0) {
              setHeaderMismatchWarnings(pdfJson.metaMismatched as Array<{ found: string; expected: string }>)
            }
            const failedSigs = pdfJson.diagnostics?.sigImgLoadFailed as string[] | undefined
            if (failedSigs && failedSigs.length > 0) {
              pdfError = `${failedSigs.length} người ký chưa có ảnh chữ ký. Vào Cài đặt → Chữ ký cá nhân để upload.`
            }
          } else {
            pdfError = (pdfJson.error as string) ?? "Không rõ lỗi"
            break
          }
          }
        } catch (pdfErr) {
          pdfError = pdfErr instanceof Error ? pdfErr.message : String(pdfErr)
        }
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

      if (pdfError) {
        showToast(false, "Đã ký duyệt nhưng tạo PDF thất bại: " + pdfError)
      } else {
        showToast(true, "Đã cập nhật trạng thái")
      }
      void loadDoc(docId, factoryId)
    } catch (err) {
      showToast(false, err instanceof Error ? err.message : "Lỗi xử lý")
    }
  }

  // Xác nhận PIN → mở placement modal hoặc transition trực tiếp
  const isPdfUrl = (url: string | null | undefined) =>
    !!url && url.split("?")[0].toLowerCase().endsWith(".pdf")

  const isOfficeUrl = (url: string | null | undefined) => {
    const clean = url?.split("?")[0].toLowerCase()
    return !!clean && (clean.endsWith(".docx") || clean.endsWith(".xlsx"))
  }

  const buildSignFileQueue = (): SignFileTask[] => {
    if (!doc) return []
    const queue: SignFileTask[] = []
    if (isPdfUrl(doc.file_goc_url)) {
      queue.push({ kind: "main", label: "File PDF chính", url: doc.file_signed_pdf_url || doc.file_goc_url! })
    }
    if (doc.chon_quy_trinh === "Soát xét") {
      if (isPdfUrl(doc.file_phieu_yeu_cau_thay_doi_url)) {
        queue.push({ kind: "change_request", label: "Phiếu yêu cầu thay đổi", url: doc.file_phieu_yeu_cau_thay_doi_url! })
      }
      const reviewUrl = doc.file_de_nghi_soat_xet_url || doc.file_soat_xet_url
      if (isPdfUrl(reviewUrl)) {
        queue.push({ kind: "review_request", label: "Đề nghị soát xét", url: reviewUrl! })
      }
    }
    return queue
  }

  const buildOfficeFileQueue = (): SignFileTask[] => {
    if (!doc) return []
    const queue: SignFileTask[] = []
    if (isOfficeUrl(doc.file_goc_url)) {
      queue.push({ kind: "main", label: "File Office chính", url: doc.file_goc_url! })
    }
    if (doc.chon_quy_trinh === "Soát xét") {
      if (isOfficeUrl(doc.file_phieu_yeu_cau_thay_doi_url)) {
        queue.push({ kind: "change_request", label: "Phiếu yêu cầu thay đổi", url: doc.file_phieu_yeu_cau_thay_doi_url! })
      }
      const reviewUrl = doc.file_de_nghi_soat_xet_url || doc.file_soat_xet_url
      if (isOfficeUrl(reviewUrl)) {
        queue.push({ kind: "review_request", label: "Đề nghị soát xét", url: reviewUrl! })
      }
    }
    return queue
  }

  const generateOfficeFiles = async (token: string | null, action: PinModalAction): Promise<string | null> => {
    const noSignActions: PinModalAction[] = ["tra_ve", "khong_xem_xet", "tu_choi_phe_duyet", "tra_ve_nhap"]
    if (!token || noSignActions.includes(action)) return null
    const queue = buildOfficeFileQueue()
    if (queue.length === 0) return null
    for (const task of queue) {
      const officeRes = await fetch("/api/sign/generate-office", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, docId, docType: "iso", fileKind: task.kind }),
      })
      const officeJson = await officeRes.json()
      if (!officeJson.ok) {
        return `${task.label}: ${officeJson.error || "Không tạo được file Office đã ký"}`
      }
      if (officeJson.signedOfficeUrl) {
        setDoc((prev) => prev
          ? {
              ...prev,
              ...(task.kind === "main" ? { file_signed_office_url: officeJson.signedOfficeUrl as string, file_signed_office_type: officeJson.outputType as string } : {}),
              ...(task.kind === "change_request" ? { file_phieu_yeu_cau_thay_doi_signed_url: officeJson.signedOfficeUrl as string } : {}),
              ...(task.kind === "review_request" ? { file_de_nghi_soat_xet_signed_url: officeJson.signedOfficeUrl as string } : {}),
            }
          : prev)
      }
    }
    return null
  }

  const openPlacementForTask = (
    task: SignFileTask,
    pendingFiles: SignFileTask[],
    completedPlacements: SignedFilePlacement[],
    token: string,
    action: PinModalAction,
    lyDo: string,
    fileIndex: number,
    fileTotal: number,
  ) => {
    if (!factoryId || !user) return
    const sigPath = `signatures/${factoryId}/${user.id}/chu_ky.png`
    const { data: sigUrlData } = supabase.storage.from("iso-documents").getPublicUrl(sigPath)
    const isSoanThaoStep = user.id === doc?.soan_thao_user_id && action === "gui_xem_xet"
    const useSignedPdfAsBackground = task.kind === "main" && !!doc?.file_signed_pdf_url
    setPlacementModal({
      show: true,
      sourcePdfUrl: task.url,
      fileKind: task.kind,
      fileLabel: task.label,
      fileIndex,
      fileTotal,
      pendingFiles,
      completedPlacements,
      token,
      action,
      lyDo,
      sigX: 100,
      sigY: 100,
      sigW: 120,
      sigH: 60,
      nameX: 90,
      nameY: 168,
      nameW: 140,
      nameH: 26,
      qrX: 430,
      qrY: 110,
      qrW: 96,
      qrH: 96,
      showQrPlacement: task.kind === "main" && isSoanThaoStep,
      currentPage: 1,
      totalPages: 1,
      canvasScale: 1,
      pdfPageHeight: 842,
      sigImgUrl: sigUrlData.publicUrl,
      previewSignatures: useSignedPdfAsBackground || task.kind !== "main" ? [] : buildPreviewSignatures(),
      signerName: user.full_name || user.username || "",
      showSignerName: true,
    })
  }

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

      // Các action không cần đặt chữ ký
      const noSignActions: PinModalAction[] = ["tra_ve", "khong_xem_xet", "tu_choi_phe_duyet", "tra_ve_nhap"]
      if (noSignActions.includes(action)) {
        await doTransition(action, verifyJson.token, null, currentLyDo)
        return
      }

      // Có file PDF gốc → mở placement modal để đặt chữ ký; DOCX/XLSX → transition trực tiếp
      const signQueue = buildSignFileQueue()
      if (signQueue.length > 0) {
        const [firstTask, ...pendingFiles] = signQueue
        openPlacementForTask(firstTask, pendingFiles, [], verifyJson.token, action, currentLyDo, 1, signQueue.length)
        return
      }

      const fileExt = doc?.file_goc_url?.split("?")[0].split(".").pop()?.toLowerCase()
      if (doc?.file_goc_url && fileExt === "pdf") {
        const sigPath = `signatures/${factoryId}/${user.id}/chu_ky.png`
        const { data: sigUrlData } = supabase.storage.from("iso-documents").getPublicUrl(sigPath)
        const isSoanThaoStep = user.id === doc.soan_thao_user_id && action === "gui_xem_xet"
        const sourcePdfUrl = doc.file_signed_pdf_url || doc.file_goc_url
        const useSignedPdfAsBackground = !!doc.file_signed_pdf_url
        setPlacementModal({
          show: true,
          sourcePdfUrl,
          fileKind: "main",
          fileLabel: "File PDF chính",
          fileIndex: 1,
          fileTotal: 1,
          pendingFiles: [],
          completedPlacements: [],
          token: verifyJson.token,
          action,
          lyDo: currentLyDo,
          sigX: 100,
          sigY: 100,
          sigW: 120,
          sigH: 60,
          nameX: 90,
          nameY: 168,
          nameW: 140,
          nameH: 26,
          qrX: 430,
          qrY: 110,
          qrW: 96,
          qrH: 96,
          showQrPlacement: isSoanThaoStep,
          currentPage: 1,
          totalPages: 1,
          canvasScale: 1,
          pdfPageHeight: 842,
          sigImgUrl: sigUrlData.publicUrl,
          // Khi dùng signed PDF làm nền, chữ ký/tên lũy kế đã nằm sẵn trong canvas.
          // Không render lớp preview nữa để tránh đè 2 lần.
          previewSignatures: useSignedPdfAsBackground ? [] : buildPreviewSignatures(),
          signerName: user.full_name || user.username || "",
          showSignerName: true,
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
      showSignerName: placementModal.showSignerName,
      nameX: placementModal.nameX / canvasScale,
      nameY: pdfPageHeight - (placementModal.nameY / canvasScale) - (placementModal.nameH / canvasScale),
      nameWidth: placementModal.nameW / canvasScale,
      nameHeight: placementModal.nameH / canvasScale,
      qrX: placementModal.showQrPlacement ? (placementModal.qrX / canvasScale) : undefined,
      qrY: placementModal.showQrPlacement ? (pdfPageHeight - (placementModal.qrY / canvasScale) - (placementModal.qrH / canvasScale)) : undefined,
      qrWidth: placementModal.showQrPlacement ? (placementModal.qrW / canvasScale) : undefined,
      qrHeight: placementModal.showQrPlacement ? (placementModal.qrH / canvasScale) : undefined,
    }
    const completedPlacements = [...placementModal.completedPlacements, { kind: placementModal.fileKind, placement }]
    const [nextTask, ...remainingFiles] = placementModal.pendingFiles
    if (nextTask) {
      openPlacementForTask(
        nextTask,
        remainingFiles,
        completedPlacements,
        token,
        action,
        lyDo,
        placementModal.fileIndex + 1,
        placementModal.fileTotal,
      )
      return
    }
    setPlacementModal(null)
    await doTransition(action, token, placement, lyDo, completedPlacements)
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

  const buildPreviewSignatures = () => {
    if (!doc || !factoryId || !user) return [] as PreviewSignature[]

    const nameByUserId: Record<string, string> = {}
    if (doc.soan_thao_user_id) nameByUserId[doc.soan_thao_user_id] = doc.soan_thao ?? ""
    if (doc.xem_xet_user_id)   nameByUserId[doc.xem_xet_user_id]   = doc.xem_xet ?? ""
    if (doc.phe_duyet_user_id) nameByUserId[doc.phe_duyet_user_id] = doc.phe_duyet ?? ""

    const candidates = [
      {
        signerUserId: doc.soan_thao_user_id,
        placement: doc.soan_thao_placement,
        signedAt: doc.ky_soan_thao_at,
      },
      {
        signerUserId: doc.xem_xet_user_id,
        placement: doc.xem_xet_placement,
        signedAt: doc.ky_xem_xet_at,
      },
      {
        signerUserId: doc.phe_duyet_user_id,
        placement: doc.phe_duyet_placement,
        signedAt: doc.ky_phe_duyet_at,
      },
    ]

    return candidates.flatMap((entry) => {
      if (!entry.signerUserId || !entry.placement || !entry.signedAt || entry.signerUserId === user.id) return []
      const sigPath = `signatures/${factoryId}/${entry.signerUserId}/chu_ky.png`
      const { data } = supabase.storage.from("iso-documents").getPublicUrl(sigPath)
      return [{
        signerUserId: entry.signerUserId,
        url: data.publicUrl,
        page: Number(entry.placement.page ?? 0),
        x: Number(entry.placement.x ?? 0),
        y: Number(entry.placement.y ?? 0),
        width: Number(entry.placement.width ?? 0),
        height: Number(entry.placement.height ?? 0),
        showSignerName: (entry.placement.showSignerName as unknown as boolean | undefined),
        nameX: Number(entry.placement.nameX ?? 0),
        nameY: Number(entry.placement.nameY ?? 0),
        nameWidth: Number(entry.placement.nameWidth ?? 80),
        nameHeight: Number(entry.placement.nameHeight ?? 20),
        signerName: nameByUserId[entry.signerUserId] || profileName(entry.signerUserId) || "",
      }]
    }).filter((entry) => entry.page > 0 && entry.width > 0 && entry.height > 0)
  }

  const activeDocTypes = docTypes.length > 0 ? docTypes : isoDocumentTypeFallback()
  const parentTypeOptions = activeDocTypes.filter((type) => type.can_parent && !type.force_child).map((type) => type.code)
  const childTypeOptions = activeDocTypes.filter((type) => type.can_child || type.force_child).map((type) => type.code)
  const docTypeLabelMap = activeDocTypes.reduce<Record<string, string>>((acc, type) => {
    acc[type.code] = type.name
    return acc
  }, { ...LOAI_TAI_LIEU_LABEL })
  const docTypeDepartmentMap = activeDocTypes.reduce<Record<string, string[]>>((acc, type) => {
    acc[type.code] = type.allowed_departments?.length ? type.allowed_departments : [...PHONG_BAN_OPTIONS]
    return acc
  }, { ...LOAI_PHONG_BAN_MAP })
  const isChildDocument = (item: Pick<IsoDocument, "phan_loai_tl" | "loai_tai_lieu">) =>
    item.phan_loai_tl === "con" || item.loai_tai_lieu === "F"

  const rebuildDraftCode = (next: IsoDocumentForm) => {
    if (next.chon_quy_trinh === "Soát xét") return next
    if (next.phan_loai_tl === "con") {
      const maCha = buildMaTaiLieu(next.phong_ban, next.loai_tai_lieu_cha, next.so_hieu_cha)
      next.ma_tai_lieu_cha = maCha
      next.ma_tai_lieu = buildMaTaiLieuCon(maCha, next.loai_tai_lieu, next.so_hieu)
    } else {
      next.ma_tai_lieu_cha = ""
      next.ma_tai_lieu = buildMaTaiLieu(next.phong_ban, next.loai_tai_lieu, next.so_hieu)
    }
    return next
  }

  const patchDraftForm = (patch: Partial<IsoDocumentForm>) => {
    setForm((f) => rebuildDraftCode({ ...f, ...patch }))
  }

  const reviewBaseDocs = effectiveDocs.filter((item) =>
    form.phan_loai_tl === "con" ? isChildDocument(item) : !isChildDocument(item)
  )
  const reviewDocsByStandard = reviewBaseDocs.filter((item) => {
    if (form.standard_ids.length === 0) return true
    const docStandards = effectiveDocStandards[item.id] || []
    return form.standard_ids.every((standardId) => docStandards.includes(standardId))
  })
  const reviewDocsByDepartment = reviewDocsByStandard.filter((item) =>
    !form.phong_ban || item.phong_ban === form.phong_ban
  )
  const reviewTypeOptions = Array.from(new Set(reviewDocsByDepartment.map((item) => item.loai_tai_lieu).filter(Boolean) as string[]))
  const reviewCodeOptions = reviewDocsByDepartment.filter((item) =>
    !form.loai_tai_lieu || item.loai_tai_lieu === form.loai_tai_lieu
  )

  const applyReviewDocument = (id: string) => {
    const selected = effectiveDocs.find((item) => item.id === id)
    setReviewDocId(id)
    if (!selected) return
    const standardIds = effectiveDocStandards[selected.id] || []
    setForm((f) => ({
      ...f,
      standard_ids: standardIds.length > 0 ? standardIds : f.standard_ids,
      phong_ban: selected.phong_ban || "",
      loai_tai_lieu: selected.loai_tai_lieu || f.loai_tai_lieu,
      ma_tai_lieu: selected.ma_tai_lieu || "",
      ma_tai_lieu_cu: selected.ma_tai_lieu || "",
      ten_tai_lieu: selected.ten_tai_lieu || "",
      ten_tai_lieu_cu: selected.ten_tai_lieu || "",
      cap_tl: selected.cap_tl || f.cap_tl,
      lan_ban_hanh: String((selected.lan_ban_hanh ?? 0) + 1),
      doi_ma_tai_lieu: false,
      ma_tai_lieu_moi: "",
    }))
  }

  const renderStandardsSelect = () => {
    const selectedNames = standards
      .filter((standard) => form.standard_ids.includes(standard.id))
      .map((standard) => standard.tieu_chuan)
    return (
      <div ref={standardsSelectRef} className="sm:col-span-2 relative">
        <label className="text-xs font-bold text-slate-600 block mb-1.5">Tiêu chuẩn <span className="text-red-500">*</span></label>
        <button
          type="button"
          onClick={() => isEditable && setStandardsOpen((open) => !open)}
          disabled={!isEditable}
          className="w-full min-h-11 px-3 py-2 border border-slate-300 rounded-xl text-sm text-left outline-none focus:border-violet-500 disabled:bg-slate-50"
        >
          {selectedNames.length > 0 ? selectedNames.join(", ") : "— Chọn tiêu chuẩn —"}
        </button>
        {standardsOpen && isEditable && (
          <div className="absolute z-30 mt-1 w-full max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white shadow-xl p-2">
            {standards.map((standard) => (
              <label key={standard.id} className="flex items-start gap-2 rounded-lg px-2 py-2 text-xs hover:bg-violet-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.standard_ids.includes(standard.id)}
                  onChange={(e) => setForm((f) => ({
                    ...f,
                    standard_ids: e.target.checked
                      ? [...f.standard_ids, standard.id].sort((a, b) => a - b)
                      : f.standard_ids.filter((id) => id !== standard.id),
                  }))}
                  className="mt-0.5 accent-violet-600"
                />
                <span>
                  <span className="font-bold text-slate-700">{standard.tieu_chuan}</span>
                  <span className="block text-[11px] text-slate-500">{standard.ten_tieu_chuan}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
    )
  }

  const renderOfficeTagGuide = () => {
    const tagClass = "inline-flex rounded-md bg-white/80 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-700 ring-1 ring-slate-200"
    const renderTags = (tags: string[]) => (
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <code key={tag} className={tagClass}>{tag}</code>
        ))}
      </div>
    )

    return (
      <details className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600" open>
        <summary className="cursor-pointer select-none font-extrabold text-slate-700">
          Hướng dẫn đặt tag cho DOCX/XLSX
        </summary>
        <div className="mt-2 space-y-2">
          <p>
            Đặt đúng tag trong file tài liệu/hồ sơ chính, phiếu yêu cầu thay đổi và đề nghị soát xét. Với DOCX/XLSX, hệ thống chỉ điền đúng khi tag nằm nguyên vẹn trong một đoạn văn hoặc một ô Excel.
          </p>
          <p>
            File tài liệu/hồ sơ chính là mẫu được dùng lại nhiều lần sau khi có hiệu lực; phiếu yêu cầu thay đổi và đề nghị soát xét chỉ dùng để xem, ký xác nhận và hợp thức hóa hồ sơ soát xét.
          </p>
          <div>
            <p className="mb-1 font-bold text-slate-700">Thông tin tài liệu/hồ sơ chính</p>
            {renderTags(ISO_OFFICE_MAIN_TAGS)}
          </div>
          <div>
            <p className="mb-1 font-bold text-slate-700">Thông tin soát xét</p>
            {renderTags(ISO_OFFICE_REVIEW_TAGS)}
          </div>
          <div>
            <p className="mb-1 font-bold text-slate-700">Chữ ký và tên người ký</p>
            {renderTags(ISO_OFFICE_SIGNATURE_TAGS)}
          </div>
          <p className="text-[11px] text-slate-500">
            Không tách tag bằng xuống dòng, merge nhiều ô hoặc định dạng từng phần bên trong tag. Ví dụ dùng nguyên vẹn <code className={tagClass}>{"{{CHU_KY_PHE_DUYET}}"}</code>, không tách thành nhiều đoạn.
          </p>
          <p className="text-[11px] font-semibold text-amber-700">
            Khi ký DOCX/XLSX, hệ thống sẽ quét toàn bộ file và thay thế tất cả tag trùng khớp chính xác. Tag gần giống hoặc viết sai sẽ được cảnh báo để sửa template; không có lựa chọn bỏ qua đối với DOCX/XLSX.
          </p>
        </div>
      </details>
    )
  }

  const renderInfoForm = () => {
    const isCon = form.phan_loai_tl === "con"
    const isReviewForm = form.chon_quy_trinh === "Soát xét"
    const loaiForPb = isCon ? form.loai_tai_lieu_cha : form.loai_tai_lieu
    const pbAllowed: readonly string[] = (loaiForPb && docTypeDepartmentMap[loaiForPb])
      ? docTypeDepartmentMap[loaiForPb]
      : PHONG_BAN_OPTIONS
    const reviewDepartmentOptions = Array.from(new Set(reviewDocsByStandard.map((item) => item.phong_ban).filter(Boolean) as string[]))
    const departmentOptions = isReviewForm && reviewDepartmentOptions.length > 0 ? reviewDepartmentOptions : [...pbAllowed]
    const titleLabel = isCon ? "Tên hồ sơ" : "Tên tài liệu"
    const codeLabel = isCon ? "Mã hồ sơ" : "Mã tài liệu"
    const levelLabel = isCon ? "Cấp hồ sơ" : "Cấp tài liệu"

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Quy trình <span className="text-red-500">*</span></label>
          <select
            value={form.chon_quy_trinh}
            onChange={(e) => {
              const chonQuyTrinh = e.target.value
              setReviewDocId("")
              patchDraftForm({
                chon_quy_trinh: chonQuyTrinh,
                ma_tai_lieu_cu: "",
                ten_tai_lieu_cu: "",
                doi_ma_tai_lieu: false,
                ma_tai_lieu_moi: "",
                ly_do_soat_xet: "",
                noi_dung_soat_xet: "",
              })
            }}
            disabled={!isEditable}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50"
          >
            <option value="Soạn thảo">Soạn thảo mới</option>
            <option value="Soát xét">Soát xét</option>
          </select>
        </div>

        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Phân loại <span className="text-red-500">*</span></label>
          <div className="flex rounded-xl border border-slate-200 overflow-hidden">
            <button
              type="button"
              onClick={() => {
                if (!isEditable) return
                const newLoai = parentTypeOptions.includes(form.loai_tai_lieu) ? form.loai_tai_lieu : "QT"
                setReviewDocId("")
                patchDraftForm({ phan_loai_tl: "cha", loai_tai_lieu: newLoai, ma_tai_lieu_cha: "", ma_tai_lieu: "", ma_tai_lieu_cu: "", ten_tai_lieu_cu: "" })
              }}
              className={`flex-1 py-2 text-sm font-bold transition-all ${!isCon ? "bg-violet-600 text-white" : "text-slate-600 hover:bg-slate-50"} ${!isEditable ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              Tài liệu (Cha)
            </button>
            <button
              type="button"
              onClick={() => {
                if (!isEditable) return
                const newLoai = childTypeOptions.includes(form.loai_tai_lieu) ? form.loai_tai_lieu : "PL"
                setReviewDocId("")
                patchDraftForm({ phan_loai_tl: "con", loai_tai_lieu: newLoai, ma_tai_lieu: "", ma_tai_lieu_cu: "", ten_tai_lieu_cu: "" })
              }}
              className={`flex-1 py-2 text-sm font-bold transition-all ${isCon ? "bg-violet-600 text-white" : "text-slate-600 hover:bg-slate-50"} ${!isEditable ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              Hồ sơ (Con)
            </button>
          </div>
        </div>

        {renderStandardsSelect()}

        {!isReviewForm && (
          <div className="sm:col-span-2">
            <label className="text-xs font-bold text-slate-600 block mb-1.5">{codeLabel}: Tự sinh <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={form.ma_tai_lieu}
              readOnly
              placeholder="Tự sinh sau khi chọn đủ thông tin"
              className="w-full px-4 py-3 bg-violet-50 border border-violet-200 rounded-xl font-mono text-lg font-bold text-violet-700 outline-none"
            />
          </div>
        )}

        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Phòng ban <span className="text-red-500">*</span></label>
          <select
            value={form.phong_ban}
            onChange={(e) => {
              setReviewDocId("")
              if (isReviewForm) {
                setForm((f) => ({ ...f, phong_ban: e.target.value, loai_tai_lieu: "", ma_tai_lieu: "", ma_tai_lieu_cu: "", ten_tai_lieu_cu: "", ten_tai_lieu: "" }))
              } else {
                patchDraftForm({ phong_ban: e.target.value })
              }
            }}
            disabled={!isEditable}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50"
          >
            <option value="">— Chọn phòng ban —</option>
            {departmentOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        {!isCon && (
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại tài liệu <span className="text-red-500">*</span></label>
            <select
              value={form.loai_tai_lieu}
              onChange={(e) => {
                setReviewDocId("")
                if (isReviewForm) {
                  setForm((f) => ({ ...f, loai_tai_lieu: e.target.value, ma_tai_lieu: "", ma_tai_lieu_cu: "", ten_tai_lieu_cu: "", ten_tai_lieu: "" }))
                } else {
                  patchDraftForm({ loai_tai_lieu: e.target.value })
                }
              }}
              disabled={!isEditable}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50"
            >
              <option value="">— Chọn loại tài liệu —</option>
              {(isReviewForm ? reviewTypeOptions : parentTypeOptions).map((l) => (
                <option key={l} value={l}>{l} — {docTypeLabelMap[l]}</option>
              ))}
            </select>
          </div>
        )}

        {!isReviewForm && !isCon && (
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Số hiệu <span className="text-red-500">*</span></label>
            <input type="number" min="1" value={form.so_hieu} onChange={(e) => patchDraftForm({ so_hieu: e.target.value })} disabled={!isEditable} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50" />
          </div>
        )}

        {!isReviewForm && isCon && (
          <>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại tài liệu <span className="text-red-500">*</span></label>
              <select value={form.loai_tai_lieu_cha} onChange={(e) => patchDraftForm({ loai_tai_lieu_cha: e.target.value })} disabled={!isEditable} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50">
                {parentTypeOptions.map((l) => <option key={l} value={l}>{l} — {docTypeLabelMap[l]}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Số hiệu tài liệu <span className="text-red-500">*</span></label>
              <input type="number" min="1" value={form.so_hieu_cha} onChange={(e) => patchDraftForm({ so_hieu_cha: e.target.value })} disabled={!isEditable} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại hồ sơ <span className="text-red-500">*</span></label>
              <select value={form.loai_tai_lieu} onChange={(e) => patchDraftForm({ loai_tai_lieu: e.target.value })} disabled={!isEditable} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50">
                {childTypeOptions.map((l) => <option key={l} value={l}>{l} — {docTypeLabelMap[l]}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Số hiệu hồ sơ <span className="text-red-500">*</span></label>
              <input type="number" min="1" value={form.so_hieu} onChange={(e) => patchDraftForm({ so_hieu: e.target.value })} disabled={!isEditable} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50" />
            </div>
          </>
        )}

        {isReviewForm && (
          <>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">{codeLabel} <span className="text-red-500">*</span></label>
              <select value={reviewDocId || form.ma_tai_lieu_cu} onChange={(e) => applyReviewDocument(e.target.value)} disabled={!isEditable} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50">
                <option value="">— Chọn {codeLabel.toLowerCase()} có hiệu lực —</option>
                {reviewCodeOptions.map((item) => (
                  <option key={item.id} value={item.id}>{item.ma_tai_lieu} — {item.ten_tai_lieu}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">{titleLabel} <span className="text-red-500">*</span></label>
              <input type="text" value={form.ten_tai_lieu_cu} readOnly className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none bg-slate-50 text-slate-600" />
            </div>
          </>
        )}

        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">{isReviewForm ? "Lần sửa đổi" : "Lần ban hành"} <span className="text-red-500">*</span></label>
          <input type="number" min="0" value={form.lan_ban_hanh} onChange={(e) => setForm((f) => ({ ...f, lan_ban_hanh: e.target.value }))} disabled={!isEditable} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50" />
        </div>

        {isReviewForm && (
          <>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Thay đổi {codeLabel.toLowerCase()} <span className="text-red-500">*</span></label>
              <select value={form.doi_ma_tai_lieu ? "co" : "khong"} onChange={(e) => setForm((f) => ({ ...f, doi_ma_tai_lieu: e.target.value === "co", ma_tai_lieu_moi: e.target.value === "co" ? f.ma_tai_lieu_moi : "" }))} disabled={!isEditable} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50">
                <option value="khong">Không</option>
                <option value="co">Có</option>
              </select>
            </div>
            {form.doi_ma_tai_lieu && (
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">{codeLabel} mới <span className="text-red-500">*</span></label>
                <input type="text" value={form.ma_tai_lieu_moi} onChange={(e) => setForm((f) => ({ ...f, ma_tai_lieu_moi: e.target.value.toUpperCase() }))} disabled={!isEditable} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50 font-mono" />
              </div>
            )}
            <div className="sm:col-span-2">
              <label className="text-xs font-bold text-slate-600 block mb-1.5">{titleLabel} mới <span className="text-red-500">*</span></label>
              <input type="text" value={form.ten_tai_lieu} onChange={(e) => setForm((f) => ({ ...f, ten_tai_lieu: e.target.value }))} disabled={!isEditable} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Lý do soát xét <span className="text-red-500">*</span></label>
              <textarea value={form.ly_do_soat_xet} onChange={(e) => setForm((f) => ({ ...f, ly_do_soat_xet: e.target.value }))} disabled={!isEditable} rows={2} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50 resize-none" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Nội dung soát xét <span className="text-red-500">*</span></label>
              <textarea value={form.noi_dung_soat_xet} onChange={(e) => setForm((f) => ({ ...f, noi_dung_soat_xet: e.target.value }))} disabled={!isEditable} rows={3} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50 resize-none" />
            </div>
          </>
        )}

        {!isReviewForm && (
          <div className="sm:col-span-2">
            <label className="text-xs font-bold text-slate-600 block mb-1.5">{titleLabel} <span className="text-red-500">*</span></label>
            <input type="text" value={form.ten_tai_lieu} onChange={(e) => setForm((f) => ({ ...f, ten_tai_lieu: e.target.value }))} disabled={!isEditable} placeholder={`Nhập ${titleLabel.toLowerCase()}...`} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50" />
          </div>
        )}

        <div className="sm:col-span-2">
          <label className="text-xs font-bold text-slate-600 block mb-1.5">{levelLabel} <span className="text-red-500">*</span></label>
          <select value={form.cap_tl} onChange={(e) => setForm((f) => ({ ...f, cap_tl: e.target.value }))} disabled={!isEditable} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50">
            <option value="Cấp 1">Cấp 1 (3 bước: Soạn thảo → Xem xét → Phê duyệt)</option>
            <option value="Cấp 2">Cấp 2 (2 bước: Soạn thảo → Phê duyệt)</option>
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Ghi chú</label>
          <textarea value={form.ghi_chu} onChange={(e) => setForm((f) => ({ ...f, ghi_chu: e.target.value }))} disabled={!isEditable} rows={2} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50 resize-none" />
        </div>
      </div>
    )
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

        {/* Header mismatch warning */}
        {headerMismatchWarnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-bold text-amber-800">Phát hiện tag không khớp trong tài liệu</p>
                <ul className="mt-1 text-xs text-amber-700 space-y-0.5">
                  {headerMismatchWarnings.map((w, i) => (
                    <li key={i}>
                      {w.expected === "Footer mẫu"
                        ? (
                          <>
                            &quot;<span className="font-mono">{w.found}</span>&quot; — có thể là footer mẫu chưa đúng cấu trúc chuẩn
                          </>
                        )
                        : (
                          <>
                            &quot;<span className="font-mono">{w.found}</span>&quot; — có thể đã nhập sai thay vì &quot;<span className="font-mono">{w.expected}:</span>&quot;
                          </>
                        )}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-amber-600">
                  Nếu đây là lỗi: tải lại file đã sửa và ký lại. Nếu không phải lỗi, bấm &quot;Bỏ qua&quot; để hệ thống không cố điền tag này.
                </p>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => {
                      setConfirmedSkipTags((prev) => [
                        ...prev,
                        ...headerMismatchWarnings.map((w) => w.expected).filter((e) => !prev.includes(e)),
                      ])
                      setHeaderMismatchWarnings([])
                    }}
                    className="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 text-xs font-bold rounded-lg"
                  >
                    Bỏ qua, không điền tag này
                  </button>
                  <button
                    onClick={() => setHeaderMismatchWarnings([])}
                    className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 rounded-lg"
                  >
                    Đóng
                  </button>
                </div>
              </div>
            </div>
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
                  const label = form.cap_tl === "Cấp 2" ? "Xác nhận gửi phê duyệt" : "Xác nhận gửi xem xét"
                  setPinModal({ action: "gui_xem_xet", label })
                  setPin("")
                  setPinError("")
                }}
                disabled={form.cap_tl === "Cấp 2" ? !form.phe_duyet_user_id : (!form.xem_xet_user_id || !form.phe_duyet_user_id)}
                style={{ background: "#d97706" }}
                className="flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-xl disabled:opacity-50 transition-all hover:opacity-90"
              >
                <Send size={14} />
                {form.cap_tl === "Cấp 2" ? "Gửi phê duyệt" : "Gửi xem xét"}
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

            {/* Không phê duyệt (từ cho_phe_duyet — chỉ canApprove, không dùng cho cho_xem_xet) */}
            {!isNew && trangThai === "cho_phe_duyet" && canApprove && (
              <button
                onClick={() => { setPinModal({ action: "tu_choi_phe_duyet", label: "Không phê duyệt" }); setPin(""); setPinError(""); setLyDoTraVe("") }}
                style={{ background: "#e11d48" }}
                className="flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-xl transition-all hover:opacity-90"
              >
                <X size={14} /> Không phê duyệt
              </button>
            )}

            {/* Xem xét xử lý sau khi phê duyệt từ chối */}
            {!isNew && trangThai === "bi_tu_choi_phe_duyet" && canXemXet && (
              <>
                <button
                  onClick={() => { setPinModal({ action: "gui_lai_phe_duyet", label: "Ký xem xét & gửi phê duyệt lại" }); setPin(""); setPinError("") }}
                  style={{ background: "#ea580c" }}
                  className="flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-xl transition-all hover:opacity-90"
                >
                  <Send size={14} /> Gửi phê duyệt lại
                </button>
                <button
                  onClick={() => { setPinModal({ action: "tra_ve_nhap", label: "Trả về Nháp" }); setPin(""); setPinError(""); setLyDoTraVe("") }}
                  style={{ background: "#64748b" }}
                  className="flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-xl transition-all hover:opacity-90"
                >
                  <RotateCcw size={14} /> Trả về Nháp
                </button>
              </>
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
              {renderInfoForm()}
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
                        setForm((f) => ({
                          ...f,
                          xem_xet_user_id: uid,
                          xem_xet: profileName(uid),
                          phe_duyet_user_id: f.phe_duyet_user_id === uid ? "" : f.phe_duyet_user_id,
                          phe_duyet: f.phe_duyet_user_id === uid ? "" : f.phe_duyet,
                        }))
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
            <div id="file-goc-upload" className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h2 className="text-sm font-extrabold text-slate-700 mb-3">File tài liệu</h2>
              <p className="text-xs text-slate-500 mb-3">PDF, DOCX hoặc XLSX</p>

              {/* Hướng dẫn nhãn header */}
              <div className="mb-3 p-2.5 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-700">
                <p className="font-bold mb-1">Nhãn hệ thống tự nhận diện trong phần header tài liệu:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li><code className="bg-blue-100 px-1 rounded">Mã tài liệu:</code></li>
                  <li><code className="bg-blue-100 px-1 rounded">Lần ban hành:</code> hoặc <code className="bg-blue-100 px-1 rounded">Lần sửa đổi:</code></li>
                  <li><code className="bg-blue-100 px-1 rounded">Tình trạng:</code></li>
                  <li><code className="bg-blue-100 px-1 rounded">Ngày hiệu lực:</code></li>
                  <li><code className="bg-blue-100 px-1 rounded">QR:</code> hoặc <code className="bg-blue-100 px-1 rounded">QR</code></li>
                </ul>
                <p className="mt-1 text-blue-600">Nếu dùng nhãn khác (VD: &quot;Trạng thái:&quot;, &quot;Mã hồ sơ:&quot;), hệ thống sẽ cảnh báo và không điền vào đó.</p>
              </div>

              {renderOfficeTagGuide()}

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
              <input
                ref={reviewChangeFileInputRef}
                type="file"
                accept=".pdf,.docx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleFileUpload(f, "change")
                  e.target.value = ""
                }}
              />
              <input
                ref={reviewRequestFileInputRef}
                type="file"
                accept=".pdf,.docx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleFileUpload(f, "review")
                  e.target.value = ""
                }}
              />

              {uploadedFileUrl && !doc?.file_signed_pdf_url ? (
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
              ) : !doc?.file_signed_pdf_url ? (
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
              ) : null}


              {form.chon_quy_trinh === "Soát xét" && (
                <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                  <div>
                    <p className="text-xs font-bold text-slate-600 mb-2">Phiếu yêu cầu thay đổi</p>
                    {reviewChangeFileUrl ? (
                      <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-xl">
                        <FileText size={16} className="text-amber-600 shrink-0" />
                        <span className="text-xs text-slate-700 flex-1 truncate">{reviewChangeFileName}</span>
                        <a href={reviewChangeFileUrl} target="_blank" rel="noreferrer" className="shrink-0 p-1 hover:bg-amber-100 rounded-lg">
                          <Eye size={13} className="text-amber-600" />
                        </a>
                      </div>
                    ) : null}
                    {isEditable && (
                      <button
                        onClick={() => reviewChangeFileInputRef.current?.click()}
                        disabled={fileUploading}
                        className="mt-2 w-full px-3 py-2 border border-dashed border-slate-300 hover:border-amber-400 text-slate-500 hover:text-amber-700 text-xs font-medium rounded-xl transition-all"
                      >
                        {reviewChangeFileUrl ? "Thay file" : "Upload phiếu yêu cầu thay đổi"}
                      </button>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-600 mb-2">Đề nghị soát xét</p>
                    {reviewRequestFileUrl ? (
                      <div className="flex items-center gap-2 p-3 bg-sky-50 rounded-xl">
                        <FileText size={16} className="text-sky-600 shrink-0" />
                        <span className="text-xs text-slate-700 flex-1 truncate">{reviewRequestFileName}</span>
                        <a href={reviewRequestFileUrl} target="_blank" rel="noreferrer" className="shrink-0 p-1 hover:bg-sky-100 rounded-lg">
                          <Eye size={13} className="text-sky-600" />
                        </a>
                      </div>
                    ) : null}
                    {isEditable && (
                      <button
                        onClick={() => reviewRequestFileInputRef.current?.click()}
                        disabled={fileUploading}
                        className="mt-2 w-full px-3 py-2 border border-dashed border-slate-300 hover:border-sky-400 text-slate-500 hover:text-sky-700 text-xs font-medium rounded-xl transition-all"
                      >
                        {reviewRequestFileUrl ? "Thay file" : "Upload đề nghị soát xét"}
                      </button>
                    )}
                  </div>
                </div>
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
              {doc?.file_signed_office_url && (
                <div className="mt-3 flex items-center gap-2 p-3 bg-indigo-50 rounded-xl">
                  <CheckCircle2 size={14} className="text-indigo-600 shrink-0" />
                  <span className="text-xs text-indigo-700 flex-1">DOCX/XLSX có chữ ký</span>
                  <a href={doc.file_signed_office_url} target="_blank" rel="noreferrer" className="shrink-0">
                    <Eye size={13} className="text-indigo-600" />
                  </a>
                  <a href={doc.file_signed_office_url} download className="shrink-0">
                    <Download size={13} className="text-indigo-600" />
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
              <h3 className="font-bold text-slate-800 text-sm">
                Đặt chữ ký: {placementModal.fileLabel}
                {placementModal.fileTotal > 1 ? ` (${placementModal.fileIndex}/${placementModal.fileTotal})` : ""}
              </h3>
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
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700 border border-amber-200">
                  Không đặt ra ngoài ô chứa
                </span>
                <button
                  onClick={() => setPlacementModal((p) => p ? { ...p, showSignerName: !p.showSignerName } : null)}
                  className="px-2 py-1 rounded-lg border border-slate-300 hover:bg-slate-50 transition-all"
                >
                  {placementModal.showSignerName ? "Ẩn tên (X)" : "Hiện tên"}
                </button>
              </div>
              <div className="flex gap-2">
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
                {placementModal.previewSignatures
                  .filter((entry) => entry.page === placementModal.currentPage)
                  .map((entry) => (
                    <div key={`prev-${entry.signerUserId}-${entry.page}`} style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none", zIndex: 5 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={entry.url}
                        alt=""
                        draggable={false}
                        style={{
                          position: "absolute",
                          left: entry.x * placementModal.canvasScale,
                          top: (placementModal.pdfPageHeight - entry.y - entry.height) * placementModal.canvasScale,
                          width: entry.width * placementModal.canvasScale,
                          height: entry.height * placementModal.canvasScale,
                          objectFit: "contain",
                          opacity: 0.45,
                        }}
                      />
                      {entry.showSignerName !== false && entry.signerName && (
                        <div
                          style={{
                            position: "absolute",
                            left: (entry.nameX ?? 0) * placementModal.canvasScale,
                            top: (placementModal.pdfPageHeight - (entry.nameY ?? 0) - (entry.nameHeight ?? 20)) * placementModal.canvasScale,
                            width: (entry.nameWidth ?? 80) * placementModal.canvasScale,
                            height: (entry.nameHeight ?? 20) * placementModal.canvasScale,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 10,
                            fontFamily: '"Times New Roman", serif',
                            color: "#374151",
                            fontStyle: "italic",
                            border: "1px dashed rgba(100,100,200,0.4)",
                            backgroundColor: "rgba(200,200,255,0.15)",
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {entry.signerName}
                        </div>
                      )}
                    </div>
                  ))}
                {placementModal.sigImgUrl && (
                  <Draggable
                    nodeRef={draggableNodeRef as RefObject<HTMLElement>}
                    position={{ x: placementModal.sigX, y: placementModal.sigY }}
                    onStop={(_, d) => setPlacementModal((p) => p ? { ...p, sigX: d.x, sigY: d.y } : null)}
                    bounds="parent"
                  >
                    <div ref={draggableNodeRef} style={{ position: "absolute", top: 0, left: 0, zIndex: 10, cursor: "move" }}>
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
                        {/* eslint-disable-next-line @next/next/no-img-element */}
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
                          Không đặt ra ngoài ô chứa
                        </span>
                      </Resizable>
                    </div>
                  </Draggable>
                )}
                {placementModal.showQrPlacement && (
                  <Draggable
                    nodeRef={qrNodeRef as RefObject<HTMLElement>}
                    position={{ x: placementModal.qrX, y: placementModal.qrY }}
                    onStop={(_, d) => setPlacementModal((p) => p ? { ...p, qrX: d.x, qrY: d.y } : null)}
                    bounds="parent"
                  >
                    <div ref={qrNodeRef} style={{ position: "absolute", top: 0, left: 0, zIndex: 10, cursor: "move" }}>
                      <Resizable
                        size={{ width: placementModal.qrW, height: placementModal.qrH }}
                        onResizeStop={(_, __, ref) => setPlacementModal((p) => p ? {
                          ...p,
                          qrW: parseInt(ref.style.width) || p.qrW,
                          qrH: parseInt(ref.style.height) || p.qrH,
                        } : null)}
                        minWidth={40}
                        minHeight={40}
                        style={{ border: "2px dashed #0ea5e9", position: "relative", background: "rgba(255,255,255,0.9)" }}
                      >
                        <QRCodeSVG
                          value={recordUrl}
                          size={Math.max(Math.min(placementModal.qrW, placementModal.qrH) - 8, 20)}
                          className="m-1"
                        />
                        <span style={{
                          position: "absolute",
                          top: -20,
                          left: 0,
                          fontSize: 10,
                          color: "#0ea5e9",
                          background: "rgba(255,255,255,0.92)",
                          padding: "1px 5px",
                          borderRadius: 4,
                          whiteSpace: "nowrap",
                          pointerEvents: "none",
                        }}>
                          Không đặt ra ngoài ô chứa
                        </span>
                      </Resizable>
                    </div>
                  </Draggable>
                )}
                {placementModal.showSignerName && placementModal.signerName && (
                  <Draggable
                    nodeRef={nameNodeRef as RefObject<HTMLElement>}
                    position={{ x: placementModal.nameX, y: placementModal.nameY }}
                    onStop={(_, d) => setPlacementModal((p) => p ? { ...p, nameX: d.x, nameY: d.y } : null)}
                    bounds="parent"
                  >
                    <div
                      ref={nameNodeRef}
                      style={{ position: "absolute", top: 0, left: 0, zIndex: 11, cursor: "move" }}
                    >
                      <Resizable
                        size={{ width: placementModal.nameW, height: placementModal.nameH }}
                        onResizeStop={(_, __, ref) => setPlacementModal((p) => p ? {
                          ...p,
                          nameW: parseInt(ref.style.width) || p.nameW,
                          nameH: parseInt(ref.style.height) || p.nameH,
                        } : null)}
                        minWidth={90}
                        minHeight={22}
                        style={{
                          border: "2px dashed #0f766e",
                          position: "relative",
                          background: "rgba(255,255,255,0.95)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: "2px 8px",
                        }}
                      >
                        <button
                          type="button"
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={() => setPlacementModal((p) => p ? { ...p, showSignerName: false } : null)}
                          className="absolute -left-2 -top-2 shrink-0 rounded-full border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500 shadow-sm hover:bg-slate-50"
                        >
                          (X)
                        </button>
                        <span
                          style={{
                            fontFamily: "\"Times New Roman\", serif",
                            fontSize: 13,
                            lineHeight: 1.1,
                            color: "#111827",
                            maxWidth: "100%",
                            textAlign: "center",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            pointerEvents: "none",
                          }}
                        >
                          {placementModal.signerName}
                        </span>
                        <span style={{
                          position: "absolute",
                          top: -20,
                          left: 0,
                          fontSize: 10,
                          color: "#0f766e",
                          background: "rgba(255,255,255,0.92)",
                          padding: "1px 5px",
                          borderRadius: 4,
                          whiteSpace: "nowrap",
                          pointerEvents: "none",
                        }}>
                          Không đặt ra ngoài ô chứa
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

              {(pinModal.action === "tra_ve" || pinModal.action === "khong_xem_xet" || pinModal.action === "tu_choi_phe_duyet" || pinModal.action === "tra_ve_nhap") && (
                <div className="mb-4">
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    {pinModal.action === "khong_xem_xet" ? "Lý do từ chối xem xét" : pinModal.action === "tu_choi_phe_duyet" ? "Lý do không phê duyệt" : "Lý do trả về"}
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
