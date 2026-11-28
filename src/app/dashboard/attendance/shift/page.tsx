"use client"

// Màn điểm danh ca của TRỰC CA — dạng LƯỚI Ô NGƯỜI (C2 làm lại GĐ2, rule 31). Dùng trên điện thoại, không sidebar.
// Mở từ QR: /dashboard/attendance/shift?qr=<token>; từ chuông: ?section=<id>.
// 1 phiếu / CA (attendance_sheet_sections loai = 'ca_san_xuat') cho mỗi (ngày, dây chuyền). Mở màn ⇒ tự mở phiếu ca.
// Chạm ô người ⇒ tấm chọn việc (nhiều việc, A/B, xe, người thay). Tự lưu nháp sau 2 giây. "Gửi chấm công" ⇒ bước xử lý phép.
// Mọi ghi qua RPC attendance_* (migration 20261206).

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, ArrowLeft, Check, ClipboardCheck, CloudOff, Eraser, Loader2, LogOut, RefreshCw, Send, SendHorizontal, Sparkles, Trash2, Undo2, X } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, getFreshAuthSession, hasPermission, hydrateActiveSession, signOutEverywhere, type SessionUser } from "@/lib/auth"
import { getErrorMessage } from "@/lib/error-message"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import { ATTENDANCE_DAY_CHUYEN, type AttendanceAbsenceReason, type AttendanceJobType } from "@/lib/attendance/types"
import {
  LINE_SELECT,
  POSITION_KEYS,
  SECTION_SELECT,
  UNIT_SELECT,
  positionLabelKey,
  type AttendanceUnit,
  applyPositionChange,
  buildRosterTabs,
  CA_NGAY,
  caPhanCongLabel,
  classifyTile,
  classifyTiles,
  countRoster,
  groupLinesByStaff,
  canEditLine,
  mergeLegacyCaLines,
  personCaCodes,
  dbLineToDraft,
  defaultPositions,
  emptyLine,
  findTrucCaJob,
  hasStoredPositions,
  compareStaffOrder,
  isStaffWorking,
  isJobOfUnit,
  jobsForUnit,
  defaultWorkHours,
  linesMissingHours,
  linesToPayload,
  workHoursLabel,
  positionHolderIds,
  positionsOfStaff,
  suggestFromPrevious,
  isLineMine,
  lineConflicts,
  splitVisibleLines,
  type AttendanceSection,
  type DbLine,
  type PositionKey,
  type SectionPositions,
  type SheetLineDraft,
  type ShiftStaff,
} from "@/lib/attendance/shift"
import { PositionBlock } from "./_components/position-block"
import { ATT_LANG_OPTIONS, at, bilingual, loadAttLang, storeAttLang, type AttLang } from "@/lib/attendance/i18n"
import { WorkerTile } from "./_components/worker-tile"
import { JobSheet, type SheetVehicle } from "./_components/job-sheet"
import { SubmitReview } from "./_components/submit-review"
import { SendAllDialog, type SendAllItem } from "./_components/send-all-dialog"
import { ReasonConfirmDialog } from "@/app/dashboard/_components/reason-confirm-dialog"
import {
  DIAGRAM_DAY_CHUYEN,
  addJobForWorker,
  buildDiagram,
  isStationKey,
  lineOfWorkerJob,
  moveJobOnLine,
  removeJobFromLine,
  type DiagramCell,
  type DiagramLine,
  type DiagramPerson,
  type DiagramSectionInput,
  type LineEditResult,
  type ProdWindow,
  type StationKey,
} from "@/lib/attendance/diagram"
import { LineDiagram, setDiagramDrag, type DiagramDragPayload } from "./_components/line-diagram"
import { StationPicker, type PickerGroup } from "./_components/station-picker"
import { loadProductionWindows } from "./diagram-actions"

const STATUS_KEY: Record<string, string> = { dang_lam: "stDangLam", da_gui: "stDaGui", da_duyet: "stDaDuyet", tra_ve: "stTraVe" }
const STATUS_CLS: Record<string, string> = {
  dang_lam: "bg-sky-100 text-sky-700",
  da_gui: "bg-amber-100 text-amber-800",
  da_duyet: "bg-emerald-100 text-emerald-700",
  tra_ve: "bg-rose-100 text-rose-700",
}
const AUTOSAVE_MS = 2000
const RETRY_MS = 8000

function readCachedUser(): SessionUser | null {
  try {
    return JSON.parse(localStorage.getItem("erp_user") || "null") as SessionUser | null
  } catch {
    return null
  }
}

function fmtHm(d: Date) {
  return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" }).format(d)
}

function fmtDdMm(iso: string) {
  const [y, m, d] = iso.split("-")
  return `${d}/${m}/${y.slice(2)}`
}

