/**
 * Script tải và cập nhật ảnh từ Google Drive (G:\My Drive) lên Supabase Storage
 * cho các biên bản và dòng thiết bị bảo trì vừa đồng bộ.
 *
 * Cách chạy:
 *   - Chạy thử (dry-run, không upload thực):
 *       node --env-file=.env.local scripts/sync-appsheet-images.mjs --dry-run
 *   - Chạy đồng bộ toàn bộ ảnh (có resume/bỏ qua dòng đã có ảnh):
 *       node --env-file=.env.local scripts/sync-appsheet-images.mjs
 *   - Giới hạn test N dòng:
 *       node --env-file=.env.local scripts/sync-appsheet-images.mjs --limit 50
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
const CONCURRENCY = 15 // Số luồng upload đồng thời

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
const limitIdx = args.indexOf("--limit")
const limitCount = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity

console.log("=================================================================")
console.log("🖼️  ĐỒNG BỘ KHO ẢNH TỪ GOOGLE DRIVE LÊN SUPABASE STORAGE")
console.log(`📌 Chế độ: ${isDryRun ? "DRY-RUN (Chỉ kiểm thử)" : "THỰC THI (Upload & Cập nhật DB)"}`)
console.log(`⚡ Luồng song song: ${CONCURRENCY}`)
if (Number.isFinite(limitCount)) console.log(`⏱️  Giới hạn test: ${limitCount} mục`)
console.log("=================================================================\n")

// ─── 1. QUÉT TỆP ẢNH TRÊN Ổ G: DRIVE ──────────────────────────────────────────

const localImageDirs = [
  "G:/My Drive/appsheet/data/Chấtlượng-895871990/Hu_hong_Images",
  "G:/My Drive/appsheet/data/QuảnlýsảnxuấtKPT-895871990/Hu_hong_Images",
  "G:/My Drive/appsheet/data/QuảnlýsảnxuấtKPTtest-895871990/Hu_hong_Images",
  "G:/My Drive/appsheet/data/Chấtlượng-895871990/Bao_duong_Images",
]

const diskImageIndex = new Map()
console.log("🔍 Đang quét các tệp ảnh trên Google Drive (G:\\My Drive)...")
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
    console.warn(`  ⚠️ Thư mục ${dir}: ${err.message}`)
  }
}
console.log(`  ✅ Đã tìm thấy ${diskImageIndex.size} tệp ảnh trên ổ G:\n`)

// ─── 2. HÀM UPLOAD VỚI POOL LUỒNG SONG SONG ───────────────────────────────────

const uploadCache = new Map()

async function uploadFileToSupabase(filename) {
  const lower = filename.toLowerCase()
  if (uploadCache.has(lower)) return uploadCache.get(lower)

  const fullPath = diskImageIndex.get(lower)
  if (!fullPath || !fs.existsSync(fullPath)) return null

  if (isDryRun) {
    const mockUrl = `https://supabase.mock/${FACTORY_ID}/maintenance/legacy/${filename}`
    uploadCache.set(lower, mockUrl)
    return mockUrl
  }

  try {
    const buf = fs.readFileSync(fullPath)
    const storagePath = `${FACTORY_ID}/maintenance/legacy/${filename}`

    const { error } = await sb.storage.from(IMAGE_BUCKET).upload(storagePath, buf, {
      contentType: "image/jpeg",
      upsert: true,
    })

    if (error && !error.message.includes("The resource already exists")) {
      return null
    }

    const { data } = sb.storage.from(IMAGE_BUCKET).getPublicUrl(storagePath)
    uploadCache.set(lower, data.publicUrl)
    return data.publicUrl
  } catch (err) {
    return null
  }
}

// ─── 3. TẢI TOÀN BỘ BIÊN BẢN VÀ DÒNG BẰNG PHÂN TRANG (VƯỢT GIỚI HẠN 1000) ────

console.log("📥 Đang tải danh sách biên bản và dòng thiết bị từ DB...")

async function fetchAllRecords() {
  const all = []
  let from = 0
  const PAGE_SIZE = 1000
  while (true) {
    const { data, error } = await sb
      .from("maintenance_records")
      .select("id, ma_bb, ghi_chu, image_urls_chung")
      .eq("factory_id", FACTORY_ID)
      .ilike("ghi_chu", "%[Mã AppSheet:%")
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

async function fetchAllLines() {
  const all = []
  let from = 0
  const PAGE_SIZE = 1000
  while (true) {
    const { data, error } = await sb
      .from("maintenance_record_lines")
      .select("id, record_id, sort_order, image_urls")
      .eq("factory_id", FACTORY_ID)
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

const dbRecords = await fetchAllRecords()
const recordByLegacyId = new Map()
for (const r of dbRecords || []) {
  const m = r.ghi_chu.match(/\[Mã AppSheet:\s*([^\]]+)\]/)
  if (m && m[1]) {
    recordByLegacyId.set(m[1].trim(), r)
  }
}
console.log(`  ✅ Đã tải toàn bộ ${recordByLegacyId.size} biên bản AppSheet từ DB\n`)

// ─── 4. ĐỒNG BỘ ẢNH CHUNG CỦA BẢO DƯỠNG (HEADER) ──────────────────────────────

const parentFile = path.join(ROOT_DIR, "cung_cap_dl", "file_appsheet bao duong.xlsx")
const wbParent = XLSX.readFile(parentFile)
const parentRows = XLSX.utils.sheet_to_json(wbParent.Sheets["Bao_duong"], { defval: null })

const headerTasks = []
for (const pRow of parentRows) {
  if (!pRow.ID_BD) continue
  const idBd = String(pRow.ID_BD).trim()
  const rec = recordByLegacyId.get(idBd)
  if (!rec) continue

  // Bỏ qua nếu biên bản này đã có ảnh chung
  if (rec.image_urls_chung && rec.image_urls_chung.length > 0) continue

  const relPaths = [pRow["Hinh_anh_chung 1"], pRow["Hinh_anh_chung 2"]].filter(Boolean)
  if (relPaths.length === 0) continue

  const filenames = relPaths.map((p) => path.basename(String(p).trim()))
  headerTasks.push({
    recordId: rec.id,
    filenames,
  })
}

const finalHeaderTasks = Number.isFinite(limitCount) ? headerTasks.slice(0, limitCount) : headerTasks
console.log(`🚀 Bắt đầu upload ảnh chung cho ${finalHeaderTasks.length} biên bản bảo dưỡng...`)

let commonImgUploaded = 0
for (let i = 0; i < finalHeaderTasks.length; i += CONCURRENCY) {
  const chunk = finalHeaderTasks.slice(i, i + CONCURRENCY)
  await Promise.all(
    chunk.map(async (task) => {
      const urls = []
      for (const fname of task.filenames) {
        const u = await uploadFileToSupabase(fname)
        if (u) {
          urls.push(u)
          commonImgUploaded++
        }
      }
      if (urls.length > 0 && !isDryRun) {
        await sb.from("maintenance_records").update({ image_urls_chung: urls }).eq("id", task.recordId)
      }
    })
  )
  if ((i + CONCURRENCY) % 50 === 0 || i + CONCURRENCY >= finalHeaderTasks.length) {
    console.log(`  ⏳ Đã xử lý ${Math.min(i + CONCURRENCY, finalHeaderTasks.length)} / ${finalHeaderTasks.length} biên bản chung...`)
  }
}
console.log(`  ✅ Hoàn thành ảnh chung: ${commonImgUploaded} ảnh mới\n`)

// ─── 5. ĐỒNG BỘ ẢNH TỪNG DÒNG THIẾT BỊ (LINES) ───────────────────────────────

const dbLines = await fetchAllLines()
const lineMap = new Map()
for (const l of dbLines || []) {
  lineMap.set(`${l.record_id}_${l.sort_order}`, l)
}
console.log(`  ✅ Đã tải toàn bộ ${dbLines?.length || 0} dòng thiết bị từ DB\n`)

const childFile = path.join(ROOT_DIR, "cung_cap_dl", "file_appsheet.xlsx")
const wbChild = XLSX.readFile(childFile)
const childRows = XLSX.utils.sheet_to_json(wbChild.Sheets["Hu_hong"], { defval: null })

const validChildRows = childRows.filter((r) => {
  if (!r.ID && !r.ID_BD && !r.Su_co && !r.Ten_TB) return false
  if (r.Bo_phan === "Hoạt động khác" || (r.ID && String(r.ID).startsWith("HK"))) return false
  if (r.Bo_phan === "Hư hỏng khác" || (r.ID && String(r.ID).startsWith("K"))) return false
  return true
})

const childByLegacyId = new Map()
for (const r of validChildRows) {
  const legacyKey = r.ID_BD ? String(r.ID_BD).trim() : (r.ID ? String(r.ID).trim() : `SC-ROW-${r.Key}`)
  if (!childByLegacyId.has(legacyKey)) childByLegacyId.set(legacyKey, [])
  childByLegacyId.get(legacyKey).push(r)
}

const lineTasks = []
for (const [legacyId, rows] of childByLegacyId.entries()) {
  const rec = recordByLegacyId.get(legacyId)
  if (!rec) continue

  for (let sortOrder = 0; sortOrder < rows.length; sortOrder++) {
    const child = rows[sortOrder]
    const line = lineMap.get(`${rec.id}_${sortOrder}`)
    if (!line) continue

    // Bỏ qua nếu dòng này đã có ảnh
    if (line.image_urls && line.image_urls.length > 0) continue

    const imgRelPaths = []
    for (let i = 1; i <= 6; i++) {
      const p = child[`Hinh_anh ${i}`]
      if (p && typeof p === "string" && p.includes("Hu_hong_Images/")) {
        imgRelPaths.push(path.basename(p.trim()))
      }
    }

    if (imgRelPaths.length > 0) {
      lineTasks.push({
        lineId: line.id,
        filenames: imgRelPaths,
      })
    }
  }
}

const finalLineTasks = Number.isFinite(limitCount) ? lineTasks.slice(0, limitCount) : lineTasks
console.log(`🚀 Bắt đầu upload và cập nhật ảnh cho ${finalLineTasks.length} dòng thiết bị cần bổ sung ảnh (15 luồng)...`)

let linesUpdated = 0
let lineImagesUploaded = 0

for (let i = 0; i < finalLineTasks.length; i += CONCURRENCY) {
  const chunk = finalLineTasks.slice(i, i + CONCURRENCY)
  await Promise.all(
    chunk.map(async (task) => {
      const urls = []
      for (const fname of task.filenames) {
        const u = await uploadFileToSupabase(fname)
        if (u) {
          urls.push(u)
          lineImagesUploaded++
        }
      }

      if (urls.length > 0 && !isDryRun) {
        await sb.from("maintenance_record_lines").update({ image_urls: urls }).eq("id", task.lineId)
        linesUpdated++
      }
    })
  )

  if ((i + CONCURRENCY) % 100 === 0 || i + CONCURRENCY >= finalLineTasks.length) {
    console.log(`  ⏳ Đã xử lý ${Math.min(i + CONCURRENCY, finalLineTasks.length)} / ${finalLineTasks.length} dòng (${lineImagesUploaded} ảnh mới tải lên)...`)
  }
}

console.log("\n=================================================================")
console.log("🎉 KẾT QUẢ ĐỒNG BỘ KHO ẢNH:")
console.log(`  ✅ Ảnh chung bảo dưỡng mới:       ${commonImgUploaded}`)
console.log(`  ✅ Dòng thiết bị vừa cập nhật:     ${linesUpdated}`)
console.log(`  🖼️  Ảnh chi tiết thiết bị mới:      ${lineImagesUploaded}`)
console.log(`  🌟 Tổng ảnh đưa lên Supabase mới:  ${commonImgUploaded + lineImagesUploaded}`)
console.log("=================================================================\n")
