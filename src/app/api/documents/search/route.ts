import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"

export const dynamic = "force-dynamic"

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ""

export async function POST(req: NextRequest) {
  try {
    // Route này dùng `supabaseAdmin` (service role) để gọi RPC → BỎ QUA HOÀN TOÀN RLS của
    // `van_ban_documents`. Trước 2026-09-05 nó không xác thực gì cả: bất kỳ ai gọi được endpoint,
    // kể cả chưa đăng nhập, đều tra được nội dung văn bản của bất kỳ nhà máy nào chỉ bằng cách
    // đoán `factoryId`. Vá 2 lớp: (1) bắt buộc Bearer token hợp lệ; (2) không tin `factoryId`
    // client gửi lên mà đối chiếu với `profiles.factory_id` của chính người gọi.
    let authUserId: string
    try {
      const authUser = await requireAuthUser(req)
      authUserId = authUser.id
    } catch {
      return NextResponse.json({ error: "Phiên đăng nhập không hợp lệ" }, { status: 401 })
    }

    const { query, factoryId } = (await req.json()) as {
      query?: string
      factoryId?: string
    }
    if (!query?.trim() || !factoryId) {
      return NextResponse.json({ error: "Thiếu query hoặc factoryId" }, { status: 400 })
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("factory_id, role")
      .eq("id", authUserId)
      .maybeSingle()
    if (!profile?.factory_id || profile.factory_id !== factoryId) {
      return NextResponse.json({ error: "Không có quyền tìm kiếm trong nhà máy này" }, { status: 403 })
    }
    const isAdmin = (profile.role as string | null) === "admin"
    if (!GEMINI_API_KEY) {
      return NextResponse.json({ error: "GEMINI_API_KEY chưa được cấu hình" }, { status: 500 })
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text: query.trim() }] },
          outputDimensionality: 768,
        }),
      },
    )

    if (!res.ok) {
      const errBody = await res.text()
      return NextResponse.json({ error: `Gemini API lỗi: ${errBody}` }, { status: 500 })
    }

    const json = (await res.json()) as { embedding?: { values: number[] } }
    const embedding = json.embedding?.values
    if (!embedding?.length) {
      return NextResponse.json({ error: "Gemini không trả về embedding" }, { status: 500 })
    }

    const { data: results, error: rpcErr } = await supabaseAdmin.rpc(
      "match_van_ban_documents",
      {
        query_embedding: JSON.stringify(embedding),
        match_threshold: 0.4,
        match_count: 15,
        p_factory_id: factoryId,
      },
    )

    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message }, { status: 500 })
    }

    // ── Lọc văn bản "Giới hạn" ────────────────────────────────────────────────
    // RPC `match_van_ban_documents` là SQL STABLE gọi qua service role ⇒ KHÔNG đi qua
    // RLS. Nếu bỏ bước này, tìm kiếm AI vẫn trả về tên + trích yếu của văn bản Giới
    // hạn cho người ngoài cuộc — đúng lỗ hổng mà `che_do_xem` sinh ra để bịt.
    //
    // Không tự viết lại điều kiện "ai là người trong cuộc": gọi thẳng cùng hàm
    // `van_ban_is_participant` mà policy đang dùng, để 2 nơi không bao giờ trôi lệch.
    const rows = (results || []) as { id: string }[]
    let visible = rows
    if (rows.length && !isAdmin) {
      const { data: modes } = await supabaseAdmin
        .from("van_ban_documents")
        .select("id, che_do_xem")
        .in("id", rows.map((r) => r.id))
      const restricted = new Set(
        ((modes || []) as { id: string; che_do_xem: string | null }[])
          .filter((m) => m.che_do_xem === "gioi_han")
          .map((m) => m.id),
      )
      if (restricted.size) {
        const allowed = new Set<string>()
        await Promise.all(
          [...restricted].map(async (docId) => {
            const { data: ok } = await supabaseAdmin.rpc("van_ban_is_participant", {
              p_doc_id: docId,
              p_user_id: authUserId,
            })
            if (ok === true) allowed.add(docId)
          }),
        )
        visible = rows.filter((r) => !restricted.has(r.id) || allowed.has(r.id))
      }
    }

    return NextResponse.json(visible)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Lỗi không xác định"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
