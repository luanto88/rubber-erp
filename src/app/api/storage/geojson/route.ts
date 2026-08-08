import { readFile } from "node:fs/promises"
import path from "node:path"
import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { loadStorageGeoJson, type StorageGeoJsonFeature, type StorageNgan } from "@/lib/storage-detail"

export const dynamic = "force-dynamic"

const STATIC_GEOJSON_PATH = path.join(process.cwd(), "public", "geojson", "Lo cao su - 2026_Full.geojson")

async function loadStaticFallbackFromDisk() {
  const raw = await readFile(STATIC_GEOJSON_PATH, "utf-8")
  return JSON.parse(raw) as { features?: StorageGeoJsonFeature[] }
}

type GeoJsonRequestBody = {
  factoryId?: string
  ngan?: Pick<StorageNgan, "id" | "ten_ngan" | "ma_ngan" | "loai_nl" | "trips">
}

// POST /api/storage/geojson  { factoryId, ngan }
//
// Route CÔNG KHAI, mirror `/api/storage/public-lookup` — dùng cho khối "Bản đồ lô thu hoạch"
// của trang chi tiết ngăn (`/storage`, `/dashboard/storage/[id]`). Trước 2026-08-08,
// `StorageDetailClient` đọc thẳng `dispatch_entries` bằng anon key để suy ra mã lô vườn; sau
// khi khóa RLS SELECT của bảng đó, khách chưa đăng nhập không còn tự đọc được nữa — route này
// dùng service role thay thế, chỉ tính geojson cho ĐÚNG `ngan`/`factoryId` mà client đã có
// được từ `/api/storage/public-lookup` trước đó (không dump toàn bộ dispatch_entries).
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as GeoJsonRequestBody | null
    const factoryId = body?.factoryId?.trim()
    const ngan = body?.ngan

    if (!factoryId || !ngan?.id) {
      return NextResponse.json({ error: "Thiếu factoryId hoặc thông tin ngăn." }, { status: 400 })
    }

    const admin = getSupabaseAdmin()
    const geojson = await loadStorageGeoJson(factoryId, ngan, admin, loadStaticFallbackFromDisk)

    return NextResponse.json(geojson)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 500 },
    )
  }
}
