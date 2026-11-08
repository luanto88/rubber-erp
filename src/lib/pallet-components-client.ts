// Loader trình duyệt cho bảng pallet_components — lỗi / chưa migration ⇒ DEFAULT_PALLET_COMPONENTS.
import { supabase } from "@/lib/supabase"
import {
  buildPalletComponentsConfig,
  DEFAULT_PALLET_COMPONENTS,
  PALLET_COMPONENTS_SELECT,
  type PalletComponentsConfig,
} from "@/lib/pallet-components"

export async function loadPalletComponents(factoryId: string | null | undefined): Promise<PalletComponentsConfig> {
  if (!factoryId) return DEFAULT_PALLET_COMPONENTS
  try {
    const { data, error } = await supabase
      .from("pallet_components")
      .select(PALLET_COMPONENTS_SELECT)
      .eq("factory_id", factoryId)
      .order("sort_order")
    if (error) console.warn("[pallet-components] dùng danh sách mặc định:", error.message)
    return buildPalletComponentsConfig(data, !!error)
  } catch (e) {
    console.warn("[pallet-components] dùng danh sách mặc định:", e)
    return DEFAULT_PALLET_COMPONENTS
  }
}
