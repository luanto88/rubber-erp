"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"
import {
  Warehouse,
  Tag,
  Layers,
  MapPin,
  ShieldCheck,
  Calendar,
  Clock,
  Scale,
  Percent,
  Truck,
  FileText,
  ExternalLink,
  Loader2,
  AlertCircle,
} from "lucide-react"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { DetailCard, DetailFieldItem } from "@/app/dashboard/_components/detail-view-ui"
import {
  loadStorageDetailByLookup,
  formatStorageDate,
  summarizeStorageLots,
  type StorageDetailData,
} from "@/lib/storage-detail"
import { getStorageAgingDays, normalizeStorageStatus, getStorageStatusTheme } from "@/lib/storage-status"

export function StoragePreviewModal({
  nganId,
  nganCode,
  isOpen,
  onClose,
}: {
  nganId?: string | null
  nganCode?: string | null
  isOpen: boolean
  onClose: () => void
}) {
  const [data, setData] = useState<StorageDetailData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || (!nganId && !nganCode)) {
      setData(null)
      setError(null)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    loadStorageDetailByLookup({ nganId, nganCode })
      .then((res) => {
        if (alive) setData(res)
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : "Không tải được chi tiết ngăn lưu.")
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    return () => {
      alive = false
    }
  }, [isOpen, nganId, nganCode])

  if (!isOpen) return null

  const ngan = data?.ngan
  const summary = data ? summarizeStorageLots(data.lots) : null
  const ratio = ngan && summary && ngan.tong_kho > 0 ? (summary.thanhPhamKg / ngan.tong_kho) * 100 : null
  const agingDays = ngan ? getStorageAgingDays(ngan.ngay_bd) : null
  const statusTheme = getStorageStatusTheme(ngan?.trang_thai)

  return (
    <ModalShell
      title={`Chi tiết ngăn lưu ${ngan?.ten_ngan || ngan?.ma_ngan || ""}`}
      onClose={onClose}
      maxWidth="2xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs sm:text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
          >
            Đóng
          </button>
          {ngan && (
            <Link
              href={`/storage?id=${encodeURIComponent(ngan.id)}`}
              target="_blank"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition-colors"
            >
              <span>Xem trang đầy đủ</span>
              <ExternalLink size={14} />
            </Link>
          )}
        </div>
      }
    >
      {loading ? (
        <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400">
          <Loader2 size={28} className="animate-spin text-emerald-600" />
          <p className="text-sm font-semibold">Đang tải thông tin ngăn lưu...</p>
        </div>
      ) : error || !ngan ? (
        <div className="p-6 text-center text-slate-600">
          <AlertCircle size={28} className="mx-auto text-amber-500 mb-2" />
          <p className="text-sm font-bold">{error || "Không tìm thấy dữ liệu ngăn lưu."}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <DetailCard
            icon={<Warehouse size={18} />}
            iconTone="blue"
            title={ngan.ten_ngan}
            subtitle={ngan.ma_ngan || "Ngăn lưu trữ mủ nguyên liệu"}
            badge={
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold ${statusTheme.badge}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${statusTheme.dot}`} />
                {normalizeStorageStatus(ngan.trang_thai)}
              </span>
            }
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
              <DetailFieldItem
                icon={<Tag size={15} />}
                iconTone="rose"
                label="Mã ngăn"
                value={ngan.ma_ngan}
                mono
                highlight="rose"
              />
              <DetailFieldItem
                icon={<Layers size={15} />}
                iconTone="amber"
                label="Loại nguyên liệu"
                value={ngan.loai_nl}
              />
              <DetailFieldItem
                icon={<MapPin size={15} />}
                iconTone="emerald"
                label="Nguồn gốc"
                value={ngan.nguon_goc || "—"}
              />
              <DetailFieldItem
                icon={<ShieldCheck size={15} />}
                iconTone="violet"
                label="Chứng nhận"
                value={ngan.chung_nhan || "Không"}
              />
              <DetailFieldItem
                icon={<Calendar size={15} />}
                iconTone="emerald"
                label="Ngày BĐ nhận"
                value={formatStorageDate(ngan.ngay_bd)}
              />
              <DetailFieldItem
                icon={<Calendar size={15} />}
                iconTone="rose"
                label="Ngày KT nhận"
                value={formatStorageDate(ngan.ngay_kt)}
              />
              <DetailFieldItem
                icon={<Clock size={15} />}
                iconTone="amber"
                label="Ngày xé"
                value={`${formatStorageDate(ngan.xe_tu_ngay)} - ${formatStorageDate(ngan.xe_den_ngay)}`}
              />
              <DetailFieldItem
                icon={<Clock size={15} />}
                iconTone="blue"
                label="Số ngày lưu"
                value={agingDays !== null ? `${agingDays} ngày` : "—"}
                highlight={agingDays !== null && agingDays >= 21 ? "rose" : agingDays !== null && agingDays >= 6 ? "amber" : undefined}
              />
              <DetailFieldItem
                icon={<Scale size={15} />}
                iconTone="emerald"
                label="KL tươi"
                value={`${(ngan.tong_tuoi || 0).toLocaleString("vi-VN")} kg`}
                mono
              />
              <DetailFieldItem
                icon={<Scale size={15} />}
                iconTone="blue"
                label="KL khô"
                value={`${(ngan.tong_kho || 0).toLocaleString("vi-VN")} kg`}
                mono
                highlight="blue"
              />
              <DetailFieldItem
                icon={<Percent size={15} />}
                iconTone="teal"
                label="Tỷ lệ TP / QK"
                value={ratio === null ? "—" : `${ratio.toFixed(1)}% (${(summary?.thanhPhamKg || 0).toLocaleString("vi-VN")} kg)`}
                highlight="emerald"
              />
              <DetailFieldItem
                icon={<Truck size={15} />}
                iconTone="orange"
                label="Số chuyến xe"
                value={`${data.trips.length} chuyến`}
              />
              {(ngan.ghi_chu || ngan.ghi_chu_tu_do) && (
                <DetailFieldItem
                  icon={<FileText size={15} />}
                  iconTone="slate"
                  label="Ghi chú"
                  value={ngan.ghi_chu || ngan.ghi_chu_tu_do}
                  colSpan={2}
                />
              )}
            </div>
          </DetailCard>
        </div>
      )}
    </ModalShell>
  )
}
