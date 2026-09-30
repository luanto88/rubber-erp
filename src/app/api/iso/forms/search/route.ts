import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireAuthUser } from "@/app/api/account/_lib/security"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Vá bảo mật 2026-09-20: route này bắt buộc `Authorization: Bearer`, KHÔNG tin `factoryId` từ
// client — luôn dùng `profiles.factory_id` thật của người gọi.
// Đồng thời áp dụng Hybrid Search (Keyword Match + AI Vector Search) để đảm bảo các từ khóa
// tìm kiếm trực tiếp (như "sửa chữa" -> "Phiếu sửa chữa") luôn được ưu tiên chuẩn xác 100%.

type RawMatchRow = {
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
  embedding?: unknown
}

export type TemplateSearchResult = {
  id: string
  ten_tai_lieu: string
  ma_tai_lieu: string | null
  loai_tai_lieu: string | null
  phong_ban: string | null
  lan_ban_hanh: string | null
  phan_loai_tl: string | null
  file_ext: string
  has_file: boolean
  mo_ta_tim_kiem: string | null
  similarity: number
}

function resolveFileExt(row: {
  file_signed_office_type?: string | null
  file_signed_office_url?: string | null
  file_goc_url?: string | null
}): string {
  if (row.file_signed_office_type) return row.file_signed_office_type
  if (row.file_signed_office_url) return "docx"
  const ext = row.file_goc_url?.split(".").pop()
  return ext || "pdf"
}

function normalizeVi(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .trim()
}

function calculateKeywordScore(
  query: string,
  doc: { ten_tai_lieu: string; ma_tai_lieu: string | null; mo_ta_tim_kiem: string | null; phong_ban: string | null }
): number {
  const qRaw = query.toLowerCase().trim()
  const qNorm = normalizeVi(query)
  const titleRaw = (doc.ten_tai_lieu || "").toLowerCase()
  const titleNorm = normalizeVi(doc.ten_tai_lieu || "")
  const codeRaw = (doc.ma_tai_lieu || "").toLowerCase()
  const codeNorm = normalizeVi(doc.ma_tai_lieu || "")
  const descRaw = (doc.mo_ta_tim_kiem || "").toLowerCase()
  const descNorm = normalizeVi(doc.mo_ta_tim_kiem || "")

  // Khớp chính xác hoàn toàn mã hoặc tiêu đề
  if (codeRaw === qRaw || codeNorm === qNorm) return 0.99
  if (titleRaw === qRaw || titleNorm === qNorm) return 0.98

  // Mã chứa query (vd: tìm "F02" ra PHK-QT05-F02)
  if (codeRaw.includes(qRaw) || codeNorm.includes(qNorm)) return 0.96

  // Tiêu đề chứa nguyên cụm query (vd: tìm "sửa chữa" ra "Phiếu sửa chữa")
  if (titleRaw.includes(qRaw)) return 0.95
  if (titleNorm.includes(qNorm)) return 0.93

  // Mô tả chứa nguyên cụm query
  if (descRaw.includes(qRaw) || descNorm.includes(qNorm)) return 0.85

  // Tách từng từ khóa để kiểm tra độ phủ
  const tokens = qNorm.split(/\s+/).filter((t) => t.length > 0)
  if (tokens.length > 1) {
    const fullTextNorm = `${codeNorm} ${titleNorm} ${descNorm}`
    const matchedCount = tokens.filter((t) => fullTextNorm.includes(t)).length
    const ratio = matchedCount / tokens.length
    if (ratio === 1) return 0.88 // Khớp toàn bộ các từ
    if (ratio >= 0.5) return 0.65 + ratio * 0.15 // Khớp phần lớn các từ
  }

  return 0.5
}

