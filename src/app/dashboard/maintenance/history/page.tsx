"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import dynamic from "next/dynamic"
import Link from "next/link"
import { ChevronDown, FileBarChart, History, Printer, QrCode, Search, X } from "lucide-react"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { MaintenanceShell } from "../_components/maintenance-shell"
import { BO_PHAN_LIST, currencySymbol, type MaintenanceAsset } from "../_components/maintenance-data"
import { FilterBar } from "@/app/dashboard/_components/filter-bar"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { ExpandAllToggle, ExpandableRow, ExpandHeaderCell } from "@/app/dashboard/_components/doc-ui/expandable-row"
import { DocCodePill } from "@/app/dashboard/_components/doc-ui/doc-code-pill"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { HangMucLabel } from "../_components/hang-muc-label"
import { BannerAction } from "../_components/banner-action"
import { PageHeaderBanner } from "@/app/dashboard/_components/page-header-banner"
import { PageBackgroundMotif } from "@/app/dashboard/_components/page-background-motif"

// html5-qrcode đụng navigator.mediaDevices ⇒ chỉ chạy ở client (mirror inventory/item/page.tsx).
const QrScanner = dynamic(
  () => import("@/app/dashboard/product/confirm/qr-scanner").then((m) => m.QrScanner),
  { ssr: false },
)

