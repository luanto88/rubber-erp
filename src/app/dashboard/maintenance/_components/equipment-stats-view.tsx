"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Activity, CalendarClock, CalendarRange, ExternalLink, Gauge, Timer, Wrench } from "lucide-react"
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { authFetch } from "@/lib/auth-fetch"
import { currencySymbol } from "@/lib/currency"
import {
  computeStats,
  formatTons,
  kindHasHours,
  type EquipmentStatsResponse,
  type StatsCycle,
  type StatsOccasion,
} from "@/lib/equipment-stats"
import { StatCard, StatGrid } from "@/app/dashboard/_components/doc-ui/stat-card"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"

// GĐ3b — thống kê chu kỳ sửa chữa / bảo dưỡng của 1 thiết bị hoặc xe (docs/qr-equipment-plan.md).
// Dùng ở tab "Thống kê" trang QR `/tb/<token>` và khối thống kê trang Lý lịch.
// API trả biên bản + sản lượng theo ngày; chu kỳ tính ở client bằng hàm thuần `computeStats`
// (đổi kỳ / lọc vật tư không phải gọi lại API).

type Period = "range" | "6m" | "12m" | "all"

const BAR_DAYS = "#2f5d52" // brand-600
const BAR_OUTPUT = "#3f7f6f"
const REF_LINE = "#b45309"

function formatDateVN(iso: string | null | undefined, short = false) {
  if (!iso) return "—"
  const [y, m, d] = iso.slice(0, 10).split("-")
  if (!y || !m || !d) return iso
  return short ? `${d}/${m}/${y.slice(2)}` : `${d}/${m}/${y}`
}

function monthsAgo(today: string, months: number) {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() - months)
  return d.toISOString().slice(0, 10)
}

function fmtNum(n: number, digits = 1) {
  return n.toLocaleString("vi-VN", { maximumFractionDigits: digits })
}

function RecordLinks({ occ, canOpenModule }: { occ: StatsOccasion; canOpenModule: boolean }) {
  return (
    <span className="flex flex-wrap gap-x-2">
      {occ.events.map((e) =>
        canOpenModule ? (
          <Link
            key={e.record_id}
            href={`/dashboard/maintenance/records/${e.record_id}`}
            className="inline-flex items-center gap-0.5 font-code text-xs font-semibold text-brand-600 hover:underline"
          >
            {e.ma_bb || "Biên bản"} <ExternalLink size={11} />
          </Link>
        ) : (
          <span key={e.record_id} className="font-code text-xs text-slate-500">
            {e.ma_bb || "Biên bản"}
          </span>
        ),
      )}
    </span>
  )
}

function CycleTooltip({
  active,
  payload,
  unit,
}: {
  active?: boolean
  payload?: { payload: { c: StatsCycle } }[]
  unit: "days" | "tons"
}) {
  if (!active || !payload?.length) return null
  const c = payload[0].payload.c
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-bold text-slate-900">
        {formatDateVN(c.from.ngay)} → {formatDateVN(c.to.ngay)}
      </p>
      <p className="text-slate-700">{c.days} ngày</p>
      {c.output != null && (
        <p className="text-slate-700">
          {formatTons(c.output)}
          {c.days > 0 ? ` · ${fmtNum(c.output / 1000 / (c.days + 1), 2)} tấn/ngày` : ""}
        </p>
      )}
      {c.hours != null && <p className="text-slate-700">{fmtNum(c.hours)} giờ</p>}
      {c.to.material_names.length > 0 && (
        <p className="max-w-[16rem] text-slate-500">Thay: {c.to.material_names.join("; ")}</p>
      )}
      {unit === "tons" && <p className="mt-1 text-[10px] text-slate-400">Tính cả ngày đầu và ngày cuối</p>}
    </div>
  )
}

