// Helper SERVER-ONLY cho module Đề nghị mua vật tư (service role). Không import vào client.
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import type {
  PurchaseEffectiveLine, PurchaseItemInsight, PurchaseLineRow, PurchaseRequestRow, PurchaseSigner, PurchaseStatus,
} from "./types"

/** Thông số hiệu lực + số đã nhập kho của từng dòng gốc (RPC purchase_effective_lines). */
export async function loadEffectiveLines(requestId: string): Promise<PurchaseEffectiveLine[]> {
  const { data, error } = await getSupabaseAdmin().rpc("purchase_effective_lines", { p_request_id: requestId })
  if (error) throw new Error(error.message)
  return ((data || []) as PurchaseEffectiveLine[]).map((r) => ({
    ...r,
    so_luong: Number(r.so_luong),
    don_gia: Number(r.don_gia),
    received: Number(r.received),
  }))
}

/** Phiếu điều chỉnh đang chờ (nháp / đang ký / bị trả về) của 1 phiếu gốc. */
export async function findPendingAdjustment(parentId: string): Promise<{ id: string; so: number; nam: number } | null> {
  const { data } = await getSupabaseAdmin()
    .from("purchase_requests")
    .select("id, so, nam")
    .eq("parent_request_id", parentId)
    .eq("loai", "dieu_chinh")
    .in("trang_thai", ["nhap", "cho_ky", "tra_ve"])
    .limit(1)
    .maybeSingle()
  return (data as { id: string; so: number; nam: number } | null) || null
}

export async function insertPurchaseLog(params: {
  requestId: string
  factoryId: string
  userId: string | null
  hanhDong: string
  noiDung?: string | null
}) {
  const { error } = await getSupabaseAdmin().from("purchase_request_logs").insert({
    request_id: params.requestId,
    factory_id: params.factoryId,
    user_id: params.userId,
    hanh_dong: params.hanhDong,
    noi_dung: params.noiDung ?? null,
  })
  if (error) console.warn("[purchase] Không ghi được nhật ký:", error.message)
}

/** Người được xem 1 phiếu: người đề nghị/người tạo/GĐ/Kế toán được chọn, hoặc view_all/admin. */
export function isPurchaseParticipant(req: Pick<PurchaseRequestRow, "nguoi_de_nghi_id" | "giam_doc_user_id" | "ke_toan_user_id"> & { created_by?: string | null }, userId: string): boolean {
  return [req.nguoi_de_nghi_id, req.giam_doc_user_id, req.ke_toan_user_id, req.created_by].includes(userId)
}

export async function loadPurchaseSigners(yeuCauId: string | null): Promise<PurchaseSigner[]> {
  if (!yeuCauId) return []
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from("nguoi_ky")
    .select("user_id, thu_tu, vai_tro, trang_thai, ky_luc")
    .eq("yeu_cau_id", yeuCauId)
    .order("thu_tu")
  const rows = (data || []) as { user_id: string; thu_tu: number; vai_tro: string; trang_thai: string; ky_luc: string | null }[]
  if (!rows.length) return []
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, username")
    .in("id", rows.map((r) => r.user_id))
  const nameById = new Map<string, string>()
  for (const p of (profiles || []) as { id: string; full_name: string | null; username: string | null }[]) {
    nameById.set(p.id, p.full_name || p.username || "")
  }
  return rows.map((r) => ({
    userId: r.user_id,
    thuTu: r.thu_tu,
    vaiTro: r.vai_tro,
    trangThai: r.trang_thai,
    hoTen: nameById.get(r.user_id) || "",
    kyLuc: r.ky_luc,
  }))
}

export async function loadPurchaseLines(requestId: string): Promise<PurchaseLineRow[]> {
  const { data } = await getSupabaseAdmin()
    .from("purchase_request_lines")
    .select("*")
    .eq("request_id", requestId)
    .order("sort_order")
  return (data || []) as PurchaseLineRow[]
}

