"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  AlertTriangle, Camera, ChevronLeft, ClipboardCheck, Eye, Pencil, Plus,
  Printer, Share2, Trash2, X, ImageIcon, Upload,
} from "lucide-react"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { isProductSelectableStorageStatus } from "@/lib/storage-status"
import { ProcessShell } from "../_components/process-shell"
import { FilterBar } from "@/app/dashboard/_components/filter-bar"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
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

type ViewMode = "list" | "create" | "view"

function formatDate(d: string) {
  const [y, m, day] = d.split("-")
  return `${day}/${m}/${y}`
}

function getMaPhieuPreview(day_chuyen: string, ngay: string, count: number) {
  if (!ngay) return ""
  const prefix = getMaPhieuPrefix(day_chuyen)
  return `${prefix}-${formatDdMmYy(ngay)}/${String(count).padStart(3, "0")}`
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
      Object.entries(row.ket_qua).map(([k, v]) => [k, v === "" ? null : Number(v)])
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

export default function MeasurementsPage() {
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [sheets, setSheets] = useState<SheetWithRows[]>([])
  const [loading, setLoading] = useState(true)
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
  const [selected, setSelected] = useState<SheetWithRows | null>(null)
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null)

  // create / sửa / thêm mẫu — dùng chung 1 form
  const [formNgay, setFormNgay] = useState(new Date().toISOString().slice(0, 10))
  const [formDayChuyen, setFormDayChuyen] = useState("")
  const [formLoaiCsr, setFormLoaiCsr] = useState("")
  const [defaultCheDo, setDefaultCheDo] = useState("")
  const [cheDoWarning, setCheDoWarning] = useState<string | null>(null)
  // Buộc effect fetch chế độ sấy chạy lại mỗi lần mở form tạo/thêm mẫu, kể cả khi
  // formDayChuyen/formLoaiCsr trùng giá trị mặc định của phiên trước (không đổi state
  // thì effect không tự rerun) — tránh gợi ý bị "kẹt" ở giá trị cũ/rỗng.
  const [cheDoRefreshTick, setCheDoRefreshTick] = useState(0)
  const [rows, setRows] = useState<MeasurementRowDraft[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [nextCount, setNextCount] = useState(1)

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

  // Load sheets
  const loadSheets = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      let q = supabase
        .from("quick_measurements")
        .select("*, rows:quick_measurement_rows(*)")
        .eq("factory_id", fid)
        .order("ngay", { ascending: false })
        .order("created_at", { ascending: false })

      if (filterFrom) q = q.gte("ngay", filterFrom)
      if (filterTo) q = q.lte("ngay", filterTo)
      if (filterDayChuyen) q = q.eq("day_chuyen", filterDayChuyen)

      const { data } = await q
      setSheets((data as SheetWithRows[]) || [])
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
    const prefix = getMaPhieuPrefix(formDayChuyen)
    const loadCount = async () => {
      const { data } = await supabase
        .from("quick_measurements")
        .select("ma_phieu")
        .eq("factory_id", factoryId)
        .eq("ngay", formNgay)
        .like("ma_phieu", `${prefix}-${formatDdMmYy(formNgay)}/%`)
      setNextCount((data?.length || 0) + 1)
    }
    void loadCount()
  }, [factoryId, formNgay, formDayChuyen])

  // Lấy chế độ sấy mặc định từ process_params gần nhất.
  // Chạy song song 2 query: bản khớp đúng Loại CSR đang chọn + bản mới nhất của cả dây chuyền
  // (bất kể CSR) — vì cột loai_csr là optional, bản mới nhất có thể bị bỏ sót nếu lọc cứng theo CSR.
  useEffect(() => {
    if (!factoryId || !formDayChuyen) { setDefaultCheDo(""); setCheDoWarning(null); return }
    const fetchCheDo = async () => {
      const selectCols = "nhiet_do_dau_1, nhiet_do_dau_2, thoi_gian_say, ngay, created_at, loai_csr"
      const [csrRes, anyRes] = await Promise.all([
        formLoaiCsr
          ? supabase.from("process_params").select(selectCols)
              .eq("factory_id", factoryId).eq("day_chuyen", formDayChuyen).eq("loai_csr", formLoaiCsr)
              .order("ngay", { ascending: false }).order("created_at", { ascending: false }).limit(1)
          : Promise.resolve({ data: null as CheDoRow[] | null }),
        supabase.from("process_params").select(selectCols)
          .eq("factory_id", factoryId).eq("day_chuyen", formDayChuyen)
          .order("ngay", { ascending: false }).order("created_at", { ascending: false }).limit(1),
      ])
      const csrMatch = (csrRes.data?.[0] as CheDoRow | undefined) ?? null
      const latestAny = (anyRes.data?.[0] as CheDoRow | undefined) ?? null

      if (!formLoaiCsr) {
        setDefaultCheDo(latestAny ? fmtCheDo(latestAny.nhiet_do_dau_1, latestAny.nhiet_do_dau_2, latestAny.thoi_gian_say) : "")
        setCheDoWarning(null)
        return
      }
      const { row, warning } = resolveCheDoSuggestion(csrMatch, latestAny, formLoaiCsr, formatDate)
      setDefaultCheDo(row ? fmtCheDo(row.nhiet_do_dau_1, row.nhiet_do_dau_2, row.thoi_gian_say) : "")
      setCheDoWarning(warning)
    }
    void fetchCheDo()
  }, [factoryId, formDayChuyen, formLoaiCsr, cheDoRefreshTick])

  // Auto-fill chế độ sấy vào dòng còn trống
  useEffect(() => {
    if (!defaultCheDo) return
    setRows(prev => prev.map(row =>
      row.che_do_say === "" ? { ...row, che_do_say: defaultCheDo } : row
    ))
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
    const today = new Date().toISOString().slice(0, 10)
    resetEditingState()
    setFormNgay(today)
    setFormDayChuyen("Mủ tạp")
    setFormLoaiCsr("10")
    setDefaultCheDo("")
    setCheDoRefreshTick(t => t + 1)
    setSaveError(null)

    const suggestion = await suggestNgan(today)
    const firstRow = emptyMeasurementRow(currentUserName, "", CHI_TIEU_BY_CSR["10"])
    if (suggestion) {
      firstRow.ngan_id = suggestion.ngan_id
      firstRow.so_ngay_luu = suggestion.so_ngay_luu
    }
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
    setCheDoRefreshTick(t => t + 1)
    setExistingRowIds(new Set())
    setExistingRowCount(sheet.rows?.length ?? 0)

    const csrForRow = sheet.loai_csr ? (CHI_TIEU_BY_CSR[sheet.loai_csr] || []) : []
    const suggestion = await suggestNgan(sheet.ngay)
    const firstRow = emptyMeasurementRow(currentUserName, "", csrForRow)
    if (suggestion) {
      firstRow.ngan_id = suggestion.ngan_id
      firstRow.so_ngay_luu = suggestion.so_ngay_luu
    }
    setRows([firstRow])
    setEditingSheetId(sheet.id)
    setEditingSheet(sheet)
    setAddRowsMode(true)
    setView("create")
  }

  const openView = async (sheet: SheetWithRows) => {
    const { data } = await supabase
      .from("quick_measurement_rows")
      .select("*")
      .eq("sheet_id", sheet.id)
      .order("sort_order")
    setSelected({ ...sheet, rows: (data as QuickMeasurementRow[]) || [] })
    setView("view")
  }

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
        const { error } = await supabase.from("quick_measurement_rows").insert(rowPayloads)
        if (error) { setSaveError(error.message); return }
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
        // Tạo phiếu mới
        const maPhieu = getMaPhieuPreview(formDayChuyen, formNgay, nextCount)

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
          .select("id")
          .single()

        if (sheetErr || !sheetData) {
          setSaveError(sheetErr?.message || "Lỗi tạo phiếu")
          return
        }

        const sheetId = sheetData.id
        const rowPayloads = rows.map((row, i) => rowDraftToPayload(row, sheetId, factoryId, i))
        const { error: rowsErr } = await supabase.from("quick_measurement_rows").insert(rowPayloads)
        if (rowsErr) { setSaveError(rowsErr.message); return }
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

  const handleDeleteSheet = async (id: string) => {
    if (!factoryId) return
    await supabase.from("quick_measurements").delete().eq("id", id)
    void loadSheets(factoryId)
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
      for (const file of Array.from(files)) {
        const ext = file.name.split(".").pop()
        const path = `${factoryId}/process/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
        const { error } = await supabase.storage.from("order-files").upload(path, file, { upsert: false })
        if (!error) {
          const { data: urlData } = supabase.storage.from("order-files").getPublicUrl(path)
          newUrls.push(urlData.publicUrl)
        }
      }
      if (newUrls.length) {
        updateRow(rowId, {
          image_urls: [...(rows.find(r => r.id === rowId)?.image_urls || []), ...newUrls].slice(0, 6)
        })
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
      const results = await Promise.all(Array.from(files).map(async (file) => {
        const imageBase64 = await readFileAsBase64(file)
        const mimeType = file.type || "image/jpeg"
        const res = await fetch("/api/process/ocr-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64, mimeType }),
        })
        const json = await res.json() as { chiTieu?: string; value?: number; error?: string }
        return { file, json }
      }))

      const patchKetQua: Record<string, string> = {}
      const detectedCts: string[] = []
      const failedNames: string[] = []
      const newUrls: string[] = []

      for (const { file, json } of results) {
        // Vẫn lưu ảnh dù OCR không nhận dạng được, để không mất ảnh hiện trường đã chụp
        const ext = file.name.split(".").pop() || "jpg"
        const path = `${factoryId}/process/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
        const { error: uploadErr } = await supabase.storage.from("order-files").upload(path, file, { upsert: false })
        if (!uploadErr) {
          const { data: urlData } = supabase.storage.from("order-files").getPublicUrl(path)
          newUrls.push(urlData.publicUrl)
        }

        if (json.error || json.value == null || !json.chiTieu) {
          failedNames.push(file.name)
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
      if (failedNames.length) {
        setSaveError(`Không nhận dạng được ${failedNames.length} ảnh (${failedNames.join(", ")}), vui lòng nhập tay.`)
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

  if (view === "view" && selected) {
    return (
      <ProcessShell>
        {lightbox}
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => setView("list")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all">
            <ChevronLeft size={16} /> Quay lại
          </button>
          <h2 className="text-xl font-extrabold text-slate-800">{selected.ma_phieu}</h2>
          <a
            href={`/dashboard/process/print?sheetId=${selected.id}`}
            target="_blank"
            rel="noreferrer"
            className="ml-auto flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white font-bold rounded-xl shadow-md transition-all text-sm"
          >
            <Printer size={14} /> Xuất phiếu PDF
          </a>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-xs font-bold text-slate-500 block mb-1">Ngày đo</span>
              <span className="font-bold text-slate-800">{formatDate(selected.ngay)}</span>
            </div>
            <div>
              <span className="text-xs font-bold text-slate-500 block mb-1">Dây chuyền</span>
              <span className="font-bold text-slate-800">{selected.day_chuyen || "—"}</span>
            </div>
            <div>
              <span className="text-xs font-bold text-slate-500 block mb-1">Loại CSR</span>
              <span className="font-bold text-slate-800">{selected.loai_csr || "—"}</span>
            </div>
          </div>
        </div>

        <ResponsiveTableWrapper className="rounded-2xl">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-center px-3 py-3 font-bold text-slate-600 w-10">STT</th>
                  <th className="text-left px-3 py-3 font-bold text-slate-600">Chỉ tiêu / Thùng-Lô-Mẫu</th>
                  <th className="text-left px-3 py-3 font-bold text-slate-600">Chế độ sấy</th>
                  <th className="text-left px-3 py-3 font-bold text-slate-600">Kết quả</th>
                  <th className="text-left px-3 py-3 font-bold text-slate-600">Ca SX</th>
                  <th className="text-left px-3 py-3 font-bold text-slate-600">Ngăn / Ngày lưu</th>
                  <th className="text-left px-3 py-3 font-bold text-slate-600">Người đo</th>
                  <th className="text-left px-3 py-3 font-bold text-slate-600">Hình ảnh</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {selected.rows.map((row, i) => {
                  const ngan = ngans.find(n => n.id === row.ngan_id)
                  const kq = row.ket_qua as Record<string, number | null>
                  return (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-3 py-3 text-center text-slate-500">{i + 1}</td>
                      <td className="px-3 py-3">
                        <div className="font-semibold text-slate-800">
                          {row.chi_tieu?.join(", ") || "—"}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {[row.thung, row.lo, row.mau].filter(Boolean).join(" / ") || ""}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-slate-600">{row.che_do_say || "—"}</td>
                      <td className="px-3 py-3">
                        {Object.entries(kq).filter(([, v]) => v != null).map(([k, v]) => (
                          <div key={k} className="text-sm">
                            <span className="text-slate-500">{k}:</span>{" "}
                            <span className="font-mono font-bold text-slate-800">{v}</span>
                          </div>
                        ))}
                      </td>
                      <td className="px-3 py-3 text-slate-600">{row.ca_sx || "—"}</td>
                      <td className="px-3 py-3 text-sm">
                        {ngan ? (
                          <div>
                            <div className="font-semibold text-slate-700">{ngan.ma_ngan} – {ngan.ten_ngan}</div>
                            {row.so_ngay_luu != null && (
                              <div className="text-xs text-slate-500">{row.so_ngay_luu} ngày lưu</div>
                            )}
                          </div>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-3 text-slate-600">{row.nguoi_do || "—"}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(row.image_urls || []).map((url, j) => (
                            <button
                              key={j}
                              type="button"
                              onClick={() => setZoomImageUrl(url)}
                              className="shrink-0 focus:outline-none"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={url} alt={`Ảnh ${j + 1}`}
                                className="w-10 h-10 object-cover rounded-lg border border-slate-200 hover:opacity-80 transition-opacity" />
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
        </ResponsiveTableWrapper>
      </ProcessShell>
    )
  }

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
                <input type="date" value={formNgay} onChange={e => setFormNgay(e.target.value)}
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
  return (
    <ProcessShell>
      {lightbox}
      {listError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 bg-red-600 text-white rounded-2xl shadow-2xl max-w-xl">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="text-sm font-bold">{listError}</span>
          <button onClick={() => setListError(null)} className="ml-2 hover:opacity-70"><X size={14} /></button>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Đo nhanh chỉ tiêu</h1>
          <p className="text-sm text-slate-500 mt-0.5">Phiếu đo Po, Mooney tại dây chuyền</p>
        </div>
        {canCreate && (
          <button onClick={() => void openCreate()}
            className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl shadow-md transition-all">
            <Plus size={16} /> Tạo phiếu mới
          </button>
        )}
      </div>

      {/* Filter */}
      <FilterBar activeCount={[filterFrom, filterTo, filterDayChuyen].filter(Boolean).length}>
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Từ ngày</label>
          <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500" />
        </div>
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Đến ngày</label>
          <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500" />
        </div>
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Dây chuyền</label>
          <select value={filterDayChuyen} onChange={e => setFilterDayChuyen(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500">
            <option value="">Tất cả</option>
            <option value="Mủ tạp">Mủ tạp</option>
            <option value="Mủ nước">Mủ nước</option>
          </select>
        </div>
      </FilterBar>

      {/* Table */}
      <ResponsiveTableWrapper>
        {loading ? (
          <div className="p-12 text-center text-slate-400">Đang tải...</div>
        ) : sheets.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <ClipboardCheck size={40} className="mx-auto mb-3 opacity-30" />
            <p>Chưa có phiếu đo nào</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 font-bold text-slate-600">Mã phiếu</th>
                  <th className="text-left px-4 py-3 font-bold text-slate-600">Ngày</th>
                  <th className="text-left px-4 py-3 font-bold text-slate-600">Dây chuyền / CSR</th>
                  <th className="text-left px-4 py-3 font-bold text-slate-600">Người đo</th>
                  <th className="text-center px-4 py-3 font-bold text-slate-600">Số dòng</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sheets.map(sheet => {
                  const nguoiDoList = Array.from(new Set((sheet.rows || []).map(r => r.nguoi_do).filter(Boolean)))
                  return (
                  <tr key={sheet.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-teal-700">{sheet.ma_phieu || "—"}</td>
                    <td className="px-4 py-3 font-semibold text-slate-700">{formatDate(sheet.ngay)}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {sheet.day_chuyen || "—"}
                      {sheet.loai_csr && <span className="ml-1 px-1.5 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-md">{sheet.loai_csr}</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{nguoiDoList.length ? nguoiDoList.join(", ") : "—"}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-bold rounded-full">
                        {sheet.rows?.length || 0} mẫu
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => openView(sheet)}
                          className="p-1.5 hover:bg-teal-50 text-slate-400 hover:text-teal-600 rounded-lg transition-colors">
                          <Eye size={14} />
                        </button>
                        <a
                          href={`/dashboard/process/print?sheetId=${sheet.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded-lg transition-colors"
                        >
                          <Printer size={14} />
                        </a>
                        <button
                          onClick={() => void handleQuickShare(sheet)}
                          disabled={sharingSheetId === sheet.id}
                          title="Chia sẻ ảnh nhanh"
                          className="p-1.5 hover:bg-teal-50 text-slate-400 hover:text-teal-600 rounded-lg transition-colors disabled:opacity-40"
                        >
                          {sharingSheetId === sheet.id ? (
                            <span className="block w-3.5 h-3.5 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <Share2 size={14} />
                          )}
                        </button>
                        {canEditSheet(sheet) && (
                          <button
                            onClick={() => void openEdit(sheet)}
                            title="Sửa phiếu"
                            className="p-1.5 hover:bg-amber-50 text-slate-400 hover:text-amber-600 rounded-lg transition-colors"
                          >
                            <Pencil size={14} />
                          </button>
                        )}
                        {canCreate && (
                          <button
                            onClick={() => void openAddRows(sheet)}
                            title="Thêm mẫu vào phiếu này"
                            className="p-1.5 hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 rounded-lg transition-colors"
                          >
                            <Plus size={14} />
                          </button>
                        )}
                        <button onClick={() => handleDeleteSheet(sheet.id)}
                          className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </ResponsiveTableWrapper>
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

        {/* Row 2: ket_qua + ngan (if mat tap) + nguoi_do + ghi_chu — cùng breakpoint 2→3 cột với header phiếu */}
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
            <div>
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
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Người đo</label>
            <input value={row.nguoi_do} readOnly
              title="Tự động điền theo tài khoản đang đăng nhập"
              className="w-full px-2 py-2 border border-slate-200 bg-slate-100 text-slate-500 rounded-xl text-sm outline-none cursor-not-allowed" />
          </div>
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
