"use client"

import { useCallback, useEffect, Fragment, useState } from "react"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from "recharts"
import { Activity, ClipboardCheck, Thermometer } from "lucide-react"
import { getActiveFactoryId, hasPermission, type SessionUser } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { ProcessShell } from "./_components/process-shell"

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

function toLabel(ngay: string) {
  const [, m, d] = ngay.split("-")
  return `${d}/${m}`
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
  const today = new Date().toISOString().slice(0, 10)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const [filterFrom, setFilterFrom] = useState(thirtyDaysAgo)
  const [filterTo, setFilterTo] = useState(today)
  const [filterDayChuyen, setFilterDayChuyen] = useState("")
  const [filterChungLoai, setFilterChungLoai] = useState("")

  // data
  const [params, setParams] = useState<ParamPoint[]>([])
  const [measPoints, setMeasPoints] = useState<MeasPoint[]>([])

  // KPI
  const [totalSheets, setTotalSheets] = useState(0)
  const [avgPo, setAvgPo] = useState<number | null>(null)
  const [latestTemp1, setLatestTemp1] = useState<number | null>(null)

  const loadData = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      // Process params
      let pq = supabase
        .from("process_params")
        .select("ngay,day_chuyen,nhiet_do_dau_1,nhiet_do_dau_2,thoi_gian_say")
        .eq("factory_id", fid)
        .gte("ngay", filterFrom)
        .lte("ngay", filterTo)
        .order("ngay")
      if (filterDayChuyen) pq = pq.eq("day_chuyen", filterDayChuyen)
      const { data: pData } = await pq
      setParams((pData as ParamPoint[]) || [])

      if (pData?.length) {
        setLatestTemp1((pData[pData.length - 1] as ParamPoint).nhiet_do_dau_1)
      }

      // Quick measurements + rows
      let mq = supabase
        .from("quick_measurements")
        .select("id,ngay,day_chuyen,chung_loai,rows:quick_measurement_rows(ket_qua)")
        .eq("factory_id", fid)
        .gte("ngay", filterFrom)
        .lte("ngay", filterTo)
        .order("ngay")
      if (filterDayChuyen) mq = mq.eq("day_chuyen", filterDayChuyen)
      if (filterChungLoai) mq = mq.eq("chung_loai", filterChungLoai)

      const { data: mData } = await mq
      if (mData) {
        setTotalSheets(mData.length)
        // flatten rows
        const pts: MeasPoint[] = []
        const allPo: number[] = []
        for (const sheet of mData as { id: string; ngay: string; day_chuyen: string | null; chung_loai: string | null; rows: { ket_qua: Record<string, number | null> }[] }[]) {
          for (const row of sheet.rows || []) {
            const kq = row.ket_qua as Record<string, number | null>
            pts.push({ ngay: sheet.ngay, day_chuyen: sheet.day_chuyen, chung_loai: sheet.chung_loai, ket_qua: kq })
            if (kq.Po != null) allPo.push(kq.Po)
          }
        }
        setMeasPoints(pts)
        setAvgPo(allPo.length ? Math.round((allPo.reduce((a, b) => a + b, 0) / allPo.length) * 10) / 10 : null)
      }
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

  // Build temperature chart data
  const tempChartData = (() => {
    const byNgayDC = groupBy(params, p => `${p.ngay}|${p.day_chuyen}`)
    const result: ChartDatum[] = []
    const datesSeen = new Set<string>()
    const dcs = [...new Set(params.map(p => p.day_chuyen))]

    for (const [key, pts] of byNgayDC) {
      const [ngay, dc] = key.split("|")
      if (!datesSeen.has(ngay)) datesSeen.add(ngay)
      const existing = result.find(r => r.label === toLabel(ngay))
      if (existing) {
        existing[`T1_${dc}`] = avg(pts.map(p => p.nhiet_do_dau_1))
        existing[`T2_${dc}`] = avg(pts.map(p => p.nhiet_do_dau_2))
      } else {
        const d: ChartDatum = { label: toLabel(ngay) }
        d[`T1_${dc}`] = avg(pts.map(p => p.nhiet_do_dau_1))
        d[`T2_${dc}`] = avg(pts.map(p => p.nhiet_do_dau_2))
        result.push(d)
      }
    }
    result.sort((a, b) => (a.label > b.label ? 1 : -1))
    return { data: result, dcs }
  })()

  // Build Po/Mo chart data
  const qualityChartData = (() => {
    const byNgay = groupBy(measPoints, p => p.ngay)
    const result: ChartDatum[] = []
    for (const [ngay, pts] of byNgay) {
      const d: ChartDatum = { label: toLabel(ngay) }
      d.Po = avg(pts.map(p => p.ket_qua.Po ?? null))
      d.Mo = avg(pts.map(p => (p.ket_qua.Mo !== undefined ? p.ket_qua.Mo : null)))
      result.push(d)
    }
    result.sort((a, b) => (a.label > b.label ? 1 : -1))
    return result
  })()

  return (
    <ProcessShell>
      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-center">
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
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Chủng loại</label>
          <select value={filterChungLoai} onChange={e => setFilterChungLoai(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500">
            <option value="">Tất cả</option>
            <option value="Mủ tạp">Mủ tạp</option>
            <option value="Mủ nước">Mủ nước</option>
          </select>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-center gap-4">
          <div className="p-3 bg-teal-50 rounded-xl">
            <ClipboardCheck size={22} className="text-teal-600" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-500">Số phiếu đo</div>
            <div className="text-2xl font-extrabold text-slate-800">{loading ? "…" : totalSheets}</div>
            <div className="text-xs text-slate-400">trong kỳ lọc</div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-center gap-4">
          <div className="p-3 bg-blue-50 rounded-xl">
            <Activity size={22} className="text-blue-600" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-500">Po trung bình</div>
            <div className="text-2xl font-extrabold text-slate-800">
              {loading ? "…" : avgPo != null ? avgPo : "—"}
            </div>
            <div className="text-xs text-slate-400">toàn kỳ lọc</div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-center gap-4">
          <div className="p-3 bg-orange-50 rounded-xl">
            <Thermometer size={22} className="text-orange-600" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-500">Nhiệt độ đầu ướt (gần nhất)</div>
            <div className="text-2xl font-extrabold text-slate-800">
              {loading ? "…" : latestTemp1 != null ? `${latestTemp1}°C` : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Temperature chart */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
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
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
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
