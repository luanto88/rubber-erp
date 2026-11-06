"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronDown, ExternalLink, History, LogIn, QrCode, Wrench } from "lucide-react"
import { PageHeaderBanner } from "@/app/dashboard/_components/page-header-banner"
import { getFreshAuthSession } from "@/lib/auth"
import { authFetch } from "@/lib/auth-fetch"
import { currencySymbol } from "@/lib/currency"
import {
  buildEquipmentQrPath,
  parseEquipmentQrToken,
  type EquipmentHistoryRecord,
  type EquipmentHistoryResponse,
} from "@/lib/equipment-qr"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { QrScanPortal } from "@/app/dashboard/_components/qr-scan-portal"

// Phần NỘI BỘ của trang QR thiết bị `/tb/<token>` (docs/qr-equipment-plan.md, GĐ1).
// Chưa đăng nhập ⇒ nút "Đăng nhập để xem lịch sử" (quay về đúng trang qua `?next=`).
// Đã đăng nhập ⇒ tải lịch sử qua API có Bearer; API tự kiểm quyền/nhà máy/giá.

const PAGE_SIZE = 20
type Filter = "all" | "Sửa chữa" | "Bảo dưỡng"
type State =
  | { kind: "checking" }
  | { kind: "guest" }
  | { kind: "error"; message: string }
  | { kind: "ready" }

const NGUON_LABEL: Record<string, string> = {
  trong_kho: "Trong kho",
  ben_ngoai: "Mua ngoài",
  gia_cong: "Gia công ngoài",
}

function formatDateVN(iso: string | null) {
  if (!iso) return "—"
  const [y, m, d] = iso.slice(0, 10).split("-")
  return y && m && d ? `${d}/${m}/${y}` : iso
}

function formatMoney(value: number | null | undefined, loaiTien: string | null | undefined) {
  if (value == null) return "—"
  return `${Number(value).toLocaleString("vi-VN")} ${currencySymbol(loaiTien || "USD")}`
}

function TextBlock({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="whitespace-pre-wrap text-[15px] text-slate-800">{value}</p>
    </div>
  )
}

