/**
 * Script đồng bộ các bản ghi "Hoạt động khác" từ AppSheet vào module Ghi chú nhanh (operation_notes)
 *
 * Yêu cầu:
 *   - Nguồn: cung_cap_dl/file_appsheet.xlsx (97 dòng Bo_phan = 'Hoạt động khác' / tiền tố 'HK')
 *   - Nội dung ghi chú: trường Su_co (chuẩn tiếng Việt có dấu, bổ sung Ghi_chu nếu có)
 *   - Ngày xảy ra: Ngay_su_co
 *   - Hình ảnh: Hinh_anh 1 đến 6 tải từ G:\My Drive lên bucket order-files
 *   - Người tạo mặc định: admin (Administrator)
 *   - Chia sẻ mặc định cho: luanto (Tô Thành Luân)
 *
 * Cách chạy:
 *   - Chạy thử dry-run: node --env-file=.env.local scripts/migrate-appsheet-quick-notes.mjs --dry-run
 *   - Thực thi đầy đủ:  node --env-file=.env.local scripts/migrate-appsheet-quick-notes.mjs
 */

import { createClient } from "@supabase/supabase-js"
import XLSX from "xlsx"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, "..")

const FACTORY_ID = "0268ab41-a564-4538-acf1-6297ac372f57"
const IMAGE_BUCKET = "order-files"
const ADMIN_USER_ID = "21d59cc2-787b-4a8c-b3e8-f1a144dc86de" // username: admin
const LUANTO_USER_ID = "a8a2f678-844b-4fb6-baf8-9823cc364148" // username: luanto
const CONCURRENCY = 10

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const args = process.argv.slice(2)
const isDryRun = args.includes("--dry-run")
const skipImages = args.includes("--skip-images")
const limitIdx = args.indexOf("--limit")
const limitCount = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity

console.log("=================================================================")
console.log("📝 ĐỒNG BỘ 'HOẠT ĐỘNG KHÁC' VÀO GHI CHÚ NHANH (OPERATION_NOTES)")
console.log(`📌 Chế độ: ${isDryRun ? "DRY-RUN (Chỉ kiểm thử)" : "THỰC THI (Ghi DB)"}`)
console.log(`🖼️  Hình ảnh: ${skipImages ? "BỎ QUA ảnh" : "TẢI LÊN Supabase Storage (order-files)"}`)
console.log(`👤 Người tạo: admin (${ADMIN_USER_ID})`)
console.log(`🤝 Chia sẻ cho: luanto (${LUANTO_USER_ID})`)
if (Number.isFinite(limitCount)) console.log(`⏱️  Giới hạn: ${limitCount} bản ghi`)
console.log("=================================================================\n")

// ─── 1. BỘ CHUYỂN ĐỔI NGÀY & GIỜ ─────────────────────────────────────────────

function excelDateToISO(v) {
  if (!v) return null
  if (typeof v === "number") {
    const d = new Date((v - 25569) * 86400 * 1000)
    return d.toISOString().slice(0, 10)
  }
  const str = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10)
  const m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)
  if (m) {
    const dd = m[1].padStart(2, "0")
    const mm = m[2].padStart(2, "0")
    return `${m[3]}-${mm}-${dd}`
  }
  return str
}

function excelTimeToHM(v) {
  if (v === null || v === undefined || v === "") return "08:00:00"
  if (typeof v === "number") {
    const frac = v % 1
    const totalSec = Math.round(frac * 86400)
    const h = String(Math.floor(totalSec / 3600)).padStart(2, "0")
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0")
    const s = String(totalSec % 60).padStart(2, "0")
    return `${h}:${m}:${s}`
  }
  const str = String(v).trim()
  const m = str.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (m) {
    return `${m[1].padStart(2, "0")}:${m[2]}:${(m[3] || "00").padStart(2, "0")}`
  }
  return "08:00:00"
}

// ─── 2. QUÉT VÀ LẬP CHỈ MỤC KHO ẢNH TRÊN G: DRIVE ────────────────────────────

