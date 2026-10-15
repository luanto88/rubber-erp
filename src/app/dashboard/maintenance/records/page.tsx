"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Calendar, ChevronDown, ClipboardList, Filter, Plus, Search, X } from "lucide-react"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { getFirstDayOfMonthISO, getTodayISODate } from "@/lib/date-utils"
import { MaintenanceShell } from "../_components/maintenance-shell"
import { BO_PHAN_LIST, HANG_MUC_LIST } from "../_components/maintenance-data"
import { FilterBar } from "@/app/dashboard/_components/filter-bar"
import { FilterMultiSelect } from "@/app/dashboard/_components/filter-multi-select"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { type MaintenanceSigningStatus } from "./_components/maintenance-sign-types"
import { MaintenanceLinesDetail, MaintenanceRowActions, MaintenanceSignCell } from "../_components/maintenance-row-cells"
import { HangMucLabel } from "../_components/hang-muc-label"
import { BannerAction } from "../_components/banner-action"
import { PageHeaderBanner } from "@/app/dashboard/_components/page-header-banner"
import { PageBackgroundMotif } from "@/app/dashboard/_components/page-background-motif"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { DocCodePill } from "@/app/dashboard/_components/doc-ui/doc-code-pill"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { ExpandableRow, ExpandHeaderCell, ExpandAllToggle } from "@/app/dashboard/_components/doc-ui/expandable-row"
import type { MaintenanceSignBundle } from "@/lib/maintenance-pdf"
import { fetchSigningStatusList } from "@/app/dashboard/_components/signing-status-fetch"
import { KtShortageBanner } from "@/app/dashboard/_components/kt-shortage-banner"

type RecordRow = {
  id: string
  ma_bb: string | null
  hang_muc: string
  bo_phan: string
  ngay: string
  tu_gio: string | null
  den_gio: string | null
  trang_thai: string
  nguoi_tao: string | null
  created_by: string | null
  created_at: string
  maintenance_record_lines: {
    ma_tb: string | null
    ten_tb: string | null
    noi_dung: string | null
    cac_khac_phuc: string | null
    chi_phi_dk: number | null
    loai_tien: string | null
    ten_tai_xe: string | null
    loai_sua_chua: string | null
    sort_order: number | null
  }[]
}

// Suy ra bundle ký số (nếu có) từ hạng mục/bộ phận/loại sửa chữa — mirror đúng logic
// suCoNhoEligible/suaChuaNhoXeEligible/baoDuongEligible/baoDuongXeEligible ở trang chi tiết
// ([id]/page.tsx dòng ~513-518). Trả null nếu biên bản không thuộc bundle ký số nào (vd hạng
// mục khác Sửa chữa/Bảo dưỡng, hoặc dữ liệu chưa đủ).
function resolveSignBundle(r: RecordRow): MaintenanceSignBundle | null {
  if (r.hang_muc === "Sửa chữa") {
    const loaiSuaChua = r.maintenance_record_lines[0]?.loai_sua_chua || "lon"
    const isXeNho = r.bo_phan === "Đội xe" && loaiSuaChua === "nho"
    return isXeNho ? "sua_chua_nho_xe" : "su_co_nho"
  }
  if (r.hang_muc === "Bảo dưỡng") {
    return r.bo_phan === "Đội xe" ? "bao_duong_xe" : "bao_duong"
  }
  return null
}

type AssetOption = { id: string; ma_tb: string; ten_tb: string; bo_phan: string; loai: string }
type DispatchVehicleOption = { id: string; code: string; name: string; vehicle_type: string | null; plate_number: string | null }
type PickerItem = { id: string; kind: "asset" | "vehicle"; primary: string; secondary: string; sub: string }

