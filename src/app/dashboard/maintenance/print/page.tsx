"use client"

import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, CheckCircle2, ChevronLeft, Download } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { authBlockReason, hasPermission, hydrateActiveSession, signOutEverywhere } from "@/lib/auth"
import { setCurrencyRates, getCurrencyRates } from "@/lib/currency"
import { BO_PHAN_LIST } from "../_components/maintenance-data"
import {
  downloadMaintenanceSuCoNhoPdf,
  downloadMaintenanceBaoDuongPdf,
  downloadMaintenanceBaoDuongXePdf,
  downloadMaintenanceSuaChuaNhoXePdf,
  downloadMaintenanceLyLichPdf,
  downloadMaintenanceLyLichXePdf,
  downloadMaintenanceBaoCaoKyPdf,
  type RecordData,
  type LineData,
  type MaterialRow,
  type HistoryRow,
  type AssetInfo,
  type VehicleInfo,
  type DriverAssignmentRow,
  type VehicleHistoryRow,
  type BaoCaoKyRow,
  type BaoCaoKySection,
} from "@/lib/maintenance-pdf"

// ─── Types ────────────────────────────────────────────────────────────────────

type PrintType = "su_co" | "de_nghi" | "ly_lich" | "su_co_nho" | "bao_duong" | "bao_duong_xe" | "sua_chua_nho_xe" | "ly_lich_xe" | "bao_cao_ky"

type PdfState = "idle" | "generating" | "done" | "error" | "empty"

