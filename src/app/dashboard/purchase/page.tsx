"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Bell, Download, Eye, Loader2, Plus, ShoppingCart } from "lucide-react"
import { hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { authFetch } from "@/lib/auth-fetch"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { normalizeName } from "@/lib/similar-name"
import { BO_PHAN_LIST } from "@/lib/bo-phan"
import { buildStorageDownloadUrl, safeDownloadFileName } from "@/lib/storage-download"
import { FilterMultiSelect } from "@/app/dashboard/_components/filter-multi-select"
import { PageHeaderBanner } from "@/app/dashboard/_components/page-header-banner"
import { FilterBar } from "@/app/dashboard/_components/filter-bar"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import {
  formatMoney, formatSoPhieuFull, isPurchaseActive, purchaseDownloadBaseName, purchaseUrgency, PURCHASE_STATUS_CLASS, PURCHASE_STATUS_LABEL,
  type PurchaseRequestRow,
} from "@/lib/purchase/types"
import { readJson } from "./_components/purchase-client"
import { KtShortageBanner } from "@/app/dashboard/_components/kt-shortage-banner"

type ListRow = PurchaseRequestRow & {
  giam_doc_ten: string
  ke_toan_ten: string
  signedCount: number
  signerCount: number
  myTurn: boolean
  file_hien_tai: string | null
}

type Tab = "todo" | "mine" | "all"

function fmtDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-")
  return `${d}/${m}/${y}`
}

function PurchaseListInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [tab, setTab] = useState<Tab>((searchParams.get("tab") as Tab) || "mine")
  const [rows, setRows] = useState<ListRow[]>([])
  const [canAll, setCanAll] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [from, setFrom] = useState(() => `${getFactoryTodayISO().slice(0, 4)}-01-01`)
  const [to, setTo] = useState("")
  const [search, setSearch] = useState("")
  const [boPhanFilter, setBoPhanFilter] = useState<string[]>([])

  useEffect(() => {
    const bootstrap = async () => {
      const { user: u } = await hydrateActiveSession()
      if (!u) { setLoading(false); return }
      if (!hasPermission(u, "purchase.view")) {
        setLoading(false)
        window.location.replace("/dashboard")
        return
      }
      setUser(u)
    }
    void bootstrap()
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ scope: tab })
      if (from) qs.set("from", from)
      if (to) qs.set("to", to)
      if (boPhanFilter.length) qs.set("bo_phan", boPhanFilter.join(","))
      const json = await readJson<{ rows: ListRow[]; canAll: boolean }>(await authFetch(`/api/purchase/requests?${qs}`))
      setRows(json.rows)
      setCanAll(json.canAll)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được danh sách")
    } finally {
      setLoading(false)
    }
  }, [tab, from, to, boPhanFilter])

  useEffect(() => {
    if (user) void load()
  }, [user, load])

  const filtered = useMemo(() => {
    const q = normalizeName(search)
    if (!q) return rows
    return rows.filter((r) =>
      normalizeName(`${formatSoPhieuFull(r.so, r.nam)} ${r.nguoi_de_nghi_ten || ""} ${r.ghi_chu || ""}`).includes(q),
    )
  }, [rows, search])

  const canCreate = hasPermission(user, "purchase.create")
  const today = getFactoryTodayISO()
  const tabs: { key: Tab; label: string }[] = [
    { key: "todo", label: "Chờ tôi xử lý" },
    { key: "mine", label: "Của tôi" },
    ...(canAll ? [{ key: "all" as Tab, label: "Tất cả" }] : []),
  ]

  return (
    <div className="space-y-4">
      <PageHeaderBanner
        title="Đề nghị mua vật tư hàng hóa"
        subtitle="Lập phiếu, ký số 3 bước: Người đề nghị → Giám đốc → Kế toán"
        theme="teal"
        icon={ShoppingCart}
        action={canCreate ? (
          <button onClick={() => router.push("/dashboard/purchase/new")} className="flex items-center gap-2 px-4 py-2 bg-white text-teal-700 font-bold rounded-xl shadow-md hover:bg-teal-50">
            <Plus size={16} /> Lập phiếu
          </button>
        ) : undefined}
      />

      <KtShortageBanner />

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${tab === t.key ? "bg-teal-600 text-white shadow" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <FilterBar activeCount={[search, to].filter(Boolean).length + (boPhanFilter.length ? 1 : 0)}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm số phiếu, người đề nghị..." className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-teal-500 min-w-[220px]" />
        <FilterMultiSelect
          placeholder="Tất cả bộ phận"
          options={[...BO_PHAN_LIST]}
          selected={boPhanFilter}
          onChange={setBoPhanFilter}
          searchPlaceholder="Tìm bộ phận..."
        />
        <label className="flex items-center gap-1.5 text-xs font-bold text-slate-500">Từ <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm" /></label>
        <label className="flex items-center gap-1.5 text-xs font-bold text-slate-500">Đến <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm" /></label>
      </FilterBar>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading && rows.length === 0 ? (
          <div className="p-12 text-center text-slate-400"><Loader2 className="mx-auto animate-spin mb-2" />Đang tải...</div>
        ) : error ? (
          <div className="p-8 text-center text-red-600 font-semibold">{error} <button onClick={() => void load()} className="ml-2 underline">Thử lại</button></div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400"><ShoppingCart size={40} className="mx-auto mb-3 opacity-30" />Không có phiếu nào</div>
        ) : (
          <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">Số phiếu</th>
                  <th className="text-left px-3 py-2">Ngày</th>
                  <th className="text-left px-3 py-2">Cần hàng</th>
                  <th className="text-left px-3 py-2">Người đề nghị</th>
                  <th className="text-left px-3 py-2">Bộ phận</th>
                  <th className="text-left px-3 py-2">Giám đốc / Kế toán</th>
                  <th className="text-right px-3 py-2">Tổng tiền</th>
                  <th className="text-left px-3 py-2">Trạng thái</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => router.push(`/dashboard/purchase/${r.id}`)}>
                    <td className="px-3 py-2 font-bold text-slate-800 whitespace-nowrap">
                      {formatSoPhieuFull(r.so, r.nam)}
                      {r.loai === "dieu_chinh" && <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">Điều chỉnh</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.ngay)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.ngay_can_hang ? (() => {
                        const urg = isPurchaseActive(r.trang_thai) ? purchaseUrgency(r.ngay_can_hang, today) : null
                        return (
                          <>
                            <span className="text-slate-700">{fmtDate(r.ngay_can_hang)}</span>
                            {urg && urg.level !== "binh_thuong" && (
                              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${urg.className}`}>{urg.label}</span>
                            )}
                          </>
                        )
                      })() : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-2">{r.nguoi_de_nghi_ten}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.bo_phan || "—"}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{r.giam_doc_ten || "—"}<br />{r.ke_toan_ten || "—"}</td>
                    <td className="px-3 py-2 text-right font-semibold whitespace-nowrap">{formatMoney(r.tong_tien, r.loai_tien)} {r.loai_tien}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${PURCHASE_STATUS_CLASS[r.trang_thai]}`}>{PURCHASE_STATUS_LABEL[r.trang_thai]}</span>
                        {r.trang_thai === "cho_ky" && <span className="text-xs text-slate-500">{r.signedCount}/{r.signerCount}</span>}
                        {r.myTurn && (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500 text-white"><Bell size={11} /> Chờ BẠN ký</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {r.file_hien_tai && (
                        <a
                          href={buildStorageDownloadUrl(r.file_hien_tai, safeDownloadFileName(purchaseDownloadBaseName(r.loai, r.so, r.nam), "pdf"))}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50"
                          title={r.trang_thai === "cho_ky" ? "Tải PDF (đang chờ ký tiếp)" : "Tải PDF đã ký"}
                        >
                          <Download size={15} />
                        </a>
                      )}
                      <Link href={`/dashboard/purchase/${r.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex p-1.5 rounded-lg text-teal-600 hover:bg-teal-50" title="Xem phiếu">
                        <Eye size={15} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTableWrapper>
        )}
      </div>
    </div>
  )
}

export default function PurchaseListPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-slate-400">Đang tải...</div>}>
      <PurchaseListInner />
    </Suspense>
  )
}
