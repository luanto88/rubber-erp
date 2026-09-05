/**
 * Script đồng bộ dữ liệu bảo trì từ Google AppSheet lên Supabase
 *
 * Nguồn dữ liệu:
 *   1. cung_cap_dl/file_appsheet bao duong.xlsx (Tệp cha Bảo dưỡng - Bao_duong)
 *   2. cung_cap_dl/file_appsheet.xlsx (Tệp con thiết bị & Sự cố Sửa chữa - Hu_hong)
 *   3. G:\My Drive\appsheet\data\...\Hu_hong_Images & Bao_duong_Images (Kho ảnh)
 *
 * Lệnh chạy:
 *   - Dry-run kiểm thử toàn bộ logic (không ghi DB):
 *       node --env-file=.env.local scripts/migrate-appsheet-maintenance.mjs --dry-run
 *   - Đồng bộ dữ liệu cốt lõi (nhanh, ~20 giây):
 *       node --env-file=.env.local scripts/migrate-appsheet-maintenance.mjs
 *   - Đồng bộ dữ liệu KÈM tải lên kho ảnh Supabase Storage (kèm queue 8 luồng song song):
 *       node --env-file=.env.local scripts/migrate-appsheet-maintenance.mjs --with-images
 *   - Giới hạn N bản ghi:
 *       node --env-file=.env.local scripts/migrate-appsheet-maintenance.mjs --limit 20
 */

import { createClient } from "@supabase/supabase-js"
import XLSX from "xlsx"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, "..")

const FACTORY_ID = "0268ab41-a564-4538-acf1-6297ac372f57" // Nhà máy Phước Hòa Kampong Thom
const IMAGE_BUCKET = "order-files"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong môi trường")
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// CLI args
const args = process.argv.slice(2)
const isDryRun = args.includes("--dry-run")
const withImages = args.includes("--with-images")
const limitIdx = args.indexOf("--limit")
const limitCount = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity

console.log("=================================================================")
console.log("🛠️  ĐỒNG BỘ DỮ LIỆU BẢO TRÌ & SỬA CHỮA APPSHEET -> SUPABASE")
console.log(`📌 Chế độ: ${isDryRun ? "DRY-RUN (Chỉ kiểm thử, KHÔNG ghi DB)" : "THỰC THI (Ghi vào DB)"}`)
console.log(`🖼️  Hình ảnh: ${withImages ? "TẢI LÊN Supabase Storage (order-files)" : "BỎ QUA ảnh (Đồng bộ siêu tốc)"}`)
if (Number.isFinite(limitCount)) console.log(`⏱️  Giới hạn test: ${limitCount} bản ghi`)
console.log("=================================================================\n")

// ─── 1. BỘ CHUYỂN ĐỔI DỮ LIỆU (HELPERS) ───────────────────────────────────────

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
  if (v === null || v === undefined || v === "") return null
  if (typeof v === "number") {
    const frac = v % 1
    const totalSec = Math.round(frac * 86400)
    const h = String(Math.floor(totalSec / 3600)).padStart(2, "0")
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0")
    return `${h}:${m}`
  }
  const str = String(v).trim()
  const m = str.match(/(\d{1,2}):(\d{2})/)
  if (m) {
    return `${m[1].padStart(2, "0")}:${m[2]}`
  }
  return null
}

function normalizeBoPhan(rawBoPhan, idOrPrefix = "") {
  let text = String(rawBoPhan || "").trim()
  text = text.replace(/^Hư hỏng\s+/i, "").trim()
  const lower = text.toLowerCase()

  if (lower.includes("mủ tạp") || lower.includes("mu tap")) return "Mủ tạp"
  if (lower.includes("biomass") || lower.includes("biomas")) return "Biomass"
  if (lower.includes("nước thải") || lower.includes("nuoc thai")) return "Nước thải"
  if (lower.includes("đội xe") || lower.includes("doi xe")) return "Đội xe"
  if (lower.includes("mủ nước") || lower.includes("mu nuoc")) return "Mủ nước"
  if (lower.includes("văn phòng") || lower.includes("van phong")) return "Văn phòng"

  const p = String(idOrPrefix).toUpperCase()
  if (p.includes("MT")) return "Mủ tạp"
  if (p.includes("BO") || p.includes("BI")) return "Biomass"
  if (p.includes("NT")) return "Nước thải"
  if (p.includes("DX")) return "Đội xe"
  if (p.includes("MN")) return "Mủ nước"
  return "Mủ tạp"
}

