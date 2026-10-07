"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowLeftRight,
  ClipboardCheck,
  ExternalLink,
  Package,
  RotateCcw,
  ShieldCheck,
  Warehouse,
  Tag,
  Layers,
  Scale,
  Calendar,
  Clock,
  Activity,
  Boxes,
  CheckCircle2,
  Eye,
} from "lucide-react"
import { buildNganLookupPath, fetchProductLabelLookupPublic, type KienLetter, type ProductLabelLookupResult } from "@/lib/product-label"
import { formatStorageDate } from "@/lib/storage-detail"
import { ProductLabelSkeletonCard } from "@/app/dashboard/product/_components/product-label-skeleton"
import { loadStoredLang, storeLang, t, palletLabel, LANG_OPTIONS, type Lang } from "@/app/dashboard/product/confirm/i18n"
import { KienSwapNganModal } from "@/app/dashboard/product/_components/kien-swap-ngan-modal"
import { StoragePreviewModal } from "@/app/dashboard/storage/_components/storage-preview-modal"
import { DetailCard, DetailFieldItem, DetailFileCard, DetailQrBox } from "@/app/dashboard/_components/detail-view-ui"
import { buildStorageDownloadUrl } from "@/lib/storage-download"
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

// "produced"/"partial_kien"/"exported" đều hiển thị badge riêng
const STATUS_STYLE: Record<ProductLabelLookupResult["status"], string> = {
  predicted: "bg-amber-100 text-amber-700",
  produced: "bg-emerald-100 text-emerald-700",
  exported: "bg-blue-100 text-blue-700",
  partial: "bg-slate-100 text-slate-600",
  partial_kien: "bg-amber-100 text-amber-700",
  not_found: "bg-red-100 text-red-600",
}

function LangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-full border border-slate-300 text-xs font-bold">
      {LANG_OPTIONS.map((opt) => (
        <button
          key={opt.code}
          type="button"
          onClick={() => onChange(opt.code)}
          className={`px-3 py-1 transition-colors ${
            lang === opt.code ? "bg-emerald-600 text-white" : "bg-white text-slate-500 hover:bg-slate-100"
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
  // Icon "Đổi ngăn" chỉ hiện với người ĐÃ đăng nhập, đúng nhà máy, có quyền quét xác nhận.
  const [canSwapNgan, setCanSwapNgan] = useState(false)
  const [swapOpen, setSwapOpen] = useState(false)
  const [swapNotice, setSwapNotice] = useState<string | null>(null)

  // Preview nhanh ngăn nguồn gốc
  const [previewNganOpen, setPreviewNganOpen] = useState(false)

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

  const hasSxInfo = data && (data.status === "produced" || data.status === "partial_kien" || data.status === "exported")

  const currentUrl = typeof window !== "undefined" ? window.location.href : ""

  const handleViewKqkn = () => {
    if (!data) return
    if (data.kqknFileUrl) {
      window.open(data.kqknFileUrl, "_blank")
    } else {
      window.open(`/dashboard/quality`, "_blank")
    }
  }

  const handleDownloadKqkn = () => {
    if (!data?.kqknFileUrl) return
    const downloadUrl = buildStorageDownloadUrl(
      data.kqknFileUrl,
      data.kqknFileName || `KQKN_${data.maLo}.pdf`,
    )
    window.open(downloadUrl, "_blank")
  }

  return (
    <div className="space-y-4">
      {/* Top Header & Ngôn ngữ */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900">{tt("plPageTitle")}</h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-500">{tt("plPageSubtitle")}</p>
        </div>
        <div className="shrink-0 self-end sm:self-auto">
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
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:bg-emerald-700"
          >
            <RotateCcw size={16} />
            {tt("plRetry")}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* 1. NGUYÊN TẮC FILE-FIRST: Khối hiển thị KQKN / Chứng nhận chất lượng đưa lên đầu */}
          {(data.kqknFileName || data.kqknFileUrl || (data.datHang && data.status !== "predicted" && data.status !== "not_found")) && (
            <DetailFileCard
              fileName={data.kqknFileName || `Phiếu kiểm nghiệm chất lượng — Lô ${data.maLo}.pdf`}
              fileType="pdf"
              fileSize={data.kqknNgay ? `Ngày KN: ${formatStorageDate(data.kqknNgay)}` : undefined}
              statusLabel={data.kqknStatus || (data.datHang ? `Đạt hạng ${data.datHang}` : undefined)}
              statusTone={data.datHang?.endsWith("RH") ? "amber" : "emerald"}
              onView={data.kqknFileUrl ? handleViewKqkn : undefined}
              onDownload={data.kqknFileUrl ? handleDownloadKqkn : undefined}
            />
          )}

          {/* 2. HEADER & TỔNG QUAN KIỆN: Dùng DetailCard chuẩn Pastel */}
          <DetailCard
            icon={<Package size={20} />}
            iconTone="teal"
            title={`${data.maLo} — ${tt("kienLabel")} ${data.kien}`}
            subtitle={`${tt("plLoaiCsr")}: ${data.loaiCsr || "—"} · ${tt("loaiPallet")}: ${formatPalletDisplay(data.pallet, lang)}`}
            badge={
              <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_STYLE[data.status]}`}>
                {tt(statusLabelKey[data.status], { existingBanh: data.existingBanh })}
              </span>
            }
          >
            {/* Cảnh báo mảng bành dở dang (partial_kien) làm nổi bật thanh lịch */}
            {data.status === "partial_kien" && (
              <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm font-bold text-amber-800 flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-600 shrink-0" />
                <span>{tt("plDaSanXuatBanhCa", { existingBanh: data.existingBanh, ca: data.ca || "—" })}</span>
              </div>
            )}

            {/* Lưới thông tin đặc tính kiện — Chuẩn 2 cột 50-50 trên Mobile, 4 cột desktop */}
            {data.status !== "not_found" && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                <DetailFieldItem
                  icon={<Tag size={15} />}
                  iconTone="rose"
                  label="Mã lô & Kiện"
                  value={`${data.maLo} (K${data.kien})`}
                  mono
                  highlight="rose"
                />
                <DetailFieldItem
                  icon={<Layers size={15} />}
                  iconTone="blue"
                  label={tt("plLoaiCsr")}
                  value={data.loaiCsr || "—"}
                />
                <DetailFieldItem
                  icon={<Scale size={15} />}
                  iconTone="amber"
                  label={tt("plLoaiBanh")}
                  value={data.loaiBanh ? `${data.loaiBanh} kg/bành` : "—"}
                  mono
                />
                <DetailFieldItem
                  icon={<ShieldCheck size={15} />}
                  iconTone="violet"
                  label={tt("plLoaiBoc")}
                  value={data.boc || "—"}
                />
                <DetailFieldItem
                  icon={<Calendar size={15} />}
                  iconTone="emerald"
                  label={tt("ngaySanXuat")}
                  value={hasSxInfo && data.ngaySx ? formatStorageDate(data.ngaySx) : tt("plChoNhapLieu")}
                  highlight={hasSxInfo && data.ngaySx ? undefined : "amber"}
                />
                <DetailFieldItem
                  icon={<Clock size={15} />}
                  iconTone="blue"
                  label={tt("gioSanXuat")}
                  value={hasSxInfo && formatStorageTime(data.gioSx) ? formatStorageTime(data.gioSx) : tt("plChoNhapLieu")}
                />
                <DetailFieldItem
                  icon={<Activity size={15} />}
                  iconTone="teal"
                  label={tt("caSanXuat")}
                  value={hasSxInfo && data.ca ? `${tt("caSanXuat")} ${data.ca}` : tt("plChoNhapLieu")}
                />
                <DetailFieldItem
                  icon={<Boxes size={15} />}
                  iconTone="slate"
                  label={tt("loaiPallet")}
                  value={formatPalletDisplay(data.pallet, lang)}
                />
                <DetailFieldItem
                  icon={<CheckCircle2 size={15} />}
                  iconTone={data.datHang?.endsWith("RH") ? "rose" : "emerald"}
                  label={tt("plDatHangLabel")}
                  value={data.datHang || tt("plDangChoKiemNghiem")}
                  highlight={!data.datHang ? "amber" : data.datHang.endsWith("RH") ? "rose" : "emerald"}
                />
                {data.eudrOrderUrl && (
                  <DetailFieldItem
                    icon={<ShieldCheck size={15} />}
                    iconTone="blue"
                    label="Truy xuất EUDR"
                    value={
                      <a
                        href={data.eudrOrderUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800"
                      >
                        <span>{data.eudrOrderCode || "Mở đơn EUDR"}</span>
                        <ExternalLink size={12} />
                      </a>
                    }
                  />
                )}
              </div>
            )}

            {/* Nút xác nhận sản xuất nếu kiện chưa xong */}
            {(data.status === "predicted" || data.status === "partial" || data.status === "partial_kien") && (
              <Link
                href={`/dashboard/product/confirm?f=${encodeURIComponent(factoryId)}&lo=${encodeURIComponent(maLo)}&kien=${kien}`}
                className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-extrabold text-white shadow-md transition-all hover:bg-emerald-700"
              >
                <ClipboardCheck size={18} />
                {tt("plXacNhanSanXuat")}
              </Link>
            )}
          </DetailCard>

          {/* 3. KHỐI NGĂN NGUỒN GỐC (TRACEABILITY CARD): Liên kết truy xuất nguồn gốc 2 chiều */}
          {data.nganId && (
            <DetailCard
              icon={<Warehouse size={18} />}
              iconTone="blue"
              title={tt("plNganNguonGoc") || "Ngăn nguyên liệu nguồn gốc"}
              subtitle="Truy xuất nguồn gốc nguyên liệu mủ đầu vào của kiện này"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 grid place-items-center shrink-0">
                    <Tag size={15} />
                  </span>
                  <div>
                    <div className="text-xs text-slate-400 font-medium">Vị trí & Mã ngăn</div>
                    <div className="text-sm font-extrabold text-slate-800 font-mono">
                      {data.nganTen || data.nganMa || "—"}
                      {data.nganMa && data.nganTen && data.nganMa !== data.nganTen ? (
                        <span className="text-xs text-slate-400 font-normal ml-1.5">({data.nganMa})</span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {/* Nút Xem trước (Chiều 2: Kiện sang Ngăn nguyên liệu) */}
                  <button
                    type="button"
                    onClick={() => setPreviewNganOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all"
                  >
                    <Eye size={14} className="text-slate-500" />
                    <span>{tt("plXemNhanhNgan") || "Xem nhanh"}</span>
                  </button>

                  {/* Nút Xem chi tiết toàn trang */}
                  <a
                    href={buildNganLookupPath(data.nganId, data.nganMa)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl transition-all"
                  >
                    <Warehouse size={14} />
                    <span>{tt("plXemChiTietNgan", { nganTen: data.nganTen || data.nganMa || "" })}</span>
                  </a>

                  {/* Nút Đổi ngăn nguồn gốc nếu có quyền */}
                  {canSwapNgan && (data.status === "predicted" || data.status === "partial") && (
                    <button
                      type="button"
                      onClick={() => {
                        setSwapNotice(null)
                        setSwapOpen(true)
                      }}
                      title={tt("doiNgan")}
                      aria-label={tt("doiNgan")}
                      className="inline-flex items-center gap-1 px-3 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition-all"
                    >
                      <ArrowLeftRight size={14} />
                      <span>{tt("doiNgan")}</span>
                    </button>
                  )}
                </div>
              </div>

              {swapNotice && (
                <div className="mt-3 rounded-xl bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-800">
                  {swapNotice}
                </div>
              )}
            </DetailCard>
          )}

          {/* 4. KHỐI MÃ QR TRA CỨU: Đồng bộ DetailQrBox */}
          <DetailQrBox
            label={tt("plLienKetTraCuu") || "Liên kết tra cứu trực tuyến kiện mủ"}
            qrUrl={currentUrl}
          />

          {/* Modal Đổi ngăn nguồn */}
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

          {/* Modal Preview nhanh Ngăn lưu nguồn gốc (Chiều 2) */}
          {previewNganOpen && data.nganId && (
            <StoragePreviewModal
              nganId={data.nganId}
              nganCode={data.nganMa}
              isOpen={previewNganOpen}
              onClose={() => setPreviewNganOpen(false)}
            />
          )}
        </div>
      )}
    </div>
  )
}