function CycleChart({
  cycles,
  avgDays,
  mode,
  title,
}: {
  cycles: StatsCycle[]
  avgDays: number | null
  mode: "days" | "tons"
  title: string
}) {
  const data = cycles.map((c, i) => ({
    key: `${i}`,
    label: formatDateVN(c.to.ngay, true),
    value: mode === "days" ? c.days : Math.round(((c.output ?? 0) / 1000) * 1000) / 1000,
    c,
  }))
  return (
    <figure className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-2 px-1">
        <span className="text-sm font-bold text-slate-900">{title}</span>
        {mode === "days" && avgDays != null && (
          <span className="text-xs font-semibold text-amber-700">— TB {fmtNum(avgDays)} ngày</span>
        )}
      </figcaption>
      <div className="h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke="#e2e8f0" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "#64748b" }}
              tickLine={false}
              axisLine={{ stroke: "#cbd5e1" }}
              interval="preserveStartEnd"
              minTickGap={8}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#64748b" }}
              tickLine={false}
              axisLine={false}
              width={44}
              allowDecimals={mode === "tons"}
            />
            <Tooltip cursor={{ fill: "rgba(47,93,82,0.08)" }} content={<CycleTooltip unit={mode} />} />
            {mode === "days" && avgDays != null && (
              <ReferenceLine y={avgDays} stroke={REF_LINE} strokeDasharray="5 4" strokeWidth={2} ifOverflow="extendDomain" />
            )}
            <Bar
              dataKey="value"
              fill={mode === "days" ? BAR_DAYS : BAR_OUTPUT}
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="px-1 text-[11px] text-slate-400">
        Mỗi cột là 1 chu kỳ, nhãn dưới cột là ngày kết thúc chu kỳ. Chạm vào cột để xem chi tiết.
      </p>
    </figure>
  )
}

