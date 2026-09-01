import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"
import { reverseMaintenanceStockIssuance } from "@/lib/maintenance-stock-issuance"

export const dynamic = "force-dynamic"

// "Hủy sau khi hoàn tất" — năng lực MỚI, riêng cho Bảo trì, KHÔNG thuộc lib dùng chung
// src/lib/signing/requests.ts (module đó chủ đích coi 'hoan_tat' là bất biến, không cho hủy —
// đúng triết lý chung của hệ thống ký số). Bảo trì cần ngoại lệ vì "hoàn tất" ở đây còn kéo
// theo 1 side-effect nghiệp vụ thật (xuất kho vật tư) mà thực tế vận hành cần đảo ngược được
// khi phát hiện sai sót sau khi Giám đốc đã ký — không đụng gì tới các module khác.
//
// Hành động: (1) hoàn tồn kho toàn bộ phiếu xuất đã tạo; (2) đưa maintenance_records về
// cho_duyet, xoá nguoi_duyet/ngay_duyet/inventory_issue_doc_id(s); (3) đánh dấu yeu_cau_ky liên
// quan là 'huy' (giữ nguyên nguoi_ky/truong_ky/nhat_ky_ky làm lịch sử, KHÔNG xoá — nhật ký ký
// số vẫn bất biến) để unique index không còn chặn tạo yêu cầu ký mới cho cùng biên bản;
// (4) ghi thêm 1 dòng nhat_ky_ky mới cho chính hành động hủy này.
export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const { recordId, factoryId } = (await req.json()) as { recordId?: string; factoryId?: string }
    if (!recordId || !factoryId) {
      return NextResponse.json({ error: "Thiếu recordId hoặc factoryId" }, { status: 400 })
    }

    const { data: profile } = await supabaseAdmin.from("profiles").select("role").eq("id", authUser.id).single()
    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Chỉ admin mới được hủy biên bản đã hoàn tất ký duyệt." }, { status: 403 })
    }

    const { data: record, error: recordErr } = await supabaseAdmin
      .from("maintenance_records")
      .select("id, ma_bb, trang_thai, inventory_issue_doc_id, inventory_issue_doc_ids")
      .eq("id", recordId)
      .eq("factory_id", factoryId)
      .single()
    if (recordErr || !record) {
      return NextResponse.json({ error: "Không tìm thấy biên bản" }, { status: 404 })
    }
    if (record.trang_thai !== "da_duyet") {
      return NextResponse.json({ error: "Biên bản này chưa ở trạng thái đã duyệt." }, { status: 400 })
    }

    const { data: yeuCau, error: ycErr } = await supabaseAdmin
      .from("yeu_cau_ky")
      .select("id, trang_thai")
      .eq("modun", "maintenance")
      .eq("ban_ghi_id", recordId)
      .eq("trang_thai", "hoan_tat")
      .maybeSingle()
    if (ycErr) return NextResponse.json({ error: ycErr.message }, { status: 400 })

    const issueDocIds: string[] = (record.inventory_issue_doc_ids as string[] | null) ||
      (record.inventory_issue_doc_id ? [record.inventory_issue_doc_id as string] : [])
    if (issueDocIds.length > 0) {
      await reverseMaintenanceStockIssuance({
        factoryId,
        issueDocIds,
        cancelledByUserId: authUser.id,
        reason: `Hủy sau khi hoàn tất ký duyệt biên bản ${record.ma_bb || ""}`,
      })
    }

    const { error: updateErr } = await supabaseAdmin
      .from("maintenance_records")
      .update({
        trang_thai: "cho_duyet",
        nguoi_duyet: null,
        ngay_duyet: null,
        inventory_issue_doc_id: null,
        inventory_issue_doc_ids: null,
      })
      .eq("id", recordId)
      .eq("factory_id", factoryId)
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 400 })

    if (yeuCau) {
      await supabaseAdmin.from("yeu_cau_ky").update({ trang_thai: "huy" }).eq("id", yeuCau.id)
      await supabaseAdmin.from("nhat_ky_ky").insert({
        factory_id: factoryId,
        yeu_cau_id: yeuCau.id,
        hanh_dong: "huy_sau_hoan_tat",
        user_id: authUser.id,
        chi_tiet: { ma_bb: record.ma_bb, issue_doc_ids: issueDocIds },
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 400 })
  }
}
