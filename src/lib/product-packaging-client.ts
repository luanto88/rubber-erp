// Loader trình duyệt cho bảng product_packaging_types — lỗi / chưa migration ⇒ DEFAULT_PACKAGING.
import { supabase } from "@/lib/supabase"
import { buildPackagingConfig, DEFAULT_PACKAGING, PACKAGING_SELECT, type PackagingConfig } from "@/lib/product-packaging"

export async function loadPackagingConfig(factoryId: string | null | undefined): Promise<PackagingConfig> {
  if (!factoryId) return DEFAULT_PACKAGING
  try {
    const { data, error } = await supabase
      .from("product_packaging_types")
      .select(PACKAGING_SELECT)
      .eq("factory_id", factoryId)
      .order("sort_order")
    if (error) console.warn("[packaging] dùng danh sách mặc định:", error.message)
    return buildPackagingConfig(data, !!error)
  } catch (e) {
    console.warn("[packaging] dùng danh sách mặc định:", e)
    return DEFAULT_PACKAGING
  }
}
