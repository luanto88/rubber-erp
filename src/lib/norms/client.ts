// Định mức KTKT — loader trình duyệt (supabase anon, RLS norms.view). Rule 30.

import { supabase } from "@/lib/supabase"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import type {
  NormFloorCount,
  NormFloorLocation,
  NormItem,
  NormMeter,
  NormMeterReading,
  NormRow,
  NormValue,
  NormVersion,
  NormVersionItem,
} from "./types"

const ITEM_COLS =
  "id,factory_id,code,name,norm_group,actual_source,inventory_item_ids,vehicle_types,ghi_chu,sort_order,is_active,kiem_ke_ton_xuong"
const VERSION_COLS =
  "id,factory_id,nam,code,name,decision_no,decision_date,effective_from,effective_to,status,ghi_chu,applied_at,created_at"

export async function loadNormItems(factoryId: string): Promise<NormItem[]> {
  return fetchAllPaginated<NormItem>((from, to) =>
    supabase
      .from("tech_norm_items")
      .select(ITEM_COLS)
      .eq("factory_id", factoryId)
      .order("sort_order")
      .order("id")
      .range(from, to),
  )
}

export async function loadNormVersions(factoryId: string): Promise<NormVersion[]> {
  return fetchAllPaginated<NormVersion>((from, to) =>
    supabase
      .from("tech_norm_versions")
      .select(VERSION_COLS)
      .eq("factory_id", factoryId)
      .order("effective_from", { ascending: false })
      .order("id")
      .range(from, to),
  )
}

export type NormVersionDetail = { versionItems: NormVersionItem[]; rows: NormRow[]; values: NormValue[] }

export async function loadNormVersionDetail(factoryId: string, versionId: string): Promise<NormVersionDetail> {
  const [versionItems, rows, values] = await Promise.all([
    fetchAllPaginated<NormVersionItem>((from, to) =>
      supabase
        .from("tech_norm_version_items")
        .select("id,version_id,item_id,basis,unit,sort_order")
        .eq("factory_id", factoryId)
        .eq("version_id", versionId)
        .order("sort_order")
        .order("id")
        .range(from, to),
    ),
    fetchAllPaginated<NormRow>((from, to) =>
      supabase
        .from("tech_norm_rows")
        .select("id,version_id,day_chuyen,csr_codes,nguon_codes,label,sort_order")
        .eq("factory_id", factoryId)
        .eq("version_id", versionId)
        .order("sort_order")
        .order("id")
        .range(from, to),
    ),
    fetchAllPaginated<NormValue>((from, to) =>
      supabase
        .from("tech_norm_matrix_values")
        .select("id,version_id,item_id,row_id,value,merge_key,note")
        .eq("factory_id", factoryId)
        .eq("version_id", versionId)
        .order("id")
        .range(from, to),
    ),
  ])
  return { versionItems, rows, values: values.map((v) => ({ ...v, value: Number(v.value) })) }
}

export type InventoryItemOption = { id: string; code: string; name: string; unit: string | null }

export async function loadInventoryItemOptions(factoryId: string): Promise<InventoryItemOption[]> {
  return fetchAllPaginated<InventoryItemOption>((from, to) =>
    supabase
      .from("inventory_items")
      .select("id,code,name,unit")
      .eq("factory_id", factoryId)
      .order("code")
      .order("id")
      .range(from, to),
  )
}

// ─── GĐ2: đồng hồ + kiểm kê tồn xưởng ───────────────────────────────────────

const METER_COLS =
  "id,factory_id,code,name,khu_vuc,loai,he_so,dung_dinh_muc,norm_item_id,day_chuyen,hieu_luc_tu,hieu_luc_den,sort_order,is_active,ghi_chu"
const READING_COLS = "id,meter_id,ngay,chi_so,he_so,thay_dong_ho,chi_so_chot_cu,image_urls,ghi_chu,nhap_qua,created_at,updated_at"

export async function loadNormMeters(factoryId: string): Promise<NormMeter[]> {
  const rows = await fetchAllPaginated<NormMeter>((from, to) =>
    supabase.from("tech_norm_meters").select(METER_COLS).eq("factory_id", factoryId).order("sort_order").order("code").order("id").range(from, to),
  )
  return rows.map((m) => ({ ...m, he_so: Number(m.he_so) }))
}

function normalizeReading(r: NormMeterReading): NormMeterReading {
  return {
    ...r,
    chi_so: Number(r.chi_so),
    he_so: Number(r.he_so),
    chi_so_chot_cu: r.chi_so_chot_cu === null || r.chi_so_chot_cu === undefined ? null : Number(r.chi_so_chot_cu),
    image_urls: r.image_urls || [],
  }
}

/** Mọi lần ghi của nhà máy (hoặc 1 đồng hồ). Mỗi đồng hồ ~12 lần/năm ⇒ nhẹ; vẫn phân trang. */
export async function loadNormMeterReadings(factoryId: string, meterId?: string): Promise<NormMeterReading[]> {
  const rows = await fetchAllPaginated<NormMeterReading>((from, to) => {
    let q = supabase.from("tech_norm_meter_readings").select(READING_COLS).eq("factory_id", factoryId)
    if (meterId) q = q.eq("meter_id", meterId)
    return q.order("ngay").order("id").range(from, to)
  })
  return rows.map(normalizeReading)
}

export async function loadNormFloorLocations(factoryId: string): Promise<NormFloorLocation[]> {
  return fetchAllPaginated<NormFloorLocation>((from, to) =>
    supabase
      .from("tech_norm_floor_locations")
      .select("id,factory_id,code,name,sort_order,is_active")
      .eq("factory_id", factoryId)
      .order("sort_order")
      .order("code")
      .order("id")
      .range(from, to),
  )
}

/** Kiểm kê của đúng 1 ngày. */
export async function loadNormFloorCounts(factoryId: string, ngay: string): Promise<NormFloorCount[]> {
  const rows = await fetchAllPaginated<NormFloorCount>((from, to) =>
    supabase
      .from("tech_norm_floor_counts")
      .select("id,ngay,location_id,norm_item_id,so_luong,image_urls,ghi_chu")
      .eq("factory_id", factoryId)
      .eq("ngay", ngay)
      .order("id")
      .range(from, to),
  )
  return rows.map((r) => ({ ...r, so_luong: Number(r.so_luong), image_urls: r.image_urls || [] }))
}

/** Các ngày đã có kiểm kê (mới nhất trước) — để chọn nhanh. */
export async function loadNormFloorCountDates(factoryId: string): Promise<string[]> {
  const rows = await fetchAllPaginated<{ ngay: string }>((from, to) =>
    supabase.from("tech_norm_floor_counts").select("ngay").eq("factory_id", factoryId).order("ngay", { ascending: false }).order("id").range(from, to),
  )
  return [...new Set(rows.map((r) => r.ngay))]
}
