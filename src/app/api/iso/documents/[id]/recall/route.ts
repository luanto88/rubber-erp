import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { resolveIsoActor, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"

export const dynamic = "force-dynamic"

/**
 * GĐ4 phân quyền ISO (2026-10-03) — "Thu hồi" tài liệu đã gửi về NHÁP.
 *
 * Chỉ người tạo (`created_by`) / người soạn thảo (`soan_thao_user_id`) hoặc admin, và chỉ khi
 * CHƯA có ai ký bước sau:
 *   - `cho_xem_xet` + chưa ký xem xét (Cấp 1 đang chờ xem xét), hoặc
 *   - `cho_phe_duyet` + chưa ký xem xét + chưa ký phê duyệt + không phải Cấp 1 (Cấp 2 gửi thẳng).
 * Cấp 1 đã qua xem xét → không thu hồi được (dùng "Trả về" của người ký).
 *
 * Áp dụng CẢ BỘ, tính lại từ DB (không nhận danh sách id từ client) — mirror `loadDoc`
 * (documents/[id]/page.tsx): tài liệu cha kèm hồ sơ con cùng đợt; hồ sơ con soạn riêng kèm hồ
 * sơ anh em cùng người ký, KHÔNG đụng tài liệu cha.
 *
 * Bỏ tham chiếu file đã ký của lượt soạn thảo để lần gửi lại dựng từ file gốc (PDF chính luôn
 * dựng từ `file_goc_url`; file phụ và Office đọc artifact mới nhất). Hồ sơ con Office bị
 * generate-office ghi đè `file_goc_url` ⇒ khôi phục từ `file_template_url`. KHÔNG xoá file
 * trên Storage (giữ để đối chiếu).
 */

const COLS = [
  "id", "factory_id", "trang_thai", "cap_tl", "phan_loai_tl", "loai_tai_lieu", "parent_doc_id",
  "ma_tai_lieu", "created_by", "soan_thao_user_id", "xem_xet_user_id", "phe_duyet_user_id",
  "ky_soan_thao_at", "ky_xem_xet_at", "ky_phe_duyet_at", "file_goc_url", "file_template_url",
].join(", ")

type Row = {
  id: string
  factory_id: string
  trang_thai: string
  cap_tl: string | null
  phan_loai_tl: string | null
  loai_tai_lieu: string | null
  parent_doc_id: string | null
  ma_tai_lieu: string | null
  created_by: string | null
  soan_thao_user_id: string | null
  xem_xet_user_id: string | null
  phe_duyet_user_id: string | null
  ky_soan_thao_at: string | null
  ky_xem_xet_at: string | null
  ky_phe_duyet_at: string | null
  file_goc_url: string | null
  file_template_url: string | null
}

const RECALLABLE = ["cho_xem_xet", "cho_phe_duyet"]

/** Lý do không thu hồi được, hoặc null nếu được. Nguồn sự thật duy nhất cho điều kiện trạng thái. */
function recallBlockReason(row: Row): string | null {
  if (!RECALLABLE.includes(row.trang_thai)) return "Tài liệu không ở trạng thái chờ ký nên không thu hồi được."
  if (row.ky_xem_xet_at || row.ky_phe_duyet_at) return "Đã có người ký bước sau — không thu hồi được, hãy nhờ người ký bấm \"Trả về\"."
  if (row.trang_thai === "cho_phe_duyet" && row.cap_tl === "Cấp 1") {
    return "Tài liệu Cấp 1 đã qua bước xem xét — không thu hồi được."
  }
  return null
}

const isChild = (r: Row) => r.phan_loai_tl === "con" || r.loai_tai_lieu === "F"
const isOfficeUrl = (url: string | null) => !!url && /\.(docx|xlsx)(\?|$)/i.test(url)

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const actor = await resolveIsoActor(req)
    const body = (await req.json().catch(() => ({}))) as { lyDo?: string }
    const lyDo = typeof body.lyDo === "string" ? body.lyDo.trim().slice(0, 1000) : ""
    const admin = getSupabaseAdmin()

    const { data: mainData, error: mainErr } = await admin.from("iso_documents").select(COLS).eq("id", id).single()
    const main = mainData as unknown as Row | null
    if (mainErr || !main) return NextResponse.json({ error: "Không tìm thấy tài liệu" }, { status: 404 })
    if (main.factory_id !== actor.factoryId) return NextResponse.json({ error: "Không thuộc nhà máy của bạn" }, { status: 403 })

    const isOwner = actor.userId === main.created_by || actor.userId === main.soan_thao_user_id
    if (!isOwner && !actor.isAdmin) {
      return NextResponse.json({ error: "Chỉ người tạo tài liệu (hoặc admin) mới được thu hồi." }, { status: 403 })
    }
    const block = recallBlockReason(main)
    if (block) return NextResponse.json({ error: block }, { status: 409 })

    // Tính bộ tài liệu đi cùng đợt.
    let batch: Row[] = []
    if (!isChild(main)) {
      const { data } = await admin
        .from("iso_documents").select(COLS)
        .eq("factory_id", actor.factoryId).eq("parent_doc_id", main.id).eq("trang_thai", main.trang_thai)
      batch = (data || []) as unknown as Row[]
    } else if (main.parent_doc_id) {
      let q = admin
        .from("iso_documents").select(COLS)
        .eq("factory_id", actor.factoryId).eq("parent_doc_id", main.parent_doc_id)
        .eq("trang_thai", main.trang_thai).neq("id", main.id)
      q = main.soan_thao_user_id ? q.eq("soan_thao_user_id", main.soan_thao_user_id) : q.is("soan_thao_user_id", null)
      q = main.xem_xet_user_id ? q.eq("xem_xet_user_id", main.xem_xet_user_id) : q.is("xem_xet_user_id", null)
      q = main.phe_duyet_user_id ? q.eq("phe_duyet_user_id", main.phe_duyet_user_id) : q.is("phe_duyet_user_id", null)
      if (main.created_by) q = q.eq("created_by", main.created_by)
      const { data } = await q
      batch = (data || []) as unknown as Row[]
    }
    // Hồ sơ con đi cùng đã có người ký bước sau (lệch đợt) → bỏ qua, không kéo về nháp.
    batch = batch.filter((r) => !recallBlockReason(r))
    const all = [main, ...batch]

    // Hồ sơ con Office thiếu bản gốc để khôi phục → chặn cả lượt (tránh đóng dấu chồng khi gửi lại).
    const missingTemplate = all.find((r) => isChild(r) && r.ky_soan_thao_at && isOfficeUrl(r.file_goc_url) && !r.file_template_url)
    if (missingTemplate) {
      return NextResponse.json({
        error: `Hồ sơ ${missingTemplate.ma_tai_lieu || ""} không còn file gốc để khôi phục — không thu hồi được, hãy nhờ người ký "Trả về".`,
      }, { status: 409 })
    }

    const basePayload = {
      trang_thai: "draft",
      ky_soan_thao_at: null,
      soan_thao_placement: null,
      xem_xet_placement: null,
      phe_duyet_placement: null,
      file_signed_pdf_url: null,
      file_signed_office_url: null,
      file_signed_office_type: null,
      file_phieu_yeu_cau_thay_doi_signed_url: null,
      file_de_nghi_soat_xet_signed_url: null,
    }
    const payloadFor = (r: Row) =>
      isChild(r) && isOfficeUrl(r.file_goc_url) && r.file_template_url && r.file_template_url !== r.file_goc_url
        ? { ...basePayload, file_goc_url: r.file_template_url }
        : basePayload

    // Dòng chính trước, có điều kiện chống đua: nếu người ký vừa ký xong giữa chừng → 0 dòng → 409.
    const { data: mainUpd, error: mainUpdErr } = await admin
      .from("iso_documents").update(payloadFor(main))
      .eq("id", main.id).eq("trang_thai", main.trang_thai)
      .is("ky_xem_xet_at", null).is("ky_phe_duyet_at", null)
      .select("id")
    if (mainUpdErr) return NextResponse.json({ error: mainUpdErr.message }, { status: 500 })
    if (!mainUpd || mainUpd.length === 0) {
      return NextResponse.json({ error: "Đã có người ký bước sau — không thu hồi được." }, { status: 409 })
    }

    const recalledIds = [main.id]
    for (const r of batch) {
      const { data: upd } = await admin
        .from("iso_documents").update(payloadFor(r))
        .eq("id", r.id).eq("trang_thai", r.trang_thai)
        .is("ky_xem_xet_at", null).is("ky_phe_duyet_at", null)
        .select("id")
      if (upd && upd.length > 0) recalledIds.push(r.id)
    }

    // Nhật ký bất biến cho từng bản (insert-only).
    const { error: logErr } = await admin.from("doc_approval_log").insert(
      recalledIds.map((docId) => ({
        factory_id: actor.factoryId,
        doc_id: docId,
        doc_type: "iso",
        user_id: actor.userId,
        action: "thu_hoi",
        ly_do: lyDo || null,
      })),
    )
    if (logErr) console.error("[iso recall] ghi nhật ký lỗi:", logErr.message)

    // Báo người đang được chờ ký — không chặn kết quả nếu lỗi.
    const waitingUserId = main.trang_thai === "cho_xem_xet" ? main.xem_xet_user_id : main.phe_duyet_user_id
    if (waitingUserId && waitingUserId !== actor.userId) {
      try {
        await fetch(`${req.nextUrl.origin}/api/iso/notify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            docId: main.id,
            factoryId: actor.factoryId,
            action: "thu_hoi",
            recipientUserIds: [waitingUserId],
            lyDo: lyDo || undefined,
            actorUserId: actor.userId,
          }),
        })
      } catch (err) {
        console.error("[iso recall] gửi thông báo lỗi:", err)
      }
    }

    return NextResponse.json({ ok: true, recalledIds })
  } catch (err) {
    const status = isoAuthErrorStatus(err)
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi không xác định" }, { status })
  }
}
