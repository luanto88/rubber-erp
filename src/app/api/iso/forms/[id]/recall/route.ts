import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { resolveIsoActor, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { stepSignerUserId, type ThuTuKyStep } from "@/app/dashboard/documents/_components/documents-types"

export const dynamic = "force-dynamic"

/**
 * GĐ4 phân quyền ISO (2026-10-03) — "Thu hồi" hồ sơ thực hiện đã gửi về NHÁP.
 *
 * Người được thu hồi: người tạo (`nguoi_tao`), người ký bước 1 (người lập thật — admin có thể
 * lập hộ), hoặc admin. Điều kiện: bước 1 đã ký, bước 2 CHƯA ký.
 *   - N bước (`so_buoc_tong > 0`): `buoc_hien_tai = 1` và đang `cho_xem_xet`/`cho_phe_duyet`.
 *   - Legacy: đang chờ, đã ký soạn thảo, chưa ký xem xét/phê duyệt.
 *
 * Đưa về đúng trạng thái như lúc chưa ký (mirror `handleReturn` + `handleUpload` của trang chi
 * tiết): xoá chữ ký + file đã ký của lượt trước, GIỮ `draft_file_url` để lần gửi lại dựng từ
 * file nháp (finalize: PDF đóng dấu lên `draft_file_url`, Office đọc
 * `soan_thao_signed_url || draft_file_url`). Không xoá file trên Storage.
 */

type Row = {
  id: string
  factory_id: string
  tieu_de: string | null
  trang_thai: string
  nguoi_tao: string | null
  buoc_hien_tai: number | null
  so_buoc_tong: number | null
  thu_tu_ky_json: ThuTuKyStep[] | null
  xem_xet_user_id: string | null
  phe_duyet_user_id: string | null
  cap_tl: string | null
  ky_soan_thao_at: string | null
  ky_xem_xet_at: string | null
  ky_phe_duyet_at: string | null
}

const COLS = "id, factory_id, tieu_de, trang_thai, nguoi_tao, buoc_hien_tai, so_buoc_tong, thu_tu_ky_json, xem_xet_user_id, phe_duyet_user_id, cap_tl, ky_soan_thao_at, ky_xem_xet_at, ky_phe_duyet_at"
const WAITING = ["cho_xem_xet", "cho_phe_duyet"]

const steps = (r: Row) => (Array.isArray(r.thu_tu_ky_json) ? r.thu_tu_ky_json : [])
const isNStep = (r: Row) => (r.so_buoc_tong ?? 0) > 0

function recallBlockReason(r: Row): string | null {
  if (!WAITING.includes(r.trang_thai)) return "Hồ sơ không ở trạng thái chờ ký nên không thu hồi được."
  if (isNStep(r)) {
    if ((r.buoc_hien_tai ?? 0) !== 1) return "Đã có người ký bước sau — không thu hồi được, hãy nhờ người ký bấm \"Trả về\"."
    return null
  }
  if (!r.ky_soan_thao_at) return "Hồ sơ chưa được ký bước soạn thảo."
  if (r.ky_xem_xet_at || r.ky_phe_duyet_at) return "Đã có người ký bước sau — không thu hồi được, hãy nhờ người ký bấm \"Trả về\"."
  return null
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const actor = await resolveIsoActor(req)
    const body = (await req.json().catch(() => ({}))) as { lyDo?: string }
    const lyDo = typeof body.lyDo === "string" ? body.lyDo.trim().slice(0, 1000) : ""
    const admin = getSupabaseAdmin()

    const { data, error } = await admin.from("iso_form_instances").select(COLS).eq("id", id).single()
    const row = data as unknown as Row | null
    if (error || !row) return NextResponse.json({ error: "Không tìm thấy hồ sơ" }, { status: 404 })
    if (row.factory_id !== actor.factoryId) return NextResponse.json({ error: "Không thuộc nhà máy của bạn" }, { status: 403 })

    const step1Signer = isNStep(row) ? (steps(row)[0] ? stepSignerUserId(steps(row)[0]) : null) : null
    const isOwner = actor.userId === row.nguoi_tao || (!!step1Signer && actor.userId === step1Signer)
    if (!isOwner && !actor.isAdmin) {
      return NextResponse.json({ error: "Chỉ người lập hồ sơ (hoặc admin) mới được thu hồi." }, { status: 403 })
    }
    const block = recallBlockReason(row)
    if (block) return NextResponse.json({ error: block }, { status: 409 })

    const payload: Record<string, unknown> = {
      trang_thai: "draft",
      buoc_hien_tai: 0,
      nguoi_ky: {},
      placement_ky: {},
      soan_thao_signed_url: null,
      final_pdf_url: null,
      final_office_url: null,
      ly_do_tra_ve: null,
    }
    if (!isNStep(row)) {
      Object.assign(payload, { soan_thao: null, soan_thao_placement: null, ky_soan_thao_at: null })
    }

    // Điều kiện chống đua: người ký bước 2 vừa ký xong giữa chừng → 0 dòng → 409.
    let q = admin.from("iso_form_instances").update(payload).eq("id", row.id).eq("trang_thai", row.trang_thai)
    q = isNStep(row) ? q.eq("buoc_hien_tai", 1) : q.is("ky_xem_xet_at", null).is("ky_phe_duyet_at", null)
    const { data: upd, error: updErr } = await q.select("id")
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
    if (!upd || upd.length === 0) {
      return NextResponse.json({ error: "Đã có người ký bước sau — không thu hồi được." }, { status: 409 })
    }

    const { error: logErr } = await admin.from("iso_form_instance_logs").insert({
      instance_id: row.id,
      factory_id: actor.factoryId,
      user_id: actor.userId,
      action: "thu_hoi",
      note: lyDo || null,
    })
    if (logErr) console.error("[iso forms recall] ghi nhật ký lỗi:", logErr.message)

    // Báo người đang được chờ ký bước kế tiếp — không chặn kết quả nếu lỗi.
    const waiting = isNStep(row)
      ? (steps(row)[1] ? stepSignerUserId(steps(row)[1]) : null)
      : (row.trang_thai === "cho_xem_xet" ? row.xem_xet_user_id : row.phe_duyet_user_id)
    if (waiting && waiting !== actor.userId) {
      try {
        await fetch(`${req.nextUrl.origin}/api/iso/forms/notify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instanceId: row.id,
            factoryId: actor.factoryId,
            action: "thu_hoi",
            recipientUserIds: [waiting],
            lyDo: lyDo || undefined,
            actorUserId: actor.userId,
          }),
        })
      } catch (err) {
        console.error("[iso forms recall] gửi thông báo lỗi:", err)
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const status = isoAuthErrorStatus(err)
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi không xác định" }, { status })
  }
}