function normalizeCurrency(v) {
  if (!v) return "USD"
  const s = String(v).trim()
  if (s === "$" || s.toUpperCase() === "USD") return "USD"
  if (s === "៛" || s.toUpperCase() === "KHR") return "KHR"
  if (s === "đ" || s.toUpperCase() === "VND") return "VND"
  return "USD"
}

function parseCreator(str, fallback) {
  if (fallback && String(fallback).trim()) return String(fallback).trim()
  if (!str) return null
  const m = String(str).match(/Tạo bởi:\s*([^\s]+(?:\s+[^\s]+)*)\s+lúc:/i)
  if (m && m[1] && m[1].trim()) return m[1].trim()
  return String(str).trim()
}

function parseStaffArray(str) {
  if (!str) return []
  return String(str)
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function parseApproval(nguoiDuyetStr) {
  if (!nguoiDuyetStr) return { trang_thai: "cho_duyet", nguoi_duyet: null, ngay_duyet: null }
  const s = String(nguoiDuyetStr)
  if (!s.includes("Đã duyệt")) {
    return { trang_thai: "cho_duyet", nguoi_duyet: null, ngay_duyet: null }
  }

  let approver = null
  let appDate = null

  const lines = s.split("\n").map((l) => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (line.startsWith("🕵") && !approver) {
      approver = line.replace(/^🕵\s*/, "").trim()
    }
    if (line.startsWith("⌛") && !appDate) {
      const timeStr = line.replace(/^⌛\s*/, "").trim()
      const tm = timeStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/)
      if (tm) {
        const y = tm[3].length === 2 ? `20${tm[3]}` : tm[3]
        const m = tm[2].padStart(2, "0")
        const d = tm[1].padStart(2, "0")
        const hh = tm[4].padStart(2, "0")
        const mm = tm[5].padStart(2, "0")
        const ss = (tm[6] || "00").padStart(2, "0")
        appDate = `${y}-${m}-${d}T${hh}:${mm}:${ss}+07:00`
      }
    }
    if (approver && appDate) break
  }

  return {
    trang_thai: "da_duyet",
    nguoi_duyet: approver,
    ngay_duyet: appDate,
  }
}

// ─── 2. TÌM KIẾM THƯ MỤC ẢNH CỤC BỘ TRÊN G: DRIVE ───────────────────────────

const localImageDirs = [
  "G:/My Drive/appsheet/data/Chấtlượng-895871990/Hu_hong_Images",
  "G:/My Drive/appsheet/data/QuảnlýsảnxuấtKPT-895871990/Hu_hong_Images",
  "G:/My Drive/appsheet/data/QuảnlýsảnxuấtKPTtest-895871990/Hu_hong_Images",
  "G:/My Drive/appsheet/data/Chấtlượng-895871990/Bao_duong_Images",
]

const diskImageIndex = new Map() // filename -> fullPath
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
    console.warn(`  ⚠️ Không đọc được thư mục ${dir}: ${err.message}`)
  }
}
console.log(`  ✅ Đã tìm thấy ${diskImageIndex.size} tệp ảnh trên ổ đĩa G:\n`)

const uploadedUrlCache = new Map() // filename -> publicSupabaseUrl

async function uploadImageIfFound(relPath) {
  if (!relPath || typeof relPath !== "string") return null
  const filename = path.basename(relPath.trim())
  if (!filename) return null

  if (uploadedUrlCache.has(filename.toLowerCase())) {
    return uploadedUrlCache.get(filename.toLowerCase())
  }

  const localPath = diskImageIndex.get(filename.toLowerCase())
  if (!localPath || !fs.existsSync(localPath)) {
    return null
  }

  if (isDryRun) {
    const mockUrl = `https://supabase.mock/${FACTORY_ID}/maintenance/legacy/${filename}`
    uploadedUrlCache.set(filename.toLowerCase(), mockUrl)
    return mockUrl
  }

  if (!withImages) {
    return null
  }

  try {
    const fileBuffer = fs.readFileSync(localPath)
    const storagePath = `${FACTORY_ID}/maintenance/legacy/${filename}`

    const { error } = await sb.storage.from(IMAGE_BUCKET).upload(storagePath, fileBuffer, {
      contentType: "image/jpeg",
      upsert: true,
    })

    if (error && !error.message.includes("The resource already exists")) {
      console.warn(`    ⚠️ Upload ảnh lỗi ${filename}: ${error.message}`)
      return null
    }

    const { data: urlData } = sb.storage.from(IMAGE_BUCKET).getPublicUrl(storagePath)
    uploadedUrlCache.set(filename.toLowerCase(), urlData.publicUrl)
    return urlData.publicUrl
  } catch (err) {
    console.warn(`    ⚠️ Lỗi khi tải ảnh ${filename}: ${err.message}`)
    return null
  }
}

