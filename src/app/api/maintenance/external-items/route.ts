import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoActorHasPermission, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { normalizeName } from "@/lib/similar-name"
import { findKtWarehouse } from "@/lib/maintenance-kt"

export const dynamic = "force-dynamic"

// POST — tạo vật tư MUA NGOÀI cho Bảo trì (từ biên bản hoặc Cài đặt → Bảo trì → Vật tư mua ngoài).
// Ghi thẳng `inventory_items` (nguon_tao = 'bao_tri_mua_ngoai'), kho mặc định do người dùng chọn
// (để trống = Kho tạm KT), để
// luồng Đề nghị mua → nhập KT → xuất KT dùng được mã này (purchase_request_lines.item_id có FK
// tới inventory_items). Trước đây vật tư mới nằm ở `maintenance_external_materials` ⇒ lập đề nghị
// mua bị lỗi `purchase_request_lines_item_id_fkey`.

type Body = {
  code: string
  name: string
  categoryId: string
  unit: string
  donGia: number
  loaiTien?: string | null
  specification?: string | null
  imageUrl?: string | null
  warehouseId?: string | null
}

// Ảnh đại diện chỉ nhận URL public của Storage dự án (ảnh upload/chụp qua app), không nhận link ngoài.
function isOwnStorageUrl(url: string): boolean {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "")
  return !!base && url.startsWith(`${base}/storage/v1/object/public/`)
}

const PERMISSIONS = [
  "maintenance.create",
  "maintenance.edit",
  "settings.maintenance_config",
  "settings.manage_config",
]

const CURRENCIES = new Set(["USD", "VND", "KHR"])

export async function POST(req: NextRequest) {
  try {
    const actor = await resolveIsoActor(req)
    if (!(await isoActorHasPermission(actor, PERMISSIONS))) {
      return NextResponse.json({ error: "Bạn không có quyền tạo vật tư mua ngoài" }, { status: 403 })
    }
    const body = (await req.json()) as Body
    const code = String(body.code || "").trim().toUpperCase()
    const name = String(body.name || "").trim()
    const unit = String(body.unit || "").trim()
    const categoryId = String(body.categoryId || "").trim()
    const donGia = Number(body.donGia)
    const loaiTien = CURRENCIES.has(String(body.loaiTien || "")) ? String(body.loaiTien) : "USD"
    const imageUrl = String(body.imageUrl || "").trim()

    const missing: string[] = []
    if (!code) missing.push("Mã vật tư")
    if (!name) missing.push("Tên vật tư")
    if (!categoryId) missing.push("Phân loại vật tư")
    if (!unit) missing.push("Đơn vị tính")
    if (!(Number.isFinite(donGia) && donGia > 0)) missing.push("Đơn giá (> 0)")
    if (missing.length) {
      return NextResponse.json({ error: `Cần nhập: ${missing.join(", ")}` }, { status: 400 })
    }
    if (imageUrl && !isOwnStorageUrl(imageUrl)) {
      return NextResponse.json({ error: "Hình ảnh phải được tải lên hoặc chụp trực tiếp trong ứng dụng" }, { status: 400 })
    }

    const factoryId = actor.factoryId
    const { data: category } = await supabaseAdmin
      .from("inventory_item_categories").select("id").eq("id", categoryId).eq("factory_id", factoryId).maybeSingle()
    if (!category) return NextResponse.json({ error: "Phân loại vật tư không hợp lệ" }, { status: 400 })

    // Kho mặc định: kho người dùng chọn (phải thuộc nhà máy), để trống = Kho tạm KT.
    const warehouseId = String(body.warehouseId || "").trim()
    let warehouse: { id: string; code: string } | null = null
    if (warehouseId) {
      const { data: wh } = await supabaseAdmin
        .from("inventory_warehouses").select("id, code").eq("id", warehouseId).eq("factory_id", factoryId).maybeSingle()
      if (!wh) return NextResponse.json({ error: "Kho mặc định không hợp lệ" }, { status: 400 })
      warehouse = wh as { id: string; code: string }
    } else {
      warehouse = await findKtWarehouse(factoryId)
      if (!warehouse) {
        return NextResponse.json(
          { error: "Chưa có kho tạm mã KT — chọn kho mặc định khác hoặc vào Cài đặt → Cấu hình nhà máy → Kho để tạo trước." },
          { status: 400 },
        )
      }
    }

    // Trùng tuyệt đối tên (sau chuẩn hoá bỏ dấu) hoặc trùng mã → chặn, trả vật tư đang có.
    const target = normalizeName(name)
    const allItems: { id: string; code: string; name: string; unit: string }[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error: listErr } = await supabaseAdmin
        .from("inventory_items")
        .select("id, code, name, unit")
        .eq("factory_id", factoryId)
        .order("id")
        .range(from, from + 999)
      if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 })
      allItems.push(...((data || []) as typeof allItems))
      if (!data || data.length < 1000) break
    }
    const codeDup = allItems.find((it) => (it.code || "").trim().toUpperCase() === code)
    if (codeDup) {
      return NextResponse.json(
        { error: `Mã vật tư ${code} đã tồn tại (${codeDup.name}) — hãy chọn vật tư này.`, existing: codeDup },
        { status: 409 },
      )
    }
    const nameDup = allItems.find((it) => normalizeName(it.name) === target)
    if (nameDup) {
      return NextResponse.json(
        { error: `Vật tư "${nameDup.name}" (${nameDup.code}) đã có trong danh mục — hãy chọn vật tư này.`, existing: nameDup },
        { status: 409 },
      )
    }

    const { data: item, error } = await supabaseAdmin
      .from("inventory_items")
      .insert({
        factory_id: factoryId,
        category_id: categoryId,
        code,
        name,
        unit,
        specification: body.specification?.trim() || null,
        image_url: imageUrl || null,
        default_warehouse_ids: [warehouse.id],
        manages_lot: false,
        manages_expiry: false,
        min_stock: 0,
        max_stock: 0,
        opening_stock: 0,
        uses_shared_oil_stock: false,
        is_active: true,
        don_gia: donGia,
        loai_tien: loaiTien,
        nguon_tao: "bao_tri_mua_ngoai",
      })
      .select("id, code, name, unit, specification, category_id, image_url, don_gia, loai_tien, default_warehouse_ids, is_active")
      .single()
    if (error || !item) return NextResponse.json({ error: error?.message || "Không tạo được vật tư" }, { status: 400 })

    const { error: ruleErr } = await supabaseAdmin.from("inventory_item_warehouse_rules").insert({
      factory_id: factoryId,
      item_id: item.id,
      warehouse_id: warehouse.id,
      min_stock: 0,
      max_stock: 0,
      reorder_point: 0,
      safety_stock: 0,
      is_primary: true,
    })
    if (ruleErr) console.warn("[maintenance/external-items] Không tạo được rule kho:", ruleErr.message)

    return NextResponse.json({ item, warehouse: { id: warehouse.id, code: warehouse.code } })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}
