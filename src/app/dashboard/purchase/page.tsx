"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { createPortal } from "react-dom"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { AlertTriangle, Bell, ClipboardList, Clock, PenTool, Plus, QrCode, Search, ShoppingCart, X } from "lucide-react"
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
import { openSecureFile } from "@/app/dashboard/_components/secure-file-open"
import { moduleThemeClass } from "@/app/dashboard/_components/doc-ui/module-theme"
import { SegmentedTabs, type SegmentedTabItem } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { StatCard, StatGrid } from "@/app/dashboard/_components/doc-ui/stat-card"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { RowAction } from "@/app/dashboard/_components/doc-ui/row-action"
import { IconActionGroup } from "@/app/dashboard/_components/doc-ui/icon-action"
import { ExpandableRow, ExpandHeaderCell, ExpandAllToggle } from "@/app/dashboard/_components/doc-ui/expandable-row"
import {
  formatMoney, formatQty, formatSoPhieuFull, isPurchaseActive, purchaseDownloadBaseName, purchaseUrgency,
  type PurchaseRequestRow,
} from "@/lib/purchase/types"

// html5-qrcode đụng navigator.mediaDevices ⇒ chỉ chạy ở client (mirror maintenance/history, dispatch)
const QrScanner = dynamic(
  () => import("@/app/dashboard/product/confirm/qr-scanner").then((m) => m.QrScanner),
  { ssr: false },
)

// QR in trên phiếu Đề nghị mua = `{origin}/dashboard/purchase/{uuid}` (hoặc mã phiếu)
const PURCHASE_ID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
import { readJson } from "./_components/purchase-client"
import { KtShortageBanner } from "@/app/dashboard/_components/kt-shortage-banner"
import { ServiceCompletionsView } from "./_components/service-completions-view"

/** Dòng vật tư rút gọn do GET /api/purchase/requests trả kèm (cho dòng xổ). */
type ListLine = {
  id: string
  item_code: string | null
  item_name: string
  unit: string | null
  so_luong: number
  don_gia: number
  thanh_tien: number
  sl_da_mua: number
  muc_dich: string | null
  ngay_can_hang: string | null
}

type ListRow = PurchaseRequestRow & {
  giam_doc_ten: string
  ke_toan_ten: string
  signedCount: number
  signerCount: number
  myTurn: boolean
  /** Phiếu đã duyệt còn phải ghi nhận mua / xác nhận gia công (API tính). */
  nextStep?: "nhap_kho" | "gia_cong" | "ca_hai" | null
  myFulfillTurn?: boolean
  file_hien_tai: string | null
  lines?: ListLine[]
}

type Tab = "todo" | "mine" | "all" | "gia_cong"

const NEXT_STEP_LABEL: Record<"nhap_kho" | "gia_cong" | "ca_hai", string> = {
  nhap_kho: "Chờ nhập kho",
  gia_cong: "Chờ xác nhận gia công",
  ca_hai: "Chờ nhập kho + gia công",
}

