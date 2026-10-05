import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoActorHasPermission, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { normalizeName } from "@/lib/similar-name"

export const dynamic = "force-dynamic"

// POST — tạo nhanh vật tư mới từ phiếu đề nghị mua (ghi thẳng danh mục kho, gắn cờ
// nguon_tao = 'de_nghi_mua'). Cảnh báo tên GẦN GIỐNG làm ở client (người dùng xác nhận);
// ở đây chặn cứng TRÙNG TUYỆT ĐỐI tên đã chuẩn hoá và trùng mã.

type Body = {
  name: string
  unit: string
  categoryId: string
  warehouseId: string
  specification?: string | null
  code?: string | null
  donGia?: number | null
  loaiTien?: string | null
}

async function nextCode(factoryId: string, prefix: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("inventory_items")
    .select("code")
    .eq("factory_id", factoryId)
    .ilike("code", `${prefix}-%`)
  let max = 0
  for (const r of (data || []) as { code: string }[]) {
    const m = r.code.slice(prefix.length + 1).match(/^(\d+)$/)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`
}

export async function POST(req: NextRequest) {
  try {
    const actor = await resolveIsoActor(req)
    if (!(await isoActorHasPermission(actor, ["purchase.create"]))) {
      return NextResponse.json({ error: "Bạn không có quyền tạo đề nghị mua vật tư" }, { status: 403 })
    }
    const body = (await req.json()) as Body
    const name = String(body.name || "").trim()
    const unit = String(body.unit || "").trim()
    if (!name || !unit || !body.categoryId || !body.warehouseId) {
      return NextResponse.json({ error: "Cần nhập Tên, ĐVT, Phân loại và Kho" }, { status: 400 })
    }

    const factoryId = actor.factoryId
    const [{ data: category }, { data: warehouse }] = await Promise.all([
      supabaseAdmin.from("inventory_item_categories").select("id, code").eq("id", body.categoryId).eq("factory_id", factoryId).maybeSingle(),
      supabaseAdmin.from("inventory_warehouses").select("id, code").eq("id", body.warehouseId).eq("factory_id", factoryId).maybeSingle(),
    ])
    if (!category) return NextResponse.json({ error: "Phân loại vật tư không hợp lệ" }, { status: 400 })
    if (!warehouse) return NextResponse.json({ error: "Kho không hợp lệ" }, { status: 400 })

    // Trùng tuyệt đối tên (sau chuẩn hoá bỏ dấu) → chặn, trả vật tư đang có để client chọn dùng.
    const target = normalizeName(name)
    // Phân trang — PostgREST cắt 1000 dòng/truy vấn.
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
    const dup = allItems.find(
      (it) => normalizeName(it.name) === target,
    )
    if (dup) {
      return NextResponse.json(
        { error: `Vật tư "${dup.name}" (${dup.code}) đã có trong danh mục — hãy chọn vật tư này.`, existing: dup },
        { status: 409 },
      )
    }

    let code = String(body.code || "").trim().toUpperCase()
    if (!code) code = await nextCode(factoryId, String(category.code || "VT").toUpperCase())
    const { data: codeDup } = await supabaseAdmin
      .from("inventory_items").select("id").eq("factory_id", factoryId).eq("code", code).maybeSingle()
    if (codeDup) return NextResponse.json({ error: `Mã vật tư ${code} đã tồn tại` }, { status: 409 })

    const { data: item, error } = await supabaseAdmin
      .from("inventory_items")
      .insert({
        factory_id: factoryId,
        category_id: body.categoryId,
        code,
        name,
        unit,
        specification: body.specification?.trim() || null,
        default_warehouse_ids: [body.warehouseId],
        manages_lot: false,
        manages_expiry: false,
        min_stock: 0,
        max_stock: 0,
        opening_stock: 0,
        uses_shared_oil_stock: false,
        is_active: true,
        don_gia: Number(body.donGia) > 0 ? Number(body.donGia) : 0,
        loai_tien: body.loaiTien || "USD",
        nguon_tao: "de_nghi_mua",
      })
      .select("id, code, name, unit, category_id, don_gia, loai_tien")
      .single()
    if (error || !item) return NextResponse.json({ error: error?.message || "Không tạo được vật tư" }, { status: 400 })

    const { error: ruleErr } = await supabaseAdmin.from("inventory_item_warehouse_rules").insert({
      factory_id: factoryId,
      item_id: item.id,
      warehouse_id: body.warehouseId,
      min_stock: 0,
      max_stock: 0,
      reorder_point: 0,
      safety_stock: 0,
      is_primary: true,
    })
    if (ruleErr) console.warn("[purchase/items] Không tạo được rule kho:", ruleErr.message)

    return NextResponse.json({ item })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}
