"use client"

import { useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowLeftRight,
  Calendar,
  ChevronRight,
  ClipboardCheck,
  Clock,
  ExternalLink,
  FlaskConical,
  Layers,
  Package,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Sun,
  Warehouse,
  Weight,
} from "lucide-react"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import type { StatusTone } from "@/app/dashboard/_components/doc-ui/status-registry"
import { buildNganLookupPath, fetchProductLabelLookupPublic, type KienLetter, type ProductLabelLookupResult } from "@/lib/product-label"
import { formatStorageDate } from "@/lib/storage-detail"
import { ProductLabelSkeletonCard } from "@/app/dashboard/product/_components/product-label-skeleton"
import { loadStoredLang, storeLang, t, palletLabel, LANG_OPTIONS, type Lang } from "@/app/dashboard/product/confirm/i18n"
import { KienSwapNganModal } from "@/app/dashboard/product/_components/kien-swap-ngan-modal"
import { getFreshAuthSession, hasPermission, hydrateActiveSession } from "@/lib/auth"

type ProductLabelClientProps = {
  factoryId: string
  maLo: string
  kien: KienLetter
}

function formatStorageTime(value?: string | null) {
  if (!value) return null
  const d = new Date(value)
  if (isNaN(d.getTime())) return null
  const pad = (n: number) => n.toString().padStart(2, "0")
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatPalletDisplay(pallet: string[] | string | null | undefined, lang: Lang): string {
  if (!pallet) return "—"
  if (Array.isArray(pallet)) {
    const list = pallet.filter(Boolean).map((p) => palletLabel(lang, String(p)))
    return list.length > 0 ? list.join(", ") : "—"
  }
  if (typeof pallet === "string") {
    const trimmed = pallet.trim()
    if (!trimmed) return "—"
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) {
          const list = parsed.filter(Boolean).map((p) => palletLabel(lang, String(p)))
          return list.length > 0 ? list.join(", ") : "—"
        }
      } catch {
        // fallback
      }
    }
    return palletLabel(lang, trimmed)
  }
  return "—"
}

// Tông badge trạng thái (StatusBadge dùng chung) — "pending" có chấm nhấp nháy.
const STATUS_TONE: Record<ProductLabelLookupResult["status"], StatusTone> = {
  predicted: "pending",
  produced: "valid",
  exported: "info",
  partial: "draft",
  partial_kien: "pending",
  not_found: "danger",
}

// lucide không có icon pallet — vẽ tay cùng phong cách (stroke 2, 24×24).
function PalletIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="7" width="18" height="4" rx="1" />
      <path d="M3 15h18" />
      <path d="M5 11v6M12 11v6M19 11v6" />
    </svg>
  )
}

type TileTone = "normal" | "pending" | "good" | "bad"
const TILE_TONE: Record<TileTone, string> = {
  normal: "text-slate-800",
  pending: "text-amber-700",
  good: "text-emerald-700",
  bad: "text-red-600",
}

