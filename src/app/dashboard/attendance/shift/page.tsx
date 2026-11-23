"use client"

// Màn điểm danh ca của TRỰC CA (GĐ C2, rule 31) — dùng trên điện thoại, không sidebar (layout bypass như
// /dashboard/product/confirm). Mở từ QR dán tại ca: /dashboard/attendance/shift?qr=<token>; từ chuông "bị trả về":
// ?section=<id>. 1 ngày = 1 phiếu / dây chuyền gồm nhiều PHẦN (tổ tiếp nhận, cơ điện, nâng hàng — 1 phần / ngày;
// ca sản xuất — 1 phần / ca). Mỗi trực ca chỉ sửa phần mình lập; gửi ⇒ văn phòng duyệt / trả về từng phần;
// đã duyệt ⇒ khoá. Mọi ghi qua RPC attendance_* (migration 20261205).

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, ArrowLeft, Check, ChevronDown, ClipboardCheck, Loader2, LogOut, Plus, Save, Send, Trash2, X } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, hasPermission, signOutEverywhere, type SessionUser } from "@/lib/auth"
import { getErrorMessage } from "@/lib/error-message"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import { ATTENDANCE_CA, ATTENDANCE_DAY_CHUYEN, ATTENDANCE_TO_NHOM, type AttendanceAbsenceReason, type AttendanceJobType, type AttendanceToNhom } from "@/lib/attendance/types"
import {
  LINE_SELECT,
  SECTION_SELECT,
  buildDefaultLines,
  countLines,
  dbLineToDraft,
  emptyLine,
  lineToPayload,
  validateLines,
  type AttendanceSection,
  type DbLine,
  type SheetLineDraft,
  type ShiftStaff,
} from "@/lib/attendance/shift"
import { ATT_LANG_OPTIONS, at, bilingual, loadAttLang, storeAttLang, type AttLang } from "@/lib/attendance/i18n"
import { loadFactoryShiftNames } from "@/app/dashboard/product/confirm/actions"

type Vehicle = { id: string; code: string | null; name: string | null; vehicle_type: string | null; is_active: boolean | null }
type SheetRow = { id: string; ma_phieu: string; trang_thai: string }

const NEW_PERSON = "__new__"
const SECTION_KEY: Record<AttendanceToNhom, string> = {
  tiep_nhan: "secTiepNhan",
  co_dien: "secCoDien",
  nang_hang: "secNangHang",
  ca_san_xuat: "secCaSx",
}
const STATUS_KEY: Record<string, string> = { dang_lam: "stDangLam", da_gui: "stDaGui", da_duyet: "stDaDuyet", tra_ve: "stTraVe" }
const STATUS_CLS: Record<string, string> = {
  dang_lam: "bg-sky-100 text-sky-700",
  da_gui: "bg-amber-100 text-amber-800",
  da_duyet: "bg-emerald-100 text-emerald-700",
  tra_ve: "bg-rose-100 text-rose-700",
}

function readCachedUser(): SessionUser | null {
  try {
    return JSON.parse(localStorage.getItem("erp_user") || "null") as SessionUser | null
  } catch {
    return null
  }
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return ""
  return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(new Date(iso))
}

function isNetworkError(err: unknown) {
  const m = getErrorMessage(err, "").toLowerCase()
  return m.includes("failed to fetch") || m.includes("network") || m.includes("load failed")
}

