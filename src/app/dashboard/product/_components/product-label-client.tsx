"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ClipboardCheck, Package, RotateCcw, Warehouse } from "lucide-react"
import { buildNganLookupPath, resolveProductLabelLookupTarget, type KienLetter, type ProductLabelLookupResult } from "@/lib/product-label"
import { formatStorageDate } from "@/lib/storage-detail"
import { ProductLabelSkeletonCard } from "@/app/dashboard/product/_components/product-label-skeleton"
import { loadStoredLang, storeLang, t, LANG_OPTIONS, type Lang } from "@/app/dashboard/product/confirm/i18n"

type ProductLabelClientProps = {
  factoryId: string
  maLo: string
  kien: KienLetter
}

// "produced"/"partial_kien" đều hiển thị badge riêng — "partial_kien" (2026-07-16) là kiện đã có
// MỘT PHẦN bành, khác hẳn "produced" (đã đủ) — xem resolveProductLabelLookupTarget để biết công
// thức tính đúng (SUM tất cả giao dịch so với max_per_kien, không còn kiểm tra tồn-tại đơn thuần).
const STATUS_STYLE: Record<ProductLabelLookupResult["status"], string> = {
  predicted: "bg-amber-100 text-amber-700",
  produced: "bg-emerald-100 text-emerald-700",
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

  useEffect(() => {
    let alive = true
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await resolveProductLabelLookupTarget(factoryId, maLo, kien)
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
  }, [factoryId, maLo, kien])

  const statusLabelKey: Record<ProductLabelLookupResult["status"], string> = {
    predicted: "plStatusPredicted",
    produced: "plStatusProduced",
    partial: "plStatusPartial",
    partial_kien: "plStatusPartialKien",
    not_found: "plStatusNotFound",
  }

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold text-slate-900">{tt("plPageTitle")}</h1>
          <p className="mt-1 text-sm text-slate-500">{tt("plPageSubtitle")}</p>
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
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:bg-emerald-700"
          >
            <RotateCcw size={16} />
            {tt("plRetry")}
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-md">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <Package size={24} />
            </div>
            <div>
              <div className="text-lg font-extrabold text-slate-800">
                {data.maLo} — {tt("kienLabel")} {data.kien}
              </div>
              <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_STYLE[data.status]}`}>
                {tt(statusLabelKey[data.status], { existingBanh: data.existingBanh })}
              </span>
            </div>
          </div>

          {data.status === "partial_kien" && (
            <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm font-bold text-amber-800">
              {tt("plDaSanXuatBanhCa", { existingBanh: data.existingBanh, ca: data.ca || "—" })}
            </div>
          )}

          {data.status !== "not_found" && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs font-bold text-slate-500">{tt("plLoaiCsr")}</div>
                <div className="font-semibold text-slate-800">{data.loaiCsr || "—"}</div>
              </div>
              <div>
                <div className="text-xs font-bold text-slate-500">{tt("plLoaiBanh")}</div>
                <div className="font-semibold text-slate-800">{data.loaiBanh || "—"}</div>
              </div>
              <div>
                <div className="text-xs font-bold text-slate-500">{tt("plLoaiBoc")}</div>
                <div className="font-semibold text-slate-800">{data.boc || "—"}</div>
              </div>
              <div>
                <div className="text-xs font-bold text-slate-500">{tt("ngaySanXuat")}</div>
                <div
                  className={`font-semibold ${
                    (data.status === "produced" || data.status === "partial_kien") && data.ngaySx
                      ? "text-slate-800"
                      : "text-amber-600"
                  }`}
                >
                  {(data.status === "produced" || data.status === "partial_kien") && data.ngaySx
                    ? formatStorageDate(data.ngaySx)
                    : tt("plChoNhapLieu")}
                </div>
              </div>
              <div>
                <div className="text-xs font-bold text-slate-500">{tt("caSanXuat")}</div>
                <div
                  className={`font-semibold ${
                    data.status === "produced" || data.status === "partial_kien" ? "text-slate-800" : "text-amber-600"
                  }`}
                >
                  {data.status === "produced" || data.status === "partial_kien"
                    ? data.ca
                      ? `${tt("caSanXuat")} ${data.ca}`
                      : "—"
                    : tt("plChoNhapLieu")}
                </div>
              </div>
              <div>
                <div className="text-xs font-bold text-slate-500">{tt("plDatHangLabel")}</div>
                <div
                  className={`font-semibold ${
                    !data.datHang ? "text-amber-600" : data.datHang.endsWith("RH") ? "text-red-600" : "text-emerald-700"
                  }`}
                >
                  {data.datHang || tt("plDangChoKiemNghiem")}
                </div>
              </div>
            </div>
          )}

          {(data.status === "predicted" || data.status === "partial" || data.status === "partial_kien") && (
            <Link
              href={`/dashboard/product/confirm?f=${encodeURIComponent(factoryId)}&lo=${encodeURIComponent(maLo)}&kien=${kien}`}
              className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-extrabold text-white shadow-md transition-all hover:bg-emerald-700"
            >
              <ClipboardCheck size={18} />
              {tt("plXacNhanSanXuat")}
            </Link>
          )}

          {data.nganId && (
            <a
              href={buildNganLookupPath(data.nganId, data.nganMa)}
              className="mt-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-emerald-700 hover:bg-emerald-50"
            >
              <Warehouse size={16} />
              {tt("plXemChiTietNgan", { nganTen: data.nganTen || data.nganMa || "—" })}
            </a>
          )}
        </div>
      )}
    </div>
  )
}
