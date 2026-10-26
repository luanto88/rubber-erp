"use client"

// Tab "Gia công ngoài" — thống kê dịch vụ gia công đã "Xác nhận hoàn thành" trên phiếu Đề nghị mua
// (bảng purchase_service_completions). Dữ liệu qua GET /api/purchase/service-completions.

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Building2, Download, Hammer, Images, Search, Wallet } from "lucide-react"
import { authFetch } from "@/lib/auth-fetch"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId } from "@/lib/auth"
import { convertCurrency, setCurrencyRates } from "@/lib/currency"
import { BO_PHAN_LIST } from "@/lib/bo-phan"
import { normalizeName } from "@/lib/similar-name"
import { formatMoney, formatQty, formatSoPhieuFull } from "@/lib/purchase/types"
import { FilterBar } from "@/app/dashboard/_components/filter-bar"
import { FilterMultiSelect } from "@/app/dashboard/_components/filter-multi-select"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { StatCard, StatGrid } from "@/app/dashboard/_components/doc-ui/stat-card"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { ImageLightbox } from "./purchase-image-picker"
import { readJson } from "./purchase-client"

type CompletionRow = {
  id: string
  request_id: string
  item_name: string | null
  unit: string | null
  so_luong: number
  don_gia: number
  loai_tien: string | null
  ngay: string
  nha_cung_cap: string | null
  ghi_chu: string | null
  image_urls: string[] | null
  so: number
  nam: number
  bo_phan: string | null
  maintenance_record_id: string | null
  ma_bb: string | null
  nguoi_xac_nhan: string
}

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-")
  return d && m && y ? `${d}/${m}/${y}` : iso
}

