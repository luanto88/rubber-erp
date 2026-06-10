import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"

export const dynamic = "force-dynamic"

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ""

export async function POST(req: NextRequest) {
  try {
    const { query, factoryId } = (await req.json()) as {
      query?: string
      factoryId?: string
    }
    if (!query?.trim() || !factoryId) {
      return NextResponse.json({ error: "Thiếu query hoặc factoryId" }, { status: 400 })
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

    return NextResponse.json(results || [])
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Lỗi không xác định"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