export function EquipmentStatsView({
  fetchUrl,
  canOpenModule,
  range,
}: {
  fetchUrl: string
  canOpenModule: boolean
  /** Khoảng ngày của trang Lý lịch (Từ–Đến). Có ít nhất 1 ngày ⇒ thêm kỳ "Theo ngày đã chọn" và chọn sẵn. */
  range?: { from: string | null; to: string | null }
}) {
  const rangeFrom = range?.from || null
  const rangeTo = range?.to || null
  const hasRange = !!(rangeFrom || rangeTo)
  const [data, setData] = useState<EquipmentStatsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<Period>(hasRange ? "range" : "12m")
  // Đổi ngày ở trang ⇒ quay về kỳ "Theo ngày đã chọn"; xoá hết ngày ⇒ về 12 tháng.
  const rangeKey = hasRange ? `${rangeFrom || ""}|${rangeTo || ""}` : ""
  const [lastRangeKey, setLastRangeKey] = useState(rangeKey)
  if (rangeKey !== lastRangeKey) {
    setLastRangeKey(rangeKey)
    setPeriod(rangeKey ? "range" : "12m")
  }
  const [materialKey, setMaterialKey] = useState("")
  const seq = useRef(0)

  const load = useCallback(async () => {
    const my = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const res = await authFetch(fetchUrl, { cache: "no-store" })
      const json = (await res.json().catch(() => ({}))) as EquipmentStatsResponse & { error?: string }
      if (my !== seq.current) return
      if (!res.ok) {
        setError(json.error || "Không tải được thống kê.")
        return
      }
      setData(json)
      setMaterialKey("")
    } catch {
      if (my === seq.current) setError("Mất kết nối. Vui lòng thử lại.")
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [fetchUrl])

  useEffect(() => {
    void load()
  }, [load])

  const since = useMemo(() => {
    if (!data || period === "all") return null
    if (period === "range") return rangeFrom
    return monthsAgo(data.today, period === "6m" ? 6 : 12)
  }, [data, period, rangeFrom])
  const until = period === "range" ? rangeTo : null

  const repair = useMemo(() => {
    if (!data) return null
    return computeStats(
      data.events.filter((e) => e.hang_muc === "Sửa chữa"),
      { kind: data.kind, daily: data.daily, today: data.today, since, until, materialKey: materialKey || null, withOutput: true },
    )
  }, [data, since, until, materialKey])

  const maint = useMemo(() => {
    if (!data) return null
    return computeStats(
      data.events.filter((e) => e.hang_muc === "Bảo dưỡng"),
      { kind: data.kind, daily: [], today: data.today, since, until, withOutput: false },
    )
  }, [data, since, until])

  if (loading && !data) return <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white" />
  if (error && !data) {
    return (
      <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-center">
        <p className="text-[15px] font-semibold text-red-700">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl border border-red-300 bg-white px-4 text-sm font-bold text-red-700"
        >
          Thử lại
        </button>
      </section>
    )
  }
  if (!data || !repair || !maint) return null

  const hasOutput = data.outputLabel != null
  const hasHours = kindHasHours(data.kind)
  const showHoursCol = hasHours && repair.cycles.some((c) => c.hours != null)
  const pendingCount = repair.occasions.filter((o) => o.pending).length
  const cyclesNewestFirst = [...repair.cycles].reverse()

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedTabs<Period>
          ariaLabel="Kỳ thống kê"
          value={period}
          onChange={setPeriod}
          items={[
            ...(hasRange
              ? [
                  {
                    key: "range" as const,
                    label: `Theo ngày đã chọn (${rangeFrom ? formatDateVN(rangeFrom, true) : "…"} – ${rangeTo ? formatDateVN(rangeTo, true) : "nay"})`,
                  },
                ]
              : []),
            { key: "6m", label: "6 tháng" },
            { key: "12m", label: "12 tháng" },
            { key: "all", label: "Tất cả" },
          ]}
        />
        {data.materials.length > 0 && (
          <label className="flex min-w-0 items-center gap-2 text-sm text-slate-600">
            <span className="shrink-0 font-semibold">Theo vật tư</span>
            <select
              value={materialKey}
              onChange={(e) => setMaterialKey(e.target.value)}
              className="h-10 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-mod-600 focus:outline-none sm:w-64 sm:flex-none"
            >
              <option value="">Mọi lần sửa chữa</option>
              {data.materials.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name} (×{m.times})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <h3 className="flex items-center gap-2 text-base font-extrabold text-slate-900">
        <Wrench size={18} className="text-mod-600" /> Sửa chữa
        {materialKey && (
          <span className="text-sm font-semibold text-slate-500">
            — chỉ các lần thay {data.materials.find((m) => m.key === materialKey)?.name}
          </span>
        )}
      </h3>

      <StatGrid cols={4}>
        <StatCard
          icon={Timer}
          label="TB giữa 2 lần sửa"
          value={repair.avgDays != null ? `${fmtNum(repair.avgDays)} ngày` : "—"}
          sub={
            repair.avgDays == null
              ? "Cần ít nhất 2 lần sửa"
              : repair.reliable
                ? `${repair.cycles.length} chu kỳ`
                : "Chỉ 1 chu kỳ — chưa đủ để coi là trung bình"
          }
        />
        <StatCard icon={Activity} label="Số lần sửa trong kỳ" value={repair.occasions.length} sub={pendingCount ? `${pendingCount} lần còn chờ duyệt` : undefined} />
        <StatCard
          icon={CalendarClock}
          label="Đang chạy"
          value={repair.open ? `${repair.open.days} ngày` : "—"}
          sub={
            repair.open
              ? `từ ${formatDateVN(repair.open.from.ngay)}${repair.open.output != null ? ` · ${formatTons(repair.open.output)}` : ""}`
              : until && until < data.today
                ? `Khoảng ngày đã chọn kết thúc ${formatDateVN(until)}`
                : undefined
          }
        />
        {hasOutput ? (
          <StatCard
            icon={Gauge}
            label="TB sản lượng / chu kỳ"
            value={repair.avgOutput != null ? formatTons(repair.avgOutput) : "—"}
            sub={repair.cycles.length === 1 ? `1 chu kỳ · ${data.outputLabel}` : data.outputLabel || undefined}
          />
        ) : (
          <StatCard
            icon={CalendarRange}
            label="Dự kiến lần sau"
            value={repair.nextExpected ? formatDateVN(repair.nextExpected) : "—"}
            sub={repair.nextExpected ? "Tham khảo theo trung bình" : "Cần ≥ 3 lần sửa để dự kiến"}
          />
        )}
      </StatGrid>

      {repair.cycles.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-[15px] text-slate-500">
          {repair.occasions.length === 0
            ? "Không có lần sửa chữa nào trong kỳ đã chọn."
            : "Mới có 1 lần sửa chữa trong kỳ — cần ít nhất 2 lần để tính chu kỳ."}
        </p>
      ) : (
        <>
          <div className={`grid gap-3 ${hasOutput ? "lg:grid-cols-2" : ""}`}>
            <CycleChart cycles={repair.cycles} avgDays={repair.avgDays} mode="days" title="Số ngày giữa 2 lần sửa" />
            {hasOutput && (
              <CycleChart cycles={repair.cycles} avgDays={null} mode="tons" title={`Tấn trong chu kỳ — ${data.outputLabel}`} />
            )}
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="enterprise-table dense min-w-[720px]">
              <thead>
                <tr>
                  <th>Từ</th>
                  <th>Đến</th>
                  <th className="text-right">Số ngày</th>
                  {hasOutput && <th className="text-right">Sản lượng</th>}
                  {hasOutput && <th className="text-right">Tấn/ngày</th>}
                  {showHoursCol && <th className="text-right">Giờ máy</th>}
                  <th>Vật tư thay (lần sau)</th>
                  <th>Biên bản</th>
                </tr>
              </thead>
              <tbody>
                {cyclesNewestFirst.map((c, i) => {
                  const days = c.days + 1
                  return (
                    <tr key={`${c.from.ngay}-${c.to.ngay}-${i}`}>
                      <td className="whitespace-nowrap">{formatDateVN(c.from.ngay)}</td>
                      <td className="whitespace-nowrap">
                        {formatDateVN(c.to.ngay)}
                        {c.to.pending && (
                          <span className="ml-1 align-middle">
                            <StatusBadge domain="maintenance" status="cho_duyet" size="xs" />
                          </span>
                        )}
                      </td>
                      <td className="text-right tabular-nums">{c.days}</td>
                      {hasOutput && <td className="text-right tabular-nums">{formatTons(c.output)}</td>}
                      {hasOutput && (
                        <td className="text-right tabular-nums">
                          {c.output != null ? fmtNum(c.output / 1000 / days, 2) : "—"}
                        </td>
                      )}
                      {showHoursCol && <td className="text-right tabular-nums">{c.hours != null ? fmtNum(c.hours) : "—"}</td>}
                      <td className="max-w-[16rem] text-xs text-slate-600">{c.to.material_names.join("; ") || "—"}</td>
                      <td>
                        <RecordLinks occ={c.to} canOpenModule={canOpenModule} />
                        {data.canSeeCost &&
                          c.to.events.some((e) => e.costs && e.costs.length > 0) && (
                            <span className="block text-[11px] text-slate-500">
                              {c.to.events
                                .flatMap((e) => e.costs || [])
                                .map((x) => `${fmtNum(x.amount, 2)} ${currencySymbol(x.loai_tien)}`)
                                .join(" + ")}
                            </span>
                          )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            Chu kỳ tính giữa 2 lần Sửa chữa liên tiếp (cả Lớn và Nhỏ, cả biên bản chưa duyệt; nhiều biên bản cùng ngày
            = 1 lần).
            {hasOutput && " Sản lượng tính CẢ ngày đầu và ngày cuối nên ngày sửa thuộc cả 2 chu kỳ liền kề — số liệu mang tính tương đối."}
            {(data.kind === "tp_mu_tap" || data.kind === "tp_mu_nuoc" || data.kind === "xe_xuc") &&
              " Đây là sản lượng của cả nhà máy trong kỳ, không riêng thiết bị này."}
            {hasHours && " Giờ máy chỉ hiện khi cả biên bản đầu và cuối chu kỳ đều ghi số đồng hồ."}
          </p>
        </>
      )}

      <h3 className="flex items-center gap-2 pt-2 text-base font-extrabold text-slate-900">
        <CalendarRange size={18} className="text-mod-600" /> Bảo dưỡng
      </h3>
      {maint.occasions.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-4 text-center text-sm text-slate-500">
          Không có lần bảo dưỡng nào trong kỳ đã chọn.
        </p>
      ) : (
        <>
          <StatGrid cols={4}>
            <StatCard
              icon={Timer}
              label="TB giữa 2 lần bảo dưỡng"
              value={maint.avgDays != null ? `${fmtNum(maint.avgDays)} ngày` : "—"}
              sub={
                maint.avgDays == null
                  ? "Cần ít nhất 2 lần bảo dưỡng"
                  : maint.reliable
                    ? `${maint.cycles.length} chu kỳ`
                    : "Chỉ 1 chu kỳ — chưa đủ để coi là trung bình"
              }
            />
            <StatCard icon={Activity} label="Số lần bảo dưỡng" value={maint.occasions.length} />
            <StatCard
              icon={CalendarClock}
              label="Từ lần gần nhất"
              value={maint.open ? `${maint.open.days} ngày` : "—"}
              sub={
                maint.open
                  ? formatDateVN(maint.open.from.ngay)
                  : until && until < data.today
                    ? `Khoảng ngày đã chọn kết thúc ${formatDateVN(until)}`
                    : undefined
              }
            />
            <StatCard
              icon={CalendarRange}
              label="Dự kiến lần sau"
              value={maint.nextExpected ? formatDateVN(maint.nextExpected) : "—"}
              sub={maint.nextExpected ? "Tham khảo theo trung bình" : "Cần ≥ 3 lần bảo dưỡng để dự kiến"}
              valueTone={maint.nextExpected && maint.nextExpected < data.today ? "warn" : "default"}
            />
          </StatGrid>
          {maint.cycles.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white text-sm shadow-sm">
              {[...maint.cycles].reverse().map((c, i) => (
                <li key={`${c.from.ngay}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                  <span className="text-slate-700">
                    {formatDateVN(c.from.ngay)} → {formatDateVN(c.to.ngay)}
                  </span>
                  <span className="flex items-center gap-3">
                    <b className="tabular-nums text-slate-900">{c.days} ngày</b>
                    <RecordLinks occ={c.to} canOpenModule={canOpenModule} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
