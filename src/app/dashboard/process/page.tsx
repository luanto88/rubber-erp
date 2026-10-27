"use client"

import { useCallback, useEffect, Fragment, useState } from "react"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from "recharts"
import { Activity, ClipboardCheck, Gauge, Thermometer } from "lucide-react"
import { getActiveFactoryId, hasPermission, type SessionUser } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import { addDaysISO, getFactoryTodayISO } from "@/lib/date-utils"
import { ProcessShell } from "./_components/process-shell"
import { FilterBar } from "@/app/dashboard/_components/filter-bar"
import { PageHeaderBanner } from "@/app/dashboard/_components/page-header-banner"
import { PageBackgroundMotif } from "@/app/dashboard/_components/page-background-motif"
import { StatCard, StatGrid } from "@/app/dashboard/_components/doc-ui/stat-card"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"

type ParamPoint = {
  ngay: string
  day_chuyen: string
  nhiet_do_dau_1: number | null
  nhiet_do_dau_2: number | null
  thoi_gian_say: number | null
}

type MeasPoint = {
  ngay: string
  day_chuyen: string | null
  chung_loai: string | null
  ket_qua: Record<string, number | null>
}

type ChartDatum = {
  label: string
  [key: string]: string | number | null
}

// Nhãn trục X "dd/mm" (thêm "/yy" khi dữ liệu trải nhiều năm). Chỉ để hiển thị — gom/sắp luôn
// theo ngày ISO, không theo nhãn (sắp chuỗi "dd/mm" sai thứ tự khi qua tháng và gộp nhầm 2 năm).
function toLabel(ngay: string, withYear = false) {
  const [y, m, d] = ngay.split("-")
  return withYear ? `${d}/${m}/${y.slice(2)}` : `${d}/${m}`
}

function groupBy<T>(arr: T[], key: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of arr) {
    const k = key(item)
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(item)
  }
  return map
}

function avg(arr: (number | null)[]): number | null {
  const valid = arr.filter((v): v is number => v != null)
  if (!valid.length) return null
  return Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10
}

const COLORS = ["#0d9488", "#2563eb", "#d97706", "#7c3aed", "#dc2626"]

