import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoActorHasPermission, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { insertPurchaseLog, isMaintenanceRecordTeam } from "@/lib/purchase/server"
import { isPurchaseEditable, type PurchaseStatus } from "@/lib/purchase/types"

export const dynamic = "force-dynamic"

// PATCH { giamDocUserId, keToanUserId } — CHỈ đổi người ký (Giám đốc / Kế toán) của phiếu đang
// Nháp / Bị trả về, dùng cho panel "Gửi ký duyệt". Khác POST lưu phiếu: không xoá/chèn lại dòng
// vật tư (giữ ảnh dòng + bản chụp bằng chứng).
// Phiếu lập từ biên bản bảo trì: người trong nhóm phụ trách biên bản (người tạo + NV phụ trách, có
// purchase.create) gửi ký thì thành người đề nghị — "người gửi ký đầu tiên chiếm quyền"; sau khi gửi,
// chỉ người đề nghị thao tác (trừ khi phiếu bị trả về).

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as { giamDocUserId?: string; keToanUserId?: string }
    const giamDocId = String(body.giamDocUserId || "").trim()
    const keToanId = String(body.keToanUserId || "").trim()
    if (!giamDocId || !keToanId) return NextResponse.json({ error: "Chọn đủ Giám đốc và Kế toán" }, { status: 400 })
    if (giamDocId === keToanId) return NextResponse.json({ error: "Giám đốc và Kế toán phải là 2 người khác nhau" }, { status: 400 })
    if (giamDocId === actor.userId || keToanId === actor.userId) {
      return NextResponse.json({ error: "Người đề nghị không được đồng thời là người duyệt" }, { status: 400 })
    }

    const { data: request } = await supabaseAdmin
      .from("purchase_requests")
      .select("id, nguoi_de_nghi_id, trang_thai, loai, maintenance_record_id")
      .eq("id", id)
      .eq("factory_id", actor.factoryId)
      .maybeSingle()
    if (!request) return NextResponse.json({ error: "Không tìm thấy phiếu" }, { status: 404 })
    if (!isPurchaseEditable(request.trang_thai as PurchaseStatus)) {
      return NextResponse.json({ error: "Phiếu đã gửi ký/đã duyệt, không đổi được người ký" }, { status: 409 })
    }

    const isOwner = request.nguoi_de_nghi_id === actor.userId
    const hasCreatePerm = await isoActorHasPermission(actor, ["purchase.create"])
    if (!hasCreatePerm) {
      return NextResponse.json({ error: "Bạn chưa có quyền lập đề nghị mua — nhờ người phụ trách mua hàng nhận xử lý và gửi ký" }, { status: 403 })
    }
    // Nhóm phụ trách biên bản gửi ký phiếu người khác đang đứng tên ⇒ người gửi thành người đề nghị.
    // Người ngoài nhóm phải "Nhận xử lý" (lưu phiếu) trước — không chiếm phiếu thẳng ở đây.
    const linked = !!request.maintenance_record_id && request.loai !== "dieu_chinh"
    const takeOver = !isOwner && linked && (await isMaintenanceRecordTeam(request.maintenance_record_id, actor.userId))
    if (!isOwner && !takeOver) {
      return NextResponse.json(
        { error: linked ? "Bấm “Nhận xử lý” trước khi gửi ký phiếu này" : "Chỉ người đề nghị được chọn người ký" },
        { status: 403 },
      )
    }

    const { data: people, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, status")
      .eq("factory_id", actor.factoryId)
      .in("id", [giamDocId, keToanId])
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })
    const activeIds = new Set(((people || []) as { id: string; status: string | null }[]).filter((p) => p.status === "active").map((p) => p.id))
    if (!activeIds.has(giamDocId) || !activeIds.has(keToanId)) {
      return NextResponse.json({ error: "Người ký không tồn tại hoặc đã bị khoá" }, { status: 400 })
    }

    let myName = ""
    if (takeOver) {
      const { data: me } = await supabaseAdmin.from("profiles").select("full_name, username").eq("id", actor.userId).single()
      myName = (me?.full_name || me?.username || "") as string
    }

    // Chặn đua: chỉ cập nhật khi phiếu vẫn còn đúng trạng thái + người đề nghị như lúc kiểm.
    const { data: updated, error: upErr } = await supabaseAdmin
      .from("purchase_requests")
      .update({
        giam_doc_user_id: giamDocId,
        ke_toan_user_id: keToanId,
        updated_at: new Date().toISOString(),
        ...(takeOver ? { nguoi_de_nghi_id: actor.userId, nguoi_de_nghi_ten: myName } : {}),
      })
      .eq("id", id)
      .eq("trang_thai", request.trang_thai as string)
      .eq("nguoi_de_nghi_id", request.nguoi_de_nghi_id as string)
      .select("id")
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 })
    if (!updated?.length) return NextResponse.json({ error: "Phiếu vừa thay đổi, tải lại trang rồi thử lại" }, { status: 409 })

    if (takeOver) {
      await insertPurchaseLog({ requestId: id, factoryId: actor.factoryId, userId: actor.userId, hanhDong: "nhan_xu_ly", noiDung: "Đảm nhận phiếu khi gửi ký (người phụ trách biên bản)" })
    }
    await insertPurchaseLog({ requestId: id, factoryId: actor.factoryId, userId: actor.userId, hanhDong: "chon_nguoi_ky", noiDung: "Chọn người ký (Giám đốc, Kế toán)" })

    return NextResponse.json({ ok: true, takeOver })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}
