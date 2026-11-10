// Định mức KTKT — loader trình duyệt (supabase anon, RLS norms.view). Rule 30.

import { supabase } from "@/lib/supabase"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import type { NormItem, NormRow, NormValue, NormVersion, NormVersionItem } from "./types"

const ITEM_COLS = "id,factory_id,code,name,norm_group,actual_source,inventory_item_ids,vehicle_types,ghi_chu,sort_order,is_active"
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
