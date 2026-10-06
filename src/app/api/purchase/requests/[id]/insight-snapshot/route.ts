import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { loadPurchaseItemInsight } from "@/lib/purchase/server"
import { insightDaysLeft, isPurchaseEditable, type PurchaseInsightSnapshot, type PurchaseStatus } from "@/lib/purchase/types"

export const dynamic = "force-dynamic"

// POST — Chụp số liệu bằng chứng (tồn, tiêu hao, lần mua trước, phiếu khác còn mở) cho TỪNG dòng
// vật tư, ngay trước khi dựng PDF gửi ký. Ghi vào purchase_request_lines.insight_snapshot rồi trả
// về cho client in lên PDF. Route submit kiểm bản chụp còn mới (PURCHASE_SNAPSHOT_MAX_AGE_MIN).
// Gửi lại sau "Trả về" → luồng gửi luôn gọi lại bước này ⇒ chụp lại số liệu mới.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    const { id } = await params

    const { data: request } = await supabaseAdmin
      .from("purchase_requests")
      .select("id, nguoi_de_nghi_id, trang_thai")
      .eq("id", id)
      .eq("factory_id", actor.factoryId)
      .maybeSingle()
    if (!request) return NextResponse.json({ error: "Không tìm thấy phiếu" }, { status: 404 })
    if (request.nguoi_de_nghi_id !== actor.userId) {
      return NextResponse.json({ error: "Chỉ người đề nghị được gửi ký" }, { status: 403 })
    }
    if (!isPurchaseEditable(request.trang_thai as PurchaseStatus)) {
      return NextResponse.json({ error: "Phiếu đã được gửi ký" }, { status: 409 })
    }

    const { data: lines, error: lineErr } = await supabaseAdmin
      .from("purchase_request_lines")
      .select("id, item_id")
      .eq("request_id", id)
    if (lineErr) return NextResponse.json({ error: lineErr.message }, { status: 400 })

    const capturedAt = new Date().toISOString()
    const snapshots: Record<string, PurchaseInsightSnapshot> = {}
    for (const line of (lines || []) as { id: string; item_id: string | null }[]) {
      if (!line.item_id) continue
      const ins = await loadPurchaseItemInsight(actor.factoryId, {
        itemId: line.item_id, excludeRequestId: id, includeCategorySamples: false,
      })
      if (!ins) continue
      // Bỏ `item` (chi tiết danh mục) và giá mẫu cùng nhóm — không phải bằng chứng cho người duyệt.
      const { item: _item, categorySamples: _samples, ...rest } = ins
      void _item; void _samples
      const snap: PurchaseInsightSnapshot = { ...rest, capturedAt, daysLeft: insightDaysLeft(rest) }
      const { error } = await supabaseAdmin
        .from("purchase_request_lines")
        .update({ insight_snapshot: snap })
        .eq("id", line.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      snapshots[line.id] = snap
    }

    return NextResponse.json({ snapshots, capturedAt })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}
