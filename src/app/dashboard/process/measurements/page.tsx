"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Activity, AlertTriangle, Camera, ChevronLeft, ClipboardCheck, FlaskConical, Layers, Plus,
  Search, Share2, Trash2, X, ImageIcon, Upload,
} from "lucide-react"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import { authFetch } from "@/lib/auth-fetch"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { prepareImageForUpload } from "@/lib/image-upload"
import { isProductSelectableStorageStatus } from "@/lib/storage-status"
import { ProcessShell } from "../_components/process-shell"
import { FilterBar } from "@/app/dashboard/_components/filter-bar"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { PageHeaderBanner } from "@/app/dashboard/_components/page-header-banner"
import { QrScanButton, QrScanPortal } from "@/app/dashboard/_components/qr-scan-portal"
import { StatCard, StatGrid } from "@/app/dashboard/_components/doc-ui/stat-card"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { RowAction } from "@/app/dashboard/_components/doc-ui/row-action"
import { IconAction, IconActionGroup } from "@/app/dashboard/_components/doc-ui/icon-action"
import { ExpandableRow, ExpandAllToggle, ExpandHeaderCell } from "@/app/dashboard/_components/doc-ui/expandable-row"
import { KpiLinkPrompt } from "@/app/dashboard/_components/kpi-link-prompt"
import {
  type QuickMeasurementSheet, type QuickMeasurementRow, type MeasurementRowDraft, type CheDoRow,
  CHI_TIEU_BY_CSR, ALL_CSR_TYPES, CSR_BY_DAY_CHUYEN,
  getMaPhieuPrefix, formatDdMmYy, calcSoNgayLuu, emptyMeasurementRow, resolveCheDoSuggestion,
} from "../_components/process-types"

type NganItem = {
  id: string
  ten_ngan: string
  ma_ngan: string
  tong_kho: number
  trang_thai: string
  ngay_bd: string
  loai_nl: string
}

type SheetWithRows = QuickMeasurementSheet & { rows: QuickMeasurementRow[] }

type ViewMode = "list" | "create"

function formatDate(d: string) {
  const [y, m, day] = d.split("-")
  return `${day}/${m}/${y}`
}

function getMaPhieuPreview(day_chuyen: string, ngay: string, count: number) {
  if (!ngay) return ""
  const prefix = getMaPhieuPrefix(day_chuyen)
  return `${prefix}-${formatDdMmYy(ngay)}/${String(count).padStart(3, "0")}`
}

