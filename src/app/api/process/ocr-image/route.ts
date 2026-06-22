import { NextRequest, NextResponse } from "next/server"

// OCR ảnh đồng hồ đo chỉ tiêu Po / Mo bằng Gemini Vision
// POST body: { imageBase64: string, mimeType: string, chiTieu: "Po" | "Mo" }
// Response: { value: number } | { error: string }

const PROMPTS: Record<string, string> = {
  Po: `This is a photo of a RAPID PLASTIMETER instrument display.
The LCD shows a 3-digit or 4-digit integer (e.g. "470").
The actual Po value = displayed number ÷ 10 (e.g. "470" → 47.0).
Look carefully at the LED/LCD digits on the main readout panel.
Return ONLY the final calculated value as a decimal number (e.g. 47.0).
Do NOT include units, labels, or any explanation — just the number.`,

  Mo: `This is a photo of a Wallace Mooney Viscometer display.
The display shows something like "91.5 Mooney 0" or "84 MOONEY".
Extract ONLY the main numeric value that appears BEFORE the word "Mooney" or "MOONEY".
Return ONLY that number (e.g. 91.5 or 84).
Do NOT include units, labels, or any explanation — just the number.`,
}

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, mimeType, chiTieu } = await req.json() as {
      imageBase64?: string
      mimeType?: string
      chiTieu?: string
    }

    if (!imageBase64 || !mimeType || !chiTieu) {
      return NextResponse.json({ error: "Thiếu imageBase64, mimeType hoặc chiTieu" }, { status: 400 })
    }

    const prompt = PROMPTS[chiTieu]
    if (!prompt) {
      return NextResponse.json({ error: `chiTieu "${chiTieu}" không hỗ trợ OCR` }, { status: 400 })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: "Thiếu GEMINI_API_KEY" }, { status: 500 })
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: imageBase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 32,
          },
        }),
      }
    )

    if (!geminiRes.ok) {
      const errText = await geminiRes.text()
      return NextResponse.json(
        { error: `Gemini API lỗi: ${geminiRes.status} — ${errText.slice(0, 200)}` },
        { status: 500 }
      )
    }

    const geminiJson = await geminiRes.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }

    const rawText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ""
    const parsed = parseFloat(rawText.replace(/[^0-9.]/g, ""))

    if (isNaN(parsed)) {
      return NextResponse.json(
        { error: `Không đọc được số từ ảnh (Gemini trả về: "${rawText}")` },
        { status: 422 }
      )
    }

    return NextResponse.json({ value: parsed })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