const COLS = 9

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
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)

  const handleScanDecoded = (text: string) => {
    const raw = text.trim()
    setScanning(false)
    const idMatch = raw.match(PURCHASE_ID_RE)?.[0]
    if (idMatch) {
      router.push(`/dashboard/purchase/${idMatch}`)
      return
    }
    setSearch(raw)
  }

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
    if (tab === "gia_cong") return // tab thống kê gia công tự tải dữ liệu
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

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  const filtered = useMemo(() => {
    const q = normalizeName(search)
    if (!q) return rows
    return rows.filter((r) =>
      normalizeName(
        `${formatSoPhieuFull(r.so, r.nam)} ${r.nguoi_de_nghi_ten || ""} ${r.ghi_chu || ""} ${(r.lines || [])
          .map((l) => `${l.item_code || ""} ${l.item_name}`)
          .join(" ")}`,
      ).includes(q),
    )
  }, [rows, search])

  const canCreate = hasPermission(user, "purchase.create")
  const today = getFactoryTodayISO()
  const tabs: SegmentedTabItem<Tab>[] = [
    { key: "todo", label: "Chờ tôi xử lý", ...(tab === "todo" ? { count: rows.length, alertCount: true } : {}) },
    { key: "mine", label: "Của tôi" },
    ...(canAll ? [{ key: "all" as Tab, label: "Tất cả" }] : []),
    { key: "gia_cong" as Tab, label: "Gia công ngoài" },
  ]

  const stats = useMemo(() => {
    let dangKy = 0
    let myTurn = 0
    let dangMua = 0
    let gap = 0
    let fulfill = 0
    for (const r of rows) {
      if (r.trang_thai === "cho_ky") dangKy++
      if (r.myTurn) myTurn++
      if (r.myFulfillTurn) fulfill++
      if (r.trang_thai === "dang_mua" || r.trang_thai === "da_duyet") dangMua++
      const urg = r.ngay_can_hang && isPurchaseActive(r.trang_thai) ? purchaseUrgency(r.ngay_can_hang, today) : null
      if (urg && (urg.level === "qua_han" || urg.level === "gap")) gap++
    }
    return { total: rows.length, dangKy, myTurn, dangMua, gap, fulfill }
  }, [rows, today])

  const expandableIds = filtered.filter((r) => (r.lines || []).length > 0).map((r) => r.id)
  const allExpanded = expandableIds.length > 0 && expandableIds.every((id) => expanded.has(id))
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className={`space-y-4 ${moduleThemeClass("teal")}`}>
      {toast && (
        <div className="fixed left-1/2 top-4 z-50 max-w-xl -translate-x-1/2 rounded-2xl bg-red-600 px-5 py-3 text-sm font-bold text-white shadow-2xl">
          {toast}
        </div>
      )}
      <PageHeaderBanner
        title="Đề nghị mua vật tư hàng hóa"
        subtitle="Lập phiếu, ký số 3 bước: Người đề nghị → Giám đốc → Kế toán"
        theme="teal"
        icon={ShoppingCart}
        action={canCreate ? (
          <button
            onClick={() => router.push("/dashboard/purchase/new")}
            className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 font-bold text-brand-700 shadow-md hover:bg-brand-50"
          >
            <Plus size={16} /> Lập phiếu
          </button>
        ) : undefined}
      />

      {scanning && typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[90] overflow-y-auto bg-black">
            <QrScanner
              onDecoded={(t) => handleScanDecoded(t)}
              onCancel={() => setScanning(false)}
              hintText="Đưa camera vào mã QR trên phiếu Đề nghị mua đã in"
              cancelText="Hủy quét"
              cameraErrorText="Không mở được camera. Hãy cấp quyền camera hoặc tải ảnh chứa QR."
              uploadButtonText="Tải ảnh chứa QR"
              uploadScanningText="Đang xử lý ảnh..."
              uploadNotFoundText="Không tìm thấy mã QR trong ảnh."
              orDividerText="hoặc"
              scanError={null}
            />
          </div>,
          document.body,
        )}

      <KtShortageBanner />

      <SegmentedTabs
        items={tabs}
        value={tab}
        onChange={(k) => { setTab(k); setExpanded(new Set()) }}
        ariaLabel="Phạm vi phiếu đề nghị mua"
      />

      {tab === "gia_cong" ? (
        <ServiceCompletionsView defaultFrom={from} defaultTo={to} />
      ) : (<>
      <StatGrid cols={4}>
        <StatCard icon={ClipboardList} label="Số phiếu" value={stats.total} sub={`${stats.dangMua} phiếu đã duyệt / đang mua`} />
        <StatCard icon={Clock} label="Đang ký duyệt" value={stats.dangKy} />
        <StatCard icon={Bell} label="Chờ bạn ký" value={stats.myTurn} valueTone={stats.myTurn > 0 || stats.fulfill > 0 ? "warn" : "default"} sub={stats.fulfill > 0 ? `${stats.fulfill} phiếu chờ bạn ghi nhận mua / gia công` : undefined} />
        <StatCard icon={AlertTriangle} label="Cần hàng gấp / quá hạn" value={stats.gap} valueTone={stats.gap > 0 ? "danger" : "default"} />
      </StatGrid>

      <FilterBar layout="grid" activeCount={[search, to].filter(Boolean).length + (boPhanFilter.length ? 1 : 0)}>
        <div className="flex h-10 w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 focus-within:border-mod-600 sm:col-span-2 lg:col-span-2 xl:col-span-2">
          <Search size={15} className="shrink-0 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm số phiếu, người đề nghị, vật tư..."
            className="w-full min-w-0 bg-transparent text-sm outline-none"
          />
          {search && (
            <button
              type="button"
              aria-label="Xóa tìm kiếm"
              onClick={() => setSearch("")}
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setScanning(true)}
            title="Quét QR phiếu đề nghị mua"
            aria-label="Quét QR phiếu đề nghị mua"
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-mod-50 px-2 text-xs font-bold text-mod-800 transition-colors hover:bg-mod-200"
          >
            <QrCode size={15} />
            <span className="hidden sm:inline">Quét QR</span>
          </button>
        </div>
        <div className="h-10 w-full sm:col-span-1 lg:col-span-1 xl:col-span-2">
          <FilterMultiSelect
            placeholder="Tất cả bộ phận"
            options={[...BO_PHAN_LIST]}
            selected={boPhanFilter}
            onChange={setBoPhanFilter}
            searchPlaceholder="Tìm bộ phận..."
            fullWidth
          />
        </div>
        <div className="grid h-10 grid-cols-[1fr_auto_1fr] items-center gap-2 sm:col-span-1 lg:col-span-1 xl:col-span-2">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="Từ ngày"
            className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-mod-600"
          />
          <span className="text-center text-sm text-slate-400">→</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="Đến ngày"
            className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-mod-600"
          />
        </div>
      </FilterBar>

      <ResponsiveTableWrapper>
        {loading && rows.length === 0 ? (
          <ListState kind="loading" />
        ) : error ? (
          <ListState kind="error" message={error} onRetry={() => void load()} />
        ) : filtered.length === 0 ? (
          <ListState kind="empty" message="Không có phiếu đề nghị mua nào" />
        ) : (
          <>
            <div className="flex justify-end border-b border-slate-100 px-3 py-2">
              <ExpandAllToggle
                allExpanded={allExpanded}
                disabled={expandableIds.length === 0}
                onExpandAll={() => setExpanded(new Set(expandableIds))}
                onCollapseAll={() => setExpanded(new Set())}
              />
            </div>
            <table className="enterprise-table dense min-w-[980px]">
              <thead>
                <tr>
                  <th>Số phiếu</th>
                  <th>Ngày</th>
                  <th>Cần hàng</th>
                  <th>Người đề nghị</th>
                  <th>Bộ phận</th>
                  <th>Giám đốc / Kế toán</th>
                  <th className="text-right">Tổng tiền</th>
                  <th>Trạng thái</th>
                  <ExpandHeaderCell>Thao tác</ExpandHeaderCell>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const lines = r.lines || []
                  const soPhieu = formatSoPhieuFull(r.so, r.nam)
                  const baseName = purchaseDownloadBaseName(r.loai, r.so, r.nam)
                  const stillSigning = r.trang_thai === "cho_ky" || r.trang_thai === "tra_ve"
                  const openDetail = () => router.push(`/dashboard/purchase/${r.id}`)
                  const urg = r.ngay_can_hang && isPurchaseActive(r.trang_thai) ? purchaseUrgency(r.ngay_can_hang, today) : null
                  const detail = (
                    <table className="enterprise-table dense min-w-[760px]">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Vật tư</th>
                          <th>ĐVT</th>
                          <th className="text-right">SL</th>
                          <th className="text-right">Đơn giá</th>
                          <th className="text-right">Thành tiền</th>
                          <th className="text-right">Đã mua</th>
                          <th>Mục đích</th>
                          <th>Cần hàng</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((l, i) => (
                          <tr key={l.id}>
                            <td className="tabular-nums text-slate-500">{i + 1}</td>
                            <td>
                              <div className="font-semibold text-slate-800">{l.item_name}</div>
                              {l.item_code && <div className="font-code text-[11px] text-slate-500">{l.item_code}</div>}
                            </td>
                            <td className="whitespace-nowrap">{l.unit || "—"}</td>
                            <td className="text-right tabular-nums">{formatQty(l.so_luong)}</td>
                            <td className="whitespace-nowrap text-right tabular-nums">{formatMoney(l.don_gia, r.loai_tien)}</td>
                            <td className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(l.thanh_tien, r.loai_tien)}</td>
                            <td className="text-right tabular-nums">{formatQty(l.sl_da_mua)}</td>
                            <td className="text-slate-600">{l.muc_dich || "—"}</td>
                            <td className="whitespace-nowrap">{l.ngay_can_hang ? fmtDate(l.ngay_can_hang) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                  const actionCell = (
                    <IconActionGroup>
                      {r.myTurn && r.yeu_cau_ky_id && (
                        <Link
                          href={`/dashboard/ky/${r.yeu_cau_ky_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-brand-600 bg-brand-600 px-3 text-[12.5px] font-bold text-white transition-colors hover:bg-brand-700"
                        >
                          <PenTool size={14} /> Ký ngay
                        </Link>
                      )}
                      <RowAction kind="view" label="Xem chi tiết phiếu" onClick={openDetail} />
                      {r.file_hien_tai && r.yeu_cau_ky_id && (
                        <>
                          <RowAction
                            kind="signed"
                            label={stillSigning ? "Xem file (đang chờ ký tiếp)" : "Xem file đã ký"}
                            onClick={() => {
                              const name = encodeURIComponent(baseName)
                              void openSecureFile(`/api/signing/requests/${r.yeu_cau_ky_id}/file-url?view=1&name=${name}`).then((res) => {
                                if (!res.ok) showToast(res.error)
                              })
                            }}
                          />
                          <RowAction
                            kind="download"
                            label={stillSigning ? "Tải file (đang chờ ký tiếp)" : "Tải file đã ký về máy"}
                            href={buildStorageDownloadUrl(r.file_hien_tai, safeDownloadFileName(baseName, "pdf"))}
                          />
                        </>
                      )}
                    </IconActionGroup>
                  )
                  return (
                    <ExpandableRow
                      key={r.id}
                      expanded={expanded.has(r.id)}
                      onToggle={() => toggle(r.id)}
                      canExpand={lines.length > 0}
                      colSpan={COLS}
                      label="Xem các dòng vật tư"
                      endCell={actionCell}
                      detail={detail}
                    >
                      <td className="whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openDetail() }}
                          className="font-code text-xs font-bold text-brand-700 hover:underline"
                        >
                          {soPhieu}
                        </button>
                        {r.loai === "dieu_chinh" && <StatusBadge tone="info" label="Điều chỉnh" size="xs" className="ml-1.5" />}
                        <div className="text-[11px] text-slate-500">{lines.length} vật tư</div>
                      </td>
                      <td className="whitespace-nowrap">{fmtDate(r.ngay)}</td>
                      <td className="whitespace-nowrap">
                        {r.ngay_can_hang ? (
                          <>
                            <span className="text-slate-700">{fmtDate(r.ngay_can_hang)}</span>
                            {urg && urg.level !== "binh_thuong" && (
                              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${urg.className}`}>{urg.label}</span>
                            )}
                          </>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td>{r.nguoi_de_nghi_ten}</td>
                      <td className="whitespace-nowrap">{r.bo_phan || "—"}</td>
                      <td className="text-xs text-slate-600">{r.giam_doc_ten || "—"}<br />{r.ke_toan_ten || "—"}</td>
                      <td className="whitespace-nowrap text-right font-semibold tabular-nums">
                        {formatMoney(r.tong_tien, r.loai_tien)} {r.loai_tien}
                      </td>
                      <td>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge
                            domain="purchase"
                            status={r.trang_thai}
                            label={r.trang_thai === "cho_ky" && r.signerCount > 0 ? `Đang ký duyệt (${r.signedCount}/${r.signerCount})` : r.nextStep ? `${r.trang_thai === "dang_mua" ? "Đang mua" : "Đã duyệt"} · ${NEXT_STEP_LABEL[r.nextStep]}` : undefined}
                          />
                          {r.myTurn && <StatusBadge tone="pending" label="Chờ BẠN ký" size="xs" />}
                          {r.myFulfillTurn && <StatusBadge tone="pending" label="Tới lượt BẠN" size="xs" />}
                        </div>
                      </td>
                    </ExpandableRow>
                  )
                })}
              </tbody>
            </table>
          </>
        )}
      </ResponsiveTableWrapper>
      </>)}
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
