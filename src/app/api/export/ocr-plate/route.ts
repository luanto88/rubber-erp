import { NextRequest, NextResponse } from "next/server"

const PLATE_PROMPT = `Bạn đang xem ảnh chụp xe tải/đầu kéo chở container tại Campuchia. Nhiệm vụ: tìm và đọc chính xác BIỂN SỐ ĐĂNG KÝ XE, không phải mã container hay số liệu khác trên xe.

Đặc điểm biển số xe Campuchia cần tìm:
- Là một tấm biển hình chữ nhật riêng biệt, nền trắng, chữ số màu xanh dương hoặc đen.
- Định dạng: 1 chữ số + 1-2 chữ cái + dấu gạch ngang + 3-4 chữ số, ví dụ: "3F-9676", "4B-0189", "3A-3727", "2A-1234".
- Phía trên hoặc dưới dãy số thường có một dòng chữ Khmer nhỏ (tên tỉnh/thành phố, ví dụ ភ្នំពេញ = Phnom Penh).
- Biển số gắn ở đầu xe (dưới kính lái, trên ba đờ sốc) hoặc cuối rơ-moóc/sơ-mi rơ-moóc.

TUYỆT ĐỐI KHÔNG lấy các số sau, đây không phải biển số xe:
- Mã số container in trên cửa/vách container (dạng 4 chữ cái + 6-7 chữ số, ví dụ "ZCSU 273812", "WHLU 423353").
- Các thông số tải trọng, kích thước (MAX GROSS, TARE, NET, CU. CAP...).
- Số điện thoại, hotline, tên hãng vận tải in trên decal/sticker/logo.
- Số hoặc chữ sơn tay trực tiếp lên khung gầm/sát xi xe, không nằm trong một tấm biển hình chữ nhật riêng.

Nếu ảnh có nhiều biển số (cả đầu xe và đuôi xe/rơ-moóc), chọn biển số nào rõ nét và đọc được đầy đủ nhất.

Chỉ trả về đúng chuỗi biển số xe tìm được, viết hoa, giữ dấu gạch ngang (ví dụ: 3F-9676), không kèm giải thích gì thêm. Nếu không tìm thấy biển số xe hợp lệ nào trong ảnh, trả về NONE.`

function normalizePlate(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.toUpperCase() === "NONE") return null
  const upper = trimmed.toUpperCase()
  const match = upper.match(/(\d[A-Z]{1,2})[\s-]*(\d{3,5})/)
  return match ? `${match[1]}-${match[2]}` : upper
}

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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: PLATE_PROMPT },
                {
                  inline_data: { mime_type: mimeType, data: base64 },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 50,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      },
    )

    if (!geminiRes.ok) {
      console.error("[ocr-plate] Gemini API error", geminiRes.status, await geminiRes.text())
      return NextResponse.json({ plate: null })
    }

    const json = (await geminiRes.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> }
        finishReason?: string
      }>
    }
    const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
    const plate = normalizePlate(raw)

    return NextResponse.json({ plate })
  } catch (err) {
    console.error("[ocr-plate] unexpected error", err)
    return NextResponse.json({ plate: null })
  }
}