/** Ngày ISO cộng n ngày (chỉ phần ngày, không lệch múi giờ). */
function addDaysISO(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function isNetworkError(err: unknown) {
  const m = getErrorMessage(err, "").toLowerCase()
  return m.includes("failed to fetch") || m.includes("network") || m.includes("load failed")
}

type SaveState = "idle" | "saving" | "saved" | "error"

export default function AttendanceShiftPage() {
  const [lang, setLang] = useState<AttLang>("vi")
  const [user, setUser] = useState<SessionUser | null>(null)
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [booting, setBooting] = useState(true)
  const [fatal, setFatal] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Danh mục
  const [catalogReady, setCatalogReady] = useState(false)
  const [staff, setStaff] = useState<ShiftStaff[]>([])
  const [jobs, setJobs] = useState<AttendanceJobType[]>([])
  const [reasons, setReasons] = useState<AttendanceAbsenceReason[]>([])
  const [vehicles, setVehicles] = useState<SheetVehicle[]>([])
  const [vehicleByStaff, setVehicleByStaff] = useState<Map<string, string>>(new Map())
  const [assignedCas, setAssignedCas] = useState<string[]>([])
  const [units, setUnits] = useState<AttendanceUnit[]>([])
  const [qrName, setQrName] = useState<string | null>(null)
  const qrDayChuyenRef = useRef<string | null>(null)
  const qrUnitRef = useRef<string | null>(null)
  const qrUnitCodesRef = useRef<string[]>([])
  /** Mở qua QR: dây chuyền khoá theo QR + Ca/Tổ chỉ trong danh sách của QR (20261219). */
  const [qrLock, setQrLock] = useState<{ dc: string | null; units: string[] }>({ dc: null, units: [] })
  const initialSectionRef = useRef<string | null>(null)

  // Phiếu ca đang mở
  const [dayChuyen, setDayChuyen] = useState<string>("Mủ tạp")
  const [ngay, setNgay] = useState<string>(getFactoryTodayISO())
  const [ca, setCa] = useState<string>("A")
  const [section, setSection] = useState<AttendanceSection | null>(null)
  const [maPhieu, setMaPhieu] = useState("")
  const [lines, setLines] = useState<SheetLineDraft[]>([])
  /** L1 — phiếu TỔ: dòng người khác chấm cho ca khác (ẩn khỏi màn, chỉ dùng kiểm trùng + sơ đồ; server giữ nguyên). */
  const [hiddenLines, setHiddenLines] = useState<SheetLineDraft[]>([])
  const hiddenLinesRef = useRef<SheetLineDraft[]>([])
  const [positions, setPositions] = useState<SectionPositions>({})
  const positionsRef = useRef<SectionPositions>({})
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const [suggestedFrom, setSuggestedFrom] = useState<string | null>(null)
  /** L2 — số dòng gợi ý KHÔNG chép vì trùng ca người khác đã chấm hôm nay. */
  const [suggestSkipped, setSuggestSkipped] = useState(0)
  const loadedKeyRef = useRef<string | null>(null)

  // Tự lưu
  const [version, setVersion] = useState(0)
  const [savedVersion, setSavedVersion] = useState(0)
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [retryTick, setRetryTick] = useState(0)
  const linesRef = useRef<SheetLineDraft[]>([])
  const versionRef = useRef(0)
  const savingRef = useRef<Promise<boolean> | null>(null)

  // Lưới
  const [activeTab, setActiveTab] = useState("ca")
  const [onlyUnassigned, setOnlyUnassigned] = useState(false)
  const [sheetFor, setSheetFor] = useState<string | null>(null)
  const [, setSheetTabKey] = useState<string>("ca")
  const [reviewOpen, setReviewOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [sendAllItems, setSendAllItems] = useState<SendAllItem[] | null>(null)
  const [sendAllMissing, setSendAllMissing] = useState<string[]>([])
  const [sendAllBusy, setSendAllBusy] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [recallOpen, setRecallOpen] = useState(false)
  const [recalling, setRecalling] = useState(false)

  const T = useCallback((key: string, vars?: Record<string, string | number>) => at(lang, key, vars), [lang])

  const canEditAny = !!user && (user.role === "admin" || hasPermission(user, "attendance.mark") || hasPermission(user, "attendance.mark_all"))
  const canShift = canEditAny || (!!user && hasPermission(user, "attendance.shift_check"))

  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff])
  const unitsRef = useRef<Map<string, AttendanceUnit>>(new Map())
  useEffect(() => {
    unitsRef.current = new Map(units.map((u) => [u.code, u]))
  }, [units])
  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs])
  const lineByStaff = useMemo(() => new Map(lines.map((l) => [l.staff_id, l])), [lines])
  /** A4 — tổ phân ca: 1 người có thể có nhiều dòng (mỗi ca 1 dòng). */
  const linesByStaff = useMemo(() => groupLinesByStaff(lines), [lines])
  const isAdminUser = user?.role === "admin"
  const holderIds = useMemo(() => positionHolderIds(positions), [positions])
  /** Tên người LÀM thật của dòng: người thay nếu có, ngược lại chính người đó. */
  const workerNameOf = (l: SheetLineDraft) =>
    l.thay_the_staff_id ? staffById.get(l.thay_the_staff_id)?.ten || "?" : l.thay_the_ten ? `${l.thay_the_ten} (${T("tam")})` : staffById.get(l.staff_id)?.ten || "?"

  useEffect(() => {
    linesRef.current = lines
  }, [lines])
  useEffect(() => {
    positionsRef.current = positions
  }, [positions])

  // ── Bootstrap ──
  useEffect(() => {
    setLang(loadAttLang())
    const run = async () => {
      try {
        // Quyền phải mới nhất (cache có thể cũ) — lỗi mạng mới dùng cache.
        let u: SessionUser | null = null
        try {
          u = (await hydrateActiveSession()).user
        } catch {
          u = readCachedUser()
        }
        setUser(u ?? readCachedUser())
        const fid = await getActiveFactoryId()
        if (!fid) {
          setFatal("Không xác định được nhà máy.")
          return
        }
        setFactoryId(fid)
        const params = new URLSearchParams(window.location.search)
        const qr = params.get("qr")
        initialSectionRef.current = params.get("section")
        if (qr) {
          const { data, error: qrErr } = await supabase.rpc("attendance_resolve_qr", { p_token: qr })
          if (qrErr) setError(at(loadAttLang(), "qrInvalid"))
          const point = Array.isArray(data) ? data[0] : null
          if (point) {
            setQrName(point.ten_diem as string)
            qrDayChuyenRef.current = (point.day_chuyen_mac_dinh as string | null) || null
            qrUnitRef.current = (point.unit_code as string | null) || null
            qrUnitCodesRef.current = ((point.unit_codes as string[] | null) || []).filter(Boolean)
            setQrLock({ dc: qrDayChuyenRef.current, units: ((point.unit_codes as string[] | null) || []).filter(Boolean) })
          }
        }
      } catch (err) {
        setFatal(getErrorMessage(err, "Không tải được trang."))
      } finally {
        setBooting(false)
      }
    }
    void run()
  }, [])

  // ── Danh mục ──
  const loadCatalog = useCallback(async (fid: string, uid: string | null, u0: SessionUser | null) => {
    const [staffRows, jobRes, reasonRes, vehRes, mainRes, subRes, drvRes, asgRes, unitRes] = await Promise.all([
      fetchAllPaginated<ShiftStaff>((from, to) =>
        supabase
          .from("maintenance_staff")
          .select("id, ten, gioi_tinh, loai_nhan_su, ca_mac_dinh, day_chuyen_mac_dinh, thu_tu_diem_danh, ngay_vao_lam, ngay_nghi_viec, active, cho_xac_nhan, profile_id, chuc_vu, chuc_vu_chinh_quyen, to_vai_tro, to_pham_vi")
          .eq("factory_id", fid)
          .order("ten")
          .order("id")
          .range(from, to),
      ),
      supabase.from("attendance_job_types").select("*").eq("factory_id", fid).order("sort_order"),
      supabase.from("attendance_absence_reasons").select("*").eq("factory_id", fid).eq("is_active", true).order("sort_order"),
      supabase.from("dispatch_vehicles").select("id, code, name, vehicle_type, is_active").eq("factory_id", fid).order("code"),
      supabase.from("dispatch_vehicle_driver_assignments").select("vehicle_id, driver_id").eq("factory_id", fid).eq("is_current", true),
      supabase.from("dispatch_vehicle_secondary_drivers").select("vehicle_id, driver_id").eq("factory_id", fid).eq("is_current", true),
      supabase.from("dispatch_drivers").select("id, staff_id").eq("factory_id", fid).not("staff_id", "is", null),
      uid
        ? supabase.from("production_shift_assignments").select("ca").eq("factory_id", fid).eq("assigned_user_id", uid).eq("is_active", true)
        : Promise.resolve({ data: [] as { ca: string }[], error: null }),
      supabase.from("attendance_units").select(UNIT_SELECT).eq("factory_id", fid).order("sort_order"),
    ])
    for (const r of [jobRes, reasonRes, vehRes, unitRes]) if (r.error) throw r.error
    const unitRows = (unitRes.data || []) as AttendanceUnit[]
    setUnits(unitRows)
    setStaff(staffRows)
    setJobs((jobRes.data || []) as AttendanceJobType[])
    setReasons((reasonRes.data || []) as AttendanceAbsenceReason[])
    setVehicles((vehRes.data || []) as SheetVehicle[])

    const staffOfDriver = new Map(((drvRes.data || []) as { id: string; staff_id: string }[]).map((d) => [d.id, d.staff_id]))
    const vMap = new Map<string, string>()
    for (const a of [...((mainRes.data || []) as { vehicle_id: string; driver_id: string }[]), ...((subRes.data || []) as { vehicle_id: string; driver_id: string }[])]) {
      const sid = staffOfDriver.get(a.driver_id)
      if (sid && !vMap.has(sid)) vMap.set(sid, a.vehicle_id)
    }
    setVehicleByStaff(vMap)

    const activeCodes = unitRows.filter((u) => u.is_active).map((u) => u.code)
    const cas = Array.from(new Set(((asgRes.data || []) as { ca: string }[]).map((r) => r.ca))).filter((c) => activeCodes.includes(c))
    cas.sort((a, b) => activeCodes.indexOf(a) - activeCodes.indexOf(b))
    setAssignedCas(cas)
    if (!initialSectionRef.current) {
      // Ca/Tổ mặc định: của điểm QR (nếu được phép) → ca/tổ đầu tiên được phân công → đơn vị đầu danh mục.
      const editAll = !!u0 && (u0.role === "admin" || hasPermission(u0, "attendance.mark") || hasPermission(u0, "attendance.mark_all"))
      const qrUnits = qrUnitCodesRef.current
      const allowed = (editAll ? activeCodes : cas).filter((c) => qrUnits.length === 0 || qrUnits.includes(c))
      const qrUnit = qrUnitRef.current
      const pick = qrUnit && allowed.includes(qrUnit) ? qrUnit : allowed[0]
      if (pick) setCa(pick)
      const me = staffRows.find((s) => s.profile_id && s.profile_id === uid)
      // QR có dây chuyền ⇒ khoá theo QR (ưu tiên hơn dây chuyền mặc định của người đăng nhập).
      const dc = qrDayChuyenRef.current || me?.day_chuyen_mac_dinh
      const fixedDc = unitRows.find((u) => u.code === pick)?.day_chuyen || null
      if (fixedDc) setDayChuyen(fixedDc)
      else if (dc && (ATTENDANCE_DAY_CHUYEN as readonly string[]).includes(dc)) setDayChuyen(dc)
    }
  }, [])

  useEffect(() => {
    if (!factoryId || catalogReady || !canShift) return
    loadCatalog(factoryId, user?.id || null, user)
      .then(() => setCatalogReady(true))
      .catch((err) => setFatal(getErrorMessage(err, "Không tải được danh mục.")))
  }, [factoryId, user, loadCatalog, catalogReady, canShift])

  // ── Danh sách thẻ (phụ thuộc phiếu đang mở) ──
  const unitByCode = useMemo(() => new Map(units.map((u) => [u.code, u])), [units])
  const currentUnit = unitByCode.get(ca) || null
  /** A4 — Ca A/B/C người đăng nhập được phân công điểm danh. */
  const myCaCodes = useMemo(() => assignedCas.filter((c) => unitByCode.get(c)?.loai === "ca"), [assignedCas, unitByCode])
  /** A4 — phiếu đang mở là tổ phân ca (Tổ cơ điện – bảo trì – xe nâng). */
  const phanCa = !!currentUnit && currentUnit.loai === "to" && !!currentUnit.phan_ca
  const caOrder = useMemo(() => units.filter((u) => u.loai === "ca").map((u) => u.code), [units])
  const phanCaOptions = useMemo(
    () => [
      ...units.filter((u) => u.is_active && u.loai === "ca").map((u) => ({ code: u.code, label: bilingual(lang, u.ten, u.ten_khmer) })),
      { code: CA_NGAY, label: at(lang, "caNgay") },
    ],
    [units, lang],
  )
  /** A4 — ca mặc định khi giao ở tổ phân ca: Ca người đăng nhập đang trực (phân công → Ca mặc định trong hồ sơ). */
  const defaultPhanCa = useMemo(() => {
    if (myCaCodes[0]) return myCaCodes[0]
    const me = user ? staff.find((x) => x.profile_id === user.id) : undefined
    return me?.ca_mac_dinh && unitByCode.get(me.ca_mac_dinh)?.loai === "ca" ? me.ca_mac_dinh : ""
  }, [myCaCodes, user, staff, unitByCode])
  /** L1 — Ca của tôi để xác định "phần của tôi" trên phiếu tổ phân ca. */
  const mineCas = useMemo(() => (myCaCodes.length > 0 ? myCaCodes : defaultPhanCa ? [defaultPhanCa] : []), [myCaCodes, defaultPhanCa])
  /** A4 — tổ trưởng phân công trước 1 ngày: phiếu Tổ mở được ngày mai; Ca sản xuất thì không. */
  const tomorrowISO = addDaysISO(getFactoryTodayISO(), 1)
  useEffect(() => {
    if (currentUnit && currentUnit.loai !== "to" && ngay > getFactoryTodayISO()) setNgay(getFactoryTodayISO())
  }, [currentUnit, ngay])
  const tabs = useMemo(
    () => buildRosterTabs(staff, currentUnit, dayChuyen, ngay, [...lines.map((l) => l.staff_id), ...holderIds]),
    [staff, currentUnit, dayChuyen, ngay, lines, holderIds],
  )
  /** A2 — Ca/Tổ ghi giờ làm từng người (Tổ tiếp nhận mủ tạp: theo giờ điểm danh; XLNT 05–05; cơ khí 05–17). null = không. */
  const khungMode = currentUnit?.khung_mac_dinh || null
  /** Giờ làm trên ô người: "05:00 – 17:00". */
  const khungTileLabel = (l: SheetLineDraft | undefined) => (khungMode && l ? workHoursLabel(l.gio_bd, l.gio_kt) : "")

  // ── Mở / nạp phiếu ca ──
  const loadSection = useCallback(
    async (sectionId: string) => {
      const { data: sec, error: secErr } = await supabase.from("attendance_sheet_sections").select(SECTION_SELECT).eq("id", sectionId).single()
      if (secErr) throw secErr
      const s = sec as AttendanceSection
      const [{ data: sh, error: shErr }, { data: ln, error: lnErr }] = await Promise.all([
        supabase.from("attendance_daily_sheets").select("id, ma_phieu, ngay, day_chuyen").eq("id", s.sheet_id).single(),
        supabase.from("attendance_sheet_lines").select(LINE_SELECT).eq("section_id", sectionId).order("stt"),
      ])
      if (shErr) throw shErr
      if (lnErr) throw lnErr
      const sheetNgay = sh.ngay as string
      const sheetDc = sh.day_chuyen as string
      const sheetCa = s.ca || "A"
      loadedKeyRef.current = `${sheetNgay}|${sheetDc}|${sheetCa}`
      setNgay(sheetNgay)
      setDayChuyen(sheetDc)
      setCa(sheetCa)
      setSection(s)
      setMaPhieu(sh.ma_phieu as string)
      setSuggestedFrom(null)
      setSuggestSkipped(0)

      let next = ((ln || []) as DbLine[]).map(dbLineToDraft)
      let suggested = false
      let legacyMerged = false
      const secUnit = unitsRef.current.get(sheetCa) || null
      const secPhanCa = !!secUnit && secUnit.loai === "to" && !!secUnit.phan_ca
      // L1 (2026-11-28) — phiếu TỔ: người không phải admin chỉ thấy phần của mình (mình giao + giao cho ca mình);
      // dòng người khác chấm cho ca khác ẩn đi (vẫn kiểm trùng ngầm; server giữ nguyên khi lưu).
      const splitMine = secUnit?.loai === "to" && user?.role !== "admin" && !!user?.id
      const mineCtx = { userId: user?.id || "", myCas: mineCas, phanCa: secPhanCa }
      let hidden: SheetLineDraft[] = []
      if (splitMine) {
        const sp = splitVisibleLines(next, mineCtx)
        next = sp.visible
        hidden = sp.hidden
      }
      // A4: phiếu TỔ đã gửi vẫn sửa được (thêm ca sau) — chỉ khoá khi đã duyệt.
      const editableNow =
        secUnit?.loai === "to"
          ? s.trang_thai !== "da_duyet" && (canEditAny || s.truc_ca_user_id === user?.id || assignedCas.includes(sheetCa) || (secPhanCa && myCaCodes.length > 0))
          : (s.trang_thai === "dang_lam" || s.trang_thai === "tra_ve") && (canEditAny || s.truc_ca_user_id === user?.id)
      // Tổ phân ca: dòng cũ (trước A4, chưa có ca) trùng người với dòng đã có ca ⇒ gộp, bỏ dòng cũ (tự lưu ngay).
      if (secPhanCa && editableNow) {
        const r = mergeLegacyCaLines(next, (l) => !l.gui_luc || s.trang_thai === "tra_ve" || user?.role === "admin")
        next = r.lines
        legacyMerged = r.changed
      }
      // L2 — phần của tôi còn trống (kể cả khi ca khác đã chấm trước) ⇒ gợi ý theo lần gần nhất TÔI chấm Ca/Tổ này.
      if (next.length === 0 && editableNow) {
        // Gợi ý theo phiếu ca gần nhất (cùng dây chuyền + ca, ngày trước).
        const { data: prevSheets } = await supabase
          .from("attendance_daily_sheets")
          .select("id, ngay")
          .eq("factory_id", s.factory_id)
          .eq("day_chuyen", sheetDc)
          .lt("ngay", sheetNgay)
          .order("ngay", { ascending: false })
          .limit(10)
        const sheetsList = (prevSheets || []) as { id: string; ngay: string }[]
        if (sheetsList.length > 0) {
          const { data: prevSecs } = await supabase
            .from("attendance_sheet_sections")
            .select("id, sheet_id")
            .in("sheet_id", sheetsList.map((x) => x.id))
            .eq("loai", "ca_san_xuat")
            .eq("ca", sheetCa)
          const secs = (prevSecs || []) as { id: string; sheet_id: string }[]
          if (secs.length > 0) {
            const { data: prevLines } = await supabase.from("attendance_sheet_lines").select(LINE_SELECT).in("section_id", secs.map((x) => x.id))
            const all = (prevLines || []) as DbLine[]
            for (const sht of sheetsList) {
              const secIds = new Set(secs.filter((x) => x.sheet_id === sht.id).map((x) => x.id))
              const these = all.filter((l) => secIds.has(l.section_id) && (!splitMine || isLineMine(l, mineCtx)))
              if (these.length === 0) continue
              const sheetUnit = unitsRef.current.get(sheetCa) || null
              const activeJobs = new Set(jobs.filter((j) => j.is_active && !j.an_diem_danh && isJobOfUnit(j, sheetUnit, sheetDc)).map((j) => j.id))
              const sug0 = suggestFromPrevious(these, new Map(staff.map((x) => [x.id, x])), sheetNgay, activeJobs)
              // Bỏ dòng gợi ý trùng ca / giờ với phần người khác đã chấm hôm nay.
              const opts = { phanCa: secPhanCa, khung: !!secUnit?.khung_mac_dinh }
              const sug = sug0.filter((l) => lineConflicts(l, hidden, opts).length === 0)
              if (sug.length > 0) {
                next = sug
                suggested = true
                setSuggestedFrom(sht.ngay)
                setSuggestSkipped(sug0.length - sug.length)
              }
              break
            }
          }
        }
      }
      // Người đăng nhập (trực ca) tự nhận việc "Trực ca" nếu Ca/Tổ này có việc đó (Tổ cơ điện – bảo trì – xe nâng) và chưa
      // có dòng của mình. Chỉ điền sẵn — lưu ở lần sửa đầu tiên / khi Gửi (người dùng chốt 2026-11-25).
      if (editableNow && user?.id) {
        const me = staff.find((x) => x.profile_id === user.id && isStaffWorking(x, sheetNgay))
        const trucCa = findTrucCaJob(jobs, unitsRef.current.get(sheetCa) || null, sheetDc)
        const meCa = secPhanCa ? defaultPhanCa : ""
        if (me && trucCa && (!secPhanCa || meCa) && !next.some((l) => (l.staff_id === me.id || l.thay_the_staff_id === me.id) && (!secPhanCa || l.ca_phan_cong === meCa || l.ca_phan_cong === CA_NGAY))) {
          next = [...next, emptyLine({ staff_id: me.id, cong_viec_ids: [trucCa.id], diem_danh: "co", xep_loai: "A", ca_phan_cong: meCa })]
        }
      }
      // Vị trí phụ trách: phiếu chưa từng lưu vị trí ⇒ điền mặc định theo hồ sơ nhân sự (lưu ở lần tự lưu kế tiếp).
      let pos: SectionPositions = hasStoredPositions(s.vi_tri) ? (s.vi_tri as SectionPositions) : {}
      let posDefaulted = false
      if (!hasStoredPositions(s.vi_tri) && editableNow) {
        pos = defaultPositions(staff, sheetCa, sheetDc, sheetNgay)
        posDefaulted = POSITION_KEYS.some((k) => !!pos[k]?.staff_id)
      }
      setPositions(pos)
      positionsRef.current = pos
      setHiddenLines(hidden)
      hiddenLinesRef.current = hidden
      setLines(next)
      linesRef.current = next
      // Gợi ý / vị trí mặc định CHỈ hiển thị — không tự lưu khi chưa thao tác (tránh phiếu ca "ma" có ca trưởng có mặt khi
      // Ca/Tổ đó không làm việc; lỗi thật 25/11/2026). Lần sửa đầu tiên sẽ lưu cả phần điền sẵn.
      void suggested
      void posDefaulted
      setSavedVersion(versionRef.current)
      setVersion(versionRef.current)
      setSaveState("idle")
      if (legacyMerged) {
        // Lưu ngay bản đã gộp (dòng cũ chưa ca bị bỏ).
        versionRef.current += 1
        setVersion(versionRef.current)
      }
    },
    [canEditAny, user, staff, jobs, assignedCas, myCaCodes, defaultPhanCa, mineCas],
  )
  const loadSectionRef = useRef(loadSection)
  useEffect(() => {
    loadSectionRef.current = loadSection
  }, [loadSection])

  const openCurrent = useCallback(async () => {
    if (!factoryId) return
    setOpening(true)
    setOpenError(null)
    try {
      const sid = initialSectionRef.current
      if (sid) {
        initialSectionRef.current = null
        await loadSectionRef.current(sid)
        return
      }
      const { data, error: rpcErr } = await supabase.rpc("attendance_open_section", {
        p_factory_id: factoryId,
        p_ngay: ngay,
        p_day_chuyen: dayChuyen,
        p_loai: "ca_san_xuat",
        p_ca: ca,
      })
      if (rpcErr) throw rpcErr
      await loadSectionRef.current(data as string)
    } catch (err) {
      setSection(null)
      setLines([])
      setHiddenLines([])
      hiddenLinesRef.current = []
      setOpenError(isNetworkError(err) ? T("loiMang") : getErrorMessage(err, "Không mở được phiếu ca."))
    } finally {
      setOpening(false)
    }
  }, [factoryId, ngay, dayChuyen, ca, T])

  useEffect(() => {
    if (!catalogReady || !canShift || (!canEditAny && assignedCas.length === 0)) return
    if (!initialSectionRef.current && loadedKeyRef.current === `${ngay}|${dayChuyen}|${ca}`) return
    void openCurrent()
  }, [catalogReady, canShift, canEditAny, assignedCas, ngay, dayChuyen, ca, openCurrent])

  // ── Quyền trên phiếu đang mở ──
  const isMine = !!section && section.truc_ca_user_id === user?.id
  const isToSection = currentUnit?.loai === "to"
  /** A4 — tổ: người lập / được phân công tổ / người chấm công sửa mọi dòng chưa khoá; trực ca chỉ có Ca ⇒ chỉ ca mình. */
  const toFullScope = canEditAny || isMine || assignedCas.includes(ca)
  const toEditor = toFullScope || (phanCa && myCaCodes.length > 0)
  const editable =
    !!section &&
    (isToSection
      ? section.trang_thai !== "da_duyet" && toEditor
      : (section.trang_thai === "dang_lam" || section.trang_thai === "tra_ve") && (canEditAny || isMine))
  /** A4b — tổ phân ca: được giao MỚI cho ca này (người được phân công tổ / người chấm công / admin ⇒ mọi ca). */
  const canCreateCa = (code: string) => !isToSection || toFullScope || myCaCodes.includes(code)
  /** A4b — quyền sửa dòng (giữ chỗ theo người giao) cho phiếu Ca/Tổ `unitCode` có trạng thái `status`. */
  const ctxFor = (unitCode: string, status: string) => {
    const u = unitByCode.get(unitCode)
    return {
      isTo: u?.loai === "to",
      phanCa: u?.loai === "to" && !!u.phan_ca,
      userId: user?.id || "",
      myCas: myCaCodes,
      isAdmin: isAdminUser,
      sectionStatus: status,
    }
  }
  const canEditHere = (l: SheetLineDraft) => canEditLine(l, ctxFor(ca, section?.trang_thai || ""))
  /** Dòng người đăng nhập sửa / gửi được trên phiếu đang mở (phiếu Ca: mọi dòng). */
  const myLines = isToSection ? lines.filter(canEditHere) : lines
  const ownerName = (uid: string) => staff.find((x) => x.profile_id === uid)?.ten || T("nguoiKhac")
  /** L3 — câu báo trùng của dòng `l` với dòng `o` (người khác đã chấm). */
  const conflictText = (o: SheetLineDraft) =>
    phanCa
      ? T("trungCaPhanCong", { ca: caPhanCongLabel(o.ca_phan_cong, unitByCode, T("caNgay")), ten: ownerName(o.lap_boi) })
      : T("trungGioPhanCong", { ten: ownerName(o.lap_boi), gio: workHoursLabel(o.gio_bd, o.gio_kt) })
  /** L3 — dòng vừa đổi trùng phần người khác đã chấm ⇒ câu báo; không trùng ⇒ null. */
  const conflictOf = (changed: SheetLineDraft[], others: SheetLineDraft[]): string | null => {
    for (const l of changed) {
      const hit = lineConflicts(l, others, { phanCa, khung: !!khungMode })[0]
      if (hit) return conflictText(hit)
    }
    return null
  }
  const lockReason = !section
    ? null
    : section.trang_thai === "da_duyet"
      ? T("khoaDaDuyet")
      : section.trang_thai === "da_gui" && isToSection && editable
        ? null
        : section.trang_thai === "da_gui"
        ? T("khoaChoDuyet")
        : isToSection ? (toEditor ? null : T("khoaChuaPhanCongTo"))
        : !canEditAny && !isMine
          ? T("khoaNguoiKhac", { ten: section.truc_ca_staff_id ? staffById.get(section.truc_ca_staff_id)?.ten || T("trucCaKhac") : T("trucCaKhac") })
          : null

  // ── Lưu ──
  const doSave = useCallback(async (): Promise<boolean> => {
    if (!section) return false
    if (savingRef.current) await savingRef.current
    const v = versionRef.current
    const run = (async () => {
      setSaveState("saving")
      try {
        const { error: rpcErr } = await supabase.rpc("attendance_save_section", {
          p_section_id: section.id,
          p_header: { ghi_chu: section.ghi_chu || "", vi_tri: positionsRef.current },
          p_lines: linesToPayload(linesRef.current, positionHolderIds(positionsRef.current)),
        })
        if (rpcErr) throw rpcErr
        if (section.trang_thai === "da_gui") {
          // A4: phiếu tổ đã gửi mà nội dung đổi ⇒ server chuyển về "Đang lập" — cập nhật trạng thái hiển thị.
          const { data: st } = await supabase.from("attendance_sheet_sections").select("trang_thai").eq("id", section.id).maybeSingle()
          const next = (st as { trang_thai?: AttendanceSection["trang_thai"] } | null)?.trang_thai
          if (next && next !== section.trang_thai) setSection((cur) => (cur && cur.id === section.id ? { ...cur, trang_thai: next } : cur))
        }
        setSavedVersion(v)
        setSavedAt(new Date())
        setSaveState("saved")
        return true
      } catch (err) {
        setSaveState("error")
        if (!isNetworkError(err)) setError(getErrorMessage(err, "Không lưu được."))
        window.setTimeout(() => setRetryTick((t) => t + 1), RETRY_MS)
        return false
      }
    })()
    savingRef.current = run
    try {
      return await run
    } finally {
      savingRef.current = null
    }
  }, [section])

  useEffect(() => {
    if (!editable || version <= savedVersion) return
    const t = window.setTimeout(() => void doSave(), AUTOSAVE_MS)
    return () => window.clearTimeout(t)
  }, [editable, version, savedVersion, retryTick, doSave])

  const markChanged = () => {
    versionRef.current += 1
    setVersion(versionRef.current)
  }
  const dirty = version > savedVersion

  /** Lưu ngay phần còn chờ trước khi đổi phiếu ca. */
  const flushThen = async (fn: () => void) => {
    if (editable && dirty) {
      const ok = await doSave()
      // Lưu lỗi KHÔNG được chặn chuyển phiếu (lỗi thật 26/11: kẹt, phải tải lại trang) — hỏi rồi cho đi.
      if (!ok && !window.confirm(T("luuLoiVanChuyen"))) return
    }
    fn()
  }

  // ── Sửa dòng ──
  /** Thay MỌI dòng của 1 người bằng `next` (tổ phân ca: mỗi ca 1 dòng; đơn vị khác: 0–1 dòng). Giữ vị trí dòng cũ. */
  const applyPersonLines = (staffId: string, next: SheetLineDraft[]) => {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.staff_id === staffId)
      const rest = prev.filter((l) => l.staff_id !== staffId)
      if (idx < 0) return [...rest, ...next]
      const before = prev.slice(0, idx).filter((l) => l.staff_id !== staffId).length
      return [...rest.slice(0, before), ...next, ...rest.slice(before)]
    })
    markChanged()
    setSheetFor(null)
  }

  const clearAllJobs = () => {
    if (!window.confirm(T("xacNhanXoaHet"))) return
    // Giữ dòng vắng tự động của người mặc định đã bị thay ở vị trí phụ trách.
    let next: SheetLineDraft[] = []
    for (const k of POSITION_KEYS) {
      const slot = positionsRef.current[k]
      if (slot?.staff_id && slot.goc_staff_id && slot.staff_id !== slot.goc_staff_id) {
        next = applyPositionChange(next, { staff_id: null, goc_staff_id: slot.goc_staff_id }, slot.staff_id)
      }
    }
    setLines(next)
    setSuggestedFrom(null)
    markChanged()
  }

  const changePosition = (key: PositionKey, staffId: string | null) => {
    const slot = positionsRef.current[key]
    const nextLines = applyPositionChange(linesRef.current, slot, staffId)
    const nextPos: SectionPositions = { ...positionsRef.current, [key]: { staff_id: staffId, goc_staff_id: slot?.goc_staff_id || null } }
    setLines(nextLines)
    linesRef.current = nextLines
    setPositions(nextPos)
    positionsRef.current = nextPos
    markChanged()
  }
  const positionCandidates = useMemo(
    () => staff.filter((s) => isStaffWorking(s, ngay) && !s.cho_xac_nhan).sort((a, b) => a.ten.localeCompare(b.ten, "vi")),
    [staff, ngay],
  )

  const quickAddReason = async (ten: string): Promise<AttendanceAbsenceReason | null> => {
    if (!factoryId || !ten) return null
    try {
      const { data, error: insErr } = await supabase.from("attendance_absence_reasons").insert({ factory_id: factoryId, ten, sort_order: 999 }).select("*").single()
      if (insErr) throw insErr
      const r = data as AttendanceAbsenceReason
      setReasons((prev) => [...prev, r])
      return r
    } catch (err) {
      setError(getErrorMessage(err, "Không thêm được lý do."))
      return null
    }
  }

  // ── Gửi ──
  // Người chưa giao lúc gửi: thành viên của ca/tổ đang điểm danh (thẻ chính).
  const unassignedCa = useMemo(() => {
    const ids = new Set<string>(tabs.find((t) => t.key === "ca")?.staffIds || [])
    return Array.from(ids)
      .filter((id) => classifyTiles(linesByStaff.get(id) || [], holderIds.has(id)) === "chua_giao")
      .map((id) => staffById.get(id))
      .filter((s): s is ShiftStaff => !!s)
  }, [tabs, linesByStaff, staffById, holderIds])
  const absentLines = myLines.filter((l) => l.diem_danh === "vang")

  const openReview = () => {
    setError(null)
    const hasAny = holderIds.size > 0 || myLines.some((l) => l.diem_danh === "vang" || l.cong_viec_ids.length > 0)
    if (!hasAny && unassignedCa.length === 0) {
      setError(T("chuaCoAi"))
      return
    }
    setReviewOpen(true)
  }

  const confirmSubmit = async (updated: SheetLineDraft[]) => {
    if (!section) return
    setSubmitting(true)
    setError(null)
    try {
      const byId = new Map(updated.map((l) => [l.id, l]))
      const cur = new Set(linesRef.current.map((l) => l.id))
      const merged = [...linesRef.current.map((l) => byId.get(l.id) || l), ...updated.filter((u) => !cur.has(u.id))]
      setLines(merged)
      linesRef.current = merged
      markChanged()
      const ok = await doSave()
      if (!ok) {
        setError(T("loiMang"))
        return
      }
      const { data: subRes, error: rpcErr } = await supabase.rpc("attendance_submit_section", { p_section_id: section.id })
      if (rpcErr) throw rpcErr
      setReviewOpen(false)
      await loadSection(section.id)
      // A4b — phiếu tổ: còn phân công người khác giao chưa gửi ⇒ phiếu chưa sang văn phòng.
      const part = typeof subRes === "string" && subRes.startsWith("mot_phan:") ? Number(subRes.split(":")[1]) || 0 : 0
      setNotice(part > 0 ? T("daGuiMotPhan", { n: part }) : T("daGuiOk"))
    } catch (err) {
      setError(isNetworkError(err) ? T("loiMang") : getErrorMessage(err, "Không gửi được."))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Gửi tất cả (người chấm công toàn nhà máy) ──
  const prepareSendAll = async () => {
    if (!section) return
    setError(null)
    if (editable && dirty) {
      const ok = await doSave()
      if (!ok) return
    }
    setSendAllBusy(true)
    try {
      const { data: secs, error: secErr } = await supabase.from("attendance_sheet_sections").select(SECTION_SELECT).eq("sheet_id", section.sheet_id)
      if (secErr) throw secErr
      const list = ((secs || []) as AttendanceSection[]).filter((s) => s.loai === "ca_san_xuat")
      const { data: ln, error: lnErr } = list.length
        ? await supabase.from("attendance_sheet_lines").select(LINE_SELECT).in("section_id", list.map((s) => s.id)).order("stt")
        : { data: [], error: null }
      if (lnErr) throw lnErr
      const bySec = new Map<string, SheetLineDraft[]>()
      for (const l of (ln || []) as DbLine[]) {
        const arr = bySec.get(l.section_id) || []
        arr.push(dbLineToDraft(l))
        bySec.set(l.section_id, arr)
      }
      const order = (c: string | null) => units.findIndex((u) => u.code === c)
      const items: SendAllItem[] = list
        .sort((a, b) => order(a.ca) - order(b.ca))
        .map((s) => {
          const unit = unitByCode.get(s.ca || "") || null
          const label = unit ? bilingual(lang, unit.ten, unit.ten_khmer) : `${T("ca")} ${s.ca}`
          const draft = bySec.get(s.id) || []
          const base = { sectionId: s.id, label, status: s.trang_thai, co: 0, vang: 0, auto: 0, lines: [] as SheetLineDraft[], holders: [] as string[], header: { ghi_chu: s.ghi_chu || "", vi_tri: {} as SectionPositions } }
          if (s.trang_thai !== "dang_lam" && s.trang_thai !== "tra_ve") return { ...base, send: false, note: T(STATUS_KEY[s.trang_thai]) }
          const mine = unit?.loai === "to" ? draft.filter((l) => canEditLine(l, ctxFor(s.ca || "", s.trang_thai))) : draft
          if (unit?.loai === "to" && mine.length === 0) return { ...base, send: false, note: T("khongCoPhanCongCuaBan") }
          const missingCaLine = unit?.loai === "to" && unit.phan_ca ? mine.find((l) => !l.ca_phan_cong && (!l.gui_luc || s.trang_thai === "tra_ve") && (l.diem_danh === "vang" || l.cong_viec_ids.length > 0)) : undefined
          if (missingCaLine) return { ...base, send: false, note: T("chuaChonCaCho", { ten: staffById.get(missingCaLine.staff_id)?.ten || "?" }) }
          if (draft.length === 0) return { ...base, send: false, note: T("phieuTrongBoQua") }
          const pos = hasStoredPositions(s.vi_tri) ? (s.vi_tri as SectionPositions) : {}
          const holders = positionHolderIds(pos)
          const lineMap = new Map(draft.map((l) => [l.staff_id, l]))
          let auto: SheetLineDraft[] = []
          if (unit?.loai === "ca") {
            const caIds = buildRosterTabs(staff, unit, dayChuyen, ngay, [...draft.map((l) => l.staff_id), ...holders]).find((t) => t.key === "ca")?.staffIds || []
            auto = caIds
              .filter((id) => classifyTile(lineMap.get(id), holders.has(id)) === "chua_giao")
              .map((id) => emptyLine({ staff_id: id, diem_danh: "vang", vang_loai: "co_phep" }))
          }
          const fixed = draft.map((l) => (l.diem_danh === "vang" && !l.vang_loai ? { ...l, vang_loai: "co_phep" as const } : l))
          const mineIds = new Set(mine.map((l) => l.id))
          const fixedMine = fixed.filter((l) => mineIds.has(l.id))
          const missingReason = fixedMine.find((l) => l.diem_danh === "vang" && l.vang_loai === "khong_phep" && !l.ly_do_id && !l.ly_do.trim())
          const missingKhung = linesMissingHours(fixedMine, unit?.khung_mac_dinh)
          const all = [...fixed, ...auto]
          const coIds = new Set([...all.filter((l) => l.diem_danh === "co").map((l) => l.staff_id), ...holders])
          return {
            ...base,
            send: !missingReason && missingKhung.length === 0,
            note: missingReason
              ? T("thieuLyDo", { ten: staffById.get(missingReason.staff_id)?.ten || "?" })
              : missingKhung.length > 0
                ? T("chuaCoGioLam", { ten: missingKhung.map((l) => workerNameOf(l)).join(", ") })
                : "",
            co: coIds.size,
            vang: all.filter((l) => l.diem_danh === "vang").length,
            auto: auto.length,
            lines: all,
            holders: Array.from(holders),
            header: { ghi_chu: s.ghi_chu || "", vi_tri: pos },
          }
        })
      // QR có danh sách Ca/Tổ ⇒ cảnh báo các đơn vị (đang dùng, đúng dây chuyền) chưa có phiếu ca nào có người.
      const doneCodes = new Set<string>(items.filter((it) => it.lines.length > 0 || it.holders.length > 0 || it.status !== "dang_lam").map((it) => String(list.find((s) => s.id === it.sectionId)?.ca || "")))
      setSendAllMissing(
        qrLock.units
          .map((c) => unitByCode.get(c))
          .filter((u): u is AttendanceUnit => !!u && u.is_active && (!u.day_chuyen || u.day_chuyen === dayChuyen) && !doneCodes.has(u.code))
          .map((u) => bilingual(lang, u.ten, u.ten_khmer)),
      )
      setSendAllItems(items)
    } catch (err) {
      setError(isNetworkError(err) ? T("loiMang") : getErrorMessage(err, "Không tải được các phiếu ca."))
    } finally {
      setSendAllBusy(false)
    }
  }

  const confirmSendAll = async () => {
    if (!sendAllItems || !section) return
    setSendAllBusy(true)
    setError(null)
    let sent = 0
    try {
      for (const it of sendAllItems.filter((x) => x.send)) {
        const { error: saveErr } = await supabase.rpc("attendance_save_section", {
          p_section_id: it.sectionId,
          p_header: it.header,
          p_lines: linesToPayload(it.lines, new Set(it.holders)),
        })
        if (saveErr) throw new Error(`${it.label}: ${saveErr.message}`)
        const { error: subErr } = await supabase.rpc("attendance_submit_section", { p_section_id: it.sectionId })
        if (subErr) throw new Error(`${it.label}: ${subErr.message}`)
        sent += 1
      }
      setSendAllItems(null)
      setNotice(T("daGuiTatCa", { n: sent }))
    } catch (err) {
      setError(isNetworkError(err) ? T("loiMang") : getErrorMessage(err, "Không gửi được."))
      if (sent > 0) setNotice(T("daGuiTatCa", { n: sent }))
    } finally {
      setSendAllBusy(false)
      await loadSection(section.id).catch(() => undefined)
    }
  }

  // ── Bỏ phiếu ca (Ca/Tổ không làm việc hôm đó) ──
  const isAdmin = user?.role === "admin"
  const canDiscard = !!section && (section.trang_thai === "da_duyet" ? isAdmin : canEditAny || isMine)
  const confirmDiscard = async (lyDo: string) => {
    if (!section) return
    setDiscarding(true)
    setError(null)
    try {
      const { error: rpcErr } = await supabase.rpc("attendance_discard_section", { p_section_id: section.id, p_ly_do: lyDo })
      if (rpcErr) throw rpcErr
      setDiscardOpen(false)
      setSection(null)
      setLines([])
      linesRef.current = []
      setHiddenLines([])
      hiddenLinesRef.current = []
      setPositions({})
      positionsRef.current = {}
      setSavedVersion(versionRef.current)
      setVersion(versionRef.current)
      setNotice(T("daBoPhieuCa"))
    } catch (err) {
      setError(isNetworkError(err) ? T("loiMang") : getErrorMessage(err, "Không bỏ được phiếu ca."))
    } finally {
      setDiscarding(false)
    }
  }

  // ── A4: Admin thu hồi phiếu tổ đã gửi (mở khoá mọi dòng để tổ trưởng sửa) ──
  const canRecall = !!section && isAdminUser && isToSection && section.trang_thai !== "da_duyet" && (section.trang_thai === "da_gui" || lines.some((l) => !!l.gui_luc))
  const confirmRecall = async (lyDo: string) => {
    if (!section) return
    setRecalling(true)
    setError(null)
    try {
      const { error: rpcErr } = await supabase.rpc("attendance_recall_section", { p_section_id: section.id, p_ly_do: lyDo })
      if (rpcErr) throw rpcErr
      setRecallOpen(false)
      await loadSection(section.id)
      setNotice(T("daThuHoi"))
    } catch (err) {
      setError(isNetworkError(err) ? T("loiMang") : getErrorMessage(err, "Không thu hồi được phiếu."))
    } finally {
      setRecalling(false)
    }
  }

  const [signingOut, setSigningOut] = useState(false)
  const handleLogout = async () => {
    setMenuOpen(false)
    setSigningOut(true)
    try {
      await signOutEverywhere()
    } finally {
      window.location.replace("/login")
    }
  }

  const changeLang = (l: AttLang) => {
    setLang(l)
    storeAttLang(l)
  }

  // ── Dữ liệu hiển thị ──
  const allRosterIds = useMemo(() => Array.from(new Set(tabs.flatMap((t) => t.staffIds))), [tabs])
  const counts = countRoster(allRosterIds, lines, holderIds)
  const currentTab = tabs.find((t) => t.key === activeTab) || tabs[0]
  const tileIds = (currentTab?.staffIds || []).filter((id) => !onlyUnassigned || classifyTiles(linesByStaff.get(id) || [], holderIds.has(id)) === "chua_giao")
  // Ca/Tổ chọn được: người chấm toàn nhà máy ⇒ mọi ca/tổ đang dùng; trực ca ⇒ chỉ ca/tổ được phân công.
  const unitChoices = units.filter(
    (u) =>
      u.is_active &&
      (canEditAny || assignedCas.includes(u.code) || (u.loai === "to" && !!u.phan_ca && myCaCodes.length > 0)) &&
      (qrLock.units.length === 0 || qrLock.units.includes(u.code)),
  )

  const jobsForSheet = useCallback(
    // Mọi người (kể cả người thay mượn từ ca/tổ khác) chỉ nhận việc của Ca/Tổ đang điểm danh.
    (line: SheetLineDraft | undefined) => jobsForUnit(jobs, currentUnit, dayChuyen, line?.cong_viec_ids || []),
    [jobs, currentUnit, dayChuyen],
  )

  // Tên người KHÁC đang nhận từng việc trong phiếu ca (thẻ việc hiện số + tên, 2026-11-25).
  const jobPeopleExcept = (staffId: string) => {
    const m = new Map<string, string[]>()
    for (const l of lines) {
      if (l.staff_id === staffId) continue
      let ten: string
      if (l.diem_danh === "co") ten = staffById.get(l.staff_id)?.ten || ""
      else if (l.thay_the_staff_id) ten = staffById.get(l.thay_the_staff_id)?.ten || ""
      else if (l.thay_the_ten) ten = `${l.thay_the_ten} (tạm)`
      else continue
      for (const j of l.cong_viec_ids) m.set(j, [...(m.get(j) || []), ten])
    }
    return m
  }
  const sheetPerson = sheetFor ? staffById.get(sheetFor) : undefined
  const replacementCandidates = useMemo(() => {
    if (!sheetFor) return []
    // Người thay (chốt 2026-11-27): người CÙNG Ca/Tổ đang có mặt cũng thay được (1 người làm nhiều vị trí) và 1 người thay được
    // nhiều người. Chỉ loại: chính người vắng + người đang VẮNG trong phiếu. Người ngoài: của Ca/Tổ khác hoặc công nhân chưa gán.
    const absent = new Set<string>(lines.filter((l) => l.diem_danh === "vang").map((l) => l.staff_id))
    absent.add(sheetFor)
    const roster = new Set(tabs.find((t) => t.key === "ca")?.staffIds || [])
    return staff
      .filter((s) => !absent.has(s.id) && isStaffWorking(s, ngay) && !s.cho_xac_nhan)
      .filter((s) => roster.has(s.id) || s.ca_mac_dinh === ca || s.loai_nhan_su === "cong_nhan" || !!s.ca_mac_dinh)
      .sort((a, b) => {
        const sa = roster.has(a.id) || a.ca_mac_dinh === ca ? 0 : 1
        const sb = roster.has(b.id) || b.ca_mac_dinh === ca ? 0 : 1
        return sa - sb || a.ten.localeCompare(b.ten, "vi")
      })
  }, [sheetFor, lines, staff, ngay, ca, tabs])
  /** Nhãn phụ trong danh sách người thay: "Cùng ca · Phả mủ" (người cùng Ca/Tổ, kèm việc đang làm). */
  const candidateNote = (s: ShiftStaff): string => {
    const sameUnit = s.ca_mac_dinh === ca || (tabs.find((t) => t.key === "ca")?.staffIds || []).includes(s.id)
    const l = lineByStaff.get(s.id)
    const job = l && l.diem_danh === "co" && l.cong_viec_ids[0] ? jobById.get(l.cong_viec_ids[0]) : undefined
    const jobText = job ? bilingual(lang, job.ten, job.ten_khmer) : ""
    if (sameUnit) return [T("cungCa"), jobText].filter(Boolean).join(" · ")
    return [s.ca_mac_dinh ? unitByCode.get(s.ca_mac_dinh)?.ten || s.ca_mac_dinh : "", jobText].filter(Boolean).join(" · ")
  }

  // ── A3: Sơ đồ dây chuyền (Mủ tạp) ──
  // Đọc MỌI phiếu Ca/Tổ của phiếu ngày (RLS SELECT cho trực ca đọc cả phiếu ngày). Phiếu đang mở dùng dòng đang sửa.
  const [diagData, setDiagData] = useState<{ sec: AttendanceSection; lines: DiagramLine[] }[]>([])
  const [windows, setWindows] = useState<ProdWindow[]>([])
  const [chipChoice, setChipChoice] = useState<{ forCa: string; code: string } | null>(null)
  const [selPerson, setSelPerson] = useState<DiagramPerson | null>(null)
  const [pickerCell, setPickerCell] = useState<DiagramCell | null>(null)
  const [diagBusy, setDiagBusy] = useState<string | null>(null)
  const showDiagram = !!section && dayChuyen === DIAGRAM_DAY_CHUYEN

  const loadDiagram = useCallback(async (sheetId: string) => {
    const { data: secs, error: secErr } = await supabase.from("attendance_sheet_sections").select(SECTION_SELECT).eq("sheet_id", sheetId)
    if (secErr) throw secErr
    const list = ((secs || []) as AttendanceSection[]).filter((s) => s.loai === "ca_san_xuat" && !!s.ca)
    const { data: ln, error: lnErr } = list.length
      ? await supabase.from("attendance_sheet_lines").select(LINE_SELECT).in("section_id", list.map((s) => s.id)).order("stt")
      : { data: [], error: null }
    if (lnErr) throw lnErr
    const bySec = new Map<string, DiagramLine[]>()
    for (const l of (ln || []) as DbLine[]) {
      const arr = bySec.get(l.section_id) || []
      arr.push({ ...dbLineToDraft(l), giao_luc: l.giao_luc || null })
      bySec.set(l.section_id, arr)
    }
    setDiagData(list.map((s) => ({ sec: s, lines: bySec.get(s.id) || [] })))
  }, [])

  const refreshWindows = useCallback(async () => {
    if (!factoryId) return
    try {
      const token = (await getFreshAuthSession())?.access_token ?? null
      setWindows(await loadProductionWindows(token, factoryId, ngay, dayChuyen))
    } catch {
      // Không lấy được khung kiện quét ⇒ hiện mọi người của tổ (sơ đồ vẫn dùng được).
      setWindows([])
    }
  }, [factoryId, ngay, dayChuyen])

  const sheetIdForDiagram = showDiagram ? section?.sheet_id || null : null
  useEffect(() => {
    if (!sheetIdForDiagram) return
    let alive = true
    const run = () => {
      if (!alive) return
      void loadDiagram(sheetIdForDiagram).catch(() => undefined)
      void refreshWindows()
    }
    run()
    const t = window.setInterval(run, 60_000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [sheetIdForDiagram, loadDiagram, refreshWindows])

  const caUnits = useMemo(() => units.filter((u) => u.is_active && u.loai === "ca"), [units])
  const defaultChip = useMemo(() => {
    if (currentUnit?.loai === "ca") return currentUnit.code
    const assigned = assignedCas.find((c) => unitByCode.get(c)?.loai === "ca")
    if (assigned) return assigned
    const now = Date.now()
    const live = windows.find((w) => new Date(w.start).getTime() <= now && now <= new Date(w.end).getTime() + 3600_000)
    return live?.ca || caUnits[0]?.code || "A"
  }, [currentUnit, assignedCas, unitByCode, windows, caUnits])
  const chipCa = chipChoice && chipChoice.forCa === ca ? chipChoice.code : defaultChip

  const diagInput: DiagramSectionInput[] = useMemo(() => {
    const out: DiagramSectionInput[] = diagData
      .filter((d) => !section || d.sec.id !== section.id)
      .map((d) => ({ id: d.sec.id, ca: d.sec.ca || "", trang_thai: d.sec.trang_thai, lines: d.lines }))
    if (section) {
      const giao = new Map((diagData.find((d) => d.sec.id === section.id)?.lines || []).map((l) => [l.id, l.giao_luc]))
      out.push({ id: section.id, ca: section.ca || ca, trang_thai: section.trang_thai, lines: [...lines, ...hiddenLines].map((l) => ({ ...l, giao_luc: giao.get(l.id) || null })) })
    }
    return out
  }, [diagData, section, lines, hiddenLines, ca])
  const diagStatusByUnit = useMemo(() => new Map(diagInput.map((d) => [d.ca, d.trang_thai])), [diagInput])

  const diagram = useMemo(
    () =>
      buildDiagram({
        jobs,
        units,
        sections: diagInput,
        chipCa,
        windows,
        ngay,
        dayChuyen,
        staffById,
        tempSuffix: T("tam"),
      }),
    [jobs, units, diagInput, chipCa, windows, ngay, dayChuyen, staffById, T],
  )
  /** Ô sơ đồ của từng việc — huy hiệu thẻ người. */
  const stationOfJobId = useMemo(() => {
    const m = new Map<string, StationKey>()
    for (const j of jobs) if (j.is_active && isStationKey(j.so_do_vi_tri)) m.set(j.id, j.so_do_vi_tri)
    return m
  }, [jobs])

  const unitEditable = (unitCode: string | null): boolean => {
    if (!section || !unitCode) return false
    const st = diagStatusByUnit.get(unitCode)
    const u = unitByCode.get(unitCode)
    // A4: phiếu TỔ đã gửi vẫn thêm được (dòng đã gửi bị khoá ở từng thao tác) — chỉ khoá khi đã duyệt.
    if (u?.loai === "to" ? st === "da_duyet" : st && st !== "dang_lam" && st !== "tra_ve") return false
    if (canEditAny) return true
    return unitCode === ca && editable
  }
  const canEditCell = (cell: DiagramCell) => !!cell.job && unitEditable(cell.unitCode)
  const unitLabel = (code: string) => {
    const u = unitByCode.get(code)
    return u ? bilingual(lang, u.ten, u.ten_khmer) : code
  }
  const editOptsFor = (unitCode: string) => {
    const u = unitByCode.get(unitCode)
    return {
      hours: defaultWorkHours(u?.khung_mac_dinh),
      vehicleOf: (id: string) => vehicleByStaff.get(id) || "",
      jobById,
      // A4: ghi vào ô tổ phân ca ⇒ dòng mang ca đang xem trên sơ đồ.
      caPhanCong: u?.loai === "to" && u.phan_ca ? chipCa : undefined,
      canEdit: (l: SheetLineDraft) => canEditLine(l, ctxFor(unitCode, diagStatusByUnit.get(unitCode) || "")),
    }
  }
  const reportEditError = (r: LineEditResult, workerId: string | null, unitCode: string) => {
    if (r.error === "absent") setError(T("sdNguoiVang", { ten: (workerId && staffById.get(workerId)?.ten) || "?", phieu: unitLabel(unitCode) }))
    else if (r.error === "locked") setError(T("sdDongDaGui"))
    else if (r.error) setError(T("sdKhoa"))
  }

  /** Ghi 1 thay đổi vào phiếu Ca/Tổ `unitCode`: phiếu đang mở ⇒ sửa tại chỗ (tự lưu); phiếu khác ⇒ mở + đọc lại + lưu ngay. */
  const writeSection = async (unitCode: string, fn: (ls: SheetLineDraft[]) => LineEditResult, workerId: string | null): Promise<boolean> => {
    if (section && unitCode === ca) {
      if (!editable) {
        setError(T("sdKhoa"))
        return false
      }
      const r = fn(linesRef.current)
      if (r.error) {
        reportEditError(r, workerId, unitCode)
        return false
      }
      // L3 — không cho tạo phân công trùng ca / giờ với phần người khác đã chấm (đang ẩn).
      const hit = conflictOf(r.lines.filter((l) => !linesRef.current.includes(l)), hiddenLinesRef.current)
      if (hit) {
        setError(hit)
        return false
      }
      setLines(r.lines)
      linesRef.current = r.lines
      markChanged()
      return true
    }
    if (!canEditAny || !factoryId) {
      setError(T("sdKhoa"))
      return false
    }
    const label = unitLabel(unitCode)
    setDiagBusy(T("sdDangGhi", { ten: label }))
    try {
      const { data: sid, error: openErr } = await supabase.rpc("attendance_open_section", {
        p_factory_id: factoryId,
        p_ngay: ngay,
        p_day_chuyen: dayChuyen,
        p_loai: "ca_san_xuat",
        p_ca: unitCode,
      })
      if (openErr) throw openErr
      // Đọc lại dòng MỚI NHẤT ngay trước khi lưu (trực ca tổ đó có thể đang sửa trên máy khác).
      const [{ data: sec, error: secErr }, { data: ln, error: lnErr }] = await Promise.all([
        supabase.from("attendance_sheet_sections").select(SECTION_SELECT).eq("id", sid as string).single(),
        supabase.from("attendance_sheet_lines").select(LINE_SELECT).eq("section_id", sid as string).order("stt"),
      ])
      if (secErr) throw secErr
      if (lnErr) throw lnErr
      const s = sec as AttendanceSection
      const sUnit = unitByCode.get(s.ca || "")
      if (sUnit?.loai === "to" ? s.trang_thai === "da_duyet" : s.trang_thai !== "dang_lam" && s.trang_thai !== "tra_ve") {
        setError(T("sdKhoa"))
        return false
      }
      const r = fn(((ln || []) as DbLine[]).map(dbLineToDraft))
      if (r.error) {
        reportEditError(r, workerId, unitCode)
        return false
      }
      const holders = positionHolderIds(hasStoredPositions(s.vi_tri) ? (s.vi_tri as SectionPositions) : {})
      const { error: saveErr } = await supabase.rpc("attendance_save_section", {
        p_section_id: s.id,
        p_header: { ghi_chu: s.ghi_chu || "" },
        p_lines: linesToPayload(r.lines, holders),
      })
      if (saveErr) throw saveErr
      setNotice(T("sdDaGhi", { ten: label }))
      return true
    } catch (err) {
      setError(isNetworkError(err) ? T("loiMang") : getErrorMessage(err, "Không ghi được phiếu."))
      return false
    } finally {
      setDiagBusy(null)
    }
  }

  const afterRemoteWrite = () => {
    if (section?.sheet_id) void loadDiagram(section.sheet_id).catch(() => undefined)
  }

  /** Chuyển 1 người từ ô của họ sang ô `cell`: bỏ việc ô cũ, nhận việc ô mới, giữ việc khác (chốt 2026-11-27). */
  const moveToCell = async (p: DiagramPerson, cell: DiagramCell) => {
    const job = cell.job
    const target = cell.unitCode
    setSelPerson(null)
    if (!job || !target) return
    if (p.jobId === job.id && p.unitCode === target) return
    if (!canEditCell(cell) || !unitEditable(p.unitCode)) {
      setError(T("sdKhoa"))
      return
    }
    const remote = p.unitCode !== ca || target !== ca
    if (p.unitCode === target) {
      const worker = p.workerId || p.lineStaffId
      await writeSection(target, (ls) => moveJobOnLine(ls, p.lineId, p.jobId, job.id, editOptsFor(target), worker), p.workerId)
    } else {
      const workerId = p.workerId
      if (!workerId) {
        setError(T("sdTamKhongChuyen"))
        return
      }
      const ok = await writeSection(target, (ls) => addJobForWorker(ls, workerId, job.id, editOptsFor(target)), workerId)
      if (ok) await writeSection(p.unitCode, (ls) => removeJobFromLine(ls, p.lineId, p.jobId, editOptsFor(p.unitCode).canEdit), workerId)
    }
    if (remote) afterRemoteWrite()
  }

  /** Gỡ người khỏi ô (dấu X / kéo ra khoảng trống): bỏ đúng việc của ô đó, giữ việc khác. */
  const removeFromCell = async (p: DiagramPerson) => {
    setSelPerson(null)
    if (!unitEditable(p.unitCode)) {
      setError(T("sdKhoa"))
      return
    }
    const ok = await writeSection(p.unitCode, (ls) => removeJobFromLine(ls, p.lineId, p.jobId, editOptsFor(p.unitCode).canEdit), p.workerId)
    if (ok && p.unitCode !== ca) afterRemoteWrite()
  }

  const onDiagramCellTap = (cell: DiagramCell) => {
    if (!cell.job) return
    if (selPerson) {
      void moveToCell(selPerson, cell)
      return
    }
    if (!canEditCell(cell)) {
      setError(T("sdKhoa"))
      return
    }
    setPickerCell(cell)
  }

  const onDiagramDrop = (cell: DiagramCell, payload: DiagramDragPayload) => {
    if (payload.type === "person") {
      const all = [...Object.values(diagram.cells).flatMap((c) => c.people), ...diagram.others.flatMap((o) => o.people)]
      const p = all.find((x) => x.key === payload.key)
      if (p) void moveToCell(p, cell)
      return
    }
    const job = cell.job
    const target = cell.unitCode
    if (!job || !target || !canEditCell(cell)) {
      setError(T("sdKhoa"))
      return
    }
    void writeSection(target, (ls) => addJobForWorker(ls, payload.staffId, job.id, editOptsFor(target)), payload.staffId).then((ok) => {
      if (ok && target !== ca) afterRemoteWrite()
    })
  }

  /** Việc đang làm hôm nay của từng người (mọi phiếu Ca/Tổ) — nhãn phụ ở tấm chọn người. */
  const todayJobsOf = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const d of diagInput) {
      for (const l of d.lines) {
        const w = l.diem_danh === "co" ? l.staff_id : l.thay_the_staff_id
        if (!w) continue
        for (const jid of l.cong_viec_ids) {
          const j = jobById.get(jid)
          if (!j) continue
          m.set(w, [...(m.get(w) || []), `${unitByCode.get(d.ca)?.ten || d.ca} · ${bilingual(lang, j.ten, j.ten_khmer)}`])
        }
      }
    }
    return m
  }, [diagInput, jobById, unitByCode, lang])

  const pickerGroups: PickerGroup[] = useMemo(() => {
    const unitCode = pickerCell?.unitCode
    if (!unitCode) return []
    const uLabel = unitByCode.get(unitCode) ? bilingual(lang, unitByCode.get(unitCode)!.ten, unitByCode.get(unitCode)!.ten_khmer) : unitCode
    const secLines = diagInput.find((d) => d.ca === unitCode)?.lines || []
    const absent = new Set(secLines.filter((l) => l.diem_danh === "vang").map((l) => l.staff_id))
    const inSection = new Set(secLines.map((l) => (l.diem_danh === "co" ? l.staff_id : l.thay_the_staff_id)).filter(Boolean))
    const presentToday = new Set(todayJobsOf.keys())
    const pool = staff.filter(
      (s) => isStaffWorking(s, ngay) && !s.cho_xac_nhan && (s.loai_nhan_su === "cong_nhan" || !!s.ca_mac_dinh || presentToday.has(s.id) || inSection.has(s.id)),
    )
    const item = (s: ShiftStaff) => ({
      staffId: s.id,
      ten: s.ten,
      gioiTinh: s.gioi_tinh,
      note: (todayJobsOf.get(s.id) || []).join(", "),
      disabledNote: absent.has(s.id) ? T("sdNguoiVang", { ten: s.ten, phieu: uLabel }) : undefined,
    })
    const g1 = pool.filter((s) => s.ca_mac_dinh === unitCode || inSection.has(s.id) || absent.has(s.id)).sort(compareStaffOrder)
    const g1ids = new Set(g1.map((s) => s.id))
    const g2 = pool.filter((s) => !g1ids.has(s.id) && presentToday.has(s.id)).sort(compareStaffOrder)
    const g2ids = new Set(g2.map((s) => s.id))
    const g3 = pool.filter((s) => !g1ids.has(s.id) && !g2ids.has(s.id)).sort((a, b) => a.ten.localeCompare(b.ten, "vi"))
    return [
      { label: `${T("sdCungDonVi")} · ${uLabel}`, items: g1.map(item) },
      { label: T("sdCoMatHomNay"), items: g2.map(item) },
      { label: T("sdNguoiKhac"), items: g3.map(item) },
    ].filter((g) => g.items.length > 0)
  }, [pickerCell, unitByCode, lang, diagInput, todayJobsOf, staff, ngay, T])

  const applyPicker = async (selected: Set<string>) => {
    const cell = pickerCell
    const job = cell?.job
    const unitCode = cell?.unitCode
    if (!cell || !job || !unitCode) return
    const before = new Set(cell.people.map((p) => p.workerId).filter((x): x is string => !!x))
    const toAdd = Array.from(selected).filter((id) => !before.has(id))
    const toRemove = Array.from(before).filter((id) => !selected.has(id))
    if (toAdd.length === 0 && toRemove.length === 0) {
      setPickerCell(null)
      return
    }
    const opt = editOptsFor(unitCode)
    const ok = await writeSection(
      unitCode,
      (ls) => {
        let cur = ls
        for (const id of toRemove) {
          const l = lineOfWorkerJob(cur, id, job.id, opt.caPhanCong)
          if (l) cur = removeJobFromLine(cur, l.id, job.id, opt.canEdit).lines
        }
        for (const id of toAdd) {
          const r = addJobForWorker(cur, id, job.id, opt)
          if (!r.error) cur = r.lines
        }
        return { lines: cur }
      },
      null,
    )
    if (ok) {
      setPickerCell(null)
      if (unitCode !== ca) afterRemoteWrite()
    }
  }

  // ── Render ──
  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
        <Loader2 className="mr-2 animate-spin" size={18} /> {T("loading")}
      </div>
    )
  }

  // Người đăng nhập: chức vụ THẬT (chính quyền → chức vụ), không cố định chữ "Trực ca".
  const meStaff = user ? staff.find((s) => s.profile_id === user.id) : undefined
  const myName = user?.full_name || user?.username || ""
  const myRole = (meStaff?.chuc_vu_chinh_quyen || meStaff?.chuc_vu || "").trim() || T("trucCa")
  // Chữ cái đầu của TÊN (từ cuối họ tên) cho vòng tròn avatar.
  const myInitial = (myName.trim().split(/\s+/).pop() || "?").charAt(0).toLocaleUpperCase("vi")

  const signOutOverlay = signingOut
    ? createPortal(
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-white/90 text-slate-600">
          <Loader2 size={28} className="animate-spin text-emerald-600" />
          <span className="text-sm font-bold">{T("dangDangXuat")}</span>
        </div>,
        document.body,
      )
    : null

  // Không có quyền trực ca, hoặc chưa được phân công ca nào (và không phải người chấm công) ⇒ không thấy gì.
  const blockedMsg = !fatal && user
    ? !canShift
      ? T("noPermission")
      : catalogReady && !canEditAny && assignedCas.length === 0
        ? T("chuaPhanCongCaTo")
        : null
    : null
  if (blockedMsg) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-amber-200 bg-white p-5 text-center shadow-sm">
          <AlertTriangle size={32} className="mx-auto text-amber-500" />
          <p className="text-sm font-semibold leading-6 text-slate-700">{blockedMsg}</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => window.location.assign("/dashboard")} className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2.5 text-sm font-bold text-slate-600">
              <ArrowLeft size={15} /> {T("backToDashboard")}
            </button>
            <button type="button" onClick={() => void handleLogout()} className="flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 py-2.5 text-sm font-bold text-rose-700">
              <LogOut size={15} /> {T("logout")}
            </button>
          </div>
          <div className="flex justify-center">
            <div className="flex overflow-hidden rounded-lg border border-slate-200">
              {ATT_LANG_OPTIONS.map((o) => (
                <button key={o.code} type="button" onClick={() => changeLang(o.code)} className={`px-2.5 py-1 text-xs font-bold ${lang === o.code ? "bg-emerald-600 text-white" : "text-slate-600"}`}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {signOutOverlay}
      </div>
    )
  }

  const tabLabel = (t: { key: string; label: string; code: string | null }) => {
    if (t.key === "ca") return currentUnit ? bilingual(lang, currentUnit.ten, currentUnit.ten_khmer) : `${T("ca")} ${ca}`
    if (t.key === "khac") return T("tabKhac")
    if (lang === "km") {
      if (t.code === "tiep_nhan") return T("tabTiepNhan")
      if (t.code === "co_dien") return T("tabCoDien")
      if (t.code === "bao_tri") return T("tabBaoTri")
    }
    return t.label
  }
  const dcLabel = (dc: string) => (dc === "Mủ tạp" ? T("dcMuTap") : dc === "Mủ nước" ? T("dcMuNuoc") : dc)

  // Trạng thái tự lưu — hiện ở thanh đáy (nền trắng); không có thanh đáy thì hiện ở dải trạng thái đầu nội dung.
  const saveBadge =
    saveState === "saving" ? (
      <span className="flex items-center gap-1 font-semibold text-slate-500">
        <Loader2 size={12} className="animate-spin" /> {T("dangLuuNhap")}
      </span>
    ) : saveState === "error" ? (
      <button type="button" onClick={() => void doSave()} className="flex items-center gap-1 font-bold text-amber-700">
        <CloudOff size={12} /> {T("luuLoi")}
      </button>
    ) : savedAt && !dirty ? (
      <span className="flex items-center gap-1 font-semibold text-emerald-700">
        <Check size={12} /> {T("daLuuLuc", { gio: fmtHm(savedAt) })}
      </span>
    ) : null
  const showBottomBar = !!section && (editable || canEditAny)
  /** Nhãn nút gửi: Ca của mình ở tổ phân ca (vd "Ca B"), ngược lại tên Ca/Tổ đang mở. */
  const sendLabel =
    phanCa && myCaCodes.length > 0 && !toFullScope
      ? myCaCodes.map((c) => (unitByCode.get(c) ? bilingual(lang, unitByCode.get(c)!.ten, unitByCode.get(c)!.ten_khmer) : c)).join(", ")
      : currentUnit
        ? bilingual(lang, currentUnit.ten, currentUnit.ten_khmer)
        : ca

  return (
    <div className="min-h-screen bg-slate-50 pb-28">
      <header className="sticky top-0 z-30 bg-gradient-to-r from-[#1c3a32] to-[#2f5d52] text-white shadow">
        {/* Dòng 1: tiêu đề · ngày · nút đổi ngôn ngữ · avatar */}
        <div className="mx-auto flex max-w-5xl items-center gap-1.5 px-3 pt-2.5">
          <ClipboardCheck size={18} className="shrink-0 text-emerald-200" />
          <div className="min-w-0 flex-1 whitespace-nowrap text-sm font-bold">{T("qrDiemDanhNgan")}</div>
          <input
            type="date"
            value={ngay}
            max={currentUnit?.loai === "to" ? tomorrowISO : getFactoryTodayISO()}
            onChange={(e) => {
              const v = e.target.value
              if (v) void flushThen(() => setNgay(v))
            }}
            aria-label={T("ngaySx")}
            className="h-8 shrink-0 rounded-lg border border-white/30 bg-white/10 px-1.5 text-xs font-semibold text-white [color-scheme:dark]"
          />
          {/* 1 nút: hiện ngôn ngữ SẼ chuyển sang (đang VI ⇒ "ខ្មែរ", đang Khmer ⇒ "VI") — gọn để dòng 1 không rớt ở 360 px. */}
          {(() => {
            const next = ATT_LANG_OPTIONS.find((o) => o.code !== lang) || ATT_LANG_OPTIONS[0]
            return (
              <button
                type="button"
                onClick={() => changeLang(next.code)}
                title={next.code === "km" ? "ភាសាខ្មែរ" : "Tiếng Việt"}
                aria-label={next.code === "km" ? "ភាសាខ្មែរ" : "Tiếng Việt"}
                className="flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-white/30 bg-white/10 px-2 text-xs font-bold text-white"
              >
                {next.label}
              </button>
            )
          })()}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-300 text-sm font-black text-emerald-950 shadow"
              aria-label="Menu"
              title={myName}
            >
              {myInitial}
            </button>
            {menuOpen ? (
              <>
                <button type="button" aria-label={T("close")} className="fixed inset-0 z-30 cursor-default" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full z-40 mt-1.5 w-60 overflow-hidden rounded-xl bg-white text-sm text-slate-700 shadow-xl">
                  <div className="border-b border-slate-100 px-3 py-2.5">
                    <div className="break-words font-bold leading-5 text-slate-800">{myName}</div>
                    <div className="break-words text-xs leading-4 text-slate-500">{myRole}</div>
                  </div>
                  <button type="button" onClick={() => void flushThen(() => window.location.assign("/dashboard/attendance"))} className="flex w-full items-center gap-2 px-3 py-2.5 hover:bg-slate-50">
                    <ArrowLeft size={15} /> {T("backToDashboard")}
                  </button>
                  <button type="button" onClick={() => void flushThen(() => void handleLogout())} className="flex w-full items-center gap-2 px-3 py-2.5 text-rose-600 hover:bg-rose-50">
                    <LogOut size={15} /> {T("logout")}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
        {/* Dòng 2: Ca/Tổ (giãn) · dây chuyền */}
        <div className="mx-auto flex max-w-5xl items-center gap-1.5 px-3 pb-2.5 pt-2">
          <select
            value={ca}
            onChange={(e) => {
              const v = e.target.value
              const fixedDc = unitByCode.get(v)?.day_chuyen || null
              void flushThen(() => {
                setCa(v)
                if (fixedDc) setDayChuyen(fixedDc)
              })
            }}
            aria-label={T("caTo")}
            className="h-9 min-w-0 flex-1 rounded-lg border border-white/30 bg-white/10 px-2 text-xs font-bold text-white [&>option]:text-slate-800"
          >
            {unitChoices.map((u) => {
              // Ca/Tổ người đăng nhập được phân công: in đậm + ★ (mobile bỏ qua font-weight trong option).
              const mine = assignedCas.includes(u.code)
              return (
                <option key={u.code} value={u.code} style={{ fontWeight: mine ? 700 : 400 }}>
                  {bilingual(lang, u.ten, u.ten_khmer)}
                  {mine ? " ★" : ""}
                </option>
              )
            })}
            {!unitChoices.some((u) => u.code === ca) ? <option value={ca}>{currentUnit ? bilingual(lang, currentUnit.ten, currentUnit.ten_khmer) : ca}</option> : null}
          </select>
          <div className="flex h-9 shrink-0 overflow-hidden rounded-lg border border-white/30 text-xs">
            {ATTENDANCE_DAY_CHUYEN.map((dc) => (
              <button
                key={dc}
                type="button"
                disabled={(!!currentUnit?.day_chuyen && currentUnit.day_chuyen !== dc) || (!!qrLock.dc && qrLock.dc !== dc)}
                title={
                  qrLock.dc && qrLock.dc !== dc
                    ? T("qrKhoaDayChuyen", { dc: qrLock.dc })
                    : currentUnit?.day_chuyen && currentUnit.day_chuyen !== dc
                      ? ` chỉ thuộc ${currentUnit.day_chuyen}`
                      : undefined
                }
                onClick={() => void flushThen(() => setDayChuyen(dc))}
                className={`whitespace-nowrap px-2.5 font-bold disabled:cursor-not-allowed disabled:opacity-30 ${dayChuyen === dc ? "bg-white text-[#1c3a32]" : "text-white"}`}
              >
                {dcLabel(dc)}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-3 px-3 py-3">
        {section || maPhieu || qrName ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {section ? <span className={`rounded-full px-2 py-0.5 font-bold ${STATUS_CLS[section.trang_thai]}`}>{T(STATUS_KEY[section.trang_thai])}</span> : null}
            {maPhieu ? <span className="font-mono font-semibold text-slate-500">{maPhieu}</span> : null}
            {qrName ? <span className="text-slate-400">· {T("qrPoint")}: {qrName}</span> : null}
            {!showBottomBar && saveBadge ? <span className="ml-auto">{saveBadge}</span> : null}
          </div>
        ) : null}
        {fatal ? <div className="rounded-xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">{fatal}</div> : null}
        {error ? (
          <div className="flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label={T("close")}>
              <X size={15} />
            </button>
          </div>
        ) : null}
        {notice ? (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
            <Check size={16} /> <span className="flex-1">{notice}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label={T("close")}>
              <X size={15} />
            </button>
          </div>
        ) : null}

        {opening ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" /> {T("dangMoPhieu")}
          </div>
        ) : openError ? (
          <div className="space-y-2 rounded-xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">
            <div>{openError}</div>
            <button type="button" onClick={() => void openCurrent()} className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-rose-700">
              <RefreshCw size={13} /> {T("retry")}
            </button>
          </div>
        ) : section ? (
          <>
            {section.trang_thai === "tra_ve" && section.tra_ve_ly_do ? (
              <div className="flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {T("biTraVe", { lyDo: section.tra_ve_ly_do })}
              </div>
            ) : null}
            {lockReason ? <div className="rounded-xl bg-slate-100 p-3 text-sm font-semibold text-slate-600">{lockReason}</div> : null}
            {isToSection && section.trang_thai === "da_gui" && editable ? (
              <div className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                {T("toDaGuiVanThem", { gio: section.gui_luc ? fmtHm(new Date(section.gui_luc)) : "" })}
              </div>
            ) : null}
            {canRecall ? (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setRecallOpen(true)}
                  className="flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-bold text-amber-700 hover:bg-amber-50"
                >
                  <Undo2 size={13} /> {T("thuHoiPhieu")}
                </button>
              </div>
            ) : null}
            {canDiscard ? (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setDiscardOpen(true)}
                  className="flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-xs font-bold text-rose-600 hover:bg-rose-50"
                >
                  <Trash2 size={13} /> {T("boPhieuCa")}
                </button>
              </div>
            ) : null}
            {suggestedFrom && editable ? (
              <div className="flex items-center gap-2 rounded-xl bg-violet-50 p-3 text-sm font-semibold text-violet-800">
                <Sparkles size={16} className="shrink-0" />
                <span className="flex-1">
                  {T("goiYTheoPhieu", { ngay: fmtDdMm(suggestedFrom) })}
                  {suggestSkipped > 0 ? <span className="block text-xs font-medium text-violet-700">{T("goiYBoQuaTrung", { n: suggestSkipped })}</span> : null}
                </span>
                <button type="button" onClick={clearAllJobs} className="flex items-center gap-1 whitespace-nowrap rounded-lg bg-white px-2 py-1 text-xs font-bold text-violet-700">
                  <Eraser size={13} /> {T("xoaHetViec")}
                </button>
              </div>
            ) : null}

            <PositionBlock T={T} unitLoai={currentUnit?.loai || null} positions={positions} staffById={staffById} candidates={positionCandidates} readOnly={!editable} onChange={changePosition} />


            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold">
                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-700">
                  {T("co")}: {counts.co}
                </span>
                <span className="rounded-full bg-rose-100 px-2.5 py-1 text-rose-700">
                  {T("vang")}: {counts.vang}
                </span>
                <button
                  type="button"
                  onClick={() => setOnlyUnassigned((v) => !v)}
                  className={`rounded-full px-2.5 py-1 ${onlyUnassigned ? "bg-slate-700 text-white" : "bg-slate-200 text-slate-600"}`}
                >
                  {T("chuaGiao")}: {counts.chuaGiao}
                  {onlyUnassigned ? ` · ${T("chiChuaGiao")}` : ""}
                </button>
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                {tabs.map((t) => {
                  const pending = t.staffIds.filter((id) => classifyTiles(linesByStaff.get(id) || [], holderIds.has(id)) === "chua_giao").length
                  const active = currentTab?.key === t.key
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setActiveTab(t.key)}
                      className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-bold ${active ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 bg-white text-slate-600"}`}
                    >
                      {tabLabel(t)} <span className={active ? "text-white/80" : "text-slate-400"}>{t.staffIds.length}</span>
                      {pending > 0 ? <span className="ml-1 rounded-full bg-amber-400 px-1.5 text-[11px] text-white">{pending}</span> : null}
                    </button>
                  )
                })}
              </div>
            </div>

            {tileIds.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-400">{T("khongCoNguoiThe")}</div>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6">
                {tileIds.map((id) => {
                  const s = staffById.get(id)
                  if (!s) return null
                  const own = linesByStaff.get(id) || []
                  // Tổ phân ca: dòng đại diện = dòng có mặt có việc đầu tiên (theo thứ tự ca), không có thì dòng đầu.
                  const line = own.find((l) => l.diem_danh === "co" && l.cong_viec_ids.length > 0) || own[0]
                  const state = classifyTiles(own, holderIds.has(id))
                  const firstJob = line?.cong_viec_ids[0] ? jobById.get(line.cong_viec_ids[0]) : undefined
                  const allJobs = Array.from(new Set(own.filter((l) => l.diem_danh === "co").flatMap((l) => l.cong_viec_ids)))
                  const caLabel = phanCa
                    ? personCaCodes(own, id, caOrder).map((c) => caPhanCongLabel(c, unitByCode, T("caNgay"))).join(" + ")
                    : khungTileLabel(line)
                  const posKeys = positionsOfStaff(positions, id)
                  const roleLabel = posKeys.length > 0 ? T(positionLabelKey(posKeys[0], currentUnit?.loai)) + (posKeys.length > 1 ? ` +${posKeys.length - 1}` : "") : ""
                  const rep = line?.thay_the_staff_id ? staffById.get(line.thay_the_staff_id)?.ten || "?" : line?.thay_the_ten || ""
                  return (
                    <WorkerTile
                      key={id}
                      ten={s.ten}
                      gioiTinh={s.gioi_tinh}
                      state={state}
                      jobLabel={firstJob ? bilingual(lang, firstJob.ten, firstJob.ten_khmer) : ""}
                      extraJobs={Math.max(0, (phanCa ? allJobs.length : line?.cong_viec_ids.length || 0) - 1)}
                      xepB={line?.xep_loai === "B"}
                      replacementName={rep}
                      vangLabel={T("vang")}
                      chuaGiaoLabel={T("chuaGiao")}
                      roleLabel={roleLabel}
                      caLabel={caLabel}
                      missingCa={
                        phanCa
                          ? own.some((l) => !l.ca_phan_cong && (!l.gui_luc || section.trang_thai === "tra_ve") && (l.diem_danh === "vang" || l.cong_viec_ids.length > 0))
                          : !!khungMode && !!line && line.cong_viec_ids.length > 0 && (!line.gio_bd || !line.gio_kt)
                      }
                      locked={isToSection && own.some((l) => !canEditHere(l))}
                      stationKey={showDiagram ? line?.cong_viec_ids.map((j) => stationOfJobId.get(j)).find((k): k is StationKey => !!k) || null : null}
                      onDragStart={showDiagram && editable ? (e) => setDiagramDrag(e, { type: "staff", staffId: id }) : undefined}
                      onClick={() => {
                        setSheetTabKey(currentTab?.key || "ca")
                        setSheetFor(id)
                      }}
                    />
                  )
                })}
              </div>
            )}

            {dayChuyen !== DIAGRAM_DAY_CHUYEN ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-3 text-center text-xs font-medium text-slate-400">
                {T("sdChuaCoSoDo", { dc: dcLabel(dayChuyen) })}
              </div>
            ) : (
              <LineDiagram
                lang={lang}
                T={T}
                model={diagram}
                chipOptions={caUnits.map((u) => ({ code: u.code, label: bilingual(lang, u.ten, u.ten_khmer), star: assignedCas.includes(u.code) }))}
                chipCa={chipCa}
                onChipCa={(code) => {
                  setSelPerson(null)
                  setChipChoice({ forCa: ca, code })
                }}
                tnTitle={unitByCode.get("TN_MT") ? bilingual(lang, unitByCode.get("TN_MT")!.ten, unitByCode.get("TN_MT")!.ten_khmer) : T("toTiepNhan")}
                caTitle={unitLabel(chipCa)}
                selected={selPerson}
                onSelect={setSelPerson}
                canEdit={canEditCell}
                onCellTap={onDiagramCellTap}
                onDrop={onDiagramDrop}
                onRemove={(p) => void removeFromCell(p)}
                vehicleCode={(vid) => vehicles.find((v) => v.id === vid)?.code || ""}
                busyText={diagBusy}
              />
            )}
          </>
        ) : catalogReady && !fatal ? (
          <div className="space-y-2 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
            <div>{T("chuaMoPhieu")}</div>
            <button type="button" onClick={() => void openCurrent()} className="mx-auto flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">
              <RefreshCw size={13} /> {T("moLaiPhieu")}
            </button>
          </div>
        ) : null}
      </main>

      {showBottomBar ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1.5">
          {saveBadge ? <div className="mx-auto mb-1.5 flex max-w-5xl text-[11px]">{saveBadge}</div> : null}
          <div className="mx-auto flex max-w-5xl gap-2">
            {canEditAny ? (
              <button
                type="button"
                onClick={() => void prepareSendAll()}
                disabled={sendAllBusy || submitting}
                className="flex min-w-0 flex-1 basis-0 items-center justify-center gap-1.5 rounded-xl border border-emerald-600 bg-white px-2 py-3 text-sm font-bold text-emerald-700 disabled:opacity-60"
              >
                {sendAllBusy && !sendAllItems ? <Loader2 size={16} className="animate-spin" /> : <SendHorizontal size={16} />} {T("guiTatCa")}
              </button>
            ) : null}
            {editable ? (
              <button
                type="button"
                onClick={openReview}
                disabled={submitting}
                className="flex min-w-0 flex-1 basis-0 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-2 py-3 text-sm font-bold text-white disabled:opacity-60"
              >
                <Send size={16} className="shrink-0" />
                <span className="line-clamp-2 text-center leading-tight">
                  {T("guiChamCong")} · {sendLabel}
                </span>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {sheetPerson ? (
        <JobSheet
          key={sheetPerson.id}
          lang={lang}
          T={T}
          person={sheetPerson}
          line={lineByStaff.get(sheetPerson.id)}
          jobs={jobsForSheet(lineByStaff.get(sheetPerson.id))}
          vehicles={vehicles}
          vehicleByStaff={vehicleByStaff}
          candidates={replacementCandidates}
          staffById={staffById}
          readOnly={!editable}
          jobPeople={jobPeopleExcept(sheetPerson.id)}
          workHours={defaultWorkHours(khungMode)}
          candidateNote={candidateNote}
          caOptions={phanCa ? phanCaOptions : undefined}
          personLines={linesByStaff.get(sheetPerson.id) || []}
          hiddenPersonLines={hiddenLines.filter((l) => l.staff_id === sheetPerson.id)}
          defaultCa={defaultPhanCa}
          canEditLine={canEditHere}
          canCreateCa={canCreateCa}
          ownerName={ownerName}
          jobName={(id) => {
            const j = jobById.get(id)
            return j ? bilingual(lang, j.ten, j.ten_khmer) : "?"
          }}
          isTo={isToSection}
          onApply={(next) => applyPersonLines(sheetPerson.id, next)}
          onClose={() => setSheetFor(null)}
        />
      ) : null}

      {signOutOverlay}

      {pickerCell?.job ? (
        <StationPicker
          key={`${pickerCell.unitCode}:${pickerCell.job.id}`}
          T={T}
          title={T("sdXepNguoi", { viec: `${bilingual(lang, pickerCell.job.ten, pickerCell.job.ten_khmer)} · ${unitLabel(pickerCell.unitCode || "")}` })}
          groups={pickerGroups}
          initial={pickerCell.people.map((p) => p.workerId).filter((x): x is string => !!x)}
          fixedNames={pickerCell.people.filter((p) => !p.workerId).map((p) => p.name)}
          busy={!!diagBusy}
          onApply={(sel) => void applyPicker(sel)}
          onClose={() => setPickerCell(null)}
        />
      ) : null}

      {sendAllItems ? (
        <SendAllDialog
          T={T}
          items={sendAllItems}
          meta={`${dcLabel(dayChuyen)} · ${fmtDdMm(ngay)}${maPhieu ? ` · ${maPhieu}` : ""}`}
          busy={sendAllBusy}
          missingUnits={sendAllMissing}
          onCancel={() => setSendAllItems(null)}
          onConfirm={() => void confirmSendAll()}
        />
      ) : null}

      {recallOpen && section ? (
        <ReasonConfirmDialog
          title={T("thuHoiPhieu")}
          subtitle={`${currentUnit ? bilingual(lang, currentUnit.ten, currentUnit.ten_khmer) : ca} · ${dcLabel(dayChuyen)} · ${fmtDdMm(ngay)}`}
          points={[T("thuHoiY1"), T("thuHoiY2")]}
          requireReason
          reasonPlaceholder={T("thuHoiLyDo")}
          confirmLabel={T("thuHoiPhieu")}
          busy={recalling}
          onConfirm={(r) => void confirmRecall(r)}
          onCancel={() => setRecallOpen(false)}
        />
      ) : null}

      {discardOpen && section ? (
        <ReasonConfirmDialog
          title={T("boPhieuCa")}
          subtitle={`${currentUnit ? bilingual(lang, currentUnit.ten, currentUnit.ten_khmer) : ca} · ${dcLabel(dayChuyen)} · ${fmtDdMm(ngay)}`}
          points={[T("boPhieuY1"), section.trang_thai === "da_duyet" ? T("boPhieuY2Duyet") : T("boPhieuY2")]}
          requireReason={section.trang_thai === "da_duyet"}
          reasonPlaceholder={T("boPhieuLyDo")}
          confirmLabel={T("boPhieuCa")}
          busy={discarding}
          onConfirm={(r) => void confirmDiscard(r)}
          onCancel={() => setDiscardOpen(false)}
        />
      ) : null}

      {reviewOpen ? (
        <SubmitReview
          lang={lang}
          T={T}
          absentLines={absentLines}
          allLines={myLines}
          jobById={jobById}
          meta={{ dayChuyen: dcLabel(dayChuyen), ca, ngay, maPhieu }}
          unassigned={unassignedCa}
          skipUnassignedDefault={currentUnit?.loai !== "ca"}
          missingKhungNames={linesMissingHours(myLines, khungMode).map(workerNameOf)}
          blockText={(() => {
            if (!phanCa) return undefined
            // Dòng cũ đã gửi trước A4 (khoá) không gán ca được ⇒ không chặn; phiếu "Trả về" thì phải chọn ca.
            const miss = myLines.filter(
              (l) => !l.ca_phan_cong && (!l.gui_luc || section?.trang_thai === "tra_ve") && (l.diem_danh === "vang" || l.cong_viec_ids.length > 0),
            )
            return miss.length > 0 ? T("chuaChonCaCho", { ten: miss.map(workerNameOf).join(", ") }) : undefined
          })()}
          khungLabelOf={phanCa ? (l) => caPhanCongLabel(l.ca_phan_cong, unitByCode, T("caNgay")) : khungMode ? khungTileLabel : undefined}
          staffById={staffById}
          reasons={reasons}
          busy={submitting}
          onAddReason={quickAddReason}
          onBack={() => setReviewOpen(false)}
          onConfirm={(u) => void confirmSubmit(u)}
        />
      ) : null}
    </div>
  )
}