const localImageDirs = [
  "G:/My Drive/appsheet/data/Chấtlượng-895871990/Hu_hong_Images",
  "G:/My Drive/appsheet/data/QuảnlýsảnxuấtKPT-895871990/Hu_hong_Images",
  "G:/My Drive/appsheet/data/QuảnlýsảnxuấtKPTtest-895871990/Hu_hong_Images",
]

const diskImageIndex = new Map()
console.log("🔍 Đang lập chỉ mục kho ảnh trên Google Drive (G:\\My Drive)...")
for (const dir of localImageDirs) {
  try {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir)
      for (const f of files) {
        if (!diskImageIndex.has(f.toLowerCase())) {
          diskImageIndex.set(f.toLowerCase(), path.join(dir, f))
        }
      }
    }
  } catch (err) {
    console.warn(`  ⚠️ Lỗi đọc thư mục ${dir}: ${err.message}`)
  }
}
console.log(`  ✅ Đã tìm thấy ${diskImageIndex.size} tệp ảnh trên ổ G:\n`)

const uploadedUrlCache = new Map()

async function uploadImageIfFound(relPath) {
  if (!relPath || typeof relPath !== "string") return null
  const filename = path.basename(relPath.trim())
  if (!filename) return null

  const lower = filename.toLowerCase()
  if (uploadedUrlCache.has(lower)) return uploadedUrlCache.get(lower)

  const fullPath = diskImageIndex.get(lower)
  if (!fullPath || !fs.existsSync(fullPath)) return null

  if (isDryRun) {
    const mockUrl = `https://supabase.mock/${FACTORY_ID}/notes/legacy/${filename}`
    uploadedUrlCache.set(lower, mockUrl)
    return mockUrl
  }

  if (skipImages) return null

  try {
    const buf = fs.readFileSync(fullPath)
    const storagePath = `${FACTORY_ID}/notes/legacy/${filename}`

    const { error } = await sb.storage.from(IMAGE_BUCKET).upload(storagePath, buf, {
      contentType: "image/jpeg",
      upsert: true,
    })

    if (error && !error.message.includes("The resource already exists")) {
      return null
    }

    const { data } = sb.storage.from(IMAGE_BUCKET).getPublicUrl(storagePath)
    uploadedUrlCache.set(lower, data.publicUrl)
    return data.publicUrl
  } catch {
    return null
  }
}

// ─── 3. ĐỌC DỮ LIỆU TỪ EXCEL VÀ KIỂM TRA CHỐNG TRÙNG LẶP ────────────────────

console.log("📖 Đang đọc sheet Hu_hong từ cung_cap_dl/file_appsheet.xlsx...")
const excelPath = path.join(ROOT_DIR, "cung_cap_dl", "file_appsheet.xlsx")
const wb = XLSX.readFile(excelPath)
const allRows = XLSX.utils.sheet_to_json(wb.Sheets["Hu_hong"], { defval: null })

const hkRows = allRows.filter((r) => r.Bo_phan === "Hoạt động khác" || (r.ID && String(r.ID).startsWith("HK")))
console.log(`  ✅ Tìm thấy ${hkRows.length} dòng Hoạt động khác\n`)

// Kiểm tra ghi chú đã tồn tại trong DB để đảm bảo Idempotent
console.log("📥 Đang kiểm tra các ghi chú đã tồn tại trong operation_notes...")
const { data: existingNotes, error: nErr } = await sb
  .from("operation_notes")
  .select("id, noi_dung")
  .eq("factory_id", FACTORY_ID)
  .ilike("noi_dung", "%[Mã AppSheet:%")
if (nErr) throw nErr

const existingLegacyIds = new Set()
for (const n of existingNotes || []) {
  const m = n.noi_dung.match(/\[Mã AppSheet:\s*([^\]]+)\]/)
  if (m && m[1]) existingLegacyIds.add(m[1].trim())
}
console.log(`  ✅ Đã có ${existingLegacyIds.size} ghi chú AppSheet trong DB\n`)

const rowsToProcess = hkRows.filter((r) => {
  const legacyId = r.ID ? String(r.ID).trim() : `HK-ROW-${r.Key}`
  return !existingLegacyIds.has(legacyId)
})

console.log(`📋 Số ghi chú cần nạp: ${rowsToProcess.length} / ${hkRows.length}`)
const finalRows = Number.isFinite(limitCount) ? rowsToProcess.slice(0, limitCount) : rowsToProcess

