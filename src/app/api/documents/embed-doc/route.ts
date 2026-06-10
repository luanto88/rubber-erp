import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"

export const dynamic = "force-dynamic"

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ""

export async function POST(req: NextRequest) {
  try {
    const { docId, factoryId } = (await req.json()) as {
      docId?: string
      factoryId?: string
    }
    if (!docId || !factoryId) {
      return NextResponse.json({ error: "Thiếu docId hoặc factoryId" }, { status: 400 })
    }
    if (!GEMINI_API_KEY) {
      return NextResponse.json({ error: "GEMINI_API_KEY chưa được cấu hình" }, { status: 500 })
    }

    const { data: doc, error: fetchErr } = await supabaseAdmin
      .from("van_ban_documents")
      .select("id, ma_van_ban, ten_van_ban, loai_van_ban, phong_ban, mo_ta_tim_kiem")
      .eq("id", docId)
      .eq("factory_id", factoryId)
      .single()

    if (fetchErr || !doc) {
      return NextResponse.json({ error: "Không tìm thấy văn bản" }, { status: 404 })
    }

    const embedText = [
      doc.ma_van_ban,
      doc.ten_van_ban,
      doc.loai_van_ban,
      doc.phong_ban,
      doc.mo_ta_tim_kiem,
    ]
      .filter(Boolean)
      .join(" ")

    if (!embedText.trim()) {
      return NextResponse.json({ skipped: true, reason: "empty text" })
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text: embedText }] },
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

    const { error: updateErr } = await supabaseAdmin
      .from("van_ban_documents")
      .update({ embedding: JSON.stringify(embedding) })
      .eq("id", docId)
      .eq("factory_id", factoryId)

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, docId })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Lỗi không xác định"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
