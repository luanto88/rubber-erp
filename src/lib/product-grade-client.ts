// Loader trình duyệt cho product_grade_types + factories.prefix — lỗi / chưa migration ⇒ quy tắc cũ.
import { supabase } from "@/lib/supabase"
import { loadGradeConfigWith, type GradeConfig } from "@/lib/product-grade"

export function loadGradeConfig(factoryId: string | null | undefined): Promise<GradeConfig> {
  return loadGradeConfigWith(supabase, factoryId)
}
