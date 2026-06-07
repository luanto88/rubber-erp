import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export type TemplateSearchResult = {
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

export async function POST(req: NextRequest) {
  try {
    const { query, factoryId, limit = 8 } = await req.json() as {
      query?: string
      factoryId?: string
      limit?: number
    }

    if (!query?.trim() || !factoryId) {
      return NextResponse.json({ error: "Thiếu query hoặc factoryId" }, { status: 400 })
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
    const geminiJson = await geminiRes.json() as { embedding?: { values: number[] } }
    const embedding = geminiJson.embedding?.values
    if (!embedding) {
      return NextResponse.json({ error: "Gemini không trả về embedding" }, { status: 500 })
    }

    // Gọi RPC pgvector
    const { data, error } = await supabaseAdmin.rpc("match_iso_templates", {
      query_embedding: embedding,
      p_factory_id: factoryId,
      match_count: Math.min(limit, 20),
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ results: (data ?? []) as TemplateSearchResult[] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
