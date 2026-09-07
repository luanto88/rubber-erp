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
      .select("factory_id, role, department, department_id")
      .eq("id", authUserId)
      .maybeSingle()
    if (!profile?.factory_id || profile.factory_id !== factoryId) {
      return NextResponse.json({ error: "Không có quyền tìm kiếm trong nhà máy này" }, { status: 403 })
    }
    const role = (profile.role as string | null) || ""
    const isAdmin = role === "admin"

    // ── Kiểm tra quyền xem module Văn bản (documents.view) ───────────────────
    if (!isAdmin) {
      const { data: explicitRows } = await supabaseAdmin
        .from("user_permissions")
        .select("permission_code")
        .eq("user_id", authUserId)
        .eq("granted", true)

      let hasViewPerm = false
      if (explicitRows && explicitRows.length > 0) {
        hasViewPerm = explicitRows.some((r) => r.permission_code === "documents.view")
      } else {
        const { data: roleRows } = await supabaseAdmin
          .from("role_permissions")
          .select("permission_code")
          .eq("role", role)
          .eq("permission_code", "documents.view")
        hasViewPerm = (roleRows?.length || 0) > 0
      }
      if (!hasViewPerm) {
        return NextResponse.json({ error: "Bạn không có quyền xem văn bản nội bộ" }, { status: 403 })
      }
    }

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

    // ── Lọc phân quyền xem văn bản (Công khai theo phòng ban + Hạn chế theo người tham gia) ──
    const rows = (results || []) as { id: string }[]
    let visible = rows
    if (rows.length && !isAdmin) {
      const { resolveUserDeptCode } = await import("@/lib/documents-dept")
      const userDeptCode = await resolveUserDeptCode(supabaseAdmin, {
        department: profile.department as string | null,
        department_id: profile.department_id as string | null,
      })

      const { data: docsMeta } = await supabaseAdmin
        .from("van_ban_documents")
        .select("id, che_do_xem, phong_ban")
        .in("id", rows.map((r) => r.id))

      const metaMap = new Map<string, { che_do_xem: string | null; phong_ban: string | null }>()
      for (const m of (docsMeta || []) as { id: string; che_do_xem: string | null; phong_ban: string | null }[]) {
        metaMap.set(m.id, m)
      }

      const participantAllowed = new Set<string>()
      await Promise.all(
        rows.map(async (r) => {
          const { data: ok } = await supabaseAdmin.rpc("van_ban_is_participant", {
            p_doc_id: r.id,
            p_user_id: authUserId,
          })
          if (ok === true) participantAllowed.add(r.id)
        }),
      )

      visible = rows.filter((r) => {
        const meta = metaMap.get(r.id)
        if (!meta) return false
        const isParticipant = participantAllowed.has(r.id)
        if (meta.che_do_xem === "gioi_han") {
          // Văn bản hạn chế: CHỈ người tham gia ký / được phân phối mới được xem
          return isParticipant
        }
        // Văn bản công khai: cùng phòng ban HOẶC có tham gia ký
        const isSameDept = !!userDeptCode && !!meta.phong_ban && meta.phong_ban === userDeptCode
        return isSameDept || isParticipant
      })
    }

    return NextResponse.json(visible)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Lỗi không xác định"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
