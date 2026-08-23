"use client"

import { Fragment, type RefObject, useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, getFreshAuthSession, hasPermission, type SessionUser } from "@/lib/auth"
import { IsoShell } from "../../_components/iso-shell"
import { ModalShell } from "../../../_components/modal-shell"
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
  SIGN_AS_OPTIONS,
  SIGN_AS_LABEL,
  type IsoDocument,
  type IsoDocumentForm,
  type IsoDocumentTypeMaster,
  type IsoStandard,
  type SignAsType,
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
  Share2,
  ChevronUp,
  Plus,
} from "lucide-react"
import Link from "next/link"
import { QRCodeSVG } from "qrcode.react"
import Draggable from "react-draggable"
import { Resizable } from "re-resizable"
import { DistributionModal } from "../../_components/distribution-modal"
import { DistributionManagement } from "../../_components/distribution-management"

type ProfileOption = {
  id: string
  full_name: string
  username: string
  role: string
}

function ExtraDraggableBox({
  position,
  onDrag,
  onStop,
  zIndex = 12,
  children,
}: {
  position: { x: number; y: number }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onDrag?: (e: any, d: { x: number; y: number }) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onStop?: (e: any, d: { x: number; y: number }) => void
  zIndex?: number
  children: React.ReactNode
}) {
  const nodeRef = useRef<HTMLDivElement>(null)
  return (
    <Draggable
      nodeRef={nodeRef as RefObject<HTMLElement>}
      position={position}
      onDrag={onDrag}
      onStop={onStop}
      bounds="parent"
      cancel=".react-resizable-handle,button"
    >
      <div ref={nodeRef} style={{ position: "absolute", top: 0, left: 0, zIndex, cursor: "move" }}>
        {children}
      </div>
    </Draggable>
  )
}

type UploadedMainFile = {
  name: string
  url: string
}

type ChildUploadFile = UploadedMainFile

type ChildDraftRow = {
  id: string
  loai_tai_lieu: string
  ten_tai_lieu: string
  so_hieu: string
  lan_ban_hanh: string
  ghi_chu: string
  file_url: string | null
  file_name: string | null
}

type ChildReviewRow = {
  id: string
  old_doc_id: string
  ma_tai_lieu_cu: string
  ten_tai_lieu_cu: string
  loai_tai_lieu: string
  lan_sua_doi: string
  doi_ma: boolean
  ma_tai_lieu_moi: string
  ten_tai_lieu_moi: string
  file_url: string | null
  file_name: string | null
}

type PinModalAction = "gui_xem_xet" | "gui_phe_duyet" | "phe_duyet" | "tra_ve" | "khong_xem_xet" | "tu_choi_phe_duyet" | "gui_lai_phe_duyet" | "tra_ve_nhap"

type ExtraSignPlacement = {
  page: number
  x: number
  y: number
  width: number
  height: number
  showSignature?: boolean
  showSignerName?: boolean
  nameX?: number
  nameY?: number
  nameWidth?: number
  nameHeight?: number
}

type SignPlacement = ExtraSignPlacement & {
  qrX?: number
  qrY?: number
  qrWidth?: number
  qrHeight?: number
  extraPlacements?: ExtraSignPlacement[]
  // Hộp tiền tố ký thay (KT./TM./TL./TUQ.) — chỉ áp dụng cho bước Phê duyệt, chỉ vẽ
  // trên PDF. Giá trị chữ thật đọc từ cột doc.phe_duyet_sign_as, không lưu ở đây.
  showPrefix?: boolean
  prefixX?: number
  prefixY?: number
  prefixWidth?: number
  prefixHeight?: number
}

// Đọc tiền tố ký thay để hiển thị trên UI.
function signAsPrefixLabel(signAs: SignAsType | null | undefined): string {
  return signAs && signAs !== "none" ? `${signAs}. ` : ""
}

type PreviewSignature = SignPlacement & {
  signerUserId: string
  url: string
  signerName?: string
}

type SignFileKind = "main" | "change_request" | "review_request"

type SignFileTask = {
  docId: string
  kind: SignFileKind
  label: string
  url: string
}

type SignedFilePlacement = {
  docId: string
  kind: SignFileKind
  placement: SignPlacement
}

type WorkflowSignStep = "soan_thao" | "xem_xet" | "phe_duyet"

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

function normalizeRevisionText(value: unknown, fallback = "00"): string {
  const text = String(value ?? "").trim()
  return text || fallback
}

function incrementRevisionText(value: unknown): string {
  const normalized = normalizeRevisionText(value)
  const parts = normalized.split("/")
  const lastPart = parts[parts.length - 1]
  if (!/^\d+$/.test(lastPart)) return normalized
  const next = String(Number.parseInt(lastPart, 10) + 1).padStart(Math.max(lastPart.length, 2), "0")
  parts[parts.length - 1] = next
  return parts.join("/")
}

function isValidRevisionText(value: string | null | undefined): boolean {
  const text = String(value ?? "").trim()
  return /^\d{2}(?:\/\d{2})?$/.test(text)
}

function hasVietnameseOrNonAsciiName(fileName: string): boolean {
  return /[^\x00-\x7F]/.test(fileName)
}

function stripFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".")
  return (lastDot > 0 ? fileName.slice(0, lastDot) : fileName).trim()
}

function makeChildDraftId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function normalizeDocumentCode(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
}

function formatDocumentCode(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toUpperCase()
}

function resolveWorkflowStepForAction(item: Pick<IsoDocument, "cap_tl" | "xem_xet_user_id">, action: PinModalAction): WorkflowSignStep | null {
  if (action === "gui_xem_xet") return "soan_thao"
  if (action === "gui_lai_phe_duyet") return "xem_xet"
  if (action === "gui_phe_duyet") {
    const hasReviewer = !!item.xem_xet_user_id
    return item.cap_tl === "Cấp 2" || !hasReviewer ? "soan_thao" : "xem_xet"
  }
  if (action === "phe_duyet") return "phe_duyet"
  return null
}

type InferredDocFields = {
  phong_ban?: string
  loai_tai_lieu?: string
  so_hieu?: string
  ten_tai_lieu?: string
}

// Parse tên file kiểu "PHK-QT02 Quy trình kiểm soát sự thay đổi.pdf"
// → { phong_ban: "PHK", loai_tai_lieu: "QT", so_hieu: "2", ten_tai_lieu: "Quy trình kiểm soát sự thay đổi" }
function parseDocNameFromFileName(fileName: string): InferredDocFields {
  const base = stripFileExtension(fileName).trim()
  // Pattern: PHONGBAN-LOAI+SO TENTAILIEU (e.g. "PHK-QT02 Quy trình...")
  const m = base.match(/^([A-Z]{2,6})-([A-ZĐ]{1,3})0*(\d{1,4})\s+(.+)$/i)
  if (m) {
    return {
      phong_ban: m[1].toUpperCase(),
      loai_tai_lieu: m[2].toUpperCase(),
      so_hieu: String(parseInt(m[3], 10)),
      ten_tai_lieu: m[4].trim(),
    }
  }
  // Không match pattern mã → chỉ lấy tên file làm tên tài liệu
  if (base) return { ten_tai_lieu: base }
  return {}
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
  "{{LY_DO_THAY_DOI}}",
  "{{NOI_DUNG_THAY_DOI}}",
]

