// Loader server (service role) cho product_grade_types + factories.prefix — CHỈ server action / API route.
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { loadGradeConfigWith, type GradeConfig } from "@/lib/product-grade"

export function loadGradeConfigServer(factoryId: string | null | undefined): Promise<GradeConfig> {
  return loadGradeConfigWith(getSupabaseAdmin(), factoryId)
}
