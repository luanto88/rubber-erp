"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ChevronDown, ExternalLink, Package, Search, X } from "lucide-react"
import { authFetch } from "@/lib/auth-fetch"
import { currencySymbol } from "@/lib/currency"
import {
  normalizeMaterialName,
  type EquipmentMaterialGroup,
  type EquipmentMaterialSort,
  type EquipmentMaterialsResponse,
} from "@/lib/equipment-qr"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { FilterChips } from "./equipment-tab-ui"

// Tab "Vật tư" của trang QR thiết bị `/tb/<token>` (GĐ2, docs/qr-equipment-plan.md).
// Gom vật tư đã thay theo mã kho / tên chuẩn hoá; API tự kiểm quyền + lọc giá.

type HangMuc = "all" | "Sửa chữa" | "Bảo dưỡng"

const NGUON_LABEL: Record<string, string> = {
  trong_kho: "Trong kho",
  ben_ngoai: "Mua ngoài",
  gia_cong: "Gia công ngoài",
}

const MIN_COUNT_OPTIONS = [1, 2, 3, 5]

function formatDateVN(iso: string | null) {
  if (!iso) return "—"
  const [y, m, d] = iso.slice(0, 10).split("-")
  return y && m && d ? `${d}/${m}/${y}` : iso
}

function formatNumber(n: number) {
  return n.toLocaleString("vi-VN", { maximumFractionDigits: 2 })
}

function formatMoney(value: number | null | undefined, loaiTien: string | null | undefined) {
  if (value == null) return "—"
  return `${formatNumber(Number(value))} ${currencySymbol(loaiTien || "USD")}`
}

function groupMatches(g: EquipmentMaterialGroup, qNorm: string) {
  if (!qNorm) return true
  return [g.name, g.item_code || "", ...g.names].some((t) => normalizeMaterialName(t).includes(qNorm))
}

