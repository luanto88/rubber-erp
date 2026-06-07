import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  try {
    const { docId, factoryId } = await req.json() as { docId?: string; factoryId?: string }
    if (!docId || !factoryId) {
      return NextResponse.json({ error: "Thiếu docId hoặc factoryId" }, { status: 400 })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: "Thiếu GEMINI_API_KEY" }, { status: 500 })
    }

    // Lấy thông tin tài liệu
    const { data: doc, error: docErr } = await supabaseAdmin
      .from("iso_documents")
      .select("id, ten_tai_lieu, ma_tai_lieu, loai_tai_lieu, phong_ban, mo_ta_tim_kiem, factory_id")
      .eq("id", docId)
      .eq("factory_id", factoryId)
      .single()

    if (docErr || !doc) {
      return NextResponse.json({ error: "Không tìm thấy tài liệu" }, { status: 404 })
    }

    // Build embed text
    const parts = [
      doc.ten_tai_lieu ?? "",
      doc.ma_tai_lieu ?? "",
      doc.loai_tai_lieu ?? "",
      doc.phong_ban ?? "",
      doc.mo_ta_tim_kiem ?? "",
    ].filter(Boolean)
    const embedText = parts.join(" ")

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text: embedText }] },
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

    // Lưu embedding vào DB
    const { error: updateErr } = await supabaseAdmin
      .from("iso_documents")
      .update({ embedding })
      .eq("id", docId)
      .eq("factory_id", factoryId)

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, dims: embedding.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
