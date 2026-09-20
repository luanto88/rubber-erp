import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireAuthUser } from "@/app/api/account/_lib/security"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Vá bảo mật 2026-09-20: route này trước đây HOÀN TOÀN KHÔNG xác thực gì — chỉ cần biết
// `factoryId` (UUID, có thể đoán/liệt kê) là gọi được, và trả thẳng
// `file_signed_pdf_url`/`file_signed_office_url`/`file_goc_url` (URL public thật trên bucket
// `iso-documents`) trong JSON. Giờ bắt buộc `Authorization: Bearer`, KHÔNG tin `factoryId` từ
// client — luôn dùng `profiles.factory_id` thật của người gọi. Đồng thời KHÔNG trả URL file ra
// ngoài nữa (mirror `api/iso/public-doc/[id]/route.ts`) — chỉ trả `file_ext`/`has_file` đủ để
// hiển thị badge loại file trên UI tìm kiếm, không lộ đường dẫn thật.

/** Hàng thô do RPC `match_iso_templates` trả về — có URL, KHÔNG được export ra ngoài file này. */
type RawMatchRow = {
  id: string
  ten_tai_lieu: string
  ma_tai_lieu: string | null
  loai_tai_lieu: string | null
  phong_ban: string | null
  lan_ban_hanh: string | null
  phan_loai_tl: string | null
  file_signed_office_url: string | null
  file_signed_office_type: string | null
  file_goc_url: string | null
  file_signed_pdf_url: string | null
  mo_ta_tim_kiem: string | null
  similarity: number
}

export type TemplateSearchResult = {
  id: string
  ten_tai_lieu: string
  ma_tai_lieu: string | null
  loai_tai_lieu: string | null
  phong_ban: string | null
  lan_ban_hanh: string | null
  phan_loai_tl: string | null
  file_ext: string
  has_file: boolean
  mo_ta_tim_kiem: string | null
  similarity: number
}

/** Suy loại file để hiển thị badge — mirror đúng logic client cũ, không đổi hành vi hiển thị. */
function resolveFileExt(row: RawMatchRow): string {
  if (row.file_signed_office_type) return row.file_signed_office_type
  if (row.file_signed_office_url) return "docx"
  const ext = row.file_goc_url?.split(".").pop()
  return ext || "pdf"
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("factory_id, status")
      .eq("id", authUser.id)
      .maybeSingle()

    if (profileError || !profile || profile.status !== "active" || !profile.factory_id) {
      return NextResponse.json({ error: "Tài khoản không hợp lệ" }, { status: 403 })
    }

    const { query, limit = 8 } = (await req.json()) as {
      query?: string
      limit?: number
    }

    if (!query?.trim()) {
      return NextResponse.json({ error: "Thiếu query" }, { status: 400 })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: "Thiếu GEMINI_API_KEY" }, { status: 500 })
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text: query.trim() }] },
          outputDimensionality: 768,
        }),
      }
    )
    if (!geminiRes.ok) {
      const errText = await geminiRes.text()
      return NextResponse.json({ error: `Gemini API lỗi: ${geminiRes.status} ${errText}` }, { status: 500 })
    }
    const geminiJson = (await geminiRes.json()) as { embedding?: { values: number[] } }
    const embedding = geminiJson.embedding?.values
    if (!embedding) {
      return NextResponse.json({ error: "Gemini không trả về embedding" }, { status: 500 })
    }

    // Gọi RPC pgvector — luôn dùng factory_id thật của người gọi, bỏ qua mọi giá trị client gửi.
    const { data, error } = await supabaseAdmin.rpc("match_iso_templates", {
      query_embedding: embedding,
      p_factory_id: profile.factory_id,
      match_count: Math.min(limit, 20),
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const rawResults = (data ?? []) as RawMatchRow[]
    const results: TemplateSearchResult[] = rawResults.map((row) => ({
      id: row.id,
      ten_tai_lieu: row.ten_tai_lieu,
      ma_tai_lieu: row.ma_tai_lieu,
      loai_tai_lieu: row.loai_tai_lieu,
      phong_ban: row.phong_ban,
      lan_ban_hanh: row.lan_ban_hanh,
      phan_loai_tl: row.phan_loai_tl,
      file_ext: resolveFileExt(row),
      has_file: Boolean(row.file_signed_pdf_url || row.file_signed_office_url || row.file_goc_url),
      mo_ta_tim_kiem: row.mo_ta_tim_kiem,
      similarity: row.similarity,
    }))

    return NextResponse.json({ results })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: err instanceof Error && err.name === "SessionExpiredError" ? 401 : 500 })
  }
}
