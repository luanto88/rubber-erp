"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ClipboardCheck, Package, RotateCcw, Warehouse } from "lucide-react"
import { buildNganLookupPath, resolveProductLabelLookupTarget, type KienLetter, type ProductLabelLookupResult } from "@/lib/product-label"
import { formatStorageDate } from "@/lib/storage-detail"
import { ProductLabelSkeletonCard } from "@/app/dashboard/product/_components/product-label-skeleton"

type ProductLabelClientProps = {
  factoryId: string
  maLo: string
  kien: KienLetter
}

const STATUS_LABEL: Record<ProductLabelLookupResult["status"], { text: string; className: string }> = {
  predicted: { text: "Dự kiến — chưa sản xuất", className: "bg-amber-100 text-amber-700" },
  produced: { text: "Đã sản xuất", className: "bg-emerald-100 text-emerald-700" },
  partial: { text: "Dở dang — chưa ghi nhận kiện này", className: "bg-slate-100 text-slate-600" },
  not_found: { text: "Không tìm thấy dữ liệu", className: "bg-red-100 text-red-600" },
}

export function ProductLabelClient({ factoryId, maLo, kien }: ProductLabelClientProps) {
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

  if (loading) {
    return <ProductLabelSkeletonCard />
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-500">
          <AlertTriangle size={24} strokeWidth={2} />
        </div>
        <p className="text-sm font-semibold leading-relaxed text-slate-600">
          Không tìm thấy thông tin kiện mủ hoặc đường link bị hỏng. Vui lòng kiểm tra và quét lại mã QR.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:bg-emerald-700"
        >
          <RotateCcw size={16} />
          Thử lại
        </button>
      </div>
    )
  }

  const statusInfo = STATUS_LABEL[data.status]

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-md">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
          <Package size={24} />
        </div>
        <div>
          <div className="text-lg font-extrabold text-slate-800">
            {data.maLo} — Kiện {data.kien}
          </div>
          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${statusInfo.className}`}>
            {statusInfo.text}
          </span>
        </div>
      </div>

      {data.status !== "not_found" && (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs font-bold text-slate-500">Loại CSR</div>
            <div className="font-semibold text-slate-800">{data.loaiCsr || "—"}</div>
          </div>
          <div>
            <div className="text-xs font-bold text-slate-500">Loại bành</div>
            <div className="font-semibold text-slate-800">{data.loaiBanh || "—"}</div>
          </div>
          <div>
            <div className="text-xs font-bold text-slate-500">Loại bọc</div>
            <div className="font-semibold text-slate-800">{data.boc || "—"}</div>
          </div>
          <div>
            <div className="text-xs font-bold text-slate-500">Ngày sản xuất</div>
            <div className={`font-semibold ${data.status === "produced" && data.ngaySx ? "text-slate-800" : "text-amber-600"}`}>
              {data.status === "produced" && data.ngaySx ? formatStorageDate(data.ngaySx) : "Chờ nhập liệu"}
            </div>
          </div>
          <div>
            <div className="text-xs font-bold text-slate-500">Ca sản xuất</div>
            <div className={`font-semibold ${data.status === "produced" ? "text-slate-800" : "text-amber-600"}`}>
              {data.status === "produced" ? (data.ca ? `Ca ${data.ca}` : "—") : "Chờ nhập liệu"}
            </div>
          </div>
          <div>
            <div className="text-xs font-bold text-slate-500">Đạt hạng</div>
            <div
              className={`font-semibold ${
                !data.datHang ? "text-amber-600" : data.datHang.endsWith("RH") ? "text-red-600" : "text-emerald-700"
              }`}
            >
              {data.datHang || "Đang chờ kiểm nghiệm"}
            </div>
          </div>
        </div>
      )}

      {(data.status === "predicted" || data.status === "partial") && (
        <Link
          href={`/dashboard/product/confirm?f=${encodeURIComponent(factoryId)}&lo=${encodeURIComponent(maLo)}&kien=${kien}`}
          className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-extrabold text-white shadow-md transition-all hover:bg-emerald-700"
        >
          <ClipboardCheck size={18} />
          Xác nhận sản xuất
        </Link>
      )}

      {data.nganId && (
        <a
          href={buildNganLookupPath(data.nganId, data.nganMa)}
          className="mt-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-emerald-700 hover:bg-emerald-50"
        >
          <Warehouse size={16} />
          Xem chi tiết ngăn nguồn gốc: {data.nganTen || data.nganMa || "—"}
        </a>
      )}
    </div>
  )
}
