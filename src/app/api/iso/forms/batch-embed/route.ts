import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// POST /api/iso/forms/batch-embed
// Body: { factoryId: string, forceAll?: boolean }
// forceAll = true: re-embed kể cả những doc đã có embedding (dùng khi đổi model)
// forceAll = false (default): chỉ embed những doc có embedding IS NULL
export async function POST(req: NextRequest) {
  try {
    const { factoryId, forceAll = false } = await req.json() as {
      factoryId?: string
      forceAll?: boolean
    }
    if (!factoryId) {
      return NextResponse.json({ error: "Thiếu factoryId" }, { status: 400 })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: "Thiếu GEMINI_API_KEY" }, { status: 500 })
    }

    // Lấy danh sách tài liệu cần embed
    let query = supabaseAdmin
      .from("iso_documents")
      .select("id, ten_tai_lieu, ma_tai_lieu, loai_tai_lieu, phong_ban, mo_ta_tim_kiem")
      .eq("factory_id", factoryId)
      .eq("trang_thai", "co_hieu_luc")

    if (!forceAll) {
      query = query.is("embedding", null)
    }

    const { data: docs, error: fetchErr } = await query
    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    }
    if (!docs || docs.length === 0) {
      return NextResponse.json({ success: true, processed: 0, failed: 0, message: "Không có tài liệu cần embed" })
    }

    let processed = 0
    let failed = 0
    const errors: { id: string; ma: string; error: string }[] = []

    for (const doc of docs) {
      try {
        const parts = [
          doc.ten_tai_lieu ?? "",
          doc.ma_tai_lieu ?? "",
          doc.loai_tai_lieu ?? "",
          doc.phong_ban ?? "",
          doc.mo_ta_tim_kiem ?? "",
        ].filter(Boolean)
        const embedText = parts.join(" ")
        if (!embedText.trim()) {
          failed++
          errors.push({ id: doc.id, ma: doc.ma_tai_lieu ?? "", error: "Không có nội dung để embed" })
          continue
        }

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
          failed++
          errors.push({ id: doc.id, ma: doc.ma_tai_lieu ?? "", error: `Gemini ${geminiRes.status}: ${errText.slice(0, 100)}` })
          continue
        }

        const geminiJson = await geminiRes.json() as { embedding?: { values: number[] } }
        const embedding = geminiJson.embedding?.values
        if (!embedding) {
          failed++
          errors.push({ id: doc.id, ma: doc.ma_tai_lieu ?? "", error: "Gemini không trả về embedding" })
          continue
        }

        const { error: updateErr } = await supabaseAdmin
          .from("iso_documents")
          .update({ embedding })
          .eq("id", doc.id)
          .eq("factory_id", factoryId)

        if (updateErr) {
          failed++
          errors.push({ id: doc.id, ma: doc.ma_tai_lieu ?? "", error: updateErr.message })
        } else {
          processed++
        }

        // Tránh rate limit: nghỉ 200ms giữa các request
        await new Promise(r => setTimeout(r, 200))
      } catch (e) {
        failed++
        errors.push({ id: doc.id, ma: doc.ma_tai_lieu ?? "", error: String(e) })
      }
    }

    return NextResponse.json({
      success: true,
      total: docs.length,
      processed,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
