"use client"

// Màn hình "Cài đặt vị trí ký" — người soạn thảo vẽ khung vị trí trường ký 1 LẦN cho
// mỗi loại tài liệu, lưu vào bảng `mau_vi_tri`. Bám sát mockup đã duyệt
// cung_cap_dl/thiet_ke_soan_thao_vi_tri_ky.html (xem CLAUDE.md mục "Kế hoạch phiên sau
// 2026-09-02"). Dùng chung cho mọi module upload PDF (hiện tại chỉ Văn bản gọi tới —
// documents/[id]/page.tsx's handleGuiKy — ISO để dành phiên sau).
//
// PHẠM VI PHIÊN NÀY: chỉ đọc/ghi bảng `mau_vi_tri` qua /api/signing/templates — KHÔNG
// đụng `yeu_cau_ky`/`truong_ky`/`stampPdf`/api/documents/sign hay bất kỳ route ký thật
// nào. Vẽ mẫu ở đây CHƯA thay đổi cách file thật sự được đóng dấu — đó là việc của
// phiên tích hợp sau.
//
// Quy tắc bắt buộc theo yêu cầu người dùng: MỌI lượt "Gửi ký" đều phải đi qua màn này —
// kể cả khi loại tài liệu ĐÃ có mẫu lưu sẵn, người soạn thảo vẫn phải xem lại/xác nhận
// đúng vị trí (không tự động bỏ qua). Chỉ khi bấm "Xác nhận vị trí & Gửi đi" (không đổi
// gì so với mẫu đã lưu, hoặc đã lưu xong mẫu mới) mới thật sự điều hướng quay lại và
// gọi hành động gửi ký thật.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Grid3x3,
  Loader2,
  Send,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import {
  SIGN_TEMPLATE_SIGN_AS_OPTIONS,
  SIGN_TEMPLATE_SIGN_AS_LABEL,
  ISO_ROLE_DEFS,
  ISO_ROLE_ORDER,
  ISO_ROLE_COLORS,
  formatIsoTemplateKey,
  type SignTemplateAnchor,
  type SignTemplateBox,
  type SignTemplateBoxLoai,
  type ChucVuKey,
  type SignTemplateSignAsKey,
  type IsoSignRoleId,
} from "@/lib/signing/templates"

// ── Vai trò gốc — cấu hình cho module "documents" (Văn bản) và "iso" (ISO). Vai trò khác free-text,
// người dùng có thể "Nhân bản" (duplicate) bất kỳ vai trò đã đặt nào để tạo thêm vị trí
// (vd nhiều bước ký phòng ban khác nhau) — mirror đúng cơ chế mockup, không hardcode
// số lượng cố định. ──
type BaseRoleId = "ky_buoc" | "phe_duyet" | "qr" | "ngay_ky" | "ghi_chu" | "soan_thao" | "xem_xet"

const ROLE_ORDER: BaseRoleId[] = ["ky_buoc", "phe_duyet", "qr", "ngay_ky", "ghi_chu"]

const BASE_ROLE_DEFS: Record<
  BaseRoleId,
  {
    label: string
    loai: SignTemplateBoxLoai
    batBuoc: boolean
    showNameDefault: boolean
    defaultBox: { xPct: number; yPct: number; wPct: number; hPct: number }
  }
> = {
  ky_buoc: {
    label: "Ký bước (phòng ban / cá nhân)",
    loai: "chu_ky",
    batBuoc: true,
    showNameDefault: true,
    defaultBox: { xPct: 8, yPct: 74, wPct: 26, hPct: 14 },
  },
  phe_duyet: {
    label: "Phê duyệt",
    loai: "chu_ky",
    batBuoc: true,
    showNameDefault: true,
    defaultBox: { xPct: 66, yPct: 74, wPct: 26, hPct: 14 },
  },
  qr: {
    label: "QR xác thực",
    loai: "qr",
    batBuoc: false,
    showNameDefault: false,
    defaultBox: { xPct: 6, yPct: 6, wPct: 12, hPct: 8 },
  },
  ngay_ky: {
    label: "Ngày ký",
    loai: "ngay_ky",
    batBuoc: false,
    showNameDefault: false,
    defaultBox: { xPct: 37, yPct: 60, wPct: 20, hPct: 6 },
  },
  ghi_chu: {
    label: "Ghi chú",
    loai: "ghi_chu",
    batBuoc: false,
    showNameDefault: false,
    defaultBox: { xPct: 6, yPct: 89, wPct: 88, hPct: 8 },
  },
  soan_thao: {
    label: "Soạn thảo",
    loai: "chu_ky",
    batBuoc: true,
    showNameDefault: false,
    defaultBox: { xPct: 6, yPct: 74, wPct: 26, hPct: 14 },
  },
  xem_xet: {
    label: "Xem xét",
    loai: "chu_ky",
    batBuoc: true,
    showNameDefault: false,
    defaultBox: { xPct: 37, yPct: 74, wPct: 26, hPct: 14 },
  },
}

const CHUC_VU_LABELS: Record<ChucVuKey, string> = {
  chinh_quyen: "Chức vụ chính quyền",
  kiem_nhiem: "Chức vụ kiêm nhiệm",
  doan_the: "Chức vụ đoàn thể",
}

const ROLE_COLORS: Record<BaseRoleId, { fg: string; bg: string }> = {
  ky_buoc: { fg: "#f59e0b", bg: "rgba(245,158,11,.14)" },
  phe_duyet: { fg: "#10b981", bg: "rgba(16,185,129,.14)" },
  qr: { fg: "#8b5cf6", bg: "rgba(139,92,246,.14)" },
  ngay_ky: { fg: "#f43f5e", bg: "rgba(244,63,94,.14)" },
  ghi_chu: { fg: "#0d9488", bg: "rgba(13,148,136,.14)" },
  soan_thao: { fg: "#0284c7", bg: "rgba(2,132,199,.14)" },
  xem_xet: { fg: "#d97706", bg: "rgba(217,119,6,.14)" },
}

// Bảng màu riêng cho từng slot NHÂN BẢN của family "ky_buoc" — index 0 giữ đúng màu amber cũ
// (không đổi màu bản gốc để tránh phá layout đã quen mắt), các slot sau luân phiên màu khác để
// dễ phân biệt bằng mắt khi nhiều người cùng ký 1 bước. Chỉ áp dụng cho "ky_buoc" — qr/phe_duyet/
// ngay_ky/ghi_chu giữ nguyên đúng 1 màu cố định kể cả khi bị nhân bản.
const KY_BUOC_CLONE_PALETTE: { fg: string; bg: string }[] = [
  { fg: "#f59e0b", bg: "rgba(245,158,11,.14)" }, // amber — bản gốc / bản 1
  { fg: "#0ea5e9", bg: "rgba(14,165,233,.14)" }, // sky
  { fg: "#db2777", bg: "rgba(219,39,119,.14)" }, // pink
  { fg: "#65a30d", bg: "rgba(101,163,13,.14)" }, // lime
  { fg: "#6366f1", bg: "rgba(99,102,241,.14)" }, // indigo
  { fg: "#ea580c", bg: "rgba(234,88,12,.14)" }, // orange
  { fg: "#06b6d4", bg: "rgba(6,182,212,.14)" }, // cyan
  { fg: "#a16207", bg: "rgba(161,98,7,.14)" }, // amber đậm
]

type PctBox = { xPct: number; yPct: number; wPct: number; hPct: number }

type EditorRole = {
  id: string
  baseId: BaseRoleId
  label: string
  loai: SignTemplateBoxLoai
  batBuoc: boolean
  isClone: boolean
  placed: boolean
  anchor: SignTemplateAnchor
  page: number
  box: PctBox
  // 2 công tắc ĐỘC LẬP: file PDF gốc có thể đã in sẵn tên và/hoặc chức vụ, chỉ người soạn thảo
  // biết cần vẽ đè cái nào — tắt cả hai thì chỉ đóng ảnh chữ ký lên khung.
  showName: boolean
  showChucVu: boolean
  chucVuKey: ChucVuKey | null
  // Tiền tố ký thay KT./TM./TL./TUQ. — chỉ có ý nghĩa với loai==="chu_ky" (phe_duyet, hoặc
  // ky_buoc khi bước đó thực sự là ký theo phòng ban). Người soạn thảo chọn 1 lần ở đây, lưu vào
  // mẫu — CHƯA được route ký thật đọc (xem SignTemplateBox.sign_as trong templates.ts).
  signAs: SignTemplateSignAsKey | null
  outOfBounds: boolean
  // true khi slot "Ký bước" này vượt quá số bước thật của văn bản đang mở (docId) — ẩn khỏi
  // UI đang thao tác nhưng VẪN được buildKhungPayload() đưa vào khi lưu, để không mất dữ liệu
  // mẫu dùng cho các văn bản khác cần nhiều bước hơn. Xem "Kế hoạch..." mục "Xử lý slot dư".
  hiddenForDoc: boolean
}

// ── Đồng bộ với dữ liệu người ký thật của 1 văn bản cụ thể (chỉ khi mở kèm docId) — KHÔNG
// bao giờ lưu vào EditorRole/gửi lên /api/signing/templates, chỉ dùng để hiển thị preview.
type DocSignerInfo =
  | {
      kind: "ca_nhan"
      userId: string
      fullName: string
      chucVu: string
      chucVuByKey?: { chinh_quyen?: string; kiem_nhiem?: string }
      hasSignature: boolean
      /** Mã phòng ban của bước (nếu có) — vẫn được in dưới chữ ký trên chứng từ thật. */
      deptLabel?: string
    }
  // Chỉ còn với văn bản tạo TRƯỚC 2026-09-05: bước chỉ định phòng ban, chưa gắn người cụ thể.
  | { kind: "phong_ban"; label: string }

// Chỉ lấy đúng field cần dùng từ ThuTuKyStep (documents-types.ts) — không import type đó từ
// module Văn bản để giữ trang này độc lập/dùng chung được cho module khác sau này.
type DocStepLite = {
  type: "phong_ban" | "ca_nhan"
  user_id?: string
  ten?: string
  phong_ban_code?: string
  phong_ban_name?: string
  /** @deprecated Văn bản "Mật" cũ — đọc như user_id để vẫn tra được tên người ký. */
  mat_recipient_user_id?: string
}

/** Người ký đích danh của bước (gộp khoá legacy). null = bước cũ chỉ định theo phòng ban. */
function docStepSignerId(step?: DocStepLite | null): string | null {
  if (!step) return null
  return step.user_id || step.mat_recipient_user_id || null
}

// Lưới căn chỉnh dùng đơn vị PIXEL cố định (không phải % theo mỗi trục) — trang PDF không phải
// hình vuông (tỉ lệ khổ giấy thật), nên % ngang/dọc ứng với số px khác nhau; chỉ px cố định mới
// cho ra ô lưới vuông thật trên màn hình bất kể tỉ lệ khổ giấy.
const GRID_STEP_PX = 8
const SIDEBAR_MIN_WIDTH = 260
const MIN_BOX_PCT = 4

function makeBaseRole(baseId: BaseRoleId, isIso = false, isExempt = false): EditorRole {
  if (isIso && (baseId in ISO_ROLE_DEFS)) {
    const def = ISO_ROLE_DEFS[baseId as IsoSignRoleId]
    return {
      id: baseId,
      baseId,
      label: def.label,
      loai: def.loai,
      batBuoc: isExempt ? false : def.batBuoc,
      isClone: false,
      placed: false,
      anchor: "dau",
      page: 1,
      box: { ...def.defaultBox },
      showName: false,
      showChucVu: false,
      chucVuKey: null,
      signAs: null,
      outOfBounds: false,
      hiddenForDoc: false,
    }
  }
  const def = BASE_ROLE_DEFS[baseId] || BASE_ROLE_DEFS.ky_buoc
  return {
    id: baseId,
    baseId,
    label: def.label,
    loai: def.loai,
    batBuoc: def.batBuoc,
    isClone: false,
    placed: false,
    anchor: "dau",
    page: 1,
    box: { ...def.defaultBox },
    showName: def.showNameDefault,
    showChucVu: def.showNameDefault,
    chucVuKey: def.showNameDefault ? "chinh_quyen" : null,
    signAs: null,
    outOfBounds: false,
    hiddenForDoc: false,
  }
}

