"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowDown, ArrowUp, ChevronRight } from "lucide-react"
import { authFetch } from "@/lib/auth-fetch"
import { currencySymbol } from "@/lib/currency"
import { computeStats, formatTons, type EquipmentStatsResponse } from "@/lib/equipment-stats"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"

// Bảng tóm tắt thống kê chu kỳ cho NHIỀU thiết bị / xe ở trang Lý lịch (2026-11-07).
// Gọi lại API thống kê 1-thiết-bị cho từng mục (4 song song, tối đa SUMMARY_MAX) và tính bằng chính
// `computeStats` mà khối thống kê chi tiết dùng ⇒ số liệu 2 nơi không lệch nhau.

export type StatsSummaryTarget = { id: string; kind: "asset" | "vehicle"; code: string; name: string }

export const SUMMARY_MAX = 50
const CONCURRENCY = 4

type Period = "range" | "6m" | "12m" | "all"
type SortKey = "code" | "repairs" | "avgDays" | "sinceLast" | "nextExpected" | "avgOutput" | "maints"
type Loaded = { data?: EquipmentStatsResponse; error?: string }

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
function urlFor(kind: StatsSummaryTarget["kind"], id: string) {
  return `/api/equipment/stats?${kind === "vehicle" ? "vehicle_id" : "asset_id"}=${id}`
}