export default function MaintenanceRecordsPage() {
  const router = useRouter()
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [records, setRecords] = useState<RecordRow[]>([])
  const [signingStatusByRecord, setSigningStatusByRecord] = useState<Map<string, MaintenanceSigningStatus>>(new Map())
  const [signingStatusLoaded, setSigningStatusLoaded] = useState(false)
  // Lỗi tải trạng thái ký: GIỮ map cũ + nút thử lại, không coi như "chưa gửi ký" (bug 2026-09-26).
  const [signingStatusError, setSigningStatusError] = useState(false)
  const signingReqSeq = useRef(0)
  const recordsRef = useRef<RecordRow[]>([])
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  // Biên bản đang xổ danh sách thiết bị (rule 29 — dòng có chi tiết con).
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const toggleExpanded = (id: string) =>
    setExpandedIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const [filterHangMuc, setFilterHangMuc] = useState<string[]>([])
  const [filterBoPhan, setFilterBoPhan] = useState<string[]>([])
  const [filterTrangThai, setFilterTrangThai] = useState("")
  const [filterSearch, setFilterSearch] = useState("")
  const [filterFrom, setFilterFrom] = useState(() => getFirstDayOfMonthISO())
  const [filterTo, setFilterTo] = useState(() => getTodayISODate())

  // Thiết bị / Xe — picker gộp maintenance_assets + dispatch_vehicles, lọc theo Bộ phận đã chọn.
  const [assets, setAssets] = useState<AssetOption[]>([])
  const [vehicles, setVehicles] = useState<DispatchVehicleOption[]>([])
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<string[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSearch, setPickerSearch] = useState("")
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  const loadAssets = useCallback(async (fid: string) => {
    const [{ data: assetsData }, { data: vehiclesData }] = await Promise.all([
      supabase
        .from("maintenance_assets")
        .select("id, ma_tb, ten_tb, bo_phan, loai")
        .eq("factory_id", fid)
        .eq("trang_thai", "active")
        .order("bo_phan")
        .order("ten_tb"),
      supabase
        .from("dispatch_vehicles")
        .select("id, code, name, vehicle_type, plate_number")
        .eq("factory_id", fid)
        .eq("is_active", true)
        .order("code"),
    ])
    setAssets((assetsData || []) as AssetOption[])
    setVehicles((vehiclesData || []) as DispatchVehicleOption[])
  }, [])

  const includeAssets = filterBoPhan.length === 0 || filterBoPhan.some((bp) => bp !== "Đội xe")
  const includeVehicles = filterBoPhan.length === 0 || filterBoPhan.includes("Đội xe")

  const pickerItems: PickerItem[] = [
    ...(includeAssets
      ? assets
          .filter((a) => filterBoPhan.length === 0 || filterBoPhan.includes(a.bo_phan))
          .filter((a) => {
            const q = pickerSearch.toLowerCase()
            return !q || a.ten_tb.toLowerCase().includes(q) || a.ma_tb.toLowerCase().includes(q)
          })
          .map((a) => ({ id: a.id, kind: "asset" as const, primary: a.ma_tb, secondary: a.ten_tb, sub: a.bo_phan }))
      : []),
    ...(includeVehicles
      ? vehicles
          .filter((v) => {
            const q = pickerSearch.toLowerCase()
            return !q || v.code.toLowerCase().includes(q) || v.name.toLowerCase().includes(q)
          })
          .map((v) => ({ id: v.id, kind: "vehicle" as const, primary: v.code, secondary: v.name, sub: v.plate_number || v.vehicle_type || "Đội xe" }))
      : []),
  ]

  const toggleAsset = (id: string) =>
    setSelectedAssetIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  const toggleVehicle = (id: string) =>
    setSelectedVehicleIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  const toggleItem = (item: PickerItem) => (item.kind === "asset" ? toggleAsset(item.id) : toggleVehicle(item.id))
  const isItemSelected = (item: PickerItem) =>
    item.kind === "asset" ? selectedAssetIds.includes(item.id) : selectedVehicleIds.includes(item.id)

  const totalDeviceSelected = selectedAssetIds.length + selectedVehicleIds.length
  const selectedAssetsChips = assets.filter((a) => selectedAssetIds.includes(a.id))
  const selectedVehiclesChips = vehicles.filter((v) => selectedVehicleIds.includes(v.id))

  const loadRecords = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      let recordIdFilter: string[] | null = null
      if (selectedAssetIds.length > 0 || selectedVehicleIds.length > 0) {
        const ids = new Set<string>()
        if (selectedAssetIds.length > 0) {
          const { data } = await supabase
            .from("maintenance_record_lines")
            .select("record_id")
            .eq("factory_id", fid)
            .in("asset_id", selectedAssetIds)
          for (const row of (data || []) as { record_id: string }[]) ids.add(row.record_id)
        }
        if (selectedVehicleIds.length > 0) {
          const { data } = await supabase
            .from("maintenance_record_lines")
            .select("record_id")
            .eq("factory_id", fid)
            .in("dispatch_vehicle_id", selectedVehicleIds)
          for (const row of (data || []) as { record_id: string }[]) ids.add(row.record_id)
        }
        recordIdFilter = [...ids]
        if (recordIdFilter.length === 0) {
          setRecords([])
          return
        }
      }

      let q = supabase
        .from("maintenance_records")
        .select("id, ma_bb, hang_muc, bo_phan, ngay, tu_gio, den_gio, trang_thai, nguoi_tao, created_by, created_at, maintenance_record_lines(ma_tb, ten_tb, noi_dung, cac_khac_phuc, chi_phi_dk, loai_tien, ten_tai_xe, loai_sua_chua, sort_order)")
        .eq("factory_id", fid)
        .order("ngay", { ascending: false })
        .order("created_at", { ascending: false })

      if (filterHangMuc.length > 0) q = q.in("hang_muc", filterHangMuc)
      if (filterBoPhan.length > 0) q = q.in("bo_phan", filterBoPhan)
      if (filterTrangThai) q = q.eq("trang_thai", filterTrangThai)
      if (filterFrom) q = q.gte("ngay", filterFrom)
      if (filterTo) q = q.lte("ngay", filterTo)
      if (recordIdFilter) q = q.in("id", recordIdFilter)

      const { data } = await q
      setRecords((data || []) as RecordRow[])
    } finally {
      setLoading(false)
    }
  }, [filterHangMuc, filterBoPhan, filterTrangThai, filterFrom, filterTo, selectedAssetIds, selectedVehicleIds])

  // Bulk-load trạng thái ký cho toàn bộ danh sách đang hiển thị — 1 lần gọi API cho cả trang,
  // mirror đúng cách Điều xe làm ở `dispatch/page.tsx` (`loadSigningStatus`/`/api/dispatch/
  // signing-status?...&entryIds=...`). Chỉ gửi id của các biên bản CÓ bundle ký số (loại trừ
  // hạng mục khác Sửa chữa/Bảo dưỡng — không có luồng ký).
  const loadSigningStatuses = useCallback(async (fid: string, recs: RecordRow[]) => {
    const seq = ++signingReqSeq.current
    const ids = recs.filter((r) => resolveSignBundle(r)).map((r) => r.id)
    if (ids.length === 0) {
      setSigningStatusByRecord(new Map())
      setSigningStatusError(false)
      setSigningStatusLoaded(true)
      return
    }
    try {
      // POST body — danh sách dài (bộ lọc ngày rộng) không còn vỡ giới hạn URL.
      const list = await fetchSigningStatusList<MaintenanceSigningStatus>(
        "/api/maintenance/signing-status",
        { factoryId: fid, recordIds: ids },
      )
      if (seq !== signingReqSeq.current) return // response cũ về muộn — bỏ qua
      const map = new Map<string, MaintenanceSigningStatus>()
      for (const s of list) map.set(s.recordId, s)
      setSigningStatusByRecord(map)
      setSigningStatusError(false)
    } catch {
      if (seq !== signingReqSeq.current) return
      setSigningStatusError(true)
    } finally {
      if (seq === signingReqSeq.current) setSigningStatusLoaded(true)
    }
  }, [])

  // Khoá ổn định theo tập id có luồng ký: loadRecords tạo mảng mới mỗi lần nhưng id thường không
  // đổi → không gọi lại API, không chớp cột Ký duyệt (mirror dispatch/page.tsx).
  useEffect(() => { recordsRef.current = records }, [records])
  const signRecordIdsKey = useMemo(
    () => records.filter((r) => resolveSignBundle(r)).map((r) => r.id).sort().join(","),
    [records],
  )
  useEffect(() => {
    if (factoryId) void loadSigningStatuses(factoryId, recordsRef.current)
  }, [factoryId, signRecordIdsKey, loadSigningStatuses])

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const authState = await hydrateActiveSession().catch(() => ({ session: null, user: null as SessionUser | null }))
        setUser(authState.user)
        if (!hasPermission(authState.user, "maintenance.view")) {
          setLoading(false)
          window.location.replace("/dashboard")
          return
        }
        const fid = authState.user?.factory_id || (await getActiveFactoryId())
        if (!fid) { setLoading(false); return }
        setFactoryId(fid)
        await loadAssets(fid)
      } catch {
        setLoading(false)
      }
    }
    void bootstrap()
  }, [loadAssets])

  useEffect(() => {
    if (factoryId) void loadRecords(factoryId)
  }, [factoryId, loadRecords])

  const canCreate = hasPermission(user, "maintenance.create")
  const canPrint = hasPermission(user, "maintenance.print")
  const isAdmin = user?.role === "admin"
  // "Gửi ký duyệt" chỉ dành cho người tạo chính biên bản đó (created_by, hoặc admin) —
  // mirror ĐÚNG công thức isCreator ở records/[id]/page.tsx. canCreate ở trên chỉ là quyền
  // chung (dùng đúng cho nút "+ Tạo biên bản"), KHÔNG được dùng trực tiếp cho badge Ký
  // duyệt per-row. Biên bản CŨ (created_by NULL) chỉ admin xử lý được — không fallback
  // về so khớp nguoi_tao (TEXT) như trước, đồng bộ rule đã tighten 2026-08-31.
  const canOwnerAct = (r: RecordRow) =>
    isAdmin || (r.created_by != null && r.created_by === user?.id)

  const filtered = records.filter((r) => {
    if (!filterSearch) return true
    const q = filterSearch.toLowerCase()
    return (r.ma_bb || "").toLowerCase().includes(q) || r.bo_phan.toLowerCase().includes(q)
  })

  return (
    <MaintenanceShell>
      {toast && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-2xl text-sm font-bold text-white ${
            toast.ok ? "bg-emerald-600" : "bg-red-600"
          }`}
        >
          {toast.msg}
        </div>
      )}
      <div className="mb-3"><KtShortageBanner /></div>
      <PageBackgroundMotif theme="slate" />
      <PageHeaderBanner
        title="Biên bản bảo trì"
        subtitle="Sửa chữa và bảo dưỡng thiết bị, xe"
        theme="slate"
        icon={ClipboardList}
        action={
          canCreate ? (
            <BannerAction href="/dashboard/maintenance/records/new" icon={Plus} label="Tạo biên bản" variant="solid" />
          ) : undefined
        }
      />

      {/* Filters */}
      <FilterBar
        activeCount={
          filterHangMuc.length +
          filterBoPhan.length +
          totalDeviceSelected +
          [filterTrangThai, filterSearch].filter(Boolean).length
        }
      >
        <Filter size={15} className="text-slate-400 self-center" />
        <FilterMultiSelect
          options={HANG_MUC_LIST}
          selected={filterHangMuc}
          onChange={setFilterHangMuc}
          placeholder="Hạng mục"
          searchPlaceholder="Tìm hạng mục..."
        />
        <FilterMultiSelect
          options={BO_PHAN_LIST}
          selected={filterBoPhan}
          onChange={setFilterBoPhan}
          placeholder="Bộ phận"
          searchPlaceholder="Tìm bộ phận..."
        />

        {/* Thiết bị / Xe — picker gộp asset + vehicle, lọc theo Bộ phận đã chọn ở trên */}
        <div className="relative w-full min-w-0 sm:w-auto sm:min-w-56" ref={pickerRef}>
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none transition-colors hover:border-slate-400 focus:border-mod-600"
          >
            <span className={`truncate text-left ${totalDeviceSelected > 0 ? "text-slate-700 font-semibold" : "text-slate-400"}`}>
              {totalDeviceSelected > 0 ? `${totalDeviceSelected} thiết bị/xe đã chọn` : "Thiết bị / Xe"}
            </span>
            <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform ${pickerOpen ? "rotate-180" : ""}`} />
          </button>

          {pickerOpen && (
            <div className="absolute left-0 top-[calc(100%+0.5rem)] z-40 w-full min-w-64 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
              <div className="mb-2 flex items-center gap-2 rounded-xl border border-slate-200 px-2 py-1.5">
                <Search size={14} className="shrink-0 text-slate-400" />
                <input
                  autoFocus
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="Tìm mã/tên thiết bị hoặc xe..."
                  className="w-full bg-transparent text-sm outline-none"
                />
                {pickerSearch && (
                  <button type="button" onClick={() => setPickerSearch("")} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                    <X size={12} />
                  </button>
                )}
              </div>

              <div className="mb-2 flex items-center justify-between px-1 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    const toAddAssets = pickerItems.filter((i) => i.kind === "asset" && !selectedAssetIds.includes(i.id)).map((i) => i.id)
                    const toAddVehicles = pickerItems.filter((i) => i.kind === "vehicle" && !selectedVehicleIds.includes(i.id)).map((i) => i.id)
                    if (toAddAssets.length > 0) setSelectedAssetIds((prev) => [...prev, ...toAddAssets])
                    if (toAddVehicles.length > 0) setSelectedVehicleIds((prev) => [...prev, ...toAddVehicles])
                  }}
                  className="font-bold text-mod-800 hover:underline"
                >
                  Chọn tất cả ({pickerItems.length})
                </button>
                {totalDeviceSelected > 0 && (
                  <button
                    type="button"
                    onClick={() => { setSelectedAssetIds([]); setSelectedVehicleIds([]) }}
                    className="font-bold text-slate-500 hover:text-slate-700"
                  >
                    Bỏ chọn tất cả
                  </button>
                )}
              </div>

              <div className="max-h-64 space-y-1 overflow-y-auto">
                {pickerItems.length === 0 ? (
                  <div className="rounded-xl px-3 py-4 text-center text-sm text-slate-400">Không có lựa chọn</div>
                ) : (
                  pickerItems.map((item) => {
                    const checked = isItemSelected(item)
                    return (
                      <label
                        key={`${item.kind}-${item.id}`}
                        className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
                          checked ? "bg-mod-50 text-mod-800" : "hover:bg-slate-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleItem(item)}
                          className="h-4 w-4 rounded border-slate-300 text-mod-600 focus:ring-mod-600 shrink-0"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-bold font-mono text-slate-800 truncate">{item.primary}</span>
                          <span className="block text-[11px] text-slate-600 truncate">{item.secondary}</span>
                        </span>
                        <span className="text-[10px] text-slate-400 shrink-0">{item.sub}</span>
                      </label>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>

        <select
          value={filterTrangThai}
          onChange={(e) => setFilterTrangThai(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-mod-600"
        >
          <option value="">Tất cả trạng thái</option>
          <option value="cho_duyet">Chờ duyệt</option>
          <option value="da_duyet">Đã duyệt</option>
          <option value="tu_choi">Từ chối</option>
          <option value="huy">Đã hủy</option>
        </select>

        <div className="flex items-center gap-2">
          <Calendar size={14} className="text-slate-400" />
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-mod-600"
          />
          <span className="text-slate-400 text-sm">–</span>
          <input
            type="date"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-mod-600"
          />
        </div>

        <div className="flex items-center gap-2 border border-slate-300 rounded-xl px-3 py-2 flex-1 min-w-[180px]">
          <Search size={14} className="text-slate-400" />
          <input
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            placeholder="Tìm mã biên bản, bộ phận..."
            className="flex-1 text-sm outline-none bg-transparent"
          />
        </div>
      </FilterBar>

      {/* Selected devices chips */}
      {totalDeviceSelected > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {selectedAssetsChips.map((a) => (
            <div key={a.id} className="flex items-center gap-2 px-3 py-1.5 bg-mod-50 border border-mod-200 rounded-xl text-xs">
              <span className="font-bold font-code text-mod-800">{a.ma_tb}</span>
              <span className="text-slate-700">{a.ten_tb}</span>
              <button type="button" onClick={() => setSelectedAssetIds((prev) => prev.filter((id) => id !== a.id))} className="text-slate-400 hover:text-red-600 transition-colors ml-1">
                <X size={12} />
              </button>
            </div>
          ))}
          {selectedVehiclesChips.map((v) => (
            <div key={v.id} className="flex items-center gap-2 px-3 py-1.5 bg-mod-50 border border-mod-200 rounded-xl text-xs">
              <span className="font-bold font-code text-mod-800">{v.code}</span>
              <span className="text-slate-700">{v.name}</span>
              <button type="button" onClick={() => setSelectedVehicleIds((prev) => prev.filter((id) => id !== v.id))} className="text-slate-400 hover:text-red-600 transition-colors ml-1">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <ResponsiveTableWrapper>
        {loading && records.length === 0 ? (
          <ListState kind="loading" />
        ) : filtered.length === 0 ? (
          <ListState kind="empty" message="Không có biên bản phù hợp" />
        ) : (
          <>
          {(() => {
            const ids = filtered.filter((r) => (r.maintenance_record_lines || []).length > 0).map((r) => r.id)
            const allExpanded = ids.length > 0 && ids.every((id) => expandedIds.has(id))
            return (
              <div className="flex justify-end border-b border-slate-100 px-3 py-2">
                <ExpandAllToggle
                  allExpanded={allExpanded}
                  disabled={ids.length === 0}
                  onExpandAll={() => setExpandedIds(new Set(ids))}
                  onCollapseAll={() => setExpandedIds(new Set())}
                />
              </div>
            )
          })()}
          <table className="enterprise-table dense min-w-[900px]">
            <thead>
              <tr>
                <th>Mã biên bản</th>
                <th>Hạng mục</th>
                <th>Thiết bị</th>
                <th>Bộ phận</th>
                <th>Ngày</th>
                <th>Người tạo</th>
                <th>Trạng thái</th>
                <th>Ký duyệt</th>
                <ExpandHeaderCell>Thao tác</ExpandHeaderCell>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const sign = {
                  bundle: resolveSignBundle(r),
                  status: signingStatusByRecord.get(r.id),
                  loaded: signingStatusLoaded,
                  error: signingStatusError,
                }
                const codes = (r.maintenance_record_lines || []).map((l) => l.ma_tb).filter(Boolean) as string[]
                const shownCodes = codes.length === 0
                  ? "—"
                  : codes.length > 2 ? `${codes.slice(0, 2).join(", ")} +${codes.length - 2} khác` : codes.join(", ")
                const lines = r.maintenance_record_lines || []
                const detail = <MaintenanceLinesDetail lines={lines} isXe={r.bo_phan === "Đội xe"} />
                return (
                <ExpandableRow
                  key={r.id}
                  expanded={expandedIds.has(r.id)}
                  onToggle={() => toggleExpanded(r.id)}
                  canExpand={lines.length > 0}
                  colSpan={9}
                  label="Xem thiết bị trong biên bản"
                  endCell={<MaintenanceRowActions recordId={r.id} maBb={r.ma_bb} sign={sign} canPrint={canPrint} onError={(msg) => setToast({ msg, ok: false })} />}
                  detail={detail}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <Link href={`/dashboard/maintenance/records/${r.id}`} className="hover:opacity-80">
                      <DocCodePill code={r.ma_bb} />
                    </Link>
                  </td>
                  <td><HangMucLabel hangMuc={r.hang_muc} /></td>
                  <td className="text-slate-600 text-xs">{shownCodes}</td>
                  <td className="text-slate-600">{r.bo_phan}</td>
                  <td className="text-slate-500 text-xs whitespace-nowrap">{r.ngay ? new Date(r.ngay).toLocaleDateString("vi-VN") : "—"}</td>
                  <td className="text-slate-500 text-xs">{r.nguoi_tao || "—"}</td>
                  <td><StatusBadge domain="maintenance" status={r.trang_thai} /></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <MaintenanceSignCell
                      sign={sign}
                      user={user}
                      canCreate={canCreate && canOwnerAct(r)}
                      onRetry={() => { if (factoryId) void loadSigningStatuses(factoryId, records) }}
                      onOpenSignPrompt={() => router.push(`/dashboard/maintenance/records/${r.id}`)}
                      onCancelled={() => { if (factoryId) void loadSigningStatuses(factoryId, records) }}
                      showToast={(msg, ok = true) => setToast({ msg, ok })}
                    />
                  </td>
                </ExpandableRow>
                )
              })}
            </tbody>
          </table>
          </>
        )}
      </ResponsiveTableWrapper>
    </MaintenanceShell>
  )
}