function RecordCard({ rec, canSeeCost }: { rec: EquipmentHistoryRecord; canSeeCost: boolean }) {
  const [open, setOpen] = useState(false)
  const summary = rec.cac_khac_phuc || rec.noi_dung || ""
  return (
    <li className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-12 w-full items-start gap-3 p-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-bold text-slate-900">{formatDateVN(rec.ngay)}</span>
            <span className="text-sm font-semibold text-slate-600">{rec.hang_muc}</span>
            <StatusBadge domain="maintenance" status={rec.trang_thai} size="xs" />
          </div>
          {rec.ma_bb && <p className="mt-0.5 font-code text-xs text-slate-500">{rec.ma_bb}</p>}
          {summary && <p className={`mt-1 text-sm text-slate-700 ${open ? "" : "line-clamp-2"}`}>{summary}</p>}
        </div>
        <ChevronDown size={20} className={`mt-1 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-100 bg-slate-50/60 p-4">
          <TextBlock label={rec.hang_muc === "Bảo dưỡng" ? "Nội dung bảo dưỡng" : "Tình trạng"} value={rec.noi_dung} />
          <TextBlock label={rec.hang_muc === "Bảo dưỡng" ? "Lý do" : "Nguyên nhân"} value={rec.nguyen_nhan} />
          <TextBlock label="Cách khắc phục / khối lượng đã làm" value={rec.cac_khac_phuc} />
          {rec.nguoi_thuc_hien.length > 0 && (
            <TextBlock label="Người thực hiện" value={rec.nguoi_thuc_hien.join(", ")} />
          )}

          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Vật tư sử dụng</p>
            {rec.materials.length === 0 ? (
              <p className="text-sm text-slate-500">Không có</p>
            ) : (
              <ul className="mt-1 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                {rec.materials.map((m, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-slate-800">{m.ten_vat_tu}</p>
                      <p className="text-xs text-slate-500">{NGUON_LABEL[m.nguon] || m.nguon}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[15px] font-bold text-slate-800">
                        {m.so_luong.toLocaleString("vi-VN")} {m.dvt || ""}
                      </p>
                      {canSeeCost && m.thanh_tien != null && (
                        <p className="text-xs text-slate-500">{formatMoney(m.thanh_tien, m.loai_tien)}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {canSeeCost && (rec.chi_phi_dk != null || rec.cong_tho != null) && (
            <p className="text-sm text-slate-700">
              Chi phí: <b>{formatMoney(rec.chi_phi_dk, rec.loai_tien)}</b>
              {rec.cong_tho ? <> · Công thợ: <b>{formatMoney(rec.cong_tho, rec.loai_tien)}</b></> : null}
            </p>
          )}

          <Link
            href={`/dashboard/maintenance/records/${rec.id}`}
            className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            <ExternalLink size={16} /> Mở biên bản
          </Link>
        </div>
      )}
    </li>
  )
}

/** Banner trang `/tb` — PHẢI là client: page.tsx là Server Component, không được truyền `icon`
 *  (hàm/component) sang PageHeaderBanner (client) ⇒ production lỗi "Server Components render". */
export function EquipmentQrBanner() {
  return (
    <PageHeaderBanner
      theme="slate"
      icon={Wrench}
      title="Tra cứu thiết bị"
      subtitle="Quét QR trên thiết bị để xem thông tin bảo trì"
    />
  )
}

export function EquipmentHistoryPanel({ token }: { token: string }) {
  const router = useRouter()
  const [state, setState] = useState<State>({ kind: "checking" })
  const [filter, setFilter] = useState<Filter>("all")
  const [records, setRecords] = useState<EquipmentHistoryRecord[]>([])
  const [total, setTotal] = useState(0)
  const [inactive, setInactive] = useState(false)
  const [canSeeCost, setCanSeeCost] = useState(false)
  const [loading, setLoading] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanKey, setScanKey] = useState(0)
  const reqSeq = useRef(0)

  const load = useCallback(
    async (offset: number, f: Filter) => {
      const seq = ++reqSeq.current
      setLoading(true)
      try {
        const qs = new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE) })
        if (f !== "all") qs.set("hang_muc", f)
        const res = await authFetch(`/api/equipment/${encodeURIComponent(token)}/history?${qs}`, { cache: "no-store" })
        const json = (await res.json().catch(() => ({}))) as Partial<EquipmentHistoryResponse> & { error?: string }
        if (seq !== reqSeq.current) return
        if (res.status === 401) {
          setState({ kind: "guest" })
          return
        }
        if (!res.ok) {
          setState({
            kind: "error",
            message:
              res.status === 404
                ? "Thiết bị này không thuộc nhà máy của tài khoản đang đăng nhập."
                : json.error || "Không tải được lịch sử thiết bị.",
          })
          return
        }
        setInactive(!!json.inactive)
        setCanSeeCost(!!json.canSeeCost)
        setTotal(json.total || 0)
        setRecords((prev) => (offset === 0 ? json.records || [] : [...prev, ...(json.records || [])]))
        setState({ kind: "ready" })
      } catch {
        if (seq === reqSeq.current) setState({ kind: "error", message: "Mất kết nối. Vui lòng thử lại." })
      } finally {
        if (seq === reqSeq.current) setLoading(false)
      }
    },
    [token],
  )

  useEffect(() => {
    let alive = true
    const run = async () => {
      let hasSession = false
      try {
        hasSession = !!(await getFreshAuthSession())?.user
      } catch {
        hasSession = false
      }
      if (!alive) return
      if (!hasSession) {
        setState({ kind: "guest" })
        return
      }
      void load(0, filter)
    }
    void run()
    return () => {
      alive = false
    }
  }, [load, filter])

  const onScanned = (text: string) => {
    const next = parseEquipmentQrToken(text)
    if (!next) {
      setScanError("Mã QR này không phải QR thiết bị.")
      setScanKey((k) => k + 1)
      setScanKey((k) => k + 1)
      return
    }
    setScanOpen(false)
    setScanError(null)
    router.push(buildEquipmentQrPath(next))
  }

  const loginHref = `/login?next=${encodeURIComponent(buildEquipmentQrPath(token))}`

  return (
    <>
      {state.kind === "checking" && (
        <div className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white" />
      )}

      {state.kind === "guest" && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
          <p className="text-[15px] text-slate-600">Đăng nhập để xem lịch sử sửa chữa, bảo dưỡng và vật tư đã thay.</p>
          <Link
            href={loginHref}
            className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-base font-bold text-white hover:bg-brand-700 sm:w-auto"
          >
            <LogIn size={18} /> Đăng nhập để xem lịch sử
          </Link>
        </section>
      )}

      {state.kind === "error" && (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-center">
          <p className="text-[15px] font-semibold text-red-700">{state.message}</p>
          <button
            type="button"
            onClick={() => void load(0, filter)}
            className="mt-3 inline-flex min-h-12 items-center justify-center rounded-xl border border-red-300 bg-white px-4 text-sm font-bold text-red-700"
          >
            Thử lại
          </button>
        </section>
      )}

      {state.kind === "ready" && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-base font-extrabold text-slate-900">
              <History size={18} className="text-mod-600" /> Lịch sử bảo trì
              <span className="text-sm font-semibold text-slate-500">({total})</span>
            </h2>
            {inactive && <StatusBadge tone="danger" label="Ngừng dùng" />}
          </div>
          <SegmentedTabs<Filter>
            ariaLabel="Lọc hạng mục"
            value={filter}
            onChange={(k) => setFilter(k)}
            fullWidth
            items={[
              { key: "all", label: "Tất cả" },
              { key: "Sửa chữa", label: "Sửa chữa" },
              { key: "Bảo dưỡng", label: "Bảo dưỡng" },
            ]}
          />
          {records.length === 0 && !loading ? (
            <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-[15px] text-slate-500">
              Chưa có biên bản nào cho thiết bị này.
            </p>
          ) : (
            <ul className="space-y-3">
              {records.map((r) => (
                <RecordCard key={r.line_id} rec={r} canSeeCost={canSeeCost} />
              ))}
            </ul>
          )}
          {records.length < total && (
            <button
              type="button"
              disabled={loading}
              onClick={() => void load(records.length, filter)}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-700 disabled:opacity-60"
            >
              {loading ? "Đang tải..." : `Xem thêm (${total - records.length})`}
            </button>
          )}
        </section>
      )}

      {/* Thanh hành động cố định đáy — vùng ngón cái, nút ≥48px, chừa safe-area. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(15,23,42,0.06)]">
        <div className="mx-auto flex max-w-2xl gap-2">
          <button
            type="button"
            onClick={() => {
              setScanError(null)
              setScanOpen(true)
            }}
            className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-base font-bold text-white hover:bg-brand-700"
          >
            <QrCode size={18} /> Quét QR khác
          </button>
          {state.kind === "ready" && (
            <Link
              href="/dashboard/maintenance/history"
              className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-base font-bold text-slate-700"
            >
              <History size={18} /> Lý lịch
            </Link>
          )}
        </div>
      </div>

      <QrScanPortal
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onDecoded={onScanned}
        hintText="Đưa camera vào mã QR dán trên thiết bị"
        scanKey={scanKey}
        header={
          scanError ? (
            <div className="bg-red-600 px-4 py-2 text-center text-sm font-bold text-white">{scanError}</div>
          ) : undefined
        }
      />
    </>
  )
}