// Ô thông tin đơn sắc: icon xám trong ô nền slate + giá trị đậm. Không có nhãn chữ trên ô — nhãn
// nằm ở title (rê chuột) và aria-label (trình đọc màn hình).
function InfoTile({
  icon,
  label,
  value,
  tone = "normal",
  wide = false,
}: {
  icon: ReactNode
  label: string
  value: ReactNode
  tone?: TileTone
  wide?: boolean
}) {
  return (
    <div
      role="group"
      aria-label={label}
      title={label}
      className={`flex min-w-0 items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5 ${
        wide ? "col-span-2" : ""
      }`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
        {icon}
      </span>
      <span className={`min-w-0 break-words text-sm font-bold leading-snug ${TILE_TONE[tone]}`}>{value}</span>
    </div>
  )
}

function LangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-full border border-slate-200 bg-white text-xs font-bold">
      {LANG_OPTIONS.map((opt) => (
        <button
          key={opt.code}
          type="button"
          onClick={() => onChange(opt.code)}
          className={`px-3 py-1.5 transition-colors ${
            lang === opt.code ? "bg-brand-700 text-white" : "bg-white text-slate-500 hover:bg-slate-100"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function ProductLabelClient({ factoryId, maLo, kien }: ProductLabelClientProps) {
  const [lang, setLang] = useState<Lang>("vi")
  useEffect(() => {
    setLang(loadStoredLang())
  }, [])
  const switchLang = (l: Lang) => {
    setLang(l)
    storeLang(l)
  }
  const tt = (key: string, vars?: Record<string, string | number>) => t(lang, key, vars)

  const [data, setData] = useState<ProductLabelLookupResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Tải lại lookup sau khi đổi ngăn để dòng "ngăn nguồn gốc" phản ánh ngay ngăn mới.
  const [reloadKey, setReloadKey] = useState(0)
  // Icon "Đổi ngăn" chỉ hiện với người ĐÃ đăng nhập, đúng nhà máy, có quyền quét xác nhận. Đây chỉ
  // là giao diện — server (loadKienSwapContext/swapKienNgan) tự xác thực lại bằng access token.
  const [canSwapNgan, setCanSwapNgan] = useState(false)
  const [swapOpen, setSwapOpen] = useState(false)
  const [swapNotice, setSwapNotice] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const run = async () => {
      try {
        const session = await getFreshAuthSession()
        if (!session?.user) return
        const { user } = await hydrateActiveSession()
        if (!alive || !user) return
        setCanSwapNgan(
          user.status === "active" &&
            user.factory_id === factoryId &&
            hasPermission(user, "product.confirm_scan"),
        )
      } catch {
        // Khách chưa đăng nhập / lỗi mạng — giữ nguyên trang công khai, không hiện icon.
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [factoryId])

  useEffect(() => {
    let alive = true
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await fetchProductLabelLookupPublic(factoryId, maLo, kien)
        if (alive) setData(result)
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Lỗi không xác định")
      } finally {
        if (alive) setLoading(false)
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [factoryId, maLo, kien, reloadKey])

  const statusLabelKey: Record<ProductLabelLookupResult["status"], string> = {
    predicted: "plStatusPredicted",
    produced: "plStatusProduced",
    exported: "plStatusExported",
    partial: "plStatusPartial",
    partial_kien: "plStatusPartialKien",
    not_found: "plStatusNotFound",
  }
  // Kiện đã có dữ liệu sản xuất thật ⇒ ngày/giờ/ca hiển thị giá trị; còn lại "Chờ nhập liệu".
  const isRecorded =
    !!data && (data.status === "produced" || data.status === "partial_kien" || data.status === "exported")
  const gioSx = formatStorageTime(data?.gioSx)

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3" title={tt("plPageSubtitle")}>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
            <ScanLine size={22} />
          </span>
          {/* Tiêu đề chỉ còn cho trình đọc màn hình — giao diện đơn sắc bỏ chữ thừa. */}
          <h1 className="sr-only">{tt("plPageTitle")}</h1>
        </div>
        <div className="shrink-0">
          <LangToggle lang={lang} onChange={switchLang} />
        </div>
      </div>

      {loading ? (
        <ProductLabelSkeletonCard />
      ) : error || !data ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-500">
            <AlertTriangle size={24} strokeWidth={2} />
          </div>
          <p className="text-sm font-semibold leading-relaxed text-slate-600">{tt("plNotFoundMessage")}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:bg-brand-700"
          >
            <RotateCcw size={16} />
            {tt("plRetry")}
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center gap-3 border-b border-slate-100 pb-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
              <Package size={24} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-all text-2xl font-extrabold leading-tight text-slate-900">{data.maLo}</span>
                <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-sm font-bold text-slate-700">
                  {tt("kienLabel")} {data.kien}
                </span>
              </div>
              <div className="mt-1.5">
                <StatusBadge
                  tone={STATUS_TONE[data.status]}
                  label={tt(statusLabelKey[data.status], { existingBanh: data.existingBanh })}
                  className="max-w-full !whitespace-normal"
                />
              </div>
            </div>
          </div>

          {data.status === "partial_kien" && (
            <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm font-bold text-amber-800">
              {tt("plDaSanXuatBanhCa", { existingBanh: data.existingBanh, ca: data.ca || "—" })}
            </div>
          )}

          {data.status !== "not_found" && (
            <div className="grid grid-cols-2 gap-2.5">
              <InfoTile icon={<ShieldCheck size={16} />} label={tt("plLoaiCsr")} value={data.loaiCsr || "—"} />
              <InfoTile
                icon={<Weight size={16} />}
                label={tt("plLoaiBanh")}
                value={data.loaiBanh ? `${data.loaiBanh} kg` : "—"}
              />
              <InfoTile icon={<Layers size={16} />} label={tt("plLoaiBoc")} value={data.boc || "—"} wide />
              <InfoTile
                icon={<PalletIcon size={16} />}
                label={tt("loaiPallet")}
                value={formatPalletDisplay(data.pallet, lang)}
              />
              <InfoTile
                icon={<Sun size={16} />}
                label={tt("caSanXuat")}
                tone={isRecorded ? "normal" : "pending"}
                value={isRecorded ? (data.ca ? tt("plCaShort", { ca: data.ca }) : "—") : tt("plChoNhapLieu")}
              />
              <InfoTile
                icon={<Calendar size={16} />}
                label={tt("ngaySanXuat")}
                tone={isRecorded && data.ngaySx ? "normal" : "pending"}
                value={isRecorded && data.ngaySx ? formatStorageDate(data.ngaySx) : tt("plChoNhapLieu")}
              />
              <InfoTile
                icon={<Clock size={16} />}
                label={tt("gioSanXuat")}
                tone={isRecorded && gioSx ? "normal" : "pending"}
                value={isRecorded && gioSx ? gioSx : tt("plChoNhapLieu")}
              />
              <InfoTile
                icon={<FlaskConical size={16} />}
                label={tt("plDatHangLabel")}
                tone={!data.datHang ? "pending" : data.datHang.endsWith("RH") ? "bad" : "good"}
                value={data.datHang || tt("plDangChoKiemNghiem")}
                wide
              />
            </div>
          )}

          {(data.status === "predicted" || data.status === "partial" || data.status === "partial_kien") && (
            <Link
              href={`/dashboard/product/confirm?f=${encodeURIComponent(factoryId)}&lo=${encodeURIComponent(maLo)}&kien=${kien}`}
              className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-sm font-extrabold text-white shadow-md transition-all hover:bg-brand-700"
            >
              <ClipboardCheck size={18} />
              {tt("plXacNhanSanXuat")}
            </Link>
          )}

          {data.eudrOrderUrl && (
            <a
              href={data.eudrOrderUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <ShieldCheck size={16} />
                </span>
                <span className="min-w-0 break-words">{tt("plTruyXuatEudr", { maDon: data.eudrOrderCode || "" })}</span>
              </div>
              <ExternalLink size={16} className="shrink-0 text-slate-400" />
            </a>
          )}

          {data.nganId && (
            <div className="mt-3 flex items-stretch gap-2">
              <a
                href={buildNganLookupPath(data.nganId, data.nganMa)}
                title={tt("plXemChiTietNgan", { nganTen: data.nganTen || data.nganMa || "—" })}
                aria-label={tt("plXemChiTietNgan", { nganTen: data.nganTen || data.nganMa || "—" })}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <Warehouse size={16} />
                </span>
                <span className="min-w-0 flex-1 truncate">{tt("plNganNguonGoc")}</span>
                <span className="inline-flex max-w-[45%] shrink-0 items-center gap-0.5 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-2.5 pr-1.5 text-xs font-bold text-slate-700">
                  <span className="truncate">{data.nganTen || data.nganMa || "—"}</span>
                  <ChevronRight size={14} className="shrink-0 text-slate-400" />
                </span>
              </a>
              {canSwapNgan && (data.status === "predicted" || data.status === "partial") && (
                <button
                  type="button"
                  onClick={() => {
                    setSwapNotice(null)
                    setSwapOpen(true)
                  }}
                  title={tt("doiNgan")}
                  aria-label={tt("doiNgan")}
                  className="flex shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-slate-600 hover:bg-slate-50"
                >
                  <ArrowLeftRight size={16} />
                </button>
              )}
            </div>
          )}

          {swapNotice && (
            <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">{swapNotice}</div>
          )}

          {swapOpen && (
            <KienSwapNganModal
              lang={lang}
              factoryId={factoryId}
              maLo={maLo}
              kien={kien}
              onClose={() => setSwapOpen(false)}
              onSwapped={(message) => {
                setSwapOpen(false)
                setSwapNotice(message)
                setReloadKey((k) => k + 1)
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}
