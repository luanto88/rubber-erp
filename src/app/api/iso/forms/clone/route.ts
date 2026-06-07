import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const BUCKET = "iso-documents"

function getStorageRelPath(fileUrl: string | null): string | null {
  if (!fileUrl) return null
  const cleanUrl = fileUrl.split("?")[0]
  const marker = `/storage/v1/object/public/${BUCKET}/`
  const idx = cleanUrl.indexOf(marker)
  if (idx >= 0) {
    const rel = cleanUrl.slice(idx + marker.length)
    return decodeURIComponent(rel)
  }
  // fallback: không phải URL Supabase, trả nguyên
  if (!/^https?:\/\//i.test(cleanUrl)) return cleanUrl
  return null
}

function getFileExt(url: string): string {
  const clean = url.split("?")[0]
  const parts = clean.split(".")
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "docx"
}

export async function POST(req: NextRequest) {
  try {
    const {
      templateDocId,
      tieu_de,
      factoryId,
      userId,
    } = await req.json() as {
      templateDocId?: string
      tieu_de?: string
      factoryId?: string
      userId?: string
    }

    if (!templateDocId || !tieu_de?.trim() || !factoryId || !userId) {
      return NextResponse.json(
        { error: "Thiếu tham số: templateDocId, tieu_de, factoryId, userId" },
        { status: 400 },
      )
    }

    // Lấy template doc
    const { data: template, error: tErr } = await supabaseAdmin
      .from("iso_documents")
      .select("id, ten_tai_lieu, file_signed_office_url, file_signed_office_type, file_goc_url, file_signed_pdf_url, trang_thai, factory_id")
      .eq("id", templateDocId)
      .eq("factory_id", factoryId)
      .single()

    if (tErr || !template) {
      return NextResponse.json({ error: "Không tìm thấy template" }, { status: 404 })
    }

    if (template.trang_thai !== "co_hieu_luc") {
      return NextResponse.json({ error: "Template không còn hiệu lực" }, { status: 400 })
    }

    // Chọn file nguồn: ưu tiên Office đã ký, fallback file gốc
    const sourceUrl =
      (template.file_signed_office_url as string | null) ||
      (template.file_goc_url as string | null)

    // Nếu chỉ có PDF cuối
    const isPdfOnly =
      !sourceUrl ||
      (sourceUrl.split("?")[0].toLowerCase().endsWith(".pdf") && !template.file_signed_office_url)

    // Khi chỉ có PDF: tạo instance không có draft file, user sẽ tự upload
    if (isPdfOnly) {
      const templatePdfUrl = (template.file_signed_pdf_url as string | null) || sourceUrl || null

      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("iso_form_instances")
        .insert({
          factory_id: factoryId,
          template_doc_id: templateDocId,
          tieu_de: tieu_de.trim(),
          nguoi_tao: userId,
          trang_thai: "draft",
          cap_tl: "Cấp 1",
          auto_convert_pdf: false,
          draft_file_url: null,
          draft_file_type: null,
        })
        .select("id")
        .single()

      if (insErr || !inserted) {
        return NextResponse.json({ error: insErr?.message || "Lỗi tạo instance" }, { status: 500 })
      }

      const instanceId = inserted.id as string
      await supabaseAdmin.from("iso_form_instance_logs").insert({
        instance_id: instanceId,
        factory_id: factoryId,
        user_id: userId,
        action: "clone",
        note: `Tạo từ template PDF: ${template.ten_tai_lieu}`,
      })

      return NextResponse.json({ instanceId, isPdfOnly: true, templatePdfUrl })
    }

    const ext = template.file_signed_office_type ||
      (sourceUrl ? getFileExt(sourceUrl) : "docx")

    const srcPath = getStorageRelPath(sourceUrl!)
    if (!srcPath) {
      return NextResponse.json({ error: "Không trích xuất được đường dẫn Storage từ URL template" }, { status: 500 })
    }

    // Tạo instance row trước để lấy id
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("iso_form_instances")
      .insert({
        factory_id: factoryId,
        template_doc_id: templateDocId,
        tieu_de: tieu_de.trim(),
        nguoi_tao: userId,
        trang_thai: "draft",
        cap_tl: "Cấp 1",
        auto_convert_pdf: false,
        draft_file_type: ext,
      })
      .select("id")
      .single()

    if (insErr || !inserted) {
      return NextResponse.json({ error: insErr?.message || "Lỗi tạo instance" }, { status: 500 })
    }

    const instanceId = inserted.id as string
    const dstPath = `${factoryId}/iso/instances/${instanceId}/draft.${ext}`

    // Copy file trong Storage
    const { error: copyErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .copy(srcPath, dstPath)

    if (copyErr) {
      // Rollback: xóa instance vừa tạo
      await supabaseAdmin.from("iso_form_instances").delete().eq("id", instanceId)
      return NextResponse.json({ error: `Lỗi copy file: ${copyErr.message}` }, { status: 500 })
    }

    // Lấy public URL của draft file
    const { data: urlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(dstPath)
    const draftFileUrl = urlData?.publicUrl ?? null

    // Cập nhật draft_file_url
    const { error: updateErr } = await supabaseAdmin
      .from("iso_form_instances")
      .update({ draft_file_url: draftFileUrl })
      .eq("id", instanceId)

    if (updateErr) {
      await supabaseAdmin.from("iso_form_instances").delete().eq("id", instanceId)
      await supabaseAdmin.storage.from(BUCKET).remove([dstPath])
      return NextResponse.json({ error: `Lỗi lưu draft URL: ${updateErr.message}` }, { status: 500 })
    }

    // Log
    await supabaseAdmin.from("iso_form_instance_logs").insert({
      instance_id: instanceId,
      factory_id: factoryId,
      user_id: userId,
      action: "clone",
      note: `Tạo từ template: ${template.ten_tai_lieu}`,
    })

    return NextResponse.json({ instanceId, draftFileUrl, ext })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