export function EquipmentStatsSummary({
  targets,
  range,
  onSelect,
}: {
  targets: StatsSummaryTarget[]
  range?: { from: string | null; to: string | null }
  /** Bấm 1 dòng ⇒ mở thống kê chi tiết của thiết bị đó. */
  onSelect: (t: StatsSummaryTarget) => void
}) {
  const list = useMemo(() => targets.slice(0, SUMMARY_MAX), [targets])
  const listKey = list.map((t) => `${t.kind}:${t.id}`).join(",")
  const rangeFrom = range?.from || null
  const rangeTo = range?.to || null
  const hasRange = !!(rangeFrom || rangeTo)
  const [period, setPeriod] = useState<Period>(hasRange ? "range" : "12m")
  const rangeKey = hasRange ? `${rangeFrom || ""}|${rangeTo || ""}` : ""
  const [lastRangeKey, setLastRangeKey] = useState(rangeKey)
  if (rangeKey !== lastRangeKey) {
    setLastRangeKey(rangeKey)
    setPeriod(rangeKey ? "range" : "12m")
  }
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({})
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "avgDays", asc: true })
  const seq = useRef(0)

  // Tải tuần tự theo nhóm CONCURRENCY; đổi danh sách ⇒ bỏ kết quả lượt cũ.
  useEffect(() => {
    const my = ++seq.current
    const items = listKey ? listKey.split(",") : []
    const queue = [...items]
    let cancelled = false
    const worker = async () => {
      for (let key = queue.shift(); key; key = queue.shift()) {
        const [kind, id] = key.split(":") as [StatsSummaryTarget["kind"], string]
        let entry: Loaded
        try {
          const res = await authFetch(urlFor(kind, id), { cache: "no-store" })
          const json = (await res.json().catch(() => ({}))) as EquipmentStatsResponse & { error?: string }
          entry = res.ok ? { data: json } : { error: json.error || "Không tải được" }
        } catch {
          entry = { error: "Mất kết nối" }
        }
        if (cancelled || my !== seq.current) return
        setLoaded((prev) => ({ ...prev, [key]: entry }))
      }
    }
    // Reset kết quả khi danh sách đổi (chạy trong microtask để không setState đồng bộ trong effect).
    void Promise.resolve().then(() => {
      if (my !== seq.current) return
      setLoaded((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => items.includes(k))))
      for (let i = 0; i < Math.min(CONCURRENCY, items.length); i++) void worker()
    })
    return () => {
      cancelled = true
    }
  }, [listKey])

  const doneCount = list.filter((t) => loaded[`${t.kind}:${t.id}`]).length

  const rows = useMemo(() => {
    return list.map((t) => {
      const entry = loaded[`${t.kind}:${t.id}`]
      const data = entry?.data
      if (!data) return { t, entry, data: null as null, repair: null, maint: null, costs: [] as string[] }
      const since = period === "all" ? null : period === "range" ? rangeFrom : monthsAgo(data.today, period === "6m" ? 6 : 12)
      const until = period === "range" ? rangeTo : null
      const repairEvents = data.events.filter((e) => e.hang_muc === "Sửa chữa")
      const repair = computeStats(repairEvents, {
        kind: data.kind, daily: data.daily, today: data.today, since, until, withOutput: true,
      })
      const maint = computeStats(data.events.filter((e) => e.hang_muc === "Bảo dưỡng"), {
        kind: data.kind, daily: [], today: data.today, since, until, withOutput: false,
      })
      // Chi phí sửa chữa trong kỳ (chỉ khi được xem giá) — cộng theo từng loại tiền.
      const byCur = new Map<string, number>()
      if (data.canSeeCost) {
        for (const occ of repair.occasions) {
          for (const e of occ.events) {
            for (const c of e.costs || []) byCur.set(c.loai_tien, (byCur.get(c.loai_tien) || 0) + c.amount)
          }
        }
      }
      const costs = [...byCur.entries()]
        .filter(([, v]) => v > 0)
        .map(([cur, v]) => `${currencySymbol(cur)}${fmtNum(v, 2)}`)
      return { t, entry, data, repair, maint, costs }
    })
  }, [list, loaded, period, rangeFrom, rangeTo])

  const anyCost = rows.some((r) => r.data?.canSeeCost)
  const anyOutput = rows.some((r) => r.data?.outputLabel != null)

  const sorted = useMemo(() => {
    const val = (r: (typeof rows)[number]): number | string | null => {
      switch (sort.key) {
        case "code": return r.t.code
        case "repairs": return r.repair ? r.repair.occasions.length : null
        case "avgDays": return r.repair?.avgDays ?? null
        case "sinceLast": return r.repair?.open?.days ?? null
        case "nextExpected": return r.repair?.nextExpected ?? null
        case "avgOutput": return r.repair?.avgOutput ?? null
        case "maints": return r.maint ? r.maint.occasions.length : null
      }
    }
    return [...rows].sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      // Không có số liệu luôn nằm cuối, bất kể chiều sắp.
      if (va == null && vb == null) return a.t.code.localeCompare(b.t.code, "vi", { numeric: true })
      if (va == null) return 1
      if (vb == null) return -1
      const cmp = typeof va === "string" ? va.localeCompare(String(vb), "vi", { numeric: true }) : va - (vb as number)
      return sort.asc ? cmp : -cmp
    })
  }, [rows, sort])

  const th = (key: SortKey, label: string, right = false) => (
    <th className={right ? "text-right" : undefined}>
      <button
        type="button"
        onClick={() => setSort((s) => (s.key === key ? { key, asc: !s.asc } : { key, asc: true }))}
        className={`inline-flex items-center gap-1 font-bold hover:text-mod-800 ${sort.key === key ? "text-mod-800" : ""}`}
      >
        {label}
        {sort.key === key && (sort.asc ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  )

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedTabs<Period>
          ariaLabel="Kỳ thống kê"
          value={period}
          onChange={setPeriod}
          items={[
            ...(hasRange
              ? [{
                  key: "range" as const,
                  label: `Theo ngày đã chọn (${rangeFrom ? formatDateVN(rangeFrom, true) : "…"} – ${rangeTo ? formatDateVN(rangeTo, true) : "nay"})`,
                }]
              : []),
            { key: "6m", label: "6 tháng" },
            { key: "12m", label: "12 tháng" },
            { key: "all", label: "Tất cả" },
          ]}
        />
        <span className="text-xs text-slate-500">
          {doneCount < list.length ? `Đang tải ${doneCount}/${list.length}…` : `${list.length} thiết bị`}
          {targets.length > SUMMARY_MAX && ` · chỉ tóm tắt ${SUMMARY_MAX} mục đầu`}
        </span>
      </div>
      {doneCount < list.length && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-mod-600 transition-all" style={{ width: `${(doneCount / Math.max(1, list.length)) * 100}%` }} />
        </div>
      )}

      <ResponsiveTableWrapper>
        <table className="enterprise-table dense min-w-[980px]">
          <thead>
            <tr>
              {th("code", "Thiết bị / xe")}
              {th("repairs", "Lần sửa", true)}
              {th("avgDays", "TB ngày giữa 2 lần sửa", true)}
              <th>Sửa gần nhất</th>
              {th("sinceLast", "Từ lần gần nhất", true)}
              {th("nextExpected", "Dự kiến lần tới")}
              {anyOutput && th("avgOutput", "TB sản lượng / chu kỳ", true)}
              {th("maints", "Lần bảo dưỡng", true)}
              <th className="text-right">TB ngày bảo dưỡng</th>
              {anyCost && <th className="text-right">Chi phí sửa chữa</th>}
              <th aria-label="Mở chi tiết" />
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ t, entry, data, repair, maint, costs }) => {
              const key = `${t.kind}:${t.id}`
              const last = repair?.occasions[repair.occasions.length - 1]
              const overdue = !!(repair?.nextExpected && data && repair.nextExpected < data.today)
              return (
                <tr key={key} className="cursor-pointer hover:bg-mod-50" onClick={() => onSelect(t)}>
                  <td>
                    <div className="font-code text-xs font-semibold text-slate-800">{t.code}</div>
                    <div className="text-xs text-slate-500">{t.name}</div>
                  </td>
                  {!entry ? (
                    <td colSpan={7 + (anyOutput ? 1 : 0) + (anyCost ? 1 : 0)} className="text-xs text-slate-400">
                      Đang tải…
                    </td>
                  ) : entry.error || !repair || !maint ? (
                    <td colSpan={7 + (anyOutput ? 1 : 0) + (anyCost ? 1 : 0)} className="text-xs text-red-600">
                      {entry.error || "Không tải được"}
                    </td>
                  ) : (
                    <>
                      <td className="text-right">{repair.occasions.length}</td>
                      <td className="text-right font-semibold">
                        {repair.avgDays != null ? `${fmtNum(repair.avgDays)} ngày` : "—"}
                        {repair.avgDays != null && !repair.reliable && (
                          <span className="block text-[10px] font-normal text-slate-400">ít dữ liệu</span>
                        )}
                      </td>
                      <td>{formatDateVN(last?.ngay)}</td>
                      <td className="text-right">{repair.open ? `${repair.open.days} ngày` : "—"}</td>
                      <td className={overdue ? "font-semibold text-red-600" : undefined}>
                        {formatDateVN(repair.nextExpected)}
                        {overdue && <span className="block text-[10px] font-normal">đã quá</span>}
                      </td>
                      {anyOutput && (
                        <td className="text-right">{data?.outputLabel ? formatTons(repair.avgOutput) : "—"}</td>
                      )}
                      <td className="text-right">{maint.occasions.length}</td>
                      <td className="text-right">{maint.avgDays != null ? `${fmtNum(maint.avgDays)} ngày` : "—"}</td>
                      {anyCost && <td className="text-right">{data?.canSeeCost ? costs.join(" · ") || "—" : "—"}</td>}
                    </>
                  )}
                  <td className="text-right text-slate-400">
                    <ChevronRight size={16} className="inline" />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </ResponsiveTableWrapper>
      <p className="text-[11px] text-slate-400">
        Chu kỳ sửa chữa = giữa 2 lần Sửa chữa liên tiếp (gồm cả biên bản chờ duyệt). &quot;Ít dữ liệu&quot; = dưới 3 lần
        sửa. Sản lượng tính cả ngày đầu và ngày cuối mỗi chu kỳ. Bấm 1 dòng để xem biểu đồ chi tiết.
      </p>
    </section>
  )
}