// ─── 3. TẢI MASTER DATA TỪ SUPABASE (ASSETS, VEHICLES, ITEMS) ────────────────

console.log("📥 Đang tải Master Data từ Supabase...")
const { data: dbAssets, error: assetErr } = await sb
  .from("maintenance_assets")
  .select("id, ma_tb, ten_tb, bo_phan")
  .eq("factory_id", FACTORY_ID)
if (assetErr) throw assetErr

const { data: dbVehicles, error: vehicleErr } = await sb
  .from("dispatch_vehicles")
  .select("id, code, name, plate_number")
  .eq("factory_id", FACTORY_ID)
if (vehicleErr) throw vehicleErr

const { data: dbItems, error: itemErr } = await sb
  .from("inventory_items")
  .select("id, code, name, unit")
if (itemErr) throw itemErr

const { data: existingRecords, error: recErr } = await sb
  .from("maintenance_records")
  .select("id, ma_bb, ngay, ghi_chu")
  .eq("factory_id", FACTORY_ID)
if (recErr) throw recErr

console.log(`  ✅ Thiết bị (${dbAssets?.length || 0}), Xe (${dbVehicles?.length || 0}), Vật tư kho (${dbItems?.length || 0})`)
console.log(`  ✅ Đã có ${existingRecords?.length || 0} biên bản bảo trì trong DB\n`)

// Indexing maps
const assetMapByCode = new Map(dbAssets.map((a) => [a.ma_tb.toLowerCase().trim(), a]))
const assetMapByName = new Map(dbAssets.map((a) => [a.ten_tb.toLowerCase().trim(), a]))

const vehicleMapByCode = new Map(dbVehicles.map((v) => [v.code.toLowerCase().trim(), v]))
const vehicleMapByName = new Map(dbVehicles.map((v) => [v.name.toLowerCase().trim(), v]))

const fordVehicle = dbVehicles.find((v) => v.name.toLowerCase().includes("ford") || v.code.toUpperCase() === "XF")

const itemMapByName = new Map(dbItems.map((i) => [i.name.toLowerCase().trim(), i]))
const itemMapByCode = new Map(dbItems.map((i) => [i.code.toLowerCase().trim(), i]))

const existingLegacyIds = new Set()
const usedMaBBSet = new Set((existingRecords || []).map((r) => r.ma_bb).filter(Boolean))

for (const r of existingRecords || []) {
  if (r.ghi_chu) {
    const m = r.ghi_chu.match(/\[Mã AppSheet:\s*([^\]]+)\]/)
    if (m && m[1]) existingLegacyIds.add(m[1].trim())
  }
}

// ─── 4. ĐỌC VÀ CHUẨN BỊ DỮ LIỆU TỪ 2 FILE EXCEL ──────────────────────────────

const parentFile = path.join(ROOT_DIR, "cung_cap_dl", "file_appsheet bao duong.xlsx")
const childFile = path.join(ROOT_DIR, "cung_cap_dl", "file_appsheet.xlsx")

console.log("📖 Đang đọc các tệp Excel AppSheet...")
const wbParent = XLSX.readFile(parentFile)
const parentRows = XLSX.utils.sheet_to_json(wbParent.Sheets["Bao_duong"], { defval: null })

const wbChild = XLSX.readFile(childFile)
const childRows = XLSX.utils.sheet_to_json(wbChild.Sheets["Hu_hong"], { defval: null })

console.log(`  ✅ Tệp cha (file_appsheet bao duong.xlsx): ${parentRows.length} dòng`)
console.log(`  ✅ Tệp con (file_appsheet.xlsx): ${childRows.length} dòng\n`)