export default function AttendanceShiftPage() {
  const [lang, setLang] = useState<AttLang>("vi")
  const [user, setUser] = useState<SessionUser | null>(null)
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [booting, setBooting] = useState(true)
  const [fatal, setFatal] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  // Danh mục
  const [staff, setStaff] = useState<ShiftStaff[]>([])
  const [jobs, setJobs] = useState<AttendanceJobType[]>([])
  const [reasons, setReasons] = useState<AttendanceAbsenceReason[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [vehicleByStaff, setVehicleByStaff] = useState<Map<string, string>>(new Map())
  const [assignedCas, setAssignedCas] = useState<string[]>([])
  const [qrName, setQrName] = useState<string | null>(null)

  // Chọn phần
  const [dayChuyen, setDayChuyen] = useState<string>("Mủ tạp")
  const [ngay, setNgay] = useState<string>(getFactoryTodayISO())
  const [ca, setCa] = useState<string>("A")
  const [loai, setLoai] = useState<AttendanceToNhom>("ca_san_xuat")
  const [sheet, setSheet] = useState<SheetRow | null>(null)
  const [sheetSections, setSheetSections] = useState<AttendanceSection[]>([])
  const [shiftNames, setShiftNames] = useState<Record<string, string>>({})

  // Phần đang mở
  const [section, setSection] = useState<AttendanceSection | null>(null)
  const [lines, setLines] = useState<SheetLineDraft[]>([])
  const [toTruong, setToTruong] = useState("")
  const [toPho, setToPho] = useState("")
  const [ghiChu, setGhiChu] = useState("")
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<null | "open" | "save" | "submit">(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const [newName, setNewName] = useState<{ lineId: string; field: "staff" | "thay"; value: string } | null>(null)
  const [newReason, setNewReason] = useState<{ lineId: string; value: string } | null>(null)
  const initialSectionRef = useRef<string | null>(null)

  const T = useCallback((key: string, vars?: Record<string, string | number>) => at(lang, key, vars), [lang])

  const canEditAny = !!user && (user.role === "admin" || hasPermission(user, "attendance.mark") || hasPermission(user, "attendance.mark_all"))
  const canShift = canEditAny || (!!user && hasPermission(user, "attendance.shift_check"))

  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff])
  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs])
  const nameOf = useCallback((id: string) => staffById.get(id)?.ten || "?", [staffById])
  const myStaff = useMemo(() => staff.find((s) => s.profile_id && s.profile_id === user?.id) || null, [staff, user])

  // ── Bootstrap ──
  useEffect(() => {
    setLang(loadAttLang())
    const run = async () => {
      try {
        const cached = readCachedUser()
        setUser(cached)
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
            if (point.day_chuyen_mac_dinh) setDayChuyen(point.day_chuyen_mac_dinh as string)
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
    const [staffRows, jobRes, reasonRes, vehRes, mainRes, subRes, drvRes, asgRes] = await Promise.all([
      fetchAllPaginated<ShiftStaff>((from, to) =>
        supabase
          .from("maintenance_staff")
          .select("id, ten, loai_nhan_su, ca_mac_dinh, day_chuyen_mac_dinh, cong_viec_mac_dinh_id, thu_tu_diem_danh, ngay_vao_lam, ngay_nghi_viec, active, cho_xac_nhan, profile_id")
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
    ])
    for (const r of [jobRes, reasonRes, vehRes]) if (r.error) throw r.error
    setStaff(staffRows)
    setJobs((jobRes.data || []) as AttendanceJobType[])
    setReasons((reasonRes.data || []) as AttendanceAbsenceReason[])
    setVehicles((vehRes.data || []) as Vehicle[])
    const staffOfDriver = new Map(((drvRes.data || []) as { id: string; staff_id: string }[]).map((d) => [d.id, d.staff_id]))
    const vMap = new Map<string, string>()
    for (const a of (mainRes.data || []) as { vehicle_id: string; driver_id: string }[]) {
      const sid = staffOfDriver.get(a.driver_id)
      if (sid && !vMap.has(sid)) vMap.set(sid, a.vehicle_id)
    }
    for (const a of (subRes.data || []) as { vehicle_id: string; driver_id: string }[]) {
      const sid = staffOfDriver.get(a.driver_id)
      if (sid && !vMap.has(sid)) vMap.set(sid, a.vehicle_id)
    }
    setVehicleByStaff(vMap)
    const cas = Array.from(new Set(((asgRes.data || []) as { ca: string }[]).map((r) => r.ca))).sort()
    setAssignedCas(cas)
    if (cas[0]) setCa(cas[0])
  }, [])

  useEffect(() => {
    if (!factoryId) return
    loadCatalog(factoryId, user?.id || null).catch((err) => setError(getErrorMessage(err, "Không tải được danh mục.")))
  }, [factoryId, user, loadCatalog])

  // ── Phiếu ngày + các phần của (ngày, dây chuyền) ──
  const loadSheet = useCallback(async (fid: string, d: string, dc: string) => {
    const { data: s, error: sErr } = await supabase
      .from("attendance_daily_sheets")
      .select("id, ma_phieu, trang_thai")
      .eq("factory_id", fid)
      .eq("ngay", d)
      .eq("day_chuyen", dc)
      .maybeSingle()
    if (sErr) throw sErr
    setSheet((s as SheetRow) || null)
    if (!s) {
      setSheetSections([])
      return
    }
    const { data: secs, error: secErr } = await supabase.from("attendance_sheet_sections").select(SECTION_SELECT).eq("sheet_id", s.id)
    if (secErr) throw secErr
    setSheetSections((secs || []) as AttendanceSection[])
  }, [])

  useEffect(() => {
    if (!factoryId || section) return
    loadSheet(factoryId, ngay, dayChuyen).catch((err) => setError(getErrorMessage(err, "Không tải được phiếu.")))
    loadFactoryShiftNames(factoryId, ngay).then(setShiftNames).catch(() => setShiftNames({}))
  }, [factoryId, ngay, dayChuyen, section, loadSheet])

  // ── Mở 1 phần ──
  const loadSection = useCallback(
    async (sectionId: string, buildDefaultsIfEmpty: boolean) => {
      const { data: sec, error: secErr } = await supabase.from("attendance_sheet_sections").select(SECTION_SELECT).eq("id", sectionId).single()
      if (secErr) throw secErr
      const { data: sh, error: shErr } = await supabase
        .from("attendance_daily_sheets")
        .select("id, ma_phieu, trang_thai, ngay, day_chuyen")
        .eq("id", sec.sheet_id)
        .single()
      if (shErr) throw shErr
      const { data: ln, error: lnErr } = await supabase.from("attendance_sheet_lines").select(LINE_SELECT).eq("section_id", sectionId).order("stt")
      if (lnErr) throw lnErr
      const s = sec as AttendanceSection
      setSection(s)
      setSheet({ id: sh.id, ma_phieu: sh.ma_phieu, trang_thai: sh.trang_thai })
      setNgay(sh.ngay as string)
      setDayChuyen(sh.day_chuyen as string)
      setLoai(s.loai)
      if (s.ca) setCa(s.ca)
      setToTruong(s.to_truong_staff_id || "")
      setToPho(s.to_pho_staff_id || "")
      setGhiChu(s.ghi_chu || "")
      const saved = ((ln || []) as DbLine[]).map(dbLineToDraft)
      const canBuild =
        (s.trang_thai === "dang_lam" || s.trang_thai === "tra_ve") && (s.truc_ca_user_id === user?.id || canEditAny)
      if (saved.length === 0 && buildDefaultsIfEmpty && canBuild) {
        setLines(
          buildDefaultLines({
            loai: s.loai,
            ca: s.ca,
            dayChuyen: sh.day_chuyen as string,
            ngay: sh.ngay as string,
            staff,
            jobs,
            vehicleByStaff,
          }),
        )
        setDirty(true)
      } else {
        setLines(saved)
        setDirty(false)
      }
    },
    [staff, jobs, vehicleByStaff, user, canEditAny],
  )

  // Mở thẳng từ chuông (?section=) khi danh mục đã có.
  useEffect(() => {
    const id = initialSectionRef.current
    if (!id || staff.length === 0) return
    initialSectionRef.current = null
    setBusy("open")
    loadSection(id, false)
      .catch((err) => setError(getErrorMessage(err, "Không mở được phần điểm danh.")))
      .finally(() => setBusy(null))
  }, [staff, loadSection])

  const handleOpen = async () => {
    if (!factoryId) return
    setBusy("open")
    setError(null)
    setNotice(null)
    try {
      const { data, error: rpcErr } = await supabase.rpc("attendance_open_section", {
        p_factory_id: factoryId,
        p_ngay: ngay,
        p_day_chuyen: dayChuyen,
        p_loai: loai,
        p_ca: loai === "ca_san_xuat" ? ca : null,
      })
      if (rpcErr) throw rpcErr
      await loadSection(data as string, true)
    } catch (err) {
      setError(isNetworkError(err) ? T("loiMang") : getErrorMessage(err, "Không mở được phần điểm danh."))
    } finally {
      setBusy(null)
    }
  }

  const closeSection = () => {
    if (dirty && !window.confirm(`${T("chuaLuu")} — ${T("doiPhan")}?`)) return
    setSection(null)
    setLines([])
    setDirty(false)
    setNotice(null)
    setError(null)
  }

  // ── Quyền trên phần đang mở ──
  const isMine = !!section && section.truc_ca_user_id === user?.id
  const editable = !!section && (section.trang_thai === "dang_lam" || section.trang_thai === "tra_ve") && (canEditAny || isMine)
  const lockReason = !section
    ? null
    : section.trang_thai === "da_duyet"
      ? T("khoaDaDuyet")
      : section.trang_thai === "da_gui"
        ? T("khoaChoDuyet")
        : !canEditAny && !isMine
          ? T("khoaNguoiKhac", { ten: section.truc_ca_staff_id ? nameOf(section.truc_ca_staff_id) : "trực ca khác" })
          : null

  // ── Sửa dòng ──
  const patchLine = (id: string, patch: Partial<SheetLineDraft>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
    setDirty(true)
  }
  const removeLine = (id: string) => {
    setLines((prev) => {
      const target = prev.find((l) => l.id === id)
      return prev
        .filter((l) => l.id !== id)
        .map((l) => (target?.staff_id && l.thay_cho_staff_id === target.staff_id ? { ...l, thay_cho_staff_id: "" } : l))
    })
    setDirty(true)
  }
  const addLine = (patch: Partial<SheetLineDraft>) => {
    setLines((prev) => [...prev, emptyLine(patch)])
    setDirty(true)
  }

  const setStaffOfLine = (line: SheetLineDraft, staffId: string) => {
    const job = line.cong_viec_id ? jobById.get(line.cong_viec_id) : undefined
    patchLine(line.id, {
      staff_id: staffId,
      vehicle_id: job?.loai_xe ? vehicleByStaff.get(staffId) || line.vehicle_id : line.vehicle_id,
    })
  }

  const setJobOfLine = (line: SheetLineDraft, jobId: string) => {
    const job = jobId ? jobById.get(jobId) : undefined
    patchLine(line.id, {
      cong_viec_id: jobId,
      vehicle_id: job?.loai_xe ? (line.staff_id ? vehicleByStaff.get(line.staff_id) || "" : line.vehicle_id) : "",
    })
  }

  const setReplacement = (absent: SheetLineDraft, replacementId: string) => {
    setLines((prev) => {
      const next = prev
        .filter((l) => !(l.la_them_ngoai && l.thay_cho_staff_id === absent.staff_id && l.staff_id !== replacementId))
        .map((l) => (l.thay_cho_staff_id === absent.staff_id && l.staff_id !== replacementId ? { ...l, thay_cho_staff_id: "" } : l))
      if (!replacementId) return next
      const existing = next.find((l) => l.staff_id === replacementId)
      if (existing) {
        return next.map((l) =>
          l.id === existing.id ? { ...l, thay_cho_staff_id: absent.staff_id, cong_viec_id: absent.cong_viec_id || l.cong_viec_id, diem_danh: "co" } : l,
        )
      }
      const idx = next.findIndex((l) => l.id === absent.id)
      const job = absent.cong_viec_id ? jobById.get(absent.cong_viec_id) : undefined
      const added = emptyLine({
        staff_id: replacementId,
        cong_viec_id: absent.cong_viec_id,
        vehicle_id: job?.loai_xe ? vehicleByStaff.get(replacementId) || absent.vehicle_id : "",
        thay_cho_staff_id: absent.staff_id,
        la_them_ngoai: true,
      })
      return [...next.slice(0, idx + 1), added, ...next.slice(idx + 1)]
    })
    setDirty(true)
  }

  const setPresence = (line: SheetLineDraft, diem: "co" | "vang") => {
    if (diem === "co") {
      setLines((prev) =>
        prev
          .filter((l) => !(l.la_them_ngoai && l.thay_cho_staff_id && l.thay_cho_staff_id === line.staff_id))
          .map((l) => (l.id === line.id ? { ...l, diem_danh: "co" } : l)),
      )
      setDirty(true)
    } else {
      patchLine(line.id, { diem_danh: "vang", vang_loai: line.vang_loai || "co_phep" })
    }
  }

  const quickAddPerson = async () => {
    if (!newName || !factoryId) return
    const ten = newName.value.trim()
    if (ten.length < 2) return
    try {
      const { data, error: rpcErr } = await supabase.rpc("attendance_quick_add_worker", {
        p_factory_id: factoryId,
        p_ten: ten,
        p_day_chuyen: dayChuyen,
        p_ca: loai === "ca_san_xuat" ? ca : null,
      })
      if (rpcErr) throw rpcErr
      const id = data as string
      if (!staffById.has(id)) {
        setStaff((prev) => [
          ...prev,
          {
            id,
            ten,
            loai_nhan_su: "cong_nhan",
            ca_mac_dinh: loai === "ca_san_xuat" ? ca : null,
            day_chuyen_mac_dinh: dayChuyen,
            cong_viec_mac_dinh_id: null,
            thu_tu_diem_danh: null,
            ngay_vao_lam: null,
            ngay_nghi_viec: null,
            active: true,
            cho_xac_nhan: true,
            profile_id: null,
          },
        ])
      }
      const line = lines.find((l) => l.id === newName.lineId)
      if (line) {
        if (newName.field === "staff") setStaffOfLine(line, id)
        else setReplacement(line, id)
      }
      setNewName(null)
    } catch (err) {
      setError(getErrorMessage(err, "Không thêm được người mới."))
    }
  }

  const quickAddReason = async () => {
    if (!newReason || !factoryId) return
    const ten = newReason.value.trim()
    if (!ten) return
    try {
      const { data, error: insErr } = await supabase
        .from("attendance_absence_reasons")
        .insert({ factory_id: factoryId, ten, sort_order: 999 })
        .select("*")
        .single()
      if (insErr) throw insErr
      const r = data as AttendanceAbsenceReason
      setReasons((prev) => [...prev, r])
      patchLine(newReason.lineId, { ly_do_id: r.id, ly_do: r.ten })
      setNewReason(null)
    } catch (err) {
      setError(getErrorMessage(err, "Không thêm được lý do."))
    }
  }

  // ── Lưu / gửi ──
  const save = async (): Promise<boolean> => {
    if (!section) return false
    const v = validateLines(lines, nameOf)
    if (v) {
      setError(v)
      return false
    }
    setBusy("save")
    setError(null)
    try {
      const filled = lines.filter((l) => l.staff_id)
      const { error: rpcErr } = await supabase.rpc("attendance_save_section", {
        p_section_id: section.id,
        p_header: { to_truong_staff_id: toTruong || null, to_pho_staff_id: toPho || null, ghi_chu: ghiChu },
        p_lines: filled.map((l, i) => lineToPayload(l, i + 1)),
      })
      if (rpcErr) throw rpcErr
      setDirty(false)
      setNotice(T("daLuu"))
      return true
    } catch (err) {
      setError(isNetworkError(err) ? T("loiMang") : getErrorMessage(err, "Không lưu được."))
      return false
    } finally {
      setBusy(null)
    }
  }

  const submit = async () => {
    if (!section) return
    setConfirmSubmit(false)
    if (dirty || lines.some((l) => l.staff_id)) {
      const ok = await save()
      if (!ok) return
    }
    setBusy("submit")
    try {
      const { error: rpcErr } = await supabase.rpc("attendance_submit_section", { p_section_id: section.id })
      if (rpcErr) throw rpcErr
      await loadSection(section.id, false)
      setNotice(T("daGuiOk"))
    } catch (err) {
      setError(isNetworkError(err) ? T("loiMang") : getErrorMessage(err, "Không gửi được."))
    } finally {
      setBusy(null)
    }
  }

  const handleLogout = async () => {
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
  const sectionJobs = useMemo(
    () =>
      jobs
        .filter((j) => j.day_chuyen === dayChuyen && j.to_nhom === loai && (j.is_active || lines.some((l) => l.cong_viec_id === j.id)))
        .sort((a, b) => a.sort_order - b.sort_order),
    [jobs, dayChuyen, loai, lines],
  )
  const groups = useMemo(() => {
    const out: { key: string; jobId: string; label: string; lines: SheetLineDraft[] }[] = sectionJobs.map((j) => ({
      key: j.id,
      jobId: j.id,
      label: bilingual(lang, j.ten, j.ten_khmer),
      lines: [],
    }))
    const byJob = new Map(out.map((g) => [g.jobId, g]))
    const other = { key: "none", jobId: "", label: T("chuaPhanCong"), lines: [] as SheetLineDraft[] }
    for (const l of lines) {
      const g = l.cong_viec_id ? byJob.get(l.cong_viec_id) : undefined
      if (g) g.lines.push(l)
      else if (l.cong_viec_id && jobById.get(l.cong_viec_id)) {
        const j = jobById.get(l.cong_viec_id)!
        const ng = { key: j.id, jobId: j.id, label: bilingual(lang, j.ten, j.ten_khmer), lines: [l] }
        out.push(ng)
        byJob.set(j.id, ng)
      } else other.lines.push(l)
    }
    if (other.lines.length > 0 || loai === "ca_san_xuat") out.push(other)
    return out
  }, [sectionJobs, lines, lang, T, jobById, loai])
  const counts = countLines(lines)
  const usedStaff = useMemo(() => new Set(lines.map((l) => l.staff_id).filter(Boolean)), [lines])
  const staffOptions = useMemo(
    () =>
      staff
        .filter((s) => s.active !== false && (!s.ngay_nghi_viec || ngay <= s.ngay_nghi_viec) && (!s.ngay_vao_lam || ngay >= s.ngay_vao_lam))
        .sort((a, b) => {
          const ca1 = a.loai_nhan_su === "cong_nhan" ? 0 : 1
          const ca2 = b.loai_nhan_su === "cong_nhan" ? 0 : 1
          return ca1 - ca2 || a.ten.localeCompare(b.ten, "vi")
        }),
    [staff, ngay],
  )
  const caTruong = section?.ca_truong_ten || (loai === "ca_san_xuat" ? shiftNames[ca] : "") || ""
  const notAssigned = !canEditAny && loai === "ca_san_xuat" && assignedCas.length > 0 && !assignedCas.includes(ca)
  const notAssignedNone = !canEditAny && loai === "ca_san_xuat" && assignedCas.length === 0

  const staffSelect = (value: string, onChange: (v: string) => void, opts: { exclude?: Set<string>; placeholder: string; withNew: boolean; disabled?: boolean }) => (
    <select
      value={value}
      disabled={opts.disabled}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm"
    >
      <option value="">{opts.placeholder}</option>
      {staffOptions.map((s) => (
        <option key={s.id} value={s.id} disabled={s.id !== value && !!opts.exclude?.has(s.id)}>
          {s.ten}
          {s.loai_nhan_su !== "cong_nhan" ? " · NV" : ""}
          {s.cho_xac_nhan ? ` (${T("choXacNhan")})` : ""}
        </option>
      ))}
      {opts.withNew ? <option value={NEW_PERSON}>＋ {T("nguoiMoi")}</option> : null}
    </select>
  )

  // ── Render ──
  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
        <Loader2 className="mr-2 animate-spin" size={18} /> {T("loading")}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-28">
      <header className="sticky top-0 z-30 bg-gradient-to-r from-[#1c3a32] to-[#2f5d52] text-white shadow">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <ClipboardCheck size={22} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-bold">{T("appTitle")}</div>
            <div className="truncate text-xs text-white/75">{qrName ? `${T("qrPoint")}: ${qrName}` : T("appSubtitle")}</div>
          </div>
          <div className="flex overflow-hidden rounded-lg border border-white/30">
            {ATT_LANG_OPTIONS.map((o) => (
              <button
                key={o.code}
                type="button"
                onClick={() => changeLang(o.code)}
                className={`px-2.5 py-1 text-xs font-bold ${lang === o.code ? "bg-white text-[#1c3a32]" : "text-white"}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <button type="button" onClick={() => setMenuOpen((v) => !v)} className="flex items-center gap-1 rounded-lg bg-white/15 px-2 py-1.5 text-xs font-bold">
              <span className="max-w-[90px] truncate">{user?.full_name || user?.username || ""}</span>
              <ChevronDown size={14} />
            </button>
            {menuOpen ? (
              <div className="absolute right-0 top-full z-40 mt-1 w-48 overflow-hidden rounded-xl bg-white text-sm text-slate-700 shadow-xl">
                <button type="button" onClick={() => window.location.assign("/dashboard/attendance")} className="flex w-full items-center gap-2 px-3 py-2.5 hover:bg-slate-50">
                  <ArrowLeft size={15} /> {T("backToDashboard")}
                </button>
                <button type="button" onClick={handleLogout} className="flex w-full items-center gap-2 px-3 py-2.5 text-rose-600 hover:bg-rose-50">
                  <LogOut size={15} /> {T("logout")}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-3 px-3 py-3 sm:px-4">
        {fatal ? <div className="rounded-xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">{fatal}</div> : null}
        {!fatal && !canShift ? <div className="rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-800">{T("noPermission")}</div> : null}
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

        {!fatal && canShift && !section ? (
          <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 sm:col-span-1">
                <span className="mb-1 block text-xs font-bold text-slate-500">{T("dayChuyen")}</span>
                <div className="flex gap-2">
                  {ATTENDANCE_DAY_CHUYEN.map((dc) => (
                    <button
                      key={dc}
                      type="button"
                      onClick={() => setDayChuyen(dc)}
                      className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-bold ${dayChuyen === dc ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"}`}
                    >
                      {dc}
                    </button>
                  ))}
                </div>
              </label>
              <label className="col-span-2 sm:col-span-1">
                <span className="mb-1 block text-xs font-bold text-slate-500">{T("ngaySx")}</span>
                <input
                  type="date"
                  value={ngay}
                  max={getFactoryTodayISO()}
                  onChange={(e) => e.target.value && setNgay(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                />
              </label>
            </div>
            {sheet ? <div className="text-xs font-semibold text-slate-500">Phiếu {sheet.ma_phieu}</div> : null}
            <div>
              <span className="mb-1 block text-xs font-bold text-slate-500">{T("section")}</span>
              <div className="grid grid-cols-2 gap-2">
                {ATTENDANCE_TO_NHOM.map((to) => {
                  const sec = sheetSections.find((s) => s.loai === to && (to !== "ca_san_xuat" || s.ca === ca))
                  return (
                    <button
                      key={to}
                      type="button"
                      onClick={() => setLoai(to)}
                      className={`rounded-xl border px-3 py-2.5 text-left text-sm font-bold ${loai === to ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600"}`}
                    >
                      <div>{T(SECTION_KEY[to])}</div>
                      <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] ${sec ? STATUS_CLS[sec.trang_thai] : "bg-slate-100 text-slate-500"}`}>
                        {sec ? T(STATUS_KEY[sec.trang_thai]) : T("stChuaMo")}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
            {loai === "ca_san_xuat" ? (
              <div>
                <span className="mb-1 block text-xs font-bold text-slate-500">{T("ca")}</span>
                <div className="flex gap-2">
                  {ATTENDANCE_CA.map((c) => {
                    const sec = sheetSections.find((s) => s.loai === "ca_san_xuat" && s.ca === c)
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCa(c)}
                        className={`flex-1 rounded-xl border px-2 py-2 text-sm font-bold ${ca === c ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600"}`}
                      >
                        Ca {c}
                        <div className="truncate text-[11px] font-semibold text-slate-500">{shiftNames[c] || ""}</div>
                        {sec ? <div className={`mt-0.5 rounded-full px-1 text-[10px] ${STATUS_CLS[sec.trang_thai]}`}>{T(STATUS_KEY[sec.trang_thai])}</div> : null}
                      </button>
                    )
                  })}
                </div>
                {assignedCas.length > 0 ? <p className="mt-1 text-xs text-slate-500">{T("assignedCa", { ca: assignedCas.join(", ") })}</p> : null}
                {notAssigned || notAssignedNone ? (
                  <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 p-2 text-xs font-semibold text-amber-800">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {T("notAssignedWarn", { ca })}
                  </p>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              onClick={handleOpen}
              disabled={busy === "open" || staff.length === 0}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-base font-bold text-white disabled:opacity-60"
            >
              {busy === "open" ? <Loader2 className="animate-spin" size={18} /> : <ClipboardCheck size={18} />}
              {T("openSection")}
            </button>
          </section>
        ) : null}

        {section ? (
          <>
            <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-slate-500">
                    {sheet?.ma_phieu} · {dayChuyen} · {ngay.split("-").reverse().join("/")}
                  </div>
                  <div className="text-lg font-bold text-slate-800">
                    {T(SECTION_KEY[section.loai])}
                    {section.ca ? ` · Ca ${section.ca}` : ""}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_CLS[section.trang_thai]}`}>{T(STATUS_KEY[section.trang_thai])}</span>
                  <button type="button" onClick={closeSection} className="text-xs font-bold text-emerald-700 underline">
                    {T("doiPhan")}
                  </button>
                </div>
              </div>
              {section.trang_thai === "tra_ve" && section.tra_ve_ly_do ? (
                <div className="rounded-lg bg-rose-50 p-2 text-sm font-semibold text-rose-700">{T("biTraVe", { lyDo: section.tra_ve_ly_do })}</div>
              ) : null}
              {lockReason ? <div className="rounded-lg bg-slate-100 p-2 text-sm font-semibold text-slate-600">{lockReason}</div> : null}
              {section.ngoai_phan_cong ? (
                <div className="rounded-lg bg-amber-50 p-2 text-xs font-semibold text-amber-800">{T("notAssignedWarn", { ca: section.ca || "" })}</div>
              ) : null}
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                {section.loai === "ca_san_xuat" ? (
                  <div>
                    <div className="text-xs text-slate-500">{T("caTruong")}</div>
                    <div className="font-semibold">{caTruong || "—"}</div>
                  </div>
                ) : (
                  <label>
                    <div className="text-xs text-slate-500">{T("toTruong")}</div>
                    {staffSelect(toTruong, (v) => { setToTruong(v === NEW_PERSON ? "" : v); setDirty(true) }, { placeholder: "—", withNew: false, disabled: !editable })}
                  </label>
                )}
                <label>
                  <div className="text-xs text-slate-500">{T("toPho")}</div>
                  {staffSelect(toPho, (v) => { setToPho(v === NEW_PERSON ? "" : v); setDirty(true) }, { placeholder: "—", withNew: false, disabled: !editable })}
                </label>
                <div>
                  <div className="text-xs text-slate-500">{T("trucCa")}</div>
                  <div className="font-semibold">{section.truc_ca_staff_id ? nameOf(section.truc_ca_staff_id) : isMine ? user?.full_name : "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">{T("batDau")}</div>
                  <div className="font-semibold">{fmtTime(section.bat_dau_luc)}</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                <div className="rounded-xl bg-slate-100 py-2">
                  <div className="text-xl font-bold text-slate-800">{counts.total}</div>
                  <div className="text-[11px] font-semibold text-slate-500">{T("tongSo")}</div>
                </div>
                <div className="rounded-xl bg-emerald-50 py-2">
                  <div className="text-xl font-bold text-emerald-700">{counts.co}</div>
                  <div className="text-[11px] font-semibold text-emerald-700">{T("coMat")}</div>
                </div>
                <div className="rounded-xl bg-rose-50 py-2">
                  <div className="text-xl font-bold text-rose-700">{counts.vang}</div>
                  <div className="text-[11px] font-semibold text-rose-700">{T("vangMat")}</div>
                </div>
              </div>
            </section>

            <fieldset disabled={!editable} className="space-y-3">
              {(() => {
                let stt = 0
                return groups.map((g) => (
                  <section key={g.key} className="rounded-2xl bg-white p-3 shadow-sm">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="text-sm font-bold text-slate-800">{g.label}</h3>
                      <span className="text-xs font-semibold text-slate-400">{g.lines.filter((l) => l.staff_id).length}</span>
                    </div>
                    <div className="space-y-2">
                      {g.lines.map((line) => {
                        stt += 1
                        const job = line.cong_viec_id ? jobById.get(line.cong_viec_id) : undefined
                        const replacement = line.staff_id ? lines.find((l) => l.thay_cho_staff_id === line.staff_id) : undefined
                        const vehicleOptions = job?.loai_xe ? vehicles.filter((v) => v.vehicle_type === job.loai_xe || v.id === line.vehicle_id) : []
                        return (
                          <div key={line.id} className={`rounded-xl border p-2.5 ${line.diem_danh === "vang" ? "border-rose-200 bg-rose-50/40" : "border-slate-200"}`}>
                            <div className="flex items-center gap-2">
                              <span className="w-6 shrink-0 text-center text-xs font-bold text-slate-400">{stt}</span>
                              <div className="min-w-0 flex-1">
                                {staffSelect(
                                  line.staff_id,
                                  (v) => (v === NEW_PERSON ? setNewName({ lineId: line.id, field: "staff", value: "" }) : setStaffOfLine(line, v)),
                                  { exclude: usedStaff, placeholder: T("chonNguoi"), withNew: true },
                                )}
                              </div>
                              <button type="button" onClick={() => removeLine(line.id)} className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={T("xoaDong")}>
                                <Trash2 size={15} />
                              </button>
                            </div>
                            {line.thay_cho_staff_id ? (
                              <div className="ml-8 mt-1 text-xs font-semibold text-violet-700">{T("thayCho", { ten: nameOf(line.thay_cho_staff_id) })}</div>
                            ) : null}
                            {newName?.lineId === line.id && newName.field === "staff" ? (
                              <div className="ml-8 mt-2 flex gap-2">
                                <input
                                  autoFocus
                                  value={newName.value}
                                  onChange={(e) => setNewName({ ...newName, value: e.target.value })}
                                  placeholder={T("nhapTenMoi")}
                                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm"
                                />
                                <button type="button" onClick={quickAddPerson} className="rounded-lg bg-emerald-600 px-3 text-sm font-bold text-white">
                                  <Check size={15} />
                                </button>
                                <button type="button" onClick={() => setNewName(null)} className="rounded-lg border px-3 text-sm">
                                  <X size={15} />
                                </button>
                              </div>
                            ) : null}
                            <div className="ml-8 mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                              <select value={line.cong_viec_id} onChange={(e) => setJobOfLine(line, e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm">
                                <option value="">{T("chuaPhanCong")}</option>
                                {sectionJobs.map((j) => (
                                  <option key={j.id} value={j.id}>
                                    {bilingual(lang, j.ten, j.ten_khmer)}
                                  </option>
                                ))}
                              </select>
                              {job?.loai_xe ? (
                                <select value={line.vehicle_id} onChange={(e) => patchLine(line.id, { vehicle_id: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm">
                                  <option value="">
                                    {T("xe")} ({job.loai_xe})
                                  </option>
                                  {vehicleOptions.map((v) => (
                                    <option key={v.id} value={v.id}>
                                      {v.code} {v.name ? `· ${v.name}` : ""}
                                    </option>
                                  ))}
                                </select>
                              ) : null}
                            </div>
                            <div className="ml-8 mt-2 flex flex-wrap items-center gap-2">
                              {line.diem_danh === "co" ? (
                                <div className="flex overflow-hidden rounded-lg border border-slate-300">
                                  {(["A", "B"] as const).map((x) => (
                                    <button
                                      key={x}
                                      type="button"
                                      onClick={() => patchLine(line.id, { xep_loai: x })}
                                      className={`px-4 py-1.5 text-sm font-bold ${line.xep_loai === x ? (x === "A" ? "bg-emerald-600 text-white" : "bg-amber-500 text-white") : "bg-white text-slate-500"}`}
                                    >
                                      {x}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                              <div className="flex overflow-hidden rounded-lg border border-slate-300">
                                <button type="button" onClick={() => setPresence(line, "co")} className={`px-3 py-1.5 text-sm font-bold ${line.diem_danh === "co" ? "bg-emerald-600 text-white" : "bg-white text-slate-500"}`}>
                                  {T("co")}
                                </button>
                                <button type="button" onClick={() => setPresence(line, "vang")} className={`px-3 py-1.5 text-sm font-bold ${line.diem_danh === "vang" ? "bg-rose-600 text-white" : "bg-white text-slate-500"}`}>
                                  {T("vang")}
                                </button>
                              </div>
                              {line.diem_danh === "vang" ? (
                                <div className="flex overflow-hidden rounded-lg border border-slate-300">
                                  {(["co_phep", "khong_phep"] as const).map((v) => (
                                    <button
                                      key={v}
                                      type="button"
                                      onClick={() => patchLine(line.id, { vang_loai: v })}
                                      className={`px-3 py-1.5 text-sm font-bold ${line.vang_loai === v ? "bg-rose-100 text-rose-800" : "bg-white text-slate-500"}`}
                                    >
                                      {T(v === "co_phep" ? "coPhep" : "khongPhep")}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                            {line.diem_danh === "vang" ? (
                              <div className="ml-8 mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {line.vang_loai === "khong_phep" ? (
                                  <div>
                                    <div className="text-xs font-semibold text-slate-500">{T("lyDo")} *</div>
                                    {newReason?.lineId === line.id ? (
                                      <div className="flex gap-2">
                                        <input
                                          autoFocus
                                          value={newReason.value}
                                          onChange={(e) => setNewReason({ ...newReason, value: e.target.value })}
                                          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm"
                                        />
                                        <button type="button" onClick={quickAddReason} className="rounded-lg bg-emerald-600 px-3 text-white">
                                          <Check size={15} />
                                        </button>
                                        <button type="button" onClick={() => setNewReason(null)} className="rounded-lg border px-3">
                                          <X size={15} />
                                        </button>
                                      </div>
                                    ) : (
                                      <select
                                        value={line.ly_do_id}
                                        onChange={(e) => {
                                          if (e.target.value === NEW_PERSON) {
                                            setNewReason({ lineId: line.id, value: "" })
                                            return
                                          }
                                          const r = reasons.find((x) => x.id === e.target.value)
                                          patchLine(line.id, { ly_do_id: e.target.value, ly_do: r?.ten || "" })
                                        }}
                                        className={`w-full rounded-lg border bg-white px-2 py-2 text-sm ${line.ly_do_id || line.ly_do ? "border-slate-300" : "border-rose-400"}`}
                                      >
                                        <option value="">—</option>
                                        {reasons.map((r) => (
                                          <option key={r.id} value={r.id}>
                                            {bilingual(lang, r.ten, r.ten_khmer)}
                                          </option>
                                        ))}
                                        <option value={NEW_PERSON}>{T("themLyDo")}</option>
                                      </select>
                                    )}
                                  </div>
                                ) : null}
                                <div>
                                  <div className="text-xs font-semibold text-slate-500">{T("nguoiThay")}</div>
                                  {newName?.lineId === line.id && newName.field === "thay" ? (
                                    <div className="flex gap-2">
                                      <input
                                        autoFocus
                                        value={newName.value}
                                        onChange={(e) => setNewName({ ...newName, value: e.target.value })}
                                        placeholder={T("nhapTenMoi")}
                                        className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm"
                                      />
                                      <button type="button" onClick={quickAddPerson} className="rounded-lg bg-emerald-600 px-3 text-white">
                                        <Check size={15} />
                                      </button>
                                      <button type="button" onClick={() => setNewName(null)} className="rounded-lg border px-3">
                                        <X size={15} />
                                      </button>
                                    </div>
                                  ) : (
                                    staffSelect(
                                      replacement?.staff_id || "",
                                      (v) => (v === NEW_PERSON ? setNewName({ lineId: line.id, field: "thay", value: "" }) : setReplacement(line, v)),
                                      {
                                        exclude: new Set([...usedStaff].filter((id) => id !== replacement?.staff_id)),
                                        placeholder: T("khongThay"),
                                        withNew: true,
                                        disabled: !line.staff_id,
                                      },
                                    )
                                  )}
                                </div>
                              </div>
                            ) : null}
                            <input
                              value={line.ghi_chu}
                              onChange={(e) => patchLine(line.id, { ghi_chu: e.target.value })}
                              placeholder={T("ghiChu")}
                              className="ml-8 mt-2 w-[calc(100%-2rem)] rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                            />
                          </div>
                        )
                      })}
                    </div>
                    {editable ? (
                      <button type="button" onClick={() => addLine({ cong_viec_id: g.jobId })} className="mt-2 text-xs font-bold text-emerald-700">
                        {T("themDong")}
                      </button>
                    ) : null}
                  </section>
                ))
              })()}
              {editable ? (
                <button
                  type="button"
                  onClick={() => addLine({ staff_id: myStaff && !usedStaff.has(myStaff.id) ? myStaff.id : "", la_them_ngoai: true })}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-emerald-300 py-3 text-sm font-bold text-emerald-700"
                >
                  <Plus size={16} /> {T("themNguoi")}
                </button>
              ) : null}
              <textarea
                value={ghiChu}
                onChange={(e) => {
                  setGhiChu(e.target.value)
                  setDirty(true)
                }}
                rows={2}
                placeholder={T("ghiChu")}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </fieldset>

            {editable ? (
              <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-3 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
                <div className="mx-auto flex max-w-3xl items-center gap-2">
                  <span className="hidden flex-1 text-xs font-semibold text-amber-700 sm:block">{dirty ? T("chuaLuu") : ""}</span>
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={busy !== null}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white py-3 text-sm font-bold text-slate-700 disabled:opacity-60 sm:flex-none sm:px-5"
                  >
                    {busy === "save" ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    {busy === "save" ? T("dangLuu") : T("luuNhap")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmSubmit(true)}
                    disabled={busy !== null || counts.total === 0}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white disabled:opacity-60 sm:flex-none sm:px-5"
                  >
                    {busy === "submit" ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    {T("guiChamCong")}
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </main>

      {confirmSubmit ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={() => setConfirmSubmit(false)}>
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-slate-800">{T("guiChamCong")}</h3>
            <p className="mt-2 text-sm text-slate-600">{T("xacNhanGui")}</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-lg bg-slate-100 py-2 font-bold">{counts.total} {T("tongSo")}</div>
              <div className="rounded-lg bg-emerald-50 py-2 font-bold text-emerald-700">{counts.co} {T("coMat")}</div>
              <div className="rounded-lg bg-rose-50 py-2 font-bold text-rose-700">{counts.vang} {T("vangMat")}</div>
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setConfirmSubmit(false)} className="flex-1 rounded-xl border border-slate-300 py-3 text-sm font-bold">
                {T("cancel")}
              </button>
              <button type="button" onClick={() => void submit()} className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white">
                {T("guiChamCong")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