const ISO_OFFICE_SIGNATURE_TAGS = [
  "{{CHU_KY_SOAN_THAO}}",
  "{{TEN_SOAN_THAO}}",
  "{{GIOI_TINH_SOAN_THAO}}",
  "{{CHUC_VU_CHINH_QUYEN_SOAN_THAO}}",
  "{{CHUC_VU_KIEM_NHIEM_SOAN_THAO}}",
  "{{CHU_KY_XEM_XET}}",
  "{{TEN_XEM_XET}}",
  "{{GIOI_TINH_XEM_XET}}",
  "{{CHUC_VU_CHINH_QUYEN_XEM_XET}}",
  "{{CHUC_VU_KIEM_NHIEM_XEM_XET}}",
  "{{CHU_KY_PHE_DUYET}}",
  "{{TEN_PHE_DUYET}}",
  "{{GIOI_TINH_PHE_DUYET}}",
  "{{CHUC_VU_CHINH_QUYEN_PHE_DUYET}}",
  "{{CHUC_VU_KIEM_NHIEM_PHE_DUYET}}",
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
  const [childDocs, setChildDocs] = useState<IsoDocument[]>([])
  const [siblingDocs, setSiblingDocs] = useState<Pick<IsoDocument, "id" | "ma_tai_lieu" | "ten_tai_lieu" | "trang_thai" | "loai_tai_lieu" | "file_signed_pdf_url" | "file_signed_office_url" | "file_goc_url" | "auto_convert_pdf">[]>([])
  const [form, setForm] = useState<IsoDocumentForm>(emptyIsoForm())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // File upload
  const [fileUploading, setFileUploading] = useState(false)
  const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const [convertingToPdf, setConvertingToPdf] = useState(false)
  const [childUploadType, setChildUploadType] = useState("F")
  const [childUploadStartNo, setChildUploadStartNo] = useState("1")
  const [childUploadFiles, setChildUploadFiles] = useState<ChildUploadFile[]>([])
  const [childDraftRows, setChildDraftRows] = useState<ChildDraftRow[]>([])
  const [childReviewRows, setChildReviewRows] = useState<ChildReviewRow[]>([])
  const [activeChildUploadRowId, setActiveChildUploadRowId] = useState<string | null>(null)
  const [reviewChangeFileUrl, setReviewChangeFileUrl] = useState<string | null>(null)
  const [reviewChangeFileName, setReviewChangeFileName] = useState<string | null>(null)
  const [reviewRequestFileUrl, setReviewRequestFileUrl] = useState<string | null>(null)
  const [reviewRequestFileName, setReviewRequestFileName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const childFilesInputRef = useRef<HTMLInputElement>(null)
  const activeChildUploadRowIdRef = useRef<string | null>(null)
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
  const [selectedParentDocId, setSelectedParentDocId] = useState("")
  const [standardsOpen, setStandardsOpen] = useState(false)
  const [reviewDocId, setReviewDocId] = useState("")
  const [reviewParentDocId, setReviewParentDocId] = useState("")
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
    docId: string
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
    showSignature: boolean
    showSignerName: boolean
    prefixX: number
    prefixY: number
    prefixW: number
    prefixH: number
    extraSigBoxes: Array<{
      id: number
      sigX: number; sigY: number; sigW: number; sigH: number
      nameX: number; nameY: number; nameW: number; nameH: number
      showSignature: boolean; showSignerName: boolean
    }>
  } | null>(null)
  // Ký thay (KT./TM./TL./TUQ.) — chỉ có ý nghĩa ở action "phe_duyet". Đặt ở state
  // ngoài placementModal (không reset khi openPlacementForTask thay đổi file đang
  // ký trong hàng đợi nhiều file) để cùng 1 lựa chọn áp dụng nhất quán cho cả main
  // doc lẫn các file phụ/hồ sơ con trong cùng một lượt phê duyệt.
  const [signAs, setSignAs] = useState<SignAsType>("none")
  const prefixNodeRef = useRef<HTMLDivElement>(null)
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null)
  const draggableNodeRef = useRef<HTMLDivElement>(null)
  const nameNodeRef = useRef<HTMLDivElement>(null)
  const qrNodeRef = useRef<HTMLDivElement>(null)
  const MAX_EXTRA_SIG = 5
  const extraSigNodeArray = useRef<Array<{ current: HTMLDivElement | null }>>(
    Array.from({ length: 5 }, () => ({ current: null as HTMLDivElement | null }))
  )
  const extraNameNodeArray = useRef<Array<{ current: HTMLDivElement | null }>>(
    Array.from({ length: 5 }, () => ({ current: null as HTMLDivElement | null }))
  )
  const pdfDocRef = useRef<unknown>(null)

  // Distribution
  const [canDistribute, setCanDistribute] = useState(false)
  const [showDistributeModal, setShowDistributeModal] = useState(false)
  const [showManagement, setShowManagement] = useState(false)
  const [oldRecipientCount, setOldRecipientCount] = useState(0)

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
    // profilesAll dùng chung cho select "Người soạn thảo" — phải bypass RLS (route
    // service-role) như 3 danh sách quyền bên dưới, nếu không người soát xét/phê duyệt
    // không phải admin chỉ thấy đúng 1 dòng của chính mình trong `profiles` (RLS), khiến
    // select không khớp option nào và hiện rỗng dù giá trị thật vẫn đúng.
    const [allList, soatXetList, xemXetList, pheDuyetList] = await Promise.all([
      loadProfilesByPermission(fid, ""),
      loadProfilesByPermission(fid, "iso.soat_xet"),
      loadProfilesByPermission(fid, "iso.xem_xet"),
      loadProfilesByPermission(fid, "iso.phe_duyet"),
    ])
    setProfilesAll(allList)
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
      .select("id, ma_tai_lieu, ten_tai_lieu, loai_tai_lieu, phong_ban, cap_tl, chon_quy_trinh, lan_ban_hanh, ghi_chu, phan_loai_tl, parent_doc_id, ma_tai_lieu_cu, doi_ma_tai_lieu, ma_tai_lieu_moi, trang_thai")
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
    setSelectedParentDocId(d.parent_doc_id || "")
    // Hydrate luôn cho luồng Soát xét — trước đây chỉ selectedParentDocId (Soạn thảo)
    // được nạp lại, khiến select "Tài liệu cha (bộ quy trình)" ở form Soát xét hồ sơ con
    // luôn rỗng ngay sau mỗi lần load trang (kể cả reload sau khi Lưu, kể cả người khác
    // mở lại sau đó) dù dữ liệu đã lưu đúng trong DB.
    setReviewParentDocId(d.parent_doc_id || "")
    if (!isCon) {
      setSiblingDocs([])
      let childrenQuery = supabase
        .from("iso_documents")
        .select("*")
        .eq("factory_id", fid)
        .eq("parent_doc_id", id)
        .order("ma_tai_lieu")
      if (d.trang_thai === "co_hieu_luc") {
        childrenQuery = childrenQuery.eq("trang_thai", "co_hieu_luc")
      }
      const { data: children } = await childrenQuery
      setChildDocs((children || []) as IsoDocument[])
    } else if (d.parent_doc_id) {
      let siblingsQuery = supabase
        .from("iso_documents")
        .select("*")
        .eq("factory_id", fid)
        .eq("parent_doc_id", d.parent_doc_id)
        .eq("trang_thai", d.trang_thai)
        .neq("id", id)
        .order("ma_tai_lieu")
      siblingsQuery = d.soan_thao_user_id
        ? siblingsQuery.eq("soan_thao_user_id", d.soan_thao_user_id)
        : siblingsQuery.is("soan_thao_user_id", null)
      siblingsQuery = d.xem_xet_user_id
        ? siblingsQuery.eq("xem_xet_user_id", d.xem_xet_user_id)
        : siblingsQuery.is("xem_xet_user_id", null)
      siblingsQuery = d.phe_duyet_user_id
        ? siblingsQuery.eq("phe_duyet_user_id", d.phe_duyet_user_id)
        : siblingsQuery.is("phe_duyet_user_id", null)
      siblingsQuery = d.created_by
        ? siblingsQuery.eq("created_by", d.created_by)
        : siblingsQuery
      const { data: siblings } = await siblingsQuery
      setChildDocs((siblings || []) as IsoDocument[])
      // Load ALL siblings for display (no filter by trang_thai/users)
      const { data: allSiblings } = await supabase
        .from("iso_documents")
        .select("id, ma_tai_lieu, ten_tai_lieu, trang_thai, loai_tai_lieu, file_signed_pdf_url, file_signed_office_url, file_goc_url, auto_convert_pdf")
        .eq("factory_id", fid)
        .eq("parent_doc_id", d.parent_doc_id)
        .order("ma_tai_lieu", { ascending: true })
      setSiblingDocs(allSiblings || [])
    } else {
      setChildDocs([])
      setSiblingDocs([])
    }

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
      lan_ban_hanh: normalizeRevisionText(d.lan_ban_hanh),
      soan_thao: d.soan_thao || "",
      soan_thao_user_id: d.soan_thao_user_id || "",
      xem_xet: d.xem_xet || "",
      xem_xet_user_id: d.xem_xet_user_id || "",
      phe_duyet: d.phe_duyet || "",
      phe_duyet_user_id: d.phe_duyet_user_id || "",
      ghi_chu: d.ghi_chu || "",
      mo_ta_tim_kiem: d.mo_ta_tim_kiem || "",
      standard_ids: selectedStandardIds,
      doi_ma_tai_lieu: !!d.doi_ma_tai_lieu || !!d.ma_tai_lieu_moi,
      ly_do_soat_xet: d.ly_do_soat_xet || "",
      noi_dung_soat_xet: d.noi_dung_soat_xet || "",
      ma_tai_lieu_moi: d.ma_tai_lieu_moi || "",
      phan_loai_tl: d.phan_loai_tl || "cha",
      // Không phải cột DB — suy ra từ việc tài liệu cha đã có sẵn không có mã, để checkbox
      // hiển thị đúng trạng thái khi mở lại tài liệu đã lưu trước đó.
      khong_co_ma: !isCon && !d.ma_tai_lieu,
    })
    setUploadedFileUrl(d.file_goc_url || null)
    if (d.file_goc_url) {
      const parts = d.file_goc_url.split("/")
      setUploadedFileName(decodeURIComponent(parts[parts.length - 1]))
    } else {
      setUploadedFileName(null)
    }
    const changeUrl = d.file_phieu_yeu_cau_thay_doi_url || null
    setReviewChangeFileUrl(changeUrl)
    if (changeUrl) {
      const parts = changeUrl.split("/")
      setReviewChangeFileName(decodeURIComponent(parts[parts.length - 1]))
    } else {
      setReviewChangeFileName(null)
    }
    const requestUrl = d.file_de_nghi_soat_xet_url || d.file_soat_xet_url || null
    setReviewRequestFileUrl(requestUrl)
    if (requestUrl) {
      const parts = requestUrl.split("/")
      setReviewRequestFileName(decodeURIComponent(parts[parts.length - 1]))
    } else {
      setReviewRequestFileName(null)
    }
  }, [])

  useEffect(() => {
    const bootstrap = async () => {
      const fid = await getActiveFactoryId()
      if (!fid) { setLoading(false); return }
      const session = await getFreshAuthSession()
      if (!session?.user) { setLoading(false); return }
      const uid = session.user.id
      const erp = JSON.parse(localStorage.getItem("erp_user") || "{}")
      setUser(erp)
      setFactoryId(fid)

      // Check iso.distribute permission
      const [profRes, permRes] = await Promise.all([
        supabase.from("profiles").select("role").eq("id", uid).single(),
        supabase.from("user_permissions").select("permission_code").eq("user_id", uid).eq("permission_code", "iso.distribute"),
      ])
      setCanDistribute(
        profRes.data?.role === "admin" ||
        ((permRes.data || []) as Array<{ permission_code: string }>).some(
          (p) => p.permission_code === "iso.distribute",
        ),
      )

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
  const isCon = doc ? (doc.phan_loai_tl === "con" || doc.loai_tai_lieu === "F") : false
  const fileSectionLabel = isCon ? "File hồ sơ" : "File tài liệu"
  // isCon của doc đang hiển thị trong placement modal (có thể là hồ sơ con, không phải main doc)
  const placementDocIsCon = placementModal
    ? (placementModal.fileKind === "change_request" || placementModal.fileKind === "review_request")
      ? true  // file phụ soát xét treated như isCon → hiển thị toggle "Ẩn chữ ký"
      : placementModal.docId === docId
        ? isCon
        : childDocs.some((c) => c.id === placementModal.docId && (c.phan_loai_tl === "con" || c.loai_tai_lieu === "F"))
    : false
  // Phải là đúng người được chỉ định VÀ có quyền
  const canXemXet = (hasPermission(user, "iso.soat_xet") || hasPermission(user, "iso.xem_xet")) && !!userId && userId === doc?.xem_xet_user_id
  const canApprove = hasPermission(user, "iso.phe_duyet") && !!userId && userId === doc?.phe_duyet_user_id
  // Người soạn thảo của tài liệu này (hoặc đang tạo mới)
  const isSoanThao = isNew || (!!userId && userId === doc?.soan_thao_user_id)
  // draft/tra_ve chỉ cho phép soạn thảo chỉnh sửa; bi_tu_choi chỉ cho xem xét
  const isEditable = isNew || ((trangThai === "draft" || trangThai === "tra_ve") && isSoanThao) || (trangThai === "bi_tu_choi_phe_duyet" && canXemXet)
  const canToggleAutoConvert = (trangThai === "draft" || trangThai === "tra_ve") && !!userId && userId === doc?.soan_thao_user_id
  const canAddChildRow = !!(selectedParentDocId && form.loai_tai_lieu_cha && form.so_hieu_cha)

  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text })
    setTimeout(() => setToast(null), 4000)
  }

  const handleFileUpload = async (
    file: File,
    target: "main" | "change" | "review" = "main",
  ) => {
    if (!factoryId) {
      if (target !== "main") showToast(false, "Chưa tải xong thông tin nhà máy, vui lòng thử lại")
      return
    }
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
        showToast(true, "Đã upload phiếu yêu cầu thay đổi")
      } else if (target === "review") {
        setReviewRequestFileUrl(urlData.publicUrl)
        setReviewRequestFileName(file.name)
        showToast(true, "Đã upload đề nghị soát xét")
      } else {
        setUploadedFileUrl(urlData.publicUrl)
        setUploadedFileName(file.name)
        // Gợi ý điền các trường form từ tên file
        const inferred = parseDocNameFromFileName(file.name)
        if (Object.keys(inferred).length > 0) {
          setForm((f) => rebuildDraftCode({
            ...f,
            phong_ban: f.phong_ban || inferred.phong_ban || f.phong_ban,
            loai_tai_lieu: f.loai_tai_lieu || inferred.loai_tai_lieu || f.loai_tai_lieu,
            so_hieu: f.so_hieu || inferred.so_hieu || f.so_hieu,
            // Soát xét: override "Tên tài liệu mới" từ tên file (pre-fill từ tài liệu nguồn đã lấp đầy trường này bằng tên cũ)
            // Soạn thảo: chỉ fill khi trống
            ten_tai_lieu: f.chon_quy_trinh === "Soát xét"
              ? (inferred.ten_tai_lieu || f.ten_tai_lieu)
              : (f.ten_tai_lieu || inferred.ten_tai_lieu || f.ten_tai_lieu),
          }))
        }
      }
    } finally {
      setFileUploading(false)
    }
  }

  const handleChildFilesUpload = async (files: FileList | File[]) => {
    if (!factoryId) return
    const fileArray = Array.from(files)
    if (fileArray.length === 0) return
    const allowed = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
    const invalid = fileArray.find((file) => !allowed.some((t) => file.type.includes(t.split("/")[1])) && !file.name.match(/\.(pdf|docx|xlsx)$/i))
    if (invalid) {
      setSaveError(`File ${invalid.name} không hợp lệ. Chỉ hỗ trợ PDF, DOCX, XLSX`)
      return
    }
    if (form.phan_loai_tl === "con") {
      setSaveError("Phần upload nhiều hồ sơ con chỉ dùng khi đang soạn thảo tài liệu cha.")
      return
    }
    if (!form.ma_tai_lieu) {
      setSaveError("Vui lòng nhập đủ thông tin để sinh mã tài liệu cha trước khi upload hồ sơ con.")
      return
    }

    setFileUploading(true)
    setSaveError(null)
    setHeaderMismatchWarnings([])
    try {
      const uploaded: ChildUploadFile[] = []
      const uploadWarnings: string[] = []
      for (const file of fileArray) {
        const safeName = sanitizeStorageFileName(file.name)
        if (hasVietnameseOrNonAsciiName(file.name)) {
          uploadWarnings.push(`${file.name} -> ${safeName}`)
        }
        const path = `${factoryId}/iso/child-records/${Date.now()}_${uploaded.length}_${safeName}`
        const { error } = await supabase.storage.from("iso-documents").upload(path, file, { upsert: true })
        if (error) { setSaveError(error.message); return }
        const { data: urlData } = supabase.storage.from("iso-documents").getPublicUrl(path)
        uploaded.push({ name: file.name, url: urlData.publicUrl })
      }
      setChildUploadFiles((prev) => [...prev, ...uploaded])
      if (uploadWarnings.length > 0) {
        showToast(false, `Đã chuẩn hoá tên file lưu trữ: ${uploadWarnings.join("; ")}`)
      } else {
        showToast(true, `Đã tải lên ${uploaded.length} file hồ sơ con`)
      }
    } finally {
      setFileUploading(false)
    }
  }
  void handleChildFilesUpload

  const handleChildRowFileUpload = async (file: File, rowId: string) => {
    if (!factoryId) return
    const allowed = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
    if (!allowed.some((t) => file.type.includes(t.split("/")[1])) && !file.name.match(/\.(pdf|docx|xlsx)$/i)) {
      setSaveError(`File ${file.name} không hợp lệ. Chỉ hỗ trợ PDF, DOCX, XLSX`)
      return
    }
    setFileUploading(true)
    setSaveError(null)
    try {
      const safeName = sanitizeStorageFileName(file.name)
      const path = `${factoryId}/iso/child-records/${Date.now()}_${safeName}`
      const { error } = await supabase.storage.from("iso-documents").upload(path, file, { upsert: true })
      if (error) { setSaveError(error.message); return }
      const { data: urlData } = supabase.storage.from("iso-documents").getPublicUrl(path)
      const isDraftRow = childDraftRows.some((row) => row.id === rowId)
      if (isDraftRow) {
        setChildDraftRows((rows) => rows.map((row) =>
          row.id === rowId
            ? (() => {
                const inferredNo = inferChildNumberFromFileName(file.name, row.loai_tai_lieu)
                return {
                  ...row,
                  so_hieu: inferredNo || row.so_hieu,
                  file_url: urlData.publicUrl,
                  file_name: file.name,
                  ten_tai_lieu: row.ten_tai_lieu || stripFileExtension(file.name),
                }
              })()
            : row
        ))
      } else {
        const { error: updateErr } = await supabase
          .from("iso_documents")
          .update({
            file_goc_url: urlData.publicUrl,
            file_template_url: urlData.publicUrl,
            file_signed_pdf_url: null,
            file_signed_office_url: null,
            file_signed_office_type: null,
          })
          .eq("id", rowId)
          .eq("factory_id", factoryId)
        if (updateErr) { setSaveError(updateErr.message); return }
        setChildDocs((rows) => rows.map((child) =>
          child.id === rowId
            ? {
                ...child,
                file_goc_url: urlData.publicUrl,
                file_template_url: urlData.publicUrl,
                file_signed_pdf_url: null,
                file_signed_office_url: null,
                file_signed_office_type: null,
              }
            : child
        ))
        setSiblingDocs((rows) => rows.map((sib) =>
          sib.id === rowId
            ? { ...sib, file_goc_url: urlData.publicUrl, file_signed_pdf_url: null, file_signed_office_url: null }
            : sib
        ))
        if (rowId === docId) {
          setDoc((prev) => prev ? { ...prev, file_goc_url: urlData.publicUrl, file_signed_pdf_url: null, file_signed_office_url: null } : prev)
        }
      }
      if (hasVietnameseOrNonAsciiName(file.name)) showToast(false, `Đã chuẩn hoá tên file lưu trữ: ${safeName}`)
      if (!isDraftRow) showToast(true, "Đã thay thế file hồ sơ")
    } finally {
      setFileUploading(false)
    }
  }

  const openChildFilePicker = (rowId: string) => {
    activeChildUploadRowIdRef.current = rowId
    setActiveChildUploadRowId(rowId)
    childFilesInputRef.current?.click()
  }

  const validateUniqueDocumentCodes = async () => {
    const codesToCheck: string[] = []
    const allowedExistingIdsByCode = new Map<string, Set<string>>()
    const isReviewFlow = form.chon_quy_trinh === "Soát xét"
    const allowExistingCodeForDoc = (code: string | null | undefined, sourceDocId: string | null | undefined) => {
      const normalizedCode = normalizeDocumentCode(code)
      if (!normalizedCode || !sourceDocId) return
      const allowedIds = allowedExistingIdsByCode.get(normalizedCode) || new Set<string>()
      allowedIds.add(sourceDocId)
      allowedExistingIdsByCode.set(normalizedCode, allowedIds)
    }

    const mainCode = resolvedMainDocumentCode()
    if (form.phan_loai_tl !== "con" && mainCode) {
      codesToCheck.push(mainCode)
      if (isReviewFlow) {
        allowExistingCodeForDoc(mainCode, reviewDocId || parentReviewSourceDocId || null)
      }
    }
    for (const row of childDraftRows) {
      const code = childRecordCode(row)
      if (code) codesToCheck.push(code)
    }
    for (const row of childReviewRows) {
      const code = normalizeDocumentCode(row.doi_ma ? row.ma_tai_lieu_moi : row.ma_tai_lieu_cu)
      if (!code) continue
      codesToCheck.push(code)
      if (isReviewFlow) {
        allowExistingCodeForDoc(code, row.old_doc_id || null)
      }
    }
    const normalizedCodes = codesToCheck.map((code) => normalizeDocumentCode(code)).filter(Boolean)
    const duplicateInDraft = normalizedCodes.find((code, index) => normalizedCodes.indexOf(code) !== index)
    if (duplicateInDraft) return `M\u00e3 ${duplicateInDraft} b\u1ecb tr\u00f9ng trong danh s\u00e1ch \u0111ang so\u1ea1n th\u1ea3o.`
    if (normalizedCodes.length === 0) return null

    const { data, error } = await supabase
      .from("iso_documents")
      .select("id, ma_tai_lieu, ten_tai_lieu, trang_thai")
      .eq("factory_id", factoryId)
    if (error) return error.message

    const existing = ((data || []) as Pick<IsoDocument, "id" | "ma_tai_lieu" | "ten_tai_lieu" | "trang_thai">[]).find((item) => {
      if (!item.ma_tai_lieu) return false
      if (!isNew && item.id === docId) return false
      const normalizedCode = normalizeDocumentCode(item.ma_tai_lieu)
      if (!normalizedCodes.includes(normalizedCode)) return false
      const allowedIds = allowedExistingIdsByCode.get(normalizedCode)
      if (allowedIds?.has(item.id)) return false
      if (isReviewFlow && item.trang_thai !== "co_hieu_luc") return false
      return true
    })
    if (!existing) return null
    return `M\u00e3 ${existing.ma_tai_lieu} \u0111\u00e3 t\u1ed3n t\u1ea1i${existing.ten_tai_lieu ? ` (${existing.ten_tai_lieu})` : ""}. Kh\u00f4ng th\u1ec3 so\u1ea1n th\u1ea3o m\u00e3 tr\u00f9ng.`
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
      !isConForm ? requireValue(form.loai_tai_lieu, "loại tài liệu") : null,
      !isConForm ? requireValue(form.ten_tai_lieu, "tên tài liệu") : null,
      !isConForm ? requireValue(form.lan_ban_hanh, isReviewForm ? "lần sửa đổi" : "lần ban hành") : null,
      !isConForm && !isValidRevisionText(form.lan_ban_hanh) ? "Lần ban hành/lần sửa đổi phải có dạng 2 chữ số hoặc NN/NN, ví dụ 01 hoặc 01/01" : null,
      requireValue(form.cap_tl, isConForm ? "cấp hồ sơ" : "cấp tài liệu"),
      requireValue(form.soan_thao_user_id, "người soạn thảo"),
      form.cap_tl === "Cấp 1" ? requireValue(form.xem_xet_user_id, "người xem xét") : null,
      requireValue(form.phe_duyet_user_id, "người phê duyệt"),
    ].filter(Boolean)
    if (commonErrors.length > 0) return commonErrors[0] as string

    if (isReviewForm) {
      // TH4: soát xét nhiều hồ sơ con — validate childReviewRows
      if (isConForm) {
        if (!reviewParentDocId) return "Vui lòng chọn tài liệu cha"
        if (childReviewRows.length === 0) return "Vui lòng thêm ít nhất một hồ sơ cần soát xét"
        const invalidRow = childReviewRows.find((row) => !row.old_doc_id || !row.lan_sua_doi || !row.ten_tai_lieu_moi.trim() || !row.file_url)
        if (invalidRow) return "Vui lòng điền đủ mã hồ sơ, lần sửa đổi, tên mới và file cho từng dòng"
        if (childReviewRows.some((row) => !isValidRevisionText(row.lan_sua_doi))) return "Lần sửa đổi của hồ sơ phải có dạng 2 chữ số hoặc NN/NN, ví dụ 01 hoặc 01/01"
        const dupMa = childReviewRows.filter((row) => row.doi_ma && !row.ma_tai_lieu_moi.trim())
        if (dupMa.length > 0) return "Vui lòng nhập mã hồ sơ mới cho các dòng có đổi mã"
        const newCodes = childReviewRows.map((row) => normalizeDocumentCode(row.doi_ma ? row.ma_tai_lieu_moi : row.ma_tai_lieu_cu))
        const hasDupNewCode = new Set(newCodes).size !== newCodes.length
        if (hasDupNewCode) return "Có mã hồ sơ mới bị trùng nhau trong danh sách"
      } else {
        // TH3: soát xét tài liệu cha — validate single-row fields
        const reviewErrors = [
          requireValue(form.ma_tai_lieu_cu || form.ma_tai_lieu, "mã tài liệu"),
          requireValue(form.ten_tai_lieu_cu, "tên tài liệu cũ"),
          form.doi_ma_tai_lieu ? requireValue(form.ma_tai_lieu_moi, "mã tài liệu mới") : null,
          requireValue(form.ly_do_soat_xet, "lý do soát xét"),
          requireValue(form.noi_dung_soat_xet, "nội dung soát xét"),
        ].filter(Boolean)
        if (reviewErrors.length > 0) return reviewErrors[0] as string
        if (childReviewRows.length > 0) {
          const invalidRow = childReviewRows.find((row) => !row.old_doc_id || !row.lan_sua_doi || !row.ten_tai_lieu_moi.trim() || !row.file_url)
          if (invalidRow) return "Vui lòng điền đủ mã hồ sơ, lần sửa đổi, tên mới và file cho từng hồ sơ con đang soát xét"
          if (childReviewRows.some((row) => !isValidRevisionText(row.lan_sua_doi))) return "Lần sửa đổi của hồ sơ con phải có dạng 2 chữ số hoặc NN/NN, ví dụ 01 hoặc 01/01"
          if (childReviewRows.some((row) => row.doi_ma && !row.ma_tai_lieu_moi.trim())) return "Vui lòng nhập mã hồ sơ mới cho các hồ sơ con có đổi mã"
        }
        if (childDraftRows.length > 0) {
          const invalidDraftRow = childDraftRows.find((row) =>
            !row.loai_tai_lieu || !row.so_hieu || !row.ten_tai_lieu.trim() || !row.lan_ban_hanh || !row.file_url
          )
          if (invalidDraftRow) return "Vui lòng nhập đủ Loại hồ sơ, Tên hồ sơ, Số hiệu, Lần ban hành và File hồ sơ cho từng hồ sơ con mới"
          if (childDraftRows.some((row) => !isValidRevisionText(row.lan_ban_hanh))) {
            return "Lần ban hành của hồ sơ con mới phải có dạng 2 chữ số hoặc NN/NN, ví dụ 00 hoặc 01/01"
          }
        }
      }
      const sharedReviewErrors = [
        requireValue(form.ly_do_soat_xet, "lý do soát xét"),
        requireValue(form.noi_dung_soat_xet, "nội dung soát xét"),
      ].filter(Boolean)
      return sharedReviewErrors[0] as string | undefined
    }

    const draftErrors = isConForm
      ? [
          requireValue(selectedParentDocId, "tài liệu cha"),
          requireValue(form.ma_tai_lieu_cha, "mã tài liệu"),
          requireValue(form.loai_tai_lieu_cha, "loại tài liệu"),
          requireValue(form.so_hieu_cha, "số hiệu tài liệu"),
          childDraftRows.length === 0 ? "Vui lòng thêm ít nhất một hồ sơ" : null,
        ]
      : form.khong_co_ma
        ? []
        : [
            requireValue(form.so_hieu, "số hiệu"),
            requireValue(form.ma_tai_lieu, "mã tài liệu"),
          ]
    return draftErrors.filter(Boolean)[0] as string | undefined
  }

  const handleSave = async () => {
    if (!factoryId) return
    setSaving(true)
    setSaveError(null)
    try {
      const validationError = validateForm()
      if (validationError) { setSaveError(validationError); return }
      const duplicateCodeError = await validateUniqueDocumentCodes()
      if (duplicateCodeError) { setSaveError(duplicateCodeError); return }

      const session = await getFreshAuthSession()
      const currentDocCode = resolvedMainDocumentCode()
      const payload = {
        factory_id: factoryId,
        ma_tai_lieu: currentDocCode || null,
        ten_tai_lieu: form.ten_tai_lieu,
        loai_tai_lieu: form.loai_tai_lieu || null,
        phong_ban: form.phong_ban || null,
        cap_tl: form.cap_tl || null,
        chon_quy_trinh: form.chon_quy_trinh || null,
        lan_ban_hanh: normalizeRevisionText(form.lan_ban_hanh),
        soan_thao: form.soan_thao || null,
        soan_thao_user_id: form.soan_thao_user_id || null,
        xem_xet: form.xem_xet || null,
        xem_xet_user_id: form.xem_xet_user_id || null,
        phe_duyet: form.phe_duyet || null,
        phe_duyet_user_id: form.phe_duyet_user_id || null,
        ghi_chu: form.ghi_chu || null,
        mo_ta_tim_kiem: form.mo_ta_tim_kiem || null,
        doi_ma_tai_lieu: !!form.doi_ma_tai_lieu,
        ma_tai_lieu_cu: form.ma_tai_lieu_cu || doc?.ma_tai_lieu_cu || doc?.ma_tai_lieu || form.ma_tai_lieu || null,
        ly_do_soat_xet: form.ly_do_soat_xet || null,
        noi_dung_soat_xet: form.noi_dung_soat_xet || null,
        ma_tai_lieu_moi: form.doi_ma_tai_lieu ? (formatDocumentCode(form.ma_tai_lieu_moi) || null) : null,
        phan_loai_tl: form.phan_loai_tl || "cha",
        parent_doc_id: form.phan_loai_tl === "con" ? (selectedParentDocId || reviewParentDocId || null) : null,
        file_goc_url: uploadedFileUrl || null,
        file_template_url: uploadedFileUrl || null,
        ...(uploadedFileUrl && uploadedFileUrl !== doc?.file_goc_url ? {
          file_signed_pdf_url: null,
          file_signed_office_url: null,
          file_signed_office_type: null,
        } : {}),
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

      const saveChildDraftRecords = async (parentId: string) => {
        if (childDraftRows.length === 0) return []
        const invalidRow = childDraftRows.find((row) =>
          !row.loai_tai_lieu || !row.so_hieu || !row.ten_tai_lieu.trim() || !row.lan_ban_hanh || !row.file_url
        )
        if (invalidRow) {
          setSaveError("Vui lòng nhập đủ Loại hồ sơ, Tên hồ sơ, Số hiệu, Lần ban hành và File hồ sơ cho từng dòng.")
          return null
        }
        if (childDraftRows.some((row) => !isValidRevisionText(row.lan_ban_hanh))) {
          setSaveError("Lần ban hành của hồ sơ phải có dạng 2 chữ số hoặc NN/NN, ví dụ 00 hoặc 01/01.")
          return null
        }
        const parentCode = resolvedChildParentCode()
        const childPayloads = childDraftRows.map((row) => {
          const childCode = buildMaTaiLieuCon(parentCode, row.loai_tai_lieu, row.so_hieu)
          return {
            ...payload,
            ma_tai_lieu: childCode,
            ten_tai_lieu: row.ten_tai_lieu,
            loai_tai_lieu: row.loai_tai_lieu,
            lan_ban_hanh: normalizeRevisionText(row.lan_ban_hanh),
            ghi_chu: row.ghi_chu || null,
            phan_loai_tl: "con",
            parent_doc_id: parentId,
            ma_tai_lieu_cu: childCode,
            file_goc_url: row.file_url,
            file_template_url: row.file_url,
            file_soat_xet_url: null,
            file_phieu_yeu_cau_thay_doi_url: null,
            file_de_nghi_soat_xet_url: null,
          }
        })
        const { data, error } = await supabase
          .from("iso_documents")
          .insert(childPayloads)
          .select("id")
        if (error) { setSaveError(error.message); return null }
        const createdIds = (data || []).map((row) => row.id)
        await Promise.all(createdIds.map((id) => saveStandards(id)))
        setChildDraftRows([])
        showToast(true, `Đã tạo ${createdIds.length} hồ sơ con cho ${form.ma_tai_lieu}`)
        return createdIds
      }

      const saveChildReviewRecords = async (parentId: string) => {
        if (childReviewRows.length === 0) return []
        const childReviewPayloads = childReviewRows.map((row) => ({
          factory_id: factoryId,
          ma_tai_lieu: formatDocumentCode(row.doi_ma && row.ma_tai_lieu_moi ? row.ma_tai_lieu_moi : row.ma_tai_lieu_cu) || null,
          ten_tai_lieu: row.ten_tai_lieu_moi,
          loai_tai_lieu: row.loai_tai_lieu || null,
          phong_ban: form.phong_ban || null,
          cap_tl: form.cap_tl || null,
          chon_quy_trinh: "Soát xét",
          lan_ban_hanh: normalizeRevisionText(row.lan_sua_doi, "01"),
          soan_thao: form.soan_thao || null,
          soan_thao_user_id: form.soan_thao_user_id || null,
          xem_xet: form.xem_xet || null,
          xem_xet_user_id: form.xem_xet_user_id || null,
          phe_duyet: form.phe_duyet || null,
          phe_duyet_user_id: form.phe_duyet_user_id || null,
          ghi_chu: form.ghi_chu || null,
          doi_ma_tai_lieu: row.doi_ma,
          ma_tai_lieu_cu: row.ma_tai_lieu_cu,
          ly_do_soat_xet: form.ly_do_soat_xet || null,
          noi_dung_soat_xet: form.noi_dung_soat_xet || null,
          ma_tai_lieu_moi: row.doi_ma && row.ma_tai_lieu_moi ? formatDocumentCode(row.ma_tai_lieu_moi) : null,
          phan_loai_tl: "con",
          parent_doc_id: parentId,
          file_goc_url: row.file_url,
          file_template_url: row.file_url,
          file_soat_xet_url: reviewRequestFileUrl || null,
          file_phieu_yeu_cau_thay_doi_url: reviewChangeFileUrl || null,
          file_de_nghi_soat_xet_url: reviewRequestFileUrl || null,
          created_by: session?.user?.id,
        }))
        const { data, error } = await supabase
          .from("iso_documents")
          .insert(childReviewPayloads)
          .select("id")
        if (error) { setSaveError(error.message); return null }
        const createdIds = (data || []).map((row) => row.id)
        await Promise.all(createdIds.map((id) => saveStandards(id)))
        setChildReviewRows([])
        return createdIds
      }

      const saveChildRecords = async () => {
        if (form.phan_loai_tl === "con" || childUploadFiles.length === 0) return true
        const firstChildNumber = parseInt(childUploadStartNo)
        if (!Number.isFinite(firstChildNumber) || firstChildNumber < 1) {
          setSaveError("Số hiệu bắt đầu của hồ sơ con không hợp lệ.")
          return false
        }
        const childPayloads = childUploadFiles.map((file, index) => {
          const childCode = buildMaTaiLieuCon(form.ma_tai_lieu, childUploadType, String(firstChildNumber + index))
          return {
            ...payload,
            ma_tai_lieu: childCode,
            ten_tai_lieu: stripFileExtension(file.name) || form.ten_tai_lieu,
            loai_tai_lieu: childUploadType,
            phan_loai_tl: "con",
            ma_tai_lieu_cu: childCode,
            file_goc_url: file.url,
            file_template_url: file.url,
            file_soat_xet_url: null,
            file_phieu_yeu_cau_thay_doi_url: null,
            file_de_nghi_soat_xet_url: null,
          }
        })
        const { data, error } = await supabase
          .from("iso_documents")
          .insert(childPayloads)
          .select("id")
        if (error) { setSaveError(error.message); return false }
        const createdIds = (data || []).map((row) => row.id)
        await Promise.all(createdIds.map((id) => saveStandards(id)))
        setChildUploadFiles([])
        showToast(true, `Đã tạo ${createdIds.length} hồ sơ con cho ${form.ma_tai_lieu}`)
        return true
      }
      void saveChildRecords

      if (form.phan_loai_tl === "con" && isNew && form.chon_quy_trinh !== "Soát xét") {
        const createdIds = await saveChildDraftRecords(selectedParentDocId)
        if (!createdIds) return
        if (createdIds.length > 1) showToast(true, `Đã tạo ${createdIds.length} hồ sơ thành công. Đang mở hồ sơ đầu tiên...`)
        router.replace(`/dashboard/iso/documents/${createdIds[0] || selectedParentDocId}`)
        return
      }

      // TH4: soát xét nhiều hồ sơ con cùng lúc
      if (form.phan_loai_tl === "con" && isNew && form.chon_quy_trinh === "Soát xét") {
        const basePayload = {
          factory_id: factoryId,
          chon_quy_trinh: "Soát xét",
          phan_loai_tl: "con",
          parent_doc_id: reviewParentDocId || null,
          cap_tl: form.cap_tl || null,
          phong_ban: form.phong_ban || null,
          ly_do_soat_xet: form.ly_do_soat_xet || null,
          noi_dung_soat_xet: form.noi_dung_soat_xet || null,
          ghi_chu: form.ghi_chu || null,
          soan_thao: form.soan_thao || null,
          soan_thao_user_id: form.soan_thao_user_id || null,
          xem_xet: form.xem_xet || null,
          xem_xet_user_id: form.xem_xet_user_id || null,
          phe_duyet: form.phe_duyet || null,
          phe_duyet_user_id: form.phe_duyet_user_id || null,
          file_phieu_yeu_cau_thay_doi_url: reviewChangeFileUrl || null,
          file_de_nghi_soat_xet_url: reviewRequestFileUrl || null,
          file_soat_xet_url: reviewRequestFileUrl || null,
          created_by: (await getFreshAuthSession())?.user?.id,
        }
        const childReviewPayloads = childReviewRows.map((row) => ({
          ...basePayload,
          ma_tai_lieu: row.doi_ma && row.ma_tai_lieu_moi ? formatDocumentCode(row.ma_tai_lieu_moi) : formatDocumentCode(row.ma_tai_lieu_cu),
          ten_tai_lieu: row.ten_tai_lieu_moi,
          loai_tai_lieu: row.loai_tai_lieu || null,
          lan_ban_hanh: normalizeRevisionText(row.lan_sua_doi, "01"),
          doi_ma_tai_lieu: row.doi_ma,
          ma_tai_lieu_cu: row.ma_tai_lieu_cu,
          ma_tai_lieu_moi: row.doi_ma && row.ma_tai_lieu_moi ? formatDocumentCode(row.ma_tai_lieu_moi) : null,
          file_goc_url: row.file_url,
          file_template_url: row.file_url,
          standard_ids: form.standard_ids,
        }))
        const { data: insertedRows, error: insertErr } = await supabase
          .from("iso_documents")
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          .insert(childReviewPayloads.map(({ standard_ids: _sid, ...rest }) => rest))
          .select("id")
        if (insertErr) { setSaveError(insertErr.message); return }
        const insertedIds = (insertedRows || []).map((r) => r.id)
        await Promise.all(insertedIds.map((id) => saveStandards(id)))
        setChildReviewRows([])
        showToast(true, `Đã tạo ${insertedIds.length} hồ sơ soát xét`)
        router.replace(`/dashboard/iso/documents/${insertedIds[0]}`)
        return
      }

      if (isNew) {
        const { data, error } = await supabase
          .from("iso_documents")
          .insert(payload)
          .select("id")
          .single()
        if (error) { setSaveError(error.message); return }
        await saveStandards(data.id)
        const createdReviewChildIds = await saveChildReviewRecords(data.id)
        if (createdReviewChildIds === null) return
        const createdIds = await saveChildDraftRecords(data.id)
        if (!createdIds) return
        void loadEffectiveDocs(factoryId)
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
        const createdReviewChildIds = await saveChildReviewRecords(docId)
        if (createdReviewChildIds === null) return
        const createdIds = await saveChildDraftRecords(docId)
        if (!createdIds) return
        void loadEffectiveDocs(factoryId)
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
    transitionSignAs: SignAsType = "none",
  ) => {
    if (!factoryId || !user || !doc) return
    const now = new Date().toISOString()
    let invalidatedIds: string[] = []
    const childDocIds = childDocs.map((child) => child.id).filter(Boolean)
    const collectReviewCodesToInvalidate = () => {
      const docsToApprove = [doc, ...childDocs].filter((item): item is IsoDocument => !!item)
      const codes = new Set<string>()
      const approvingIds = new Set<string>()

      for (const item of docsToApprove) {
        approvingIds.add(item.id)
        if (item.chon_quy_trinh !== "Soát xét") continue
        const oldCode = normalizeDocumentCode(item.ma_tai_lieu_cu || item.ma_tai_lieu)
        const newCode = normalizeDocumentCode(item.doi_ma_tai_lieu ? (item.ma_tai_lieu_moi || item.ma_tai_lieu) : item.ma_tai_lieu)
        if (oldCode) codes.add(oldCode)
        if (newCode) codes.add(newCode)
      }

      return {
        codes: [...codes],
        approvingIds: [...approvingIds],
      }
    }
    const updateChildDocs = async (payload: Record<string, unknown>) => {
      if (childDocIds.length === 0) return null
      const { error } = await supabase
        .from("iso_documents")
        .update(payload)
        .in("id", childDocIds)
        .eq("factory_id", factoryId)
      return error
    }

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
        const childError = await updateChildDocs({ trang_thai: newStatus, ky_soan_thao_at: now })
        if (childError) { showToast(false, childError.message); return }

      } else if (action === "gui_phe_duyet") {
        const { error } = await supabase
          .from("iso_documents")
          .update({ trang_thai: "cho_phe_duyet", ky_xem_xet_at: now })
          .eq("id", docId).eq("factory_id", factoryId)
        if (error) { showToast(false, error.message); return }
        const childError = await updateChildDocs({ trang_thai: "cho_phe_duyet", ky_xem_xet_at: now })
        if (childError) { showToast(false, childError.message); return }

      } else if (action === "phe_duyet") {
        const isReview = doc.chon_quy_trinh === "Soát xét"
        const newDocumentCode = doc.doi_ma_tai_lieu && doc.ma_tai_lieu_moi ? doc.ma_tai_lieu_moi : doc.ma_tai_lieu
        const { codes: reviewCodesToInvalidate, approvingIds } = collectReviewCodesToInvalidate()
        if (reviewCodesToInvalidate.length > 0) {
          const { data: toInvalidate, error: invalidateLookupError } = await supabase
            .from("iso_documents")
            .select("id, ma_tai_lieu")
            .eq("factory_id", factoryId)
            .eq("trang_thai", "co_hieu_luc")
          if (invalidateLookupError) { showToast(false, invalidateLookupError.message); return }
          const reviewCodeSet = new Set(reviewCodesToInvalidate)
          invalidatedIds = ((toInvalidate || []) as Array<{ id: string; ma_tai_lieu: string | null }>)
            .filter((item) => reviewCodeSet.has(normalizeDocumentCode(item.ma_tai_lieu)))
            .map((item) => item.id)
            .filter((id) => !approvingIds.includes(id))
        }
        if (invalidatedIds.length > 0) {
          const { error: invalidateError } = await supabase
            .from("iso_documents")
            .update({ trang_thai: "het_hieu_luc", ngay_het_hieu_luc: now })
            .in("id", invalidatedIds)
            .eq("factory_id", factoryId)
          if (invalidateError) { showToast(false, invalidateError.message); return }
        }
        const updatePayload: Record<string, unknown> = {
          trang_thai: "co_hieu_luc",
          ky_phe_duyet_at: now,
          ngay_hieu_luc: now,
          phe_duyet_sign_as: transitionSignAs === "none" ? null : transitionSignAs,
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
        if (childDocIds.length > 0) {
          const childReviewUpdates = childDocs
            .filter((child) => child.chon_quy_trinh === "Soát xét" && child.doi_ma_tai_lieu && child.ma_tai_lieu_moi)
            .map((child) => ({
              id: child.id,
              ma_tai_lieu: child.ma_tai_lieu_moi as string,
              trang_thai: "co_hieu_luc" as const,
              ky_phe_duyet_at: now,
              ngay_hieu_luc: now,
              phe_duyet_sign_as: transitionSignAs === "none" ? null : transitionSignAs,
            }))
          const childReviewUpdateIds = new Set(childReviewUpdates.map((child) => child.id))
          for (const childUpdate of childReviewUpdates) {
            const { error: childReviewError } = await supabase
              .from("iso_documents")
              .update(childUpdate)
              .eq("id", childUpdate.id)
              .eq("factory_id", factoryId)
            if (childReviewError) { showToast(false, childReviewError.message); return }
          }
          const remainingChildIds = childDocIds.filter((id) => !childReviewUpdateIds.has(id))
          if (remainingChildIds.length > 0) {
            const { error: childError } = await supabase
              .from("iso_documents")
              .update({
                trang_thai: "co_hieu_luc",
                ky_phe_duyet_at: now,
                ngay_hieu_luc: now,
                phe_duyet_sign_as: transitionSignAs === "none" ? null : transitionSignAs,
              })
              .in("id", remainingChildIds)
              .eq("factory_id", factoryId)
            if (childError) { showToast(false, childError.message); return }
          }
        }

        // Trigger embedding (fire-and-forget) — không block workflow
        void fetch("/api/iso/forms/embed-doc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docId, factoryId }),
        }).catch(() => {})
        // Trigger embed cho hồ sơ con nếu có
        for (const cid of childDocIds) {
          void fetch("/api/iso/forms/embed-doc", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ docId: cid, factoryId }),
          }).catch(() => {})
        }
        // Trigger notify-obsolete cho các bản đã hết hiệu lực (soát xét)
        for (const obsoleteId of invalidatedIds) {
          void fetch("/api/iso/distribute/notify-obsolete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ obsoleteDocId: obsoleteId, newDocId: docId, factoryId }),
          }).catch(() => {})
        }

      } else if (action === "tra_ve" || action === "khong_xem_xet") {
        const { error } = await supabase
          .from("iso_documents")
          .update({ trang_thai: "tra_ve", ghi_chu: lyDo || null })
          .eq("id", docId).eq("factory_id", factoryId)
        if (error) { showToast(false, error.message); return }
        const childError = await updateChildDocs({ trang_thai: "tra_ve", ghi_chu: lyDo || null })
        if (childError) { showToast(false, childError.message); return }

      } else if (action === "tu_choi_phe_duyet") {
        // Cấp 1 → bi_tu_choi_phe_duyet (xem xét quyết định tiếp theo)
        // Cấp 2 → tra_ve trực tiếp (không có xem xét)
        const newStatus = doc.cap_tl === "Cấp 2" ? "tra_ve" : "bi_tu_choi_phe_duyet"
        const { error } = await supabase
          .from("iso_documents")
          .update({ trang_thai: newStatus, ghi_chu: lyDo || null })
          .eq("id", docId).eq("factory_id", factoryId)
        if (error) { showToast(false, error.message); return }
        const childError = await updateChildDocs({ trang_thai: newStatus, ghi_chu: lyDo || null })
        if (childError) { showToast(false, childError.message); return }

      } else if (action === "gui_lai_phe_duyet") {
        // Xem xét ký lại và gửi phê duyệt lại
        const { error } = await supabase
          .from("iso_documents")
          .update({ trang_thai: "cho_phe_duyet", ky_xem_xet_at: now })
          .eq("id", docId).eq("factory_id", factoryId)
        if (error) { showToast(false, error.message); return }
        const childError = await updateChildDocs({ trang_thai: "cho_phe_duyet", ky_xem_xet_at: now })
        if (childError) { showToast(false, childError.message); return }

      } else if (action === "tra_ve_nhap") {
        // Xem xét trả tài liệu về nháp
        const { error } = await supabase
          .from("iso_documents")
          .update({ trang_thai: "draft", ghi_chu: lyDo || null })
          .eq("id", docId).eq("factory_id", factoryId)
        if (error) { showToast(false, error.message); return }
        const childError = await updateChildDocs({ trang_thai: "draft", ghi_chu: lyDo || null })
        if (childError) { showToast(false, childError.message); return }
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
        : (placement ? [{ docId, kind: "main" as const, placement }] : [])
      if (token && !noSignActions.includes(action) && placementsToGenerate.length > 0) {
        try {
          for (const filePlacement of placementsToGenerate) {
          const pdfRes = await fetch("/api/sign/generate-pdf", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token,
              docId: filePlacement.docId,
              docType: "iso",
              fileKind: filePlacement.kind,
              signaturePlacement: filePlacement.placement,
              skipTagLabels: confirmedSkipTags,
              action,
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
              if (filePlacement.docId === docId) {
                setDoc((prev) => prev
                  ? {
                      ...prev,
                      ...(filePlacement.kind === "main" ? { file_signed_pdf_url: pdfJson.signedPdfUrl as string } : {}),
                      ...(filePlacement.kind === "change_request" ? { file_phieu_yeu_cau_thay_doi_signed_url: pdfJson.signedPdfUrl as string } : {}),
                      ...(filePlacement.kind === "review_request" ? { file_de_nghi_soat_xet_signed_url: pdfJson.signedPdfUrl as string } : {}),
                    }
                  : prev)
              } else if (filePlacement.kind === "main") {
                setChildDocs((rows) => rows.map((child) =>
                  child.id === filePlacement.docId
                    ? { ...child, file_signed_pdf_url: pdfJson.signedPdfUrl as string }
                    : child
                ))
              }
            }
            if (pdfJson.metaMismatched?.length > 0) {
              setHeaderMismatchWarnings(pdfJson.metaMismatched as Array<{ found: string; expected: string }>)
            }
            if (pdfJson.diagnostics?.metaFillError && !pdfJson.skipped) {
              showToast(false, "Không đọc được text của PDF — tag header/footer chưa được điền. Kiểm tra PDF template có chứa text thuần (không phải ảnh).")
              console.warn("[generate-pdf] metaFillError:", pdfJson.diagnostics.metaFillError)
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

      if (token && action === "phe_duyet") {
        const officePdfTasks = buildOfficeFileQueue().filter((task) => {
          if (task.kind !== "main") return false
          const item = task.docId === docId ? doc : childDocs.find((child) => child.id === task.docId)
          return !item || isActionAssignee(item, action)
        })
        for (const task of officePdfTasks) {
          try {
            const pdfRes = await fetch("/api/sign/generate-pdf", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                token,
                docId: task.docId,
                docType: "iso",
                fileKind: task.kind,
                action,
              }),
            })
            const pdfJson = await pdfRes.json()
            if (pdfJson.skipped) {
              // File chua duoc convert sang PDF - bo qua an toan, workflow van tiep tuc
            } else if (!pdfJson.ok || !pdfJson.signedPdfUrl) {
              pdfError = `${task.label}: ${pdfJson.error || "Kh\u00f4ng t\u1ea1o \u0111\u01b0\u1ee3c PDF ph\u00ea duy\u1ec7t"}`
              break
            } else {
              if (task.docId === docId) {
                setDoc((prev) => prev ? { ...prev, file_signed_pdf_url: pdfJson.signedPdfUrl as string } : prev)
              } else {
                setChildDocs((rows) => rows.map((child) =>
                  child.id === task.docId ? { ...child, file_signed_pdf_url: pdfJson.signedPdfUrl as string } : child
                ))
              }
            }
          } catch (pdfErr) {
            pdfError = pdfErr instanceof Error ? pdfErr.message : String(pdfErr)
            break
          }
        }
      }

      // Auto-convert Office → PDF sau phê duyệt nếu được bật
      if (action === "phe_duyet") {
        const docsToAutoConvert: Array<{ id: string; file_goc_url: string | null; auto_convert_pdf?: boolean | null }> = []
        if (doc.auto_convert_pdf && isOfficeUrl(doc.file_goc_url)) {
          docsToAutoConvert.push({ id: docId, file_goc_url: doc.file_goc_url, auto_convert_pdf: true })
        }
        for (const child of childDocs) {
          if (child.auto_convert_pdf && isOfficeUrl(child.file_goc_url)) {
            docsToAutoConvert.push({ id: child.id, file_goc_url: child.file_goc_url, auto_convert_pdf: true })
          }
        }
        if (docsToAutoConvert.length > 0) {
          showToast(true, "Đang chuyển file Office sang PDF...")
          let convertOk = 0
          let convertFail = 0
          for (const target of docsToAutoConvert) {
            try {
              const res = await fetch("/api/sign/convert-office", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ docId: target.id, factoryId, fileKind: "main" }),
              })
              const json = await res.json()
              if (json.ok && json.pdfUrl) {
                convertOk++
                if (target.id === docId) {
                  setDoc((prev) => prev ? { ...prev, file_signed_pdf_url: json.pdfUrl as string } : prev)
                } else {
                  setChildDocs((rows) => rows.map((child) =>
                    child.id === target.id ? { ...child, file_signed_pdf_url: json.pdfUrl as string } : child
                  ))
                }
              } else {
                convertFail++
              }
            } catch {
              convertFail++
            }
          }
          if (convertFail === 0) {
            showToast(true, `Đã chuyển ${convertOk} file sang PDF thành công!`)
          } else if (convertOk > 0) {
            showToast(false, `Chuyển PDF: ${convertOk} thành công, ${convertFail} thất bại`)
          } else {
            showToast(false, "Không thể chuyển sang PDF — vui lòng chuyển thủ công")
          }
        }
      }

      let invalidationError: string | null = null
      // Cập nhật artifact tài liệu cũ bị hủy hiệu lực
      if (invalidatedIds.length > 0) {
        try {
          const invalidationRes = await fetch("/api/sign/restamp-pdf", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ docIds: invalidatedIds, factoryId }),
          })
          const invalidationJson = await invalidationRes.json()
          if (!invalidationJson.ok) {
            const failed = Array.isArray(invalidationJson.results)
              ? invalidationJson.results.filter((item: { ok?: boolean }) => item.ok === false).length
              : 0
            invalidationError = failed > 0
              ? `${failed} file cũ chưa được cập nhật "Hết hiệu lực"`
              : (invalidationJson.error as string) || "Không cập nhật được file cũ hết hiệu lực"
          }
        } catch (error) {
          invalidationError = error instanceof Error ? error.message : String(error)
        }
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

      if (pdfError || invalidationError) {
        showToast(false, "Đã ký duyệt nhưng còn lỗi hậu xử lý: " + [pdfError, invalidationError].filter(Boolean).join(" | "))
      } else {
        showToast(true, "Đã cập nhật trạng thái")
      }
      void loadEffectiveDocs(factoryId)
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

  const handleConvertToPdf = async (targetDocId: string, isChild: boolean) => {
    if (!factoryId || !targetDocId || targetDocId === "new-doc") return
    setConvertingToPdf(true)
    setSaveError(null)
    try {
      const res = await fetch("/api/sign/convert-office", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId: targetDocId, factoryId }),
      })
      const json = await res.json()
      if (json.skipped) return // da la PDF
      if (!res.ok || !json.ok) throw new Error(json.error || "Chuyen doi that bai")
      if (isChild) {
        setChildDocs((rows) => rows.map((child) =>
          child.id === targetDocId ? { ...child, file_goc_url: json.pdfUrl as string } : child
        ))
      } else {
        setUploadedFileUrl(json.pdfUrl as string)
        setUploadedFileName((json.pdfUrl as string).split("/").pop()?.split("?")[0] || "converted.pdf")
        setDoc((prev) => prev ? { ...prev, file_goc_url: json.pdfUrl as string } : prev)
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Loi chuyen doi sang PDF")
    } finally {
      setConvertingToPdf(false)
    }
  }

  const isActionAssignee = (item: IsoDocument, action: PinModalAction) => {
    if (!userId) return false
    if (action === "gui_xem_xet") return item.soan_thao_user_id === userId
    if (action === "gui_lai_phe_duyet") return item.xem_xet_user_id === userId
    if (action === "gui_phe_duyet") {
      const step = resolveWorkflowStepForAction(item, action)
      return step === "soan_thao" ? item.soan_thao_user_id === userId : item.xem_xet_user_id === userId
    }
    if (action === "phe_duyet") return item.phe_duyet_user_id === userId
    return true
  }

  const buildSignFileQueue = (): SignFileTask[] => {
    if (!doc) return []
    const queue: SignFileTask[] = []
    if (isPdfUrl(doc.file_goc_url)) {
      queue.push({ docId: doc.id, kind: "main", label: "File PDF chính", url: doc.file_signed_pdf_url || doc.file_goc_url! })
    }
    // File phụ soát xét PDF — xử lý qua placement modal như hồ sơ con
    // Dùng _signed_ URL cho preview modal (signer thấy chữ ký bước trước); generate-pdf luôn đọc từ URL gốc
    if (doc.chon_quy_trinh === "Soát xét") {
      if (isPdfUrl(doc.file_phieu_yeu_cau_thay_doi_url)) {
        queue.push({
          docId: doc.id, kind: "change_request", label: "Phiếu yêu cầu thay đổi",
          url: doc.file_phieu_yeu_cau_thay_doi_signed_url || doc.file_phieu_yeu_cau_thay_doi_url!,
        })
      }
      const reviewUrl = doc.file_de_nghi_soat_xet_url || doc.file_soat_xet_url
      if (isPdfUrl(reviewUrl)) {
        queue.push({
          docId: doc.id, kind: "review_request", label: "Đề nghị soát xét",
          url: doc.file_de_nghi_soat_xet_signed_url || reviewUrl!,
        })
      }
    }
    for (const child of childDocs) {
      if (isPdfUrl(child.file_goc_url)) {
        queue.push({
          docId: child.id,
          kind: "main",
          label: `Hồ sơ ${child.ma_tai_lieu || child.ten_tai_lieu || ""}`.trim(),
          url: child.file_signed_pdf_url || child.file_goc_url!,
        })
      }
    }
    return queue
  }

  const buildOfficeFileQueue = (): SignFileTask[] => {
    if (!doc) return []
    const queue: SignFileTask[] = []
    if (isOfficeUrl(doc.file_goc_url)) {
      queue.push({ docId: doc.id, kind: "main", label: "File Office chính", url: doc.file_goc_url! })
    }
    if (doc.chon_quy_trinh === "Soát xét") {
      if (isOfficeUrl(doc.file_phieu_yeu_cau_thay_doi_url)) {
        queue.push({ docId: doc.id, kind: "change_request", label: "Phiếu yêu cầu thay đổi", url: doc.file_phieu_yeu_cau_thay_doi_url! })
      }
      const reviewUrl = doc.file_de_nghi_soat_xet_url || doc.file_soat_xet_url
      if (isOfficeUrl(reviewUrl)) {
        queue.push({ docId: doc.id, kind: "review_request", label: "Đề nghị soát xét", url: reviewUrl! })
      }
    }
    for (const child of childDocs) {
      if (isOfficeUrl(child.file_goc_url)) {
        queue.push({
          docId: child.id,
          kind: "main",
          label: `Hồ sơ ${child.ma_tai_lieu || child.ten_tai_lieu || ""}`.trim(),
          url: child.file_goc_url!,
        })
      }
    }
    return queue
  }

  const generateOfficeFiles = async (token: string | null, action: PinModalAction): Promise<string | null> => {
    const noSignActions: PinModalAction[] = ["tra_ve", "khong_xem_xet", "tu_choi_phe_duyet", "tra_ve_nhap"]
    if (!token || noSignActions.includes(action)) return null
    const queue = buildOfficeFileQueue().filter((task) => {
      const item = task.docId === docId ? doc : childDocs.find((child) => child.id === task.docId)
      return !item || isActionAssignee(item, action)
    })
    if (queue.length === 0) return null
    for (const task of queue) {
      const officeRes = await fetch("/api/sign/generate-office", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, docId: task.docId, docType: "iso", fileKind: task.kind, action }),
      })
      const officeJson = await officeRes.json()
      if (!officeJson.ok) {
        return `${task.label}: ${officeJson.error || "Không tạo được file Office đã ký"}`
      }
      if (officeJson.signedOfficeUrl) {
        if (task.docId === docId) {
          setDoc((prev) => prev
            ? {
                ...prev,
                ...(task.kind === "main" && (prev.phan_loai_tl === "con" || prev.loai_tai_lieu === "F")
                  ? { file_goc_url: officeJson.signedOfficeUrl as string, file_signed_office_url: null, file_signed_office_type: null }
                  : {}),
                ...(task.kind === "main" && !(prev.phan_loai_tl === "con" || prev.loai_tai_lieu === "F")
                  ? { file_signed_office_url: officeJson.signedOfficeUrl as string, file_signed_office_type: officeJson.outputType as string }
                  : {}),
                ...(task.kind === "change_request" ? { file_phieu_yeu_cau_thay_doi_signed_url: officeJson.signedOfficeUrl as string } : {}),
                ...(task.kind === "review_request" ? { file_de_nghi_soat_xet_signed_url: officeJson.signedOfficeUrl as string } : {}),
              }
            : prev)
        } else if (task.kind === "main") {
          setChildDocs((rows) => rows.map((child) =>
            child.id === task.docId
              ? {
                  ...child,
                  file_goc_url: officeJson.signedOfficeUrl as string,
                  file_signed_office_url: null,
                  file_signed_office_type: null,
                }
              : child
          ))
        }
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
    const item = task.docId === doc?.id ? doc : childDocs.find((child) => child.id === task.docId)
    const currentStep = item ? resolveWorkflowStepForAction(item, action) : null
    const isSoanThaoStep = currentStep === "soan_thao"
    const useSignedPdfAsBackground = task.kind === "main" && !!doc?.file_signed_pdf_url
    setPlacementModal({
      show: true,
      sourcePdfUrl: task.url,
      docId: task.docId,
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
      showQrPlacement: isSoanThaoStep,
      currentPage: 1,
      totalPages: 1,
      canvasScale: 1,
      pdfPageHeight: 842,
      sigImgUrl: sigUrlData.publicUrl,
      previewSignatures: useSignedPdfAsBackground || task.kind !== "main" ? [] : buildPreviewSignatures(action),
      signerName: user.full_name || user.username || "",
      showSignature: true,
      showSignerName: true,
      prefixX: 250,
      prefixY: 100,
      prefixW: 60,
      prefixH: 24,
      extraSigBoxes: [],
    })
  }

  const handlePinConfirm = async () => {
    if (!pinModal || !factoryId || !user) return
    if (!pin.trim()) { setPinError("Vui lòng nhập PIN"); return }
      setPinLoading(true)
      setPinError("")
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const accessToken = sessionData.session?.access_token
        if (!accessToken) {
          setPinError("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại")
          return
        }
        const verifyRes = await fetch("/api/sign/verify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
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
      // Reset lựa chọn ký thay cho lượt ký mới — không kế thừa từ lượt trước
      setSignAs("none")

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
        const isSoanThaoStep = user.id === doc.soan_thao_user_id && (action === "gui_xem_xet" || action === "gui_phe_duyet")
        const sourcePdfUrl = doc.file_signed_pdf_url || doc.file_goc_url
        const useSignedPdfAsBackground = !!doc.file_signed_pdf_url
        setPlacementModal({
          show: true,
          sourcePdfUrl,
          docId,
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
          previewSignatures: useSignedPdfAsBackground ? [] : buildPreviewSignatures(action),
          signerName: user.full_name || user.username || "",
          showSignature: true,
          showSignerName: true,
          prefixX: 250,
          prefixY: 100,
          prefixW: 60,
          prefixH: 24,
          extraSigBoxes: [],
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
      showSignature: placementModal.showSignature,
      showSignerName: placementModal.showSignerName,
      nameX: placementModal.nameX / canvasScale,
      nameY: pdfPageHeight - (placementModal.nameY / canvasScale) - (placementModal.nameH / canvasScale),
      nameWidth: placementModal.nameW / canvasScale,
      nameHeight: placementModal.nameH / canvasScale,
      qrX: placementModal.showQrPlacement ? (placementModal.qrX / canvasScale) : undefined,
      qrY: placementModal.showQrPlacement ? (pdfPageHeight - (placementModal.qrY / canvasScale) - (placementModal.qrH / canvasScale)) : undefined,
      qrWidth: placementModal.showQrPlacement ? (placementModal.qrW / canvasScale) : undefined,
      qrHeight: placementModal.showQrPlacement ? (placementModal.qrH / canvasScale) : undefined,
      showPrefix: action === "phe_duyet" && signAs !== "none" ? true : undefined,
      prefixX: action === "phe_duyet" && signAs !== "none" ? (placementModal.prefixX / canvasScale) : undefined,
      prefixY: action === "phe_duyet" && signAs !== "none"
        ? (pdfPageHeight - (placementModal.prefixY / canvasScale) - (placementModal.prefixH / canvasScale))
        : undefined,
      prefixWidth: action === "phe_duyet" && signAs !== "none" ? (placementModal.prefixW / canvasScale) : undefined,
      prefixHeight: action === "phe_duyet" && signAs !== "none" ? (placementModal.prefixH / canvasScale) : undefined,
      extraPlacements: placementModal.extraSigBoxes.length > 0
        ? placementModal.extraSigBoxes.map((box) => ({
            page: currentPage,
            x: box.sigX / canvasScale,
            y: pdfPageHeight - (box.sigY / canvasScale) - (box.sigH / canvasScale),
            width: box.sigW / canvasScale,
            height: box.sigH / canvasScale,
            showSignature: box.showSignature,
            showSignerName: box.showSignerName,
            nameX: box.nameX / canvasScale,
            nameY: pdfPageHeight - (box.nameY / canvasScale) - (box.nameH / canvasScale),
            nameWidth: box.nameW / canvasScale,
            nameHeight: box.nameH / canvasScale,
          }))
        : undefined,
    }
    const completedPlacements = [...placementModal.completedPlacements, { docId: placementModal.docId, kind: placementModal.fileKind, placement }]
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
    await doTransition(action, token, placement, lyDo, completedPlacements, signAs)
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

  const buildPreviewSignatures = (action?: PinModalAction) => {
    if (!doc || !factoryId || !user) return [] as PreviewSignature[]

    const nameByUserId: Record<string, string> = {}
    if (doc.soan_thao_user_id) nameByUserId[doc.soan_thao_user_id] = doc.soan_thao ?? ""
    if (doc.xem_xet_user_id)   nameByUserId[doc.xem_xet_user_id]   = doc.xem_xet ?? ""
    if (doc.phe_duyet_user_id) nameByUserId[doc.phe_duyet_user_id] = doc.phe_duyet ?? ""

    // Khi soạn thảo gửi xem xét lại (gui_xem_xet), chữ ký cũ của xem xét/phê duyệt sẽ bị xóa bởi
    // generate-pdf. Không hiển thị preview chúng để tránh nhầm lẫn.
    const includePreviousReviewers = action !== "gui_xem_xet"
    const candidates = [
      {
        signerUserId: doc.soan_thao_user_id,
        placement: doc.soan_thao_placement,
        signedAt: doc.ky_soan_thao_at,
      },
      ...(includePreviousReviewers ? [
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
      ] : []),
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
  const childTypeLabelMap: Record<string, string> = {
    ...docTypeLabelMap,
    PL: "Phụ lục",
    F: "Biểu mẫu",
    HD: "Hướng dẫn",
  }
  const docTypeDepartmentMap = activeDocTypes.reduce<Record<string, string[]>>((acc, type) => {
    acc[type.code] = type.allowed_departments?.length ? type.allowed_departments : [...PHONG_BAN_OPTIONS]
    return acc
  }, { ...LOAI_PHONG_BAN_MAP })
  const isChildDocument = (item: Pick<IsoDocument, "phan_loai_tl" | "loai_tai_lieu">) =>
    item.phan_loai_tl === "con" || item.loai_tai_lieu === "F"
  const effectiveParentDocs = effectiveDocs.filter((item) => !isChildDocument(item))
  const parentDocOptions = effectiveParentDocs.filter((item) => {
    const docStandards = effectiveDocStandards[item.id] || []
    const standardOk = form.standard_ids.length === 0 || form.standard_ids.every((standardId) => docStandards.includes(standardId))
    const departmentOk = !form.phong_ban || item.phong_ban === form.phong_ban
    return standardOk && departmentOk
  })

  const addChildDraftRow = () => {
    const nextIndex = childDraftRows.length
    const start = parseInt(childUploadStartNo)
    const soHieu = Number.isFinite(start) ? String(start + nextIndex) : String(nextIndex + 1)
    const defaultRevision = form.chon_quy_trinh === "Soát xét" && form.phan_loai_tl !== "con"
      ? "00"
      : normalizeRevisionText(form.lan_ban_hanh)
    setChildDraftRows((rows) => [
      ...rows,
      {
        id: makeChildDraftId(),
        loai_tai_lieu: childTypeOptions.includes(childUploadType) ? childUploadType : (childTypeOptions[0] || "F"),
        ten_tai_lieu: "",
        so_hieu: soHieu,
        lan_ban_hanh: defaultRevision,
        ghi_chu: "",
        file_url: null,
        file_name: null,
      },
    ])
  }

  const inferChildNumberFromFileName = (fileName: string, loaiTaiLieu: string) => {
    const base = stripFileExtension(fileName).toUpperCase()
    const escapedType = loaiTaiLieu.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").toUpperCase()
    const byType = base.match(new RegExp(`(?:^|[-_\\s])${escapedType}0*(\\d{1,4})(?:\\D|$)`))
    if (byType?.[1]) return String(parseInt(byType[1], 10))
    const anyChildCode = base.match(/(?:^|[-_\s])(?:F|PL|HD)0*(\d{1,4})(?:\D|$)/)
    if (anyChildCode?.[1]) return String(parseInt(anyChildCode[1], 10))
    return null
  }

  const updateChildDraftRow = (rowId: string, patch: Partial<ChildDraftRow>) => {
    setChildDraftRows((rows) => rows.map((row) => row.id === rowId ? { ...row, ...patch } : row))
  }

  const addChildReviewRow = () => {
    setChildReviewRows((rows) => [
      ...rows,
      {
        id: makeChildDraftId(),
        old_doc_id: "",
        ma_tai_lieu_cu: "",
        ten_tai_lieu_cu: "",
        loai_tai_lieu: "F",
        lan_sua_doi: "01",
        doi_ma: false,
        ma_tai_lieu_moi: "",
        ten_tai_lieu_moi: "",
        file_url: null,
        file_name: null,
      },
    ])
  }

  const updateChildReviewRow = (rowId: string, patch: Partial<ChildReviewRow>) => {
    setChildReviewRows((rows) => rows.map((row) => row.id === rowId ? { ...row, ...patch } : row))
  }

  const resolvedMainDocumentCode = () => {
    if (form.chon_quy_trinh === "Soát xét" && form.phan_loai_tl !== "con") {
      return formatDocumentCode(form.doi_ma_tai_lieu ? (form.ma_tai_lieu_moi || form.ma_tai_lieu) : form.ma_tai_lieu)
    }
    return formatDocumentCode(form.ma_tai_lieu)
  }

  const resolvedChildParentCode = () => {
    if (form.phan_loai_tl === "con") return formatDocumentCode(form.ma_tai_lieu_cha)
    return resolvedMainDocumentCode()
  }

  const applyReviewRowDocument = (rowId: string, docId: string) => {
    const selected = effectiveDocs.find((item) => item.id === docId)
    updateChildReviewRow(rowId, {
      old_doc_id: docId,
      ma_tai_lieu_cu: selected?.ma_tai_lieu || "",
      ten_tai_lieu_cu: selected?.ten_tai_lieu || "",
      loai_tai_lieu: selected?.loai_tai_lieu || "F",
      lan_sua_doi: incrementRevisionText(selected?.lan_ban_hanh),
      ten_tai_lieu_moi: selected?.ten_tai_lieu || "",
    })
  }

  const handleReviewRowFileUpload = async (file: File, rowId: string) => {
    if (!factoryId) return
    const allowed = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
    if (!allowed.some((t) => file.type.includes(t.split("/")[1])) && !file.name.match(/\.(pdf|docx|xlsx)$/i)) {
      setSaveError(`File ${file.name} không hợp lệ. Chỉ hỗ trợ PDF, DOCX, XLSX`)
      return
    }
    setFileUploading(true)
    setSaveError(null)
    try {
      const safeName = sanitizeStorageFileName(file.name)
      const filePath = `${factoryId}/iso/child-records/${Date.now()}_${safeName}`
      const { error } = await supabase.storage.from("iso-documents").upload(filePath, file, { upsert: true })
      if (error) { setSaveError(error.message); return }
      const { data: urlData } = supabase.storage.from("iso-documents").getPublicUrl(filePath)
      const inferred = parseDocNameFromFileName(file.name)
      setChildReviewRows((rows) => rows.map((row) => {
        if (row.id !== rowId) return row
        const tenMoi = (!row.ten_tai_lieu_moi && inferred.ten_tai_lieu)
          ? inferred.ten_tai_lieu
          : row.ten_tai_lieu_moi
        return { ...row, file_url: urlData.publicUrl, file_name: file.name, ten_tai_lieu_moi: tenMoi }
      }))
      if (hasVietnameseOrNonAsciiName(file.name)) showToast(false, `Đã chuẩn hoá tên file: ${safeName}`)
    } finally {
      setFileUploading(false)
    }
  }

  const childRecordCode = (row: ChildDraftRow) => {
    return buildMaTaiLieuCon(resolvedChildParentCode(), row.loai_tai_lieu, row.so_hieu)
  }

  const isDuplicateChildDraftCode = (row: ChildDraftRow) => {
    const code = childRecordCode(row).trim().toUpperCase()
    if (!code) return false
    return childDraftRows.filter((item) => childRecordCode(item).trim().toUpperCase() === code).length > 1
  }

  const getFileNameFromUrl = (url: string | null | undefined) => {
    if (!url) return "File hồ sơ"
    const clean = url.split("?")[0]
    const name = clean.split("/").pop() || "File hồ sơ"
    try { return decodeURIComponent(name) } catch { return name }
  }

  const childFileUrl = (child: IsoDocument) =>
    child.file_signed_pdf_url || child.file_signed_office_url || child.file_goc_url

  const mainFileUrl = doc?.file_signed_pdf_url || doc?.file_signed_office_url || uploadedFileUrl
  const mainFileName = doc?.file_signed_office_url
    ? `DOCX/XLSX \u0111\u00e3 c\u1eadp nh\u1eadt tag`
    : (uploadedFileName || "File t\u00e0i li\u1ec7u")

  const renderSavedChildDocs = () => {
    if (childDocs.length === 0) return null
    return (
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        <div>
          <p className="text-xs font-extrabold text-slate-700">Hồ sơ đã lưu</p>
          <p className="text-[11px] text-slate-500">Có thể xem hoặc tải từng file, sau đó thêm hồ sơ mới và bấm Lưu tiếp.</p>
        </div>
        <div className="max-h-56 space-y-2 overflow-auto">
          {childDocs.map((child) => {
            const url = childFileUrl(child)
            return (
              <div key={child.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 space-y-1">
                <div className="flex items-center gap-2">
                  <FileText size={14} className="shrink-0 text-sky-600" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[11px] font-bold text-slate-800">{child.ma_tai_lieu}</p>
                    <p className="truncate text-[11px] text-slate-600">{child.ten_tai_lieu || getFileNameFromUrl(url)}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700">
                    {childTypeLabelMap[child.loai_tai_lieu || ""] || child.loai_tai_lieu || "Hồ sơ"}
                  </span>
                  {url && (
                    <>
                      <a href={url} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg p-1 text-sky-700 hover:bg-sky-100" title="Xem hồ sơ">
                        <Eye size={14} />
                      </a>
                      <a href={url} download className="shrink-0 rounded-lg p-1 text-slate-700 hover:bg-slate-200" title="Tải hồ sơ">
                        <Download size={14} />
                      </a>
                    </>
                  )}
                  {isEditable && (
                    <button
                      type="button"
                      onClick={() => openChildFilePicker(child.id)}
                      disabled={fileUploading}
                      className="shrink-0 rounded-lg border border-dashed border-sky-300 px-2 py-1 text-[10px] font-bold text-sky-700 hover:border-sky-500 hover:bg-sky-50 disabled:opacity-50"
                      title="Thay thế file hồ sơ"
                    >
                      Thay file
                    </button>
                  )}
                </div>
                {isOfficeUrl(child.file_goc_url) && (
                  <label className={`flex items-center gap-1.5 pl-5 ${canToggleAutoConvert ? "cursor-pointer" : "cursor-default opacity-70"}`}>
                    <input
                      type="checkbox"
                      checked={!!child.auto_convert_pdf}
                      disabled={!canToggleAutoConvert}
                      className="rounded border-slate-300 text-violet-600 focus:ring-violet-500 disabled:cursor-default"
                      onChange={async (e) => {
                        if (!canToggleAutoConvert) return
                        const val = e.target.checked
                        setChildDocs((rows) => rows.map((c) => c.id === child.id ? { ...c, auto_convert_pdf: val } : c))
                        await supabase.from("iso_documents").update({ auto_convert_pdf: val }).eq("id", child.id).eq("factory_id", factoryId)
                      }}
                    />
                    <span className="text-[10px] text-slate-600">Tự động chuyển sang PDF sau phê duyệt</span>
                    {!canToggleAutoConvert && child.auto_convert_pdf && (
                      <span className="text-[10px] font-bold text-violet-600">Đã bật</span>
                    )}
                  </label>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const applyParentDocumentForChild = (parentId: string) => {
    setSelectedParentDocId(parentId)
    const parent = effectiveParentDocs.find((item) => item.id === parentId)
    if (!parent) return
    const parentParsed = parseParentCode(parent.ma_tai_lieu || "")
    setForm((f) => rebuildDraftCode({
      ...f,
      standard_ids: effectiveDocStandards[parent.id] || f.standard_ids,
      phong_ban: parent.phong_ban || f.phong_ban,
      loai_tai_lieu_cha: parentParsed?.loai || f.loai_tai_lieu_cha,
      so_hieu_cha: parentParsed?.so || f.so_hieu_cha,
      ma_tai_lieu_cha: parent.ma_tai_lieu || f.ma_tai_lieu_cha,
      cap_tl: parent.cap_tl || f.cap_tl,
      lan_ban_hanh: normalizeRevisionText(parent.lan_ban_hanh, f.lan_ban_hanh),
    }))
  }

  const rebuildDraftCode = (next: IsoDocumentForm) => {
    if (next.chon_quy_trinh === "Soát xét") return next
    if (next.phan_loai_tl === "con") {
      const maCha = buildMaTaiLieu(next.phong_ban, next.loai_tai_lieu_cha, next.so_hieu_cha)
      next.ma_tai_lieu_cha = maCha
      next.ma_tai_lieu = next.so_hieu
        ? buildMaTaiLieuCon(maCha, next.loai_tai_lieu, next.so_hieu)
        : (maCha && next.loai_tai_lieu ? `${maCha}-${next.loai_tai_lieu}` : "")
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
  // Khi soát xét hồ sơ con: lọc thêm theo tài liệu cha đã chọn
  const reviewCodeOptions = reviewDocsByDepartment.filter((item) => {
    if (!form.loai_tai_lieu || item.loai_tai_lieu === form.loai_tai_lieu) {
      if (form.phan_loai_tl === "con" && reviewParentDocId) {
        return item.parent_doc_id === reviewParentDocId
      }
      return true
    }
    return false
  })
  // Danh sách tài liệu cha để chọn khi soát xét hồ sơ con
  const reviewParentOptions = effectiveDocs.filter(
    (item) => !isChildDocument(item) && (!form.phong_ban || item.phong_ban === form.phong_ban)
  )
  const parentReviewSourceDoc = form.phan_loai_tl !== "con" && form.chon_quy_trinh === "Soát xét"
    ? effectiveDocs.find((item) => {
        if (isChildDocument(item)) return false
        if (reviewDocId) return item.id === reviewDocId
        return !!form.ma_tai_lieu_cu && normalizeDocumentCode(item.ma_tai_lieu) === normalizeDocumentCode(form.ma_tai_lieu_cu)
      }) || null
    : null
  const parentReviewSourceDocId = parentReviewSourceDoc?.id || ""
  const parentReviewChildOptions = parentReviewSourceDocId
    ? effectiveDocs.filter((item) => isChildDocument(item) && item.parent_doc_id === parentReviewSourceDocId)
    : []
  const canAddParentReviewChild = !!parentReviewSourceDocId
  const canAddParentReviewNewChild = !!resolvedChildParentCode()

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
      lan_ban_hanh: incrementRevisionText(selected.lan_ban_hanh),
      doi_ma_tai_lieu: false,
      ma_tai_lieu_moi: "",
    }))
    setChildReviewRows([])
    setChildDraftRows([])
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
    const typeLabel = isCon ? "Loại hồ sơ" : "Loại tài liệu"

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Quy trình <span className="text-red-500">*</span></label>
          <select
            value={form.chon_quy_trinh}
            onChange={(e) => {
              const chonQuyTrinh = e.target.value
              setReviewDocId("")
              setReviewParentDocId("")
              patchDraftForm({
                chon_quy_trinh: chonQuyTrinh,
                // Reset filter fields khi chuyển chế độ để cascade lọc đúng
                ...(chonQuyTrinh === "Soát xét" ? { phong_ban: "", loai_tai_lieu: "" } : {}),
                ma_tai_lieu_cu: "",
                ten_tai_lieu_cu: "",
                doi_ma_tai_lieu: false,
                ma_tai_lieu_moi: "",
                ly_do_soat_xet: "",
                noi_dung_soat_xet: "",
                // "Không có mã" chỉ áp dụng cho Soạn thảo mới — Soát xét luôn thao tác trên
                // mã đã có sẵn, không có ý nghĩa "bỏ qua mã".
                ...(chonQuyTrinh === "Soát xét" ? { khong_co_ma: false } : {}),
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
                setReviewParentDocId("")
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
                setReviewParentDocId("")
                // "Không có mã" chỉ áp dụng cho tài liệu Cha — hồ sơ Con luôn có mã phụ
                // thuộc mã cha, không có khái niệm hồ sơ con đứng độc lập không mã.
                patchDraftForm({ phan_loai_tl: "con", loai_tai_lieu: newLoai, ma_tai_lieu: "", ma_tai_lieu_cu: "", ten_tai_lieu_cu: "", khong_co_ma: false })
              }}
              className={`flex-1 py-2 text-sm font-bold transition-all ${isCon ? "bg-violet-600 text-white" : "text-slate-600 hover:bg-slate-50"} ${!isEditable ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              Hồ sơ (Con)
            </button>
          </div>
        </div>

        {renderStandardsSelect()}

        {!isReviewForm && !isCon && (
          <div className="sm:col-span-2">
            <label className="text-xs font-bold text-slate-600 block mb-1.5">
              {codeLabel}: Tự sinh {!form.khong_co_ma && <span className="text-red-500">*</span>}
            </label>
            <input
              type="text"
              value={form.khong_co_ma ? "" : form.ma_tai_lieu}
              readOnly
              placeholder={form.khong_co_ma ? "Không áp dụng mã cho tài liệu này" : "Tự sinh sau khi chọn đủ thông tin"}
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
                if (!isCon) {
                  setChildReviewRows([])
                  setChildDraftRows([])
                }
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
          {isReviewForm && !form.phong_ban && (
            <p className="mt-1 text-[11px] text-amber-600">Chọn phòng ban để lọc danh sách tài liệu.</p>
          )}
        </div>

        {!isCon && (
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại tài liệu <span className="text-red-500">*</span></label>
            <select
              value={form.loai_tai_lieu}
              onChange={(e) => {
                setReviewDocId("")
                if (isReviewForm) {
                  setChildReviewRows([])
                  setChildDraftRows([])
                  setForm((f) => ({ ...f, loai_tai_lieu: e.target.value, ma_tai_lieu: "", ma_tai_lieu_cu: "", ten_tai_lieu_cu: "", ten_tai_lieu: "" }))
                } else {
                  patchDraftForm({ loai_tai_lieu: e.target.value })
                }
              }}
              disabled={!isEditable || (isReviewForm && !form.phong_ban)}
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
            <label className="flex items-center gap-2 mb-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.khong_co_ma}
                disabled={!isEditable}
                onChange={(e) => {
                  const checked = e.target.checked
                  patchDraftForm(checked ? { khong_co_ma: true, so_hieu: "" } : { khong_co_ma: false })
                }}
                className="rounded"
              />
              <span className="text-xs font-bold text-slate-600">Tài liệu này không có mã</span>
            </label>
            {!form.khong_co_ma && (
              <>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Số hiệu <span className="text-red-500">*</span></label>
                <input type="number" min="1" value={form.so_hieu} onChange={(e) => patchDraftForm({ so_hieu: e.target.value })} disabled={!isEditable} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50" />
              </>
            )}
          </div>
        )}

        {!isReviewForm && isCon && (
          <>
            <div className="sm:col-span-2">
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã tài liệu cha có hiệu lực <span className="text-red-500">*</span></label>
              <select value={selectedParentDocId} onChange={(e) => applyParentDocumentForChild(e.target.value)} disabled={!isEditable} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50">
                <option value="">-- Chọn tài liệu cha --</option>
                {parentDocOptions.map((parent) => (
                  <option key={parent.id} value={parent.id}>{parent.ma_tai_lieu} - {parent.ten_tai_lieu}</option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-400">Danh sách lọc theo tiêu chuẩn và phòng ban đã chọn, chỉ gồm tài liệu cha có hiệu lực.</p>
            </div>
            <div className="hidden">
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại tài liệu <span className="text-red-500">*</span></label>
              <select value={form.loai_tai_lieu_cha} onChange={(e) => patchDraftForm({ loai_tai_lieu_cha: e.target.value })} disabled={!isEditable} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50">
                {parentTypeOptions.map((l) => <option key={l} value={l}>{l} — {docTypeLabelMap[l]}</option>)}
              </select>
            </div>
            <div className="hidden">
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Số hiệu tài liệu <span className="text-red-500">*</span></label>
              <input type="number" min="1" value={form.so_hieu_cha} onChange={(e) => patchDraftForm({ so_hieu_cha: e.target.value })} disabled={!isEditable} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50" />
            </div>
            <div className="hidden">
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại hồ sơ <span className="text-red-500">*</span></label>
              <select value={form.loai_tai_lieu} onChange={(e) => patchDraftForm({ loai_tai_lieu: e.target.value })} disabled={!isEditable} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50">
                {childTypeOptions.map((l) => <option key={l} value={l}>{l} - {childTypeLabelMap[l]}</option>)}
              </select>
            </div>
            <div className="hidden">
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Số hiệu hồ sơ <span className="text-red-500">*</span></label>
              <input type="number" min="1" value={form.so_hieu} onChange={(e) => patchDraftForm({ so_hieu: e.target.value })} disabled={!isEditable} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50" />
            </div>
          </>
        )}

        {isReviewForm && (
          <>
            {/* Soát xét hồ sơ con: chọn tài liệu cha trước để lọc danh sách hồ sơ */}
            {isCon && (
              <div className="sm:col-span-2">
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Tài liệu cha (bộ quy trình) <span className="text-red-500">*</span></label>
                <select
                  value={reviewParentDocId}
                  onChange={(e) => {
                    setReviewParentDocId(e.target.value)
                    setReviewDocId("")
                    setForm((f) => ({ ...f, ma_tai_lieu_cu: "", ten_tai_lieu_cu: "" }))
                  }}
                  disabled={!isEditable}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50"
                >
                  <option value="">— Chọn tài liệu cha có hiệu lực —</option>
                  {reviewParentOptions.map((p) => (
                    <option key={p.id} value={p.id}>{p.ma_tai_lieu} — {p.ten_tai_lieu}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-400">Chọn tài liệu cha để lọc danh sách hồ sơ bên dưới.</p>
              </div>
            )}
            {/* TH3 only: single mã tài liệu dropdown + tên cũ + lần sửa đổi + đổi mã */}
            {!isCon && (
              <>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">{codeLabel} <span className="text-red-500">*</span></label>
                  <select
                    value={reviewDocId || parentReviewSourceDocId}
                    onChange={(e) => applyReviewDocument(e.target.value)}
                    disabled={!isEditable || !form.phong_ban}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50"
                  >
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
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Lần sửa đổi <span className="text-red-500">*</span></label>
                  <input type="text" value={form.lan_ban_hanh} onChange={(e) => setForm((f) => ({ ...f, lan_ban_hanh: e.target.value }))} disabled={!isEditable} placeholder="VD: 01 hoặc 01/01" className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50 font-mono" />
                </div>
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
              </>
            )}
            {/* Lý do + Nội dung soát xét: dùng chung TH3 và TH4 */}
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

        {/* Lần ban hành — chỉ cho TH1 (cha soạn thảo); TH2/TH4 dùng per-row; TH3 đã có trong !isCon block */}
        {!isReviewForm && !isCon && (
          <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Lần ban hành <span className="text-red-500">*</span></label>
          <input type="text" value={form.lan_ban_hanh} onChange={(e) => setForm((f) => ({ ...f, lan_ban_hanh: e.target.value }))} disabled={!isEditable} placeholder="VD: 00 hoặc 01/01" className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50 font-mono" />
          </div>
        )}

        {!isReviewForm && !isCon && (
          <div className="sm:col-span-2">
            <label className="text-xs font-bold text-slate-600 block mb-1.5">{titleLabel} <span className="text-red-500">*</span></label>
            <input type="text" value={form.ten_tai_lieu} onChange={(e) => setForm((f) => ({ ...f, ten_tai_lieu: e.target.value }))} disabled={!isEditable} placeholder={`Nhập ${titleLabel.toLowerCase()}...`} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50" />
          </div>
        )}

        <div className="sm:col-span-2">
          <label className="text-xs font-bold text-slate-600 block mb-1.5">{levelLabel} <span className="text-red-500">*</span></label>
          <select value={form.cap_tl} onChange={(e) => setForm((f) => ({ ...f, cap_tl: e.target.value }))} disabled={!isEditable} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50">
            <option value="Cấp 1">Cấp 1 (3 bước: Soạn thảo → Xem xét → Phê duyệt)</option>
            <option value="Cấp 2">Cấp 2 (2 bước: Gửi phê duyệt → Phê duyệt)</option>
          </select>
        </div>


        {!isCon && (
          <div className="sm:col-span-2">
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Ghi chú</label>
          <textarea value={form.ghi_chu} onChange={(e) => setForm((f) => ({ ...f, ghi_chu: e.target.value }))} disabled={!isEditable} rows={2} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50 resize-none" />
          </div>
        )}

        {!isCon && (
          <div className="sm:col-span-2">
            <label className="text-xs font-bold text-slate-600 block mb-1.5">
              Mô tả tìm kiếm AI
              <span className="ml-1.5 font-normal text-slate-400">(tăng độ chính xác khi tìm kiếm biểu mẫu)</span>
            </label>
            <textarea
              value={form.mo_ta_tim_kiem}
              onChange={(e) => setForm((f) => ({ ...f, mo_ta_tim_kiem: e.target.value }))}
              disabled={!isEditable}
              rows={2}
              maxLength={500}
              placeholder="Mô tả ngắn về nội dung, mục đích, phạm vi áp dụng của tài liệu này..."
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50 resize-none"
            />
          </div>
        )}
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

  const pinModalFooter = (
    <>
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
    </>
  )

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
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 bg-red-600 text-white rounded-2xl shadow-2xl max-w-xl">
            <AlertTriangle size={16} className="shrink-0" />
            <span className="text-sm font-bold">{saveError}</span>
            <button onClick={() => setSaveError(null)} className="ml-2 hover:opacity-70"><X size={14} /></button>
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/dashboard/iso/documents" className="p-2 hover:bg-slate-100 rounded-xl transition-all shrink-0">
              <ArrowLeft size={18} className="text-slate-600" />
            </Link>
            <div className="min-w-0">
              <h1 className="text-xl font-extrabold text-slate-800 break-words">
                {isNew ? "Tạo tài liệu ISO mới" : (doc?.ten_tai_lieu || "Chi tiết tài liệu")}
              </h1>
              {!isNew && doc && (
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="font-mono text-xs text-violet-700 break-all">{doc.ma_tai_lieu || "(chưa có mã)"}</span>
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
            {!isNew && trangThai === "draft" && isSoanThao && (
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

            {/* Gửi xem xét lại sau khi bị trả về */}
            {!isNew && trangThai === "tra_ve" && userId === doc?.soan_thao_user_id && (
              <button
                onClick={() => {
                  const label = form.cap_tl === "Cấp 2" ? "Xác nhận gửi phê duyệt lại" : "Xác nhận gửi xem xét lại"
                  setPinModal({ action: "gui_xem_xet", label })
                  setPin("")
                  setPinError("")
                }}
                disabled={form.cap_tl === "Cấp 2" ? !form.phe_duyet_user_id : (!form.xem_xet_user_id || !form.phe_duyet_user_id)}
                style={{ background: "#d97706" }}
                className="flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-xl disabled:opacity-50 transition-all hover:opacity-90"
              >
                <Send size={14} />
                {form.cap_tl === "Cấp 2" ? "Gửi phê duyệt lại" : "Gửi xem xét lại"}
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

            {/* Nút phân phối — chỉ khi tài liệu đã có hiệu lực */}
            {!isNew && canDistribute && doc?.trang_thai === "co_hieu_luc" && (
              <button
                onClick={() => setShowDistributeModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl transition-all"
              >
                <Share2 size={14} /> Phân phối
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

        {!isNew && doc && childDocs.length > 0 && (
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full !bg-sky-600 px-2.5 py-1 text-xs font-extrabold !text-white">{form.phan_loai_tl === "con" ? "Lô hồ sơ" : "Bộ tài liệu"}</span>
              <span className="font-bold">{form.phan_loai_tl === "con" ? (form.ma_tai_lieu_cha || "Quy trình cha") : (doc.ma_tai_lieu || "Tài liệu cha")}</span>
              <span>{form.phan_loai_tl === "con" ? `có ${childDocs.length + 1} hồ sơ cùng cấp đang xử lý.` : `đang được xử lý cùng ${childDocs.length} hồ sơ kèm theo.`}</span>
            </div>
            <p className="mt-1 text-xs text-sky-700">
              {form.phan_loai_tl === "con" ? "Khi ký, hệ thống xử lý lần lượt các hồ sơ trong lô cùng người soạn/xem xét/phê duyệt." : "Người xem xét/phê duyệt xử lý một bộ duy nhất; khi ký, hệ thống sẽ mở lần lượt file chính và từng hồ sơ con cần ký."}
            </p>
          </div>
        )}

        <div className={`grid grid-cols-1 gap-4 lg:grid-cols-3`}>
          {/* Form chính */}
          <div className={`lg:col-span-2 space-y-4`}>
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
                          setForm((f) => ({
                            ...f,
                            soan_thao_user_id: uid,
                            soan_thao: profileName(uid),
                            xem_xet_user_id: f.xem_xet_user_id === uid ? "" : f.xem_xet_user_id,
                            xem_xet: f.xem_xet_user_id === uid ? "" : f.xem_xet,
                            phe_duyet_user_id: f.phe_duyet_user_id === uid ? "" : f.phe_duyet_user_id,
                            phe_duyet: f.phe_duyet_user_id === uid ? "" : f.phe_duyet,
                          }))
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
                  <label className="text-xs font-bold text-slate-600 block mb-1.5 flex items-center gap-1.5">
                    Người phê duyệt
                    {signAsPrefixLabel(doc?.phe_duyet_sign_as) && (
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                        {signAsPrefixLabel(doc?.phe_duyet_sign_as)}
                      </span>
                    )}
                  </label>
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
            ref={childFilesInputRef}
            type="file"
            accept=".pdf,.docx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              const rowId = activeChildUploadRowIdRef.current || activeChildUploadRowId
              if (f && rowId) void handleChildRowFileUpload(f, rowId)
              activeChildUploadRowIdRef.current = null
              setActiveChildUploadRowId(null)
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

          <div className="space-y-4">
            {/* TH4: Soát xét nhiều hồ sơ con — right panel */}
            {isNew && form.phan_loai_tl === "con" && form.chon_quy_trinh === "Soát xét" && (
              <div className="space-y-3">
                {/* Section 1: Hồ sơ cần soát xét */}
                <div className="bg-white rounded-xl border border-emerald-200 shadow-sm p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-extrabold text-emerald-800">Hồ sơ cần soát xét</p>
                      <p className="text-[11px] text-slate-500">Mỗi dòng là một hồ sơ. Chọn hồ sơ cũ và upload file phiên bản mới.</p>
                      {!reviewParentDocId && (
                        <p className="mt-1 text-[11px] font-medium text-amber-600">Chọn tài liệu cha (bộ quy trình) trước.</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={addChildReviewRow}
                      disabled={!reviewParentDocId}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-bold shadow-sm transition-all ${reviewParentDocId ? "border-emerald-500 !bg-emerald-600 !text-white hover:!bg-emerald-700" : "cursor-not-allowed border-slate-300 !bg-slate-200 !text-slate-400 opacity-60"}`}
                    >
                      Thêm hồ sơ
                    </button>
                  </div>
                  <div className="space-y-2">
                    {childReviewRows.map((row) => {
                      const rowChildOptions = effectiveDocs.filter(
                        (item) => (item.phan_loai_tl === "con" || item.loai_tai_lieu === "F") &&
                          item.parent_doc_id === reviewParentDocId
                      )
                      return (
                        <div key={row.id} className="rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-100">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <label className="col-span-2 text-[11px] font-bold text-slate-600">
                              Mã hồ sơ cũ <span className="text-red-500">*</span>
                              <select
                                value={row.old_doc_id}
                                onChange={(e) => applyReviewRowDocument(row.id, e.target.value)}
                                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                              >
                                <option value="">— Chọn hồ sơ đang có hiệu lực —</option>
                                {rowChildOptions.map((item) => (
                                  <option key={item.id} value={item.id}>{item.ma_tai_lieu} — {item.ten_tai_lieu}</option>
                                ))}
                              </select>
                              {rowChildOptions.length === 0 && reviewParentDocId && (
                                <span className="mt-1 block text-[10px] text-amber-600">Tài liệu cha chưa có hồ sơ con có hiệu lực.</span>
                              )}
                            </label>
                            <label className="text-[11px] font-bold text-slate-600">
                              Lần sửa đổi <span className="text-red-500">*</span>
                              <input type="text" value={row.lan_sua_doi} onChange={(e) => updateChildReviewRow(row.id, { lan_sua_doi: e.target.value })} placeholder="VD: 01 hoặc 01/01" className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-mono" />
                            </label>
                            <label className="text-[11px] font-bold text-slate-600">
                              Đổi mã?
                              <select value={row.doi_ma ? "co" : "khong"} onChange={(e) => updateChildReviewRow(row.id, { doi_ma: e.target.value === "co", ma_tai_lieu_moi: "" })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs">
                                <option value="khong">Không</option>
                                <option value="co">Có</option>
                              </select>
                            </label>
                            {row.doi_ma && (
                              <label className="col-span-2 text-[11px] font-bold text-slate-600">
                                Mã hồ sơ mới <span className="text-red-500">*</span>
                                <input type="text" value={row.ma_tai_lieu_moi} onChange={(e) => updateChildReviewRow(row.id, { ma_tai_lieu_moi: e.target.value.toUpperCase() })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-mono" />
                              </label>
                            )}
                            <label className="col-span-2 text-[11px] font-bold text-slate-600">
                              Tên hồ sơ mới <span className="text-red-500">*</span>
                              <input type="text" value={row.ten_tai_lieu_moi} onChange={(e) => updateChildReviewRow(row.id, { ten_tai_lieu_moi: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                            </label>
                            <div className="col-span-2 text-[11px] font-bold text-slate-600">
                              File hồ sơ mới <span className="text-red-500">*</span>
                              <label className="mt-1 flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-dashed border-emerald-300 px-2 py-1.5 text-left text-xs text-emerald-700 hover:border-emerald-500">
                                <span className="truncate">{row.file_name ? stripFileExtension(row.file_name) : "Chọn file"}</span>
                                <Upload size={13} />
                                <input
                                  type="file"
                                  accept=".pdf,.docx,.xlsx"
                                  className="hidden"
                                  onChange={(e) => {
                                    const f = e.target.files?.[0]
                                    if (f) void handleReviewRowFileUpload(f, row.id)
                                    e.target.value = ""
                                  }}
                                />
                              </label>
                            </div>
                          </div>
                          <button type="button" onClick={() => setChildReviewRows((rows) => rows.filter((item) => item.id !== row.id))} className="mt-2 text-[11px] font-bold text-red-600 hover:text-red-700">
                            Xóa dòng
                          </button>
                        </div>
                      )
                    })}
                    {childReviewRows.length === 0 && (
                      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700">Chưa có hồ sơ nào. Bấm &quot;Thêm hồ sơ&quot; để bắt đầu.</p>
                    )}
                  </div>
                </div>
                {/* Section 2: Tài liệu soát xét */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                  <h2 className="text-sm font-extrabold text-slate-700 mb-3">Tài liệu soát xét</h2>
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs font-bold text-slate-600 mb-2">Phiếu yêu cầu thay đổi</p>
                      {reviewChangeFileUrl && (
                        <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-xl">
                          <FileText size={16} className="text-amber-600 shrink-0" />
                          <span className="text-xs text-slate-700 flex-1 truncate">{reviewChangeFileName}</span>
                          <a href={doc?.file_phieu_yeu_cau_thay_doi_signed_url || reviewChangeFileUrl} target="_blank" rel="noreferrer" className="shrink-0 p-1 hover:bg-amber-100 rounded-lg"><Eye size={13} className="text-amber-600" /></a>
                        </div>
                      )}
                      <button type="button" onClick={() => reviewChangeFileInputRef.current?.click()} disabled={fileUploading} className="mt-2 w-full px-3 py-2 border border-dashed border-slate-300 hover:border-amber-400 text-slate-500 hover:text-amber-700 text-xs font-medium rounded-xl transition-all">
                        {reviewChangeFileUrl ? "Thay file" : "Upload phiếu yêu cầu thay đổi"}
                      </button>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-600 mb-2">Đề nghị soát xét</p>
                      {reviewRequestFileUrl && (
                        <div className="flex items-center gap-2 p-3 bg-sky-50 rounded-xl">
                          <FileText size={16} className="text-sky-600 shrink-0" />
                          <span className="text-xs text-slate-700 flex-1 truncate">{reviewRequestFileName}</span>
                          <a href={doc?.file_de_nghi_soat_xet_signed_url || reviewRequestFileUrl} target="_blank" rel="noreferrer" className="shrink-0 p-1 hover:bg-sky-100 rounded-lg"><Eye size={13} className="text-sky-600" /></a>
                        </div>
                      )}
                      <button type="button" onClick={() => reviewRequestFileInputRef.current?.click()} disabled={fileUploading} className="mt-2 w-full px-3 py-2 border border-dashed border-slate-300 hover:border-sky-400 text-slate-500 hover:text-sky-700 text-xs font-medium rounded-xl transition-all">
                        {reviewRequestFileUrl ? "Thay file" : "Upload đề nghị soát xét"}
                      </button>
                    </div>
                  </div>
                </div>
                {/* Section 3: Hướng dẫn */}
                {renderOfficeTagGuide()}
              </div>
            )}

            {/* Hồ sơ cần soạn thảo — chỉ dành cho hồ sơ riêng lẻ mới (right panel) */}
            {isNew && form.phan_loai_tl === "con" && form.chon_quy_trinh !== "Soát xét" && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-extrabold text-slate-700">Hồ sơ cần soạn thảo</p>
                    <p className="text-[11px] text-slate-500">Mỗi dòng là một hồ sơ riêng. Upload file riêng cho mỗi dòng.</p>
                    {!canAddChildRow && (
                      <p className="mt-1 text-[11px] font-medium text-amber-600">Chọn tài liệu cha và nhập số hiệu trước khi thêm hồ sơ.</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={addChildDraftRow}
                    disabled={!canAddChildRow}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold shadow-sm transition-all ${canAddChildRow ? "border-sky-500 !bg-sky-600 !text-white hover:!bg-sky-700" : "cursor-not-allowed border-slate-300 !bg-slate-200 !text-slate-400 opacity-60"}`}
                  >
                    Thêm hồ sơ
                  </button>
                </div>
                <div className="space-y-2">
                  {childDraftRows.map((row) => (
                    <div key={row.id} className="rounded-xl bg-white/85 p-2 ring-1 ring-sky-100">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <label className="text-[11px] font-bold text-slate-600">
                          Mã hồ sơ
                          <input value={childRecordCode(row)} readOnly className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-700" />
                          {isDuplicateChildDraftCode(row) && (
                            <span className="mt-1 block text-[10px] font-bold text-red-600">Mã này đang trùng trong danh sách</span>
                          )}
                        </label>
                        <label className="text-[11px] font-bold text-slate-600">
                          Loại hồ sơ
                          <select value={row.loai_tai_lieu} onChange={(e) => updateChildDraftRow(row.id, { loai_tai_lieu: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs">
                            {childTypeOptions.map((type) => <option key={type} value={type}>{type} - {childTypeLabelMap[type]}</option>)}
                          </select>
                        </label>
                        <label className="text-[11px] font-bold text-slate-600">
                          Tên hồ sơ
                          <input value={row.ten_tai_lieu} onChange={(e) => updateChildDraftRow(row.id, { ten_tai_lieu: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                        </label>
                        <label className="text-[11px] font-bold text-slate-600">
                          Số hiệu
                          <input type="number" min="1" value={row.so_hieu} onChange={(e) => updateChildDraftRow(row.id, { so_hieu: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                        </label>
                        <label className="text-[11px] font-bold text-slate-600">
                          Lần ban hành
                          <input type="text" value={row.lan_ban_hanh} onChange={(e) => updateChildDraftRow(row.id, { lan_ban_hanh: e.target.value })} placeholder="VD: 00 hoặc 01/01" className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-mono" />
                        </label>
                        <div className="text-[11px] font-bold text-slate-600">
                          File hồ sơ
                          <label className="mt-1 flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-dashed border-sky-300 px-2 py-1.5 text-left text-xs text-sky-700 hover:border-sky-500">
                            <span className="truncate">{row.file_name ? stripFileExtension(row.file_name) : "Chọn file"}</span>
                            <Upload size={13} />
                            <input
                              type="file"
                              accept=".pdf,.docx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0]
                                if (f) void handleChildRowFileUpload(f, row.id)
                                e.target.value = ""
                              }}
                            />
                          </label>
                        </div>
                        <label className="col-span-2 text-[11px] font-bold text-slate-600">
                          Ghi chú
                          <input value={row.ghi_chu} onChange={(e) => updateChildDraftRow(row.id, { ghi_chu: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                        </label>
                      </div>
                      <button type="button" onClick={() => setChildDraftRows((rows) => rows.filter((item) => item.id !== row.id))} className="mt-2 text-[11px] font-bold text-red-600 hover:text-red-700">
                        Xóa dòng
                      </button>
                    </div>
                  ))}
                  {childDraftRows.length === 0 && (
                    <p className="rounded-lg bg-sky-50 px-3 py-2 text-[11px] text-sky-700">Chưa có hồ sơ nào. Bấm &quot;Thêm hồ sơ&quot; để bắt đầu.</p>
                  )}
                </div>
              </div>
            )}
            {/* Hướng dẫn tag cho TH2 (soạn thảo hồ sơ con mới) */}
            {isNew && form.phan_loai_tl === "con" && form.chon_quy_trinh !== "Soát xét" && renderOfficeTagGuide()}

            {/* Các hồ sơ trong bộ — hiển thị trên trang hồ sơ con đã lưu */}
            {!isNew && isCon && form.chon_quy_trinh !== "Soát xét" && siblingDocs.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                <p className="text-sm font-extrabold text-sky-800 mb-2">Các hồ sơ trong bộ này</p>
                <div className="space-y-2">
                  {siblingDocs.map((sib) => {
                    const sibUrl = sib.file_signed_pdf_url || sib.file_signed_office_url || sib.file_goc_url
                    const isSelf = sib.id === docId
                    const statusColor = (TRANG_THAI_COLOR as Record<string, string>)[sib.trang_thai] || "bg-slate-100 text-slate-600"
                    return (
                      <div key={sib.id} className={`rounded-lg border px-3 py-2 space-y-1.5 ${isSelf ? "border-sky-300 bg-sky-50" : "border-slate-100 bg-slate-50"}`}>
                        <div className="flex items-center gap-2">
                          <FileText size={14} className="shrink-0 text-sky-600" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-mono text-[11px] font-bold text-slate-800">{sib.ma_tai_lieu}</p>
                            <p className="truncate text-[11px] text-slate-500">{sib.ten_tai_lieu}</p>
                          </div>
                          <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700">
                            {childTypeLabelMap[sib.loai_tai_lieu || ""] || sib.loai_tai_lieu || "Hồ sơ"}
                          </span>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${statusColor}`}>
                            {(TRANG_THAI_LABEL as Record<string, string>)[sib.trang_thai] || sib.trang_thai}
                          </span>
                          {sibUrl && (
                            <>
                              <a href={sibUrl} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg p-1 text-sky-700 hover:bg-sky-100" title="Xem file">
                                <Eye size={13} />
                              </a>
                              <a href={sibUrl} download className="shrink-0 rounded-lg p-1 text-slate-700 hover:bg-slate-200" title="Tải file">
                                <Download size={13} />
                              </a>
                            </>
                          )}
                          {isEditable && (
                            <button
                              type="button"
                              onClick={() => isSelf ? fileInputRef.current?.click() : openChildFilePicker(sib.id)}
                              disabled={fileUploading}
                              className="shrink-0 rounded-lg border border-dashed border-sky-300 px-2 py-1 text-[10px] font-bold text-sky-700 hover:border-sky-500 hover:bg-sky-50 disabled:opacity-50"
                            >
                              Thay file
                            </button>
                          )}
                        </div>
                        {isOfficeUrl(sib.file_goc_url) && (
                          <label className={`flex items-center gap-1.5 pl-5 ${canToggleAutoConvert ? "cursor-pointer" : "cursor-default opacity-70"}`}>
                            <input
                              type="checkbox"
                              checked={!!sib.auto_convert_pdf}
                              disabled={!canToggleAutoConvert}
                              className="rounded border-slate-300 text-violet-600 focus:ring-violet-500 disabled:cursor-default"
                              onChange={async (e) => {
                                if (!canToggleAutoConvert) return
                                const val = e.target.checked
                                setSiblingDocs((rows) => rows.map((s) => s.id === sib.id ? { ...s, auto_convert_pdf: val } : s))
                                if (isSelf) setDoc((prev) => prev ? { ...prev, auto_convert_pdf: val } : prev)
                                await supabase.from("iso_documents").update({ auto_convert_pdf: val }).eq("id", sib.id).eq("factory_id", factoryId)
                              }}
                            />
                            <span className="text-[10px] text-slate-600">Tự động chuyển sang PDF sau phê duyệt</span>
                            {!canToggleAutoConvert && sib.auto_convert_pdf && (
                              <span className="text-[10px] font-bold text-violet-600">Đã bật</span>
                            )}
                          </label>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            {/* File đính kèm — ẩn khi TẠO MỚI hồ sơ con (TH2/TH4). Hiện khi: cha mới, tài liệu đã tồn tại (kể cả hồ sơ con đang xem xét) */}
            {!(isNew && form.phan_loai_tl === "con") && (
            <div id="file-goc-upload" className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h2 className="text-sm font-extrabold text-slate-700 mb-3">{fileSectionLabel}</h2>
              <p className="text-xs text-slate-500 mb-3">PDF, DOCX hoặc XLSX</p>

              {doc?.file_signed_pdf_url && (
                <div className="mb-3 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                  <CheckCircle2 size={21} className="text-emerald-600 shrink-0" />
                  <span className="flex-1 text-sm font-extrabold text-emerald-800">PDF có chữ ký</span>
                  <a
                    href={doc.file_signed_pdf_url}
                    target="_blank"
                    rel="noreferrer"
                    title="Xem PDF có chữ ký"
                    className="shrink-0 rounded-xl bg-emerald-600 p-2.5 text-white shadow-sm transition-all hover:bg-emerald-700"
                  >
                    <Eye size={18} />
                  </a>
                  <a
                    href={doc.file_signed_pdf_url}
                    download
                    title="Tải PDF có chữ ký"
                    className="shrink-0 rounded-xl bg-slate-800 p-2.5 text-white shadow-sm transition-all hover:bg-slate-900"
                  >
                    <Download size={18} />
                  </a>
                  {isEditable && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={fileUploading}
                      className="shrink-0 rounded-xl border border-dashed border-emerald-400 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition-all"
                    >
                      {fileUploading ? "Đang tải..." : "Thay file"}
                    </button>
                  )}
                </div>
              )}

              <div className="mb-3 rounded-xl border border-violet-200 bg-violet-50 p-3">
                {mainFileUrl && !doc?.file_signed_pdf_url ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-xl bg-white/80 p-3">
                      <FileText size={16} className="text-violet-600 shrink-0" />
                      <span className="text-xs text-slate-700 flex-1 truncate">{mainFileName}</span>
                      <a href={mainFileUrl} target="_blank" rel="noreferrer" className="shrink-0 p-1 hover:bg-violet-100 rounded-lg" title="Xem file hiện tại">
                        <Eye size={13} className="text-violet-600" />
                      </a>
                      <a href={mainFileUrl} download className="shrink-0 p-1 hover:bg-violet-100 rounded-lg" title="Tải file hiện tại">
                        <Download size={13} className="text-violet-600" />
                      </a>
                    </div>
                    {isEditable && (
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={fileUploading}
                        className="w-full px-3 py-2 border border-dashed border-violet-300 hover:border-violet-500 text-violet-700 text-xs font-medium rounded-xl transition-all"
                      >
                        {fileUploading ? "Đang tải..." : "Thay file"}
                      </button>
                    )}
                    {isOfficeUrl(uploadedFileUrl || doc?.file_goc_url) && (
                      <label className={`flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 transition-all ${canToggleAutoConvert ? "cursor-pointer hover:bg-slate-50" : "cursor-default opacity-70"}`}>
                        <input
                          type="checkbox"
                          checked={!!doc?.auto_convert_pdf}
                          disabled={!canToggleAutoConvert}
                          onChange={async (e) => {
                            if (!canToggleAutoConvert) return
                            const val = e.target.checked
                            setDoc((prev) => prev ? { ...prev, auto_convert_pdf: val } : prev)
                            if (!isNew) await supabase.from("iso_documents").update({ auto_convert_pdf: val }).eq("id", docId)
                          }}
                          className="rounded border-slate-300 text-violet-600 focus:ring-violet-500 disabled:cursor-default"
                        />
                        <div>
                          <span className="text-[11px] font-medium text-slate-700">Tự động chuyển sang PDF sau phê duyệt</span>
                          {canToggleAutoConvert
                            ? <p className="text-[10px] text-slate-500 mt-0.5">Chỉ người soạn thảo chọn được, trước khi gửi xem xét.</p>
                            : doc?.auto_convert_pdf
                              ? <p className="text-[10px] font-bold text-violet-600 mt-0.5">Đã bật — sẽ tự động chuyển sau phê duyệt</p>
                              : <p className="text-[10px] text-slate-400 mt-0.5">Không bật</p>
                          }
                        </div>
                      </label>
                    )}
                  </div>
                ) : !doc?.file_signed_pdf_url ? (
                  isEditable && (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={fileUploading}
                      className="w-full flex flex-col items-center justify-center gap-2 p-5 border-2 border-dashed border-violet-200 hover:border-violet-400 rounded-xl text-violet-500 hover:text-violet-700 bg-white/70 transition-all"
                    >
                      <Upload size={20} />
                      <span className="text-xs font-medium">
                        {fileUploading ? "Đang tải lên..." : "Nhấn để chọn file"}
                      </span>
                    </button>
                  )
                ) : null}
              </div>

              {form.phan_loai_tl !== "con" && form.chon_quy_trinh !== "Soát xét" && (isEditable || (!isNew && childDocs.length > 0)) && (
                <div className="mb-3 rounded-xl border border-sky-200 bg-sky-50 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-extrabold text-sky-800">Hồ sơ con của tài liệu này</p>
                      <p className="text-[11px] text-sky-700">
                        {isEditable ? "Bấm Thêm hồ sơ, nhập từng dòng và upload một file riêng cho mỗi hồ sơ." : "Danh sách hồ sơ đã lưu."}
                      </p>
                    </div>
                    {isEditable && (
                      <button
                        type="button"
                        onClick={addChildDraftRow}
                        className="rounded-lg border border-sky-500 !bg-sky-600 px-3 py-1.5 text-xs font-bold !text-white shadow-sm hover:!bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                      >
                        Thêm hồ sơ
                      </button>
                    )}
                  </div>
                  {renderSavedChildDocs()}
                  {isEditable && (
                  <div className="space-y-2">
                    {childDraftRows.map((row) => (
                      <div key={row.id} className="rounded-xl bg-white/85 p-2 ring-1 ring-sky-100">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <label className="text-[11px] font-bold text-slate-600">
                            Mã hồ sơ
                            <input value={childRecordCode(row)} readOnly className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-700" />
                            {isDuplicateChildDraftCode(row) && (
                              <span className="mt-1 block text-[10px] font-bold text-red-600">{"M\u00e3 n\u00e0y \u0111ang tr\u00f9ng trong danh s\u00e1ch"}</span>
                            )}
                          </label>
                          <label className="text-[11px] font-bold text-slate-600">
                            Loại hồ sơ
                            <select value={row.loai_tai_lieu} onChange={(e) => updateChildDraftRow(row.id, { loai_tai_lieu: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs">
                              {childTypeOptions.map((type) => <option key={type} value={type}>{type} - {childTypeLabelMap[type]}</option>)}
                            </select>
                          </label>
                          <label className="text-[11px] font-bold text-slate-600">
                            Tên hồ sơ
                            <input value={row.ten_tai_lieu} onChange={(e) => updateChildDraftRow(row.id, { ten_tai_lieu: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                          </label>
                          <label className="text-[11px] font-bold text-slate-600">
                            Số hiệu
                            <input type="number" min="1" value={row.so_hieu} onChange={(e) => updateChildDraftRow(row.id, { so_hieu: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                          </label>
                          <label className="text-[11px] font-bold text-slate-600">
                            Lần ban hành
                            <input type="text" value={row.lan_ban_hanh} onChange={(e) => updateChildDraftRow(row.id, { lan_ban_hanh: e.target.value })} placeholder="VD: 00 hoặc 01/01" className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-mono" />
                          </label>
                          <div className="text-[11px] font-bold text-slate-600">
                            File hồ sơ
                            <label className="mt-1 flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-dashed border-sky-300 px-2 py-1.5 text-left text-xs text-sky-700 hover:border-sky-500">
                              <span className="truncate">{row.file_name ? stripFileExtension(row.file_name) : "Chọn file"}</span>
                              <Upload size={13} />
                              <input
                                type="file"
                                accept=".pdf,.docx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0]
                                  if (f) void handleChildRowFileUpload(f, row.id)
                                  e.target.value = ""
                                }}
                              />
                            </label>
                          </div>
                          <label className="col-span-2 text-[11px] font-bold text-slate-600">
                            Ghi chú
                            <input value={row.ghi_chu} onChange={(e) => updateChildDraftRow(row.id, { ghi_chu: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                          </label>
                        </div>
                        <button type="button" onClick={() => setChildDraftRows((rows) => rows.filter((item) => item.id !== row.id))} className="mt-2 text-[11px] font-bold text-red-600 hover:text-red-700">
                          Xóa dòng
                        </button>
                      </div>
                    ))}
                    {childDraftRows.length === 0 && childDocs.length === 0 && (
                      <p className="rounded-lg bg-white/70 px-3 py-2 text-[11px] text-sky-700">Chưa có hồ sơ con nào. Bấm &quot;Thêm hồ sơ&quot; để bắt đầu.</p>
                    )}
                  </div>
                  )}
                </div>
              )}


              {/* Hướng dẫn nhãn header — ẩn với TH3 Soát xét (guide hiện SAU "Tài liệu soát xét") */}
              {form.chon_quy_trinh !== "Soát xét" && (
                <>
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
                </>
              )}


            </div>
            )}

            {form.chon_quy_trinh === "Soát xét" && form.phan_loai_tl !== "con" && (isEditable || childDocs.length > 0 || childReviewRows.length > 0 || childDraftRows.length > 0) && (
              <div className="mb-3 space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
                <div className="rounded-xl border border-emerald-200 bg-white p-4 shadow-sm">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-extrabold text-emerald-800">Soát xét hồ sơ con hiện có</p>
                      <p className="text-[11px] text-slate-500">Chọn các hồ sơ con đang có hiệu lực thuộc tài liệu cha này và upload phiên bản mới cho từng hồ sơ cần sửa.</p>
                      {!canAddParentReviewChild && (
                        <p className="mt-1 text-[11px] font-medium text-amber-600">Chọn tài liệu cha đang có hiệu lực trước khi thêm hồ sơ con cần soát xét.</p>
                      )}
                    </div>
                    {isEditable && (
                      <button
                        type="button"
                        onClick={addChildReviewRow}
                        disabled={!canAddParentReviewChild}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-bold shadow-sm transition-all ${canAddParentReviewChild ? "border-emerald-500 !bg-emerald-600 !text-white hover:!bg-emerald-700" : "cursor-not-allowed border-slate-300 !bg-slate-200 !text-slate-400 opacity-60"}`}
                      >
                        Thêm hồ sơ
                      </button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {childReviewRows.map((row) => {
                      const reviewFileInputId = `child-review-file-${row.id}`
                      return (
                      <div
                        key={row.id}
                        className="rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-100"
                        data-testid="child-review-row"
                        data-row-id={row.id}
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <label className="col-span-2 text-[11px] font-bold text-slate-600">
                            Mã hồ sơ cũ <span className="text-red-500">*</span>
                            <select
                              value={row.old_doc_id}
                              onChange={(e) => applyReviewRowDocument(row.id, e.target.value)}
                              disabled={!isEditable}
                              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs disabled:bg-slate-50"
                            >
                              <option value="">— Chọn hồ sơ đang có hiệu lực —</option>
                              {parentReviewChildOptions.map((item) => (
                                <option key={item.id} value={item.id}>{item.ma_tai_lieu} — {item.ten_tai_lieu}</option>
                              ))}
                            </select>
                            {parentReviewChildOptions.length === 0 && canAddParentReviewChild && (
                              <span className="mt-1 block text-[10px] text-amber-600">Tài liệu cha này chưa có hồ sơ con có hiệu lực.</span>
                            )}
                          </label>
                          <label className="text-[11px] font-bold text-slate-600">
                            Lần sửa đổi <span className="text-red-500">*</span>
                            <input type="text" value={row.lan_sua_doi} onChange={(e) => updateChildReviewRow(row.id, { lan_sua_doi: e.target.value })} disabled={!isEditable} placeholder="VD: 01 hoặc 01/01" className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-mono disabled:bg-slate-50" />
                          </label>
                          <label className="text-[11px] font-bold text-slate-600">
                            Đổi mã?
                            <select value={row.doi_ma ? "co" : "khong"} onChange={(e) => updateChildReviewRow(row.id, { doi_ma: e.target.value === "co", ma_tai_lieu_moi: "" })} disabled={!isEditable} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs disabled:bg-slate-50">
                              <option value="khong">Không</option>
                              <option value="co">Có</option>
                            </select>
                          </label>
                          {row.doi_ma && (
                            <label className="col-span-2 text-[11px] font-bold text-slate-600">
                              Mã hồ sơ mới <span className="text-red-500">*</span>
                              <input type="text" value={row.ma_tai_lieu_moi} onChange={(e) => updateChildReviewRow(row.id, { ma_tai_lieu_moi: e.target.value.toUpperCase() })} disabled={!isEditable} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-mono disabled:bg-slate-50" />
                            </label>
                          )}
                          <label className="col-span-2 text-[11px] font-bold text-slate-600">
                            Tên hồ sơ mới <span className="text-red-500">*</span>
                            <input type="text" value={row.ten_tai_lieu_moi} onChange={(e) => updateChildReviewRow(row.id, { ten_tai_lieu_moi: e.target.value })} disabled={!isEditable} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs disabled:bg-slate-50" />
                          </label>
                          <div className="col-span-2 text-[11px] font-bold text-slate-600">
                            File hồ sơ mới <span className="text-red-500">*</span>
                            <label
                              htmlFor={reviewFileInputId}
                              data-testid="child-review-file-trigger"
                              data-row-id={row.id}
                              className={`mt-1 flex w-full items-center justify-between gap-2 rounded-lg border border-dashed border-emerald-300 px-2 py-1.5 text-left text-xs text-emerald-700 ${isEditable ? "cursor-pointer hover:border-emerald-500" : "cursor-default opacity-70"}`}
                            >
                              <span className="truncate">{row.file_name ? stripFileExtension(row.file_name) : "Chọn file"}</span>
                              <Upload size={13} />
                            </label>
                            {isEditable && (
                              <input
                                id={reviewFileInputId}
                                type="file"
                                accept=".pdf,.docx,.xlsx"
                                className="hidden"
                                data-testid="child-review-file-input"
                                data-row-id={row.id}
                                onChange={(e) => {
                                  const f = e.target.files?.[0]
                                  if (f) void handleReviewRowFileUpload(f, row.id)
                                  e.target.value = ""
                                }}
                              />
                            )}
                          </div>
                        </div>
                        {isEditable && (
                          <button type="button" onClick={() => setChildReviewRows((rows) => rows.filter((item) => item.id !== row.id))} className="mt-2 text-[11px] font-bold text-red-600 hover:text-red-700">
                            Xóa dòng
                          </button>
                        )}
                      </div>
                    )})}
                    {childReviewRows.length === 0 && (
                      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700">Chưa có hồ sơ con nào cần soát xét trong đợt này.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-sky-200 bg-white p-4 shadow-sm">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-extrabold text-sky-800">Thêm hồ sơ con mới</p>
                      <p className="text-[11px] text-slate-500">Dùng cho hồ sơ con phát sinh mới trong lần soát xét tài liệu cha hiện tại.</p>
                      {!canAddParentReviewNewChild && (
                        <p className="mt-1 text-[11px] font-medium text-amber-600">Chọn tài liệu cha và mã đích trước khi thêm hồ sơ con mới.</p>
                      )}
                    </div>
                    {isEditable && (
                      <button
                        type="button"
                        onClick={addChildDraftRow}
                        disabled={!canAddParentReviewNewChild}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-bold shadow-sm transition-all ${canAddParentReviewNewChild ? "border-sky-500 !bg-sky-600 !text-white hover:!bg-sky-700" : "cursor-not-allowed border-slate-300 !bg-slate-200 !text-slate-400 opacity-60"}`}
                      >
                        Thêm hồ sơ
                      </button>
                    )}
                  </div>
                  {!isNew && renderSavedChildDocs()}
                  <div className="space-y-2">
                    {childDraftRows.map((row) => {
                      const draftFileInputId = `child-draft-file-${row.id}`
                      return (
                      <div
                        key={row.id}
                        className="rounded-xl bg-white/85 p-2 ring-1 ring-sky-100"
                        data-testid="child-draft-row"
                        data-row-id={row.id}
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <label className="text-[11px] font-bold text-slate-600">
                            Mã hồ sơ
                            <input value={childRecordCode(row)} readOnly className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-700" />
                            {isDuplicateChildDraftCode(row) && (
                              <span className="mt-1 block text-[10px] font-bold text-red-600">Mã này đang trùng trong danh sách</span>
                            )}
                          </label>
                          <label className="text-[11px] font-bold text-slate-600">
                            Loại hồ sơ
                            <select value={row.loai_tai_lieu} onChange={(e) => updateChildDraftRow(row.id, { loai_tai_lieu: e.target.value })} disabled={!isEditable} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs disabled:bg-slate-50">
                              {childTypeOptions.map((type) => <option key={type} value={type}>{type} - {childTypeLabelMap[type]}</option>)}
                            </select>
                          </label>
                          <label className="text-[11px] font-bold text-slate-600">
                            Tên hồ sơ
                            <input value={row.ten_tai_lieu} onChange={(e) => updateChildDraftRow(row.id, { ten_tai_lieu: e.target.value })} disabled={!isEditable} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs disabled:bg-slate-50" />
                          </label>
                          <label className="text-[11px] font-bold text-slate-600">
                            Số hiệu
                            <input type="number" min="1" value={row.so_hieu} onChange={(e) => updateChildDraftRow(row.id, { so_hieu: e.target.value })} disabled={!isEditable} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs disabled:bg-slate-50" />
                          </label>
                          <label className="text-[11px] font-bold text-slate-600">
                            Lần ban hành
                            <input type="text" value={row.lan_ban_hanh} onChange={(e) => updateChildDraftRow(row.id, { lan_ban_hanh: e.target.value })} disabled={!isEditable} placeholder="VD: 00 hoặc 01/01" className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-mono disabled:bg-slate-50" />
                          </label>
                          <div className="text-[11px] font-bold text-slate-600">
                            File hồ sơ
                            <label
                              htmlFor={draftFileInputId}
                              data-testid="child-draft-file-trigger"
                              data-row-id={row.id}
                              className={`mt-1 flex w-full items-center justify-between gap-2 rounded-lg border border-dashed border-sky-300 px-2 py-1.5 text-left text-xs text-sky-700 ${isEditable ? "cursor-pointer hover:border-sky-500" : "cursor-default opacity-70"}`}
                            >
                              <span className="truncate">{row.file_name ? stripFileExtension(row.file_name) : "Chọn file"}</span>
                              <Upload size={13} />
                            </label>
                            {isEditable && (
                              <input
                                id={draftFileInputId}
                                type="file"
                                accept=".pdf,.docx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                                className="hidden"
                                data-testid="child-draft-file-input"
                                data-row-id={row.id}
                                onChange={(e) => {
                                  const f = e.target.files?.[0]
                                  if (f) void handleChildRowFileUpload(f, row.id)
                                  e.target.value = ""
                                }}
                              />
                            )}
                          </div>
                          <label className="col-span-2 text-[11px] font-bold text-slate-600">
                            Ghi chú
                            <input value={row.ghi_chu} onChange={(e) => updateChildDraftRow(row.id, { ghi_chu: e.target.value })} disabled={!isEditable} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs disabled:bg-slate-50" />
                          </label>
                        </div>
                        {isEditable && (
                          <button type="button" onClick={() => setChildDraftRows((rows) => rows.filter((item) => item.id !== row.id))} className="mt-2 text-[11px] font-bold text-red-600 hover:text-red-700">
                            Xóa dòng
                          </button>
                        )}
                      </div>
                    )})}
                    {childDraftRows.length === 0 && childDocs.length === 0 && (
                      <p className="rounded-lg bg-white/70 px-3 py-2 text-[11px] text-sky-700">Chưa có hồ sơ con mới nào trong đợt soát xét này.</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Tài liệu soát xét — TH3 (soát xét tài liệu cha/hồ sơ độc lập): hiện SAU File tài liệu */}
            {form.chon_quy_trinh === "Soát xét" && !(isNew && form.phan_loai_tl === "con") && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <h2 className="text-sm font-extrabold text-slate-700 mb-3">Tài liệu soát xét</h2>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-bold text-slate-600 mb-2">Phiếu yêu cầu thay đổi</p>
                    {reviewChangeFileUrl ? (
                      <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-xl">
                        <FileText size={16} className="text-amber-600 shrink-0" />
                        <span className="text-xs text-slate-700 flex-1 truncate">{reviewChangeFileName}</span>
                        <a href={doc?.file_phieu_yeu_cau_thay_doi_signed_url || reviewChangeFileUrl} target="_blank" rel="noreferrer" className="shrink-0 p-1 hover:bg-amber-100 rounded-lg">
                          <Eye size={13} className="text-amber-600" />
                        </a>
                      </div>
                    ) : null}
                    {isEditable && (
                      <button
                        type="button"
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
                        <a href={doc?.file_de_nghi_soat_xet_signed_url || reviewRequestFileUrl} target="_blank" rel="noreferrer" className="shrink-0 p-1 hover:bg-sky-100 rounded-lg">
                          <Eye size={13} className="text-sky-600" />
                        </a>
                      </div>
                    ) : null}
                    {isEditable && (
                      <button
                        type="button"
                        onClick={() => reviewRequestFileInputRef.current?.click()}
                        disabled={fileUploading}
                        className="mt-2 w-full px-3 py-2 border border-dashed border-slate-300 hover:border-sky-400 text-slate-500 hover:text-sky-700 text-xs font-medium rounded-xl transition-all"
                      >
                        {reviewRequestFileUrl ? "Thay file" : "Upload đề nghị soát xét"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
            {/* Hướng dẫn tag cho TH3 */}
            {form.chon_quy_trinh === "Soát xét" && !(isNew && form.phan_loai_tl === "con") && renderOfficeTagGuide()}

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
              <div className="flex items-center gap-2 text-xs text-slate-600 flex-wrap">
                <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700 border border-amber-200">
                  Không đặt ra ngoài ô chứa
                </span>
                {placementModal.action === "phe_duyet" && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-slate-400">Ký thay:</span>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name="iso-doc-sign-as"
                        checked={signAs === "none"}
                        onChange={() => setSignAs("none")}
                      />
                      Trực tiếp
                    </label>
                    {SIGN_AS_OPTIONS.map((opt) => (
                      <label key={opt} className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name="iso-doc-sign-as"
                          checked={signAs === opt}
                          onChange={() => setSignAs(opt)}
                        />
                        {SIGN_AS_LABEL[opt]}
                      </label>
                    ))}
                  </div>
                )}
                {placementModal.extraSigBoxes.length < MAX_EXTRA_SIG && (
                  <button
                    onClick={() => setPlacementModal((p) => p ? {
                      ...p,
                      extraSigBoxes: [...p.extraSigBoxes, {
                        id: Date.now() + Math.random(),
                        sigX: p.sigX + 30 * (p.extraSigBoxes.length + 1),
                        sigY: p.sigY + 30 * (p.extraSigBoxes.length + 1),
                        sigW: p.sigW,
                        sigH: p.sigH,
                        nameX: p.nameX + 30 * (p.extraSigBoxes.length + 1),
                        nameY: p.nameY + 30 * (p.extraSigBoxes.length + 1),
                        nameW: p.nameW,
                        nameH: p.nameH,
                        showSignature: p.showSignature,
                        showSignerName: p.showSignerName,
                      }],
                    } : null)}
                    className="px-2 py-1 rounded-lg border border-violet-300 text-violet-700 hover:bg-violet-50 transition-all font-bold"
                  >
                    + Nhân bản chữ ký
                  </button>
                )}
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
            <div className="flex-1 overflow-auto flex items-start p-4 bg-slate-100">
              <div className="relative inline-block shadow-2xl bg-white select-none mx-auto">
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
                    onDrag={(_, d) => setPlacementModal((p) => p ? { ...p, sigX: d.x, sigY: d.y } : null)}
                    onStop={(_, d) => setPlacementModal((p) => p ? { ...p, sigX: d.x, sigY: d.y } : null)}
                    bounds="parent"
                    cancel=".react-resizable-handle,button"
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
                          style={{ width: "100%", height: "100%", objectFit: "contain", opacity: 0.9, display: placementModal.showSignature ? "block" : "none" }}
                          draggable={false}
                        />
                        {!placementModal.showSignature && (
                          <div style={{
                            position: "absolute", inset: 0,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            background: "rgba(241,245,249,0.85)",
                          }}>
                            <span style={{ fontSize: 10, color: "#94a3b8" }}>Ẩn chữ ký</span>
                          </div>
                        )}
                        {placementModal.showSignature && (
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
                        )}
                        <div className="absolute -top-2.5 -right-2.5 flex items-center gap-1" style={{ zIndex: 20 }}>
                          <button
                            type="button"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={() => setPlacementModal((p) => p ? { ...p, showSignature: !p.showSignature } : null)}
                            className="w-5 h-5 bg-white border border-slate-200 rounded-full shadow flex items-center justify-center hover:bg-slate-50 text-slate-600"
                            title={placementModal.showSignature ? "Ẩn chữ ký" : "Hiện chữ ký"}
                          >
                            {placementModal.showSignature ? <EyeOff size={10} /> : <Eye size={10} />}
                          </button>
                          {placementModal.extraSigBoxes.length < MAX_EXTRA_SIG && (
                            <button
                              type="button"
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={() => setPlacementModal((p) => p ? {
                                ...p,
                                extraSigBoxes: [...p.extraSigBoxes, {
                                  id: Date.now() + Math.random(),
                                  sigX: p.sigX + 30 * (p.extraSigBoxes.length + 1),
                                  sigY: p.sigY + 30 * (p.extraSigBoxes.length + 1),
                                  sigW: p.sigW,
                                  sigH: p.sigH,
                                  nameX: p.nameX + 30 * (p.extraSigBoxes.length + 1),
                                  nameY: p.nameY + 30 * (p.extraSigBoxes.length + 1),
                                  nameW: p.nameW,
                                  nameH: p.nameH,
                                  showSignature: p.showSignature,
                                  showSignerName: p.showSignerName,
                                }],
                              } : null)}
                              className="w-5 h-5 bg-violet-600 border border-violet-700 text-white rounded-full shadow flex items-center justify-center hover:bg-violet-700 font-bold"
                              title="Nhân bản chữ ký và tên (+)"
                            >
                              <Plus size={10} />
                            </button>
                          )}
                        </div>
                      </Resizable>
                    </div>
                  </Draggable>
                )}
                {placementModal.showQrPlacement && (
                  <Draggable
                    nodeRef={qrNodeRef as RefObject<HTMLElement>}
                    position={{ x: placementModal.qrX, y: placementModal.qrY }}
                    onDrag={(_, d) => setPlacementModal((p) => p ? { ...p, qrX: d.x, qrY: d.y } : null)}
                    onStop={(_, d) => setPlacementModal((p) => p ? { ...p, qrX: d.x, qrY: d.y } : null)}
                    bounds="parent"
                    cancel=".react-resizable-handle,button"
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
                {placementModal.signerName && (
                  <Draggable
                    nodeRef={nameNodeRef as RefObject<HTMLElement>}
                    position={{ x: placementModal.nameX, y: placementModal.nameY }}
                    onDrag={(_, d) => setPlacementModal((p) => p ? { ...p, nameX: d.x, nameY: d.y } : null)}
                    onStop={(_, d) => setPlacementModal((p) => p ? { ...p, nameX: d.x, nameY: d.y } : null)}
                    bounds="parent"
                    cancel=".react-resizable-handle,button"
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
                        {placementModal.showSignerName ? (
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
                        ) : (
                          <span style={{ fontSize: 10, color: "#94a3b8", pointerEvents: "none" }}>Ẩn tên</span>
                        )}
                        <div className="absolute -top-2.5 -right-2.5 flex items-center gap-1" style={{ zIndex: 20 }}>
                          <button
                            type="button"
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={() => setPlacementModal((p) => p ? { ...p, showSignerName: !p.showSignerName } : null)}
                            className="w-5 h-5 bg-white border border-slate-200 rounded-full shadow flex items-center justify-center hover:bg-slate-50 text-slate-600"
                            title={placementModal.showSignerName ? "Ẩn tên" : "Hiện tên"}
                          >
                            {placementModal.showSignerName ? <EyeOff size={10} /> : <Eye size={10} />}
                          </button>
                          {placementModal.extraSigBoxes.length < MAX_EXTRA_SIG && (
                            <button
                              type="button"
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={() => setPlacementModal((p) => p ? {
                                ...p,
                                extraSigBoxes: [...p.extraSigBoxes, {
                                  id: Date.now() + Math.random(),
                                  sigX: p.sigX + 30 * (p.extraSigBoxes.length + 1),
                                  sigY: p.sigY + 30 * (p.extraSigBoxes.length + 1),
                                  sigW: p.sigW,
                                  sigH: p.sigH,
                                  nameX: p.nameX + 30 * (p.extraSigBoxes.length + 1),
                                  nameY: p.nameY + 30 * (p.extraSigBoxes.length + 1),
                                  nameW: p.nameW,
                                  nameH: p.nameH,
                                  showSignature: p.showSignature,
                                  showSignerName: p.showSignerName,
                                }],
                              } : null)}
                              className="w-5 h-5 bg-purple-600 border border-purple-700 text-white rounded-full shadow flex items-center justify-center hover:bg-purple-700 font-bold"
                              title="Nhân bản chữ ký và tên (+)"
                            >
                              <Plus size={10} />
                            </button>
                          )}
                        </div>
                        {placementModal.showSignerName && (
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
                        )}
                      </Resizable>
                    </div>
                  </Draggable>
                )}

                {/* Tiền tố ký thay (KT./TM./TL./TUQ.) — chỉ bước Phê duyệt, chỉ hiện khi đã chọn */}
                {placementModal.action === "phe_duyet" && signAs !== "none" && (
                  <Draggable
                    nodeRef={prefixNodeRef as RefObject<HTMLElement>}
                    position={{ x: placementModal.prefixX, y: placementModal.prefixY }}
                    onDrag={(_, d) => setPlacementModal((p) => p ? { ...p, prefixX: d.x, prefixY: d.y } : null)}
                    onStop={(_, d) => setPlacementModal((p) => p ? { ...p, prefixX: d.x, prefixY: d.y } : null)}
                    bounds="parent"
                    cancel=".react-resizable-handle,button"
                  >
                    <div ref={prefixNodeRef} style={{ position: "absolute", top: 0, left: 0, zIndex: 11, cursor: "move" }}>
                      <Resizable
                        size={{ width: placementModal.prefixW, height: placementModal.prefixH }}
                        onResizeStop={(_, __, ref) => setPlacementModal((p) => p ? {
                          ...p,
                          prefixW: parseInt(ref.style.width) || p.prefixW,
                          prefixH: parseInt(ref.style.height) || p.prefixH,
                        } : null)}
                        minWidth={36}
                        minHeight={16}
                        style={{
                          border: "2px dashed #059669",
                          position: "relative",
                          background: "rgba(236,253,245,0.9)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#047857", pointerEvents: "none" }}>{signAs}.</span>
                      </Resizable>
                    </div>
                  </Draggable>
                )}
                {/* Extra sig boxes (clone) */}
                {placementModal.extraSigBoxes.map((box, idx) => (
                  <Fragment key={box.id}>
                    <ExtraDraggableBox
                      position={{ x: box.sigX, y: box.sigY }}
                      onStop={(_, d) => setPlacementModal((p) => p ? {
                        ...p,
                        extraSigBoxes: p.extraSigBoxes.map((b) => b.id === box.id ? { ...b, sigX: d.x, sigY: d.y } : b),
                      } : null)}
                      zIndex={12}
                    >
                      <Resizable
                        size={{ width: box.sigW, height: box.sigH }}
                        onResizeStop={(_, __, ref) => setPlacementModal((p) => p ? {
                          ...p,
                          extraSigBoxes: p.extraSigBoxes.map((b) => b.id === box.id ? {
                            ...b,
                            sigW: parseInt(ref.style.width) || b.sigW,
                            sigH: parseInt(ref.style.height) || b.sigH,
                          } : b),
                        } : null)}
                        minWidth={40}
                        minHeight={20}
                        style={{ border: "2px dashed #9333ea", position: "relative" }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={placementModal.sigImgUrl ?? ""}
                          alt="chữ ký bản sao"
                          style={{ width: "100%", height: "100%", objectFit: "contain", opacity: 0.9, display: box.showSignature ? "block" : "none" }}
                          draggable={false}
                        />
                        <div className="absolute -top-2.5 -right-2.5 flex items-center gap-1" style={{ zIndex: 20 }}>
                          <button
                            type="button"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={() => setPlacementModal((p) => p ? {
                              ...p,
                              extraSigBoxes: p.extraSigBoxes.map((b) => b.id === box.id ? { ...b, showSignature: !b.showSignature } : b),
                            } : null)}
                            className="w-5 h-5 bg-white border border-slate-200 rounded-full shadow flex items-center justify-center hover:bg-slate-50 text-slate-600"
                            title={box.showSignature ? "Ẩn chữ ký bản sao" : "Hiện chữ ký bản sao"}
                          >
                            {box.showSignature ? <EyeOff size={10} /> : <Eye size={10} />}
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={() => setPlacementModal((p) => p ? {
                              ...p,
                              extraSigBoxes: p.extraSigBoxes.filter((b) => b.id !== box.id),
                            } : null)}
                            className="w-5 h-5 bg-red-500 border border-red-600 text-white rounded-full shadow flex items-center justify-center hover:bg-red-600 text-xs font-bold"
                            title="Tắt / Xóa bản sao này"
                          >
                            ×
                          </button>
                        </div>
                        <span style={{
                          position: "absolute", top: -20, left: 0, fontSize: 10,
                          color: "#9333ea", background: "rgba(255,255,255,0.92)",
                          padding: "1px 5px", borderRadius: 4, whiteSpace: "nowrap", pointerEvents: "none",
                        }}>
                          Bản sao {idx + 1}
                        </span>
                      </Resizable>
                    </ExtraDraggableBox>
                    {box.showSignerName && placementModal.signerName && (
                      <ExtraDraggableBox
                        position={{ x: box.nameX, y: box.nameY }}
                        onStop={(_, d) => setPlacementModal((p) => p ? {
                          ...p,
                          extraSigBoxes: p.extraSigBoxes.map((b) => b.id === box.id ? { ...b, nameX: d.x, nameY: d.y } : b),
                        } : null)}
                        zIndex={13}
                      >
                        <Resizable
                          size={{ width: box.nameW, height: box.nameH }}
                          onResizeStop={(_, __, ref) => setPlacementModal((p) => p ? {
                            ...p,
                            extraSigBoxes: p.extraSigBoxes.map((b) => b.id === box.id ? {
                              ...b,
                              nameW: parseInt(ref.style.width) || b.nameW,
                              nameH: parseInt(ref.style.height) || b.nameH,
                            } : b),
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
                          <button
                            type="button"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={() => setPlacementModal((p) => p ? {
                              ...p,
                              extraSigBoxes: p.extraSigBoxes.map((b) => b.id === box.id ? { ...b, showSignerName: !b.showSignerName } : b),
                            } : null)}
                            className="absolute -top-2.5 -right-2.5 w-5 h-5 bg-white border border-slate-200 rounded-full shadow flex items-center justify-center hover:bg-slate-50 text-slate-600"
                            style={{ zIndex: 20 }}
                            title={box.showSignerName ? "Ẩn tên bản sao" : "Hiện tên bản sao"}
                          >
                            {box.showSignerName ? <EyeOff size={10} /> : <Eye size={10} />}
                          </button>
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
                            Tên bản sao {idx + 1}
                          </span>
                        </Resizable>
                      </ExtraDraggableBox>
                    )}
                  </Fragment>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Quản lý phân phối tài liệu */}
        {!isNew && canDistribute && factoryId && user?.id && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <button
              onClick={() => setShowManagement((prev) => !prev)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 text-left"
            >
              <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
                <Share2 size={14} className="text-emerald-600" />
                Quản lý phân phối tài liệu
              </span>
              <ChevronUp size={14} className={`text-slate-400 transition-transform ${showManagement ? "" : "rotate-180"}`} />
            </button>
            {showManagement && (
              <div className="border-t border-slate-100 p-4">
                <DistributionManagement
                  factoryId={factoryId}
                  userId={user.id}
                  docId={docId}
                  canDistribute={canDistribute}
                />
              </div>
            )}
          </div>
        )}

        {/* PIN Modal */}
        {pinModal && (
          <ModalShell
            title={
              <span className="flex items-center gap-3">
                <span className="p-2 bg-violet-100 rounded-xl"><KeyRound size={18} className="text-violet-600" /></span>
                <span>
                  <span className="font-extrabold text-slate-800 block">{pinModal.label}</span>
                  <span className="text-xs text-slate-500 font-normal">Nhập PIN ký duyệt để xác nhận</span>
                </span>
              </span>
            }
            onClose={() => { setPinModal(null); setPin(""); setPinError(""); setLyDoTraVe("") }}
            maxWidth="sm"
            footer={pinModalFooter}
          >
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
          </ModalShell>
        )}
      </div>

      {/* Modal phân phối */}
      {showDistributeModal && factoryId && user?.id && (
        <DistributionModal
          factoryId={factoryId}
          userId={user.id}
          initialDocIds={isNew ? [] : [docId]}
          onClose={() => setShowDistributeModal(false)}
          onSuccess={() => {
            setShowDistributeModal(false)
            setShowManagement(true)
          }}
        />
      )}
    </IsoShell>
  )
}
