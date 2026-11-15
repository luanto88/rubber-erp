import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { cancelSigningRequest } from "@/lib/signing/requests"
import { loadDailyReportForActor, requireDailyReport } from "../../_lib/access"

export const dynamic = "force-dynamic"

// POST { action: "recall" | "cancel", lyDo? }
//  - recall: Chờ ký, chưa ai ký ⇒ huỷ yêu cầu ký, về Nháp (lõi ký tự chặn khi đã có người ký).
//  - cancel: Nháp / Bị trả về ⇒ Huỷ (giữ số). Đã ký ⇒ chỉ admin, lý do bắt buộc.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    await requireDailyReport(actor)
    const { id } = await params
    const report = await loadDailyReportForActor(actor, id)
    const body = (await req.json().catch(() => ({}))) as { action?: string; lyDo?: string }
    const lyDo = String(body.lyDo || "").trim()

    if (body.action === "recall") {
      if (report.trang_thai !== "cho_ky") return NextResponse.json({ error: "Báo cáo không ở trạng thái Chờ ký" }, { status: 409 })
      if (report.yeu_cau_ky_id) await cancelSigningRequest({ yeuCauId: report.yeu_cau_ky_id, userId: actor.userId, isAdmin: actor.isAdmin })
      const { error } = await supabaseAdmin.from("inventory_daily_reports").update({ trang_thai: "nhap", yeu_cau_ky_id: null }).eq("id", id)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ ok: true })
    }

    if (body.action === "cancel") {
      if (report.trang_thai === "huy") return NextResponse.json({ ok: true })
      if (report.trang_thai === "cho_ky") return NextResponse.json({ error: "Báo cáo đang chờ ký — thu hồi trước" }, { status: 409 })
      if (report.trang_thai === "da_ky" && !actor.isAdmin) return NextResponse.json({ error: "Chỉ admin huỷ được báo cáo đã ký" }, { status: 403 })
      if (report.trang_thai === "da_ky" && !lyDo) return NextResponse.json({ error: "Nhập lý do huỷ" }, { status: 400 })
      const { error } = await supabaseAdmin.from("inventory_daily_reports").update({ trang_thai: "huy", ly_do_huy: lyDo || null }).eq("id", id)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: "Thao tác không hợp lệ" }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) === 500 ? 400 : isoAuthErrorStatus(err) })
  }
}
