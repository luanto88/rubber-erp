import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"
import { issueMaintenanceStock } from "@/lib/maintenance-stock-issuance"

export const dynamic = "force-dynamic"

// POST — "Thử xuất kho lại" (GĐ2, bug.md #3): đường thoát cho biên bản KẸT — yêu cầu ký số đã
// hoàn tất nhưng bước tự xuất kho lúc ký cuối lỗi, nên biên bản vẫn `cho_duyet`. Chỉ admin.
// Gọi lại issueMaintenanceStock (tự kiểm tồn trước, tự huỷ phiếu đã ghi sổ nếu kho sau lỗi, tự
// huỷ "phiếu mồ côi" X-BT-<mã> của lượt lỗi trước) rồi đưa biên bản sang `da_duyet`.
// Người duyệt ghi nhận = người ký cuối của yêu cầu ký (không phải admin bấm nút).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuthUser(req)
    const { id } = await params

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role, factory_id, full_name, username")
      .eq("id", authUser.id)
      .single()
    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Chỉ admin được thử xuất kho lại." }, { status: 403 })
    }
    const factoryId = profile.factory_id as string

    const { data: record, error: recErr } = await supabaseAdmin
      .from("maintenance_records")
      .select("id, ma_bb, ngay, trang_thai")
      .eq("id", id)
      .eq("factory_id", factoryId)
      .maybeSingle()
    if (recErr) return NextResponse.json({ error: recErr.message }, { status: 400 })
    if (!record) return NextResponse.json({ error: "Không tìm thấy biên bản" }, { status: 404 })
    if (record.trang_thai !== "cho_duyet") {
      return NextResponse.json({ error: "Chỉ áp dụng cho biên bản đang Chờ duyệt (đã ký xong nhưng xuất kho lỗi)." }, { status: 409 })
    }

    const { data: yeuCau, error: ycErr } = await supabaseAdmin
      .from("yeu_cau_ky")
      .select("id, hoan_tat_luc")
      .eq("factory_id", factoryId)
      .eq("modun", "maintenance")
      .eq("ban_ghi_id", id)
      .eq("trang_thai", "hoan_tat")
      .maybeSingle()
    if (ycErr) return NextResponse.json({ error: ycErr.message }, { status: 400 })
    if (!yeuCau) {
      return NextResponse.json({ error: "Biên bản chưa ký hoàn tất — không có gì để xuất kho lại." }, { status: 409 })
    }

    // Người ký cuối (thu_tu lớn nhất) = người phê duyệt của biên bản.
    const { data: lastSigner } = await supabaseAdmin
      .from("nguoi_ky")
      .select("user_id, ky_luc")
      .eq("yeu_cau_id", yeuCau.id)
      .order("thu_tu", { ascending: false })
      .limit(1)
      .maybeSingle()
    let approverUserId = authUser.id
    let approverName = (profile.full_name || profile.username || "") as string
    if (lastSigner?.user_id) {
      const { data: sp } = await supabaseAdmin
        .from("profiles")
        .select("full_name, username")
        .eq("id", lastSigner.user_id)
        .maybeSingle()
      approverUserId = lastSigner.user_id as string
      approverName = (sp?.full_name || sp?.username || approverName) as string
    }

    const { issueDocIds } = await issueMaintenanceStock({
      recordId: id,
      factoryId,
      approverUserId,
      approverName,
      maBb: (record.ma_bb as string) || "",
      ngay: record.ngay as string,
    })

    const { error: updErr } = await supabaseAdmin
      .from("maintenance_records")
      .update({
        trang_thai: "da_duyet",
        nguoi_duyet: approverName,
        ngay_duyet: (yeuCau.hoan_tat_luc as string | null) || (lastSigner?.ky_luc as string | null) || new Date().toISOString(),
        inventory_issue_doc_id: issueDocIds[0] || null,
        inventory_issue_doc_ids: issueDocIds.length > 0 ? issueDocIds : null,
      })
      .eq("id", id)
      .eq("factory_id", factoryId)
    if (updErr) {
      return NextResponse.json(
        { error: `Đã xuất kho nhưng không cập nhật được biên bản: ${updErr.message}. Báo admin kiểm tra.` },
        { status: 500 },
      )
    }

    await supabaseAdmin.from("nhat_ky_ky").insert({
      factory_id: factoryId,
      yeu_cau_id: yeuCau.id,
      hanh_dong: "thu_xuat_kho_lai",
      user_id: authUser.id,
      chi_tiet: { ma_bb: record.ma_bb, issue_doc_ids: issueDocIds },
    })

    return NextResponse.json({ ok: true, issueDocIds })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 400 })
  }
}
