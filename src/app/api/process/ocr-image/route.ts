import { NextRequest, NextResponse } from "next/server"

// OCR ảnh đồng hồ đo chỉ tiêu Po / Mo bằng Gemini Vision — TỰ NHẬN DẠNG thiết bị trong ảnh,
// không cần biết trước ảnh là Po hay Mo. Cho phép upload nhiều ảnh cùng lúc (mỗi ảnh gọi route
// này riêng), AI tự xác định từng ảnh thuộc chỉ tiêu nào và trả giá trị tương ứng.
// POST body: { imageBase64: string, mimeType: string }
// Response: { chiTieu: "Po" | "Mo", value: number } | { error: string }

const AUTO_PROMPT = `This photo shows ONE of two possible Wallace lab instrument displays used for rubber testing. First identify which instrument it is, then extract its reading using the matching rule below.

INSTRUMENT "Po" — Wallace RAPID PLASTIMETER: has one large blue or dark backlit LCD screen (near a "VALUE" button).
- If that LCD shows a decimal number with a decimal point (e.g. "39.0", "47.5"), use that number exactly as displayed — do NOT divide it by 10.
- Only if it shows a plain integer with NO decimal point at all (e.g. "470"), the actual Po value = displayed number ÷ 10 (e.g. "470" → 47.0).
- Ignore button labels like CALIBRATE, MEDIAN, TEMP.

INSTRUMENT "Mo" — Wallace Mooney Viscometer control panel: has a small green monochrome dot-matrix LCD with two lines of text, where the FIRST line reads "* Mooney *".
- The Mo value is the number on the LEFT side of the SECOND line of that same screen (e.g. "82.0"). That second line may also show an unrelated small counter/timer number on its RIGHT side (e.g. "0") — IGNORE that right-side number completely.
- Do NOT read the other separate small digital displays on the panel labeled "upper platen" / "lower platen" (they show temperature values like "100.3") — those are NOT the Mo value.

Decide which of the two instruments is shown in this photo, then extract its value using the matching rule above.
Respond with EXACTLY one line in this format, nothing else: LABEL:VALUE
- LABEL must be exactly "Po" or "Mo".
- VALUE must be a plain decimal number.
Example outputs: "Po:39.0" or "Mo:82.0"`

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, mimeType } = await req.json() as {
      imageBase64?: string
      mimeType?: string
    }

    if (!imageBase64 || !mimeType) {
      return NextResponse.json({ error: "Thiếu imageBase64 hoặc mimeType" }, { status: 400 })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: "Thiếu GEMINI_API_KEY" }, { status: 500 })
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: AUTO_PROMPT },
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
            thinkingConfig: { thinkingBudget: 0 },
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
    const match = rawText.match(/(Po|Mo)\s*:\s*(-?[0-9]+(?:\.[0-9]+)?)/i)

    if (!match) {
      return NextResponse.json(
        { error: `Không nhận dạng được ảnh (Gemini trả về: "${rawText}")` },
        { status: 422 }
      )
    }

    const chiTieu = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase()
    const value = parseFloat(match[2])

    if (isNaN(value)) {
      return NextResponse.json(
        { error: `Không đọc được số từ ảnh (Gemini trả về: "${rawText}")` },
        { status: 422 }
      )
    }

    return NextResponse.json({ chiTieu, value })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