/**
 * Đồng bộ `purchase_requests.trang_thai` theo yêu cầu ký (gọi sau khi ký / trả về).
 * Không đụng phiếu đã huỷ/đóng/đang mua/hoàn tất. Lỗi chỉ log, không ném — không được làm
 * hỏng lượt ký đã thành công.
 */
export async function syncPurchaseFromSigning(yeuCauId: string): Promise<void> {
  try {
    const supabase = getSupabaseAdmin()
    const { data: yc } = await supabase
      .from("yeu_cau_ky")
      .select("id, modun, ban_ghi_id, trang_thai, tra_ve_ly_do, factory_id")
      .eq("id", yeuCauId)
      .maybeSingle()
    if (!yc || yc.modun !== "purchase" || !yc.ban_ghi_id) return

    const { data: req } = await supabase
      .from("purchase_requests")
      .select("id, trang_thai, yeu_cau_ky_id, loai, parent_request_id, so, nam")
      .eq("id", yc.ban_ghi_id)
      .maybeSingle()
    if (!req || req.yeu_cau_ky_id !== yc.id) return
    const current = req.trang_thai as PurchaseStatus
    if (current !== "cho_ky" && current !== "tra_ve") return
    const isAdjustment = req.loai === "dieu_chinh"

    let next: PurchaseStatus = current
    const patch: Record<string, unknown> = {}
    if (yc.trang_thai === "hoan_tat") {
      // Phiếu điều chỉnh duyệt xong là "đã áp dụng" — nó không tự nhập kho, việc nhập vẫn theo
      // phiếu gốc với thông số mới. Gắn 'hoan_tat' để khỏi lẫn vào danh sách "đang mua".
      next = isAdjustment ? "hoan_tat" : "da_duyet"
      patch.ngay_duyet = new Date().toISOString()
    } else if (yc.trang_thai === "dang_luan_chuyen") {
      next = yc.tra_ve_ly_do ? "tra_ve" : "cho_ky"
    }
    if (next === current) return
    patch.trang_thai = next
    patch.updated_at = new Date().toISOString()
    await supabase.from("purchase_requests").update(patch).eq("id", req.id)
    if (next === "tra_ve") {
      await insertPurchaseLog({
        requestId: req.id, factoryId: yc.factory_id as string, userId: null,
        hanhDong: "tra_ve", noiDung: (yc.tra_ve_ly_do as string) || null,
      })
    } else if (next === "da_duyet") {
      await insertPurchaseLog({ requestId: req.id, factoryId: yc.factory_id as string, userId: null, hanhDong: "da_duyet" })
    } else if (isAdjustment && next === "hoan_tat") {
      await insertPurchaseLog({ requestId: req.id, factoryId: yc.factory_id as string, userId: null, hanhDong: "da_duyet" })
      if (req.parent_request_id) {
        await insertPurchaseLog({
          requestId: req.parent_request_id as string, factoryId: yc.factory_id as string, userId: null,
          hanhDong: "dieu_chinh_duyet", noiDung: `Phiếu điều chỉnh ${String(req.so).padStart(2, "0")}/ĐNMVT (${req.nam}) đã duyệt — áp dụng thông số mới`,
        })
        // SL duyệt có thể giảm xuống bằng số đã nhập → phiếu gốc hoàn tất.
        const { error } = await supabase.rpc("purchase_recompute_request", { p_request_id: req.parent_request_id })
        if (error) console.warn("[purchase] Không tính lại được phiếu gốc:", error.message)
      }
    }
  } catch (err) {
    console.error("[purchase] Lỗi đồng bộ trạng thái:", err)
  }
}

// ── Thông tin hỗ trợ chọn vật tư / bằng chứng cho người duyệt ────────────────
// Dùng chung cho GET /api/purchase/item-insight (form) và bước chụp số liệu lúc gửi ký
// (POST /api/purchase/requests/[id]/insight-snapshot). Không gọi HTTP nội bộ.

const INSIGHT_APPROVED = ["da_duyet", "dang_mua", "hoan_tat"]
const INSIGHT_OPEN = ["nhap", "cho_ky", "tra_ve", "da_duyet", "dang_mua"]

