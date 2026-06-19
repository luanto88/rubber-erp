import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ""
const GEMINI_MODEL = "gemini-2.0-flash"
const MAX_IMAGES = 2

function createEmptyCodes(count: number) {
  return Array.from({ length: count }, () => "")
}

function normalizeDetectedCode(value: unknown) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9/.-]/g, "")
    .slice(0, 40)
}

function extractCandidateText(payload: unknown) {
  const candidates =
    (payload as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>
        }
      }>
    })?.candidates || []

  return candidates
    .flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text || "")
    .join("\n")
    .trim()
}

async function fileToInlineData(url: string) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Khong tai duoc anh OCR: ${response.status}`)
  }

  const mimeType = response.headers.get("content-type") || "image/jpeg"
  if (!mimeType.startsWith("image/")) {
    throw new Error("File OCR khong phai dinh dang anh hop le.")
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  return {
    inlineData: {
      mimeType,
      data: buffer.toString("base64"),
    },
  }
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const payload = (await req.json().catch(() => null)) as {
      factoryId?: string
      imageUrls?: string[]
    } | null

    if (!payload?.factoryId || !Array.isArray(payload.imageUrls)) {
      return NextResponse.json({ error: "Thieu du lieu OCR." }, { status: 400 })
    }

    if (payload.imageUrls.length === 0) {
      return NextResponse.json({ codes: [] })
    }

    if (payload.imageUrls.length > MAX_IMAGES) {
      return NextResponse.json({ error: "Chi ho tro toi da 2 anh." }, { status: 400 })
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("factory_id, status")
      .eq("id", authUser.id)
      .single()

    if (profileError || !profile) {
      throw new Error(profileError?.message || "Khong tai duoc ho so nguoi dung.")
    }

    if (profile.status !== "active") {
      return NextResponse.json({ error: "Tai khoan khong con hoat dong." }, { status: 403 })
    }

    if (profile.factory_id !== payload.factoryId) {
      return NextResponse.json({ error: "Khong dung nha may OCR du lieu." }, { status: 403 })
    }

    const imageUrls = payload.imageUrls.map((url) => String(url || "").trim()).filter(Boolean)
    for (const url of imageUrls) {
      if (!url.includes("/product-files/") || !url.includes(`/${payload.factoryId}/lots/`)) {
        return NextResponse.json(
          { error: "Anh OCR khong thuoc phieu thanh pham cua nha may hien tai." },
          { status: 400 },
        )
      }
    }

    if (!GEMINI_API_KEY) {
      return NextResponse.json({
        codes: createEmptyCodes(imageUrls.length),
        warning: "OCR_DISABLED",
      })
    }

    try {
      const imageParts = await Promise.all(imageUrls.map((url) => fileToInlineData(url)))
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            generationConfig: {
              responseMimeType: "application/json",
            },
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: [
                      "OCR ma tren anh phieu thanh pham.",
                      "Moi anh chi tra ve toi da 1 ma chinh.",
                      "Chi giu ky tu A-Z, 0-9, /, ., -.",
                      "Neu khong chac chan thi tra ve chuoi rong.",
                      "Tra ve dung JSON: {\"codes\":[\"MA1\",\"MA2\"]}.",
                      "Do dai mang codes phai bang so anh dau vao, toi da 2.",
                      "Vi du ma hop le: 347CS/26, BN, 10.2, MN.",
                    ].join(" "),
                  },
                  ...imageParts,
                ],
              },
            ],
          }),
        },
      )

      const geminiJson = (await geminiRes.json().catch(() => null)) as unknown
      if (!geminiRes.ok) {
        console.warn("[product][ocr] Gemini unavailable, fallback to empty codes", {
          status: geminiRes.status,
          body: geminiJson,
        })
        return NextResponse.json({
          codes: createEmptyCodes(imageUrls.length),
          warning: geminiRes.status === 429 ? "OCR_QUOTA_EXCEEDED" : "OCR_UNAVAILABLE",
        })
      }

      const rawText = extractCandidateText(geminiJson)
      let parsed: { codes?: unknown[] } | null = null
      if (rawText) {
        try {
          parsed = JSON.parse(rawText) as { codes?: unknown[] }
        } catch (error) {
          console.warn("[product][ocr] Gemini returned non-JSON payload", {
            rawText,
            error: error instanceof Error ? error.message : error,
          })
        }
      }

      const codes = Array.from({ length: imageUrls.length }, (_, index) =>
        normalizeDetectedCode(parsed?.codes?.[index] || ""),
      )

      return NextResponse.json({ codes })
    } catch (error) {
      console.warn("[product][ocr] OCR fallback to empty codes", error)
      return NextResponse.json({
        codes: createEmptyCodes(imageUrls.length),
        warning: "OCR_FAILED",
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Khong OCR duoc ma anh."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
