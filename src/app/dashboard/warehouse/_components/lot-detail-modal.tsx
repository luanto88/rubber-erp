"use client"

import React from "react"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { DetailCard, DetailFieldItem } from "@/app/dashboard/_components/detail-view-ui"
import { formatDateDisplay } from "@/lib/date-utils"
import {
  Tag, Layers, Package, Shield, Activity, Clock, MapPin, Weight, Boxes, Calendar, FileText, CheckCircle2, Box
} from "lucide-react"
import { type LotInfo, type KienLabel, getCsrColor, getMaxBanh } from "./warehouse-types"

const KIEN_LABELS: KienLabel[] = ["A", "B", "C", "D"]

export function LotDetailModal({
  lot,
  placedSlots,
  onClose,
}: {
  lot: LotInfo | null
  placedSlots?: Map<string, string>
  onClose: () => void
}) {
  if (!lot) return null

  const csrColor = getCsrColor(lot.loai_csr)
  const maxBanh = getMaxBanh(lot.loai_banh)

  // Danh sách các vị trí ô kho của lô này
  const placedLocations = KIEN_LABELS.map(k => {
    const loc = placedSlots?.get(`${lot.id}:${k}`)
    return loc ? `K${k}: ${loc}` : null
  }).filter(Boolean)

  const weightKg = lot.tong_kg
    ? Math.round(lot.tong_kg).toLocaleString()
    : Math.round(lot.tong_banh * (String(lot.loai_banh || "").includes("35") ? 35 : 33.33)).toLocaleString()

  return (
    <ModalShell
      title={`Chi tiết lô thành phẩm ${lot.ma_lo}`}
      onClose={onClose}
      maxWidth="2xl"
    >
      <div className="space-y-4">
        {/* Thông tin chung của lô */}
        <DetailCard
          title={`Thông tin lô ${lot.ma_lo}`}
          subtitle={`Trạng thái: ${lot.trang_thai} · Hoàn thành: ${lot.ngay_ht ? formatDateDisplay(lot.ngay_ht) : "—"}`}
          icon={<Layers size={18} />}
          iconTone="teal"
          badge={
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">
              {lot.trang_thai}
            </span>
          }
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            <DetailFieldItem
              icon={<Tag size={15} />}
              iconTone="rose"
              label="Mã lô"
              value={lot.ma_lo}
              mono
            />
            <DetailFieldItem
              icon={<Layers size={15} />}
              iconTone="blue"
              label="Loại CSR"
              value={lot.loai_csr}
            />
            <DetailFieldItem
              icon={<Package size={15} />}
              iconTone="amber"
              label="Loại bành"
              value={`${lot.loai_banh || "33.33"} kg/bành`}
            />
            <DetailFieldItem
              icon={<Shield size={15} />}
              iconTone="violet"
              label="Loại bọc"
              value={lot.boc || "Không bọc"}
            />
            <DetailFieldItem
              icon={<Activity size={15} />}
              iconTone="emerald"
              label="Dây chuyền"
              value={lot.day_chuyen || "—"}
            />
            <DetailFieldItem
              icon={<Clock size={15} />}
              iconTone="blue"
              label="Ca sản xuất"
              value={lot.suffix ? `Ca ${lot.suffix}` : "—"}
            />
            <DetailFieldItem
              icon={<MapPin size={15} />}
              iconTone="emerald"
              label="Vị trí ô kho & Tầng"
              value={placedLocations.length > 0 ? placedLocations.join(" · ") : "Chưa lưu kho"}
              colSpan={2}
            />
            <DetailFieldItem
              icon={<Weight size={15} />}
              iconTone="orange"
              label="Trọng lượng"
              value={`${weightKg} kg`}
              mono
              highlight="amber"
            />
            <DetailFieldItem
              icon={<Boxes size={15} />}
              iconTone="slate"
              label="Tổng số bánh"
              value={`${lot.tong_banh} bánh`}
              mono
            />
            <DetailFieldItem
              icon={<Calendar size={15} />}
              iconTone="emerald"
              label="Ngày sản xuất"
              value={lot.ngay_sx ? formatDateDisplay(lot.ngay_sx) : "—"}
            />
            <DetailFieldItem
              icon={<Calendar size={15} />}
              iconTone="teal"
              label="Ngày hoàn thành"
              value={lot.ngay_ht ? formatDateDisplay(lot.ngay_ht) : "—"}
            />
            <DetailFieldItem
              icon={<FileText size={15} />}
              iconTone="slate"
              label="Ghi chú"
              value={lot.ghi_chu || "Không có ghi chú"}
              colSpan={2}
            />
          </div>
        </DetailCard>

        {/* Phân bổ các kiện A, B, C, D */}
        <DetailCard
          title="Phân bổ các kiện mủ"
          subtitle="Chi tiết số bánh và vị trí lưu trữ từng kiện trên sơ đồ kho"
          icon={<Box size={18} />}
          iconTone="amber"
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
            {KIEN_LABELS.map(k => {
              const banh = k === "A" ? lot.kien_a : k === "B" ? lot.kien_b : k === "C" ? lot.kien_c : lot.kien_d
              const slotLoc = placedSlots?.get(`${lot.id}:${k}`)
              const isFull = banh >= maxBanh

              return (
                <div
                  key={k}
                  className={`p-3 rounded-xl border ${
                    banh > 0
                      ? slotLoc
                        ? "bg-emerald-50/40 border-emerald-200"
                        : "bg-slate-50 border-slate-200"
                      : "bg-slate-50/40 border-slate-100 opacity-60"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-extrabold text-slate-700">Kiện {k}</span>
                    {slotLoc ? (
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.2 rounded-full">
                        Đã đặt
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 font-medium">Chưa đặt</span>
                    )}
                  </div>
                  <div className="text-base font-extrabold font-mono text-slate-800">
                    {banh} <span className="text-xs font-normal text-slate-400">bánh</span>
                    {!isFull && banh > 0 && <span className="text-amber-500 text-xs ml-1" title="Kiện dở dang">⚠</span>}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1 truncate">
                    {slotLoc ? (
                      <span className="font-semibold text-emerald-700">→ {slotLoc}</span>
                    ) : (
                      <span className="text-slate-400">Chưa có ô</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </DetailCard>
      </div>
    </ModalShell>
  )
}