const PRINT_LABEL: Record<PrintType, string> = {
  su_co: "Biên bản kiểm tra sự cố (F13)",
  de_nghi: "Giấy đề nghị (F10) + Biên bản nghiệm thu (F15)",
  su_co_nho: "Biên bản sửa chữa (F13 + F10 + F15 + Ảnh)",
  ly_lich: "Lý lịch thiết bị (F01)",
  bao_duong: "Bảo dưỡng thiết bị (F03 + F15 + Ảnh)",
  bao_duong_xe: "Bảo dưỡng xe (F03 + F15 + F06 + Ảnh)",
  sua_chua_nho_xe: "Sửa chữa nhỏ xe (F08 + F15 + F06 + Ảnh)",
  ly_lich_xe: "Lý lịch xe máy (F02)",
  bao_cao_ky: "Báo cáo công tác bảo trì theo kỳ (F07)",
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MaintenancePrintPage() {
  const params = useSearchParams()
  const printType = (params.get("type") || "su_co") as PrintType
  const recordId = params.get("record_id") || ""
  const assetId = params.get("asset_id") || ""
  const assetIdsParam = params.get("asset_ids") || ""   // comma-separated for multi-device ly_lich
  const vehicleId = params.get("vehicle_id") || ""
  const vehicleIdsParam = params.get("vehicle_ids") || ""  // comma-separated for multi-vehicle ly_lich_xe
  const filterFrom = params.get("from") || ""
  const filterTo = params.get("to") || ""
  const boPhanParam = params.get("bo_phan") || ""    // comma-separated for bao_cao_ky
  const hangMucParam = params.get("hang_muc") || ""  // comma-separated for bao_cao_ky

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [pdfState, setPdfState] = useState<PdfState>("idle")
  const [record, setRecord] = useState<RecordData | null>(null)
  const [staffMap, setStaffMap] = useState<Map<string, string>>(new Map())
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([])
  const [assetInfo, setAssetInfo] = useState<AssetInfo | null>(null)
  const [multiAssets, setMultiAssets] = useState<{ info: AssetInfo; rows: HistoryRow[] }[]>([])
  const [vehicleInfo, setVehicleInfo] = useState<VehicleInfo | null>(null)
  const [vehicleDrivers, setVehicleDrivers] = useState<DriverAssignmentRow[]>([])
  const [vehicleMaintRows, setVehicleMaintRows] = useState<VehicleHistoryRow[]>([])
  const [vehicleRepairRows, setVehicleRepairRows] = useState<VehicleHistoryRow[]>([])
  const [multiVehicles, setMultiVehicles] = useState<{
    vehicle: VehicleInfo
    drivers: DriverAssignmentRow[]
    maintRows: VehicleHistoryRow[]
    repairRows: VehicleHistoryRow[]
  }[]>([])
  const [baoCaoKySections, setBaoCaoKySections] = useState<BaoCaoKySection[]>([])
  const [lapBieuName, setLapBieuName] = useState("")

  const qrUrl = useMemo(() => {
    if (!recordId || typeof window === "undefined") return ""
    return `${window.location.origin}/dashboard/maintenance/records/${recordId}`
  }, [recordId])

  const [authFactoryId, setAuthFactoryId] = useState<string | null>(null)

  // Trang in này trước đây không có bất kỳ kiểm tra đăng nhập/quyền nào, và truy vấn chính
  // (maintenance_records theo record_id/asset_id/vehicle_id từ URL) không lọc theo nhà máy
  // — bất kỳ ai (kể cả chưa đăng nhập) biết id là xem được biên bản/lý lịch bảo trì của bất
  // kỳ nhà máy nào. Gate rõ ràng, chỉ cho load() chạy sau khi xác định được factory_id thật.
  useEffect(() => {
    const check = async () => {
      const { session, user } = await hydrateActiveSession().catch(() => ({ session: null, user: null }))
      const blocked = authBlockReason(user)
      if (!session?.user || blocked) {
        setLoading(false)
        await signOutEverywhere()
        window.location.replace(`/login${blocked ? `?reason=${blocked}` : ""}`)
        return
      }
      if (!hasPermission(user, "maintenance.print")) {
        setLoading(false)
        window.location.replace("/dashboard")
        return
      }
      if (!user.factory_id) {
        setError("Không xác định được nhà máy đang đăng nhập.")
        setLoading(false)
        return
      }
      setLapBieuName(user.full_name || "")
      setAuthFactoryId(user.factory_id)
    }
    void check()
  }, [])

  useEffect(() => {
    if (!authFactoryId) return
    const fid = authFactoryId
    const load = async () => {
      setLoading(true)
      try {
        if (printType === "ly_lich") {
          // Two-step query helper for one asset
          const fetchRowsForAsset = async (aid: string, factoryId?: string): Promise<HistoryRow[]> => {
            const { data: linesData } = await supabase
              .from("maintenance_record_lines")
              .select("id, record_id, asset_id, ten_tb, ma_tb, noi_dung, cac_khac_phuc, chi_phi_dk, loai_tien, cong_tho")
              .eq("asset_id", aid)
            if (!linesData || linesData.length === 0) return []

            const recIds = [...new Set(linesData.map((l) => l.record_id))]
            const recList: {
              id: string; ma_bb: string | null; hang_muc: string; ngay: string
              nguoi_thuc_hien: string[]; nv_phu_trach: string | null; phu_trach_bao_tri: string | null
            }[] = []

            for (let i = 0; i < recIds.length; i += 100) {
              const chunk = recIds.slice(i, i + 100)
              let recQ = supabase
                .from("maintenance_records")
                .select("id, ma_bb, hang_muc, ngay, nguoi_thuc_hien, nv_phu_trach, phu_trach_bao_tri")
                .in("id", chunk)
                .eq("trang_thai", "da_duyet")
                .order("ngay", { ascending: true })
              if (factoryId) recQ = recQ.eq("factory_id", factoryId)
              if (filterFrom) recQ = recQ.gte("ngay", filterFrom)
              if (filterTo) recQ = recQ.lte("ngay", filterTo)
              const { data: chunkRecs } = await recQ
              if (chunkRecs) recList.push(...(chunkRecs as any[]))
            }

            if (recList.length === 0) return []
            const recMap = new Map(recList.map((r) => [r.id, r]))
            const mapped: HistoryRow[] = linesData
              .filter((d) => recMap.has(d.record_id))
              .map((d) => {
                const rec = recMap.get(d.record_id)!
                return {
                  ngay: rec.ngay, ma_bb: rec.ma_bb, hang_muc: rec.hang_muc,
                  ten_tb: d.ten_tb, ma_tb: d.ma_tb, noi_dung: d.noi_dung, cac_khac_phuc: d.cac_khac_phuc,
                  chi_phi_dk: d.chi_phi_dk || 0, loai_tien: d.loai_tien || "USD", cong_tho: d.cong_tho || 0,
                  nguoi_thuc_hien: rec.nguoi_thuc_hien || [], nv_phu_trach: rec.nv_phu_trach, phu_trach_bao_tri: rec.phu_trach_bao_tri,
                }
              })
            mapped.sort((a, b) => a.ngay.localeCompare(b.ngay))
            return mapped
          }

          // Multi-device: comma-separated asset_ids
          const assetIdList = assetIdsParam ? assetIdsParam.split(",").filter(Boolean) : []

          if (assetIdList.length > 0) {
            const { data: assetsData } = await supabase
              .from("maintenance_assets")
              .select("id, ma_tb, ten_tb, bo_phan, loai, nam_sd, bien_so, mo_ta")
              .in("id", assetIdList)
              .eq("factory_id", fid)
            const assetMap = new Map(((assetsData || []) as (AssetInfo & { id: string })[]).map((a) => [a.id, a]))
            const result: { info: AssetInfo; rows: HistoryRow[] }[] = []
            for (const aid of assetIdList) {
              const info = assetMap.get(aid)
              if (!info) continue
              const rows = await fetchRowsForAsset(aid, fid)
              result.push({ info, rows })
            }
            setMultiAssets(result)
          } else if (assetId) {
            const { data: asset } = await supabase
              .from("maintenance_assets")
              .select("ma_tb, ten_tb, bo_phan, loai, nam_sd, bien_so, mo_ta")
              .eq("id", assetId)
              .eq("factory_id", fid)
              .single()
            setAssetInfo(asset as AssetInfo | null)
            const rows = await fetchRowsForAsset(assetId, fid)
            setHistoryRows(rows)
          }
        } else if (printType === "ly_lich_xe") {
          const vehicleIdList = vehicleIdsParam
            ? vehicleIdsParam.split(",").filter(Boolean)
            : vehicleId
              ? [vehicleId]
              : []
          if (vehicleIdList.length === 0) { setError("Thiếu thông tin xe"); return }

          // Helper: load full F02 data for one vehicle
          const loadOneVehicle = async (vid: string) => {
            const { data: veh } = await supabase
              .from("dispatch_vehicles")
              .select("id, code, name, vehicle_type, plate_number, factory_id")
              .eq("id", vid)
              .eq("factory_id", fid)
              .single()
            if (!veh) return null
            const v = veh as VehicleInfo

            const { data: assignments } = await supabase
              .from("dispatch_vehicle_driver_assignments")
              .select("effective_from, effective_to, note, driver_id")
              .eq("vehicle_id", vid)
              .order("effective_from", { ascending: true })
            const driverIds = ((assignments || []) as { driver_id: string }[]).map((a) => a.driver_id)
            const driverMap = new Map<string, { name: string; code: string | null }>()
            if (driverIds.length > 0) {
              const { data: driversData } = await supabase
                .from("dispatch_drivers")
                .select("id, name, code")
                .in("id", driverIds)
              for (const d of (driversData || []) as { id: string; name: string; code: string | null }[]) {
                driverMap.set(d.id, { name: d.name, code: d.code })
              }
            }
            const drivers: DriverAssignmentRow[] = ((assignments || []) as {
              effective_from: string | null; effective_to: string | null; note: string | null; driver_id: string
            }[]).map((a) => {
              const drv = driverMap.get(a.driver_id)
              return {
                driver_name: drv?.name || "—",
                driver_code: drv?.code || null,
                effective_from: a.effective_from,
                effective_to: a.effective_to,
                note: a.note,
              }
            })

            const fetchVehicleHistory = async (hangMuc: string): Promise<VehicleHistoryRow[]> => {
              const { data: linesData } = await supabase
                .from("maintenance_record_lines")
                .select("id, record_id, dispatch_vehicle_id, ten_tb, ma_tb, noi_dung, cac_khac_phuc, chi_phi_dk, loai_tien, cong_tho, km_dong_ho")
                .eq("dispatch_vehicle_id", vid)
              if (!linesData || linesData.length === 0) return []

              const recIds = [...new Set(linesData.map((l) => l.record_id))]
              const recList: {
                id: string; ma_bb: string | null; hang_muc: string; ngay: string
                nguoi_thuc_hien: string[]; nv_phu_trach: string | null; factory_id: string
              }[] = []

              for (let i = 0; i < recIds.length; i += 100) {
                const chunk = recIds.slice(i, i + 100)
                let recQ = supabase
                  .from("maintenance_records")
                  .select("id, ma_bb, hang_muc, ngay, nguoi_thuc_hien, nv_phu_trach, factory_id")
                  .in("id", chunk)
                  .eq("hang_muc", hangMuc)
                  .eq("trang_thai", "da_duyet")
                  .eq("factory_id", v.factory_id)
                  .order("ngay", { ascending: true })
                if (filterFrom) recQ = recQ.gte("ngay", filterFrom)
                if (filterTo) recQ = recQ.lte("ngay", filterTo)
                const { data: chunkRecs } = await recQ
                if (chunkRecs) recList.push(...(chunkRecs as any[]))
              }

              if (recList.length === 0) return []
              const recMap = new Map(recList.map((r) => [r.id, r]))
              return linesData
                .filter((d) => recMap.has(d.record_id))
                .map((d) => {
                  const rec = recMap.get(d.record_id)!
                  return {
                    ngay: rec.ngay, ma_bb: rec.ma_bb, hang_muc: rec.hang_muc,
                    km_dong_ho: d.km_dong_ho,
                    ten_tb: d.ten_tb, ma_tb: d.ma_tb, noi_dung: d.noi_dung, cac_khac_phuc: d.cac_khac_phuc,
                    chi_phi_dk: d.chi_phi_dk || 0, loai_tien: d.loai_tien || "USD", cong_tho: d.cong_tho || 0,
                    nguoi_thuc_hien: rec.nguoi_thuc_hien || [], nv_phu_trach: rec.nv_phu_trach,
                  }
                }).sort((a, b) => a.ngay.localeCompare(b.ngay))
            }

            const [maintRows, repairRows] = await Promise.all([
              fetchVehicleHistory("Bảo dưỡng"),
              fetchVehicleHistory("Sửa chữa"),
            ])
            return { vehicle: v, drivers, maintRows, repairRows }
          }

          if (vehicleIdList.length === 1) {
            const result = await loadOneVehicle(vehicleIdList[0])
            if (!result) { setError("Không tìm thấy xe"); return }
            setVehicleInfo(result.vehicle)
            setVehicleDrivers(result.drivers)
            setVehicleMaintRows(result.maintRows)
            setVehicleRepairRows(result.repairRows)
          } else {
            const results: typeof multiVehicles = []
            for (const vid of vehicleIdList) {
              const result = await loadOneVehicle(vid)
              if (result) results.push(result)
            }
            setMultiVehicles(results)
          }
        } else if (printType === "bao_cao_ky") {
          const boPhanList = boPhanParam ? boPhanParam.split(",").filter(Boolean) : [...BO_PHAN_LIST]
          const hangMucList = hangMucParam ? hangMucParam.split(",").filter(Boolean) : ["Sửa chữa", "Bảo dưỡng"]
          const assetIdList = assetIdsParam ? assetIdsParam.split(",").filter(Boolean) : []
          const vehicleIdList = vehicleIdsParam ? vehicleIdsParam.split(",").filter(Boolean) : []

          if (!filterFrom || !filterTo) { setError("Thiếu khoảng ngày (Từ ngày/Đến ngày)"); return }

          const { data: fRow } = await supabase
            .from("factories")
            .select("ty_gia_usd_vnd, ty_gia_usd_khr")
            .eq("id", fid)
            .maybeSingle()
          setCurrencyRates({ vnd: fRow?.ty_gia_usd_vnd, khr: fRow?.ty_gia_usd_khr })

          const { data: records } = await supabase
            .from("maintenance_records")
            .select("id, ma_bb, hang_muc, ngay, bo_phan, noi_dung_chung, cac_khac_phuc_chung")
            .eq("factory_id", fid)
            .eq("trang_thai", "da_duyet")   // luôn cố định — báo cáo theo kỳ chỉ lấy biên bản đã duyệt
            .in("bo_phan", boPhanList)
            .in("hang_muc", hangMucList)
            .gte("ngay", filterFrom)
            .lte("ngay", filterTo)
            .order("ngay", { ascending: true })

          const recList = (records || []) as {
            id: string; ma_bb: string | null; hang_muc: string; ngay: string; bo_phan: string
            noi_dung_chung: string | null; cac_khac_phuc_chung: string | null
          }[]
          const recIds = recList.map((r) => r.id)
          const recMap = new Map(recList.map((r) => [r.id, r]))

          const rawLines = recIds.length > 0
            ? (
                await supabase
                  .from("maintenance_record_lines")
                  .select("record_id, asset_id, dispatch_vehicle_id, ma_tb, noi_dung, cac_khac_phuc, chi_phi_dk, cong_tho, loai_tien, km_dong_ho")
                  .in("record_id", recIds)
              ).data
            : []

          const linesList = (rawLines || []) as {
            record_id: string; asset_id: string | null; dispatch_vehicle_id: string | null
            ma_tb: string; noi_dung: string | null; cac_khac_phuc: string | null
            chi_phi_dk: number; cong_tho: number; loai_tien: string; km_dong_ho: number | null
          }[]

          const filteredLines = linesList.filter((l) =>
            (assetIdList.length === 0 && vehicleIdList.length === 0) ||
            (!!l.asset_id && assetIdList.includes(l.asset_id)) ||
            (!!l.dispatch_vehicle_id && vehicleIdList.includes(l.dispatch_vehicle_id))
          )

          const mergeNoidung = (common: string | null | undefined, own: string | null | undefined): string =>
            [common, own].filter(Boolean).join("\n")

          const sections = new Map<string, BaoCaoKyRow[]>()
          for (const l of filteredLines) {
            const rec = recMap.get(l.record_id)
            if (!rec) continue
            // Bảo dưỡng nhiều thiết bị: nội dung riêng từng dòng có thể trống vì đã nhập ở "Nội
            // dung chung" cấp biên bản (xem .claude/rules/14-maintenance-module.md mục "Nội dung
            // chung cho Bảo dưỡng nhiều thiết bị") — phải merge vào, không chỉ đọc riêng từng dòng.
            const noiDung = rec.hang_muc === "Sửa chữa"
              ? (l.cac_khac_phuc || l.noi_dung || "—")
              : (mergeNoidung(rec.cac_khac_phuc_chung, l.cac_khac_phuc) || mergeNoidung(rec.noi_dung_chung, l.noi_dung) || "—")
            const row: BaoCaoKyRow = {
              ma_bb: rec.ma_bb,
              ma_tb: l.ma_tb,
              km_dong_ho: l.km_dong_ho,
              ngay: rec.ngay,
              noi_dung: noiDung,
              gia_tri: (l.chi_phi_dk || 0) + (l.cong_tho || 0),
              loai_tien: l.loai_tien || "USD",
              hang_muc: rec.hang_muc,
            }
            const arr = sections.get(rec.bo_phan) || []
            arr.push(row)
            sections.set(rec.bo_phan, arr)
          }

          const orderedSections: BaoCaoKySection[] = BO_PHAN_LIST
            .filter((bp) => sections.has(bp))
            .map((bp) => ({
              bo_phan: bp,
              rows: [...sections.get(bp)!].sort((a, b) => a.ngay.localeCompare(b.ngay)),
            }))
          setBaoCaoKySections(orderedSections)
        } else {
          if (!recordId) { setError("Thiếu record_id"); return }
          const { data: rec } = await supabase
            .from("maintenance_records")
            .select("*")
            .eq("id", recordId)
            .eq("factory_id", fid)
            .single()
          if (!rec) { setError("Không tìm thấy biên bản"); return }

          const { data: rawLines } = await supabase
            .from("maintenance_record_lines")
            .select("*")
            .eq("record_id", recordId)
            .order("sort_order")

          const lines: LineData[] = []
          for (const ln of rawLines || []) {
            const { data: mats } = await supabase
              .from("maintenance_materials")
              .select("*")
              .eq("line_id", ln.id)
              .order("sort_order")
            lines.push({ ...(ln as Omit<LineData, "materials">), materials: (mats || []) as MaterialRow[] })
          }
          const recordData = { ...(rec as Omit<RecordData, "lines">), lines }
          setRecord(recordData)

          // Build name → chuc_vu map for accurate role display in print templates
          const { data: staffData } = await supabase
            .from("maintenance_staff")
            .select("ten, chuc_vu")
            .eq("factory_id", (rec as { factory_id: string }).factory_id)
            .eq("active", true)
          const map = new Map<string, string>()
          for (const s of (staffData || []) as { ten: string; chuc_vu: string | null }[]) {
            if (s.ten && s.chuc_vu) map.set(s.ten, s.chuc_vu)
          }
          setStaffMap(map)
        }
      } catch {
        setError("Lỗi tải dữ liệu")
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [authFactoryId, printType, recordId, assetId, assetIdsParam, vehicleId, vehicleIdsParam, filterFrom, filterTo, boPhanParam, hangMucParam])

  const generatePdf = useCallback(async () => {
    setPdfState("generating")
    try {
      switch (printType) {
        case "su_co_nho": {
          if (!record) throw new Error("Thiếu dữ liệu biên bản")
          await downloadMaintenanceSuCoNhoPdf(record, qrUrl, staffMap)
          break
        }
        case "bao_duong": {
          if (!record) throw new Error("Thiếu dữ liệu biên bản")
          await downloadMaintenanceBaoDuongPdf(record, qrUrl, staffMap)
          break
        }
        case "bao_duong_xe": {
          if (!record) throw new Error("Thiếu dữ liệu biên bản")
          await downloadMaintenanceBaoDuongXePdf(record, qrUrl, staffMap)
          break
        }
        case "sua_chua_nho_xe": {
          if (!record) throw new Error("Thiếu dữ liệu biên bản")
          await downloadMaintenanceSuaChuaNhoXePdf(record, qrUrl, staffMap)
          break
        }
        case "ly_lich": {
          const items = multiAssets.length > 0 ? multiAssets : assetInfo ? [{ info: assetInfo, rows: historyRows }] : []
          if (items.length === 0) throw new Error("Không tìm thấy thiết bị")
          await downloadMaintenanceLyLichPdf(items, filterFrom, filterTo)
          break
        }
        case "ly_lich_xe": {
          const items = multiVehicles.length > 0
            ? multiVehicles
            : vehicleInfo
              ? [{ vehicle: vehicleInfo, drivers: vehicleDrivers, maintRows: vehicleMaintRows, repairRows: vehicleRepairRows }]
              : []
          if (items.length === 0) throw new Error("Không tìm thấy xe")
          await downloadMaintenanceLyLichXePdf(items, filterFrom, filterTo)
          break
        }
        case "bao_cao_ky": {
          if (baoCaoKySections.length === 0) { setPdfState("empty"); return }
          const { VND: rateVnd, KHR: rateKhr } = getCurrencyRates()
          await downloadMaintenanceBaoCaoKyPdf(baoCaoKySections, filterFrom, filterTo, rateVnd, rateKhr, lapBieuName)
          break
        }
        default: {
          // "su_co"/"de_nghi" đứng riêng không còn nút bấm nào trỏ tới (chỉ tồn tại lồng bên
          // trong bundle su_co_nho) — giữ fallback an toàn nếu ai đó gõ tay URL cũ.
          if (record) await downloadMaintenanceSuCoNhoPdf(record, qrUrl, staffMap)
          else throw new Error("Thiếu dữ liệu biên bản")
        }
      }
      setPdfState("done")
    } catch {
      setPdfState("error")
    }
  }, [
    printType, record, qrUrl, staffMap,
    multiAssets, assetInfo, historyRows,
    multiVehicles, vehicleInfo, vehicleDrivers, vehicleMaintRows, vehicleRepairRows,
    baoCaoKySections, lapBieuName, filterFrom, filterTo,
  ])

  // Tự động tạo PDF ngay khi dữ liệu đã sẵn sàng — khớp UX "tải trực tiếp" đã chốt (không còn
  // window.print()).
  useEffect(() => {
    if (!loading && !error && pdfState === "idle") void generatePdf()
  }, [loading, error, pdfState, generatePdf])

  const printLabel = PRINT_LABEL[printType] || "Phiếu bảo trì"

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
        <button
          onClick={() => window.close()}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-bold text-sm mb-6"
        >
          <ChevronLeft size={16} /> Đóng trang
        </button>

        <div className="font-extrabold text-lg text-slate-800 mb-1">{printLabel}</div>
        {record?.ma_bb && <div className="text-sm text-slate-500 mb-6">Biên bản {record.ma_bb}</div>}
        {!record?.ma_bb && <div className="text-sm text-slate-500 mb-6">&nbsp;</div>}

        {loading && <div className="text-sm font-bold text-slate-500">Đang tải dữ liệu...</div>}
        {!loading && error && <div className="text-sm font-bold text-red-500">{error}</div>}

        {!loading && !error && pdfState === "generating" && (
          <div className="text-sm font-bold text-slate-500">Đang tạo PDF...</div>
        )}

        {!loading && !error && pdfState === "empty" && (
          <div className="text-sm font-bold text-slate-500">
            Không có dữ liệu bảo trì đã duyệt trong kỳ đã chọn.
          </div>
        )}

        {!loading && !error && pdfState === "done" && (
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 text-emerald-600 font-bold text-sm">
              <CheckCircle2 size={18} /> Đã tải file PDF về máy
            </div>
            <button
              onClick={() => void generatePdf()}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-bold shadow-md"
            >
              <Download size={16} /> Tải lại
            </button>
          </div>
        )}

        {!loading && !error && pdfState === "error" && (
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 text-red-600 font-bold text-sm">
              <AlertTriangle size={18} /> Không tạo được PDF, thử lại?
            </div>
            <button
              onClick={() => void generatePdf()}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-bold shadow-md"
            >
              <Download size={16} /> Thử lại
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