// Tự động embed ngầm các tài liệu thiếu embedding để hoàn thiện chỉ mục vector
async function autoEmbedDoc(
  doc: { id: string; ten_tai_lieu: string; ma_tai_lieu: string | null; loai_tai_lieu: string | null; phong_ban: string | null; mo_ta_tim_kiem: string | null },
  apiKey: string,
  factoryId: string
) {
  try {
    const textToEmbed = [
      doc.ten_tai_lieu,
      doc.ma_tai_lieu,
      doc.loai_tai_lieu,
      doc.phong_ban,
      doc.mo_ta_tim_kiem,
    ].filter(Boolean).join(" ")

    if (!textToEmbed.trim()) return

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text: textToEmbed }] },
          outputDimensionality: 768,
        }),
      }
    )
    if (!res.ok) return
    const json = await res.json() as { embedding?: { values: number[] } }
    const values = json.embedding?.values
    if (!values) return

    await supabaseAdmin
      .from("iso_documents")
      .update({ embedding: values })
      .eq("id", doc.id)
      .eq("factory_id", factoryId)
  } catch {
    // bỏ qua lỗi cập nhật ngầm
  }
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("factory_id, status")
      .eq("id", authUser.id)
      .maybeSingle()

    if (profileError || !profile || profile.status !== "active" || !profile.factory_id) {
      return NextResponse.json({ error: "Tài khoản không hợp lệ" }, { status: 403 })
    }

    const { query, limit = 8 } = (await req.json()) as {
      query?: string
      limit?: number
    }

    if (!query?.trim()) {
      return NextResponse.json({ error: "Thiếu query" }, { status: 400 })
    }

    const trimmedQuery = query.trim()
    const apiKey = process.env.GEMINI_API_KEY
    const resultMap = new Map<string, TemplateSearchResult>()

    // ── BƯỚC 1: Tìm kiếm trực tiếp theo Từ khóa (Keyword & Substring Matching) ──
    try {
      const orFilters = [
        `ten_tai_lieu.ilike.%${trimmedQuery}%`,
        `ma_tai_lieu.ilike.%${trimmedQuery}%`,
        `mo_ta_tim_kiem.ilike.%${trimmedQuery}%`,
      ]
      const words = trimmedQuery.split(/\s+/).filter((w) => w.length > 1)
      for (const w of words) {
        orFilters.push(`ten_tai_lieu.ilike.%${w}%`)
        orFilters.push(`ma_tai_lieu.ilike.%${w}%`)
      }

      const { data: keywordDocs } = await supabaseAdmin
        .from("iso_documents")
        .select(`
          id, ten_tai_lieu, ma_tai_lieu, loai_tai_lieu, phong_ban, lan_ban_hanh, phan_loai_tl,
          file_signed_office_url, file_signed_office_type, file_goc_url, file_signed_pdf_url, mo_ta_tim_kiem, embedding
        `)
        .eq("factory_id", profile.factory_id)
        .eq("trang_thai", "co_hieu_luc")
        .or(orFilters.join(","))
        .limit(30)

      if (keywordDocs && keywordDocs.length > 0) {
        for (const doc of keywordDocs) {
          const score = calculateKeywordScore(trimmedQuery, doc)
          resultMap.set(doc.id, {
            id: doc.id,
            ten_tai_lieu: doc.ten_tai_lieu,
            ma_tai_lieu: doc.ma_tai_lieu,
            loai_tai_lieu: doc.loai_tai_lieu,
            phong_ban: doc.phong_ban,
            lan_ban_hanh: doc.lan_ban_hanh,
            phan_loai_tl: doc.phan_loai_tl,
            file_ext: resolveFileExt(doc),
            has_file: Boolean(doc.file_signed_pdf_url || doc.file_signed_office_url || doc.file_goc_url),
            mo_ta_tim_kiem: doc.mo_ta_tim_kiem,
            similarity: score,
          })

          // Kích hoạt embed ngầm nếu tài liệu này chưa có embedding
          if (!doc.embedding && apiKey) {
            void autoEmbedDoc(doc, apiKey, profile.factory_id)
          }
        }
      }
    } catch (keywordErr) {
      console.warn("[iso-search] Lỗi keyword search:", keywordErr)
    }

    // ── BƯỚC 2: Tìm kiếm ngữ nghĩa AI (Vector Cosine Similarity qua Gemini Embedding) ──
    if (apiKey) {
      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "models/gemini-embedding-001",
              content: { parts: [{ text: trimmedQuery }] },
              outputDimensionality: 768,
            }),
          }
        )

        if (geminiRes.ok) {
          const geminiJson = (await geminiRes.json()) as { embedding?: { values: number[] } }
          const embedding = geminiJson.embedding?.values
          if (embedding) {
            const { data: vectorData } = await supabaseAdmin.rpc("match_iso_templates", {
              query_embedding: embedding,
              p_factory_id: profile.factory_id,
              match_count: Math.min(limit, 20),
            })

            const rawVectorResults = (vectorData ?? []) as RawMatchRow[]
            for (const row of rawVectorResults) {
              const existing = resultMap.get(row.id)
              if (existing) {
                // Nếu tài liệu vừa khớp từ khóa vừa có điểm vector, tăng cường độ tương đồng
                existing.similarity = Math.min(0.99, Math.max(existing.similarity, row.similarity) + 0.02)
              } else {
                resultMap.set(row.id, {
                  id: row.id,
                  ten_tai_lieu: row.ten_tai_lieu,
                  ma_tai_lieu: row.ma_tai_lieu,
                  loai_tai_lieu: row.loai_tai_lieu,
                  phong_ban: row.phong_ban,
                  lan_ban_hanh: row.lan_ban_hanh,
                  phan_loai_tl: row.phan_loai_tl,
                  file_ext: resolveFileExt(row),
                  has_file: Boolean(row.file_signed_pdf_url || row.file_signed_office_url || row.file_goc_url),
                  mo_ta_tim_kiem: row.mo_ta_tim_kiem,
                  similarity: row.similarity,
                })
              }
            }
          }
        }
      } catch (vectorErr) {
        console.warn("[iso-search] Lỗi vector search:", vectorErr)
      }
    }

    // ── BƯỚC 3: Sắp xếp theo độ tương đồng giảm dần và cắt theo limit ──
    const results = Array.from(resultMap.values())
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, Math.min(limit, 20))

    return NextResponse.json({ results })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: err instanceof Error && err.name === "SessionExpiredError" ? 401 : 500 })
  }
}