// Tách riêng từ duplicateRole() để dùng chung cho cả nhân bản thủ công lẫn tự "pad" thêm slot
// khớp số bước thật của văn bản (xem reconcileForDoc bên dưới).
function makeCloneRole(baseId: BaseRoleId, n: number, sourceBox: PctBox, isIso = false): EditorRole {
  if (isIso && (baseId in ISO_ROLE_DEFS)) {
    const def = ISO_ROLE_DEFS[baseId as IsoSignRoleId]
    return {
      id: `${baseId}__ban${n}`,
      baseId,
      label: `${def.label} · bản ${n}`,
      loai: def.loai,
      batBuoc: false,
      isClone: true,
      placed: false,
      anchor: "dau",
      page: 1,
      box: { ...sourceBox },
      showName: false,
      showChucVu: false,
      chucVuKey: null,
      signAs: null,
      outOfBounds: false,
      hiddenForDoc: false,
    }
  }
  const def = BASE_ROLE_DEFS[baseId] || BASE_ROLE_DEFS.ky_buoc
  return {
    id: `${baseId}__ban${n}`,
    baseId,
    label: `${def.label} · bản ${n}`,
    loai: def.loai,
    batBuoc: false,
    isClone: true,
    placed: false,
    anchor: "dau",
    page: 1,
    box: { ...sourceBox },
    showName: def.showNameDefault,
    showChucVu: def.showNameDefault,
    chucVuKey: def.showNameDefault ? "chinh_quyen" : null,
    signAs: null,
    outOfBounds: false,
    hiddenForDoc: false,
  }
}

// base role -> 1; "xxx__ban2" -> 2; dùng để sắp thứ tự ổn định + map 1-1 với thu_tu_ky_json.
function roleCloneIndex(role: EditorRole): number {
  if (!role.isClone) return 1
  const m = /__ban(\d+)$/.exec(role.id)
  return m ? parseInt(m[1], 10) : 2
}

// Chỉ đa sắc cho các slot nhân bản của "ky_buoc" (nhiều người cùng ký 1 bước) — các vai trò khác
// giữ nguyên đúng 1 màu cố định trong ROLE_COLORS kể cả khi bị nhân bản.
function getRoleColor(role: EditorRole, isIso = false): { fg: string; bg: string } {
  if (isIso && (role.baseId in ISO_ROLE_COLORS)) {
    return ISO_ROLE_COLORS[role.baseId as IsoSignRoleId]
  }
  if (role.baseId !== "ky_buoc") return ROLE_COLORS[role.baseId] ?? { fg: "#059669", bg: "rgba(5,150,105,.14)" }
  const idx = (roleCloneIndex(role) - 1) % KY_BUOC_CLONE_PALETTE.length
  return KY_BUOC_CLONE_PALETTE[idx]
}

// Tự "pad" đủ số slot "Ký bước" khớp N = số bước thật (thu_tu_ky_json.length) của văn bản
// đang mở, và đánh dấu ẩn (hiddenForDoc) các slot dư nếu mẫu đã lưu có nhiều slot hơn N —
// KHÔNG xoá slot dư, chỉ ẩn khỏi UI (buildKhungPayload() vẫn đưa chúng vào khi lưu).
function reconcileForDoc(
  prevRoles: EditorRole[],
  docSteps: DocStepLite[],
  cloneSeqRef: { current: Record<string, number> },
): EditorRole[] {
  const N = docSteps.length
  const kyBuocFamily = prevRoles
    .filter((r) => r.baseId === "ky_buoc")
    .slice()
    .sort((a, b) => roleCloneIndex(a) - roleCloneIndex(b))
    .map((r) => ({ ...r, hiddenForDoc: false }))
  const others = prevRoles.filter((r) => r.baseId !== "ky_buoc")
  const sourceBox = kyBuocFamily[0]?.box ?? BASE_ROLE_DEFS.ky_buoc.defaultBox
  while (kyBuocFamily.length < N) {
    cloneSeqRef.current.ky_buoc = (cloneSeqRef.current.ky_buoc || 1) + 1
    kyBuocFamily.push(makeCloneRole("ky_buoc", cloneSeqRef.current.ky_buoc, sourceBox))
  }
  const finalFamily = kyBuocFamily.map((r, idx) => ({ ...r, hiddenForDoc: idx >= N }))
  return [...finalFamily, ...others]
}

// % tương ứng GRID_STEP_PX theo 1 trục cụ thể — trục ngang/dọc có tỉ lệ px/% khác nhau khi
// container không vuông, nên phải tính riêng cho từng trục tại thời điểm kéo/resize (dùng
// rectW/rectH đo thật lúc bắt đầu thao tác), không dùng 1 hằng số % chung cho cả 2 trục.
function pctStepFor(axisPx: number): number {
  return axisPx > 0 ? (GRID_STEP_PX / axisPx) * 100 : 0
}
function snap(v: number, active: boolean, stepPct: number): number {
  return active && stepPct > 0 ? Math.round(v / stepPct) * stepPct : v
}

