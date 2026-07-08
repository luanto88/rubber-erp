"use client"

import { useEffect, useState } from "react"
import { Package, Warehouse } from "lucide-react"
import { buildNganLookupPath, resolveProductLabelLookupTarget, type KienLetter, type ProductLabelLookupResult } from "@/lib/product-label"
import { formatStorageDate } from "@/lib/storage-detail"

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
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-400 shadow-sm">
        Đang tải...
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-red-600 shadow-sm">
        {error || "Không tải được dữ liệu."}
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
        </div>
      )}

      {data.nganId && (
        <a
          href={buildNganLookupPath(data.nganId, data.nganMa)}
          className="mt-5 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-emerald-700 hover:bg-emerald-50"
        >
          <Warehouse size={16} />
          Xem chi tiết ngăn nguồn gốc: {data.nganTen || data.nganMa || "—"}
        </a>
      )}
    </div>
  )
}
