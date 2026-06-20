import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
  try {
    const { imageUrl } = (await req.json()) as { imageUrl?: string }
    if (!imageUrl) return NextResponse.json({ plate: null })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ plate: null })

    // Download image and convert to base64
    const imgRes = await fetch(imageUrl)
    if (!imgRes.ok) return NextResponse.json({ plate: null })
    const imgBuf = await imgRes.arrayBuffer()
    const base64 = Buffer.from(imgBuf).toString("base64")
    const mimeType = (imgRes.headers.get("content-type") ?? "image/jpeg").split(";")[0]

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: "Đọc biển số xe trong ảnh. Chỉ trả về chuỗi biển số xe (ví dụ: 51C-123.45 hoặc 51C 123.45), không kèm thêm giải thích. Nếu không thấy biển số xe rõ ràng, trả về NONE.",
                },
                {
                  inline_data: { mime_type: mimeType, data: base64 },
                },
              ],
            },
          ],
          generationConfig: { maxOutputTokens: 30 },
        }),
      },
    )

    if (!geminiRes.ok) return NextResponse.json({ plate: null })

    const json = (await geminiRes.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> }
      }>
    }
    const raw = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ""
    const plate = !raw || raw === "NONE" ? null : raw

    return NextResponse.json({ plate })
  } catch {
    return NextResponse.json({ plate: null })
  }
}