export default function SignTemplateEditorPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const paramLoai = searchParams.get("loai") || searchParams.get("loaiTaiLieu") || ""
  const modun = searchParams.get("modun") || (paramLoai.startsWith("iso:") ? "iso" : "van_ban")
  const isIso = modun === "iso"
  const paramPdfUrl = searchParams.get("pdfUrl") || ""
  const paramDocLabel = searchParams.get("docLabel") || paramLoai
  const returnTo = searchParams.get("returnTo") || ""
  const docId = searchParams.get("docId") || ""

  const [activePdfUrl, setActivePdfUrl] = useState<string>(paramPdfUrl)
  const [activeLoai, setActiveLoai] = useState<string>(paramLoai)
  const [activeDocLabel, setActiveDocLabel] = useState<string>(paramDocLabel)
  const [activeDocId, setActiveDocId] = useState<string>(docId)
  const [isoChildDocs, setIsoChildDocs] = useState<
    Array<{ id: string; ma_tai_lieu: string | null; ten_tai_lieu: string | null; loai_tai_lieu: string | null; url: string }>
  >([])
  const [docTemplateStatus, setDocTemplateStatus] = useState<Record<string, boolean>>({})
  const [isoDocData, setIsoDocData] = useState<{
    id: string
    ma_tai_lieu: string | null
    ten_tai_lieu: string | null
    loai_tai_lieu: string | null
    cap_tl: string | null
    phan_loai_tl: string | null
    soan_thao_user_id: string | null
    xem_xet_user_id: string | null
    phe_duyet_user_id: string | null
    soan_thao: string | null
    xem_xet: string | null
    phe_duyet: string | null
    file_signed_pdf_url: string | null
    file_goc_url: string | null
  } | null>(null)

  // Kiểm tra tài liệu hiện tại có được miễn trừ quy tắc ký đủ 3 khung (Biểu mẫu F, Phụ lục HD/PL, hồ sơ con)
  const isExemptIsoDoc = useMemo(() => {
    if (!isIso) return false
    // 1. Đang chọn tài liệu con trong bộ hồ sơ (activeDocId khác docId chính)
    if (activeDocId && docId && activeDocId !== docId) return true
    // 2. Hoặc activeDocId nằm trong danh sách hồ sơ con
    if (isoChildDocs.some((c) => c.id === activeDocId)) return true
    // 3. Hoặc dữ liệu tài liệu chính nhưng có phan_loai_tl là "con"
    if (isoDocData && activeDocId === docId && isoDocData.phan_loai_tl === "con") return true
    // 4. Kiểm tra loại tài liệu (F = Biểu mẫu, HD/PL = Hướng dẫn/Phụ lục)
    const loai = (activeLoai || "").toUpperCase().trim().replace(/^ISO:(LOAI|CODE):/, "")
    if (loai === "F" || loai === "HD" || loai === "PL") return true
    if (/-F\d+/i.test(loai) || /-HD\d+/i.test(loai) || /-PL\d+/i.test(loai)) return true
    // 5. Kiểm tra thông tin của child doc hiện tại
    const currentChild = isoChildDocs.find((c) => c.id === activeDocId)
    if (currentChild) {
      const cLoai = (currentChild.loai_tai_lieu || "").toUpperCase().trim()
      if (cLoai === "F" || cLoai === "HD" || cLoai === "PL") return true
      if (currentChild.ma_tai_lieu && (/-F\d+/i.test(currentChild.ma_tai_lieu) || /-HD\d+/i.test(currentChild.ma_tai_lieu) || /-PL\d+/i.test(currentChild.ma_tai_lieu))) return true
    }
    return false
  }, [isIso, activeDocId, docId, isoChildDocs, isoDocData, activeLoai])

  const [me, setMe] = useState<SessionUser | null>(null)
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [numPages, setNumPages] = useState(0)
  const [pageDims, setPageDims] = useState<Record<number, { w: number; h: number }>>({})
  const [pageImages, setPageImages] = useState<Record<number, string>>({})
  const [currentPage, setCurrentPage] = useState(1)

  const [roles, setRoles] = useState<EditorRole[]>(() => {
    const order = isIso ? ISO_ROLE_ORDER : ROLE_ORDER
    return order.map((id) => makeBaseRole(id as BaseRoleId, isIso))
  })
  const [initialSnapshot, setInitialSnapshot] = useState<string>("")
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)
  const [armedRoleId, setArmedRoleId] = useState<string | null>(null)
  const [armedAnchor, setArmedAnchor] = useState<SignTemplateAnchor>("dau")
  const [gridVisible, setGridVisible] = useState(false)
  const [previewMode, setPreviewMode] = useState(false)
  const [templateExisted, setTemplateExisted] = useState(false)
  const [templateLoaded, setTemplateLoaded] = useState(false)
  const [pendingAnchorByRole, setPendingAnchorByRole] = useState<Record<string, SignTemplateAnchor>>({})
  const [sidebarWidth, setSidebarWidth] = useState(320)
  const [showMobileSidebar, setShowMobileSidebar] = useState(false)
  const [showMobilePagePicker, setShowMobilePagePicker] = useState(false)

  // ── Đồng bộ dữ liệu người ký thật của văn bản đang mở (chỉ khi có docId) ──
  const [docLoaded, setDocLoaded] = useState(!docId)
  const [docFetchOk, setDocFetchOk] = useState(!docId)
  const [docSteps, setDocSteps] = useState<DocStepLite[]>([])
  const [docPheDuyetUserId, setDocPheDuyetUserId] = useState<string | null>(null)
  const [signerInfoById, setSignerInfoById] = useState<
    Record<string, { fullName: string; chucVu: string; hasSignature: boolean; chucVuByKey?: { chinh_quyen?: string; kiem_nhiem?: string } }>
  >({})
  const reconciledRef = useRef(false)

  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState("")

  const cloneSeqRef = useRef<Record<string, number>>({})
  const pageWrapRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ id: string; startX: number; startY: number; startLeft: number; startTop: number; rectW: number; rectH: number } | null>(null)
  const resizeRef = useRef<{ id: string; startX: number; startY: number; startW: number; startH: number; left: number; top: number; rectW: number; rectH: number } | null>(null)
  const sidebarDragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const nudgeRole = (roleId: string, dxSteps: number, dySteps: number) => {
    const wrap = pageWrapRef.current
    const rect = wrap?.getBoundingClientRect()
    const stepXPct = rect && rect.width > 0 ? (GRID_STEP_PX / rect.width) * 100 : 1
    const stepYPct = rect && rect.height > 0 ? (GRID_STEP_PX / rect.height) * 100 : 1
    setRoles((prev) => {
      const next = prev.map((r) => {
        if (r.id !== roleId) return r
        const newX = Math.max(-20, Math.min(120 - r.box.wPct, r.box.xPct + dxSteps * stepXPct))
        const newY = Math.max(-20, Math.min(120 - r.box.hPct, r.box.yPct + dySteps * stepYPct))
        return { ...r, box: { ...r.box, xPct: newX, yPct: newY } }
      })
      return recomputeBounds(next)
    })
  }

  // ── Bootstrap phiên + tham số bắt buộc ──
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!activeLoai || !activePdfUrl) {
        if (!docId) {
          setError("Thiếu tham số loại tài liệu hoặc file tham chiếu — không thể mở màn cài đặt vị trí ký.")
          setLoading(false)
          return
        }
      }
      const fid = await getActiveFactoryId()
      const { user } = await hydrateActiveSession()
      if (cancelled) return
      if (!fid || !user) {
        setError("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.")
        setLoading(false)
        return
      }
      setFactoryId(fid)
      setMe(user)
    }
    void run()
    return () => { cancelled = true }
  }, [activeLoai, activePdfUrl, docId])

  // ── Render PDF tham chiếu thành ảnh (mirror ky/[id]/page.tsx) ──
  useEffect(() => {
    if (!activePdfUrl) return
    let cancelled = false
    const run = async () => {
      try {
        setNumPages(0)
        setPageDims({})
        setPageImages({})
        setCurrentPage(1)
        const pdfjsLib = await import("pdfjs-dist")
        if ((globalThis as Record<string, unknown>).pdfjsWorker) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = ""
        } else {
          pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
            "pdfjs-dist/build/pdf.worker.mjs",
            import.meta.url,
          ).toString()
        }
        const pdf = await pdfjsLib.getDocument(activePdfUrl).promise
        if (cancelled) return
        setNumPages(pdf.numPages)
        const dims: Record<number, { w: number; h: number }> = {}
        const images: Record<number, string> = {}
        const scale = 2
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p)
          const dimVp = page.getViewport({ scale: 1 })
          dims[p] = { w: dimVp.width, h: dimVp.height }
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement("canvas")
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          const ctx = canvas.getContext("2d")
          if (ctx) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await page.render({ canvasContext: ctx, viewport } as any).promise
            images[p] = canvas.toDataURL("image/png")
          }
        }
        if (cancelled) return
        setPageDims(dims)
        setPageImages(images)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Lỗi đọc file PDF tham chiếu")
          setLoading(false)
        }
      }
    }
    void run()
    return () => { cancelled = true }
  }, [activePdfUrl])

  // ── Nạp mẫu vị trí đã lưu (nếu có), quy đổi pt -> % theo đúng trang của từng khung ──
  const boxPctFromTemplate = useCallback(
    (box: SignTemplateBox, dims: Record<number, { w: number; h: number }>, total: number) => {
      const page =
        box.neo_trang === "cuoi" ? (box.so_trang === 0 ? total || 1 : box.so_trang)
        : box.neo_trang === "moi_trang" ? 1
        : Math.min(Math.max(box.so_trang, 1), total || box.so_trang)
      const dim = dims[page]
      if (!dim) return null
      return {
        page,
        pct: {
          xPct: (box.x_pt / dim.w) * 100,
          yPct: ((dim.h - box.y_pt - box.h_pt) / dim.h) * 100,
          wPct: (box.w_pt / dim.w) * 100,
          hPct: (box.h_pt / dim.h) * 100,
        },
      }
    },
    [],
  )

  useEffect(() => {
    if (!factoryId || !activeLoai || numPages === 0 || Object.keys(pageDims).length === 0) return
    let cancelled = false
    const run = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const token = sessionData.session?.access_token || ""
        const keyToLoad = isIso ? formatIsoTemplateKey(activeLoai) : activeLoai
        const childObj = isIso && isoChildDocs.length > 0 ? isoChildDocs.find((c) => c.id === activeDocId) : null
        const fallbackLoai = childObj?.loai_tai_lieu ? formatIsoTemplateKey(childObj.loai_tai_lieu) : undefined
        const fallbackQuery = fallbackLoai && fallbackLoai !== keyToLoad ? `&fallbackLoai=${encodeURIComponent(fallbackLoai)}` : ""
        const res = await fetch(
          `/api/signing/templates?factoryId=${factoryId}&loaiTaiLieu=${encodeURIComponent(keyToLoad)}${isIso ? "&modun=iso" : ""}${fallbackQuery}`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
        const json = (await res.json()) as { template?: { khung: SignTemplateBox[] } | null; error?: string }
        if (cancelled) return
        if (!res.ok) throw new Error(json.error || "Không tải được mẫu vị trí")
        const template = json.template
        const roleOrder = isIso ? ISO_ROLE_ORDER : ROLE_ORDER
        const roleDefs = isIso
          ? (ISO_ROLE_DEFS as unknown as Record<
              string,
              {
                label: string
                loai: SignTemplateBoxLoai
                batBuoc: boolean
                showNameDefault: boolean
                showChucVuDefault: boolean
                defaultBox: { xPct: number; yPct: number; wPct: number; hPct: number }
              }
            >)
          : BASE_ROLE_DEFS

        if (!template) {
          setTemplateExisted(false)
          const fresh = roleOrder.map((id) => makeBaseRole(id as BaseRoleId, isIso, isExemptIsoDoc))
          setRoles(fresh)
          setInitialSnapshot(JSON.stringify(fresh))
          setLoading(false)
          setTemplateLoaded(true)
          return
        }
        setTemplateExisted(true)
        if (!template.khung.length) {
          const fresh = roleOrder.map((id) => makeBaseRole(id as BaseRoleId, isIso, isExemptIsoDoc))
          setRoles(fresh)
          setInitialSnapshot(JSON.stringify(fresh))
          setLoading(false)
          setTemplateLoaded(true)
          return
        }
        const byBase = new Map<string, EditorRole[]>()
        const seq: Record<string, number> = {}
        for (const box of template.khung) {
          const resolved = boxPctFromTemplate(box, pageDims, numPages)
          if (!resolved) continue
          const baseId = (box.clone_of || box.vai_tro) as BaseRoleId
          const def = roleDefs[baseId]
          if (!def) continue
          const isClone = !!box.clone_of
          if (isClone) seq[baseId] = (seq[baseId] || 1) + 1
          const role: EditorRole = {
            id: box.vai_tro,
            baseId,
            label: isClone ? `${def.label} · bản ${seq[baseId]}` : def.label,
            loai: box.loai,
            batBuoc: !isClone && (isExemptIsoDoc ? false : def.batBuoc),
            isClone,
            placed: true,
            anchor: box.neo_trang,
            page: resolved.page,
            box: resolved.pct,
            showName: box.show_name ?? def.showNameDefault,
            showChucVu: box.show_chuc_vu ?? (isIso ? false : (box.show_name ?? def.showNameDefault)),
            chucVuKey: box.chuc_vu_key ?? null,
            signAs: box.sign_as ?? null,
            outOfBounds: false,
            hiddenForDoc: false,
          }
          const list = byBase.get(baseId) || []
          list.push(role)
          byBase.set(baseId, list)
        }
        cloneSeqRef.current = seq
        const result: EditorRole[] = []
        for (const baseId of roleOrder) {
          const placedForBase = byBase.get(baseId) || []
          if (placedForBase.length === 0) {
            result.push(makeBaseRole(baseId as BaseRoleId, isIso, isExemptIsoDoc))
          } else {
            const hasOriginal = placedForBase.some((r) => r.id === baseId)
            if (!hasOriginal) result.push(makeBaseRole(baseId as BaseRoleId, isIso, isExemptIsoDoc))
            result.push(...placedForBase)
          }
        }
        setRoles(result)
        setInitialSnapshot(JSON.stringify(result))
      } catch (err) {
        setError(err instanceof Error ? err.message : "Lỗi tải mẫu vị trí")
      } finally {
        setLoading(false)
        setTemplateLoaded(true)
      }
    }
    void run()
    return () => { cancelled = true }
  }, [factoryId, activeLoai, numPages, pageDims, boxPctFromTemplate, isIso, isExemptIsoDoc, activeDocId, isoChildDocs])

  // ── Nạp dữ liệu người ký thật của văn bản đang mở (chỉ khi có docId) ──
  useEffect(() => {
    if (!docId || !factoryId) return
    let cancelled = false
    const run = async () => {
      try {
        if (isIso) {
          const { data, error: fetchErr } = await supabase
            .from("iso_documents")
            .select("id, ma_tai_lieu, ten_tai_lieu, loai_tai_lieu, cap_tl, phan_loai_tl, soan_thao_user_id, xem_xet_user_id, phe_duyet_user_id, soan_thao, xem_xet, phe_duyet, file_signed_pdf_url, file_goc_url")
            .eq("id", docId)
            .eq("factory_id", factoryId)
            .single()
          if (cancelled) return
          if (fetchErr || !data) {
            setDocFetchOk(false)
            setDocLoaded(true)
            return
          }
          setIsoDocData(data)
          const pdfToLoad = data.file_signed_pdf_url || data.file_goc_url || ""
          if (pdfToLoad) setActivePdfUrl((prev) => prev || pdfToLoad)
          if (data.loai_tai_lieu) setActiveLoai((prev) => prev || data.loai_tai_lieu || "")
          const defaultLabel = data.ma_tai_lieu ? `${data.ma_tai_lieu} · ${data.ten_tai_lieu || ""}` : (data.ten_tai_lieu || data.loai_tai_lieu || "")
          if (defaultLabel) setActiveDocLabel((prev) => prev || defaultLabel)

          // Nạp các hồ sơ con nếu đây là tài liệu cha
          if (data.phan_loai_tl !== "con") {
            const { data: children } = await supabase
              .from("iso_documents")
              .select("id, ma_tai_lieu, ten_tai_lieu, loai_tai_lieu, phan_loai_tl, file_signed_pdf_url, file_goc_url")
              .eq("factory_id", factoryId)
              .eq("parent_doc_id", docId)
              .order("ma_tai_lieu")
            if (!cancelled && children) {
              const validChildren = children
                .filter((c) => !!(c.file_signed_pdf_url || c.file_goc_url))
                .map((c) => ({
                  id: c.id,
                  ma_tai_lieu: c.ma_tai_lieu,
                  ten_tai_lieu: c.ten_tai_lieu,
                  loai_tai_lieu: c.loai_tai_lieu,
                  url: (c.file_signed_pdf_url || c.file_goc_url) as string,
                }))
              setIsoChildDocs(validChildren)
            }

            // Kiểm tra trạng thái mẫu đã lưu cho toàn bộ bộ tài liệu
            const { data: tmplRows } = await supabase
              .from("mau_vi_tri")
              .select("loai_tai_lieu")
              .eq("factory_id", factoryId)
              .like("loai_tai_lieu", "iso:%")
            if (!cancelled) {
              const tmplKeySet = new Set((tmplRows || []).map((t) => t.loai_tai_lieu))
              const checkHasTmpl = (item: { ma_tai_lieu: string | null; loai_tai_lieu: string | null }) => {
                if (item.ma_tai_lieu && tmplKeySet.has(`iso:code:${item.ma_tai_lieu}`)) return true
                if (item.loai_tai_lieu && tmplKeySet.has(`iso:loai:${item.loai_tai_lieu}`)) return true
                return false
              }
              const statusMap: Record<string, boolean> = {
                [data.id]: checkHasTmpl(data),
              }
              if (children) {
                children.forEach((c) => {
                  statusMap[c.id] = checkHasTmpl(c)
                })
              }
              setDocTemplateStatus(statusMap)
            }
          }

          setDocFetchOk(true)
          setDocLoaded(true)
          return
        }

        // Văn bản query
        const { data, error: fetchErr } = await supabase
          .from("van_ban_documents")
          .select("thu_tu_ky_json, phe_duyet_user_id")
          .eq("id", docId)
          .eq("factory_id", factoryId)
          .single()
        if (cancelled) return
        if (fetchErr || !data) {
          setDocFetchOk(false)
          setDocLoaded(true)
          return
        }
        setDocSteps(((data.thu_tu_ky_json as DocStepLite[] | null) || []))
        setDocPheDuyetUserId((data.phe_duyet_user_id as string | null) || null)
        setDocFetchOk(true)
        setDocLoaded(true)
      } catch {
        if (!cancelled) {
          setDocFetchOk(false)
          setDocLoaded(true)
        }
      }
    }
    void run()
    return () => { cancelled = true }
  }, [docId, factoryId, isIso])

  // ── Tra tên/chức vụ thật + xác nhận có ảnh chữ ký cho các user đã chọn ở màn soạn thảo ──
  useEffect(() => {
    if (!docLoaded || !docFetchOk || !factoryId) return
    let ids: string[] = []
    if (isIso) {
      if (!isoDocData) return
      ids = [
        isoDocData.soan_thao_user_id,
        isoDocData.cap_tl === "Cấp 2" ? null : isoDocData.xem_xet_user_id,
        isoDocData.phe_duyet_user_id,
      ].filter((id): id is string => !!id)
    } else {
      ids = Array.from(
        new Set([
          ...docSteps.map((s) => docStepSignerId(s)).filter((id): id is string => !!id),
          ...(docPheDuyetUserId ? [docPheDuyetUserId] : []),
        ]),
      )
    }
    if (ids.length === 0) return
    let cancelled = false
    const run = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const token = sessionData.session?.access_token || ""
        const res = await fetch(
          `/api/documents/signer-info?factoryId=${factoryId}&userIds=${ids.join(",")}`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
        if (cancelled || !res.ok) return
        const json = (await res.json()) as Array<{
          id: string
          full_name: string
          chuc_vu: string
          has_signature: boolean
          chuc_vu_by_key?: { chinh_quyen?: string; kiem_nhiem?: string }
        }>
        const map: Record<string, {
          fullName: string
          chucVu: string
          hasSignature: boolean
          chucVuByKey?: { chinh_quyen?: string; kiem_nhiem?: string }
        }> = {}
        for (const r of json) {
          map[r.id] = {
            fullName: r.full_name,
            chucVu: r.chuc_vu,
            hasSignature: r.has_signature,
            chucVuByKey: r.chuc_vu_by_key,
          }
        }
        if (!cancelled) setSignerInfoById(map)
      } catch {
        // Lỗi tra chức vụ/ảnh chữ ký không chặn luồng — preview chỉ đơn giản thiếu dữ liệu
        // thật, fallback về placeholder như khi không có docId.
      }
    }
    void run()
    return () => { cancelled = true }
  }, [docLoaded, docFetchOk, docSteps, docPheDuyetUserId, factoryId, isIso, isoDocData])

  // ── Đối chiếu số slot "Ký bước" khớp N bước thật của văn bản — chạy đúng 1 lần sau khi cả
  // mẫu (templateLoaded) lẫn văn bản (docLoaded) đã sẵn sàng. Không cần re-run khi roles đổi
  // sau đó (reconciledRef chặn) — chỉ đối chiếu 1 lần ngay lúc mở màn.
  useEffect(() => {
    if (!templateLoaded || !docLoaded || reconciledRef.current) return
    reconciledRef.current = true
    if (!docId || !docFetchOk) return
    if (isIso) {
      if (isoDocData?.cap_tl === "Cấp 2") {
        setRoles((prev) => prev.map((r) => r.baseId === "xem_xet" ? { ...r, hiddenForDoc: true } : r))
      }
      return
    }
    const result = reconcileForDoc(roles, docSteps, cloneSeqRef)
    setRoles(result)
    setInitialSnapshot(JSON.stringify(result))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateLoaded, docLoaded, docId, docFetchOk, docSteps, isIso, isoDocData])

  const handleSwitchIsoDoc = async (
    targetDocId: string,
    targetUrl: string,
    targetLoai: string,
    targetLabel: string,
  ) => {
    if (targetDocId === activeDocId) return

    // Tự động lưu tài liệu hiện tại nếu có thay đổi HOẶC tài liệu con chưa có mẫu
    if ((dirty || (!templateExisted && isExemptIsoDoc)) && factoryId && me) {
      const placedBoxes = buildKhungPayload()
      if (placedBoxes.length > 0 || isExemptIsoDoc) {
        try {
          const { data: sessionData } = await supabase.auth.getSession()
          const token = sessionData.session?.access_token || ""
          const keyToSave = isIso ? formatIsoTemplateKey(activeLoai) : activeLoai
          const res = await fetch("/api/signing/templates", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              factoryId,
              loaiTaiLieu: keyToSave,
              khung: placedBoxes,
              modun: isIso ? "iso" : "van_ban",
              allowEmpty: isExemptIsoDoc,
            }),
          })
          if (res.ok) {
            setDocTemplateStatus((prev) => ({ ...prev, [activeDocId]: true }))
            showToast(`Đã tự động lưu vị trí cho ${activeDocLabel}`)
          }
        } catch {
          // ignore auto-save error non-blocking
        }
      }
    }

    setActiveDocId(targetDocId)
    setActivePdfUrl(targetUrl)
    setActiveLoai(targetLoai)
    setActiveDocLabel(targetLabel)
    setTemplateLoaded(false)
    const roleOrder = isIso ? ISO_ROLE_ORDER : ROLE_ORDER
    const targetIsExempt = isIso && (
      targetDocId !== docId ||
      isoChildDocs.some((c) => c.id === targetDocId) ||
      ["F", "HD", "PL"].includes(targetLoai.toUpperCase().trim().replace(/^ISO:(LOAI|CODE):/, "")) ||
      /-F\d+/i.test(targetLoai) || /-HD\d+/i.test(targetLoai) || /-PL\d+/i.test(targetLoai)
    )
    setRoles(roleOrder.map((id) => makeBaseRole(id as BaseRoleId, isIso, targetIsExempt)))
    setSelectedRoleId(null)
    setArmedRoleId(null)
  }

  const dirty = useMemo(() => {
    if (!initialSnapshot) return false
    return JSON.stringify(roles) !== initialSnapshot
  }, [roles, initialSnapshot])

  const rolesOnPage = useMemo(
    () => roles.filter((r) => r.placed && !r.hiddenForDoc && (r.anchor === "moi_trang" || r.page === currentPage)),
    [roles, currentPage],
  )

  // Người/phòng ban thật đã chọn ở màn soạn thảo (new/page.tsx) cho đúng văn bản đang mở —
  // chỉ dùng để hiển thị preview, KHÔNG bao giờ lưu vào mau_vi_tri (xem DocSignerInfo).
  const docSignerByRoleId = useMemo(() => {
    const map: Record<string, DocSignerInfo> = {}
    if (!docId) return map

    if (isIso) {
      if (isoDocData?.soan_thao_user_id) {
        const info = signerInfoById[isoDocData.soan_thao_user_id]
        map["soan_thao"] = {
          kind: "ca_nhan",
          userId: isoDocData.soan_thao_user_id,
          fullName: info?.fullName || isoDocData.soan_thao || "",
          chucVu: info?.chucVu || "",
          chucVuByKey: info?.chucVuByKey,
          hasSignature: info?.hasSignature ?? true,
        }
      }
      if (isoDocData?.xem_xet_user_id && isoDocData.cap_tl !== "Cấp 2") {
        const info = signerInfoById[isoDocData.xem_xet_user_id]
        map["xem_xet"] = {
          kind: "ca_nhan",
          userId: isoDocData.xem_xet_user_id,
          fullName: info?.fullName || isoDocData.xem_xet || "",
          chucVu: info?.chucVu || "",
          chucVuByKey: info?.chucVuByKey,
          hasSignature: info?.hasSignature ?? true,
        }
      }
      if (isoDocData?.phe_duyet_user_id) {
        const info = signerInfoById[isoDocData.phe_duyet_user_id]
        map["phe_duyet"] = {
          kind: "ca_nhan",
          userId: isoDocData.phe_duyet_user_id,
          fullName: info?.fullName || isoDocData.phe_duyet || "",
          chucVu: info?.chucVu || "",
          chucVuByKey: info?.chucVuByKey,
          hasSignature: info?.hasSignature ?? true,
        }
      }
      return map
    }

    const kyBuocFamily = roles
      .filter((r) => r.baseId === "ky_buoc" && !r.hiddenForDoc)
      .slice()
      .sort((a, b) => roleCloneIndex(a) - roleCloneIndex(b))
    docSteps.forEach((step, idx) => {
      const role = kyBuocFamily[idx]
      if (!role) return
      const signerId = docStepSignerId(step)
      if (signerId) {
        const info = signerInfoById[signerId]
        map[role.id] = {
          kind: "ca_nhan",
          userId: signerId,
          fullName: info?.fullName || step.ten || "",
          chucVu: info?.chucVu || "",
          chucVuByKey: info?.chucVuByKey,
          hasSignature: info?.hasSignature || false,
          deptLabel: step.phong_ban_name || step.phong_ban_code || undefined,
        }
      } else if (step.type === "phong_ban") {
        // Văn bản cũ (trước 2026-09-05) — chưa gắn người, người ký thật xác định lúc ký.
        map[role.id] = { kind: "phong_ban", label: step.phong_ban_name || step.phong_ban_code || "" }
      }
    })
    const pheDuyetRole = roles.find((r) => r.baseId === "phe_duyet")
    if (pheDuyetRole && docPheDuyetUserId) {
      const info = signerInfoById[docPheDuyetUserId]
      map[pheDuyetRole.id] = {
        kind: "ca_nhan",
        userId: docPheDuyetUserId,
        fullName: info?.fullName || "",
        chucVu: info?.chucVu || "",
        chucVuByKey: info?.chucVuByKey,
        hasSignature: info?.hasSignature || false,
      }
    }
    return map
  }, [docId, docSteps, docPheDuyetUserId, signerInfoById, roles, isIso, isoDocData])

  // Bắt buộc đặt khung khi: (a) vai trò bắt buộc ở cấp MẪU (batBuoc, lưu vào mau_vi_tri),
  // HOẶC (b) đang mở đúng 1 văn bản thật (docId) và vai trò này đại diện 1 người ký thật
  // (docSignerByRoleId) — kể cả slot "Ký bước" tự pad thêm bởi reconcileForDoc() luôn có
  // batBuoc=false nhưng vẫn đại diện người ký thật, không được bỏ sót ở đây.
  // ĐẶC BIỆT: Biểu mẫu (F) và Phụ lục (HD, PL) trong ISO không áp dụng quy tắc ký đủ 3 khung bắt buộc.
  const isRequiredForConfirm = useCallback(
    (role: EditorRole) => {
      if (isExemptIsoDoc) return false
      return role.batBuoc || (!!docId && !!docSignerByRoleId[role.id])
    },
    [isExemptIsoDoc, docId, docSignerByRoleId],
  )
  const missingRequired = useMemo(
    () => roles.filter((r) => isRequiredForConfirm(r) && !r.placed && !r.hiddenForDoc),
    [roles, isRequiredForConfirm],
  )
  const outOfBoundsRoles = useMemo(
    () => roles.filter((r) => r.placed && !r.hiddenForDoc && r.outOfBounds),
    [roles],
  )

  // ── Cập nhật trạng thái ngoài-khổ-giấy ──
  const recomputeBounds = useCallback((list: EditorRole[]) => {
    return list.map((r) => ({
      ...r,
      outOfBounds: r.box.xPct < 0 || r.box.yPct < 0 || r.box.xPct + r.box.wPct > 100 || r.box.yPct + r.box.hPct > 100,
    }))
  }, [])

  useEffect(() => {
    setRoles((prev) => recomputeBounds(prev))
    // chỉ cần chạy lại khi số lượng box thay đổi hình dạng — theo dõi qua roles.length là đủ
    // vì mọi thay đổi vị trí đã tự gọi recomputeBounds tại chỗ trong handler tương ứng.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles.length])

  const goToPage = (p: number) => {
    setCurrentPage(Math.min(Math.max(p, 1), numPages || 1))
  }

  const armRole = (roleId: string, anchor: SignTemplateAnchor) => {
    setArmedRoleId(roleId)
    setArmedAnchor(anchor)
    if (anchor === "cuoi") goToPage(numPages || 1)
    if (!gridVisible) setGridVisible(true)
  }
  const cancelArm = () => setArmedRoleId(null)

  /**
   * Đổi neo trang cho khung ĐÃ ĐẶT — trước đây dropdown chỉ hiện ở nhánh chưa đặt, muốn đổi
   * neo phải xoá khung rồi đặt lại từ đầu.
   *
   * `page` được nắn theo neo mới để round-trip lưu → nạp lại giữ nguyên vị trí: `buildKhungPayload`
   * quy đổi %→pt bằng `pageDims[r.page]`, còn `boxPctFromTemplate` khi nạp lại sẽ hiểu
   * `cuoi` = trang cuối, `moi_trang` = trang 1. Lệch trang ở đây sẽ lệch toạ độ nếu các trang
   * không cùng khổ giấy.
   */
  const changeRoleAnchor = (roleId: string, anchor: SignTemplateAnchor) => {
    setRoles((prev) =>
      prev.map((r) => {
        if (r.id !== roleId) return r
        const page = anchor === "cuoi" ? numPages || 1 : anchor === "moi_trang" ? 1 : r.page
        return { ...r, anchor, page }
      }),
    )
    if (anchor === "cuoi") goToPage(numPages || 1)
    if (anchor === "moi_trang") goToPage(1)
  }

  const handlePageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!armedRoleId) return
    if ((e.target as HTMLElement).closest("[data-rolebox]")) return
    const wrap = pageWrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const xPct = ((e.clientX - rect.left) / rect.width) * 100
    const yPct = ((e.clientY - rect.top) / rect.height) * 100
    setRoles((prev) => {
      const next = prev.map((r) => {
        if (r.id !== armedRoleId) return r
        const w = r.box.wPct
        const h = r.box.hPct
        return {
          ...r,
          placed: true,
          anchor: armedAnchor,
          page: armedAnchor === "cuoi" ? (numPages || 1) : currentPage,
          box: {
            xPct: Math.max(0, Math.min(100 - w, xPct - w / 2)),
            yPct: Math.max(0, Math.min(100 - h, yPct - h / 2)),
            wPct: w,
            hPct: h,
          },
        }
      })
      return recomputeBounds(next)
    })
    setSelectedRoleId(armedRoleId)
    cancelArm()
  }

  const removeRole = (roleId: string) => {
    setRoles((prev) => {
      const role = prev.find((r) => r.id === roleId)
      if (!role) return prev
      if (role.isClone) return prev.filter((r) => r.id !== roleId)
      return prev.map((r) => (r.id === roleId ? { ...makeBaseRole(role.baseId) } : r))
    })
    if (selectedRoleId === roleId) setSelectedRoleId(null)
  }

  const duplicateRole = (roleId: string) => {
    const original = roles.find((r) => r.id === roleId)
    if (!original) return
    const baseId = original.baseId
    cloneSeqRef.current[baseId] = (cloneSeqRef.current[baseId] || 1) + 1
    const n = cloneSeqRef.current[baseId]
    const clone: EditorRole = {
      ...makeCloneRole(baseId, n, original.box),
      page: currentPage,
      showName: original.showName,
      showChucVu: original.showChucVu,
      chucVuKey: original.chucVuKey,
    }
    setRoles((prev) => [...prev, clone])
    armRole(clone.id, "dau")
  }

  const toggleShowName = (roleId: string) => {
    setRoles((prev) => prev.map((r) => (r.id === roleId ? { ...r, showName: !r.showName } : r)))
  }

  const toggleShowChucVu = (roleId: string) => {
    setRoles((prev) => prev.map((r) => (r.id === roleId ? { ...r, showChucVu: !r.showChucVu } : r)))
  }
  const setChucVu = (roleId: string, key: ChucVuKey) => {
    setRoles((prev) => prev.map((r) => (r.id === roleId ? { ...r, chucVuKey: key } : r)))
  }
  const setSignAs = (roleId: string, key: SignTemplateSignAsKey | null) => {
    setRoles((prev) => prev.map((r) => (r.id === roleId ? { ...r, signAs: key } : r)))
  }

  // ── Kéo/resize khung đã đặt (pointer events, tránh remount DOM khi di chuyển) ──
  const startDrag = (e: React.PointerEvent<HTMLDivElement>, role: EditorRole) => {
    if (previewMode) return
    setSelectedRoleId(role.id)
    const wrap = pageWrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    dragRef.current = {
      id: role.id, startX: e.clientX, startY: e.clientY,
      startLeft: role.box.xPct, startTop: role.box.yPct, rectW: rect.width, rectH: rect.height,
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onDragMove = (e: React.PointerEvent<HTMLDivElement>, role: EditorRole) => {
    const st = dragRef.current
    if (!st || st.id !== role.id) return
    const dxPct = ((e.clientX - st.startX) / st.rectW) * 100
    const dyPct = ((e.clientY - st.startY) / st.rectH) * 100
    // Di chuyển mượt mà 60/120fps (không snap gián đoạn lúc đang di chuyển)
    const xPct = Math.min(Math.max(st.startLeft + dxPct, -20), 120 - role.box.wPct)
    const yPct = Math.min(Math.max(st.startTop + dyPct, -20), 120 - role.box.hPct)
    setRoles((prev) => prev.map((r) => (r.id === role.id ? { ...r, box: { ...r.box, xPct, yPct } } : r)))
  }
  const onDragEnd = () => {
    const st = dragRef.current
    if (st && gridVisible) {
      // Chỉ snap to grid khi nhả chuột/ngón tay
      setRoles((prev) =>
        prev.map((r) => {
          if (r.id !== st.id) return r
          const xPct = snap(r.box.xPct, true, pctStepFor(st.rectW))
          const yPct = snap(r.box.yPct, true, pctStepFor(st.rectH))
          return { ...r, box: { ...r.box, xPct, yPct } }
        }),
      )
    }
    dragRef.current = null
    setRoles((prev) => recomputeBounds(prev))
  }
  const startResize = (e: React.PointerEvent<HTMLDivElement>, role: EditorRole) => {
    e.stopPropagation()
    const wrap = pageWrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    resizeRef.current = {
      id: role.id, startX: e.clientX, startY: e.clientY,
      startW: role.box.wPct, startH: role.box.hPct, left: role.box.xPct, top: role.box.yPct,
      rectW: rect.width, rectH: rect.height,
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>, role: EditorRole) => {
    const st = resizeRef.current
    if (!st || st.id !== role.id) return
    const dwPct = ((e.clientX - st.startX) / st.rectW) * 100
    const dhPct = ((e.clientY - st.startY) / st.rectH) * 100
    // Kéo giãn mượt mà
    const wPct = Math.max(MIN_BOX_PCT, st.startW + dwPct)
    const hPct = Math.max(MIN_BOX_PCT, st.startH + dhPct)
    setRoles((prev) => prev.map((r) => (r.id === role.id ? { ...r, box: { ...r.box, wPct, hPct } } : r)))
  }
  const onResizeEnd = () => {
    const st = resizeRef.current
    if (st && gridVisible) {
      setRoles((prev) =>
        prev.map((r) => {
          if (r.id !== st.id) return r
          const wPct = snap(r.box.wPct, true, pctStepFor(st.rectW))
          const hPct = snap(r.box.hPct, true, pctStepFor(st.rectH))
          return { ...r, box: { ...r.box, wPct, hPct } }
        }),
      )
    }
    resizeRef.current = null
    setRoles((prev) => recomputeBounds(prev))
  }

  // ── Kéo giãn sidebar (thanh chia giữa canvas và danh sách vai trò) ──
  const startSidebarDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    sidebarDragRef.current = { startX: e.clientX, startWidth: sidebarWidth }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onSidebarDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = sidebarDragRef.current
    if (!st) return
    const dx = e.clientX - st.startX
    // Tối đa 50% chiều rộng màn hình — tính động tại thời điểm kéo, không cần theo dõi resize
    // cửa sổ real-time.
    const maxWidth =
      typeof window !== "undefined" ? Math.max(SIDEBAR_MIN_WIDTH, window.innerWidth * 0.5) : 480
    setSidebarWidth(Math.min(Math.max(st.startWidth - dx, SIDEBAR_MIN_WIDTH), maxWidth))
  }
  const onSidebarDragEnd = () => {
    sidebarDragRef.current = null
  }

  const showToast = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(""), 3000)
  }

  const resetToSaved = () => {
    if (!initialSnapshot) return
    setRoles(JSON.parse(initialSnapshot) as EditorRole[])
    showToast("Đã đặt lại về mẫu đã lưu gần nhất.")
  }

  const buildKhungPayload = (): SignTemplateBox[] => {
    return roles
      .filter((r) => r.placed)
      .map((r): SignTemplateBox | null => {
        const dim = pageDims[r.page]
        if (!dim) return null
        const w_pt = (r.box.wPct / 100) * dim.w
        const h_pt = (r.box.hPct / 100) * dim.h
        const x_pt = (r.box.xPct / 100) * dim.w
        const y_pt = dim.h - (r.box.yPct / 100) * dim.h - h_pt
        return {
          vai_tro: r.id,
          clone_of: r.isClone ? r.baseId : null,
          neo_trang: r.anchor,
          so_trang: r.anchor === "cuoi" ? 0 : r.anchor === "moi_trang" ? 0 : r.page,
          x_pt, y_pt, w_pt, h_pt,
          loai: r.loai,
          nhan: r.label,
          bat_buoc: r.batBuoc,
          show_name: r.loai === "chu_ky" ? r.showName : undefined,
          show_chuc_vu: r.loai === "chu_ky" ? r.showChucVu : undefined,
          chuc_vu_key: r.loai === "chu_ky" && r.showChucVu ? r.chucVuKey : null,
          sign_as: r.loai === "chu_ky" ? r.signAs : undefined,
        }
      })
      .filter((b): b is SignTemplateBox => !!b)
  }

  const handleConfirmAndSend = async () => {
    if (missingRequired.length > 0) {
      showToast(`Còn thiếu vai trò bắt buộc: ${missingRequired.map((r) => r.label).join(", ")}`)
      return
    }
    if (outOfBoundsRoles.length > 0) {
      showToast("Có khung nằm ngoài khổ giấy — vui lòng chỉnh lại trước khi xác nhận.")
      return
    }
    // Ràng buộc đối với ISO: tất cả tài liệu & biểu mẫu kèm theo phải được cài đặt vị trí trước khi gửi duyệt
    if (isIso && returnTo) {
      const missingDocs: string[] = []
      if (activeDocId !== docId && !docTemplateStatus[docId]) {
        missingDocs.push(isoDocData?.ma_tai_lieu || "Quy trình chính")
      }
      if (isoChildDocs.length > 0) {
        isoChildDocs.forEach((c) => {
          if (c.id !== activeDocId && !docTemplateStatus[c.id]) {
            missingDocs.push(c.ma_tai_lieu || c.ten_tai_lieu || "Biểu mẫu")
          }
        })
      }
      if (missingDocs.length > 0) {
        showToast(
          `Chưa thể gửi đi: Còn ${missingDocs.length} tài liệu/biểu mẫu chưa cài đặt vị trí (${missingDocs.join(", ")}). Vui lòng chọn từng tài liệu trên thanh "Bộ hồ sơ" để đặt vị trí trước khi gửi đi.`,
        )
        return
      }
    }
    if (!factoryId || !me) return
    setSaving(true)
    setError("")
    try {
      if (dirty || !templateExisted) {
        const { data: sessionData } = await supabase.auth.getSession()
        const token = sessionData.session?.access_token || ""
        const keyToSave = isIso ? formatIsoTemplateKey(activeLoai) : activeLoai
        const res = await fetch("/api/signing/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              factoryId,
              loaiTaiLieu: keyToSave,
              khung: buildKhungPayload(),
              modun: isIso ? "iso" : "van_ban",
              allowEmpty: isExemptIsoDoc,
            }),
        })
        const json = (await res.json()) as { template?: unknown; error?: string }
        if (!res.ok) throw new Error(json.error || "Lỗi lưu mẫu vị trí")
      }
      setInitialSnapshot(JSON.stringify(roles))
      setTemplateExisted(true)
      setDocTemplateStatus((prev) => ({ ...prev, [activeDocId]: true }))
      if (returnTo) {
        const sep = returnTo.includes("?") ? "&" : "?"
        router.push(`${returnTo}${sep}confirmedSignTemplate=1`)
      } else {
        showToast("Đã lưu mẫu vị trí ký.")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    if (returnTo) router.push(returnTo)
    else router.back()
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f2f8f5] text-slate-500 gap-2">
        <Loader2 className="animate-spin" size={18} /> Đang tải màn cài đặt vị trí ký...
      </div>
    )
  }

  if (error && !pageDims[1]) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-[#f2f8f5] text-center gap-3 px-6">
        <AlertTriangle className="text-red-500" size={32} />
        <p className="text-slate-700 font-semibold max-w-md">{error}</p>
        <button
          onClick={handleCancel}
          className="mt-2 px-4 py-2 text-sm font-bold text-white bg-slate-700 hover:bg-slate-800 rounded-xl"
        >
          Quay lại
        </button>
      </div>
    )
  }

  const renderSidebarContent = (isMobile = false) => (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-slate-100">
        <h3 className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400 mb-1">Vai trò cần đặt khung</h3>
        {isExemptIsoDoc ? (
          <div className="mb-3 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] leading-snug">
            ℹ️ <strong>Biểu mẫu / Phụ lục</strong>: Không áp dụng quy tắc ký đủ 3 khung. Bạn có thể đặt số khung ký tùy ý (hoặc không đặt khung nếu biểu mẫu không yêu cầu ký).
          </div>
        ) : (
          <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
            Vai trò đã đặt có thể <strong>&quot;Nhân bản&quot;</strong> nếu tài liệu có thêm bước ký khác (vd nhiều phòng ban ký nối tiếp). Chỉ khung chữ ký mới có tuỳ chọn hiện tên/chức vụ.
          </p>
        )}
        <div className="space-y-1.5">
          {roles.filter((r) => !r.hiddenForDoc).map((role) => {
            const color = getRoleColor(role, isIso)
            const anchorLabel = role.anchor === "moi_trang" ? "Mọi trang" : role.anchor === "cuoi" ? "Trang cuối cùng" : `Trang ${role.page}`
            const signer = docSignerByRoleId[role.id]
            return (
              <div
                key={role.id}
                onClick={() => {
                  if (role.placed) {
                    goToPage(role.anchor === "moi_trang" ? currentPage : role.page)
                    setSelectedRoleId(role.id)
                    if (isMobile) setShowMobileSidebar(false)
                  }
                }}
                className="rounded-xl p-2.5 border cursor-pointer transition-colors"
                style={{ borderColor: role.id === selectedRoleId ? color.fg : "transparent", background: role.id === selectedRoleId ? color.bg : "transparent" }}
              >
                <div className="flex items-center gap-2.5">
                  {role.placed ? (
                    <div className="w-3 h-3 rounded shrink-0" style={{ background: color.fg }} />
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        armRole(role.id, pendingAnchorByRole[role.id] ?? "dau")
                        if (isMobile) setShowMobileSidebar(false)
                      }}
                      title="Đặt khung tại vị trí này trong văn bản"
                      className="p-1 rounded text-white shrink-0 active:scale-95"
                      style={{ background: color.fg }}
                    >
                      <ArrowLeft size={12} />
                    </button>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold text-slate-800 flex items-center gap-1.5 flex-wrap">
                      {role.label} {role.batBuoc && !isExemptIsoDoc && <span className="text-red-500 text-[10px]">• bắt buộc</span>}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {role.placed ? <span className="text-teal-700 font-semibold">Đã đặt · {anchorLabel}</span> : <span className="italic text-slate-400">Chưa đặt</span>}
                    </div>
                    {signer && (
                      <div className="text-[10.5px] text-slate-500 mt-0.5 truncate">
                        {signer.kind === "ca_nhan"
                          ? `→ ${signer.fullName || "(chưa rõ tên)"}${signer.chucVu ? " · " + signer.chucVu : ""}${
                              signer.deptLabel ? " · " + signer.deptLabel : ""
                            }`
                          : `→ Phòng ${signer.label} (chưa xác định người ký)`}
                      </div>
                    )}
                  </div>
                  {/* Dropdown neo trang */}
                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={role.placed ? role.anchor : pendingAnchorByRole[role.id] ?? "dau"}
                      onChange={(e) => {
                        const anchor = e.target.value as SignTemplateAnchor
                        if (role.placed) changeRoleAnchor(role.id, anchor)
                        else setPendingAnchorByRole((prev) => ({ ...prev, [role.id]: anchor }))
                      }}
                      title="Neo trang áp dụng khung này"
                      className="text-[10px] border border-slate-200 rounded px-1 py-1 text-slate-600 bg-white"
                    >
                      <option value="dau">Trang này</option>
                      <option value="cuoi">Trang cuối</option>
                      <option value="moi_trang">Mọi trang</option>
                    </select>
                    {role.placed && (
                      <>
                        <button onClick={() => duplicateRole(role.id)} title="Nhân bản" className="p-1.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600">
                          <Copy size={12} />
                        </button>
                        <button onClick={() => removeRole(role.id)} title="Bỏ" className="p-1.5 rounded text-slate-400 hover:text-red-600">
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {role.placed && role.loai === "chu_ky" && (
                  <div className="mt-2 pt-2 border-t border-dashed border-slate-200" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-600">Hiện tên</span>
                      <button
                        onClick={() => toggleShowName(role.id)}
                        className={`w-7 h-4 rounded-full relative transition-colors ${role.showName ? "bg-emerald-600" : "bg-slate-300"}`}
                      >
                        <span
                          className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                          style={{ left: role.showName ? 14 : 2 }}
                        />
                      </button>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-600">Hiện chức vụ</span>
                      <button
                        onClick={() => toggleShowChucVu(role.id)}
                        className={`w-7 h-4 rounded-full relative transition-colors ${role.showChucVu ? "bg-emerald-600" : "bg-slate-300"}`}
                      >
                        <span
                          className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                          style={{ left: role.showChucVu ? 14 : 2 }}
                        />
                      </button>
                    </div>
                    {!role.showName && !role.showChucVu && (
                      <p className="mt-1.5 text-[10px] text-slate-400 italic leading-snug">
                        Chỉ đóng ảnh chữ ký lên khung — dùng khi file gốc đã in sẵn tên và chức vụ.
                      </p>
                    )}
                    {role.showChucVu && (
                      <div className="mt-1.5">
                        <label className="text-[10px] text-slate-400 block mb-1">Ưu tiên hiển thị loại chức vụ</label>
                        <select
                          value={role.chucVuKey || "chinh_quyen"}
                          onChange={(e) => setChucVu(role.id, e.target.value as ChucVuKey)}
                          className="w-full text-[11px] border border-slate-200 rounded px-1.5 py-1 text-slate-700 bg-white"
                        >
                          {(Object.keys(CHUC_VU_LABELS) as ChucVuKey[]).map((k) => (
                            <option key={k} value={k}>{CHUC_VU_LABELS[k]}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="mt-2">
                      <label className="text-[10px] text-slate-400 block mb-1">
                        Tiền tố ký thay
                        {role.baseId === "ky_buoc" && " (chỉ áp dụng khi bước này là ký theo phòng ban)"}
                      </label>
                      <select
                        value={role.signAs || "none"}
                        onChange={(e) =>
                          setSignAs(role.id, e.target.value === "none" ? null : (e.target.value as SignTemplateSignAsKey))
                        }
                        className="w-full text-[11px] border border-slate-200 rounded px-1.5 py-1 text-slate-700 bg-white"
                      >
                        <option value="none">Ký trực tiếp (không tiền tố)</option>
                        {SIGN_TEMPLATE_SIGN_AS_OPTIONS.map((k) => (
                          <option key={k} value={k}>{SIGN_TEMPLATE_SIGN_AS_LABEL[k]}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="p-4 border-b border-slate-100">
        <h3 className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400 mb-2">Cảnh báo</h3>
        {outOfBoundsRoles.length > 0 ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-[11px] text-red-800 leading-relaxed">
            <div className="font-bold mb-1">⚠ Khung nằm ngoài khổ giấy</div>
            {outOfBoundsRoles.map((r) => <div key={r.id}>{r.label}</div>)}
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">Không có cảnh báo nào — mọi khung đều nằm trong khổ giấy.</p>
        )}
      </div>

      <div className="p-4 mt-auto">
        <p className="text-[11px] text-slate-400 leading-relaxed">
          {isIso ? (
            <>Mẫu vị trí ISO lưu <strong>vai trò</strong> (Soạn thảo, Xem xét, Phê duyệt, QR) theo loại tài liệu hoặc mã biểu mẫu. Khi quy trình chuyển bước, hệ thống sẽ căn cứ vào người ký thật đã chỉ định để đóng dấu.</>
          ) : (
            <>Mẫu vị trí lưu <strong>vai trò</strong>, không lưu người cụ thể — khi áp dụng cho 1 hồ sơ thật, hệ thống sẽ ánh xạ sang đúng người ký theo cấu hình định tuyến (chưa tích hợp ở phiên này).</>
          )}
        </p>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col h-screen bg-[#f2f8f5]">
      {/* Top bar */}
      <div className="text-white px-3 sm:px-5 py-2.5 sm:py-3 flex flex-wrap items-center justify-between gap-2 sm:gap-3" style={{ background: "linear-gradient(135deg,#2f5d52,#1c3a32)" }}>
        <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0 max-w-[50%] sm:max-w-none">
          <div className="text-[10px] sm:text-[11px] opacity-75 truncate">
            {isIso ? "Cài đặt vị trí ký ISO" : "Cài đặt vị trí ký"} · {activeLoai}
          </div>
          <div className="text-sm sm:text-base font-bold flex items-center gap-1.5 sm:gap-2 truncate">
            <span className="font-mono text-[11px] sm:text-xs bg-white/15 px-1.5 sm:px-2 py-0.5 rounded shrink-0">{activeLoai}</span>
            <span className="truncate">{activeDocLabel}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button onClick={handleCancel} className="px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs font-bold rounded-lg bg-white/10 hover:bg-white/20 border border-white/30">
            Huỷ
          </button>
          {templateExisted && (
            <button onClick={resetToSaved} className="px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs font-bold rounded-lg bg-white/10 hover:bg-white/20 border border-white/30">
              <span className="hidden sm:inline">Đặt lại mẫu đã lưu</span>
              <span className="sm:hidden">Đặt lại</span>
            </button>
          )}
          <button
            onClick={() => void handleConfirmAndSend()}
            disabled={saving}
            className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 text-xs font-bold rounded-lg bg-white text-[#1c3a32] hover:bg-emerald-50 disabled:opacity-50 shadow-xs"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            <span className="hidden sm:inline">{returnTo ? "Xác nhận vị trí & Gửi đi" : "Lưu mẫu vị trí"}</span>
            <span className="sm:hidden">{returnTo ? "Gửi đi" : "Lưu"}</span>
          </button>
        </div>
      </div>

      {/* ISO Child Documents selector tabs (if any) */}
      {isIso && isoChildDocs.length > 0 && (
        <div className="bg-[#1c3a32] border-t border-white/10 px-5 py-2 flex items-center gap-2 overflow-x-auto text-xs">
          <span className="text-white/60 text-[11px] font-semibold shrink-0">Bộ hồ sơ:</span>
          <button
            onClick={() => {
              if (docId) {
                void handleSwitchIsoDoc(
                  docId,
                  isoDocData?.file_signed_pdf_url || isoDocData?.file_goc_url || paramPdfUrl,
                  isoDocData?.loai_tai_lieu || paramLoai,
                  isoDocData?.ma_tai_lieu ? `${isoDocData.ma_tai_lieu} · ${isoDocData.ten_tai_lieu || ""}` : (isoDocData?.ten_tai_lieu || paramLoai),
                )
              }
            }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium shrink-0 transition-all ${
              activeDocId === docId ? "bg-emerald-500 text-white font-bold shadow-xs" : "bg-white/10 text-white/80 hover:bg-white/20"
            }`}
          >
            <span>📄 Quy trình chính ({isoDocData?.ma_tai_lieu || "Cha"})</span>
            {(docTemplateStatus[docId] || (activeDocId === docId && roles.some((r) => r.placed))) ? (
              <span className="px-1 py-0.5 rounded text-[9px] bg-emerald-800 text-emerald-100 font-bold">✓ Đã đặt</span>
            ) : (
              <span className="px-1 py-0.5 rounded text-[9px] bg-amber-500 text-white font-bold">• Chưa đặt</span>
            )}
          </button>
          {isoChildDocs.map((child, idx) => (
            <button
              key={child.id}
              onClick={() => {
                void handleSwitchIsoDoc(
                  child.id,
                  child.url,
                  child.ma_tai_lieu || child.loai_tai_lieu || "",
                  child.ma_tai_lieu ? `${child.ma_tai_lieu} · ${child.ten_tai_lieu || ""}` : (child.ten_tai_lieu || `Hồ sơ ${idx + 1}`),
                )
              }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium shrink-0 transition-all ${
                activeDocId === child.id ? "bg-emerald-500 text-white font-bold shadow-xs" : "bg-white/10 text-white/80 hover:bg-white/20"
              }`}
            >
              <span>📑 Biểu mẫu: {child.ma_tai_lieu || child.ten_tai_lieu || `Con ${idx + 1}`}</span>
              {(docTemplateStatus[child.id] || (activeDocId === child.id && (roles.some((r) => r.placed) || isExemptIsoDoc))) ? (
                <span className="px-1 py-0.5 rounded text-[9px] bg-emerald-800 text-emerald-100 font-bold">✓ Đã đặt</span>
              ) : (
                <span className="px-1 py-0.5 rounded text-[9px] bg-amber-500 text-white font-bold">• Chưa đặt</span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="bg-emerald-50 border-b border-emerald-200 text-emerald-900 text-xs px-5 py-2">
        {isIso ? (
          <>💡 Vẽ khung <strong>một lần</strong> cho Loại tài liệu / Biểu mẫu này. Lần soạn thảo sau hệ thống tự động áp lại mẫu đã lưu, bạn chỉ cần xác nhận hoặc chỉnh nhẹ nếu bố cục thay đổi.</>
        ) : (
          <>💡 Vẽ khung <strong>một lần</strong> cho loại tài liệu này — lần soạn thảo sau hệ thống tự áp lại mẫu đã lưu, bạn chỉ cần xác nhận hoặc chỉnh nhẹ nếu bố cục file thay đổi.</>
        )}
      </div>
      {dirty && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-800 text-xs px-5 py-2">
          ✏️ Bạn vừa chỉnh khác so với mẫu đã lưu — bấm &quot;{returnTo ? "Xác nhận vị trí & Gửi đi" : "Lưu mẫu vị trí"}&quot; sẽ lưu thành phiên bản mẫu mới.
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Page thumbnails with indicator dots - ẩn trên mobile để canvas chiếm trọn 100% */}
        {numPages > 1 && (
          <div className="hidden md:flex w-24 bg-white border-r border-slate-200 overflow-y-auto py-3 px-2 flex-col items-center gap-4 shrink-0">
            <div className="text-[10px] uppercase tracking-wide text-slate-400 font-bold">{numPages} trang</div>
            {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => {
              const rolesOnThisThumb = roles.filter((r) => {
                if (!r.placed || r.hiddenForDoc) return false
                if (r.anchor === "moi_trang") return true
                if (r.anchor === "cuoi") return p === numPages
                return r.page === p
              })
              const dim = pageDims[p]
              const aspect = dim && dim.w > 0 && dim.h > 0 ? `${dim.w} / ${dim.h}` : "1 / 1.414"
              return (
                <button
                  key={p}
                  onClick={() => goToPage(p)}
                  className={`w-16 rounded border-2 relative overflow-hidden flex flex-col items-center justify-center text-[10px] font-bold transition-all ${
                    p === currentPage
                      ? "border-emerald-600 shadow-sm ring-1 ring-emerald-500/50"
                      : rolesOnThisThumb.length > 0
                        ? "border-slate-300 hover:border-slate-400"
                        : "border-slate-200 hover:border-slate-300"
                  }`}
                  style={{ aspectRatio: aspect }}
                  title={`Trang ${p}${rolesOnThisThumb.length > 0 ? ` (${rolesOnThisThumb.map((r) => r.label).join(", ")})` : ""}`}
                >
                  {pageImages[p] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={pageImages[p]} alt={`Trang ${p}`} className="w-full h-full object-fill block select-none pointer-events-none" />
                  ) : (
                    <span className="text-slate-400">Trang {p}</span>
                  )}
                  {/* Khung mini thể hiện vị trí THẬT của các khung trên trang */}
                  {rolesOnThisThumb.map((r) => {
                    const color = getRoleColor(r, isIso)
                    const isSelected = r.id === selectedRoleId
                    return (
                      <span
                        key={r.id}
                        className="absolute pointer-events-none rounded-[1.5px] transition-all"
                        style={{
                          left: `${Math.max(0, Math.min(100, r.box.xPct))}%`,
                          top: `${Math.max(0, Math.min(100, r.box.yPct))}%`,
                          width: `${Math.max(4, Math.min(100, r.box.wPct))}%`,
                          height: `${Math.max(3, Math.min(100, r.box.hPct))}%`,
                          border: `${isSelected ? "2px" : "1.5px"} solid ${color.fg}`,
                          backgroundColor: color.bg,
                          boxShadow: isSelected ? `0 0 4px ${color.fg}` : `0 0 2px ${color.fg}99`,
                          zIndex: isSelected ? 10 : 5,
                        }}
                        title={r.label}
                      />
                    )
                  })}
                  {/* Số trang góc dưới */}
                  <span className="absolute bottom-0.5 left-0.5 px-1 py-0.2 rounded text-[8px] font-bold bg-slate-900/60 text-white pointer-events-none leading-tight">
                    {p}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {/* Canvas */}
        <div className="flex-1 overflow-auto flex flex-col items-center py-4 sm:py-6 px-2 sm:px-4">
          <div className="w-full max-w-[640px] flex items-center justify-between mb-3 text-xs flex-wrap gap-2">
            <div className="text-slate-500 font-semibold flex items-center gap-2">
              {numPages > 1 && (
                <>
                  <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1} className="p-1 rounded hover:bg-slate-200 disabled:opacity-30">
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    onClick={() => setShowMobilePagePicker(true)}
                    className="hover:underline flex items-center gap-1 font-bold text-slate-700"
                    title="Nhấp để đổi trang nhanh"
                  >
                    <span>Trang {currentPage} / {numPages}</span>
                    <ChevronDown size={12} className="opacity-60 md:hidden" />
                  </button>
                  <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= numPages} className="p-1 rounded hover:bg-slate-200 disabled:opacity-30">
                    <ChevronRight size={14} />
                  </button>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              <button
                onClick={() => setShowMobileSidebar(true)}
                className="md:hidden flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-emerald-300 bg-emerald-50 text-emerald-800 text-[11px] font-bold shadow-2xs active:bg-emerald-100"
              >
                <SlidersHorizontal size={13} />
                <span>Vai trò ({roles.filter((r) => r.placed).length}/{roles.filter((r) => !r.hiddenForDoc).length})</span>
              </button>
              <button
                onClick={() => setGridVisible((v) => !v)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[11px] font-semibold ${gridVisible ? "bg-emerald-50 border-emerald-300 text-emerald-700" : "bg-white border-slate-200 text-slate-600"}`}
              >
                <Grid3x3 size={13} /> <span className="hidden sm:inline">Lưới căn chỉnh</span>
              </button>
              <button
                onClick={() => setPreviewMode((v) => !v)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[11px] font-semibold ${previewMode ? "bg-emerald-50 border-emerald-300 text-emerald-700" : "bg-white border-slate-200 text-slate-600"}`}
              >
                {previewMode ? <Eye size={13} /> : <EyeOff size={13} />} <span className="hidden sm:inline">Xem trước</span>
              </button>
            </div>
          </div>

          {armedRoleId && (
            <div className="w-full max-w-[640px] mb-2 border-2 border-dashed border-slate-400 rounded-xl bg-white px-3 py-2 flex items-center justify-between text-xs font-semibold text-slate-700">
              <span>Nhấp vào tài liệu để đặt khung &quot;{roles.find((r) => r.id === armedRoleId)?.label}&quot;</span>
              <button onClick={cancelArm} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold">Huỷ</button>
            </div>
          )}

          <div
            ref={pageWrapRef}
            onClick={handlePageClick}
            className="relative bg-white shadow-xl w-full max-w-[640px] shrink-0"
            style={{ aspectRatio: pageDims[currentPage] ? `${pageDims[currentPage].w} / ${pageDims[currentPage].h}` : "1 / 1.414", cursor: armedRoleId ? "crosshair" : "default" }}
          >
            {pageImages[currentPage] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pageImages[currentPage]} alt={`Trang ${currentPage}`} className="w-full h-full object-contain pointer-events-none select-none" draggable={false} />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-slate-300 text-sm">Không tải được ảnh trang</div>
            )}
            {gridVisible && (
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  backgroundImage:
                    "linear-gradient(to right, rgba(15,23,42,.12) 1px, transparent 1px), " +
                    "linear-gradient(to bottom, rgba(15,23,42,.12) 1px, transparent 1px)",
                  backgroundSize: `${GRID_STEP_PX}px ${GRID_STEP_PX}px`,
                }}
              />
            )}
            {rolesOnPage.map((role) => {
              const color = getRoleColor(role, isIso)
              const isSelected = role.id === selectedRoleId
              return (
                <div
                  key={role.id}
                  data-rolebox
                  onPointerDown={(e) => startDrag(e, role)}
                  onPointerMove={(e) => onDragMove(e, role)}
                  onPointerUp={onDragEnd}
                  className="absolute flex flex-col items-center justify-center rounded-lg select-none touch-none"
                  style={{
                    left: `${role.box.xPct}%`,
                    top: `${role.box.yPct}%`,
                    width: `${role.box.wPct}%`,
                    height: `${role.box.hPct}%`,
                    border: `2px dashed ${role.outOfBounds ? "#dc2626" : color.fg}`,
                    background: role.outOfBounds ? "rgba(220,38,38,.12)" : previewMode ? "#fff" : color.bg,
                    boxShadow: isSelected ? `0 0 0 3px ${color.fg}` : undefined,
                    cursor: previewMode ? "default" : "grab",
                    zIndex: isSelected ? 5 : 1,
                    padding: previewMode ? "4px 6px" : undefined,
                  }}
                >
                  {previewMode ? (
                    <PreviewContent role={role} color={color.fg} signer={docSignerByRoleId[role.id]} factoryId={factoryId} />
                  ) : (
                    <span
                      className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-white pointer-events-none whitespace-nowrap"
                      style={{ color: role.outOfBounds ? "#dc2626" : color.fg }}
                    >
                      {role.label}
                    </span>
                  )}
                  {!previewMode && (
                    <div
                      onPointerDown={(e) => startResize(e, role)}
                      onPointerMove={(e) => onResizeMove(e, role)}
                      onPointerUp={onResizeEnd}
                      className="absolute w-6 h-6 sm:w-3 sm:h-3 border-2 border-white rounded-sm shadow-xs"
                      style={{ right: -8, bottom: -8, background: color.fg, cursor: "nwse-resize", touchAction: "none" }}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Thanh chia — kéo để giãn/thu hẹp sidebar (chỉ hiện trên desktop) */}
        <div
          onPointerDown={startSidebarDrag}
          onPointerMove={onSidebarDragMove}
          onPointerUp={onSidebarDragEnd}
          className="hidden md:block w-1.5 shrink-0 cursor-col-resize bg-slate-100 hover:bg-slate-300 relative"
          title="Kéo để đổi độ rộng"
        >
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-slate-300" />
        </div>

        {/* Sidebar Desktop */}
        <div className="hidden md:flex bg-white border-l border-slate-200 overflow-y-auto flex-col shrink-0" style={{ width: sidebarWidth }}>
          {renderSidebarContent(false)}
        </div>
      </div>

      {/* Mobile Drawer Cấu hình Vai trò */}
      {showMobileSidebar && (
        <div className="fixed inset-0 z-50 md:hidden bg-black/60 backdrop-blur-xs flex flex-col justify-end animate-in fade-in duration-200">
          <div className="bg-white rounded-t-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-200">
            <div className="p-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <SlidersHorizontal size={15} className="text-emerald-700" />
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wide">Cấu hình vai trò & Khung ký</h4>
              </div>
              <button
                onClick={() => setShowMobileSidebar(false)}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 active:bg-slate-200"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {renderSidebarContent(true)}
            </div>
            <div className="p-3 bg-slate-50 border-t border-slate-200">
              <button
                onClick={() => setShowMobileSidebar(false)}
                className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-xl shadow-xs"
              >
                Xong & Quay lại Canvas
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Page Picker */}
      {showMobilePagePicker && numPages > 1 && (
        <div className="fixed inset-0 z-50 md:hidden bg-black/60 backdrop-blur-xs flex flex-col justify-end animate-in fade-in duration-200">
          <div className="bg-white rounded-t-2xl max-h-[75vh] flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-200">
            <div className="p-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wide">Chọn trang ({numPages} trang)</h4>
              <button onClick={() => setShowMobilePagePicker(false)} className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 active:bg-slate-200">
                <X size={18} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto grid grid-cols-3 gap-3">
              {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => {
                const rolesOnThisThumb = roles.filter((r) => {
                  if (!r.placed || r.hiddenForDoc) return false
                  if (r.anchor === "moi_trang") return true
                  if (r.anchor === "cuoi") return p === numPages
                  return r.page === p
                })
                const dim = pageDims[p]
                const aspect = dim && dim.w > 0 && dim.h > 0 ? `${dim.w} / ${dim.h}` : "1 / 1.414"
                return (
                  <button
                    key={p}
                    onClick={() => {
                      goToPage(p)
                      setShowMobilePagePicker(false)
                    }}
                    className={`rounded-lg border-2 relative overflow-hidden flex flex-col items-center justify-center text-[10px] font-bold transition-all ${
                      p === currentPage ? "border-emerald-600 ring-2 ring-emerald-500/50" : "border-slate-200 hover:border-slate-300"
                    }`}
                    style={{ aspectRatio: aspect }}
                  >
                    {pageImages[p] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={pageImages[p]} alt={`Trang ${p}`} className="w-full h-full object-fill block select-none pointer-events-none" />
                    ) : (
                      <span className="text-slate-400">Trang {p}</span>
                    )}
                    {rolesOnThisThumb.map((r) => {
                      const color = getRoleColor(r, isIso)
                      return (
                        <span
                          key={r.id}
                          className="absolute pointer-events-none rounded-[1px]"
                          style={{
                            left: `${Math.max(0, Math.min(100, r.box.xPct))}%`,
                            top: `${Math.max(0, Math.min(100, r.box.yPct))}%`,
                            width: `${Math.max(4, Math.min(100, r.box.wPct))}%`,
                            height: `${Math.max(3, Math.min(100, r.box.hPct))}%`,
                            border: `1.5px solid ${color.fg}`,
                            backgroundColor: color.bg,
                          }}
                        />
                      )
                    })}
                    <span className="absolute bottom-0.5 left-0.5 px-1 py-0.2 rounded text-[8px] font-bold bg-slate-900/70 text-white">
                      {p}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Mobile Precision Nudge D-Pad (hiện trên mobile khi đang chọn 1 khung đã đặt) */}
      {selectedRoleId && (
        <div className="md:hidden fixed bottom-5 right-4 z-40 bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-slate-200 p-2 flex flex-col items-center gap-1">
          <div className="text-[8.5px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Vi chỉnh</div>
          <button
            onClick={() => nudgeRole(selectedRoleId, 0, -1)}
            className="w-8 h-8 rounded-lg bg-slate-100 active:bg-slate-200 flex items-center justify-center text-slate-700 active:scale-95 shadow-2xs"
            title="Lên 1 nấc"
          >
            <ChevronUp size={16} />
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => nudgeRole(selectedRoleId, -1, 0)}
              className="w-8 h-8 rounded-lg bg-slate-100 active:bg-slate-200 flex items-center justify-center text-slate-700 active:scale-95 shadow-2xs"
              title="Sang trái 1 nấc"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => nudgeRole(selectedRoleId, 1, 0)}
              className="w-8 h-8 rounded-lg bg-slate-100 active:bg-slate-200 flex items-center justify-center text-slate-700 active:scale-95 shadow-2xs"
              title="Sang phải 1 nấc"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <button
            onClick={() => nudgeRole(selectedRoleId, 0, 1)}
            className="w-8 h-8 rounded-lg bg-slate-100 active:bg-slate-200 flex items-center justify-center text-slate-700 active:scale-95 shadow-2xs"
            title="Xuống 1 nấc"
          >
            <ChevronDown size={16} />
          </button>
        </div>
      )}

      {error && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-red-600 text-white text-sm font-semibold px-4 py-2 rounded-xl shadow-lg flex items-center gap-2">
          <AlertTriangle size={15} /> {error}
          <button onClick={() => setError("")}><X size={14} /></button>
        </div>
      )}
      {toast && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2">
          <Check size={14} className="text-emerald-400" /> {toast}
        </div>
      )}
    </div>
  )
}

function PreviewContent({
  role,
  color,
  signer,
  factoryId,
}: {
  role: EditorRole
  color: string
  signer?: DocSignerInfo
  factoryId: string | null
}) {
  if (role.loai === "qr") {
    return (
      <div className="grid grid-cols-5 gap-[1px] w-full h-full">
        {Array.from({ length: 25 }, (_, i) => (
          <div key={i} style={{ background: i % 3 === 0 ? "#1e293b" : "transparent" }} />
        ))}
      </div>
    )
  }
  if (role.loai === "ngay_ky") {
    return <span className="text-xs font-bold text-slate-800">24/08/2026</span>
  }
  if (role.loai === "ghi_chu") {
    return (
      <span className="text-[10px] italic text-slate-600 text-center px-1 line-clamp-2">
        Nội dung ghi chú văn bản (ghi_chu)
      </span>
    )
  }

  // Vai trò gắn với NGƯỜI THẬT đã chọn ở màn soạn thảo (chỉ khi mở kèm docId) — hiện tên/chức
  // vụ/ảnh chữ ký thật thay placeholder giả, để người soạn thảo có căn cứ thật khi đặt vị trí.
  if (signer?.kind === "phong_ban") {
    return (
      <div className="flex flex-col items-center gap-0.5 text-center px-1">
        <div className="text-[10px] font-bold text-slate-800">{signer.label}</div>
        <div className="text-[8px] italic text-slate-400">(người ký thật xác định khi ký)</div>
      </div>
    )
  }
  if (signer?.kind === "ca_nhan") {
    let chucVuText = ""
    if (role.chucVuKey === "kiem_nhiem") {
      chucVuText = signer.chucVuByKey?.kiem_nhiem || signer.chucVu || CHUC_VU_LABELS.kiem_nhiem
    } else if (role.chucVuKey === "chinh_quyen") {
      chucVuText = signer.chucVuByKey?.chinh_quyen || signer.chucVu || CHUC_VU_LABELS.chinh_quyen
    } else {
      chucVuText = signer.chucVu || (role.chucVuKey ? CHUC_VU_LABELS[role.chucVuKey] : "")
    }
    return (
      <div className="flex flex-col items-center gap-0.5">
        {signer.hasSignature && factoryId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={supabase.storage.from("iso-documents").getPublicUrl(`signatures/${factoryId}/${signer.userId}/chu_ky.png`).data.publicUrl}
            alt="Chữ ký"
            className="max-h-[55%] object-contain"
          />
        ) : (
          <span className="text-[8.5px] italic text-slate-400">Chưa có ảnh chữ ký</span>
        )}
        {role.showName && (
          <div className="text-[10px] font-bold text-slate-800">{signer.fullName || "(chưa rõ tên)"}</div>
        )}
        {role.showChucVu && chucVuText && (
          <div className="text-[8.5px] italic text-slate-500">{chucVuText}</div>
        )}
        {/* Mã phòng ban của bước — thông tin phụ, vì đây mới là thứ thực sự được in dưới chữ ký
            trên chứng từ (`chucVu = step.phong_ban_code || step.chuc_vu` ở route ký). */}
        {signer.deptLabel && (
          <div className="text-[8px] text-slate-400">{signer.deptLabel}</div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg viewBox="0 0 52 34" width="70%" height="55%" fill="none">
        <path d="M2,22 C10,4 16,30 24,10 S38,26 46,14" stroke={color} strokeWidth={2.4} strokeLinecap="round" fill="none" />
      </svg>
      {role.showName && <div className="text-[10px] font-bold text-slate-800">Nguyễn Văn A</div>}
      {role.showChucVu && role.chucVuKey && (
        <div className="text-[8.5px] italic text-slate-500">{CHUC_VU_LABELS[role.chucVuKey]}</div>
      )}
    </div>
  )
}
