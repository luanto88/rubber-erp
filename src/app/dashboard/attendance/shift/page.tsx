"use client"

// Màn điểm danh ca của TRỰC CA — dạng LƯỚI Ô NGƯỜI (C2 làm lại GĐ2, rule 31). Dùng trên điện thoại, không sidebar.
// Mở từ QR: /dashboard/attendance/shift?qr=<token>; từ chuông: ?section=<id>.
// 1 phiếu / CA (attendance_sheet_sections loai = 'ca_san_xuat') cho mỗi (ngày, dây chuyền). Mở màn ⇒ tự mở phiếu ca.
// Chạm ô người ⇒ tấm chọn việc (nhiều việc, A/B, xe, người thay). Tự lưu nháp sau 2 giây. "Gửi chấm công" ⇒ bước xử lý phép.
// Mọi ghi qua RPC attendance_* (migration 20261206).

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, ArrowLeft, Check, ChevronDown, ClipboardCheck, CloudOff, Eraser, Loader2, LogOut, RefreshCw, Send, Sparkles, X } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, signOutEverywhere, type SessionUser } from "@/lib/auth"
import { getErrorMessage } from "@/lib/error-message"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import { ATTENDANCE_CA, ATTENDANCE_DAY_CHUYEN, type AttendanceAbsenceReason, type AttendanceJobType } from "@/lib/attendance/types"
import {
  LINE_SELECT,
  SECTION_SELECT,
  buildRosterTabs,
  classifyTile,
  countRoster,
  dbLineToDraft,
  isStaffWorking,
  jobsForTab,
  linesToPayload,
  shortJobLabel,
  suggestFromPrevious,
  type AttendanceSection,
  type DbLine,
  type RosterGroup,
  type SheetLineDraft,
  type ShiftStaff,
} from "@/lib/attendance/shift"
import { ATT_LANG_OPTIONS, at, bilingual, loadAttLang, storeAttLang, type AttLang } from "@/lib/attendance/i18n"
import { WorkerTile } from "./_components/worker-tile"
import { JobSheet, type SheetVehicle } from "./_components/job-sheet"
import { SubmitReview } from "./_components/submit-review"

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
  const [groups, setGroups] = useState<RosterGroup[]>([])
  const [jobs, setJobs] = useState<AttendanceJobType[]>([])
  const [reasons, setReasons] = useState<AttendanceAbsenceReason[]>([])
  const [vehicles, setVehicles] = useState<SheetVehicle[]>([])
  const [vehicleByStaff, setVehicleByStaff] = useState<Map<string, string>>(new Map())
  const [assignedCas, setAssignedCas] = useState<string[]>([])
  const [qrName, setQrName] = useState<string | null>(null)
  const qrDayChuyenRef = useRef<string | null>(null)
  const initialSectionRef = useRef<string | null>(null)

  // Phiếu ca đang mở
  const [dayChuyen, setDayChuyen] = useState<string>("Mủ tạp")
  const [ngay, setNgay] = useState<string>(getFactoryTodayISO())
  const [ca, setCa] = useState<string>("A")
  const [section, setSection] = useState<AttendanceSection | null>(null)
  const [maPhieu, setMaPhieu] = useState("")
  const [lines, setLines] = useState<SheetLineDraft[]>([])
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const [suggestedFrom, setSuggestedFrom] = useState<string | null>(null)
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
  const [sheetTabKey, setSheetTabKey] = useState<string>("ca")
  const [reviewOpen, setReviewOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const T = useCallback((key: string, vars?: Record<string, string | number>) => at(lang, key, vars), [lang])

  const canEditAny = !!user && (user.role === "admin" || hasPermission(user, "attendance.mark") || hasPermission(user, "attendance.mark_all"))
  const canShift = canEditAny || (!!user && hasPermission(user, "attendance.shift_check"))

  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff])
  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs])
  const lineByStaff = useMemo(() => new Map(lines.map((l) => [l.staff_id, l])), [lines])

  useEffect(() => {
    linesRef.current = lines
  }, [lines])

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
  const loadCatalog = useCallback(async (fid: string, uid: string | null) => {
    const [staffRows, jobRes, reasonRes, vehRes, mainRes, subRes, drvRes, asgRes, grpRes] = await Promise.all([
      fetchAllPaginated<ShiftStaff>((from, to) =>
        supabase
          .from("maintenance_staff")
          .select("id, ten, gioi_tinh, loai_nhan_su, ca_mac_dinh, day_chuyen_mac_dinh, thu_tu_diem_danh, ngay_vao_lam, ngay_nghi_viec, active, cho_xac_nhan, profile_id, chuc_vu, chuc_vu_chinh_quyen")
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
      supabase.from("personnel_groups").select("*").eq("factory_id", fid).eq("is_active", true).eq("hien_diem_danh", true).order("sort_order"),
    ])
    for (const r of [jobRes, reasonRes, vehRes, grpRes]) if (r.error) throw r.error
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

    const grpRows = (grpRes.data || []) as { id: string; name: string; code: string | null; diem_danh_to_nhom?: string | null }[]
    let members: { group_id: string; staff_id: string }[] = []
    if (grpRows.length > 0) {
      const { data: mem, error: memErr } = await supabase
        .from("personnel_group_members")
        .select("group_id, staff_id")
        .eq("factory_id", fid)
        .in("group_id", grpRows.map((g) => g.id))
      if (memErr) throw memErr
      members = (mem || []) as { group_id: string; staff_id: string }[]
    }
    setGroups(
      grpRows.map((g) => ({
        id: g.id,
        name: g.name,
        code: g.code || null,
        toNhom: g.diem_danh_to_nhom || null,
        memberIds: members.filter((m) => m.group_id === g.id).map((m) => m.staff_id),
      })),
    )

    const cas = Array.from(new Set(((asgRes.data || []) as { ca: string }[]).map((r) => r.ca))).sort()
    setAssignedCas(cas)
    if (!initialSectionRef.current) {
      if (cas[0]) setCa(cas[0])
      const me = staffRows.find((s) => s.profile_id && s.profile_id === uid)
      const dc = me?.day_chuyen_mac_dinh || qrDayChuyenRef.current
      if (dc && (ATTENDANCE_DAY_CHUYEN as readonly string[]).includes(dc)) setDayChuyen(dc)
    }
  }, [])

  useEffect(() => {
    if (!factoryId || catalogReady || !canShift) return
    loadCatalog(factoryId, user?.id || null)
      .then(() => setCatalogReady(true))
      .catch((err) => setFatal(getErrorMessage(err, "Không tải được danh mục.")))
  }, [factoryId, user, loadCatalog, catalogReady, canShift])

  // ── Danh sách thẻ (phụ thuộc phiếu đang mở) ──
  const tabs = useMemo(
    () => buildRosterTabs(staff, groups, ca, dayChuyen, ngay, lines.map((l) => l.staff_id)),
    [staff, groups, ca, dayChuyen, ngay, lines],
  )

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

      let next = ((ln || []) as DbLine[]).map(dbLineToDraft)
      let suggested = false
      const editableNow = (s.trang_thai === "dang_lam" || s.trang_thai === "tra_ve") && (canEditAny || s.truc_ca_user_id === user?.id)
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
              const these = all.filter((l) => secIds.has(l.section_id))
              if (these.length === 0) continue
              const roster = new Set(buildRosterTabs(staff, groups, sheetCa, sheetDc, sheetNgay, []).flatMap((t) => t.staffIds))
              const activeJobs = new Set(jobs.filter((j) => j.is_active && !j.an_diem_danh && j.day_chuyen === sheetDc).map((j) => j.id))
              const sug = suggestFromPrevious(these, roster, activeJobs)
              if (sug.length > 0) {
                next = sug
                suggested = true
                setSuggestedFrom(sht.ngay)
              }
              break
            }
          }
        }
      }
      setLines(next)
      linesRef.current = next
      if (suggested) {
        versionRef.current += 1
        setVersion(versionRef.current)
      } else {
        setSavedVersion(versionRef.current)
        setVersion(versionRef.current)
        setSaveState("idle")
      }
    },
    [canEditAny, user, staff, groups, jobs],
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
  const editable = !!section && (section.trang_thai === "dang_lam" || section.trang_thai === "tra_ve") && (canEditAny || isMine)
  const lockReason = !section
    ? null
    : section.trang_thai === "da_duyet"
      ? T("khoaDaDuyet")
      : section.trang_thai === "da_gui"
        ? T("khoaChoDuyet")
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
          p_header: { ghi_chu: section.ghi_chu || "" },
          p_lines: linesToPayload(linesRef.current),
        })
        if (rpcErr) throw rpcErr
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
      if (!ok) return
    }
    fn()
  }

  // ── Sửa dòng ──
  const applyLine = (staffId: string, next: SheetLineDraft | null) => {
    setLines((prev) => {
      const rest = prev.filter((l) => l.staff_id !== staffId)
      if (!next) return rest
      const idx = prev.findIndex((l) => l.staff_id === staffId)
      if (idx < 0) return [...rest, next]
      const out = [...prev]
      out[idx] = next
      return out
    })
    markChanged()
    setSheetFor(null)
  }

  const clearAllJobs = () => {
    if (!window.confirm(T("xacNhanXoaHet"))) return
    setLines([])
    setSuggestedFrom(null)
    markChanged()
  }

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
  // Người chưa giao lúc gửi: công nhân của ca (thẻ Ca + công nhân ca này nằm ở thẻ nhóm, vd Tổ tiếp nhận).
  const unassignedCa = useMemo(() => {
    const ids = new Set<string>()
    for (const t of tabs) {
      for (const id of t.staffIds) {
        const s = staffById.get(id)
        if (t.key === "ca" || (s && s.loai_nhan_su === "cong_nhan" && s.ca_mac_dinh === ca)) ids.add(id)
      }
    }
    return Array.from(ids)
      .filter((id) => classifyTile(lineByStaff.get(id)) === "chua_giao")
      .map((id) => staffById.get(id))
      .filter((s): s is ShiftStaff => !!s)
  }, [tabs, lineByStaff, staffById, ca])
  const absentLines = useMemo(() => lines.filter((l) => l.diem_danh === "vang"), [lines])

  const openReview = () => {
    setError(null)
    const hasAny = lines.some((l) => l.diem_danh === "vang" || l.cong_viec_ids.length > 0)
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
      const byId = new Map(updated.map((l) => [l.staff_id, l]))
      const merged = [...linesRef.current.map((l) => byId.get(l.staff_id) || l), ...updated.filter((u) => !lineByStaff.has(u.staff_id))]
      setLines(merged)
      linesRef.current = merged
      markChanged()
      const ok = await doSave()
      if (!ok) {
        setError(T("loiMang"))
        return
      }
      const { error: rpcErr } = await supabase.rpc("attendance_submit_section", { p_section_id: section.id })
      if (rpcErr) throw rpcErr
      setReviewOpen(false)
      await loadSection(section.id)
      setNotice(T("daGuiOk"))
    } catch (err) {
      setError(isNetworkError(err) ? T("loiMang") : getErrorMessage(err, "Không gửi được."))
    } finally {
      setSubmitting(false)
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
  const counts = countRoster(allRosterIds, lines)
  const currentTab = tabs.find((t) => t.key === activeTab) || tabs[0]
  const tileIds = (currentTab?.staffIds || []).filter((id) => !onlyUnassigned || classifyTile(lineByStaff.get(id)) === "chua_giao")
  const notAssigned = !canEditAny && assignedCas.length > 0 && !assignedCas.includes(ca)

  const jobsForSheet = useCallback(
    (line: SheetLineDraft | undefined) => {
      const tab = tabs.find((t) => t.key === sheetTabKey)
      return jobsForTab(jobs, dayChuyen, tab ? tab.jobToNhom : null, line?.cong_viec_ids || [])
    },
    [jobs, dayChuyen, tabs, sheetTabKey],
  )

  const sheetPerson = sheetFor ? staffById.get(sheetFor) : undefined
  const replacementCandidates = useMemo(() => {
    if (!sheetFor) return []
    const taken = new Set<string>(lines.map((l) => l.staff_id))
    for (const l of lines) if (l.thay_the_staff_id && l.staff_id !== sheetFor) taken.add(l.thay_the_staff_id)
    taken.add(sheetFor)
    const groupMembers = new Set(groups.flatMap((g) => g.memberIds))
    return staff
      .filter((s) => !taken.has(s.id) && isStaffWorking(s, ngay) && !s.cho_xac_nhan)
      .filter((s) => (s.loai_nhan_su === "cong_nhan" && s.ca_mac_dinh !== ca) || groupMembers.has(s.id))
      .sort((a, b) => a.ten.localeCompare(b.ten, "vi"))
  }, [sheetFor, lines, groups, staff, ngay, ca])

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
  const qrTitle = qrName
    ? T("qrDiemDanh", { ten: lang === "vi" ? qrName.charAt(0).toLowerCase() + qrName.slice(1) : qrName })
    : T("appTitle")

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
        ? T("chuaPhanCongCa")
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
    if (t.key === "ca") return `${T("ca")} ${ca}`
    if (t.key === "khac") return T("tabKhac")
    if (lang === "km") {
      if (t.code === "tiep_nhan") return T("tabTiepNhan")
      if (t.code === "co_dien") return T("tabCoDien")
      if (t.code === "bao_tri") return T("tabBaoTri")
    }
    return t.label
  }
  const dcLabel = (dc: string) => (dc === "Mủ tạp" ? T("dcMuTap") : dc === "Mủ nước" ? T("dcMuNuoc") : dc)

  const saveBadge =
    saveState === "saving" ? (
      <span className="flex items-center gap-1 text-white/80">
        <Loader2 size={12} className="animate-spin" /> {T("dangLuuNhap")}
      </span>
    ) : saveState === "error" ? (
      <button type="button" onClick={() => void doSave()} className="flex items-center gap-1 font-bold text-amber-200">
        <CloudOff size={12} /> {T("luuLoi")}
      </button>
    ) : savedAt && !dirty ? (
      <span className="flex items-center gap-1 text-white/80">
        <Check size={12} /> {T("daLuuLuc", { gio: fmtHm(savedAt) })}
      </span>
    ) : null

  return (
    <div className="min-h-screen bg-slate-50 pb-28">
      <header className="sticky top-0 z-30 bg-gradient-to-r from-[#1c3a32] to-[#2f5d52] text-white shadow">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-3 pt-2.5">
          <ClipboardCheck size={20} className="shrink-0" />
          <div className="min-w-0 flex-1 truncate text-sm font-bold">
            {qrTitle}
            {maPhieu ? <span className="ml-1.5 text-xs font-semibold text-white/70">{maPhieu}</span> : null}
          </div>
          <div className="flex overflow-hidden rounded-lg border border-white/30">
            {ATT_LANG_OPTIONS.map((o) => (
              <button key={o.code} type="button" onClick={() => changeLang(o.code)} className={`px-2 py-1 text-xs font-bold ${lang === o.code ? "bg-white text-[#1c3a32]" : "text-white"}`}>
                {o.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex max-w-[150px] items-center gap-1.5 rounded-lg bg-white/15 py-1 pl-2 pr-1.5 text-left sm:max-w-[220px]"
              aria-label="Menu"
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-bold leading-4">{myName}</span>
                <span className="block truncate text-[10px] leading-3 text-white/75">{myRole}</span>
              </span>
              <ChevronDown size={15} className="shrink-0" />
            </button>
            {menuOpen ? (
              <div className="absolute right-0 top-full z-40 mt-1 w-48 overflow-hidden rounded-xl bg-white text-sm text-slate-700 shadow-xl">
                <button type="button" onClick={() => void flushThen(() => window.location.assign("/dashboard/attendance"))} className="flex w-full items-center gap-2 px-3 py-2.5 hover:bg-slate-50">
                  <ArrowLeft size={15} /> {T("backToDashboard")}
                </button>
                <button type="button" onClick={() => void flushThen(() => void handleLogout())} className="flex w-full items-center gap-2 px-3 py-2.5 text-rose-600 hover:bg-rose-50">
                  <LogOut size={15} /> {T("logout")}
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-1.5 px-3 pb-2.5 pt-2 text-xs">
          <div className="flex overflow-hidden rounded-lg border border-white/30">
            {ATTENDANCE_CA.map((c) => (
              <button key={c} type="button" onClick={() => void flushThen(() => setCa(c))} className={`px-2.5 py-1 font-bold ${ca === c ? "bg-white text-[#1c3a32]" : "text-white"}`}>
                {T("ca")} {c}
              </button>
            ))}
          </div>
          <div className="flex overflow-hidden rounded-lg border border-white/30">
            {ATTENDANCE_DAY_CHUYEN.map((dc) => (
              <button key={dc} type="button" onClick={() => void flushThen(() => setDayChuyen(dc))} className={`px-2.5 py-1 font-bold ${dayChuyen === dc ? "bg-white text-[#1c3a32]" : "text-white"}`}>
                {dcLabel(dc)}
              </button>
            ))}
          </div>
          <input
            type="date"
            value={ngay}
            max={getFactoryTodayISO()}
            onChange={(e) => {
              const v = e.target.value
              if (v) void flushThen(() => setNgay(v))
            }}
            className="rounded-lg border border-white/30 bg-white/10 px-2 py-1 font-semibold text-white [color-scheme:dark]"
          />
          {section ? <span className={`rounded-full px-2 py-0.5 font-bold ${STATUS_CLS[section.trang_thai]}`}>{T(STATUS_KEY[section.trang_thai])}</span> : null}
          <span className="ml-auto">{saveBadge}</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-3 px-3 py-3">
        {fatal ? <div className="rounded-xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">{fatal}</div> : null}
        {notAssigned && canShift ? (
          <div className="flex items-start gap-1.5 rounded-xl bg-amber-50 p-2.5 text-xs font-semibold text-amber-800">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {T("notAssignedWarn", { ca })}
          </div>
        ) : null}
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
            {suggestedFrom && editable ? (
              <div className="flex items-center gap-2 rounded-xl bg-violet-50 p-3 text-sm font-semibold text-violet-800">
                <Sparkles size={16} className="shrink-0" />
                <span className="flex-1">{T("goiYTheoPhieu", { ngay: fmtDdMm(suggestedFrom) })}</span>
                <button type="button" onClick={clearAllJobs} className="flex items-center gap-1 whitespace-nowrap rounded-lg bg-white px-2 py-1 text-xs font-bold text-violet-700">
                  <Eraser size={13} /> {T("xoaHetViec")}
                </button>
              </div>
            ) : null}

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
                  const pending = t.staffIds.filter((id) => classifyTile(lineByStaff.get(id)) === "chua_giao").length
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
                  const line = lineByStaff.get(id)
                  const state = classifyTile(line)
                  const firstJob = line?.cong_viec_ids[0] ? jobById.get(line.cong_viec_ids[0]) : undefined
                  const rep = line?.thay_the_staff_id ? staffById.get(line.thay_the_staff_id)?.ten || "?" : line?.thay_the_ten || ""
                  return (
                    <WorkerTile
                      key={id}
                      ten={s.ten}
                      gioiTinh={s.gioi_tinh}
                      state={state}
                      jobLabel={firstJob ? shortJobLabel(bilingual(lang, firstJob.ten, firstJob.ten_khmer)) : ""}
                      extraJobs={Math.max(0, (line?.cong_viec_ids.length || 0) - 1)}
                      xepB={line?.xep_loai === "B"}
                      replacementName={rep}
                      vangLabel={T("vang")}
                      chuaGiaoLabel={T("chuaGiao")}
                      onClick={() => {
                        setSheetTabKey(currentTab?.key || "ca")
                        setSheetFor(id)
                      }}
                    />
                  )
                })}
              </div>
            )}
          </>
        ) : null}
      </main>

      {section && editable ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={openReview}
            disabled={submitting}
            className="mx-auto flex w-full max-w-5xl items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-base font-bold text-white disabled:opacity-60"
          >
            <Send size={18} /> {T("guiChamCong")}
          </button>
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
          onApply={(next) => applyLine(sheetPerson.id, next)}
          onClose={() => setSheetFor(null)}
        />
      ) : null}

      {signOutOverlay}

      {reviewOpen ? (
        <SubmitReview
          lang={lang}
          T={T}
          absentLines={absentLines}
          allLines={lines}
          jobById={jobById}
          meta={{ dayChuyen: dcLabel(dayChuyen), ca, ngay, maPhieu }}
          unassigned={unassignedCa}
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
