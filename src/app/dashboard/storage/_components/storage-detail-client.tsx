"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, FileText, Layers, QrCode, Truck, Warehouse, Weight } from "lucide-react"
import { getActiveFactoryId } from "@/lib/auth"
import { InventoryQrCard } from "@/app/dashboard/inventory/_components/inventory-qr-card"
import {
  buildStorageLookupPath,
  formatStorageDate,
  getKLFromTrip,
  loadStorageDetail,
  summarizeStorageLots,
  type StorageDetailData,
} from "@/lib/storage-detail"
import { downloadStorageDetailPdf } from "@/lib/storage-pdf"

export function StorageDetailClient({ nganId }: { nganId: string }) {
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [detail, setDetail] = useState<StorageDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const fid = await getActiveFactoryId()
        if (!fid) throw new Error("Không xác định được nhà máy đang làm việc.")
        setFactoryId(fid)
        const data = await loadStorageDetail(fid, nganId)
        setDetail(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Không tải được chi tiết ngăn lưu.")
      } finally {
        setLoading(false)
      }
    }
    void run()
  }, [nganId])

  const groupedLots = useMemo(() => {
    if (!detail) return []
    const grouped = detail.lots.reduce<Record<string, { key: string; label: string; totalKg: number; items: typeof detail.lots }>>((acc, lot) => {
      const key = [lot.loai_csr, lot.loai_banh, lot.boc || ""].join("|")
      if (!acc[key]) {
        acc[key] = {
          key,
          label: `${lot.loai_csr || "—"} / Bành ${lot.loai_banh || 0} / ${lot.boc || "—"}`,
          totalKg: 0,
          items: [],
        }
      }
      acc[key].totalKg += lot.tong_kg || 0
      acc[key].items.push(lot)
      return acc
    }, {})
    return Object.values(grouped).sort((a, b) => b.totalKg - a.totalKg)
  }, [detail])

  const summary = useMemo(() => (detail ? summarizeStorageLots(detail.lots) : null), [detail])

  const ratio = detail && summary && detail.ngan.tong_kho > 0 ? (summary.thanhPhamKg / detail.ngan.tong_kho) * 100 : null

  const handleExport = async () => {
    if (!detail) return
    setExporting(true)
    try {
      await downloadStorageDetailPdf(detail)
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-slate-400">Đang tải chi tiết ngăn lưu...</div>
  }

  if (error || !detail) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 p-8 text-red-700">
        <p className="font-bold">Không mở được chi tiết ngăn lưu.</p>
        <p className="mt-2 text-sm">{error || "Dữ liệu không tồn tại."}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/dashboard/storage" className="inline-flex items-center gap-2 text-sm font-bold text-emerald-700 hover:text-emerald-800">
            <ArrowLeft size={15} />
            Quay lại danh sách ngăn lưu
          </Link>
          <h1 className="mt-3 text-3xl font-extrabold text-slate-900">{detail.ngan.ten_ngan}</h1>
          <p className="mt-1 text-sm text-slate-500">{detail.ngan.ma_ngan || "—"}</p>
        </div>
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={exporting}
          className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          <FileText size={15} />
          {exporting ? "Đang xuất PDF..." : "Xuất PDF chi tiết"}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-emerald-50 via-white to-cyan-50 p-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[
              { label: "Loại nguyên liệu", value: detail.ngan.loai_nl, icon: <Layers size={16} className="text-emerald-600" /> },
              { label: "Ngày nguyên liệu", value: `${formatStorageDate(detail.ngan.ngay_bd)} - ${formatStorageDate(detail.ngan.ngay_kt)}`, icon: <Warehouse size={16} className="text-emerald-600" /> },
              { label: "Ngày xé", value: `${formatStorageDate(detail.ngan.xe_tu_ngay)} - ${formatStorageDate(detail.ngan.xe_den_ngay)}`, icon: <QrCode size={16} className="text-emerald-600" /> },
              { label: "Khối lượng nguyên liệu khô", value: `${(detail.ngan.tong_kho || 0).toLocaleString("vi-VN")} kg`, icon: <Weight size={16} className="text-emerald-600" /> },
              { label: "Khối lượng thành phẩm", value: `${(summary?.thanhPhamKg || 0).toLocaleString("vi-VN")} kg`, icon: <Weight size={16} className="text-emerald-600" /> },
              { label: "Tỷ lệ TP/QK", value: ratio === null ? "—" : `${ratio.toFixed(1)}%`, icon: <Weight size={16} className="text-emerald-600" /> },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-white/80 bg-white/90 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                  {item.icon}
                  {item.label}
                </div>
                <div className="mt-3 text-base font-bold text-slate-800">{item.value || "—"}</div>
              </div>
            ))}
          </div>
          {detail.ngan.ghi_chu && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span className="font-bold">Ghi chú:</span> {detail.ngan.ghi_chu}
            </div>
          )}
        </div>

        <InventoryQrCard
          title="QR ngăn"
          caption="Quét mã để mở lại đúng trang chi tiết này trên web."
          hrefPath={buildStorageLookupPath(detail.ngan.id)}
          valueText={detail.ngan.ma_ngan || detail.ngan.ten_ngan}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900">Chuyến xe nguyên liệu</h2>
              <p className="text-sm text-slate-400">{detail.trips.length} chuyến đã liên kết với ngăn này</p>
            </div>
            <div className="rounded-2xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700">
              <Truck size={15} className="mr-2 inline-block" />
              {detail.trips.length}
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {detail.trips.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
                Chưa có chuyến xe nào trong ngăn này.
              </div>
            ) : (
              detail.trips.map((trip) => {
                const kl = getKLFromTrip(trip, detail.ngan.loai_nl)
                return (
                  <div key={trip.ref || trip.uid} className="rounded-2xl border border-slate-200 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-bold text-slate-800">{trip.so_xe || "—"} · C{trip.chuyen || 1}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {formatStorageDate(trip._date)} · {trip.tai_xe || "Chưa có tài xế"}
                        </div>
                      </div>
                      <div className="text-right text-sm font-semibold text-slate-700">
                        <div>{kl.tuoi.toLocaleString("vi-VN")} kg tươi</div>
                        <div className="text-emerald-700">{kl.kho.toLocaleString("vi-VN")} kg khô</div>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900">Lô thành phẩm</h2>
              <p className="text-sm text-slate-400">
                {summary?.totalLots || 0} lô, gồm {summary?.doDangCount || 0} lô dở dang
              </p>
            </div>
            <div className="rounded-2xl bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700">
              {(summary?.thanhPhamKg || 0).toLocaleString("vi-VN")} kg
            </div>
          </div>
          <div className="mt-4 space-y-4">
            {groupedLots.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
                Chưa có lô thành phẩm nào sử dụng nguyên liệu từ ngăn này.
              </div>
            ) : (
              groupedLots.map((group) => (
                <div key={group.key} className="rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="bg-slate-50 px-4 py-3">
                    <div className="font-bold text-slate-800">{group.label}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {group.items.length} lô · {group.totalKg.toLocaleString("vi-VN")} kg
                    </div>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {group.items.map((lot) => (
                      <div key={lot.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div>
                          <div className="font-semibold text-slate-800">{lot.ma_lo}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {formatStorageDate(lot.ngay_sx)} · Ca {lot.ca || "—"} · {lot.tong_banh || 0} bành · {lot.trang_thai}
                          </div>
                        </div>
                        <div className="text-right text-sm font-bold text-slate-700">
                          {(lot.tong_kg || 0).toLocaleString("vi-VN")} kg
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {factoryId && (
        <div className="text-xs text-slate-400">
          Nhà máy: {factoryId}
        </div>
      )}
    </div>
  )
}