// Số thứ tự tiếp theo = số LỚN NHẤT đang có + 1 (không đếm số phiếu): đếm sẽ cấp lại mã đã dùng
// sau khi có phiếu bị xoá ở giữa dãy (vd còn /002 → đếm ra 2 → cấp trùng /002).
async function fetchNextMaPhieuSeq(factoryId: string, day_chuyen: string, ngay: string): Promise<number> {
  const codePrefix = `${getMaPhieuPrefix(day_chuyen)}-${formatDdMmYy(ngay)}/`
  const { data, error } = await supabase
    .from("quick_measurements")
    .select("ma_phieu")
    .eq("factory_id", factoryId)
    .like("ma_phieu", `${codePrefix}%`)
  if (error) throw error
  let max = 0
  for (const r of (data as { ma_phieu: string | null }[]) || []) {
    const n = parseInt((r.ma_phieu || "").slice(codePrefix.length), 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max + 1
}

function fmtCheDo(t1: number | null, t2: number | null, tg: number | null): string {
  const parts = [t1, t2, tg].map(n => n != null ? String(n).replace(".", ",") : "")
  if (parts.every(p => p === "")) return ""
  return parts.join("-")
}

function shortNganStatus(trang_thai: string): string {
  if (trang_thai.includes("Chờ")) return "Chờ SX"
  if (trang_thai.includes("Đang")) return "Đang SX"
  if (trang_thai.includes("Đã")) return "Đã SX"
  return trang_thai.slice(0, 5)
}

// Chuyển 1 dòng đã lưu trong DB thành draft để nạp lại vào form sửa —
// giữ nguyên id thật (dùng để phân biệt UPDATE với INSERT lúc lưu) và giữ nguyên
// nguoi_do gốc (không ghi đè bằng người đang sửa).
function rowToDraft(row: QuickMeasurementRow): MeasurementRowDraft {
  return {
    id: row.id,
    chi_tieu: row.chi_tieu || [],
    thung: row.thung || "",
    lo: row.lo || "",
    mau: row.mau || "",
    che_do_say: row.che_do_say || "",
    ca_sx: row.ca_sx || "",
    ngan_id: row.ngan_id || "",
    so_ngay_luu: row.so_ngay_luu,
    ket_qua: Object.fromEntries(
      Object.entries(row.ket_qua || {}).map(([k, v]) => [k, v == null ? "" : String(v)])
    ),
    image_urls: row.image_urls || [],
    nguoi_do: row.nguoi_do || "",
    ghi_chu: row.ghi_chu || "",
  }
}

function rowDraftToFields(row: MeasurementRowDraft) {
  return {
    chi_tieu: row.chi_tieu,
    thung: row.thung || null,
    lo: row.lo || null,
    mau: row.mau || null,
    che_do_say: row.che_do_say || null,
    ca_sx: row.ca_sx || null,
    ngan_id: row.ngan_id || null,
    so_ngay_luu: row.so_ngay_luu,
    ket_qua: Object.fromEntries(
      Object.entries(row.ket_qua || {}).map(([k, v]) => [k, v === "" ? null : Number(v)])
    ),
    image_urls: row.image_urls,
    nguoi_do: row.nguoi_do || null,
    ghi_chu: row.ghi_chu || null,
  }
}

function rowDraftToPayload(row: MeasurementRowDraft, sheetId: string, factoryId: string, sortOrder: number) {
  return {
    sheet_id: sheetId,
    factory_id: factoryId,
    so_mau: sortOrder + 1,
    ...rowDraftToFields(row),
    sort_order: sortOrder,
  }
}

const DETAIL_PATH_RE = /\/dashboard\/process\/measurements\/([0-9a-f-]{36})/i
const PRINT_ID_RE = /\/dashboard\/process\/print\?(?:.*&)?sheetId=([0-9a-f-]{36})/i

function fmtKq(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return ""
  return String(v).replace(".", ",")
}

function avgOf(values: number[]) {
  if (!values.length) return null
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
}

export default function MeasurementsPage() {
  const router = useRouter()
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [sheets, setSheets] = useState<SheetWithRows[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [ngans, setNgans] = useState<NganItem[]>([])
  const [currentUserName, setCurrentUserName] = useState("")
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null)
  // Gợi ý Ca SX = các ca thực tế đã dùng ở module Thành phẩm (lot_transactions.ca) cho nhà máy này —
  // không hard-code cứng "Ca A/B/C"; nếu nhà máy chưa từng dùng Ca C thì không gợi ý Ca C.
  const [caSxOptions, setCaSxOptions] = useState<string[]>(["Ca A", "Ca B"])

  // filters
  const [filterFrom, setFilterFrom] = useState("")
  const [filterTo, setFilterTo] = useState("")
  const [filterDayChuyen, setFilterDayChuyen] = useState("")

  // view
  const [view, setView] = useState<ViewMode>("list")
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null)

  // create / sửa / thêm mẫu — dùng chung 1 form
  const [formNgay, setFormNgay] = useState(() => getFactoryTodayISO())
  const [formDayChuyen, setFormDayChuyen] = useState("")
  const [formLoaiCsr, setFormLoaiCsr] = useState("")
  const [defaultCheDo, setDefaultCheDo] = useState("")
  const [cheDoWarning, setCheDoWarning] = useState<string | null>(null)
  const [rows, setRows] = useState<MeasurementRowDraft[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [nextCount, setNextCount] = useState(1)

  // "Gắn bản ghi tại chỗ" — gợi ý gắn phiếu đo nhanh vừa lưu vào công việc KPI đang mở
  const [kpiPrompt, setKpiPrompt] = useState<null | { recordId: string[]; recordLabel: string }>(null)

  // Sửa phiếu / thêm mẫu vào phiếu đã có
  const [editingSheetId, setEditingSheetId] = useState<string | null>(null)
  const [editingSheet, setEditingSheet] = useState<SheetWithRows | null>(null)
  const [addRowsMode, setAddRowsMode] = useState(false)
  const [existingRowIds, setExistingRowIds] = useState<Set<string>>(new Set())
  const [existingRowCount, setExistingRowCount] = useState(0)

  const [uploadingRowId, setUploadingRowId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const activeRowRef = useRef<string | null>(null)

  // OCR — tự nhận dạng thiết bị (Po/Mo), hỗ trợ chọn nhiều ảnh cùng lúc
  const [ocrLoadingKey, setOcrLoadingKey] = useState<string | null>(null)
  const [ocrToast, setOcrToast] = useState<string | null>(null)
  const ocrAutoFileInputRef = useRef<HTMLInputElement>(null)
  const ocrActiveRowRef = useRef<string | null>(null)

  // Chia sẻ ảnh nhanh (list view)
  const [sharingSheetId, setSharingSheetId] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  // Tìm nhanh + quét QR + dòng xổ (rule 29)
  const [search, setSearch] = useState("")
  const [scanning, setScanning] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Xoá phiếu — luôn qua hộp xác nhận
  const [delSheet, setDelSheet] = useState<SheetWithRows | null>(null)
  const [deletingSheet, setDeletingSheet] = useState(false)

  // Load sheets
  const loadSheets = useCallback(async (fid: string) => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await fetchAllPaginated<SheetWithRows>((from, to) => {
        let q = supabase
          .from("quick_measurements")
          .select("*, rows:quick_measurement_rows(*)")
          .eq("factory_id", fid)
          .order("ngay", { ascending: false })
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
        if (filterFrom) q = q.gte("ngay", filterFrom)
        if (filterTo) q = q.lte("ngay", filterTo)
        if (filterDayChuyen) q = q.eq("day_chuyen", filterDayChuyen)
        return q.range(from, to)
      })
      setSheets(data)
    } catch (err) {
      setSheets([])
      setLoadError((err as { message?: string } | null)?.message || "Không tải được danh sách phiếu")
    } finally {
      setLoading(false)
    }
  }, [filterFrom, filterTo, filterDayChuyen])

  const loadNgans = useCallback(async (fid: string) => {
    const { data } = await supabase
      .from("ngans")
      .select("id,ten_ngan,ma_ngan,tong_kho,trang_thai,ngay_bd,loai_nl")
      .eq("factory_id", fid)
    setNgans((data as NganItem[]) || [])
  }, [])

  // Ca SX gợi ý = ca thực tế đã ghi nhận ở Thành phẩm (lot_transactions.ca, giá trị "A"|"B"|"C")
  // cho nhà máy này. Chỉ hiện "Ca C" nếu nhà máy thực sự có dùng.
  // Dùng 3 query nhỏ .limit(1) riêng từng ca thay vì 1 query không giới hạn — lot_transactions
  // có thể vượt 1000 dòng, PostgREST sẽ âm thầm cắt bớt kết quả (xem 04-code-patterns.md).
  const loadCaSxOptions = useCallback(async (fid: string) => {
    const checks = await Promise.all(["A", "B", "C"].map(async (letter) => {
      const { data } = await supabase
        .from("lot_transactions")
        .select("id, lots!inner(factory_id)")
        .eq("lots.factory_id", fid)
        .eq("ca", letter)
        .limit(1)
      return { letter, exists: (data?.length || 0) > 0 }
    }))
    const options = checks.filter(c => c.exists).map(c => `Ca ${c.letter}`)
    setCaSxOptions(options.length ? options : ["Ca A", "Ca B"])
  }, [])

  useEffect(() => {
    const bootstrap = async () => {
      const fid = await getActiveFactoryId()
      if (!fid) { setLoading(false); return }
      const { user: sessionUser } = await hydrateActiveSession()
      if (!sessionUser) { setLoading(false); return }
      if (!hasPermission(sessionUser, "process.view")) {
        setLoading(false)
        window.location.replace("/dashboard")
        return
      }
      setFactoryId(fid)
      setCurrentUser(sessionUser)
      if (sessionUser?.full_name) setCurrentUserName(sessionUser.full_name)
      else if (sessionUser?.username) setCurrentUserName(sessionUser.username)
    }
    void bootstrap()
  }, [])

  useEffect(() => {
    if (factoryId) {
      void loadSheets(factoryId)
      void loadNgans(factoryId)
      void loadCaSxOptions(factoryId)
    }
  }, [factoryId, loadSheets, loadNgans, loadCaSxOptions])

  // Load next phiếu count
  useEffect(() => {
    if (!factoryId || !formNgay || !formDayChuyen) { setNextCount(1); return }
    let alive = true
    void fetchNextMaPhieuSeq(factoryId, formDayChuyen, formNgay)
      .then(seq => { if (alive) setNextCount(seq) })
      .catch(() => { /* chỉ là bản xem trước — mã thật được tính lại lúc lưu */ })
    return () => { alive = false }
  }, [factoryId, formNgay, formDayChuyen])

  // Lấy chế độ sấy mặc định từ process_params gần nhất cho đúng (dây chuyền, Loại CSR).
  // Chạy song song 2 query: bản khớp đúng Loại CSR đang chọn + bản mới nhất của cả dây chuyền
  // (bất kể CSR) — vì cột loai_csr là optional, bản mới nhất có thể bị bỏ sót nếu lọc cứng theo CSR.
  // Tách thành hàm riêng (không chỉ nằm trong effect) để openCreate/openAddRows có thể await
  // trực tiếp ngay lúc mở form — nếu chỉ dựa vào effect phản ứng theo formDayChuyen/formLoaiCsr,
  // mở phiếu mới với đúng dây chuyền/CSR mặc định trùng phiên trước sẽ không đổi state, effect
  // không tự rerun, khiến gợi ý bị "kẹt" ở giá trị rỗng/cũ dù process_params đã có bản ghi mới hơn.
  const fetchCheDoSuggestion = useCallback(async (fid: string, dayChuyen: string, csr: string): Promise<{ value: string; warning: string | null }> => {
    const selectCols = "nhiet_do_dau_1, nhiet_do_dau_2, thoi_gian_say, ngay, created_at, loai_csr"
    const [csrRes, anyRes] = await Promise.all([
      csr
        ? supabase.from("process_params").select(selectCols)
            .eq("factory_id", fid).eq("day_chuyen", dayChuyen).eq("loai_csr", csr)
            .order("ngay", { ascending: false }).order("created_at", { ascending: false }).limit(1)
        : Promise.resolve({ data: null as CheDoRow[] | null }),
      supabase.from("process_params").select(selectCols)
        .eq("factory_id", fid).eq("day_chuyen", dayChuyen)
        .order("ngay", { ascending: false }).order("created_at", { ascending: false }).limit(1),
    ])
    const csrMatch = (csrRes.data?.[0] as CheDoRow | undefined) ?? null
    const latestAny = (anyRes.data?.[0] as CheDoRow | undefined) ?? null

    if (!csr) {
      return { value: latestAny ? fmtCheDo(latestAny.nhiet_do_dau_1, latestAny.nhiet_do_dau_2, latestAny.thoi_gian_say) : "", warning: null }
    }
    const { row, warning } = resolveCheDoSuggestion(csrMatch, latestAny, csr, formatDate)
    return { value: row ? fmtCheDo(row.nhiet_do_dau_1, row.nhiet_do_dau_2, row.thoi_gian_say) : "", warning }
  }, [])

  // Effect phản ứng khi người dùng đổi dropdown Dây chuyền/Loại CSR ngay trong form đang mở —
  // trường hợp này luôn là một thay đổi giá trị thật (onChange), effect luôn rerun đúng.
  useEffect(() => {
    if (!factoryId || !formDayChuyen) { setDefaultCheDo(""); setCheDoWarning(null); return }
    let alive = true
    void fetchCheDoSuggestion(factoryId, formDayChuyen, formLoaiCsr).then(({ value, warning }) => {
      if (!alive) return
      setDefaultCheDo(value)
      setCheDoWarning(warning)
    })
    return () => { alive = false }
  }, [factoryId, formDayChuyen, formLoaiCsr, fetchCheDoSuggestion])

  // Auto-fill chế độ sấy vào dòng MỚI còn trống — không sửa ngầm dòng đã lưu trong DB khi Sửa phiếu.
  useEffect(() => {
    if (!defaultCheDo) return
    setRows(prev => prev.map(row =>
      row.che_do_say === "" && !existingRowIds.has(row.id) ? { ...row, che_do_say: defaultCheDo } : row
    ))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCheDo])

  const selectableNgans = ngans.filter(n =>
    isProductSelectableStorageStatus(n.trang_thai) && Number(n.tong_kho || 0) > 0
  )

  // Chỉ tiêu cố định theo loại CSR đang chọn — dùng để tick sẵn khi thêm dòng đo mới
  const chiTieuForCsr = formLoaiCsr ? (CHI_TIEU_BY_CSR[formLoaiCsr] || []) : []

  // Gợi ý ngăn = ngăn thành phẩm được dùng gần nhất ở module Thành phẩm.
  // Nguồn đúng là lot_transactions.created_at (thời điểm nhập liệu thật),
  // không dùng lots.created_at vì đó là thời điểm tạo bản ghi lô, có thể rất cũ
  // nếu lô đã tồn tại từ trước và chỉ được cập nhật/thêm giao dịch sau này.
  const suggestNgan = async (ngayForCalc: string) => {
    if (!factoryId) return null
    const { data: txData } = await supabase
      .from("lot_transactions")
      .select("ngan_id, created_at, lots!inner(factory_id)")
      .eq("lots.factory_id", factoryId)
      .order("created_at", { ascending: false })
      .limit(1)
    const candidateId = (txData?.[0] as { ngan_id?: string } | undefined)?.ngan_id ?? ""
    if (!candidateId || !selectableNgans.some(n => n.id === candidateId)) return null
    const ngan = selectableNgans.find(n => n.id === candidateId)
    return {
      ngan_id: candidateId,
      so_ngay_luu: ngan?.ngay_bd ? calcSoNgayLuu(ngayForCalc, ngan.ngay_bd) : null,
    }
  }

  const resetEditingState = () => {
    setEditingSheetId(null)
    setEditingSheet(null)
    setAddRowsMode(false)
    setExistingRowIds(new Set())
    setExistingRowCount(0)
  }

  const openCreate = async () => {
    const today = getFactoryTodayISO()
    resetEditingState()
    setFormNgay(today)
    setFormDayChuyen("Mủ tạp")
    setFormLoaiCsr("10")
    setDefaultCheDo("")
    setCheDoWarning(null)
    setSaveError(null)

    const [suggestion, cheDo] = await Promise.all([
      suggestNgan(today),
      factoryId ? fetchCheDoSuggestion(factoryId, "Mủ tạp", "10") : Promise.resolve({ value: "", warning: null }),
    ])
    const firstRow = emptyMeasurementRow(currentUserName, cheDo.value, CHI_TIEU_BY_CSR["10"])
    if (suggestion) {
      firstRow.ngan_id = suggestion.ngan_id
      firstRow.so_ngay_luu = suggestion.so_ngay_luu
    }
    setDefaultCheDo(cheDo.value)
    setCheDoWarning(cheDo.warning)
    setRows([firstRow])
    setView("create")
  }

  // Sửa toàn bộ phiếu đã có: nạp lại header + tất cả dòng đo hiện có để chỉnh sửa/xóa/thêm.
  const openEdit = async (sheet: SheetWithRows) => {
    setSaveError(null)
    const { data } = await supabase
      .from("quick_measurement_rows")
      .select("*")
      .eq("sheet_id", sheet.id)
      .order("sort_order")
    const dbRows = (data as QuickMeasurementRow[]) || []

    setFormNgay(sheet.ngay)
    setFormDayChuyen(sheet.day_chuyen || "")
    setFormLoaiCsr(sheet.loai_csr || "")
    setDefaultCheDo("")
    setRows(dbRows.map(rowToDraft))
    setExistingRowIds(new Set(dbRows.map(r => r.id)))
    setExistingRowCount(dbRows.length)
    setEditingSheetId(sheet.id)
    setEditingSheet(sheet)
    setAddRowsMode(false)
    setView("create")
  }

  // Thêm mẫu mới vào phiếu đã có (nhiều người có thể đo chung 1 phiếu trong ngày) —
  // header khóa theo phiếu gốc, chỉ thêm dòng mới, không đụng tới dòng cũ.
  const openAddRows = async (sheet: SheetWithRows) => {
    setSaveError(null)
    setFormNgay(sheet.ngay)
    setFormDayChuyen(sheet.day_chuyen || "")
    setFormLoaiCsr(sheet.loai_csr || "")
    setDefaultCheDo("")
    setCheDoWarning(null)
    setExistingRowIds(new Set())
    setExistingRowCount(sheet.rows?.length ?? 0)

    const csrForRow = sheet.loai_csr ? (CHI_TIEU_BY_CSR[sheet.loai_csr] || []) : []
    const [suggestion, cheDo] = await Promise.all([
      suggestNgan(sheet.ngay),
      factoryId && sheet.day_chuyen
        ? fetchCheDoSuggestion(factoryId, sheet.day_chuyen, sheet.loai_csr || "")
        : Promise.resolve({ value: "", warning: null }),
    ])
    const firstRow = emptyMeasurementRow(currentUserName, cheDo.value, csrForRow)
    if (suggestion) {
      firstRow.ngan_id = suggestion.ngan_id
      firstRow.so_ngay_luu = suggestion.so_ngay_luu
    }
    setDefaultCheDo(cheDo.value)
    setCheDoWarning(cheDo.warning)
    setRows([firstRow])
    setEditingSheetId(sheet.id)
    setEditingSheet(sheet)
    setAddRowsMode(true)
    setView("create")
  }

  // Trang chi tiết mở "Sửa phiếu" / "Thêm mẫu" bằng `?edit=<id>` / `?add=<id>` — xử lý 1 lần sau khi
  // danh sách tải xong (form dùng chung của trang này), quyền kiểm lại như nút trên dòng.
  const intentHandledRef = useRef(false)
  useEffect(() => {
    if (intentHandledRef.current || loading || !currentUser || !sheets.length) return
    intentHandledRef.current = true
    let params: URLSearchParams
    try { params = new URLSearchParams(window.location.search) } catch { return }
    const editId = params.get("edit")
    const addId = params.get("add")
    if (!editId && !addId) return
    window.history.replaceState(null, "", window.location.pathname)
    const target = sheets.find(sh => sh.id === (editId || addId))
    if (!target) { setListError("Không tìm thấy phiếu cần mở (có thể nằm ngoài bộ lọc hiện tại)."); return }
    if (editId) {
      if (currentUser.role === "admin" || (hasPermission(currentUser, "process.edit") && target.created_by === currentUser.id)) void openEdit(target)
      else setListError("Bạn không có quyền sửa phiếu này.")
    } else if (hasPermission(currentUser, "process.create")) {
      void openAddRows(target)
    } else {
      setListError("Bạn không có quyền thêm mẫu vào phiếu.")
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, currentUser, sheets])

  const addRow = () => {
    setRows(r => [...r, emptyMeasurementRow(currentUserName, defaultCheDo, chiTieuForCsr)])
  }

  const removeRow = (id: string) => {
    setRows(r => r.filter(row => row.id !== id))
  }

  const updateRow = (id: string, patch: Partial<MeasurementRowDraft>) => {
    setRows(prev => prev.map(row => {
      if (row.id !== id) return row
      const next = { ...row, ...patch }
      if (patch.ngan_id !== undefined) {
        const ngan = ngans.find(n => n.id === patch.ngan_id)
        next.so_ngay_luu = ngan?.ngay_bd ? calcSoNgayLuu(formNgay, ngan.ngay_bd) : null
      }
      if (patch.chi_tieu !== undefined) {
        const newKQ: Record<string, string> = {}
        patch.chi_tieu.forEach(ct => { newKQ[ct] = next.ket_qua[ct] || "" })
        next.ket_qua = newKQ
      }
      return next
    }))
  }

  const handleSave = async () => {
    if (!factoryId) return
    if (!formNgay) { setSaveError("Vui lòng chọn ngày."); return }
    if (rows.length === 0) { setSaveError("Cần ít nhất 1 dòng đo."); return }

    setSaving(true)
    setSaveError(null)
    try {
      if (editingSheetId && addRowsMode) {
        // Chỉ thêm mẫu mới vào phiếu đã có — không đụng header, không đụng dòng cũ
        const rowPayloads = rows.map((row, i) =>
          rowDraftToPayload(row, editingSheetId, factoryId, existingRowCount + i)
        )
        const { data: insertedRows, error } = await supabase.from("quick_measurement_rows").insert(rowPayloads).select("id")
        if (error) { setSaveError(error.message); return }
        // Gắn bằng chứng KPI theo từng DÒNG MẪU vừa lưu (không phải theo cả phiếu) — 1 phiếu
        // có thể được nhiều người thêm mẫu vào nhiều lần khác nhau; nếu dùng chung ID phiếu,
        // kpi_task_evidence_links.UNIQUE(task_id, module_code, record_id) sẽ âm thầm chặn mọi
        // lần gắn sau (kể cả của người khác) vì trùng khóa với lần gắn đầu tiên.
        setKpiPrompt({ recordId: (insertedRows || []).map((r) => r.id), recordLabel: `Phiếu đo nhanh ${editingSheet?.ma_phieu || ""}` })
      } else if (editingSheetId) {
        // Sửa toàn bộ phiếu: cập nhật header + đồng bộ dòng đo (update/insert/xóa)
        const { error: headerErr } = await supabase
          .from("quick_measurements")
          .update({
            ngay: formNgay,
            day_chuyen: formDayChuyen || null,
            chung_loai: formDayChuyen || null,
            loai_csr: formLoaiCsr || null,
          })
          .eq("id", editingSheetId)
        if (headerErr) { setSaveError(headerErr.message); return }

        const currentIds = new Set(rows.map(r => r.id))
        const removedIds = [...existingRowIds].filter(id => !currentIds.has(id))
        if (removedIds.length) {
          const { error: delErr } = await supabase.from("quick_measurement_rows").delete().in("id", removedIds)
          if (delErr) { setSaveError(delErr.message); return }
        }

        const toUpdate = rows
          .map((row, i) => ({ row, sortOrder: i }))
          .filter(({ row }) => existingRowIds.has(row.id))
        const toInsert = rows
          .map((row, i) => ({ row, sortOrder: i }))
          .filter(({ row }) => !existingRowIds.has(row.id))

        const updateResults = await Promise.all(toUpdate.map(({ row, sortOrder }) =>
          supabase.from("quick_measurement_rows")
            .update({ ...rowDraftToFields(row), so_mau: sortOrder + 1, sort_order: sortOrder })
            .eq("id", row.id)
        ))
        const updateErr = updateResults.find(r => r.error)?.error
        if (updateErr) { setSaveError(updateErr.message); return }

        if (toInsert.length) {
          const insertPayloads = toInsert.map(({ row, sortOrder }) =>
            rowDraftToPayload(row, editingSheetId, factoryId, sortOrder)
          )
          const { error: insertErr } = await supabase.from("quick_measurement_rows").insert(insertPayloads)
          if (insertErr) { setSaveError(insertErr.message); return }
        }
      } else {
        // Tạo phiếu mới — mã tính lại ngay lúc lưu (bản xem trước có thể đã cũ)
        let maPhieu = getMaPhieuPreview(formDayChuyen, formNgay, await fetchNextMaPhieuSeq(factoryId, formDayChuyen, formNgay))

        const { data: sheetData, error: sheetErr } = await supabase
          .from("quick_measurements")
          .insert({
            factory_id: factoryId,
            ma_phieu: maPhieu,
            ngay: formNgay,
            day_chuyen: formDayChuyen || null,
            chung_loai: formDayChuyen || null,
            loai_csr: formLoaiCsr || null,
            created_by: currentUser?.id || null,
          })
          .select("id, created_at")
          .single()

        if (sheetErr || !sheetData) {
          setSaveError(sheetErr?.message || "Lỗi tạo phiếu")
          return
        }

        const sheetId = sheetData.id
        // 2 người lưu cùng lúc có thể cùng nhận 1 mã (không có unique index). Phiếu tạo SAU tự
        // đổi sang số kế tiếp; thử tối đa 3 lần.
        for (let attempt = 0; attempt < 3; attempt++) {
          const { data: dupes, error: dupErr } = await supabase
            .from("quick_measurements")
            .select("id, created_at")
            .eq("factory_id", factoryId)
            .eq("ma_phieu", maPhieu)
            .neq("id", sheetId)
          if (dupErr || !dupes?.length) break
          const someoneEarlier = (dupes as { id: string; created_at: string }[]).some(d =>
            d.created_at < sheetData.created_at || (d.created_at === sheetData.created_at && d.id < sheetId)
          )
          if (!someoneEarlier) break
          const seq = await fetchNextMaPhieuSeq(factoryId, formDayChuyen, formNgay)
          maPhieu = getMaPhieuPreview(formDayChuyen, formNgay, seq)
          const { error: renameErr } = await supabase.from("quick_measurements").update({ ma_phieu: maPhieu }).eq("id", sheetId)
          if (renameErr) break
        }
        const rowPayloads = rows.map((row, i) => rowDraftToPayload(row, sheetId, factoryId, i))
        const { data: insertedRows, error: rowsErr } = await supabase.from("quick_measurement_rows").insert(rowPayloads).select("id")
        if (rowsErr) { setSaveError(rowsErr.message); return }
        setKpiPrompt({ recordId: (insertedRows || []).map((r) => r.id), recordLabel: `Phiếu đo nhanh ${maPhieu}` })
      }

      setView("list")
      resetEditingState()
      void loadSheets(factoryId)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteSheet = async () => {
    if (!factoryId || !delSheet || deletingSheet) return
    if (!canDeleteSheet(delSheet)) { setListError("Bạn không có quyền xóa phiếu này."); return }
    setDeletingSheet(true)
    try {
      const { error } = await supabase
        .from("quick_measurements")
        .delete()
        .eq("id", delSheet.id)
        .eq("factory_id", factoryId)
        .select("id")
        .single()
      if (error) {
        // Không có dòng nào bị xoá (RLS chặn) cũng trả lỗi ở .single() — báo chung là không xoá được.
        setListError(`Không xóa được phiếu: ${error.message}`)
        return
      }
      setDelSheet(null)
      void loadSheets(factoryId)
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setDeletingSheet(false)
    }
  }

  // Chia sẻ nhanh toàn bộ ảnh của 1 phiếu (Zalo/Telegram...) ngay từ danh sách,
  // không cần mở trang chi tiết/in trước.
  const handleQuickShare = async (sheet: SheetWithRows) => {
    const urls = (sheet.rows || []).flatMap(r => r.image_urls || [])
    if (urls.length === 0) {
      setListError("Phiếu này chưa có ảnh để chia sẻ.")
      return
    }
    setSharingSheetId(sheet.id)
    try {
      const files = await Promise.all(urls.slice(0, 6).map(async (url, i) => {
        const res = await fetch(url)
        const blob = await res.blob()
        const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg")
        return new File([blob], `${sheet.ma_phieu || "anh-do-nhanh"}-${i + 1}.${ext}`, { type: blob.type || "image/jpeg" })
      }))

      if (typeof navigator !== "undefined" && navigator.share && navigator.canShare?.({ files })) {
        await navigator.share({ files, title: sheet.ma_phieu || "Phiếu đo nhanh" })
      } else {
        files.forEach(file => {
          const objUrl = URL.createObjectURL(file)
          const a = document.createElement("a")
          a.href = objUrl; a.download = file.name; a.style.display = "none"
          document.body.appendChild(a); a.click(); document.body.removeChild(a)
          setTimeout(() => URL.revokeObjectURL(objUrl), 1000)
        })
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setListError(`Lỗi chia sẻ ảnh: ${(err as Error).message || "Không xác định"}`)
      }
    } finally {
      setSharingSheetId(null)
    }
  }

  const handleImageUpload = async (files: FileList, rowId: string) => {
    if (!factoryId || !files.length) return
    setUploadingRowId(rowId)
    try {
      const newUrls: string[] = []
      const prepareErrors: string[] = []
      for (const rawFile of Array.from(files)) {
        // Chuẩn hóa theo nội dung thật (chuyển HEIC sang JPEG) — xem src/lib/image-format.ts.
        const prepared = await prepareImageForUpload(rawFile)
        if (!prepared.ok) {
          prepareErrors.push(`${rawFile.name}: ${prepared.reason}`)
          continue
        }
        const file = prepared.file
        const ext = file.name.split(".").pop()
        const path = `${factoryId}/process/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
        const { error } = await supabase.storage.from("order-files").upload(path, file, { upsert: false, contentType: file.type })
        if (!error) {
          const { data: urlData } = supabase.storage.from("order-files").getPublicUrl(path)
          newUrls.push(urlData.publicUrl)
        }
      }
      if (prepareErrors.length) {
        setSaveError(`Một số ảnh không tải được:\n${prepareErrors.join("\n")}`)
      }
      if (newUrls.length) {
        // Cập nhật theo state MỚI NHẤT — đọc `rows` của closure sẽ ghi đè ảnh vừa thêm ở lượt khác.
        setRows(prev => prev.map(row =>
          row.id === rowId ? { ...row, image_urls: [...row.image_urls, ...newUrls].slice(0, 6) } : row
        ))
      }
    } finally {
      setUploadingRowId(null)
    }
  }

  const readFileAsBase64 = async (file: File) => {
    const arrayBuffer = await file.arrayBuffer()
    const uint8 = new Uint8Array(arrayBuffer)
    let binary = ""
    for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i])
    return btoa(binary)
  }

  // Upload nhiều ảnh cùng lúc (vd chụp cả đồng hồ Po lẫn Mo trong 1 lượt) —
  // mỗi ảnh gọi OCR tự nhận dạng thiết bị riêng, AI tự xác định ảnh nào là Po/Mo
  // và điền đúng vào ô kết quả tương ứng, không cần người dùng chọn trước.
  const handleOcrAutoUpload = async (files: FileList, rowId: string) => {
    if (!factoryId || !files.length) return
    const key = `${rowId}-auto`
    setOcrLoadingKey(key)
    try {
      // Chuẩn hóa TRƯỚC khi vừa gửi OCR vừa upload: ảnh HEIC không chỉ hỏng khi nhúng PDF mà
      // còn làm OCR thất bại (gửi lên Gemini với mimeType khai báo sai). Xem
      // src/lib/image-format.ts.
      const preparedFiles: File[] = []
      const prepareErrors: string[] = []
      for (const rawFile of Array.from(files)) {
        const prepared = await prepareImageForUpload(rawFile)
        if (prepared.ok) preparedFiles.push(prepared.file)
        else prepareErrors.push(`${rawFile.name}: ${prepared.reason}`)
      }

      // Lỗi của 1 ảnh (mạng, phản hồi không phải JSON, hết phiên...) chỉ đánh dấu ảnh đó lỗi —
      // không được làm hỏng cả lượt (ảnh vẫn phải được lưu).
      const results = await Promise.all(preparedFiles.map(async (file) => {
        try {
          const imageBase64 = await readFileAsBase64(file)
          const mimeType = file.type || "image/jpeg"
          const res = await authFetch("/api/process/ocr-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageBase64, mimeType }),
          })
          const json = await res.json().catch(() => ({ error: `Máy chủ trả lỗi ${res.status}` })) as { chiTieu?: string; value?: number; error?: string }
          return { file, json }
        } catch (err) {
          return { file, json: { error: err instanceof Error ? err.message : "Lỗi mạng" } as { chiTieu?: string; value?: number; error?: string } }
        }
      }))

      // Chỉ tiêu được phép theo Loại CSR đang chọn (vd CSR L/3L không đo Mo).
      const allowedCts = formLoaiCsr ? (CHI_TIEU_BY_CSR[formLoaiCsr] || []) : null
      const patchKetQua: Record<string, string> = {}
      const detectedCts: string[] = []
      const failedNames: string[] = []
      const rejectedMsgs: string[] = []
      const newUrls: string[] = []

      for (const { file, json } of results) {
        // Vẫn lưu ảnh dù OCR không nhận dạng được, để không mất ảnh hiện trường đã chụp
        const ext = file.name.split(".").pop() || "jpg"
        const path = `${factoryId}/process/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
        const { error: uploadErr } = await supabase.storage.from("order-files").upload(path, file, { upsert: false, contentType: file.type })
        if (!uploadErr) {
          const { data: urlData } = supabase.storage.from("order-files").getPublicUrl(path)
          newUrls.push(urlData.publicUrl)
        }

        if (json.error || json.value == null || !json.chiTieu) {
          failedNames.push(json.error ? `${file.name}: ${json.error}` : file.name)
          continue
        }
        if (allowedCts && !allowedCts.includes(json.chiTieu)) {
          rejectedMsgs.push(`Ảnh ${file.name} là ${json.chiTieu} nhưng CSR ${formLoaiCsr} không đo ${json.chiTieu} — không tự điền.`)
          continue
        }
        patchKetQua[json.chiTieu] = String(json.value)
        detectedCts.push(json.chiTieu)
      }

      // Điền thẳng kết quả và gắn ảnh vào dòng đo — không qua bước xác nhận.
      // Chỉ tiêu được AI nhận dạng nhưng chưa tick sẵn thì tự động tick luôn.
      setRows(prev => prev.map(row => {
        if (row.id !== rowId) return row
        return {
          ...row,
          chi_tieu: Array.from(new Set([...row.chi_tieu, ...detectedCts])),
          ket_qua: { ...row.ket_qua, ...patchKetQua },
          image_urls: [...row.image_urls, ...newUrls].slice(0, 6),
        }
      }))

      if (detectedCts.length) {
        setOcrToast(`Đã tự nhận dạng và điền ${detectedCts.map(ct => `${ct}=${patchKetQua[ct]}`).join(", ")} từ ảnh`)
        setTimeout(() => setOcrToast(null), 3500)
      }
      if (failedNames.length || prepareErrors.length || rejectedMsgs.length) {
        const parts: string[] = []
        if (failedNames.length) {
          parts.push(`Không nhận dạng được ${failedNames.length} ảnh (${failedNames.join(", ")}), vui lòng nhập tay.`)
        }
        parts.push(...rejectedMsgs)
        if (prepareErrors.length) parts.push(`Một số ảnh không tải được:\n${prepareErrors.join("\n")}`)
        setSaveError(parts.join("\n"))
      }
    } finally {
      setOcrLoadingKey(null)
    }
  }

  // ── Quyền thao tác ──────────────────────────────────────────────────────────
  // admin luôn qua được (hasPermission tự return true cho role admin)
  const canCreate = hasPermission(currentUser, "process.create")
  const canEditSheet = (sheet: SheetWithRows) =>
    currentUser?.role === "admin" ||
    (hasPermission(currentUser, "process.edit") && !!currentUser && sheet.created_by === currentUser.id)
  // Xoá: admin mọi phiếu; người có process.delete chỉ phiếu do chính mình tạo (khớp RLS 20261028).
  const canDeleteSheet = (sheet: SheetWithRows) =>
    currentUser?.role === "admin" ||
    (hasPermission(currentUser, "process.delete") && !!currentUser && sheet.created_by === currentUser.id)

  // Lọc theo ô tìm (mã phiếu, người đo, dây chuyền, CSR) — chạy trên dữ liệu đã tải
  const visibleSheets = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sheets
    return sheets.filter(sh => {
      const hay = [
        sh.ma_phieu, sh.day_chuyen, sh.loai_csr ? `csr ${sh.loai_csr}` : "",
        ...(sh.rows || []).map(r => r.nguoi_do),
      ].filter(Boolean).join(" ").toLowerCase()
      return hay.includes(q)
    })
  }, [sheets, search])

  const listStats = useMemo(() => {
    const allRows = visibleSheets.flatMap(sh => sh.rows || [])
    const pick = (ct: string) => allRows
      .map(r => (r.ket_qua || {})[ct])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    return { sheets: visibleSheets.length, rows: allRows.length, po: avgOf(pick("Po")), mo: avgOf(pick("Mo")) }
  }, [visibleSheets])

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Quét QR: URL trang chi tiết / trang in của phiếu ⇒ mở chi tiết; chuỗi khác ⇒ đưa vào ô tìm.
  const handleScanDecoded = (text: string) => {
    setScanning(false)
    const raw = text.trim()
    const id = raw.match(DETAIL_PATH_RE)?.[1] || raw.match(PRINT_ID_RE)?.[1]
    if (id) {
      router.push(`/dashboard/process/measurements/${id}`)
      return
    }
    setSearch(raw)
  }

  // Đổi "Ngày đo" → tính lại số ngày lưu của mọi dòng đã chọn ngăn (trước đây chỉ tính khi đổi ngăn).
  const changeFormNgay = (ngay: string) => {
    setFormNgay(ngay)
    setRows(prev => prev.map(row => {
      if (!row.ngan_id) return row
      const ngan = ngans.find(n => n.id === row.ngan_id)
      return { ...row, so_ngay_luu: ngan?.ngay_bd && ngay ? calcSoNgayLuu(ngay, ngan.ngay_bd) : null }
    }))
  }

  // ── RENDER ──────────────────────────────────────────────────────────────────

  const maPhieuBadge = editingSheetId
    ? (editingSheet?.ma_phieu || "")
    : (formNgay && formDayChuyen ? getMaPhieuPreview(formDayChuyen, formNgay, nextCount) : "")

  const saveButtonLabel = saving
    ? "Đang lưu..."
    : addRowsMode ? "Thêm mẫu" : editingSheetId ? "Lưu thay đổi" : "Lưu phiếu"

  // Lightbox phóng to ảnh — dùng chung cho mọi view
  const lightbox = zoomImageUrl ? (
    <div
      className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center"
      onClick={() => setZoomImageUrl(null)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={zoomImageUrl}
        alt="Phóng to"
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-2xl shadow-2xl"
        onClick={e => e.stopPropagation()}
      />
      <button
        onClick={() => setZoomImageUrl(null)}
        className="absolute top-4 right-4 p-2 bg-white/20 hover:bg-white/30 text-white rounded-full transition-colors"
      >
        <X size={20} />
      </button>
    </div>
  ) : null

  if (view === "create") {
    return (
      <ProcessShell>
        {lightbox}
        {saveError && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 bg-red-600 text-white rounded-2xl shadow-2xl max-w-xl">
            <AlertTriangle size={16} className="shrink-0" />
            <span className="text-sm font-bold">{saveError}</span>
            <button onClick={() => setSaveError(null)} className="ml-2 hover:opacity-70"><X size={14} /></button>
          </div>
        )}
        {ocrToast && (
          <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-3 rounded-xl shadow-lg text-white text-sm font-bold bg-emerald-600">
            <Camera size={14} /> {ocrToast}
          </div>
        )}

        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => { setView("list"); resetEditingState() }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
            <ChevronLeft size={16} /> Quay lại
          </button>
          <h2 className="text-xl font-extrabold text-slate-800">
            {addRowsMode ? "Thêm mẫu vào phiếu" : editingSheetId ? "Sửa phiếu đo nhanh" : "Tạo phiếu đo nhanh"}
          </h2>
          {maPhieuBadge && (
            <span className="ml-2 px-3 py-1 bg-teal-50 border border-teal-200 text-teal-700 font-mono text-sm font-bold rounded-xl">
              {maPhieuBadge}
            </span>
          )}
        </div>

        {/* Header form */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
          <h3 className="text-sm font-extrabold text-slate-700 mb-4">Thông tin phiếu</h3>
          {addRowsMode ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-xs font-bold text-slate-500 block mb-1">Ngày</span>
                <span className="font-bold text-slate-800">{formatDate(formNgay)}</span>
              </div>
              <div>
                <span className="text-xs font-bold text-slate-500 block mb-1">Dây chuyền</span>
                <span className="font-bold text-slate-800">{formDayChuyen || "—"}</span>
              </div>
              <div>
                <span className="text-xs font-bold text-slate-500 block mb-1">Loại CSR</span>
                <span className="font-bold text-slate-800">{formLoaiCsr || "—"}</span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày <span className="text-red-500">*</span></label>
                <input type="date" value={formNgay} onChange={e => changeFormNgay(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Dây chuyền</label>
                <select value={formDayChuyen}
                  onChange={e => { setFormDayChuyen(e.target.value); setFormLoaiCsr("") }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500">
                  <option value="">— Chọn —</option>
                  <option value="Mủ tạp">Mủ tạp</option>
                  <option value="Mủ nước">Mủ nước</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại CSR</label>
                <select value={formLoaiCsr} onChange={e => setFormLoaiCsr(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500">
                  <option value="">— Chọn —</option>
                  {(CSR_BY_DAY_CHUYEN[formDayChuyen] ?? ALL_CSR_TYPES).map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>
          )}
          {cheDoWarning && (
            <p className="mt-3 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              ⚠ {cheDoWarning}
            </p>
          )}
        </div>

        {/* Row form */}
        <div className="space-y-4 mb-4">
          {rows.map((row, i) => (
            <MeasurementRowForm
              key={row.id}
              row={row}
              index={i}
              chiTieuOptions={chiTieuForCsr}
              caSxOptions={caSxOptions}
              selectableNgans={selectableNgans}
              isMatTap={formDayChuyen === "Mủ tạp"}
              ngay={formNgay}
              uploadingRowId={uploadingRowId}
              ocrLoadingKey={ocrLoadingKey}
              fileInputRef={fileInputRef}
              activeRowRef={activeRowRef}
              onChange={(patch) => updateRow(row.id, patch)}
              onRemove={() => removeRow(row.id)}
              onPickImage={() => {
                activeRowRef.current = row.id
                fileInputRef.current?.click()
              }}
              onOcrImagesAuto={() => {
                ocrActiveRowRef.current = row.id
                ocrAutoFileInputRef.current?.click()
              }}
              onZoomImage={setZoomImageUrl}
            />
          ))}
        </div>

        {/* Hidden file inputs */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => {
            if (e.target.files && activeRowRef.current) {
              void handleImageUpload(e.target.files, activeRowRef.current)
              e.target.value = ""
            }
          }}
        />
        <input
          ref={ocrAutoFileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => {
            if (e.target.files && e.target.files.length && ocrActiveRowRef.current) {
              void handleOcrAutoUpload(e.target.files, ocrActiveRowRef.current)
              e.target.value = ""
            }
          }}
        />

        <div className="flex items-center gap-3">
          <button onClick={addRow}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-all text-sm">
            <Plus size={14} /> Thêm dòng
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white font-bold rounded-xl shadow-md transition-all">
            {saveButtonLabel}
          </button>
        </div>
      </ProcessShell>
    )
  }

  // LIST VIEW
  const fieldCls = "h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-mod-600"
  const filterCount = [search.trim(), filterFrom, filterTo, filterDayChuyen].filter(Boolean).length
  const expandableIds = visibleSheets.filter(sh => (sh.rows?.length || 0) > 0).map(sh => sh.id)

  return (
    <ProcessShell
      banner={
        <PageHeaderBanner
          title="Đo nhanh chỉ tiêu"
          subtitle="Phiếu đo Po, Mooney tại dây chuyền"
          theme="teal"
          icon={ClipboardCheck}
          action={canCreate ? (
            <button
              onClick={() => void openCreate()}
              className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-bold text-teal-700 shadow-sm transition-colors hover:bg-teal-50"
            >
              <Plus size={16} /> Tạo phiếu mới
            </button>
          ) : undefined}
        />
      }
    >
      {lightbox}
      <QrScanPortal
        open={scanning}
        onClose={() => setScanning(false)}
        onDecoded={handleScanDecoded}
        hintText="Đưa camera vào mã QR trên phiếu đo nhanh đã in"
      />
      {listError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 bg-red-600 text-white rounded-2xl shadow-2xl max-w-xl">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="text-sm font-bold">{listError}</span>
          <button onClick={() => setListError(null)} className="ml-2 hover:opacity-70"><X size={14} /></button>
        </div>
      )}
      {kpiPrompt && (
        <KpiLinkPrompt
          factoryId={factoryId}
          moduleCode="process:measurement"
          recordId={kpiPrompt.recordId}
          recordLabel={kpiPrompt.recordLabel}
          recordUrl="/dashboard/process/measurements"
          onDone={() => setKpiPrompt(null)}
        />
      )}

      <FilterBar layout="grid" activeCount={filterCount}>
        <div className="flex h-10 w-full items-center gap-2 rounded-xl border border-slate-300 bg-white pl-3 pr-1 focus-within:border-mod-600 sm:col-span-2">
          <Search size={15} className="shrink-0 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm mã phiếu, người đo, CSR..."
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} className="shrink-0 text-slate-400 hover:text-slate-600" aria-label="Xóa ô tìm">
              <X size={14} />
            </button>
          )}
          <QrScanButton onClick={() => setScanning(true)} title="Quét QR phiếu đo nhanh" />
        </div>
        <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className={fieldCls} title="Từ ngày" aria-label="Từ ngày" />
        <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className={fieldCls} title="Đến ngày" aria-label="Đến ngày" />
        <select value={filterDayChuyen} onChange={e => setFilterDayChuyen(e.target.value)} className={fieldCls} aria-label="Dây chuyền">
          <option value="">Tất cả dây chuyền</option>
          <option value="Mủ tạp">Mủ tạp</option>
          <option value="Mủ nước">Mủ nước</option>
        </select>
        <button
          onClick={() => { setSearch(""); setFilterFrom(""); setFilterTo(""); setFilterDayChuyen("") }}
          disabled={filterCount === 0}
          className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-500"
        >
          Xóa lọc
        </button>
      </FilterBar>

      <StatGrid cols={4}>
        <StatCard icon={ClipboardCheck} label="Số phiếu" value={listStats.sheets} loading={loading} />
        <StatCard icon={Layers} label="Số mẫu đo" value={listStats.rows} loading={loading} />
        <StatCard icon={Activity} label="Po trung bình" value={listStats.po ?? "—"} loading={loading} />
        <StatCard icon={FlaskConical} label="Mooney trung bình" value={listStats.mo ?? "—"} loading={loading} />
      </StatGrid>

      <ResponsiveTableWrapper>
        {loading ? (
          <ListState kind="loading" message="Đang tải danh sách phiếu..." />
        ) : loadError ? (
          <ListState kind="error" message={`Không tải được danh sách phiếu: ${loadError}`} onRetry={() => { if (factoryId) void loadSheets(factoryId) }} />
        ) : visibleSheets.length === 0 ? (
          <ListState kind="empty" message={sheets.length ? "Không có phiếu phù hợp bộ lọc." : "Chưa có phiếu đo nào"} />
        ) : (
          <>
            <div className="flex justify-end border-b border-slate-100 px-3 py-2">
              <ExpandAllToggle
                allExpanded={expandableIds.length > 0 && expandableIds.every(id => expanded.has(id))}
                onExpandAll={() => setExpanded(new Set(expandableIds))}
                onCollapseAll={() => setExpanded(new Set())}
                disabled={expandableIds.length === 0}
              />
            </div>
            <table className="enterprise-table dense min-w-[900px]">
              <thead>
                <tr>
                  <th>Mã phiếu</th>
                  <th>Ngày</th>
                  <th>Dây chuyền / CSR</th>
                  <th>Người đo</th>
                  <th className="text-right">Số mẫu</th>
                  <ExpandHeaderCell>Thao tác</ExpandHeaderCell>
                </tr>
              </thead>
              <tbody>
                {visibleSheets.map(sheet => {
                  const sheetRows = [...(sheet.rows || [])].sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0))
                  const nguoiDoList = Array.from(new Set(sheetRows.map(r => r.nguoi_do).filter(Boolean)))
                  const cts = Array.from(new Set(sheetRows.flatMap(r => r.chi_tieu || [])))
                  const detailHref = `/dashboard/process/measurements/${sheet.id}`
                  return (
                    <ExpandableRow
                      key={sheet.id}
                      expanded={expanded.has(sheet.id)}
                      onToggle={() => toggleExpanded(sheet.id)}
                      canExpand={sheetRows.length > 0}
                      colSpan={6}
                      label="Xem dòng đo"
                      detail={
                        <table className="enterprise-table dense">
                          <thead>
                            <tr>
                              <th className="w-10">#</th>
                              <th>Thùng / Lô / Mẫu</th>
                              <th>Chế độ sấy</th>
                              {cts.map(ct => <th key={ct} className="text-right">{ct}</th>)}
                              <th>Ca SX</th>
                              <th>Ngăn / Ngày lưu</th>
                              <th>Người đo</th>
                              <th className="text-right">Ảnh</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sheetRows.map((r, idx) => {
                              const ngan = ngans.find(n => n.id === r.ngan_id)
                              const kq = r.ket_qua || {}
                              return (
                                <tr key={r.id}>
                                  <td className="text-slate-500">{idx + 1}</td>
                                  <td className="whitespace-nowrap">{[r.thung, r.lo, r.mau].filter(Boolean).join(" / ") || "—"}</td>
                                  <td className="whitespace-nowrap font-code">{r.che_do_say || "—"}</td>
                                  {cts.map(ct => (
                                    <td key={ct} className="text-right font-code font-semibold">
                                      {(r.chi_tieu || []).includes(ct) ? fmtKq(kq[ct]) : ""}
                                    </td>
                                  ))}
                                  <td className="whitespace-nowrap">{r.ca_sx || "—"}</td>
                                  <td className="whitespace-nowrap">
                                    {ngan ? `${ngan.ma_ngan} – ${ngan.ten_ngan}` : "—"}
                                    {r.so_ngay_luu != null && <span className="ml-1 text-xs text-slate-500">({r.so_ngay_luu} ngày)</span>}
                                  </td>
                                  <td className="whitespace-nowrap">{r.nguoi_do || "—"}</td>
                                  <td className="text-right">{r.image_urls?.length || 0}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      }
                      endCell={
                        <div className="flex items-center justify-end" onClick={e => e.stopPropagation()}>
                          <IconActionGroup>
                            <RowAction kind="view" label="Xem chi tiết phiếu" href={detailHref} />
                            <RowAction kind="print" label="In phiếu" href={`/dashboard/process/print?sheetId=${sheet.id}`} target="_blank" />
                            <IconAction
                              icon={Share2}
                              label="Chia sẻ ảnh nhanh"
                              tone="neutral"
                              loading={sharingSheetId === sheet.id}
                              disabled={sharingSheetId === sheet.id}
                              onClick={() => void handleQuickShare(sheet)}
                            />
                            {canEditSheet(sheet) && <RowAction kind="edit" label="Sửa phiếu" onClick={() => void openEdit(sheet)} />}
                            {canCreate && <RowAction kind="add" label="Thêm mẫu vào phiếu này" onClick={() => void openAddRows(sheet)} />}
                            {canDeleteSheet(sheet) && <RowAction kind="delete" label="Xóa phiếu" onClick={() => setDelSheet(sheet)} />}
                          </IconActionGroup>
                        </div>
                      }
                    >
                      <td className="whitespace-nowrap font-bold text-slate-800">
                        <a href={detailHref} onClick={e => e.stopPropagation()} className="font-code hover:text-brand-700 hover:underline">
                          {sheet.ma_phieu || "—"}
                        </a>
                      </td>
                      <td className="whitespace-nowrap text-slate-600">{formatDate(sheet.ngay)}</td>
                      <td className="whitespace-nowrap text-slate-700">
                        {sheet.day_chuyen || "—"}
                        {sheet.loai_csr && <span className="ml-1 text-slate-500">· CSR {sheet.loai_csr}</span>}
                      </td>
                      <td className="max-w-[220px] truncate text-slate-600" title={nguoiDoList.join(", ")}>
                        {nguoiDoList.length ? nguoiDoList.join(", ") : "—"}
                      </td>
                      <td className="text-right font-semibold text-slate-700">{sheetRows.length}</td>
                    </ExpandableRow>
                  )
                })}
              </tbody>
            </table>
          </>
        )}
      </ResponsiveTableWrapper>

      {delSheet && (
        <ModalShell
          title="Xác nhận xóa phiếu"
          onClose={() => { if (!deletingSheet) setDelSheet(null) }}
          maxWidth="sm"
          footer={
            <>
              <button onClick={() => setDelSheet(null)} disabled={deletingSheet}
                className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl disabled:opacity-60">
                Hủy
              </button>
              <button onClick={() => void handleDeleteSheet()} disabled={deletingSheet}
                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-bold rounded-xl shadow-md transition-all">
                {deletingSheet ? "Đang xóa..." : "Xóa phiếu"}
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">
            Xóa phiếu <span className="font-mono font-bold text-slate-800">{delSheet.ma_phieu || "—"}</span>{" "}
            ({delSheet.rows?.length || 0} mẫu, ngày {formatDate(delSheet.ngay)})? Toàn bộ dòng đo của phiếu sẽ bị xóa
            và không khôi phục được.
          </p>
        </ModalShell>
      )}
    </ProcessShell>
  )
}

// ── Sub-component: dòng đo ────────────────────────────────────────────────────

type MeasurementRowFormProps = {
  row: MeasurementRowDraft
  index: number
  chiTieuOptions: string[]
  caSxOptions: string[]
  selectableNgans: NganItem[]
  isMatTap: boolean
  ngay: string
  uploadingRowId: string | null
  ocrLoadingKey: string | null
  fileInputRef: React.RefObject<HTMLInputElement | null>
  activeRowRef: React.RefObject<string | null>
  onChange: (patch: Partial<MeasurementRowDraft>) => void
  onRemove: () => void
  onPickImage: () => void
  onOcrImagesAuto: () => void
  onZoomImage: (url: string) => void
}

function MeasurementRowForm({
  row, index, chiTieuOptions, caSxOptions, selectableNgans, isMatTap,
  uploadingRowId, ocrLoadingKey, onChange, onRemove, onPickImage, onOcrImagesAuto, onZoomImage
}: MeasurementRowFormProps) {
  const [showUploadMenu, setShowUploadMenu] = useState(false)

  const toggleCT = (ct: string) => {
    const current = row.chi_tieu || []
    const next = current.includes(ct)
      ? current.filter(c => c !== ct)
      : [...current, ct]
    onChange({ chi_tieu: next })
  }

  const isRowUploading = uploadingRowId === row.id
  const isRowOcrLoading = ocrLoadingKey?.startsWith(`${row.id}-`) ?? false

  const handleTileClick = () => {
    if (row.chi_tieu.length === 0) {
      onPickImage()
    } else {
      setShowUploadMenu(v => !v)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-teal-50 border-b border-teal-100">
        <span className="text-sm font-extrabold text-teal-700">Mẫu #{index + 1}</span>
        <button onClick={onRemove} className="p-1 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-lg">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="p-5 space-y-4">
        {/* Row 1: chi_tieu + thung/lo/mau/che_do_say/ca_sx — cùng breakpoint 2→3 cột với header phiếu, nới rộng thêm ở màn hình lớn.
            xl:grid-cols-7 vì Chỉ tiêu chiếm 2 cột + 5 field còn lại (Thùng/Lô/Mẫu/Chế độ sấy/Ca SX) mỗi field 1 cột = 7,
            để Ca SX nằm cùng dòng với Chỉ tiêu thay vì tràn xuống dòng riêng. */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-4">
          <div className="col-span-2 md:col-span-1 xl:col-span-2">
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Chỉ tiêu</label>
            {chiTieuOptions.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {chiTieuOptions.map(ct => (
                  <button key={ct} type="button"
                    onClick={() => toggleCT(ct)}
                    className={
                      "px-3 py-1 rounded-lg text-sm font-bold border transition-all " +
                      (row.chi_tieu.includes(ct)
                        ? "bg-teal-600 text-white border-teal-600"
                        : "bg-white text-slate-600 border-slate-300 hover:border-teal-400")
                    }
                  >
                    {ct}
                  </button>
                ))}
              </div>
            ) : (
              <span className="text-xs text-slate-400">Chọn loại CSR ở trên</span>
            )}
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Thùng</label>
            <input value={row.thung} onChange={e => onChange({ thung: e.target.value })}
              placeholder="Số thùng" className="w-full px-2 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Lô</label>
            <input value={row.lo} onChange={e => onChange({ lo: e.target.value })}
              placeholder="Số lô" className="w-full px-2 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Mẫu</label>
            <input value={row.mau} onChange={e => onChange({ mau: e.target.value })}
              placeholder="Số mẫu" className="w-full px-2 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Chế độ sấy</label>
            <input value={row.che_do_say} onChange={e => onChange({ che_do_say: e.target.value })}
              placeholder="VD: 122-119-9,5" className="w-full px-2 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Ca SX</label>
            <select value={row.ca_sx} onChange={e => onChange({ ca_sx: e.target.value })}
              className="w-full px-2 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500">
              <option value="">—</option>
              {caSxOptions.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>

        {/* Row 2: ket_qua + ngan (if mat tap, mở rộng col-span-2 cho dễ đọc tên ngăn dài) + ghi_chu.
            "Người đo" đã bỏ khỏi form — luôn tự điền theo tài khoản đăng nhập (row.nguoi_do), không
            cần hiển thị/sửa tay; vẫn hiện ở cột "Người đo" trong bảng danh sách/chi tiết phiếu. */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          {row.chi_tieu.map(ct => (
            <div key={ct}>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Kết quả {ct}</label>
              <input type="number" step="0.1"
                value={row.ket_qua[ct] || ""}
                onChange={e => onChange({ ket_qua: { ...row.ket_qua, [ct]: e.target.value } })}
                placeholder={`${ct}...`}
                className="w-full px-2 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500" />
            </div>
          ))}
          {isMatTap && (
            <div className="col-span-2">
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngăn lưu (Mủ tạp)</label>
              <select value={row.ngan_id} onChange={e => onChange({ ngan_id: e.target.value })}
                className="w-full px-2 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500">
                <option value="">— Chọn ngăn —</option>
                {selectableNgans.map(n => (
                  <option key={n.id} value={n.id}>
                    {n.ma_ngan} – {n.ten_ngan} ({shortNganStatus(n.trang_thai)} · {Number(n.tong_kho || 0).toLocaleString("vi-VN")} kg)
                  </option>
                ))}
              </select>
              {row.ngan_id && row.so_ngay_luu != null && (
                <span className="text-xs text-teal-600 font-bold mt-1 block">{row.so_ngay_luu} ngày lưu</span>
              )}
            </div>
          )}
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Ghi chú</label>
            <input value={row.ghi_chu} onChange={e => onChange({ ghi_chu: e.target.value })}
              placeholder="Ghi chú..." className="w-full px-2 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500" />
          </div>
        </div>

        {/* Row 3: hình ảnh — 1 khối upload duy nhất, hỗ trợ OCR ngay khi thêm ảnh */}
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Hình ảnh / OCR (tối đa 6)</label>
          <div className="flex flex-wrap gap-2 items-center">
            {row.image_urls.map((url, j) => (
              <div key={j} className="relative group">
                <button type="button" onClick={() => onZoomImage(url)} className="focus:outline-none">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Ảnh ${j + 1}`}
                    className="w-14 h-14 object-cover rounded-xl border border-slate-200 hover:opacity-80 transition-opacity" />
                </button>
                <button
                  onClick={() => onChange({ image_urls: row.image_urls.filter((_, k) => k !== j) })}
                  className="absolute -top-1.5 -right-1.5 p-0.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
            {row.image_urls.length < 6 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={handleTileClick}
                  disabled={isRowUploading || isRowOcrLoading}
                  title={row.chi_tieu.length > 0 ? "Chụp/tải ảnh — có thể OCR tự điền kết quả" : "Tải ảnh"}
                  className="w-14 h-14 flex flex-col items-center justify-center border-2 border-dashed border-slate-300 hover:border-teal-400 rounded-xl text-slate-400 hover:text-teal-500 transition-all disabled:opacity-50"
                >
                  {isRowUploading || isRowOcrLoading ? (
                    <Upload size={14} className="animate-pulse" />
                  ) : (
                    <ImageIcon size={14} />
                  )}
                </button>
                {showUploadMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowUploadMenu(false)} />
                    <div className="absolute z-20 bottom-full mb-2 left-0 w-64 bg-white border border-slate-200 rounded-xl shadow-xl p-1.5 space-y-0.5">
                      <button type="button"
                        onClick={() => { setShowUploadMenu(false); onOcrImagesAuto() }}
                        className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-teal-50 hover:text-teal-700 rounded-lg transition-colors"
                      >
                        <Camera size={13} /> OCR ảnh ({row.chi_tieu.join(" + ")}) — chọn nhiều ảnh cùng lúc, AI tự nhận dạng
                      </button>
                      <button type="button"
                        onClick={() => { setShowUploadMenu(false); onPickImage() }}
                        className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                      >
                        <ImageIcon size={13} /> Ảnh khác (không OCR)
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