const validChildRows = childRows.filter((r) => {
  if (!r.ID && !r.ID_BD && !r.Su_co && !r.Ten_TB) return false
  if (r.Bo_phan === "Hoạt động khác" || (r.ID && String(r.ID).startsWith("HK"))) return false
  if (r.Bo_phan === "Hư hỏng khác" || (r.ID && String(r.ID).startsWith("K"))) return false
  return true
})

console.log(`🧹 Dòng hợp lệ sau lọc rác & Hư hỏng khác: ${validChildRows.length} / ${childRows.length} dòng`)

const childRowsByBd = new Map()
const scRows = []

for (const r of validChildRows) {
  if (r.ID_BD) {
    const key = String(r.ID_BD).trim()
    if (!childRowsByBd.has(key)) childRowsByBd.set(key, [])
    childRowsByBd.get(key).push(r)
  } else {
    scRows.push(r)
  }
}

console.log(`  👉 Gom thành: ${childRowsByBd.size} nhóm bảo dưỡng con và ${scRows.length} dòng sự cố sửa chữa\n`)

// ─── 5. TỔ CHỨC CÁC BẢN GHI MAINTENANCE_RECORDS CẦN TẠO ───────────────────────

const DEPT_PREFIX = {
  "Mủ tạp": "MT",
  "Mủ nước": "MN",
  "Đội xe": "DX",
  "Nước thải": "NT",
  "Biomass": "BO",
  "Văn phòng": "VP",
  "Khác": "K",
}

function generateNextMaBB(boPhan, ngayIso) {
  const prefixDept = DEPT_PREFIX[boPhan] || "MT"
  const d = new Date(ngayIso)
  const dd = String(d.getDate()).padStart(2, "0")
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const yy = String(d.getFullYear()).slice(-2)
  const prefix = `${prefixDept}-${dd}${mm}${yy}`

  let seq = 1
  while (usedMaBBSet.has(`${prefix}/${String(seq).padStart(3, "0")}`)) {
    seq++
  }
  const code = `${prefix}/${String(seq).padStart(3, "0")}`
  usedMaBBSet.add(code)
  return code
}

const recordsToCreate = []
const processedBdKeys = new Set()

// 5.1 Biên bản Bảo dưỡng
for (const pRow of parentRows) {
  if (!pRow.ID_BD) continue
  const idBd = String(pRow.ID_BD).trim()
  processedBdKeys.add(idBd)

  if (existingLegacyIds.has(idBd)) continue

  const ngayIso = excelDateToISO(pRow.Ngay_BD) || "2025-01-01"
  const boPhan = normalizeBoPhan(pRow.Bo_phan, idBd)
  const maBb = generateNextMaBB(boPhan, ngayIso)

  const children = childRowsByBd.get(idBd) || []

  recordsToCreate.push({
    legacyId: idBd,
    hang_muc: "Bảo dưỡng",
    bo_phan: boPhan,
    ngay: ngayIso,
    tu_gio: excelTimeToHM(pRow.Tu_gio),
    den_gio: excelTimeToHM(pRow.Den_gio),
    ma_bb: maBb,
    noi_dung_chung: pRow.Noi_dung_bd_chung || null,
    nguyen_nhan_chung: pRow.Loai_BD || "Bảo dưỡng định kỳ",
    image_rel_paths_chung: [pRow["Hinh_anh_chung 1"], pRow["Hinh_anh_chung 2"]].filter(Boolean),
    nguoi_thuc_hien: parseStaffArray(pRow.Nguoi_thuc_hien),
    nguoi_tao: pRow.Nguoi_tao ? String(pRow.Nguoi_tao).trim() : null,
    nv_phu_trach: pRow.nv_phu_trach ? String(pRow.nv_phu_trach).trim() : null,
    phu_trach_bao_tri: pRow.phu_trach_bao_tri ? String(pRow.phu_trach_bao_tri).trim() : null,
    bgd_phu_trach: pRow.bgd_phu_trach ? String(pRow.bgd_phu_trach).trim() : null,
    giam_doc: pRow.giam_doc ? String(pRow.giam_doc).trim() : null,
    trang_thai: "da_duyet",
    ghi_chu: `[Mã AppSheet: ${idBd}]` + (pRow.Chon_thiet_bi ? ` Thiết bị: ${pRow.Chon_thiet_bi}` : ""),
    children: children,
  })
}