export function ServiceCompletionsView({ defaultFrom, defaultTo }: { defaultFrom: string; defaultTo: string }) {
  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(defaultTo)
  const [boPhan, setBoPhan] = useState<string[]>([])
  const [donVi, setDonVi] = useState("")
  const [search, setSearch] = useState("")
  const [rows, setRows] = useState<CompletionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [ratesReady, setRatesReady] = useState(false)

  // Tỷ giá quy USD theo cấu hình nhà máy (mặc định trong lib/currency nếu chưa cấu hình).
  useEffect(() => {
    const run = async () => {
      try {
        const fid = await getActiveFactoryId()
        if (fid) {
          const { data } = await supabase.from("factories").select("ty_gia_usd_vnd, ty_gia_usd_khr").eq("id", fid).maybeSingle()
          setCurrencyRates({ vnd: data?.ty_gia_usd_vnd, khr: data?.ty_gia_usd_khr })
        }
      } finally {
        setRatesReady(true)
      }
    }
    void run()
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams()
      if (from) qs.set("from", from)
      if (to) qs.set("to", to)
      if (boPhan.length) qs.set("bo_phan", boPhan.join(","))
      const json = await readJson<{ rows: CompletionRow[] }>(await authFetch(`/api/purchase/service-completions?${qs}`))
      setRows(json.rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được dữ liệu gia công")
    } finally {
      setLoading(false)
    }
  }, [from, to, boPhan])

  useEffect(() => {
    void load()
  }, [load])

  const donViOptions = useMemo(
    () => [...new Set(rows.map((r) => (r.nha_cung_cap || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi")),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = normalizeName(search)
    return rows.filter((r) => {
      if (donVi && (r.nha_cung_cap || "").trim() !== donVi) return false
      if (!q) return true
      return normalizeName(`${r.item_name || ""} ${r.nha_cung_cap || ""} ${formatSoPhieuFull(r.so, r.nam)} ${r.ma_bb || ""} ${r.ghi_chu || ""}`).includes(q)
    })
  }, [rows, donVi, search])

  const stats = useMemo(() => {
    let usd = 0
    for (const r of filtered) usd += convertCurrency(r.so_luong * r.don_gia, r.loai_tien || "USD", "USD")
    return {
      count: filtered.length,
      usd,
      donVi: new Set(filtered.map((r) => (r.nha_cung_cap || "").trim()).filter(Boolean)).size,
    }
    // ratesReady: tính lại sau khi nạp tỷ giá nhà máy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, ratesReady])

  const exportExcel = async () => {
    const XLSX = await import("xlsx")
    const sheet = XLSX.utils.json_to_sheet(
      filtered.map((r) => ({
        "Ngày hoàn thành": fmtDate(r.ngay),
        "Dịch vụ": r.item_name || "",
        "ĐVT": r.unit || "",
        "Số lượng": r.so_luong,
        "Đơn giá": r.don_gia,
        "Thành tiền": r.so_luong * r.don_gia,
        "Loại tiền": r.loai_tien || "",
        "Quy USD": Math.round(convertCurrency(r.so_luong * r.don_gia, r.loai_tien || "USD", "USD") * 100) / 100,
        "Đơn vị gia công": r.nha_cung_cap || "",
        "Bộ phận": r.bo_phan || "",
        "Phiếu đề nghị": formatSoPhieuFull(r.so, r.nam),
        "Biên bản": r.ma_bb || "",
        "Người xác nhận": r.nguoi_xac_nhan,
        "Ghi chú": r.ghi_chu || "",
      })),
    )
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, "Gia cong ngoai")
    XLSX.writeFile(wb, `Gia cong ngoai ${from || "dau"}_${to || "nay"}.xlsx`)
  }

  const activeCount = [search, donVi].filter(Boolean).length + (boPhan.length ? 1 : 0)

  return (
    <>
      <StatGrid cols={3}>
        <StatCard icon={Hammer} label="Lần xác nhận hoàn thành" value={stats.count} />
        <StatCard icon={Wallet} label="Tổng chi phí (quy USD)" value={`$${formatMoney(stats.usd, "USD")}`} />
        <StatCard icon={Building2} label="Đơn vị gia công" value={stats.donVi} />
      </StatGrid>

      <FilterBar layout="grid" activeCount={activeCount}>
        <div className="flex h-10 w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 focus-within:border-mod-600 sm:col-span-2">
          <Search size={15} className="shrink-0 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm dịch vụ, đơn vị, số phiếu, biên bản..."
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-mod-600" aria-label="Từ ngày" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-mod-600" aria-label="Đến ngày" />
        <FilterMultiSelect

          options={[...BO_PHAN_LIST]}
          selected={boPhan}
          onChange={setBoPhan}
          placeholder="Tất cả bộ phận"
          searchPlaceholder="Tìm bộ phận..."
          fullWidth
        />
        <select value={donVi} onChange={(e) => setDonVi(e.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-mod-600" aria-label="Đơn vị gia công">
          <option value="">Tất cả đơn vị gia công</option>
          {donViOptions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <button
          type="button"
          onClick={() => void exportExcel()}
          disabled={!filtered.length}
          className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-brand-600 px-3 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          <Download size={15} /> Xuất Excel
        </button>
      </FilterBar>

      <ResponsiveTableWrapper>
        <table className="enterprise-table dense min-w-[1040px]">
          <thead>
            <tr>
              <th>Ngày</th>
              <th>Dịch vụ</th>
              <th className="text-right">SL</th>
              <th className="text-right">Đơn giá</th>
              <th className="text-right">Thành tiền</th>
              <th>Đơn vị gia công</th>
              <th>Phiếu đề nghị</th>
              <th>Biên bản</th>
              <th>Người xác nhận</th>
              <th className="text-right">Ảnh</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <ListState kind="loading" asRow colSpan={10} />
            ) : error ? (
              <ListState kind="error" message={error} onRetry={() => void load()} asRow colSpan={10} />
            ) : !filtered.length ? (
              <ListState kind="empty" asRow colSpan={10} />
            ) : (
              filtered.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap tabular-nums">{fmtDate(r.ngay)}</td>
                  <td>
                    <div className="font-semibold text-slate-800">{r.item_name || "—"}</div>
                    {r.ghi_chu && <div className="text-xs text-slate-500">{r.ghi_chu}</div>}
                  </td>
                  <td className="whitespace-nowrap text-right tabular-nums">{formatQty(r.so_luong)} {r.unit || ""}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{formatMoney(r.don_gia, r.loai_tien || "USD")}</td>
                  <td className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(r.so_luong * r.don_gia, r.loai_tien || "USD")} {r.loai_tien}</td>
                  <td>{r.nha_cung_cap || "—"}</td>
                  <td className="whitespace-nowrap">
                    <Link href={`/dashboard/purchase/${r.request_id}`} className="font-bold text-brand-700 hover:underline">{formatSoPhieuFull(r.so, r.nam)}</Link>
                    {r.bo_phan && <div className="text-xs text-slate-500">{r.bo_phan}</div>}
                  </td>
                  <td className="whitespace-nowrap">
                    {r.maintenance_record_id ? (
                      <Link href={`/dashboard/maintenance/records/${r.maintenance_record_id}`} className="font-bold text-brand-700 hover:underline">{r.ma_bb || "(chưa có mã)"}</Link>
                    ) : "—"}
                  </td>
                  <td>{r.nguoi_xac_nhan || "—"}</td>
                  <td className="text-right">
                    {r.image_urls?.length ? (
                      <button type="button" onClick={() => setLightbox(r.image_urls![0])} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-sky-700 hover:bg-sky-50" title="Xem ảnh">
                        <Images size={14} /> {r.image_urls.length}
                      </button>
                    ) : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ResponsiveTableWrapper>

      {lightbox && <ImageLightbox url={lightbox} onClose={() => setLightbox(null)} />}
    </>
  )
}