export default function ProcessOverviewPage() {
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // filters
  const [filterFrom, setFilterFrom] = useState(() => addDaysISO(getFactoryTodayISO(), -30))
  const [filterTo, setFilterTo] = useState(() => getFactoryTodayISO())
  const [filterDayChuyen, setFilterDayChuyen] = useState("")
  const [filterChungLoai, setFilterChungLoai] = useState("")

  // data
  const [params, setParams] = useState<ParamPoint[]>([])
  const [measPoints, setMeasPoints] = useState<MeasPoint[]>([])

  // KPI
  const [totalSheets, setTotalSheets] = useState(0)
  const [avgPo, setAvgPo] = useState<number | null>(null)
  const [latestTemp1, setLatestTemp1] = useState<number | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadData = useCallback(async (fid: string) => {
    setLoading(true)
    setLoadError(null)
    try {
      // Process params — phân trang (PostgREST cắt 1000 dòng), sắp ổn định để "gần nhất" đúng
      const pData = await fetchAllPaginated<ParamPoint>((from, to) => {
        let pq = supabase
          .from("process_params")
          .select("ngay,day_chuyen,nhiet_do_dau_1,nhiet_do_dau_2,thoi_gian_say")
          .eq("factory_id", fid)
          .gte("ngay", filterFrom)
          .lte("ngay", filterTo)
          .order("ngay")
          .order("created_at")
          .order("id")
        if (filterDayChuyen) pq = pq.eq("day_chuyen", filterDayChuyen)
        return pq.range(from, to)
      })
      setParams(pData)
      setLatestTemp1(pData.length ? pData[pData.length - 1].nhiet_do_dau_1 : null)

      // Quick measurements + rows
      type SheetPoint = { id: string; ngay: string; day_chuyen: string | null; chung_loai: string | null; rows: { ket_qua: Record<string, number | null> | null }[] }
      const mData = await fetchAllPaginated<SheetPoint>((from, to) => {
        let mq = supabase
          .from("quick_measurements")
          .select("id,ngay,day_chuyen,chung_loai,rows:quick_measurement_rows(ket_qua)")
          .eq("factory_id", fid)
          .gte("ngay", filterFrom)
          .lte("ngay", filterTo)
          .order("ngay")
          .order("id")
        if (filterDayChuyen) mq = mq.eq("day_chuyen", filterDayChuyen)
        if (filterChungLoai) mq = mq.eq("chung_loai", filterChungLoai)
        return mq.range(from, to)
      })
      setTotalSheets(mData.length)
      // flatten rows
      const pts: MeasPoint[] = []
      const allPo: number[] = []
      for (const sheet of mData) {
        for (const row of sheet.rows || []) {
          const kq = row.ket_qua || {}
          pts.push({ ngay: sheet.ngay, day_chuyen: sheet.day_chuyen, chung_loai: sheet.chung_loai, ket_qua: kq })
          if (kq.Po != null) allPo.push(kq.Po)
        }
      }
      setMeasPoints(pts)
      setAvgPo(allPo.length ? Math.round((allPo.reduce((a, b) => a + b, 0) / allPo.length) * 10) / 10 : null)
    } catch (err) {
      // Lỗi → về trạng thái rỗng + báo lỗi, không giữ KPI/biểu đồ của lần lọc trước
      setParams([])
      setMeasPoints([])
      setTotalSheets(0)
      setAvgPo(null)
      setLatestTemp1(null)
      setLoadError((err as { message?: string } | null)?.message || "Không tải được dữ liệu")
    } finally {
      setLoading(false)
    }
  }, [filterFrom, filterTo, filterDayChuyen, filterChungLoai])

  useEffect(() => {
    const bootstrap = async () => {
      const cachedUser = JSON.parse(localStorage.getItem("erp_user") || "null") as SessionUser | null
      if (!hasPermission(cachedUser, "process.view")) {
        setLoading(false)
        window.location.replace("/dashboard")
        return
      }
      const fid = await getActiveFactoryId()
      if (!fid) { setLoading(false); return }
      setFactoryId(fid)
    }
    void bootstrap()
  }, [])

  useEffect(() => {
    if (factoryId) void loadData(factoryId)
  }, [factoryId, loadData])

  // Dữ liệu trải nhiều năm → nhãn trục X kèm năm để không nhầm 2 ngày cùng dd/mm
  const multiYear = new Set([...params, ...measPoints].map(p => p.ngay.slice(0, 4))).size > 1

  // Build temperature chart data — gom theo ngày ISO, sắp theo ngày ISO
  const tempChartData = (() => {
    const byNgay = groupBy(params, p => p.ngay)
    const dcs = [...new Set(params.map(p => p.day_chuyen))]
    const result: ChartDatum[] = []
    for (const ngay of [...byNgay.keys()].sort()) {
      const d: ChartDatum = { label: toLabel(ngay, multiYear) }
      for (const [dc, pts] of groupBy(byNgay.get(ngay)!, p => p.day_chuyen)) {
        d[`T1_${dc}`] = avg(pts.map(p => p.nhiet_do_dau_1))
        d[`T2_${dc}`] = avg(pts.map(p => p.nhiet_do_dau_2))
      }
      result.push(d)
    }
    return { data: result, dcs }
  })()

  // Build Po/Mo chart data
  const qualityChartData = (() => {
    const byNgay = groupBy(measPoints, p => p.ngay)
    const result: ChartDatum[] = []
    for (const ngay of [...byNgay.keys()].sort()) {
      const pts = byNgay.get(ngay)!
      const d: ChartDatum = { label: toLabel(ngay, multiYear) }
      d.Po = avg(pts.map(p => p.ket_qua.Po ?? null))
      d.Mo = avg(pts.map(p => (p.ket_qua.Mo !== undefined ? p.ket_qua.Mo : null)))
      result.push(d)
    }
    return result
  })()

  const fieldCls = "h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-mod-600"

  return (
    <ProcessShell
      banner={
        <>
          <PageBackgroundMotif theme="teal"/>
          <PageHeaderBanner
            title="Kiểm soát quá trình"
            subtitle="Thông số kỹ thuật sấy và đo nhanh chỉ tiêu Po/Mooney theo dây chuyền"
            theme="teal"
            icon={Gauge}
          />
        </>
      }
    >
      <FilterBar layout="grid" activeCount={[filterDayChuyen, filterChungLoai].filter(Boolean).length}>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-slate-600">Từ ngày</span>
          <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className={fieldCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-slate-600">Đến ngày</span>
          <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className={fieldCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-slate-600">Dây chuyền</span>
          <select value={filterDayChuyen} onChange={e => setFilterDayChuyen(e.target.value)} className={fieldCls}>
            <option value="">Tất cả</option>
            <option value="Mủ tạp">Mủ tạp</option>
            <option value="Mủ nước">Mủ nước</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-slate-600">Chủng loại</span>
          <select value={filterChungLoai} onChange={e => setFilterChungLoai(e.target.value)} className={fieldCls}>
            <option value="">Tất cả</option>
            <option value="Mủ tạp">Mủ tạp</option>
            <option value="Mủ nước">Mủ nước</option>
          </select>
        </label>
      </FilterBar>

      {loadError && <ListState kind="error" message={loadError} onRetry={() => factoryId && void loadData(factoryId)} />}

      <StatGrid cols={3}>
        <StatCard icon={ClipboardCheck} label="Số phiếu đo" value={totalSheets} sub="trong kỳ lọc" loading={loading} />
        <StatCard icon={Activity} label="Po trung bình" value={avgPo != null ? avgPo : "—"} sub="toàn kỳ lọc" loading={loading} />
        <StatCard
          icon={Thermometer}
          label="Nhiệt độ đầu ướt (gần nhất)"
          value={latestTemp1 != null ? `${latestTemp1}°C` : "—"}
          loading={loading}
        />
      </StatGrid>

      {/* Temperature chart */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-6">
        <h2 className="text-base font-extrabold text-slate-700 mb-4">
          Nhiệt độ theo ngày
          <span className="ml-2 text-xs font-normal text-slate-400">(đầu ướt T1 / đầu khô T2 — trung bình ngày)</span>
        </h2>
        {params.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-slate-400 text-sm">
            {loading ? "Đang tải..." : "Chưa có dữ liệu"}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={tempChartData.data} margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} unit="°C" />
              <Tooltip formatter={(v) => `${v}°C`} />
              <Legend />
              {tempChartData.dcs.map((dc, i) => (
                <Fragment key={dc}>
                  <Line
                    type="monotone"
                    dataKey={`T1_${dc}`}
                    name={`Đầu ướt – ${dc}`}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey={`T2_${dc}`}
                    name={`Đầu khô – ${dc}`}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={2}
                    strokeDasharray="4 2"
                    dot={false}
                    connectNulls
                  />
                </Fragment>
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Po / Mooney chart */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-6">
        <h2 className="text-base font-extrabold text-slate-700 mb-4">
          Po / Mooney trung bình theo ngày
        </h2>
        {measPoints.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-slate-400 text-sm">
            {loading ? "Đang tải..." : "Chưa có dữ liệu"}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={qualityChartData} margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="Po" name="Po" stroke="#0d9488" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
              <Line type="monotone" dataKey="Mo" name="Mooney" stroke="#2563eb" strokeWidth={2} strokeDasharray="5 2" dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </ProcessShell>
  )
}