// ─── 4. THỰC HIỆN ĐỒNG BỘ VÀO OPERATION_NOTES & OPERATION_NOTE_SHARES ────────

let insertedNotesCount = 0
let insertedSharesCount = 0
let totalUploadedImages = 0

console.log("\n🚀 Bắt đầu quá trình đồng bộ...")

for (let i = 0; i < finalRows.length; i++) {
  const r = finalRows[i]
  const legacyId = r.ID ? String(r.ID).trim() : `HK-ROW-${r.Key}`

  const isoDate = excelDateToISO(r.Ngay_su_co) || "2024-09-12"
  const timeStr = excelTimeToHM(r.Tu_gio)
  const createdAtIso = `${isoDate}T${timeStr}+07:00`

  // Chuẩn bị nội dung ghi chú:
  // Lấy Su_co làm nội dung chính
  let content = r.Su_co ? String(r.Su_co).trim() : "Hoạt động khác"

  // Bổ sung Ghi_chu nếu có nội dung thực tế (không phải là tên file ảnh .jpg)
  if (r.Ghi_chu) {
    const gc = String(r.Ghi_chu).trim()
    if (!gc.toLowerCase().endsWith(".jpg") && !gc.toLowerCase().endsWith(".png") && !gc.includes("Hu_hong_Images/")) {
      content += `\n(Ghi chú: ${gc})`
    }
  }

  // Thêm mã AppSheet để lưu vết và bảo đảm tính duy nhất
  content += `\n[Mã AppSheet: ${legacyId}]`

  // Thu thập và upload ảnh từ Hinh_anh 1 đến 6
  const imageUrls = []
  for (let imgIdx = 1; imgIdx <= 6; imgIdx++) {
    const imgPath = r[`Hinh_anh ${imgIdx}`]
    if (imgPath && typeof imgPath === "string") {
      const url = await uploadImageIfFound(imgPath)
      if (url) {
        imageUrls.push(url)
        totalUploadedImages++
      }
    }
  }

  let noteId = null

  if (!isDryRun) {
    // 4.1 Chèn vào operation_notes
    const { data: noteData, error: insErr } = await sb
      .from("operation_notes")
      .insert({
        factory_id: FACTORY_ID,
        noi_dung: content,
        ngay_xay_ra: isoDate,
        image_urls: imageUrls,
        created_by: ADMIN_USER_ID,
        nguoi_tao: "Administrator",
        created_at: createdAtIso,
        updated_at: createdAtIso,
      })
      .select("id")
      .single()

    if (insErr) {
      console.error(`  ❌ Lỗi chèn ghi chú (${legacyId}):`, insErr.message)
      continue
    }

    noteId = noteData.id
    insertedNotesCount++

    // 4.2 Chèn vào operation_note_shares chia sẻ cho luanto
    const { error: shareErr } = await sb.from("operation_note_shares").insert({
      note_id: noteId,
      factory_id: FACTORY_ID,
      shared_with_user_id: LUANTO_USER_ID,
      shared_by: ADMIN_USER_ID,
      created_at: createdAtIso,
    })

    if (shareErr && !shareErr.message.includes("duplicate key")) {
      console.warn(`    ⚠️ Lỗi chia sẻ cho luanto: ${shareErr.message}`)
    } else {
      insertedSharesCount++
    }
  } else {
    insertedNotesCount++
    insertedSharesCount++
  }

  if ((i + 1) % 20 === 0 || i + 1 === finalRows.length) {
    console.log(`  ⏳ Đã xử lý: ${i + 1} / ${finalRows.length} ghi chú (${totalUploadedImages} ảnh)...`)
  }
}

console.log("\n=================================================================")
console.log("🎉 KẾT QUẢ ĐỒNG BỘ HOẠT ĐỘNG KHÁC:")
console.log(`  ✅ Ghi chú đã tạo (operation_notes):         ${insertedNotesCount}`)
console.log(`  ✅ Đã chia sẻ cho luanto (operation_shares): ${insertedSharesCount}`)
console.log(`  🖼️  Hình ảnh đã xử lý/upload:                 ${totalUploadedImages}`)
console.log("=================================================================\n")