// QR in trên biên bản = `{origin}/dashboard/maintenance/records/{uuid}` (rule 14). Nhận cả URL đó,
// UUID trần, hoặc chuỗi mã biên bản (vd "MT-101026/003").
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

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
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanNotice, setScanNotice] = useState<{ text: string; tone: "ok" | "warn"; recordId?: string } | null>(null)
  const [assets, setAssets] = useState<AssetOption[]>([])
  const [vehicles, setVehicles] = useState<DispatchVehicleOption[]>([])
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<string[]>([])
  const [rows, setRows] = useState<HistoryRow[]>([])

  const [filterBoPhan, setFilterBoPhan] = useState("")
  const [assetSearch, setAssetSearch] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  const [filterFrom, setFilterFrom] = useState("")
  const [filterTo, setFilterTo] = useState("")
  const [filterSearch, setFilterSearch] = useState("")
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  const isVehicleMode = filterBoPhan === "Đội xe"

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

  // Filtered items for picker dropdown
  const filteredPickerItems: Array<{ id: string; primary: string; secondary: string; sub: string }> =
    isVehicleMode
      ? vehicles
          .filter((v) => {
            const q = assetSearch.toLowerCase()
            return !q || v.code.toLowerCase().includes(q) || v.name.toLowerCase().includes(q)
          })
          .map((v) => ({
            id: v.id,
            primary: v.code,
            secondary: v.name,
            sub: v.plate_number || v.vehicle_type || "Xe",
          }))
      : assets
          .filter((a) => {
            const matchBp = filterBoPhan ? a.bo_phan === filterBoPhan : true
            const q = assetSearch.toLowerCase()
            const matchSearch = !q || a.ten_tb.toLowerCase().includes(q) || a.ma_tb.toLowerCase().includes(q)
            return matchBp && matchSearch
          })
          .map((a) => ({
            id: a.id,
            primary: a.ma_tb,
            secondary: a.ten_tb,
            sub: a.bo_phan,
          }))

  const selectedIds = isVehicleMode ? selectedVehicleIds : selectedAssetIds
  const setSelectedIds = isVehicleMode
    ? (fn: (prev: string[]) => string[]) => setSelectedVehicleIds(fn)
    : (fn: (prev: string[]) => string[]) => setSelectedAssetIds(fn)

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const handleBoPhanChange = (bp: string) => {
    setFilterBoPhan(bp)
    setAssetSearch("")
    // Clear the selection mode that's no longer active
    if (bp === "Đội xe") setSelectedAssetIds([])
    else setSelectedVehicleIds([])
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

  const loadHistory = useCallback(
    async (fid: string) => {
      setLoading(true)
      try {
        const hasSelectedTarget = selectedVehicleIds.length > 0 || selectedAssetIds.length > 0

        if (hasSelectedTarget) {
          // Khi đã chọn thiết bị hoặc xe: truy vấn trực tiếp maintenance_record_lines trước
          let lineQ = supabase
            .from("maintenance_record_lines")
            .select(
              "id, record_id, asset_id, dispatch_vehicle_id, ten_tb, ma_tb, noi_dung, cac_khac_phuc, chi_phi_dk, loai_tien, cong_tho",
            )
            .eq("factory_id", fid)

          if (selectedVehicleIds.length > 0) lineQ = lineQ.in("dispatch_vehicle_id", selectedVehicleIds)
          else if (selectedAssetIds.length > 0) lineQ = lineQ.in("asset_id", selectedAssetIds)

          const { data: lines, error: lErr } = await lineQ
          if (lErr || !lines || lines.length === 0) {
            setRows([])
            return
          }

          const recIds = [...new Set(lines.map((l) => l.record_id))]
          const recList: {
            id: string
            ma_bb: string | null
            hang_muc: string
            ngay: string
            bo_phan: string
            nguoi_thuc_hien: string[]
            nv_phu_trach: string | null
            phu_trach_bao_tri: string | null
          }[] = []

          // Phân đoạn truy vấn theo lô 100 ID để tránh lỗi 400 Bad Request / URL length limit
          for (let i = 0; i < recIds.length; i += 100) {
            const chunk = recIds.slice(i, i + 100)
            let recQ = supabase
              .from("maintenance_records")
              .select(
                "id, ma_bb, hang_muc, ngay, bo_phan, nguoi_thuc_hien, nv_phu_trach, phu_trach_bao_tri",
              )
              .in("id", chunk)
              .eq("factory_id", fid)
              .eq("trang_thai", "da_duyet")

            if (filterFrom) recQ = recQ.gte("ngay", filterFrom)
            if (filterTo) recQ = recQ.lte("ngay", filterTo)
            const { data: chunkRecs } = await recQ
            if (chunkRecs) recList.push(...chunkRecs)
          }

          if (recList.length === 0) {
            setRows([])
            return
          }

          const recMap = new Map(recList.map((r) => [r.id, r]))
          const mapped: HistoryRow[] = lines
            .filter((l) => recMap.has(l.record_id))
            .map((l) => {
              const rec = recMap.get(l.record_id)!
              return {
                record_id: l.record_id,
                line_id: l.id,
                ngay: rec.ngay,
                ma_bb: rec.ma_bb,
                hang_muc: rec.hang_muc,
                bo_phan: rec.bo_phan,
                noi_dung: l.noi_dung,
                cac_khac_phuc: l.cac_khac_phuc,
                chi_phi_dk: l.chi_phi_dk || 0,
                loai_tien: l.loai_tien || "USD",
                cong_tho: l.cong_tho || 0,
                nguoi_thuc_hien: rec.nguoi_thuc_hien || [],
                nv_phu_trach: rec.nv_phu_trach,
                phu_trach_bao_tri: rec.phu_trach_bao_tri,
                asset_id: l.asset_id,
                ten_tb: l.ten_tb,
                ma_tb: l.ma_tb,
              }
            })
          mapped.sort((a, b) => b.ngay.localeCompare(a.ngay))
          setRows(mapped)
        } else {
          // Khi chưa chọn thiết bị/xe: tải các biên bản theo bộ phận hoặc ngày có phân đoạn
          let recQ = supabase
            .from("maintenance_records")
            .select(
              "id, ma_bb, hang_muc, ngay, bo_phan, nguoi_thuc_hien, nv_phu_trach, phu_trach_bao_tri",
            )
            .eq("factory_id", fid)
            .eq("trang_thai", "da_duyet")
            .order("ngay", { ascending: false })
            .limit(200)

          if (filterBoPhan) recQ = recQ.eq("bo_phan", filterBoPhan)
          if (filterFrom) recQ = recQ.gte("ngay", filterFrom)
          if (filterTo) recQ = recQ.lte("ngay", filterTo)
          const { data: records } = await recQ

          const recList = (records || []) as {
            id: string
            ma_bb: string | null
            hang_muc: string
            ngay: string
            bo_phan: string
            nguoi_thuc_hien: string[]
            nv_phu_trach: string | null
            phu_trach_bao_tri: string | null
          }[]

          if (recList.length === 0) {
            setRows([])
            return
          }

          const recIds = recList.map((r) => r.id)
          const lines: any[] = []
          for (let i = 0; i < recIds.length; i += 100) {
            const chunk = recIds.slice(i, i + 100)
            const { data: chunkLines } = await supabase
              .from("maintenance_record_lines")
              .select(
                "id, record_id, asset_id, dispatch_vehicle_id, ten_tb, ma_tb, noi_dung, cac_khac_phuc, chi_phi_dk, loai_tien, cong_tho",
              )
              .in("record_id", chunk)
              .eq("factory_id", fid)
            if (chunkLines) lines.push(...chunkLines)
          }

          const recMap = new Map(recList.map((r) => [r.id, r]))
          const mapped: HistoryRow[] = lines
            .filter((l) => recMap.has(l.record_id))
            .map((l) => {
              const rec = recMap.get(l.record_id)!
              return {
                record_id: l.record_id,
                line_id: l.id,
                ngay: rec.ngay,
                ma_bb: rec.ma_bb,
                hang_muc: rec.hang_muc,
                bo_phan: rec.bo_phan,
                noi_dung: l.noi_dung,
                cac_khac_phuc: l.cac_khac_phuc,
                chi_phi_dk: l.chi_phi_dk || 0,
                loai_tien: l.loai_tien || "USD",
                cong_tho: l.cong_tho || 0,
                nguoi_thuc_hien: rec.nguoi_thuc_hien || [],
                nv_phu_trach: rec.nv_phu_trach,
                phu_trach_bao_tri: rec.phu_trach_bao_tri,
                asset_id: l.asset_id,
                ten_tb: l.ten_tb,
                ma_tb: l.ma_tb,
              }
            })
          mapped.sort((a, b) => b.ngay.localeCompare(a.ngay))
          setRows(mapped)
        }
      } finally {
        setLoading(false)
      }
    },
    [selectedAssetIds, selectedVehicleIds, filterBoPhan, filterFrom, filterTo],
  )

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
    if (row.chi_phi_dk > 0 && row.cong_tho > 0)
      return `${sym}${row.chi_phi_dk.toLocaleString()} + ${sym}${row.cong_tho.toLocaleString()} CT`
    if (row.chi_phi_dk > 0) return `${sym}${row.chi_phi_dk.toLocaleString()}`
    if (row.cong_tho > 0) return `${sym}${row.cong_tho.toLocaleString()} CT`
    return "—"
  }

  const nguoiTheoDoiOf = (row: HistoryRow) =>
    [row.nv_phu_trach, row.phu_trach_bao_tri].filter(Boolean).join(", ") || "—"

  // Print URL: F02 for vehicles, F01 for assets
  const printUrl =
    selectedVehicleIds.length > 0
      ? `/dashboard/maintenance/print?type=ly_lich_xe&vehicle_ids=${selectedVehicleIds.join(",")}${filterFrom ? `&from=${filterFrom}` : ""}${filterTo ? `&to=${filterTo}` : ""}`
      : selectedAssetIds.length > 0
        ? `/dashboard/maintenance/print?type=ly_lich&asset_ids=${selectedAssetIds.join(",")}${filterFrom ? `&from=${filterFrom}` : ""}${filterTo ? `&to=${filterTo}` : ""}`
        : null

  const totalSelected = selectedVehicleIds.length + selectedAssetIds.length
  const printLabel =
    selectedVehicleIds.length > 0
      ? `In lý lịch (${selectedVehicleIds.length} xe)`
      : selectedAssetIds.length > 0
        ? `In lý lịch (${selectedAssetIds.length} thiết bị)`
        : "In lý lịch"

  // Báo cáo công tác bảo trì theo kỳ (F07) — cùng tham số với trang Biên bản; trang in luôn chỉ
  // lấy biên bản "Đã duyệt". Bắt buộc có Từ ngày + Đến ngày.
  const canPrintF07 = hasPermission(user, "maintenance.print")
  const bcKyUrl = filterFrom && filterTo
    ? `/dashboard/maintenance/print?type=bao_cao_ky&from=${filterFrom}&to=${filterTo}` +
      (filterBoPhan ? `&bo_phan=${encodeURIComponent(filterBoPhan)}` : "") +
      (selectedAssetIds.length > 0 ? `&asset_ids=${selectedAssetIds.join(",")}` : "") +
      (selectedVehicleIds.length > 0 ? `&vehicle_ids=${selectedVehicleIds.join(",")}` : "")
    : null

  // Quét QR biên bản đã in → chọn đúng thiết bị/xe của biên bản + lọc theo mã biên bản.
  const handleScanDecoded = async (text: string) => {
    if (!factoryId) return
    setScanError(null)
    const raw = text.trim()
    const uuid = raw.match(UUID_RE)?.[0] ?? null
    let q = supabase
      .from("maintenance_records")
      .select("id, ma_bb, bo_phan, trang_thai, maintenance_record_lines(asset_id, dispatch_vehicle_id)")
      .eq("factory_id", factoryId)
    q = uuid ? q.eq("id", uuid) : q.eq("ma_bb", raw)
    const { data, error } = await q.maybeSingle()
    if (error || !data) {
      setScanError("Không tìm thấy biên bản từ mã QR này trong nhà máy hiện tại.")
      return
    }
    const rec = data as {
      id: string
      ma_bb: string | null
      bo_phan: string
      trang_thai: string
      maintenance_record_lines: { asset_id: string | null; dispatch_vehicle_id: string | null }[]
    }
    const lines = rec.maintenance_record_lines || []
    const vehicleIds = [...new Set(lines.map((l) => l.dispatch_vehicle_id).filter(Boolean) as string[])]
    const assetIds = [...new Set(lines.map((l) => l.asset_id).filter(Boolean) as string[])]
    if (vehicleIds.length > 0) {
      setFilterBoPhan("Đội xe")
      setSelectedAssetIds([])
      setSelectedVehicleIds(vehicleIds)
    } else {
      setFilterBoPhan(rec.bo_phan || "")
      setSelectedVehicleIds([])
      setSelectedAssetIds(assetIds)
    }
    setFilterFrom("")
    setFilterTo("")
    setFilterSearch(rec.ma_bb || "")
    setScanning(false)
    setScanNotice(
      rec.trang_thai === "da_duyet"
        ? { text: `Đã quét biên bản ${rec.ma_bb || ""} — đang hiển thị lý lịch của thiết bị/xe trong biên bản.`, tone: "ok" }
        : {
            text: `Biên bản ${rec.ma_bb || ""} chưa được duyệt nên chưa có trong lý lịch.`,
            tone: "warn",
            recordId: rec.id,
          },
    )
  }

  // Chips display
  const selectedVehicles = vehicles.filter((v) => selectedVehicleIds.includes(v.id))
  const selectedAssets = assets.filter((a) => selectedAssetIds.includes(a.id))
  const showBanner = selectedAssets.length > 0 || selectedVehicles.length > 0

  return (
    <MaintenanceShell>
      {scanning && typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[90] overflow-y-auto bg-black">
            <QrScanner
              onDecoded={(t) => void handleScanDecoded(t)}
              onCancel={() => { setScanning(false); setScanError(null) }}
              hintText="Đưa camera vào mã QR trên biên bản đã in"
              cancelText="Hủy quét"
              cameraErrorText="Không mở được camera. Hãy cấp quyền camera hoặc tải ảnh chứa QR."
              uploadButtonText="Tải ảnh chứa QR"
              uploadScanningText="Đang xử lý ảnh..."
              uploadNotFoundText="Không tìm thấy mã QR trong ảnh."
              orDividerText="hoặc"
              scanError={scanError}
            />
          </div>,
          document.body,
        )}

      <PageBackgroundMotif theme="slate" />
      <PageHeaderBanner
        title="Lý lịch thiết bị"
        subtitle="Lịch sử sửa chữa và bảo dưỡng theo thiết bị / xe"
        theme="slate"
        icon={History}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {canPrintF07 && (
              <BannerAction
                href={bcKyUrl}
                icon={FileBarChart}
                label="Báo cáo theo kỳ (F07)"
                disabledHint="Chọn Từ ngày và Đến ngày để in báo cáo theo kỳ"
                newTab
              />
            )}
            <BannerAction
              href={printUrl}
              icon={Printer}
              label={printLabel}
              variant="solid"
              disabledHint="Chọn thiết bị / xe để in lý lịch"
              newTab
            />
          </div>
        }
      />

      {/* Filters — Tìm/Quét QR đứng đầu; mọi ô cùng chiều cao 40px */}
      <FilterBar
        layout="grid"
        activeCount={
          selectedAssetIds.length + selectedVehicleIds.length + [filterFrom, filterTo, filterSearch].filter(Boolean).length
        }
      >
        <div className="flex h-10 w-full items-center gap-2 rounded-xl border border-slate-300 bg-white pl-3 pr-1 focus-within:border-mod-600 sm:col-span-2">
          <Search size={15} className="shrink-0 text-slate-400" />
          <input
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            placeholder="Tìm nội dung, mã biên bản..."
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          {filterSearch && (
            <button
              type="button"
              aria-label="Xoá tìm kiếm"
              onClick={() => setFilterSearch("")}
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={() => { setScanError(null); setScanning(true) }}
            title="Quét QR biên bản đã in"
            aria-label="Quét QR biên bản đã in"
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-mod-50 px-2.5 text-xs font-bold text-mod-800 transition-colors hover:bg-mod-200"
          >
            <QrCode size={15} />
            <span className="hidden sm:inline">Quét QR</span>
          </button>
        </div>

        {/* Thiết bị / Xe — không còn nhãn riêng để cùng chiều cao với các ô khác */}
        <div className="relative w-full sm:col-span-2" ref={pickerRef}>
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none transition-colors hover:border-mod-200 focus:border-mod-600"
          >
            <span className={`truncate ${totalSelected > 0 ? "font-semibold text-slate-700" : "text-slate-400"}`}>
              {selectedVehicleIds.length > 0
                ? `${selectedVehicleIds.length} xe đã chọn`
                : selectedAssetIds.length > 0
                  ? `${selectedAssetIds.length} thiết bị đã chọn`
                  : "Thiết bị / Xe — chọn để xem lý lịch"}
            </span>
            <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${pickerOpen ? "rotate-180" : ""}`} />
          </button>

          {pickerOpen && (
            <div className="absolute z-[80] mt-2 w-full min-w-64 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
              <select
                value={filterBoPhan}
                onChange={(e) => handleBoPhanChange(e.target.value)}
                className="mb-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-mod-600"
              >
                <option value="">— Tất cả bộ phận —</option>
                {BO_PHAN_LIST.map((bp) => (
                  <option key={bp} value={bp}>
                    {bp}
                  </option>
                ))}
              </select>

              <input
                autoFocus
                value={assetSearch}
                onChange={(e) => setAssetSearch(e.target.value)}
                placeholder={isVehicleMode ? "Tìm nhanh mã hoặc tên xe..." : "Tìm nhanh mã hoặc tên thiết bị..."}
                className="mb-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-mod-600"
              />

              <div className="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    const toAdd = filteredPickerItems.filter((item) => !selectedIds.includes(item.id))
                    setSelectedIds((prev) => [...prev, ...toAdd.map((item) => item.id)])
                  }}
                  className="rounded-lg px-2.5 py-1 text-xs font-bold text-mod-800 transition-colors hover:bg-mod-50"
                >
                  Chọn tất cả ({filteredPickerItems.length})
                </button>
                {selectedIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedIds(() => [])}
                    className="rounded-lg px-2.5 py-1 text-xs font-bold text-slate-500 transition-colors hover:bg-slate-100"
                  >
                    Bỏ chọn tất cả
                  </button>
                )}
              </div>

              <div className="max-h-64 space-y-1 overflow-y-auto pr-0.5">
                {filteredPickerItems.length === 0 ? (
                  <div className="py-4 text-center text-sm text-slate-400">
                    {assetSearch ? "Không tìm thấy phù hợp" : isVehicleMode ? "Không có xe" : "Không có thiết bị"}
                  </div>
                ) : (
                  filteredPickerItems.map((item) => {
                    const selected = selectedIds.includes(item.id)
                    return (
                      <label
                        key={item.id}
                        className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition-all ${
                          selected ? "border-mod-200 bg-mod-50" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleItem(item.id)}
                          className="h-4 w-4 shrink-0 rounded border-slate-300 text-mod-600 focus:ring-mod-600"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="font-code block truncate text-xs font-bold text-slate-800">{item.primary}</span>
                          <span className="block truncate text-[11px] text-slate-600">{item.secondary}</span>
                        </span>
                        <span className="shrink-0 text-[10px] text-slate-400">{item.sub}</span>
                      </label>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>

        <input
          type="date"
          value={filterFrom}
          onChange={(e) => setFilterFrom(e.target.value)}
          aria-label="Từ ngày"
          title="Từ ngày"
          className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-mod-600"
        />
        <input
          type="date"
          value={filterTo}
          onChange={(e) => setFilterTo(e.target.value)}
          aria-label="Đến ngày"
          title="Đến ngày"
          className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-mod-600"
        />
      </FilterBar>

      {/* Thiết bị / xe đã chọn (chuyển ra ngoài bộ lọc để các ô lọc thẳng hàng) */}
      {(selectedAssets.length > 0 || selectedVehicles.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {selectedAssets.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-xl border border-mod-200 bg-mod-50 px-3 py-1.5 text-xs">
              <span className="font-code font-bold text-mod-800">{a.ma_tb}</span>
              <span className="text-slate-700">{a.ten_tb}</span>
              <button
                type="button"
                aria-label={`Bỏ ${a.ma_tb}`}
                onClick={() => setSelectedAssetIds((prev) => prev.filter((id) => id !== a.id))}
                className="ml-1 text-slate-400 transition-colors hover:text-red-600"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {selectedVehicles.map((v) => (
            <div key={v.id} className="flex items-center gap-2 rounded-xl border border-mod-200 bg-mod-50 px-3 py-1.5 text-xs">
              <span className="font-code font-bold text-mod-800">{v.code}</span>
              <span className="text-slate-700">{v.name}</span>
              <button
                type="button"
                aria-label={`Bỏ ${v.code}`}
                onClick={() => setSelectedVehicleIds((prev) => prev.filter((id) => id !== v.id))}
                className="ml-1 text-slate-400 transition-colors hover:text-red-600"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {scanNotice && (
        <div
          role="status"
          className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2.5 text-sm ${
            scanNotice.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          <QrCode size={16} className="shrink-0" />
          <span className="flex-1">{scanNotice.text}</span>
          {scanNotice.recordId && (
            <Link href={`/dashboard/maintenance/records/${scanNotice.recordId}`} className="font-bold underline">
              Mở biên bản
            </Link>
          )}
          <button type="button" aria-label="Đóng" onClick={() => setScanNotice(null)} className="rounded-md p-1 hover:bg-black/5">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Selected devices banner */}
      {showBanner && (
        <div className="bg-white border border-slate-200 border-l-4 border-l-mod-600 rounded-xl px-5 py-3 flex items-center gap-4 shadow-sm">
          <div className="w-9 h-9 rounded-full bg-mod-50 flex items-center justify-center">
            <History size={16} className="text-mod-600" />
          </div>
          <div className="flex-1">
            {selectedVehicles.length > 0 ? (
              <>
                <div className="font-extrabold text-slate-800 text-sm">
                  {selectedVehicles.length === 1
                    ? `${selectedVehicles[0].code} - ${selectedVehicles[0].name}`
                    : `${selectedVehicles.length} xe đã chọn`}
                </div>
                <div className="text-xs text-slate-500">
                  {selectedVehicles.length === 1
                    ? selectedVehicles[0].plate_number || selectedVehicles[0].vehicle_type || "Đội xe"
                    : selectedVehicles.map((v) => v.code).join(", ")}
                </div>
              </>
            ) : (
              <>
                <div className="font-extrabold text-slate-800 text-sm">
                  {selectedAssets.length === 1
                    ? selectedAssets[0].ten_tb
                    : `${selectedAssets.length} thiết bị đã chọn`}
                </div>
                <div className="text-xs text-slate-500">
                  {selectedAssets.length === 1
                    ? `Mã: ${selectedAssets[0].ma_tb} · ${selectedAssets[0].bo_phan}`
                    : selectedAssets.map((a) => a.ma_tb).join(", ")}
                </div>
              </>
            )}
          </div>
          <div className="text-sm font-bold text-mod-800">{filtered.length} lần bảo trì</div>
        </div>
      )}

      {/* History table — dòng có chi tiết con: mũi tên ở CUỐI dòng (quy tắc U1) */}
      {!loading && filtered.length > 0 && (
        <div className="flex justify-end">
          <ExpandAllToggle
            allExpanded={filtered.every((r) => expandedRows.has(r.line_id))}
            onExpandAll={() => setExpandedRows(new Set(filtered.map((r) => r.line_id)))}
            onCollapseAll={() => setExpandedRows(new Set())}
          />
        </div>
      )}
      <ResponsiveTableWrapper>
        {loading ? (
          <ListState kind="loading" />
        ) : filtered.length === 0 ? (
          <ListState
            kind="empty"
            message={
              totalSelected > 0
                ? "Chưa có lịch sử bảo trì cho thiết bị / xe đã chọn"
                : "Chọn thiết bị / xe để xem lịch sử bảo trì"
            }
          />
        ) : (
          <table className="enterprise-table min-w-[780px]">
            <thead>
              <tr>
                <th>Ngày</th>
                {totalSelected !== 1 && <th>Thiết bị / Xe</th>}
                <th>Nội dung sửa chữa / thay thế</th>
                <th>Giá trị</th>
                <th>Người thực hiện</th>
                <th>Người theo dõi</th>
                <th>Biên bản</th>
                <ExpandHeaderCell />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <ExpandableRow
                  key={row.line_id}
                  expanded={expandedRows.has(row.line_id)}
                  onToggle={() => toggleExpand(row.line_id)}
                  colSpan={totalSelected === 1 ? 7 : 8}
                  label="Xem chi tiết lần bảo trì"
                  detail={
                    <div className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
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
                  }
                >
                  <td className="text-slate-600 text-xs whitespace-nowrap">
                    {row.ngay ? new Date(row.ngay).toLocaleDateString("vi-VN") : "—"}
                    <div className="mt-0.5">
                      <HangMucLabel hangMuc={row.hang_muc} size="sm" />
                    </div>
                  </td>
                  {totalSelected !== 1 && (
                    <td>
                      <div className="font-bold text-slate-700 text-xs">{row.ten_tb}</div>
                      <div className="text-slate-400 text-xs">{row.ma_tb}</div>
                    </td>
                  )}
                  <td className="text-slate-700 max-w-xs">
                    <div className="line-clamp-2">{row.noi_dung || "—"}</div>
                  </td>
                  <td className="text-slate-700 text-xs font-bold whitespace-nowrap">{formatValue(row)}</td>
                  <td className="text-slate-600 text-xs">
                    {row.nguoi_thuc_hien.length > 0
                      ? row.nguoi_thuc_hien.slice(0, 2).join(", ") +
                        (row.nguoi_thuc_hien.length > 2 ? ` +${row.nguoi_thuc_hien.length - 2}` : "")
                      : "—"}
                  </td>
                  <td className="text-slate-600 text-xs">{nguoiTheoDoiOf(row)}</td>
                  <td>
                    <Link
                      href={`/dashboard/maintenance/records/${row.record_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:opacity-80"
                      title="Mở biên bản"
                    >
                      <DocCodePill code={row.ma_bb} />
                    </Link>
                  </td>
                </ExpandableRow>
              ))}
            </tbody>
          </table>
        )}
      </ResponsiveTableWrapper>

      {/* Summary */}
      {filtered.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-3 flex items-center gap-6 text-sm">
          <span className="font-bold text-slate-600">Tổng cộng: {filtered.length} lần bảo trì</span>
          <span className="text-slate-400">|</span>
          <span className="text-slate-600">
            Sửa chữa:{" "}
            <strong className="text-slate-800">
              {filtered.filter((r) => r.hang_muc === "Sửa chữa").length}
            </strong>
          </span>
          <span className="text-slate-600">
            Bảo dưỡng:{" "}
            <strong className="text-slate-800">
              {filtered.filter((r) => r.hang_muc === "Bảo dưỡng").length}
            </strong>
          </span>
        </div>
      )}
    </MaintenanceShell>
  )
}