function GroupCard({
  g,
  canSeeCost,
  canOpenModule,
}: {
  g: EquipmentMaterialGroup
  canSeeCost: boolean
  canOpenModule: boolean
}) {
  const [open, setOpen] = useState(false)
  const totals = g.totals.map((t) => `${formatNumber(t.so_luong)} ${t.dvt || "(không ghi ĐVT)"}`).join(" + ")
  const otherNames = g.names.filter((n) => n !== g.name)
  return (
    <li className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-12 w-full items-start gap-3 p-4 text-left"
      >
        <span className="flex h-11 min-w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-mod-50 px-1 text-mod-800">
          <span className="text-lg font-extrabold leading-none">×{g.times}</span>
          <span className="text-[10px] font-semibold leading-none">lần</span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold text-slate-900">{g.name}</p>
          {g.item_code && <p className="font-code text-xs text-slate-500">{g.item_code}</p>}
          <p className="mt-1 text-sm text-slate-700">
            Tổng <b>{totals || "—"}</b> · gần nhất <b>{formatDateVN(g.last_date)}</b>
            {g.avg_interval_days != null && (
              <>
                {" "}
                · TB <b>{g.avg_interval_days}</b> ngày/lần
              </>
            )}
          </p>
          {otherNames.length > 0 && (
            <p className="mt-0.5 text-xs text-slate-500">Tên đã ghi: {otherNames.join("; ")}</p>
          )}
          {canSeeCost && g.costs && g.costs.length > 0 && (
            <p className="mt-0.5 text-xs text-slate-500">
              Thành tiền: {g.costs.map((c) => formatMoney(c.thanh_tien, c.loai_tien)).join(" + ")}
            </p>
          )}
        </div>
        <ChevronDown size={20} className={`mt-1 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <ul className="divide-y divide-slate-200 border-t border-slate-100 bg-slate-50/60">
          {g.occurrences.map((o, i) => (
            <li key={`${o.record_id}-${i}`} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-slate-800">{formatDateVN(o.ngay)}</span>
                  <span className="text-xs font-semibold text-slate-600">{o.hang_muc}</span>
                  <StatusBadge domain="maintenance" status={o.trang_thai} size="xs" />
                </div>
                <p className="text-xs text-slate-500">
                  {o.ten_vat_tu} · {NGUON_LABEL[o.nguon] || o.nguon}
                </p>
                {o.ma_bb &&
                  (canOpenModule ? (
                    <Link
                      href={`/dashboard/maintenance/records/${o.record_id}`}
                      className="inline-flex min-h-8 items-center gap-1 font-code text-xs font-semibold text-brand-600 hover:underline"
                    >
                      {o.ma_bb} <ExternalLink size={12} />
                    </Link>
                  ) : (
                    <p className="font-code text-xs text-slate-500">{o.ma_bb}</p>
                  ))}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[15px] font-bold text-slate-800">
                  {formatNumber(o.so_luong)} {o.dvt || ""}
                </p>
                {canSeeCost && o.thanh_tien != null && (
                  <p className="text-xs text-slate-500">{formatMoney(o.thanh_tien, o.loai_tien)}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export function EquipmentMaterialsTab({ token }: { token: string }) {
  // Tìm lọc ở CLIENT trên danh sách đã tải: gõ tới đâu lọc tới đó + dropdown gợi ý ngay dưới ô.
  const [q, setQ] = useState("")
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const searchWrapRef = useRef<HTMLDivElement>(null)
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [hangMuc, setHangMuc] = useState<HangMuc>("all")
  const [minCount, setMinCount] = useState(1)
  const [sort, setSort] = useState<EquipmentMaterialSort>("count")
  const [data, setData] = useState<EquipmentMaterialsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const reqSeq = useRef(0)

  useEffect(() => {
    if (!suggestOpen) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) setSuggestOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSuggestOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("touchstart", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("touchstart", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [suggestOpen])

  const load = useCallback(async () => {
    const seq = ++reqSeq.current
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ sort, min_count: String(minCount) })
      if (from) qs.set("from", from)
      if (to) qs.set("to", to)
      if (hangMuc !== "all") qs.set("hang_muc", hangMuc)
      const res = await authFetch(`/api/equipment/${encodeURIComponent(token)}/materials?${qs}`, { cache: "no-store" })
      const json = (await res.json().catch(() => ({}))) as Partial<EquipmentMaterialsResponse> & { error?: string }
      if (seq !== reqSeq.current) return
      if (!res.ok) {
        setError(json.error || "Không tải được vật tư của thiết bị.")
        return
      }
      setData({
        canSeeCost: !!json.canSeeCost,
        canOpenModule: !!json.canOpenModule,
        recordCount: json.recordCount || 0,
        groups: json.groups || [],
      })
    } catch {
      if (seq === reqSeq.current) setError("Mất kết nối. Vui lòng thử lại.")
    } finally {
      if (seq === reqSeq.current) setLoading(false)
    }
  }, [token, from, to, hangMuc, minCount, sort])

  useEffect(() => {
    void load()
  }, [load])

  const qNorm = normalizeMaterialName(q)
  const allGroups = useMemo(() => data?.groups ?? [], [data])
  const suggestions = useMemo(() => allGroups.filter((g) => groupMatches(g, qNorm)), [allGroups, qNorm])
  // Đã chọn 1 vật tư trong dropdown ⇒ chỉ hiện đúng nhóm đó; nhóm biến mất (đổi bộ lọc khác) ⇒ quay về lọc theo chữ.
  const selectedStillThere = !!selectedKey && allGroups.some((g) => g.key === selectedKey)
  const visibleGroups = useMemo(
    () => (selectedStillThere ? allGroups.filter((g) => g.key === selectedKey) : suggestions),
    [allGroups, selectedKey, selectedStillThere, suggestions],
  )

  const pickGroup = (g: EquipmentMaterialGroup) => {
    setSelectedKey(g.key)
    setQ(g.name)
    setSuggestOpen(false)
  }
  const clearSearch = () => {
    setQ("")
    setSelectedKey(null)
  }

  const hasFilter = !!q || !!from || !!to || hangMuc !== "all" || minCount !== 1
  const clearFilters = () => {
    clearSearch()
    setFrom("")
    setTo("")
    setHangMuc("all")
    setMinCount(1)
  }

  const inputCls =
    "h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-800 focus:border-mod-600 focus:outline-none focus:ring-2 focus:ring-mod-200"

  return (
    <section className="space-y-3">
      <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div ref={searchWrapRef} className="relative">
          <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setSelectedKey(null)
              setSuggestOpen(true)
            }}
            onFocus={() => setSuggestOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && suggestions.length === 1) pickGroup(suggestions[0])
            }}
            placeholder="Tìm tên hoặc mã vật tư..."
            className={`${inputCls} pl-10 pr-11`}
            aria-label="Tìm vật tư"
            role="combobox"
            aria-expanded={suggestOpen}
            aria-controls="equipment-material-suggest"
            autoComplete="off"
          />
          {q && (
            <button
              type="button"
              onClick={() => {
                clearSearch()
                setSuggestOpen(true)
              }}
              aria-label="Xóa tìm kiếm"
              className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
            >
              <X size={16} />
            </button>
          )}
          {suggestOpen && data && (
            <ul
              id="equipment-material-suggest"
              role="listbox"
              className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
            >
              {suggestions.length === 0 ? (
                <li className="px-4 py-3 text-sm text-slate-500">Không có vật tư khớp.</li>
              ) : (
                suggestions.map((g) => (
                  <li key={g.key} role="option" aria-selected={g.key === selectedKey}>
                    <button
                      type="button"
                      onClick={() => pickGroup(g)}
                      className={`flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50 ${
                        g.key === selectedKey ? "bg-mod-50" : ""
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold text-slate-800">{g.name}</span>
                        {g.item_code && <span className="block truncate font-code text-xs text-slate-500">{g.item_code}</span>}
                      </span>
                      <span className="shrink-0 text-sm font-bold text-mod-800">×{g.times}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Từ ngày</span>
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Đến ngày</span>
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          </label>
        </div>
        <FilterChips<HangMuc>
          ariaLabel="Lọc hạng mục"
          value={hangMuc}
          onChange={setHangMuc}
          items={[
            { key: "all", label: "Tất cả" },
            { key: "Sửa chữa", label: "Sửa chữa" },
            { key: "Bảo dưỡng", label: "Bảo dưỡng" },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">Số lần thay ≥</span>
          {MIN_COUNT_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setMinCount(n)}
              aria-pressed={minCount === n}
              className={`min-h-10 min-w-10 rounded-full border px-3 text-sm font-bold ${
                minCount === n ? "border-mod-600 bg-mod-600 text-white" : "border-slate-300 bg-white text-slate-700"
              }`}
            >
              {n}
            </button>
          ))}
          {hasFilter && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto inline-flex min-h-10 items-center gap-1 rounded-full px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100"
            >
              <X size={14} /> Xóa lọc
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-extrabold text-slate-900">
          <Package size={18} className="text-mod-600" /> Vật tư đã thay
          {data && <span className="text-sm font-semibold text-slate-500">({visibleGroups.length})</span>}
        </h2>
        <SegmentedTabs<EquipmentMaterialSort>
          ariaLabel="Sắp xếp"
          size="sm"
          value={sort}
          onChange={setSort}
          items={[
            { key: "count", label: "Hay thay nhất" },
            { key: "latest", label: "Gần nhất" },
          ]}
        />
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-center">
          <p className="text-[15px] font-semibold text-red-700">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 inline-flex min-h-12 items-center justify-center rounded-xl border border-red-300 bg-white px-4 text-sm font-bold text-red-700"
          >
            Thử lại
          </button>
        </div>
      ) : loading && !data ? (
        <div className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white" />
      ) : data && visibleGroups.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-[15px] text-slate-500">
          {hasFilter ? "Không có vật tư khớp bộ lọc." : "Chưa có vật tư nào được ghi trên biên bản của thiết bị này."}
        </p>
      ) : data ? (
        <>
          <p className="text-xs text-slate-500">
            Từ {data.recordCount} biên bản (đã duyệt + chờ duyệt). Số lần = số biên bản có vật tư đó.
            {loading && " Đang tải lại..."}
          </p>
          <ul className={`space-y-3 ${loading ? "opacity-60" : ""}`}>
            {visibleGroups.map((g) => (
              <GroupCard key={g.key} g={g} canSeeCost={data.canSeeCost} canOpenModule={data.canOpenModule} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}
