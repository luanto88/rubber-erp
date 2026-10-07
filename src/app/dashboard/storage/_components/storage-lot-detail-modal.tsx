"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { LotDetailModal } from "@/app/dashboard/warehouse/_components/lot-detail-modal"
import type { LotInfo } from "@/app/dashboard/warehouse/_components/warehouse-types"
import type { StorageProducedLot } from "@/lib/storage-detail"

export function StorageLotDetailModal({
  lot,
  onClose,
}: {
  lot: StorageProducedLot | null
  onClose: () => void
}) {
  const [fullLotInfo, setFullLotInfo] = useState<LotInfo | null>(null)
  const [placedSlots, setPlacedSlots] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    if (!lot) {
      setFullLotInfo(null)
      setPlacedSlots(new Map())
      return
    }

    // Khởi tạo fallback từ dữ liệu StorageProducedLot
    const fallback: LotInfo = {
      id: lot.id,
      ma_lo: lot.ma_lo,
      loai_csr: lot.loai_csr,
      loai_banh: lot.loai_banh,
      boc: lot.boc,
      pallet: [],
      kien_a: lot.kien_a || 0,
      kien_b: lot.kien_b || 0,
      kien_c: lot.kien_c || 0,
      kien_d: lot.kien_d || 0,
      tong_banh: lot.tong_banh || 0,
      tong_kg: lot.tong_kg || 0,
      trang_thai: lot.trang_thai || "Hoàn thành",
      ngay_sx: lot.ngay_sx,
      ngay_ht: null,
      day_chuyen: "",
      suffix: lot.ca || "",
      ghi_chu: null,
    }
    setFullLotInfo(fallback)

    let alive = true
    const run = async () => {
      try {
        const [{ data: lotRow }, { data: placements }] = await Promise.all([
          supabase
            .from("lots")
            .select("id, ma_lo, loai_csr, loai_banh, boc, pallet, kien_a, kien_b, kien_c, kien_d, tong_banh, tong_kg, trang_thai, ngay_sx, ngay_ht, day_chuyen, suffix, ghi_chu")
            .eq("id", lot.id)
            .maybeSingle(),
          supabase
            .from("warehouse_lot_placements")
            .select("kien_label, slot_code, stack_level")
            .eq("lot_id", lot.id)
            .is("removed_at", null),
        ])

        if (!alive) return

        if (lotRow) {
          setFullLotInfo(lotRow as LotInfo)
        }

        if (placements) {
          const map = new Map<string, string>()
          for (const p of placements) {
            if (p.kien_label && p.slot_code) {
              map.set(
                `${lot.id}:${p.kien_label}`,
                p.stack_level > 1 ? `${p.slot_code} (T${p.stack_level})` : p.slot_code,
              )
            }
          }
          setPlacedSlots(map)
        }
      } catch {
        // Fallback sang dữ liệu có sẵn
      }
    }

    void run()
    return () => {
      alive = false
    }
  }, [lot])

  if (!lot || !fullLotInfo) return null

  return (
    <LotDetailModal
      lot={fullLotInfo}
      placedSlots={placedSlots}
      onClose={onClose}
    />
  )
}