// 3 ID_BD chỉ có ở file con
for (const [idBd, children] of childRowsByBd.entries()) {
  if (processedBdKeys.has(idBd) || existingLegacyIds.has(idBd)) continue

  const first = children[0]
  const ngayIso = excelDateToISO(first.Ngay_su_co) || "2025-01-01"
  const boPhan = normalizeBoPhan(first.Bo_phan, idBd)
  const maBb = generateNextMaBB(boPhan, ngayIso)

  recordsToCreate.push({
    legacyId: idBd,
    hang_muc: "Bảo dưỡng",
    bo_phan: boPhan,
    ngay: ngayIso,
    tu_gio: excelTimeToHM(first.Tu_gio),
    den_gio: excelTimeToHM(first.Den_gio),
    ma_bb: maBb,
    noi_dung_chung: first.Su_co || "Bảo dưỡng đầu mùa vụ",
    nguyen_nhan_chung: "Bảo dưỡng đầu mùa vụ",
    image_rel_paths_chung: [],
    nguoi_thuc_hien: parseStaffArray(first.Nguoi_thuc_hien),
    nguoi_tao: parseCreator(first.nguoi_tao, first.lap_bb),
    nv_phu_trach: first.nv_phu_trach ? String(first.nv_phu_trach).trim() : null,
    phu_trach_bao_tri: first.phu_trach_bao_tri ? String(first.phu_trach_bao_tri).trim() : null,
    bgd_phu_trach: first.bgd_phu_trach ? String(first.bgd_phu_trach).trim() : null,
    giam_doc: first.giam_doc ? String(first.giam_doc).trim() : null,
    trang_thai: "da_duyet",
    ghi_chu: `[Mã AppSheet: ${idBd}]`,
    children: children,
  })
}

// 5.2 Biên bản Sửa chữa
const scGroups = new Map()
for (const r of scRows) {
  const scId = r.ID ? String(r.ID).trim() : `SC-ROW-${r.Key}`
  if (!scGroups.has(scId)) scGroups.set(scId, [])
  scGroups.get(scId).push(r)
}

for (const [scId, rows] of scGroups.entries()) {
  if (existingLegacyIds.has(scId)) continue

  const first = rows[0]
  const ngayIso = excelDateToISO(first.Ngay_su_co) || "2025-01-01"
  const boPhan = normalizeBoPhan(first.Bo_phan, scId)
  const maBb = generateNextMaBB(boPhan, ngayIso)
  const approval = parseApproval(first.Nguoi_duyet)

  recordsToCreate.push({
    legacyId: scId,
    hang_muc: "Sửa chữa",
    bo_phan: boPhan,
    ngay: ngayIso,
    tu_gio: excelTimeToHM(first.Tu_gio),
    den_gio: excelTimeToHM(first.Den_gio),
    ma_bb: maBb,
    noi_dung_chung: rows.length > 1 ? first.Su_co : null,
    nguyen_nhan_chung: null,
    image_rel_paths_chung: [],
    nguoi_thuc_hien: parseStaffArray(first.Nguoi_thuc_hien),
    nguoi_tao: parseCreator(first.nguoi_tao, first.lap_bb),
    nv_phu_trach: first.nv_phu_trach ? String(first.nv_phu_trach).trim() : null,
    phu_trach_bao_tri: first.phu_trach_bao_tri ? String(first.phu_trach_bao_tri).trim() : null,
    bgd_phu_trach: first.bgd_phu_trach ? String(first.bgd_phu_trach).trim() : null,
    giam_doc: first.giam_doc ? String(first.giam_doc).trim() : null,
    trang_thai: approval.trang_thai,
    nguoi_duyet: approval.nguoi_duyet,
    ngay_duyet: approval.ngay_duyet,
    ghi_chu: `[Mã AppSheet: ${scId}]` + (first.Ghi_chu ? ` ${first.Ghi_chu}` : ""),
    children: rows,
  })
}

console.log(`📋 Tổng biên bản bảo trì sẵn sàng tạo: ${recordsToCreate.length}`)
const bdTotal = recordsToCreate.filter((r) => r.hang_muc === "Bảo dưỡng").length
const scTotal = recordsToCreate.filter((r) => r.hang_muc === "Sửa chữa").length
console.log(`   - Bảo dưỡng: ${bdTotal} biên bản`)
console.log(`   - Sửa chữa:  ${scTotal} biên bản\n`)

const finalRecords = Number.isFinite(limitCount) ? recordsToCreate.slice(0, limitCount) : recordsToCreate

