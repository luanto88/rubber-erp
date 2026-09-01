"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Calendar, ChevronDown, Eye, FileText, Filter, Loader2, Plus, Printer, Search, Wrench, X } from "lucide-react"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { getFirstDayOfMonthISO, getTodayISODate } from "@/lib/date-utils"
import { MaintenanceShell } from "../_components/maintenance-shell"
import { BO_PHAN_LIST, HANG_MUC_LIST } from "../_components/maintenance-data"
import { FilterBar } from "@/app/dashboard/_components/filter-bar"
import { FilterMultiSelect } from "@/app/dashboard/_components/filter-multi-select"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { MaintenanceSignStatusBadge, type MaintenanceSigningStatus } from "./_components/maintenance-sign-status"
import type { MaintenanceSignBundle } from "@/lib/maintenance-pdf"

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
  created_at: string
  maintenance_record_lines: { ma_tb: string | null; loai_sua_chua: string | null }[]
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
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

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
        .select("id, ma_bb, hang_muc, bo_phan, ngay, tu_gio, den_gio, trang_thai, nguoi_tao, created_at, maintenance_record_lines(ma_tb, loai_sua_chua)")
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
    const ids = recs.filter((r) => resolveSignBundle(r)).map((r) => r.id)
    if (ids.length === 0) {
      setSigningStatusByRecord(new Map())
      setSigningStatusLoaded(true)
      return
    }
    setSigningStatusLoaded(false)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) { setSigningStatusLoaded(true); return }
      const res = await fetch(`/api/maintenance/signing-status?factoryId=${fid}&recordIds=${ids.join(",")}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const json = (await res.json()) as MaintenanceSigningStatus[] | { error?: string }
      const map = new Map<string, MaintenanceSigningStatus>()
      if (Array.isArray(json)) for (const s of json) map.set(s.recordId, s)
      setSigningStatusByRecord(map)
    } catch {
      // Badge chỉ là thông tin phụ — lỗi tải không được chặn danh sách biên bản.
    } finally {
      setSigningStatusLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (factoryId) void loadSigningStatuses(factoryId, records)
  }, [factoryId, records, loadSigningStatuses])

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

  const filtered = records.filter((r) => {
    if (!filterSearch) return true
    const q = filterSearch.toLowerCase()
    return (r.ma_bb || "").toLowerCase().includes(q) || r.bo_phan.toLowerCase().includes(q)
  })

  const hangMucBadge = (h: string) =>
    h === "Sửa chữa"
      ? <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-50 text-red-600">{h}</span>
      : <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700">{h}</span>

  // Báo cáo công tác bảo trì theo kỳ (F07) — dùng đúng bộ lọc Bộ phận/Hạng mục/Thiết bị-Xe/Từ
  // ngày-Đến ngày đang áp dụng trên danh sách. LUÔN chỉ lấy biên bản "Đã duyệt" ở trang in, bất
  // kể filter Trạng thái trên màn hình đang chọn gì — không truyền trang_thai qua URL.
  const boPhanParam = filterBoPhan.length > 0 ? `&bo_phan=${encodeURIComponent(filterBoPhan.join(","))}` : ""
  const hangMucParam = filterHangMuc.length > 0 ? `&hang_muc=${encodeURIComponent(filterHangMuc.join(","))}` : ""
  const assetIdsParam = selectedAssetIds.length > 0 ? `&asset_ids=${selectedAssetIds.join(",")}` : ""
  const vehicleIdsParam = selectedVehicleIds.length > 0 ? `&vehicle_ids=${selectedVehicleIds.join(",")}` : ""
  const bcKyUrl = filterFrom && filterTo
    ? `/dashboard/maintenance/print?type=bao_cao_ky&from=${filterFrom}&to=${filterTo}${boPhanParam}${hangMucParam}${assetIdsParam}${vehicleIdsParam}`
    : null

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-2">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Biên bản bảo trì</h1>
          <p className="text-sm text-slate-500 mt-0.5">Sửa chữa và bảo dưỡng thiết bị, xe</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canPrint && (
            <Link
              href={bcKyUrl ?? "#"}
              target={bcKyUrl ? "_blank" : undefined}
              onClick={!bcKyUrl ? (e) => e.preventDefault() : undefined}
              className={`flex items-center gap-2 px-4 py-2.5 font-bold rounded-xl shadow-md transition-all ${
                bcKyUrl ? "bg-slate-700 hover:bg-slate-800 text-white" : "bg-slate-200 text-slate-400 cursor-not-allowed"
              }`}
            >
              <Printer size={15} /> In Báo cáo theo kỳ (F07)
            </Link>
          )}
          {canCreate && (
            <Link
              href="/dashboard/maintenance/records/new"
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all"
            >
              <Plus size={16} /> Tạo biên bản
            </Link>
          )}
        </div>
      </div>
      {canPrint && (
        <p className="text-xs text-slate-400 mb-2">
          Báo cáo theo kỳ chỉ in các biên bản đã duyệt trong kỳ và bộ lọc đã chọn (không phụ thuộc bộ lọc Trạng thái bên dưới).
        </p>
      )}

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
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none transition-colors hover:border-slate-400 focus:border-emerald-500"
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
                  className="font-bold text-emerald-700 hover:text-emerald-800"
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
                          checked ? "bg-emerald-50 text-emerald-700" : "hover:bg-slate-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleItem(item)}
                          className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 shrink-0"
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
          className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
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
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
          />
          <span className="text-slate-400 text-sm">–</span>
          <input
            type="date"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
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
            <div key={a.id} className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs">
              <span className="font-bold font-mono text-emerald-800">{a.ma_tb}</span>
              <span className="text-emerald-700">{a.ten_tb}</span>
              <button type="button" onClick={() => setSelectedAssetIds((prev) => prev.filter((id) => id !== a.id))} className="text-emerald-400 hover:text-red-500 transition-colors ml-1">
                <X size={12} />
              </button>
            </div>
          ))}
          {selectedVehiclesChips.map((v) => (
            <div key={v.id} className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs">
              <span className="font-bold font-mono text-emerald-800">{v.code}</span>
              <span className="text-emerald-700">{v.name}</span>
              <button type="button" onClick={() => setSelectedVehicleIds((prev) => prev.filter((id) => id !== v.id))} className="text-emerald-400 hover:text-red-500 transition-colors ml-1">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <ResponsiveTableWrapper>
        {loading ? (
          <div className="p-12 text-center text-slate-400">Đang tải...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Wrench size={40} className="mx-auto mb-3 opacity-30" />
            <p>Không có biên bản nào</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {["Mã biên bản", "Hạng mục", "Mã thiết bị", "Bộ phận", "Ngày", "Người tạo", "Ký duyệt", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r) => (
                <tr key={r.id} className="row-hover">
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/maintenance/records/${r.id}`} className="font-mono text-xs font-bold text-emerald-700 hover:underline">
                      {r.ma_bb || "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{hangMucBadge(r.hang_muc)}</td>
                  <td className="px-4 py-3 text-slate-600 text-xs">
                    {(() => {
                      const codes = (r.maintenance_record_lines || []).map((l) => l.ma_tb).filter(Boolean) as string[]
                      if (codes.length === 0) return "—"
                      const shown = codes.slice(0, 2).join(", ")
                      return codes.length > 2 ? `${shown} +${codes.length - 2} khác` : shown
                    })()}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{r.bo_phan}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{r.ngay ? new Date(r.ngay).toLocaleDateString("vi-VN") : "—"}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{r.nguoi_tao || "—"}</td>
                  <td className="px-4 py-3">
                    {(() => {
                      const bundle = resolveSignBundle(r)
                      if (!bundle) return <span className="text-xs text-slate-300">—</span>
                      if (!signingStatusLoaded) return <Loader2 size={14} className="animate-spin text-slate-300" />
                      const status = signingStatusByRecord.get(r.id)
                      return (
                        <div className="flex items-center gap-1.5">
                          {status?.fileHienTai ? (
                            <a
                              href={status.fileHienTai}
                              target="_blank"
                              rel="noreferrer"
                              title={status.trangThai === "hoan_tat" ? "Xem file đã ký duyệt" : "Xem file đã ký (đang chờ ký tiếp)"}
                              className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
                            >
                              <Eye size={15} />
                            </a>
                          ) : canPrint ? (
                            <Link
                              href={`/dashboard/maintenance/print?type=${bundle}&record_id=${r.id}`}
                              target="_blank"
                              title="In biên bản (chưa ký)"
                              className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
                            >
                              <FileText size={15} />
                            </Link>
                          ) : null}
                          {user && (
                            <MaintenanceSignStatusBadge
                              status={status}
                              currentUser={user}
                              canCreate={canCreate}
                              onOpenSignPrompt={() => router.push(`/dashboard/maintenance/records/${r.id}`)}
                              onCancelled={() => { if (factoryId) void loadSigningStatuses(factoryId, records) }}
                              showToast={(msg, ok = true) => setToast({ msg, ok })}
                            />
                          )}
                        </div>
                      )
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/maintenance/records/${r.id}`} className="text-xs font-bold text-blue-600 hover:underline">Chi tiết</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ResponsiveTableWrapper>
    </MaintenanceShell>
  )
}
