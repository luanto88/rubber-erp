"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Calendar, ChevronDown, ChevronRight, Filter, History, Printer, Search, X } from "lucide-react"
import { getActiveFactoryId } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { MaintenanceShell } from "../_components/maintenance-shell"
import { BO_PHAN_LIST, currencySymbol, type MaintenanceAsset } from "../_components/maintenance-data"

type HistoryRow = {
  record_id: string
  line_id: string
  ngay: string
  ma_bb: string | null
  hang_muc: string
  bo_phan: string
  noi_dung: string | null
  cac_khac_phuc: string | null
  chi_phi_dk: number
  loai_tien: string
  cong_tho: number
  nguoi_thuc_hien: string[]
  nv_phu_trach: string | null
  phu_trach_bao_tri: string | null
  asset_id: string | null
  ten_tb: string
  ma_tb: string
}

type AssetOption = Pick<MaintenanceAsset, "id" | "ma_tb" | "ten_tb" | "bo_phan" | "loai">

type DispatchVehicleOption = { id: string; code: string; name: string; vehicle_type: string | null; plate_number: string | null }

export default function MaintenanceHistoryPage() {
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [assets, setAssets] = useState<AssetOption[]>([])
  const [vehicles, setVehicles] = useState<DispatchVehicleOption[]>([])
  const [selectedVehicleId, setSelectedVehicleId] = useState("")
  const [rows, setRows] = useState<HistoryRow[]>([])

  // Multi-select asset picker state (like record form)
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])
  const [filterBoPhan, setFilterBoPhan] = useState("")
  const [assetSearch, setAssetSearch] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  const [filterFrom, setFilterFrom] = useState("")
  const [filterTo, setFilterTo] = useState("")
  const [filterSearch, setFilterSearch] = useState("")
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  // Close picker on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  // Assets filtered by bộ phận + search (for picker dropdown)
  const filteredAssets = assets.filter((a) => {
    const matchBp = filterBoPhan ? a.bo_phan === filterBoPhan : true
    const q = assetSearch.toLowerCase()
    const matchSearch = q
      ? a.ten_tb.toLowerCase().includes(q) || a.ma_tb.toLowerCase().includes(q)
      : true
    return matchBp && matchSearch
  })

  const toggleAsset = (asset: AssetOption) => {
    setSelectedAssetIds((prev) =>
      prev.includes(asset.id) ? prev.filter((id) => id !== asset.id) : [...prev, asset.id]
    )
  }

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

  const loadHistory = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      let recQ = supabase
        .from("maintenance_records")
        .select("id, ma_bb, hang_muc, ngay, bo_phan, nguoi_thuc_hien, nv_phu_trach, phu_trach_bao_tri")
        .eq("factory_id", fid)
        .eq("trang_thai", "da_duyet")
        .order("ngay", { ascending: false })
      if (filterFrom) recQ = recQ.gte("ngay", filterFrom)
      if (filterTo) recQ = recQ.lte("ngay", filterTo)
      const { data: records } = await recQ

      const recList = (records || []) as {
        id: string; ma_bb: string | null; hang_muc: string; ngay: string; bo_phan: string
        nguoi_thuc_hien: string[]; nv_phu_trach: string | null; phu_trach_bao_tri: string | null
      }[]

      if (recList.length === 0) { setRows([]); return }

      const recIds = recList.map((r) => r.id)
      let lineQ = supabase
        .from("maintenance_record_lines")
        .select("id, record_id, asset_id, ten_tb, ma_tb, noi_dung, cac_khac_phuc, chi_phi_dk, loai_tien, cong_tho")
        .in("record_id", recIds)
        .eq("factory_id", fid)
      if (selectedAssetIds.length > 0) lineQ = lineQ.in("asset_id", selectedAssetIds)
      const { data: lines } = await lineQ

      const recMap = new Map(recList.map((r) => [r.id, r]))
      const mapped: HistoryRow[] = ((lines || []) as {
        id: string; record_id: string; asset_id: string | null
        ten_tb: string; ma_tb: string; noi_dung: string | null; cac_khac_phuc: string | null
        chi_phi_dk: number; loai_tien: string; cong_tho: number
      }[]).map((l) => {
        const rec = recMap.get(l.record_id)!
        return {
          record_id: l.record_id, line_id: l.id, ngay: rec.ngay, ma_bb: rec.ma_bb,
          hang_muc: rec.hang_muc, bo_phan: rec.bo_phan, noi_dung: l.noi_dung, cac_khac_phuc: l.cac_khac_phuc,
          chi_phi_dk: l.chi_phi_dk || 0, loai_tien: l.loai_tien || "USD", cong_tho: l.cong_tho || 0,
          nguoi_thuc_hien: rec.nguoi_thuc_hien || [], nv_phu_trach: rec.nv_phu_trach,
          phu_trach_bao_tri: rec.phu_trach_bao_tri, asset_id: l.asset_id, ten_tb: l.ten_tb, ma_tb: l.ma_tb,
        }
      })
      mapped.sort((a, b) => b.ngay.localeCompare(a.ngay))
      setRows(mapped)
    } finally {
      setLoading(false)
    }
  }, [selectedAssetIds, filterFrom, filterTo])

  useEffect(() => {
    const bootstrap = async () => {
      const fid = await getActiveFactoryId()
      if (!fid) { setLoading(false); return }
      setFactoryId(fid)
      await loadAssets(fid)
    }
    void bootstrap()
  }, [loadAssets])

  useEffect(() => {
    if (factoryId) void loadHistory(factoryId)
  }, [factoryId, loadHistory])

  const filtered = rows.filter((r) => {
    if (!filterSearch) return true
    const q = filterSearch.toLowerCase()
    return (
      r.ten_tb.toLowerCase().includes(q) ||
      r.ma_tb.toLowerCase().includes(q) ||
      (r.noi_dung || "").toLowerCase().includes(q) ||
      (r.ma_bb || "").toLowerCase().includes(q)
    )
  })

  const toggleExpand = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const formatValue = (row: HistoryRow) => {
    const sym = currencySymbol(row.loai_tien)
    if (row.chi_phi_dk > 0 && row.cong_tho > 0) return `${sym}${row.chi_phi_dk.toLocaleString()} + ${sym}${row.cong_tho.toLocaleString()} CT`
    if (row.chi_phi_dk > 0) return `${sym}${row.chi_phi_dk.toLocaleString()}`
    if (row.cong_tho > 0) return `${sym}${row.cong_tho.toLocaleString()} CT`
    return "—"
  }

  const nguoiTheoDoiOf = (row: HistoryRow) =>
    [row.nv_phu_trach, row.phu_trach_bao_tri].filter(Boolean).join(", ") || "—"

  // Print URL: only when individual devices are selected
  const printUrl = selectedAssetIds.length > 0
    ? `/dashboard/maintenance/print?type=ly_lich&asset_ids=${selectedAssetIds.join(",")}${filterFrom ? `&from=${filterFrom}` : ""}${filterTo ? `&to=${filterTo}` : ""}`
    : null

  const vehiclePrintUrl = selectedVehicleId
    ? `/dashboard/maintenance/print?type=ly_lich_xe&vehicle_id=${selectedVehicleId}${filterFrom ? `&from=${filterFrom}` : ""}${filterTo ? `&to=${filterTo}` : ""}`
    : null

  const selectedAssets = assets.filter((a) => selectedAssetIds.includes(a.id))

  return (
    <MaintenanceShell>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Lý lịch thiết bị</h1>
          <p className="text-sm text-slate-500 mt-0.5">Lịch sử sửa chữa và bảo dưỡng theo thiết bị / xe</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={printUrl ?? "#"}
            target={printUrl ? "_blank" : undefined}
            onClick={!printUrl ? (e) => e.preventDefault() : undefined}
            className={`flex items-center gap-2 px-4 py-2.5 font-bold rounded-xl shadow-md ${
              printUrl
                ? "bg-slate-700 hover:bg-slate-800 text-white"
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            <Printer size={15} />
            {selectedAssetIds.length > 0
              ? `In lý lịch (${selectedAssetIds.length} thiết bị)`
              : "In lý lịch"}
          </Link>
          <Link
            href={vehiclePrintUrl ?? "#"}
            target={vehiclePrintUrl ? "_blank" : undefined}
            onClick={!vehiclePrintUrl ? (e) => e.preventDefault() : undefined}
            className={`flex items-center gap-2 px-4 py-2.5 font-bold rounded-xl shadow-md ${
              vehiclePrintUrl
                ? "bg-orange-600 hover:bg-orange-700 text-white"
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            <Printer size={15} /> In lý lịch xe
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap gap-3 items-end">
        <Filter size={15} className="text-slate-400 self-center" />

        {/* Asset multi-select picker (card-style like record form) */}
        <div className="flex flex-col gap-1 min-w-[320px] flex-1" ref={pickerRef}>
          <label className="text-xs font-bold text-slate-500">Thiết bị / Xe</label>
          <div className="relative z-10">
            {/* Trigger button */}
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              className="w-full flex items-center justify-between px-3 py-2.5 border border-slate-300 rounded-xl text-sm bg-white hover:border-orange-400 focus:border-orange-400 outline-none transition-colors"
            >
              <span className={selectedAssetIds.length > 0 ? "text-slate-700 font-semibold" : "text-slate-400"}>
                {selectedAssetIds.length > 0
                  ? `${selectedAssetIds.length} thiết bị đã chọn`
                  : "Chọn thiết bị để xem lý lịch..."}
              </span>
              <ChevronDown size={16} className={`text-slate-400 shrink-0 transition-transform ${pickerOpen ? "rotate-180" : ""}`} />
            </button>

            {/* Dropdown */}
            {pickerOpen && (
              <div className="absolute z-[80] mt-2 w-full rounded-2xl border border-slate-200 bg-white shadow-xl p-3">
                {/* Bộ phận filter inside dropdown */}
                <select
                  value={filterBoPhan}
                  onChange={(e) => { setFilterBoPhan(e.target.value); setAssetSearch("") }}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs outline-none focus:border-orange-400 bg-slate-50 mb-2"
                >
                  <option value="">— Tất cả bộ phận —</option>
                  {BO_PHAN_LIST.map((bp) => (
                    <option key={bp} value={bp}>{bp}</option>
                  ))}
                </select>

                {/* Search */}
                <input
                  autoFocus
                  value={assetSearch}
                  onChange={(e) => setAssetSearch(e.target.value)}
                  placeholder="Tìm nhanh mã hoặc tên thiết bị..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-orange-400 mb-2"
                />

                {/* Quick actions */}
                <div className="flex items-center justify-between mb-2">
                  <button
                    type="button"
                    onClick={() => {
                      const toAdd = filteredAssets.filter((a) => !selectedAssetIds.includes(a.id))
                      setSelectedAssetIds((prev) => [...prev, ...toAdd.map((a) => a.id)])
                    }}
                    className="text-xs font-bold text-orange-600 hover:bg-orange-50 px-2.5 py-1 rounded-lg transition-colors"
                  >
                    Chọn tất cả ({filteredAssets.length})
                  </button>
                  {selectedAssetIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedAssetIds([])}
                      className="text-xs font-bold text-slate-500 hover:bg-slate-100 px-2.5 py-1 rounded-lg transition-colors"
                    >
                      Bỏ chọn tất cả
                    </button>
                  )}
                </div>

                {/* Asset list */}
                <div className="max-h-64 overflow-y-auto space-y-1 pr-0.5">
                  {filteredAssets.length === 0 ? (
                    <div className="text-sm text-slate-400 text-center py-4">
                      {assetSearch ? "Không tìm thấy thiết bị phù hợp" : "Không có thiết bị"}
                    </div>
                  ) : (
                    filteredAssets.map((a) => {
                      const selected = selectedAssetIds.includes(a.id)
                      return (
                        <label
                          key={a.id}
                          className={`flex items-center gap-3 px-3 py-2 rounded-xl border cursor-pointer transition-all ${
                            selected
                              ? "border-orange-200 bg-orange-50"
                              : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleAsset(a)}
                            className="h-4 w-4 rounded border-slate-300 text-orange-500 focus:ring-orange-400 shrink-0"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-bold font-mono text-slate-800 truncate">{a.ma_tb}</span>
                            <span className="block text-[11px] text-slate-600 truncate">{a.ten_tb}</span>
                          </span>
                          <span className="text-[10px] text-slate-400 shrink-0">{a.bo_phan}</span>
                          <span className={`text-[10px] font-semibold shrink-0 ${selected ? "text-orange-600" : "text-slate-400"}`}>
                            {a.loai === "xe" ? "Xe" : "Máy"}
                          </span>
                        </label>
                      )
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Selected asset cards */}
          {selectedAssets.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {selectedAssets.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 px-3 py-1.5 bg-orange-50 border border-orange-200 rounded-xl text-xs"
                >
                  <span className="font-bold font-mono text-orange-800">{a.ma_tb}</span>
                  <span className="text-orange-700">{a.ten_tb}</span>
                  <button
                    type="button"
                    onClick={() => toggleAsset(a)}
                    className="text-orange-400 hover:text-red-500 transition-colors ml-1"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Xe — cho lý lịch xe (F02) */}
        <div className="flex flex-col gap-1 min-w-[200px]">
          <label className="text-xs font-bold text-slate-500">Xe (lý lịch F02)</label>
          <select
            value={selectedVehicleId}
            onChange={(e) => setSelectedVehicleId(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-orange-400 bg-white"
          >
            <option value="">— Chọn xe —</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.code} - {v.name}{v.plate_number ? ` (${v.plate_number})` : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Date range */}
        <div className="flex items-center gap-2">
          <Calendar size={14} className="text-slate-400" />
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-orange-400"
          />
          <span className="text-slate-400 text-sm">–</span>
          <input
            type="date"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-orange-400"
          />
        </div>

        {/* Content search */}
        <div className="flex items-center gap-2 border border-slate-300 rounded-xl px-3 py-2 min-w-[200px]">
          <Search size={14} className="text-slate-400" />
          <input
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            placeholder="Tìm nội dung, mã biên bản..."
            className="flex-1 text-sm outline-none bg-transparent"
          />
        </div>
      </div>

      {/* Selected devices banner */}
      {selectedAssets.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl px-5 py-3 flex items-center gap-4">
          <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center">
            <History size={16} className="text-orange-600" />
          </div>
          <div className="flex-1">
            <div className="font-extrabold text-orange-800 text-sm">
              {selectedAssets.length === 1
                ? selectedAssets[0].ten_tb
                : `${selectedAssets.length} thiết bị đã chọn`}
            </div>
            <div className="text-xs text-orange-600">
              {selectedAssets.length === 1
                ? `Mã: ${selectedAssets[0].ma_tb} · ${selectedAssets[0].bo_phan}`
                : selectedAssets.map((a) => a.ma_tb).join(", ")}
            </div>
          </div>
          <div className="text-sm font-bold text-orange-700">{filtered.length} lần bảo trì</div>
        </div>
      )}

      {/* History table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400">Đang tải...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <History size={40} className="mx-auto mb-3 opacity-30" />
            <p>
              {selectedAssetIds.length > 0
                ? "Chưa có lịch sử bảo trì cho thiết bị đã chọn"
                : "Chọn thiết bị để xem lịch sử bảo trì"}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide w-8" />
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">Ngày</th>
                {selectedAssetIds.length !== 1 && (
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">Thiết bị</th>
                )}
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">Nội dung sửa chữa / thay thế</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">Giá trị</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">Người thực hiện</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">Người theo dõi</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">Biên bản</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((row) => {
                const expanded = expandedRows.has(row.line_id)
                return (
                  <>
                    <tr key={row.line_id} className="row-hover cursor-pointer" onClick={() => toggleExpand(row.line_id)}>
                      <td className="px-4 py-3 text-slate-400">
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs whitespace-nowrap">
                        {row.ngay ? new Date(row.ngay).toLocaleDateString("vi-VN") : "—"}
                        <div className="mt-0.5">
                          {row.hang_muc === "Sửa chữa"
                            ? <span className="text-red-500 font-bold">{row.hang_muc}</span>
                            : <span className="text-blue-500 font-bold">{row.hang_muc}</span>}
                        </div>
                      </td>
                      {selectedAssetIds.length !== 1 && (
                        <td className="px-4 py-3">
                          <div className="font-bold text-slate-700 text-xs">{row.ten_tb}</div>
                          <div className="text-slate-400 text-xs">{row.ma_tb}</div>
                        </td>
                      )}
                      <td className="px-4 py-3 text-slate-700 max-w-xs">
                        <div className="line-clamp-2">{row.noi_dung || "—"}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700 text-xs font-bold whitespace-nowrap">{formatValue(row)}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs">
                        {row.nguoi_thuc_hien.length > 0
                          ? row.nguoi_thuc_hien.slice(0, 2).join(", ") + (row.nguoi_thuc_hien.length > 2 ? ` +${row.nguoi_thuc_hien.length - 2}` : "")
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{nguoiTheoDoiOf(row)}</td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/dashboard/maintenance/records/${row.record_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-mono text-xs font-bold text-emerald-700 hover:underline"
                        >
                          {row.ma_bb || "—"}
                        </Link>
                      </td>
                    </tr>
                    {expanded && (
                      <tr key={`${row.line_id}-detail`} className="bg-orange-50/50">
                        <td colSpan={selectedAssetIds.length === 1 ? 7 : 8} className="px-8 py-3">
                          <div className="grid grid-cols-2 gap-4 text-xs">
                            {row.noi_dung && (
                              <div>
                                <span className="font-bold text-slate-600">Nội dung: </span>
                                <span className="text-slate-700">{row.noi_dung}</span>
                              </div>
                            )}
                            {row.cac_khac_phuc && (
                              <div>
                                <span className="font-bold text-slate-600">Cách khắc phục: </span>
                                <span className="text-slate-700">{row.cac_khac_phuc}</span>
                              </div>
                            )}
                            {row.nguoi_thuc_hien.length > 0 && (
                              <div>
                                <span className="font-bold text-slate-600">Người thực hiện: </span>
                                <span className="text-slate-700">{row.nguoi_thuc_hien.join(", ")}</span>
                              </div>
                            )}
                            {row.nv_phu_trach && (
                              <div>
                                <span className="font-bold text-slate-600">NV phụ trách: </span>
                                <span className="text-slate-700">{row.nv_phu_trach}</span>
                              </div>
                            )}
                            {row.phu_trach_bao_tri && (
                              <div>
                                <span className="font-bold text-slate-600">Phụ trách bảo trì: </span>
                                <span className="text-slate-700">{row.phu_trach_bao_tri}</span>
                              </div>
                            )}
                            <div>
                              <span className="font-bold text-slate-600">Chi phí ước tính: </span>
                              <span className="text-slate-700">{formatValue(row)}</span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Summary */}
      {filtered.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-3 flex items-center gap-6 text-sm">
          <span className="font-bold text-slate-600">Tổng cộng: {filtered.length} lần bảo trì</span>
          <span className="text-slate-400">|</span>
          <span className="text-slate-600">
            Sửa chữa: <strong className="text-red-600">{filtered.filter((r) => r.hang_muc === "Sửa chữa").length}</strong>
          </span>
          <span className="text-slate-600">
            Bảo dưỡng: <strong className="text-blue-600">{filtered.filter((r) => r.hang_muc === "Bảo dưỡng").length}</strong>
          </span>
        </div>
      )}
    </MaintenanceShell>
  )
}
