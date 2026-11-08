// Loader server (service role) cho bảng product_packaging_types — CHỈ dùng trong server action / API route.
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { buildPackagingConfig, DEFAULT_PACKAGING, PACKAGING_SELECT, type PackagingConfig } from "@/lib/product-packaging"

export async function loadPackagingConfigServer(factoryId: string | null | undefined): Promise<PackagingConfig> {
  if (!factoryId) return DEFAULT_PACKAGING
  try {
    const { data, error } = await getSupabaseAdmin()
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