type InsightLineJoin = {
  item_id: string | null
  so_luong: number
  don_gia: number
  request_id: string
  purchase_requests: { id: string; ngay: string; so: number; nam: number; loai_tien: string; trang_thai: string; factory_id: string } | null
}

export type PurchaseItemInsightResult = PurchaseItemInsight & { item: Record<string, unknown> | null }

/**
 * Tồn thực tế theo kho (dầu dùng chung bồn đọc pool của kho), 5 lần đề nghị đã duyệt gần nhất,
 * phiếu khác còn mở, 3 lần nhập/xuất gần nhất, tiêu hao 90 ngày, giá mẫu cùng nhóm.
 * Trả null nếu itemId không thuộc nhà máy.
 */
export async function loadPurchaseItemInsight(
  factoryId: string,
  opts: { itemId?: string | null; categoryId?: string | null; excludeRequestId?: string | null; includeCategorySamples?: boolean },
): Promise<PurchaseItemInsightResult | null> {
  const supabase = getSupabaseAdmin()
  const itemId = opts.itemId || null
  let categoryId = opts.categoryId || null
  const excludeRequestId = opts.excludeRequestId || null

  let item: Record<string, unknown> | null = null
  if (itemId) {
    const { data } = await supabase
      .from("inventory_items")
      .select("id, code, name, unit, category_id, don_gia, loai_tien, default_warehouse_ids, uses_shared_oil_stock, min_stock, max_stock, nguon_tao")
      .eq("id", itemId)
      .eq("factory_id", factoryId)
      .maybeSingle()
    if (!data) return null
    item = data
    categoryId = (data.category_id as string) || categoryId
  }

  // ── Tồn kho ──
  const stock: PurchaseItemInsight["stock"] = []
  if (item) {
    const { data: whs } = await supabase.from("inventory_warehouses").select("id, code, name").eq("factory_id", factoryId)
    const whMap = new Map(((whs || []) as { id: string; code: string; name: string }[]).map((w) => [w.id, w]))
    if (item.uses_shared_oil_stock) {
      const whIds = ((item.default_warehouse_ids as string[] | null) || []).filter(Boolean)
      if (whIds.length) {
        const { data: pools } = await supabase
          .from("inventory_oil_stock_pools")
          .select("warehouse_id, on_hand")
          .eq("factory_id", factoryId)
          .in("warehouse_id", whIds)
        for (const p of (pools || []) as { warehouse_id: string; on_hand: number }[]) {
          const w = whMap.get(p.warehouse_id)
          stock.push({ warehouseId: p.warehouse_id, code: w?.code || "", name: w?.name || "", onHand: Number(p.on_hand || 0) })
        }
      }
    } else {
      const { data: bals } = await supabase
        .from("inventory_stock_balances")
        .select("warehouse_id, on_hand")
        .eq("factory_id", factoryId)
        .eq("item_id", itemId!)
      for (const b of (bals || []) as { warehouse_id: string; on_hand: number }[]) {
        const w = whMap.get(b.warehouse_id)
        stock.push({ warehouseId: b.warehouse_id, code: w?.code || "", name: w?.name || "", onHand: Number(b.on_hand || 0) })
      }
    }
  }

  // ── Lịch sử đề nghị đã duyệt + phiếu còn mở ──
  const recentPurchases: PurchaseItemInsight["recentPurchases"] = []
  const openRequests: PurchaseItemInsight["openRequests"] = []
  if (itemId) {
    const { data: lines } = await supabase
      .from("purchase_request_lines")
      .select("item_id, so_luong, don_gia, request_id, purchase_requests!inner(id, ngay, so, nam, loai_tien, trang_thai, factory_id)")
      .eq("factory_id", factoryId)
      .eq("item_id", itemId)
      .order("created_at", { ascending: false })
      .limit(60)
    for (const l of (lines || []) as unknown as InsightLineJoin[]) {
      const r = l.purchase_requests
      if (!r) continue
      if (INSIGHT_APPROVED.includes(r.trang_thai)) {
        recentPurchases.push({ ngay: r.ngay, so: r.so, nam: r.nam, soLuong: Number(l.so_luong), donGia: Number(l.don_gia), loaiTien: r.loai_tien })
      }
      if (INSIGHT_OPEN.includes(r.trang_thai) && r.id !== excludeRequestId) {
        openRequests.push({ id: r.id, so: r.so, nam: r.nam, trangThai: r.trang_thai, soLuong: Number(l.so_luong) })
      }
    }
    recentPurchases.sort((a, b) => b.ngay.localeCompare(a.ngay))
    recentPurchases.splice(5)
  }

  // ── Nhập / xuất kho ──
  // inventory_cancel_document XOÁ hẳn movement của phiếu bị huỷ ⇒ không cần lọc phiếu huỷ. Dầu
  // dùng chung bồn vẫn lấy lịch sử theo đúng mã vật tư (không gộp các mã cùng bồn).
  let recentImports: { ngay: string; soLuong: number }[] = []
  let recentExports: { ngay: string; soLuong: number }[] = []
  let export90 = 0
  if (itemId) {
    const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
    const [imp, exp, sum] = await Promise.all([
      supabase.from("inventory_stock_movements").select("movement_date, quantity_in, quantity_out")
        .eq("factory_id", factoryId).eq("item_id", itemId).eq("movement_type", "import")
        .order("movement_date", { ascending: false }).order("created_at", { ascending: false }).limit(3),
      supabase.from("inventory_stock_movements").select("movement_date, quantity_in, quantity_out")
        .eq("factory_id", factoryId).eq("item_id", itemId).eq("movement_type", "export")
        .order("movement_date", { ascending: false }).order("created_at", { ascending: false }).limit(3),
      supabase.from("inventory_stock_movements").select("quantity_out")
        .eq("factory_id", factoryId).eq("item_id", itemId).eq("movement_type", "export")
        .gte("movement_date", since).limit(1000),
    ])
    type Mv = { movement_date: string; quantity_in: number | null; quantity_out: number | null }
    recentImports = ((imp.data || []) as Mv[]).map((m) => ({ ngay: m.movement_date, soLuong: Number(m.quantity_in || 0) }))
    recentExports = ((exp.data || []) as Mv[]).map((m) => ({ ngay: m.movement_date, soLuong: Number(m.quantity_out || 0) }))
    export90 = ((sum.data || []) as { quantity_out: number }[]).reduce((s, r) => s + Number(r.quantity_out || 0), 0)
  }

  // ── Giá mẫu cùng nhóm (đề nghị đã duyệt 365 ngày gần nhất) ──
  const categorySamples: { donGia: number; loaiTien: string; requestId: string }[] = []
  if (categoryId && opts.includeCategorySamples !== false) {
    const since = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)
    const { data: catLines } = await supabase
      .from("purchase_request_lines")
      .select("don_gia, item_id, request_id, inventory_items!inner(category_id), purchase_requests!inner(loai_tien, trang_thai, ngay)")
      .eq("factory_id", factoryId)
      .eq("inventory_items.category_id", categoryId)
      .in("purchase_requests.trang_thai", INSIGHT_APPROVED)
      .gte("purchase_requests.ngay", since)
      .limit(200)
    for (const l of (catLines || []) as unknown as { don_gia: number; item_id: string; request_id: string; purchase_requests: { loai_tien: string } | null }[]) {
      if (l.item_id === itemId || !l.purchase_requests || !(Number(l.don_gia) > 0)) continue
      categorySamples.push({ donGia: Number(l.don_gia), loaiTien: l.purchase_requests.loai_tien, requestId: l.request_id })
    }
  }

  return {
    item,
    stock,
    totalStock: stock.reduce((s, r) => s + r.onHand, 0),
    recentPurchases,
    openRequests,
    lastImportDate: recentImports[0]?.ngay || null,
    lastExportDate: recentExports[0]?.ngay || null,
    recentImports,
    recentExports,
    export90,
    categorySamples,
  }
}