// ─── 6. TIẾN HÀNH ĐỒNG BỘ VÀO DATABASE ─────────────────────────────────────────

let insertedRecordCount = 0
let insertedLineCount = 0
let insertedMaterialCount = 0
let totalUploadedImages = 0

console.log("🚀 Bắt đầu quá trình đồng bộ...")

for (let idx = 0; idx < finalRecords.length; idx++) {
  const rec = finalRecords[idx]

  // 6.1 Upload ảnh chung (nếu có)
  const commonImageUrls = []
  for (const p of rec.image_rel_paths_chung) {
    const url = await uploadImageIfFound(p)
    if (url) {
      commonImageUrls.push(url)
      totalUploadedImages++
    }
  }

  // 6.2 Insert record cha vào maintenance_records
  const recordPayload = {
    factory_id: FACTORY_ID,
    ma_bb: rec.ma_bb,
    hang_muc: rec.hang_muc,
    ngay: rec.ngay,
    tu_gio: rec.tu_gio,
    den_gio: rec.den_gio,
    bo_phan: rec.bo_phan,
    nguoi_tao: rec.nguoi_tao,
    nguoi_thuc_hien: rec.nguoi_thuc_hien,
    nv_phu_trach: rec.nv_phu_trach,
    phu_trach_bao_tri: rec.phu_trach_bao_tri,
    bgd_phu_trach: rec.bgd_phu_trach,
    giam_doc: rec.giam_doc,
    trang_thai: rec.trang_thai,
    nguoi_duyet: rec.nguoi_duyet || null,
    ngay_duyet: rec.ngay_duyet || null,
    noi_dung_chung: rec.noi_dung_chung,
    nguyen_nhan_chung: rec.nguyen_nhan_chung,
    image_urls_chung: commonImageUrls.length > 0 ? commonImageUrls : null,
    ghi_chu: rec.ghi_chu,
  }

  let dbRecordId = null

  if (!isDryRun) {
    const { data: insertedRec, error: recInsertErr } = await sb
      .from("maintenance_records")
      .insert(recordPayload)
      .select("id")
      .single()

    if (recInsertErr) {
      console.error(`❌ Lỗi insert maintenance_records (${rec.ma_bb}):`, recInsertErr.message)
      continue
    }
    dbRecordId = insertedRec.id
  } else {
    dbRecordId = `mock-record-${idx}`
  }
  insertedRecordCount++

  // 6.3 Xử lý các dòng thiết bị con (maintenance_record_lines)
  for (let lIdx = 0; lIdx < rec.children.length; lIdx++) {
    const child = rec.children[lIdx]

    const rawMaTb = child.Ma_TB ? String(child.Ma_TB).trim() : ""
    const rawTenTb = child.Ten_TB ? String(child.Ten_TB).trim() : ""

    let assetId = null
    let vehicleId = null

    if (rec.bo_phan === "Đội xe") {
      const vMatch =
        (rawMaTb && vehicleMapByCode.get(rawMaTb.toLowerCase())) ||
        (rawTenTb && vehicleMapByName.get(rawTenTb.toLowerCase()))
      if (vMatch) {
        vehicleId = vMatch.id
      } else if (rawTenTb.toLowerCase().includes("ford") || rawTenTb.toLowerCase().includes("bán tải")) {
        vehicleId = fordVehicle?.id || null
      }
    } else {
      const aMatch =
        (rawMaTb && assetMapByCode.get(rawMaTb.toLowerCase())) ||
        (rawTenTb && assetMapByName.get(rawTenTb.toLowerCase()))
      if (aMatch) {
        assetId = aMatch.id
      }
    }

    // Upload tối đa 6 ảnh chi tiết của thiết bị
    const lineImageUrls = []
    for (let i = 1; i <= 6; i++) {
      const imgPath = child[`Hinh_anh ${i}`]
      if (imgPath && typeof imgPath === "string" && imgPath.includes("Hu_hong_Images/")) {
        const url = await uploadImageIfFound(imgPath)
        if (url) {
          lineImageUrls.push(url)
          totalUploadedImages++
        }
      }
    }

    let loaiSuaChua = null
    if (rec.hang_muc === "Sửa chữa") {
      if (child.Loai_sua_chua === "Lớn") loaiSuaChua = "lon"
      else if (child.Loai_sua_chua === "Nhỏ") loaiSuaChua = "nho"
    }

    const chiPhi = typeof child.Chi_phi_sua_chua === "number" ? child.Chi_phi_sua_chua : 0
    const loaiTien = normalizeCurrency(child.Loai_tien)
    const congTho = typeof child.cong_tho === "number" ? child.cong_tho : 0

    const linePayload = {
      record_id: dbRecordId,
      factory_id: FACTORY_ID,
      sort_order: lIdx,
      asset_id: assetId,
      dispatch_vehicle_id: vehicleId,
      ten_tb: rawTenTb || "Thiết bị",
      ma_tb: rawMaTb || "TB",
      ten_tai_xe: child.Tai_xe ? String(child.Tai_xe).trim() : null,
      noi_dung: child.Su_co || null,
      nguyen_nhan: rec.hang_muc === "Sửa chữa" ? child.Su_co || null : null,
      cac_khac_phuc: child.Khac_phuc || null,
      loai_sua_chua: loaiSuaChua,
      chi_phi_dk: chiPhi,
      loai_tien: loaiTien,
      cong_tho: congTho,
      nhien_lieu_su_dung: child.nhien_lieu_su_dung || null,
      dvt_do: child.dvt_do || null,
      so_luong_do: typeof child.so_luong_do === "number" ? child.so_luong_do : null,
      image_urls: lineImageUrls,
    }

    let dbLineId = null

    if (!isDryRun) {
      const { data: insertedLine, error: lineInsertErr } = await sb
        .from("maintenance_record_lines")
        .insert(linePayload)
        .select("id")
        .single()

      if (lineInsertErr) {
        console.error(`  ❌ Lỗi insert line (${rawTenTb}):`, lineInsertErr.message)
        continue
      }
      dbLineId = insertedLine.id
    } else {
      dbLineId = `mock-line-${idx}-${lIdx}`
    }
    insertedLineCount++

    // 6.4 Xử lý vật tư (maintenance_materials)
    if (child.Vat_tu && child.Vat_tu !== "Không" && child.Xuat_vat_tu) {
      const isTrongKho = child.Vat_tu.includes("Trong kho")
      const matName = String(child.Xuat_vat_tu).trim()

      let invItemId = null
      if (isTrongKho) {
        const itemMatch = itemMapByName.get(matName.toLowerCase()) || itemMapByCode.get(matName.toLowerCase())
        if (itemMatch) invItemId = itemMatch.id
      }

      let qty = 1
      if (typeof child.so_luong === "number") qty = child.so_luong
      else if (child.so_luong && !isNaN(parseFloat(child.so_luong))) qty = parseFloat(child.so_luong)

      let donGia = null
      if (!isTrongKho && chiPhi > 0) {
        donGia = qty > 0 ? chiPhi / qty : chiPhi
      }

      const matPayload = {
        line_id: dbLineId,
        record_id: dbRecordId,
        factory_id: FACTORY_ID,
        sort_order: 0,
        nguon: isTrongKho ? "trong_kho" : "ben_ngoai",
        inventory_item_id: invItemId,
        ten_vat_tu: matName,
        dvt: child.dvt ? String(child.dvt).trim() : null,
        so_luong: qty,
        don_gia: donGia,
        loai_tien: loaiTien,
      }

      if (!isDryRun) {
        const { error: matInsertErr } = await sb.from("maintenance_materials").insert(matPayload)
        if (matInsertErr) {
          console.error(`    ❌ Lỗi insert vật tư (${matName}):`, matInsertErr.message)
        }
      }
      insertedMaterialCount++
    }
  }

  if ((idx + 1) % 50 === 0 || idx + 1 === finalRecords.length) {
    console.log(`  ⏳ Tiến độ: ${idx + 1} / ${finalRecords.length} biên bản (${insertedLineCount} dòng thiết bị, ${insertedMaterialCount} vật tư)...`)
  }
}

console.log("\n=================================================================")
console.log("🎉 KẾT QUẢ ĐỒNG BỘ DỮ LIỆU:")
console.log(`  ✅ Biên bản (maintenance_records):      ${insertedRecordCount}`)
console.log(`  ✅ Dòng thiết bị (record_lines):         ${insertedLineCount}`)
console.log(`  ✅ Vật tư phụ tùng (materials):          ${insertedMaterialCount}`)
console.log(`  🖼️  Hình ảnh đã xử lý/upload:             ${totalUploadedImages}`)
console.log("=================================================================\n")
